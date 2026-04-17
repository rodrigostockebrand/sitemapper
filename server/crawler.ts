import * as cheerio from "cheerio";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { randomUUID } from "crypto";
import type { PageNode, CrawlJob } from "@shared/schema";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const FETCH_TIMEOUT = 12000;
const CONCURRENT_LIMIT = 8;
// Only use browser fallback for link extraction on pages at depth ≤ 1
const BROWSER_LINK_MAX_DEPTH = 1;
const MIN_LINKS_THRESHOLD = 3;

function normalizeUrl(urlStr: string, baseUrl: string): string | null {
  try {
    const u = new URL(urlStr, baseUrl);
    u.hash = "";
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
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
}

function getContentType(headers: Headers): string {
  return (headers.get("content-type") || "text/html").split(";")[0].trim().toLowerCase();
}

function getFileType(contentType: string, url: string): PageNode["fileType"] {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("image")) return "image";
  if (contentType.includes("html") || contentType.includes("xhtml")) return "html";
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "")) return "image";
  return "other";
}

/**
 * Shared browser pool — reuses a single Chrome instance across all crawler
 * operations instead of launching a new one per page.
 */
class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-blink-features=AutomationControlled",
        "--js-flags=--max-old-space-size=512",
      ],
    });

    this.browser = await this.launching;
    this.launching = null;
    return this.browser;
  }

  async newPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    // Override webdriver detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      (window as any).chrome = { runtime: {} };
    });

    return page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

