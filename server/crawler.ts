import * as cheerio from "cheerio";
import puppeteer from "puppeteer-core";
import { randomUUID } from "crypto";
import type { PageNode, CrawlJob } from "@shared/schema";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const FETCH_TIMEOUT = 15000;
const CONCURRENT_LIMIT = 5;
// If Cheerio finds fewer than this many internal links, fall back to browser
const MIN_LINKS_THRESHOLD = 3;

function normalizeUrl(urlStr: string, baseUrl: string): string | null {
  try {
    const u = new URL(urlStr, baseUrl);
    u.hash = "";
    // Remove trailing slash for consistency (except root)
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    u.pathname = path;
    // Remove common tracking params
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("utm_term");
    u.searchParams.delete("utm_content");
    return u.href;
  } catch {
    return null;
  }
}

function getContentType(headers: Headers): string {
  return (headers.get("content-type") || "text/html").split(";")[0].trim().toLowerCase();
}

function getFileType(contentType: string, url: string): PageNode["fileType"] {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("image")) return "image";
  if (contentType.includes("html") || contentType.includes("xhtml")) return "html";
  // Check URL extension as fallback
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "")) return "image";
  return "other";
}

async function fetchPage(url: string): Promise<{
  body: string;
  statusCode: number;
  contentType: string;
  ok: boolean;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = getContentType(res.headers);
    let body = "";
    if (contentType.includes("html") || contentType.includes("xhtml")) {
      body = await res.text();
    }
    return { body, statusCode: res.status, contentType, ok: res.ok };
  } catch (e: any) {
    return { body: "", statusCode: 0, contentType: "error", ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function extractPageInfo(html: string, url: string): {
  title: string;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  links: { internal: string[]; externalCount: number };
} {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || url;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const h1 = $("h1").first().text().trim() || null;

  // Word count from body text
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  // Extract links
  const baseHost = new URL(url).hostname;
  const internalLinks: string[] = [];
  let externalCount = 0;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Skip anchors, javascript, mailto, tel
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

    const normalized = normalizeUrl(href, url);
    if (!normalized) return;

    try {
      const linkHost = new URL(normalized).hostname;
      if (linkHost === baseHost || linkHost.endsWith("." + baseHost)) {
        internalLinks.push(normalized);
      } else {
        externalCount++;
      }
    } catch {
      // Skip malformed
    }
  });

  return { title, metaDescription, h1, wordCount, links: { internal: [...new Set(internalLinks)], externalCount } };
}

/**
 * Browser-based link extraction fallback.
 * Used when Cheerio finds too few links (JS-rendered pages).
 */
async function extractLinksWithBrowser(url: string, baseHost: string): Promise<string[]> {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--js-flags=--max-old-space-size=256",
        "--single-process",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 25000 });
    } catch {
      // If networkidle0 times out, the page is probably rendered enough
    }

    // Extra wait for JS frameworks
    await new Promise((r) => setTimeout(r, 3000));

    // Extract all links from the rendered DOM
    const links: string[] = await page.evaluate((bHost: string) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const results: string[] = [];
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
        try {
          const u = new URL(href, window.location.origin);
          if (u.hostname === bHost || u.hostname.endsWith("." + bHost)) {
            results.push(u.href);
          }
        } catch {}
      }
      return results;
    }, baseHost);

    await page.close();

    // Normalize and deduplicate
    const normalized = links
      .map((l) => {
        try {
          const u = new URL(l);
          u.hash = "";
          let path = u.pathname;
          if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
          u.pathname = path;
          u.searchParams.delete("utm_source");
          u.searchParams.delete("utm_medium");
          u.searchParams.delete("utm_campaign");
          u.searchParams.delete("utm_term");
          u.searchParams.delete("utm_content");
          return u.href;
        } catch {
          return null;
        }
      })
      .filter((l): l is string => l !== null);

    return [...new Set(normalized)];
  } catch (err) {
    console.error("Browser link extraction failed:", err);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Semaphore for concurrent limiting
class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;
  constructor(private limit: number) {}
  async acquire() {
    if (this.current < this.limit) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()!();
    }
  }
}

