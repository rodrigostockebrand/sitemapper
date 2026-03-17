import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { crawlRequestSchema, type CrawlJob } from "@shared/schema";
import { crawlSite } from "./crawler";
import { takeScreenshots } from "./screenshotter";
import { WebSocketServer } from "ws";

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

  // Start a crawl job
  app.post("/api/crawl", async (req, res) => {
    try {
      const parsed = crawlRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const { url, maxPages, maxDepth } = parsed.data;

      // Normalize domain
      let normalizedUrl = url;
      if (!normalizedUrl.startsWith("http")) {
        normalizedUrl = "https://" + normalizedUrl;
      }

      const domain = new URL(normalizedUrl).hostname;
      const jobId = randomUUID();

      const job: CrawlJob = {
        id: jobId,
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
          const pagesWithScreenshots = await takeScreenshots(pages, (screenshotsProcessed) => {
            const screenshottable = pages.filter(
              (p) => p.fileType === "html" && p.statusCode >= 200 && p.statusCode < 400
            ).length;
            const progress = 50 + Math.round((screenshotsProcessed / Math.max(screenshottable, 1)) * 50);
            storage.updateCrawlJob(jobId, { screenshotsProcessed, progress });
            broadcastProgress(jobId, { screenshotsProcessed, progress, status: "screenshotting" });
          });

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
          broadcastProgress(jobId, {
            status: "error",
            errorMessage: err.message,
          });
        }
      })();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get crawl job status (without screenshots to keep response light)
  app.get("/api/crawl/:id", (req, res) => {
    const job = storage.getCrawlJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    // Return pages with hasScreenshot flag (base64 is always null now — stored on disk)
    const lightPages = job.pages.map((p) => ({
      ...p,
      screenshotBase64: null,
      hasScreenshot: storage.hasScreenshot(job.id, p.id),
    }));
    res.json({ ...job, pages: lightPages });
  });

  // Get full crawl job (screenshots served separately via per-page endpoint)
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

  // List all jobs
  app.get("/api/crawls", (_req, res) => {
    const jobs = storage.getAllCrawlJobs().map((j) => ({
      id: j.id,
      domain: j.domain,
      status: j.status,
      totalPages: j.pages.length,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
    }));
    res.json(jobs);
  });

  return httpServer;
}
