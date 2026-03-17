import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { CrawlJob, PageNode } from "@shared/schema";

// Data directory — Railway provides a persistent volume, locally uses ./data
const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = join(DATA_DIR, "sitemapper.db");
const SCREENSHOTS_DIR = join(DATA_DIR, "screenshots");

// Ensure directories exist
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS crawl_jobs (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    pages_processed INTEGER DEFAULT 0,
    screenshots_processed INTEGER DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT,
    pages_json TEXT DEFAULT '[]'
  )
`);

function screenshotPath(jobId: string, pageId: string): string {
  const jobDir = join(SCREENSHOTS_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });
  return join(jobDir, `${pageId}.jpg`);
}

/**
 * Save screenshot base64 data to disk, clear it from the page object.
 */
function saveScreenshotsToDisk(jobId: string, pages: PageNode[]): PageNode[] {
  return pages.map((p) => {
    if (p.screenshotBase64) {
      const path = screenshotPath(jobId, p.id);
      writeFileSync(path, Buffer.from(p.screenshotBase64, "base64"));
      return { ...p, screenshotBase64: null, screenshotPath: path };
    }
    return p;
  });
}

/**
 * Check if a screenshot file exists on disk for a page.
 */
function hasScreenshotOnDisk(jobId: string, pageId: string): boolean {
  return existsSync(screenshotPath(jobId, pageId));
}

/**
 * Read a screenshot from disk.
 */
function readScreenshotFromDisk(jobId: string, pageId: string): Buffer | null {
  const path = screenshotPath(jobId, pageId);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

function jobFromRow(row: any): CrawlJob {
  const pages: PageNode[] = JSON.parse(row.pages_json || "[]");
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    progress: row.progress,
    totalPages: row.total_pages,
    pagesProcessed: row.pages_processed,
    screenshotsProcessed: row.screenshots_processed,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    pages,
  };
}

export interface IStorage {
  getCrawlJob(id: string): CrawlJob | undefined;
  getAllCrawlJobs(): CrawlJob[];
  createCrawlJob(job: CrawlJob): CrawlJob;
  updateCrawlJob(id: string, update: Partial<CrawlJob>): CrawlJob | undefined;
  deleteCrawlJob(id: string): boolean;
  getScreenshot(jobId: string, pageId: string): Buffer | null;
  hasScreenshot(jobId: string, pageId: string): boolean;
}

export class SqliteStorage implements IStorage {
  private insertStmt = db.prepare(`
    INSERT INTO crawl_jobs (id, domain, status, progress, total_pages, pages_processed, screenshots_processed, started_at, completed_at, error_message, pages_json)
    VALUES (@id, @domain, @status, @progress, @total_pages, @pages_processed, @screenshots_processed, @started_at, @completed_at, @error_message, @pages_json)
  `);

  private updateStmt = db.prepare(`
    UPDATE crawl_jobs SET
      domain = @domain,
      status = @status,
      progress = @progress,
      total_pages = @total_pages,
      pages_processed = @pages_processed,
      screenshots_processed = @screenshots_processed,
      started_at = @started_at,
      completed_at = @completed_at,
      error_message = @error_message,
      pages_json = @pages_json
    WHERE id = @id
  `);

  getCrawlJob(id: string): CrawlJob | undefined {
    const row = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(id) as any;
    return row ? jobFromRow(row) : undefined;
  }

  getAllCrawlJobs(): CrawlJob[] {
    const rows = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC").all() as any[];
    return rows.map(jobFromRow);
  }

  createCrawlJob(job: CrawlJob): CrawlJob {
    this.insertStmt.run({
      id: job.id,
      domain: job.domain,
      status: job.status,
      progress: job.progress,
      total_pages: job.totalPages,
      pages_processed: job.pagesProcessed,
      screenshots_processed: job.screenshotsProcessed,
      started_at: job.startedAt,
      completed_at: job.completedAt,
      error_message: job.errorMessage,
      pages_json: JSON.stringify(job.pages),
    });
    return job;
  }

  updateCrawlJob(id: string, update: Partial<CrawlJob>): CrawlJob | undefined {
    const existing = this.getCrawlJob(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...update };

    // If pages have screenshots in base64, save them to disk
    if (merged.pages) {
      merged.pages = saveScreenshotsToDisk(id, merged.pages);
    }

    this.updateStmt.run({
      id: merged.id,
      domain: merged.domain,
      status: merged.status,
      progress: merged.progress,
      total_pages: merged.totalPages,
      pages_processed: merged.pagesProcessed,
      screenshots_processed: merged.screenshotsProcessed,
      started_at: merged.startedAt,
      completed_at: merged.completedAt,
      error_message: merged.errorMessage,
      pages_json: JSON.stringify(merged.pages),
    });
    return merged;
  }

  deleteCrawlJob(id: string): boolean {
    const result = db.prepare("DELETE FROM crawl_jobs WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getScreenshot(jobId: string, pageId: string): Buffer | null {
    return readScreenshotFromDisk(jobId, pageId);
  }

  hasScreenshot(jobId: string, pageId: string): boolean {
    return hasScreenshotOnDisk(jobId, pageId);
  }
}

export const storage = new SqliteStorage();