export async function crawlSite(
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  onProgress: (job: Partial<CrawlJob>) => void
): Promise<PageNode[]> {
  const baseUrl = new URL(startUrl);
  const baseHost = baseUrl.hostname;
  // If the user entered a path (e.g. /software or /bank/checking-accounts),
  // only crawl pages under that path prefix
  let basePath = baseUrl.pathname;
  if (basePath.length > 1 && basePath.endsWith("/")) {
    basePath = basePath.slice(0, -1);
  }
  // Only apply path filtering if the start URL has a non-root path
  const pathPrefix = basePath !== "/" ? basePath : null;
  const visited = new Map<string, string>(); // url -> id
  const pages: PageNode[] = [];
  const queue: { url: string; depth: number; parentId: string | null }[] = [];
  const semaphore = new Semaphore(CONCURRENT_LIMIT);

  // Normalize and add start URL
  const normalizedStart = normalizeUrl(startUrl, startUrl)!;
  const startId = randomUUID();
  visited.set(normalizedStart, startId);
  queue.push({ url: normalizedStart, depth: 0, parentId: null });

  let processed = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    // Process in batches
    const batch = queue.splice(0, Math.min(CONCURRENT_LIMIT, maxPages - pages.length));

    const promises = batch.map(async (item) => {
      await semaphore.acquire();
      try {
        const id = visited.get(item.url) || randomUUID();

        const { body, statusCode, contentType, ok } = await fetchPage(item.url);
        const fileType = getFileType(contentType, item.url);

        let title = item.url;
        let metaDescription: string | null = null;
        let h1: string | null = null;
        let wordCount = 0;
        let internalLinks = 0;
        let externalLinks = 0;
        let discoveredUrls: string[] = [];

        if (ok && fileType === "html" && body) {
          const info = extractPageInfo(body, item.url);
          title = info.title;
          metaDescription = info.metaDescription;
          h1 = info.h1;
          wordCount = info.wordCount;
          internalLinks = info.links.internal.length;
          externalLinks = info.links.externalCount;
          discoveredUrls = info.links.internal;

          // If Cheerio found very few internal links matching our path prefix,
          // the page likely renders links via JavaScript — use browser fallback
          if (pathPrefix) {
            const prefixedLinks = discoveredUrls.filter((l) => {
              try { return new URL(l).pathname.startsWith(pathPrefix); } catch { return false; }
            });
            if (prefixedLinks.length < MIN_LINKS_THRESHOLD) {
              console.log(`[crawler] Few links found via HTML for ${item.url}, trying browser fallback...`);
              const browserLinks = await extractLinksWithBrowser(item.url, baseHost);
              // Merge browser-discovered links with Cheerio links
              const combined = new Set([...discoveredUrls, ...browserLinks]);
              discoveredUrls = [...combined];
              // Update link counts
              internalLinks = discoveredUrls.length;
            }
          } else {
            // For full-site crawls, use browser fallback if very few total internal links found
            if (discoveredUrls.length < MIN_LINKS_THRESHOLD) {
              console.log(`[crawler] Few links found via HTML for ${item.url}, trying browser fallback...`);
              const browserLinks = await extractLinksWithBrowser(item.url, baseHost);
              const combined = new Set([...discoveredUrls, ...browserLinks]);
              discoveredUrls = [...combined];
              internalLinks = discoveredUrls.length;
            }
          }
        }

        const path = new URL(item.url).pathname || "/";

        const node: PageNode = {
          id,
          url: item.url,
          path,
          title,
          statusCode,
          contentType,
          depth: item.depth,
          parentId: item.parentId,
          childIds: [],
          screenshotPath: null,
          screenshotBase64: null,
          fileType,
          metaDescription,
          h1,
          wordCount,
          internalLinks,
          externalLinks,
        };

        pages.push(node);
        processed++;

        // Add parent-child relationship
        if (item.parentId) {
          const parent = pages.find((p) => p.id === item.parentId);
          if (parent && !parent.childIds.includes(id)) {
            parent.childIds.push(id);
          }
        }

        // Queue discovered URLs if within depth
        if (item.depth < maxDepth) {
          for (const link of discoveredUrls) {
            if (visited.has(link)) continue;
            if (pages.length + queue.length >= maxPages) break;

            try {
              const linkUrl = new URL(link);
              const linkHost = linkUrl.hostname;
              if (linkHost !== baseHost && !linkHost.endsWith("." + baseHost)) continue;
              // If crawling a subfolder, only follow links under that path
              if (pathPrefix && !linkUrl.pathname.startsWith(pathPrefix)) continue;
            } catch {
              continue;
            }

            // Skip common non-page resources
            const lowered = link.toLowerCase();
            if (
              lowered.match(/\.(css|js|json|xml|ico|woff|woff2|ttf|eot|zip|gz|tar|mp3|mp4|avi|mov)(\?|$)/)
            ) continue;

            const newId = randomUUID();
            visited.set(link, newId);
            queue.push({ url: link, depth: item.depth + 1, parentId: id });
          }
        }

        onProgress({
          pagesProcessed: processed,
          totalPages: pages.length + queue.length,
          progress: Math.round((processed / Math.max(pages.length + queue.length, 1)) * 50),
        });

        return node;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);
  }

  return pages;
}
