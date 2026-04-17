import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import type { CrawlJob, PageNode, User, SafeUser, VerificationToken, SubscriptionTier } from "@shared/schema";

// Data directory — Railway provides a persistent volume, locally uses ./data
const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = join(DATA_DIR, "sitemapper.db");
const SCREENSHOTS_DIR = join(DATA_DIR, "screenshots");

// Ensure directories exist
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Tables ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS crawl_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    domain TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    pages_processed INTEGER DEFAULT 0,
    screenshots_processed INTEGER DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT,
    pages_json TEXT DEFAULT '[]',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`);

// Add user_id column if it doesn't exist (migration for existing databases)
try {
  db.exec(`ALTER TABLE crawl_jobs ADD COLUMN user_id TEXT`);
} catch {
  // Column already exists — safe to ignore
}

// ── Screenshot helpers ────────────────────────────────────
function screenshotPath(jobId: string, pageId: string): string {
  const jobDir = join(SCREENSHOTS_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });
  return join(jobDir, `${pageId}.jpg`);
}

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

function hasScreenshotOnDisk(jobId: string, pageId: string): boolean {
  return existsSync(screenshotPath(jobId, pageId));
}

function readScreenshotFromDisk(jobId: string, pageId: string): Buffer | null {
  const path = screenshotPath(jobId, pageId);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

// ── Row converters ────────────────────────────────────────
function userFromRow(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    emailVerified: !!row.email_verified,
    tier: row.tier as SubscriptionTier,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    createdAt: row.created_at,
  };
}

function safeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

function jobFromRow(row: any): CrawlJob {
  const pages: PageNode[] = JSON.parse(row.pages_json || "[]");
  return {
    id: row.id,
    userId: row.user_id || null,
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

// ── Storage interface ─────────────────────────────────────
export interface IStorage {
  // Users
  createUser(user: User): User;
  getUserByEmail(email: string): User | undefined;
  getUserById(id: string): User | undefined;
  updateUser(id: string, update: Partial<Pick<User, "emailVerified" | "tier" | "stripeCustomerId" | "stripeSubscriptionId" | "name">>): User | undefined;

  getUserByStripeCustomerId(stripeCustomerId: string): User | undefined;

  // Verification tokens
  createVerificationToken(token: VerificationToken): VerificationToken;
  getVerificationToken(token: string): VerificationToken | undefined;
  deleteVerificationToken(id: string): void;
  deleteVerificationTokensByUser(userId: string, type: string): void;

  // Crawl jobs
  getCrawlJob(id: string): CrawlJob | undefined;
  getAllCrawlJobs(): CrawlJob[];
  getCrawlJobsByUser(userId: string): CrawlJob[];
  getUserCrawlCountThisMonth(userId: string): number;
  createCrawlJob(job: CrawlJob): CrawlJob;
  updateCrawlJob(id: string, update: Partial<CrawlJob>): CrawlJob | undefined;
  deleteCrawlJob(id: string): boolean;
  getScreenshot(jobId: string, pageId: string): Buffer | null;
  hasScreenshot(jobId: string, pageId: string): boolean;
}

export class SqliteStorage implements IStorage {
  // ── User statements ───────────────────────────────────
  private insertUser = db.prepare(`
    INSERT INTO users (id, email, name, password_hash, email_verified, tier, stripe_customer_id, stripe_subscription_id, created_at)
    VALUES (@id, @email, @name, @password_hash, @email_verified, @tier, @stripe_customer_id, @stripe_subscription_id, @created_at)
  `);

  // ── Crawl statements ──────────────────────────────────
  private insertStmt = db.prepare(`
    INSERT INTO crawl_jobs (id, user_id, domain, status, progress, total_pages, pages_processed, screenshots_processed, started_at, completed_at, error_message, pages_json)
    VALUES (@id, @user_id, @domain, @status, @progress, @total_pages, @pages_processed, @screenshots_processed, @started_at, @completed_at, @error_message, @pages_json)
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

  // ── User methods ──────────────────────────────────────
  createUser(user: User): User {
    this.insertUser.run({
      id: user.id,
      email: user.email,
      name: user.name,
      password_hash: user.passwordHash,
      email_verified: user.emailVerified ? 1 : 0,
      tier: user.tier,
      stripe_customer_id: user.stripeCustomerId,
      stripe_subscription_id: user.stripeSubscriptionId,
      created_at: user.createdAt,
    });
    return user;
  }

  getUserByEmail(email: string): User | undefined {
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as any;
    return row ? userFromRow(row) : undefined;
  }

  getUserById(id: string): User | undefined {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    return row ? userFromRow(row) : undefined;
  }

  getUserByStripeCustomerId(stripeCustomerId: string): User | undefined {
    const row = db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(stripeCustomerId) as any;
    return row ? userFromRow(row) : undefined;
  }

  updateUser(id: string, update: Partial<Pick<User, "emailVerified" | "tier" | "stripeCustomerId" | "stripeSubscriptionId" | "name">>): User | undefined {
    const existing = this.getUserById(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const params: any = { id };

    if (update.emailVerified !== undefined) {
      sets.push("email_verified = @email_verified");
      params.email_verified = update.emailVerified ? 1 : 0;
    }
    if (update.tier !== undefined) {
      sets.push("tier = @tier");
      params.tier = update.tier;
    }
    if (update.stripeCustomerId !== undefined) {
      sets.push("stripe_customer_id = @stripe_customer_id");
      params.stripe_customer_id = update.stripeCustomerId;
    }
    if (update.stripeSubscriptionId !== undefined) {
      sets.push("stripe_subscription_id = @stripe_subscription_id");
      params.stripe_subscription_id = update.stripeSubscriptionId;
    }
    if (update.name !== undefined) {
      sets.push("name = @name");
      params.name = update.name;
    }

    if (sets.length === 0) return existing;
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = @id`).run(params);
    return this.getUserById(id);
  }

  // ── Verification token methods ────────────────────────
  createVerificationToken(token: VerificationToken): VerificationToken {
    db.prepare(`
      INSERT INTO verification_tokens (id, user_id, token, type, expires_at, created_at)
      VALUES (@id, @user_id, @token, @type, @expires_at, @created_at)
    `).run({
      id: token.id,
      user_id: token.userId,
      token: token.token,
      type: token.type,
      expires_at: token.expiresAt,
      created_at: token.createdAt,
    });
    return token;
  }

  getVerificationToken(token: string): VerificationToken | undefined {
    const row = db.prepare("SELECT * FROM verification_tokens WHERE token = ?").get(token) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      type: row.type,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  deleteVerificationToken(id: string): void {
    db.prepare("DELETE FROM verification_tokens WHERE id = ?").run(id);
  }

  deleteVerificationTokensByUser(userId: string, type: string): void {
    db.prepare("DELETE FROM verification_tokens WHERE user_id = ? AND type = ?").run(userId, type);
  }

  // ── Crawl job methods ─────────────────────────────────
  getCrawlJob(id: string): CrawlJob | undefined {
    const row = db.prepare("SELECT * FROM crawl_jobs WHERE id = ?").get(id) as any;
    return row ? jobFromRow(row) : undefined;
  }

  getAllCrawlJobs(): CrawlJob[] {
    const rows = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC").all() as any[];
    return rows.map(jobFromRow);
  }

  getCrawlJobsByUser(userId: string): CrawlJob[] {
    const rows = db.prepare("SELECT * FROM crawl_jobs WHERE user_id = ? ORDER BY started_at DESC").all(userId) as any[];
    return rows.map(jobFromRow);
  }

  getUserCrawlCountThisMonth(userId: string): number {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const row = db.prepare(
      "SELECT COUNT(*) as count FROM crawl_jobs WHERE user_id = ? AND started_at >= ?"
    ).get(userId, startOfMonth.toISOString()) as any;
    return row?.count ?? 0;
  }

  createCrawlJob(job: CrawlJob): CrawlJob {
    this.insertStmt.run({
      id: job.id,
      user_id: job.userId || null,
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
    // Clean up screenshot files on disk
    const jobDir = join(SCREENSHOTS_DIR, id);
    try {
      rmSync(jobDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist — that's fine
    }
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
export { safeUser };
