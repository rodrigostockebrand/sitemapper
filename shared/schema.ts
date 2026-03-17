import { z } from "zod";

// Crawl job schema
export const crawlRequestSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().min(1).max(200).default(50),
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
