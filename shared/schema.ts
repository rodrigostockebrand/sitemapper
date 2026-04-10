import { z } from "zod";

// ── Auth schemas ──────────────────────────────────────────
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;

// User
export type SubscriptionTier = "free" | "pro";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerified: boolean;
  tier: SubscriptionTier;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

/** Safe user object returned to the frontend (no password hash) */
export type SafeUser = Omit<User, "passwordHash">;

export interface VerificationToken {
  id: string;
  userId: string;
  token: string;
  type: "email_verify" | "password_reset";
  expiresAt: string;
  createdAt: string;
}

// ── Tier limits ───────────────────────────────────────────
export const TIER_LIMITS = {
  free: { maxPages: 100, maxDepth: 5, monthlyCredits: 5 },
  pro: { maxPages: 1000, maxDepth: 10, monthlyCredits: Infinity },
} as const;

// ── Crawl job schemas ─────────────────────────────────────
export const crawlRequestSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().min(1).max(1000).default(50),
  maxDepth: z.number().min(1).max(10).default(5),
});

export type CrawlRequest = z.infer<typeof crawlRequestSchema>;

// Single page node
export interface PageNode {
  id: string;
  url: string;
  path: string;
  title: string;
  statusCode: number;
  contentType: string;
  depth: number;
  parentId: string | null;
  childIds: string[];
  screenshotPath: string | null;
  screenshotBase64: string | null;
  hasScreenshot?: boolean;
  fileType: "html" | "pdf" | "image" | "other";
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
}

// Crawl job
export interface CrawlJob {
  id: string;
  userId: string | null;
  domain: string;
  status: "queued" | "crawling" | "screenshotting" | "complete" | "error";
  progress: number;
  totalPages: number;
  pagesProcessed: number;
  screenshotsProcessed: number;
  pages: PageNode[];
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}