/** Race a promise against a hard timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

// ── HTTP fetch (fast path) ──────────────────────────────────────

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
    const result = { body, statusCode: res.status, contentType, ok: res.ok };

    // Detect bot challenge pages
    const isChallenged =
      result.ok &&
      result.body.length > 0 &&
      result.body.length < 5000 &&
      /challenge|captcha|verify|blocked|dduser|access denied|please wait/i.test(result.body);

    if (!result.ok || isChallenged) {
      return { body: result.body, statusCode: result.statusCode, contentType, ok: false };
    }

    return result;
  } catch {
    return { body: "", statusCode: 0, contentType: "error", ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Browser fetch (fallback for bot-protected sites) ────────────

async function fetchPageWithBrowser(
  pool: BrowserPool,
  url: string
): Promise<{
  body: string;
  statusCode: number;
  contentType: string;
  ok: boolean;
}> {
  let page: Page | undefined;
  try {
    page = await pool.newPage();
    let responseStatus = 200;
    page.on("response", (res) => {
      if (res.url() === url || res.url().startsWith(url.replace(/\/$/, ""))) {
        responseStatus = res.status();
      }
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    } catch {
      // Timeout OK — DOM likely loaded
    }

    await new Promise((r) => setTimeout(r, 800));

    const body = await page.content();
    const ok = responseStatus >= 200 && responseStatus < 400;
    return {
      body,
      statusCode: responseStatus,
      contentType: "text/html",
      ok: body.length > 500 ? true : ok,
    };
  } catch (err: any) {
    console.error("[crawler] browser fetch failed:", err.message);
    return { body: "", statusCode: 0, contentType: "error", ok: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Link extraction ─────────────────────────────────────────────

function extractPageInfo(
  html: string,
  url: string
): {
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

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  const baseHost = new URL(url).hostname;
  const internalLinks: string[] = [];
  let externalCount = 0;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    )
      return;

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

  return {
    title,
    metaDescription,
    h1,
    wordCount,
    links: { internal: [...new Set(internalLinks)], externalCount },
  };
}

async function extractLinksWithBrowser(
  pool: BrowserPool,
  url: string,
  baseHost: string
): Promise<string[]> {
  let page: Page | undefined;
  try {
    page = await pool.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    } catch {
      // Timeout OK
    }

    await new Promise((r) => setTimeout(r, 1000));

    const links: string[] = await page.evaluate((bHost: string) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const results: string[] = [];
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (
          !href ||
          href.startsWith("#") ||
          href.startsWith("javascript:") ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:")
        )
          continue;
        try {
          const u = new URL(href, window.location.origin);
          if (u.hostname === bHost || u.hostname.endsWith("." + bHost)) {
            results.push(u.href);
          }
        } catch {}
      }
      return results;
    }, baseHost);

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
    console.error("[crawler] browser link extraction failed:", err);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Semaphore for concurrency ───────────────────────────────────

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

// ── Main crawl function ─────────────────────────────────────────

export async function crawlSite(
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  onProgress: (job: Partial<CrawlJob>) => void
): Promise<PageNode[]> {
  const baseUrl = new URL(startUrl);
  const baseHost = baseUrl.hostname;
  let basePath = baseUrl.pathname;
  if (basePath.length > 1 && basePath.endsWith("/")) {
    basePath = basePath.slice(0, -1);
  }
  const pathPrefix = basePath !== "/" ? basePath : null;
  const visited = new Map<string, string>(); // url -> id
  const pages: PageNode[] = [];
  const queue: { url: string; depth: number; parentId: string | null }[] = [];
  const semaphore = new Semaphore(CONCURRENT_LIMIT);

  // Shared browser pool — one Chrome instance reused for all fallbacks
  const pool = new BrowserPool();
  // Track whether this site needs browser rendering (detected on first page)
  let siteNeedsBrowser = false;

  const normalizedStart = normalizeUrl(startUrl, startUrl)!;
  const startId = randomUUID();
  visited.set(normalizedStart, startId);
  queue.push({ url: normalizedStart, depth: 0, parentId: null });

  let processed = 0;

  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const batch = queue.splice(0, Math.min(CONCURRENT_LIMIT, maxPages - pages.length));

      const promises = batch.map(async (item) => {
        await semaphore.acquire();
        try {
          const id = visited.get(item.url) || randomUUID();

          // Fetch the page — try HTTP first, fall back to browser on failure
          let result: { body: string; statusCode: number; contentType: string; ok: boolean };

          try {
            if (siteNeedsBrowser) {
              // Site already known to need browser — skip HTTP entirely
              result = await withTimeout(fetchPageWithBrowser(pool, item.url), 20000);
            } else {
              result = await withTimeout(fetchPage(item.url), FETCH_TIMEOUT + 2000);

              // If HTTP fetch failed (403, challenged, etc.), try browser fallback
              if (!result.ok) {
                console.log(`[crawler] HTTP failed (${result.statusCode}) for ${item.url}, trying browser...`);
                result = await withTimeout(fetchPageWithBrowser(pool, item.url), 20000);

                // If browser worked, mark site as needing browser for all future pages
                if (result.ok) {
                  siteNeedsBrowser = true;
                  console.log(`[crawler] Browser succeeded — switching to browser mode for all pages`);
                }
              }
            }
          } catch {
            // Hard timeout — skip this page
            result = { body: "", statusCode: 0, contentType: "error", ok: false };
          }

          const { body, statusCode, contentType, ok } = result;
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

            // Browser link fallback — only for shallow pages where discovery matters
            if (item.depth <= BROWSER_LINK_MAX_DEPTH) {
              const needsBrowserLinks = pathPrefix
                ? discoveredUrls.filter((l) => {
                    try {
                      return new URL(l).pathname.startsWith(pathPrefix);
                    } catch {
                      return false;
                    }
                  }).length < MIN_LINKS_THRESHOLD
                : discoveredUrls.length < MIN_LINKS_THRESHOLD;

              if (needsBrowserLinks) {
                try {
                  console.log(`[crawler] Few links at depth ${item.depth}, browser fallback for ${item.url}`);
                  const browserLinks = await withTimeout(
                    extractLinksWithBrowser(pool, item.url, baseHost),
                    15000
                  );
                  const combined = new Set([...discoveredUrls, ...browserLinks]);
                  discoveredUrls = [...combined];
                  internalLinks = discoveredUrls.length;
                } catch {
                  // Browser link extraction timed out — use what we have
                }
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

          if (item.parentId) {
            const parent = pages.find((p) => p.id === item.parentId);
            if (parent && !parent.childIds.includes(id)) {
              parent.childIds.push(id);
            }
          }

          if (item.depth < maxDepth) {
            for (const link of discoveredUrls) {
              if (visited.has(link)) continue;
              if (pages.length + queue.length >= maxPages) break;

              try {
                const linkUrl = new URL(link);
                const linkHost = linkUrl.hostname;
                if (linkHost !== baseHost && !linkHost.endsWith("." + baseHost)) continue;
                if (pathPrefix && !linkUrl.pathname.startsWith(pathPrefix)) continue;
              } catch {
                continue;
              }

              const lowered = link.toLowerCase();
              if (
                lowered.match(
                  /\.(css|js|json|xml|ico|woff|woff2|ttf|eot|zip|gz|tar|mp3|mp4|avi|mov)(\?|$)/
                )
              )
                continue;

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
  } finally {
    // Always close the shared browser
    await pool.close();
  }

  return pages;
}
