import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
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
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
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

  // ── Stripe placeholder routes ───────────────────────────

  // Create checkout session (placeholder — implement with Stripe later)
  app.post("/api/billing/checkout", requireAuth, (_req, res) => {
    // TODO: Integrate with Stripe to create a checkout session
    // const session = await stripe.checkout.sessions.create({ ... });
    // return res.json({ url: session.url });
    res.status(501).json({ error: "Stripe billing is not yet configured. Coming soon!" });
  });

  // Billing portal (placeholder)
  app.post("/api/billing/portal", requireAuth, (_req, res) => {
    res.status(501).json({ error: "Stripe billing portal is not yet configured." });
  });

  // Stripe webhook (placeholder)
  app.post("/api/billing/webhook", (_req, res) => {
    // TODO: Handle subscription.created, subscription.deleted, etc.
    res.json({ received: true });
  });

  return httpServer;
}
