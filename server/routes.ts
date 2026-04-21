import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { storage, safeUser } from "./storage";
import {
  crawlRequestSchema,
  registerSchema,
  loginSchema,
  TIER_LIMITS,
  type CrawlJob,
} from "@shared/schema";
import { crawlSite } from "./crawler";
import { takeScreenshots } from "./screenshotter";
import { WebSocketServer } from "ws";
import { signToken, optionalAuth, requireAuth, getRequestUser } from "./auth";
import { sendVerificationEmail } from "./email";

// ── Stripe setup ───────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const APP_URL = process.env.APP_URL || "https://app.thevisualsitemap.com";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // WebSocket for real-time progress
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<string, Set<any>>();

  wss.on("connection", (ws) => {
    let subscribedJobId: string | null = null;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe" && msg.jobId) {
          subscribedJobId = msg.jobId;
          if (!clients.has(subscribedJobId!)) {
            clients.set(subscribedJobId!, new Set());
          }
          clients.get(subscribedJobId!)!.add(ws);
        }
      } catch {}
    });

    ws.on("close", () => {
      if (subscribedJobId && clients.has(subscribedJobId)) {
        clients.get(subscribedJobId)!.delete(ws);
      }
    });
  });

  function broadcastProgress(jobId: string, update: Partial<CrawlJob>) {
    const subs = clients.get(jobId);
    if (!subs) return;
    const msg = JSON.stringify({ type: "progress", ...update });
    for (const ws of subs) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  // ── Health check ────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // ── Auth routes ─────────────────────────────────────────

  // Register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }

      const { email, password, name } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      // Check if email already registered
      const existing = storage.getUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      // Create user
      const passwordHash = await bcrypt.hash(password, 12);
      const userId = randomUUID();
      const user = storage.createUser({
        id: userId,
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        emailVerified: false,
        tier: "free",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date().toISOString(),
      });

      // Create verification token
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
      storage.createVerificationToken({
        id: randomUUID(),
        userId,
        token,
        type: "email_verify",
        expiresAt,
        createdAt: new Date().toISOString(),
      });

      // Send verification email
      try {
        await sendVerificationEmail(normalizedEmail, name, token);
      } catch (emailErr: any) {
        console.error("Failed to send verification email:", emailErr.message);
      }

      const jwt = signToken(userId);
      res.status(201).json({ user: safeUser(user), token: jwt });
    } catch (err: any) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input" });
      }

      const { email, password } = parsed.data;
      const user = storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const jwt = signToken(user.id);
      res.json({ user: safeUser(user), token: jwt });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Verify email
  app.get("/api/auth/verify-email", (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ error: "Missing token" });
      }

      const vToken = storage.getVerificationToken(token);
      if (!vToken) {
        return res.status(400).json({ error: "Invalid or expired verification link" });
      }

      if (new Date(vToken.expiresAt) < new Date()) {
        storage.deleteVerificationToken(vToken.id);
        return res.status(400).json({ error: "Verification link has expired. Please request a new one." });
      }

      if (vToken.type !== "email_verify") {
        return res.status(400).json({ error: "Invalid token type" });
      }

      // Mark user as verified
      storage.updateUser(vToken.userId, { emailVerified: true });
      storage.deleteVerificationTokensByUser(vToken.userId, "email_verify");

      const user = storage.getUserById(vToken.userId);
      const jwt = signToken(vToken.userId);
      res.json({ user: user ? safeUser(user) : null, token: jwt, message: "Email verified successfully" });
    } catch (err: any) {
      console.error("Verify email error:", err);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // Resend verification email
  app.post("/api/auth/resend-verification", requireAuth, async (req, res) => {
    try {
      const user = getRequestUser(req)!;
      if (user.emailVerified) {
        return res.json({ message: "Email is already verified" });
      }

      // Delete old tokens and create a new one
      storage.deleteVerificationTokensByUser(user.id, "email_verify");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      storage.createVerificationToken({
        id: randomUUID(),
        userId: user.id,
        token,
        type: "email_verify",
        expiresAt,
        createdAt: new Date().toISOString(),
      });

      await sendVerificationEmail(user.email, user.name, token);
      res.json({ message: "Verification email sent" });
    } catch (err: any) {
      console.error("Resend verification error:", err);
      res.status(500).json({ error: "Failed to resend" });
    }
  });

  // Get current user
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = getRequestUser(req)!;
    const limits = TIER_LIMITS[user.tier];
    const crawlsThisMonth = storage.getUserCrawlCountThisMonth(user.id);
    res.json({
      user: safeUser(user),
      limits,
      crawlsThisMonth,
      crawlsRemaining: user.tier === "pro" ? Infinity : Math.max(0, limits.monthlyCredits - crawlsThisMonth),
    });
  });

  // ── Crawl routes (updated with auth + tier limits) ──────

  // Start a crawl job
  app.post("/api/crawl", optionalAuth, async (req, res) => {
    try {
      const parsed = crawlRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const user = getRequestUser(req);
      const tier = user?.tier || "free";
      const limits = TIER_LIMITS[tier];

      let { url, maxPages, maxDepth } = parsed.data;

      // Enforce tier limits
      if (maxPages > limits.maxPages) {
        maxPages = limits.maxPages;
      }
      if (maxDepth > limits.maxDepth) {
        maxDepth = limits.maxDepth;
      }

      // Check monthly crawl quota (only for logged-in free users)
      if (user && tier === "free") {
        const crawlsThisMonth = storage.getUserCrawlCountThisMonth(user.id);
        if (crawlsThisMonth >= limits.monthlyCredits) {
          return res.status(403).json({
            error: `Free plan allows ${limits.monthlyCredits} sitemaps per month. Upgrade to Pro for unlimited access.`,
            code: "LIMIT_REACHED",
          });
        }
      }

      // Normalize domain
      let normalizedUrl = url;
      if (!normalizedUrl.startsWith("http")) {
        normalizedUrl = "https://" + normalizedUrl;
      }

      const domain = new URL(normalizedUrl).hostname;
      const jobId = randomUUID();

      const job: CrawlJob = {
        id: jobId,
        userId: user?.id || null,
        domain,
        status: "crawling",
        progress: 0,
        totalPages: 0,
        pagesProcessed: 0,
        screenshotsProcessed: 0,
        pages: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorMessage: null,
      };

      storage.createCrawlJob(job);
      res.json({ jobId, status: "crawling" });

      // Run crawl in background
      (async () => {
        try {
          // Phase 1: Crawl
          const pages = await crawlSite(normalizedUrl, maxPages, maxDepth, (update) => {
            storage.updateCrawlJob(jobId, update);
            broadcastProgress(jobId, { ...update, status: "crawling" });
          });

          storage.updateCrawlJob(jobId, {
            status: "screenshotting",
            pages,
            totalPages: pages.length,
            pagesProcessed: pages.length,
            progress: 50,
          });
          broadcastProgress(jobId, {
            status: "screenshotting",
            totalPages: pages.length,
            progress: 50,
          });

          // Phase 2: Screenshots
          let pagesWithScreenshots = pages;
          try {
            pagesWithScreenshots = await takeScreenshots(pages, (screenshotsProcessed) => {
              const screenshottable = pages.filter(
                (p) => p.fileType === "html" && p.statusCode >= 200 && p.statusCode < 400
              ).length;
              const progress = 50 + Math.round((screenshotsProcessed / Math.max(screenshottable, 1)) * 50);
              storage.updateCrawlJob(jobId, { screenshotsProcessed, progress });
              broadcastProgress(jobId, { screenshotsProcessed, progress, status: "screenshotting" });
            });
          } catch (screenshotErr: any) {
            console.error("Screenshot phase failed:", screenshotErr.message);
          }

          storage.updateCrawlJob(jobId, {
            status: "complete",
            pages: pagesWithScreenshots,
            progress: 100,
            completedAt: new Date().toISOString(),
          });
          broadcastProgress(jobId, { status: "complete", progress: 100 });
        } catch (err: any) {
          storage.updateCrawlJob(jobId, {
            status: "error",
            errorMessage: err.message || "Unknown error occurred",
          });
          broadcastProgress(jobId, { status: "error", errorMessage: err.message });
        }
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get crawl job status
  app.get("/api/crawl/:id", (req, res) => {
    const job = storage.getCrawlJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    const lightPages = job.pages.map((p) => ({
      ...p,
      screenshotBase64: null,
      hasScreenshot: storage.hasScreenshot(job.id, p.id),
    }));
    res.json({ ...job, pages: lightPages });
  });

  // Get full crawl job
  app.get("/api/crawl/:id/full", (req, res) => {
    const job = storage.getCrawlJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    const lightPages = job.pages.map((p) => ({
      ...p,
      screenshotBase64: null,
      hasScreenshot: storage.hasScreenshot(job.id, p.id),
    }));
    res.json({ ...job, pages: lightPages });
  });

  // Get a single page screenshot
  app.get("/api/crawl/:id/page/:pageId/screenshot", (req, res) => {
    const buffer = storage.getScreenshot(req.params.id, req.params.pageId);
    if (!buffer) {
      return res.status(404).json({ error: "Screenshot not found" });
    }
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=3600");
    // CORS headers so client-side image export (html-to-image) can read pixels
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(buffer);
  });

  // List current user's crawl history
  app.get("/api/crawls", optionalAuth, (req, res) => {
    const user = getRequestUser(req);
    const jobs = (user ? storage.getCrawlJobsByUser(user.id) : storage.getAllCrawlJobs()).map((j) => ({
      id: j.id,
      domain: j.domain,
      status: j.status,
      totalPages: j.pages.length,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
    }));
    res.json(jobs);
  });

  // Delete a crawl job (owner only)
  app.delete("/api/crawls/:id", requireAuth, (req, res) => {
    const user = getRequestUser(req)!;
    const job = storage.getCrawlJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Crawl job not found" });
    }
    if (job.userId !== user.id) {
      return res.status(403).json({ error: "Not authorized to delete this job" });
    }
    storage.deleteCrawlJob(req.params.id);
    res.json({ ok: true });
  });

  // ── Stripe billing routes ──────────────────────────────

  // Create checkout session → redirect user to Stripe-hosted payment page
  app.post("/api/billing/checkout", requireAuth, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Stripe is not configured" });
      }

      const user = getRequestUser(req)!;

      if (user.tier === "pro") {
        return res.status(400).json({ error: "You are already on the Pro plan" });
      }

      // Reuse existing Stripe customer or create a new one
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        storage.updateUser(user.id, { stripeCustomerId: customerId });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${APP_URL}/#/upgrade-success`,
        cancel_url: `${APP_URL}/#/pricing`,
        subscription_data: {
          metadata: { userId: user.id },
        },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Billing portal → let Pro users manage subscription, update card, cancel
  app.post("/api/billing/portal", requireAuth, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Stripe is not configured" });
      }

      const user = getRequestUser(req)!;
      if (!user.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${APP_URL}/#/dashboard`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Portal error:", err.message);
      res.status(500).json({ error: "Failed to open billing portal" });
    }
  });

  // Stripe webhook → handle subscription lifecycle events
  app.post("/api/billing/webhook", async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: "Stripe not configured" });
    }

    let event: Stripe.Event;

    try {
      if (STRIPE_WEBHOOK_SECRET) {
        const sig = req.headers["stripe-signature"] as string;
        event = stripe.webhooks.constructEvent(
          req.rawBody as Buffer,
          sig,
          STRIPE_WEBHOOK_SECRET
        );
      } else {
        // No webhook secret configured — trust the payload (dev only)
        event = req.body as Stripe.Event;
      }
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook verification failed" });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode === "subscription" && session.customer) {
            const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
            const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
            const user = storage.getUserByStripeCustomerId(customerId);
            if (user) {
              storage.updateUser(user.id, {
                tier: "pro",
                stripeSubscriptionId: subscriptionId || null,
              });
              console.log(`User ${user.email} upgraded to Pro (subscription: ${subscriptionId})`);
            }
          }
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          const user = storage.getUserByStripeCustomerId(customerId);
          if (user) {
            // If subscription is canceled at period end or past_due, keep pro until period ends
            // If status is active, ensure they're pro
            if (sub.status === "active") {
              storage.updateUser(user.id, { tier: "pro", stripeSubscriptionId: sub.id });
            } else if (sub.status === "canceled" || sub.status === "unpaid") {
              storage.updateUser(user.id, { tier: "free", stripeSubscriptionId: null });
              console.log(`User ${user.email} downgraded to Free (subscription ${sub.status})`);
            }
          }
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          const user = storage.getUserByStripeCustomerId(customerId);
          if (user) {
            storage.updateUser(user.id, { tier: "free", stripeSubscriptionId: null });
            console.log(`User ${user.email} subscription deleted — downgraded to Free`);
          }
          break;
        }

        default:
          // Unhandled event type — ignore
          break;
      }
    } catch (err: any) {
      console.error("Webhook handler error:", err.message);
    }

    res.json({ received: true });
  });

  return httpServer;
}
