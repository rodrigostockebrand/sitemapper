import * as cheerio from "cheerio";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { randomUUID } from "crypto";
import type { PageNode, CrawlJob } from "@shared/schema";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const FETCH_TIMEOUT = 12000;
// Lowered from 8 → 4 to be a polite citizen and avoid 429 (Too Many Requests)
// from sites with aggressive rate-limiting. 4 in-flight requests per origin
// is well below most WAF thresholds.
const CONCURRENT_LIMIT = 4;
// On 429 we retry with backoff up to this many times before giving up.
// Set to 0 because the browser fallback (real Chrome session) is a much
// better escape hatch from WAF rate-limiters than retrying the same
// fingerprint after a short delay.
const MAX_429_RETRIES = 0;
// Cap the Retry-After we'll honor — anything bigger and we just skip
const MAX_RETRY_AFTER_MS = 8000;
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

async function fetchPageOnce(url: string): Promise<{
  body: string;
  statusCode: number;
  contentType: string;
  ok: boolean;
  retryAfterMs: number | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    // Send browser-like headers — bare {User-Agent} alone is a strong bot
    // signal for WAFs (Cloudflare, Akamai, Imperva) and often triggers 429.
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = getContentType(res.headers);
    let body = "";
    // Read text bodies for HTML *and* XML sitemaps. We sniff content-type and
    // ALSO fall back to URL-path detection because some CDNs return
    // `application/octet-stream` for sitemap.xml.
    const looksLikeXml =
      contentType.includes("xml") || /\.(xml|xml\.gz)(\?|$)/i.test(url) || /sitemap/i.test(url);
    if (contentType.includes("html") || contentType.includes("xhtml") || looksLikeXml) {
      body = await res.text();
    }

    // Parse Retry-After if present (seconds or HTTP-date)
    let retryAfterMs: number | null = null;
    const ra = res.headers.get("retry-after");
    if (ra) {
      const secs = parseInt(ra, 10);
      if (!isNaN(secs)) {
        retryAfterMs = secs * 1000;
      } else {
        const t = Date.parse(ra);
        if (!isNaN(t)) retryAfterMs = Math.max(0, t - Date.now());
      }
    }

    const result = { body, statusCode: res.status, contentType, ok: res.ok, retryAfterMs };

    // Detect bot challenge pages. WAFs commonly return 200 with a tiny
    // HTML page that bootstraps a JS challenge. Patterns covered:
    //   - Imperva / Incapsula (_Incapsula_Resource iframe)
    //   - Cloudflare (cf-chl, cf_chl_, __cf_chl_)
    //   - Akamai (ak-challenge, _abck)
    //   - DataDome (dduser, ddc)
    //   - Generic captcha/verify/access-denied verbiage
    const isChallenged =
      result.ok &&
      result.body.length > 0 &&
      result.body.length < 8000 &&
      /challenge|captcha|verify|blocked|access denied|please wait|incapsula|_incapsula_resource|cf-chl|cf_chl|__cf_chl|cf-ray|ak-challenge|_abck|dduser|datadome/i.test(
        result.body
      );

    if (!result.ok || isChallenged) {
      return { ...result, ok: false };
    }
    return result;
  } catch {
    return { body: "", statusCode: 0, contentType: "error", ok: false, retryAfterMs: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Adaptive throttle — when ANY request sees a 429, this timestamp is bumped
 * forward so all other in-flight requests pause briefly. Slows the whole
 * crawl down rather than letting each request retry independently.
 */
let globalBackoffUntil = 0;

async function waitForGlobalBackoff(): Promise<void> {
  const now = Date.now();
  if (globalBackoffUntil > now) {
    await new Promise((r) => setTimeout(r, globalBackoffUntil - now));
  }
}

/**
 * Fetch with automatic retry on 429 (Too Many Requests). Honors Retry-After up
 * to MAX_RETRY_AFTER_MS, otherwise uses exponential backoff with jitter. On any
 * 429, also bumps the global backoff so other in-flight requests pause too.
 */
async function fetchPage(url: string): Promise<{
  body: string;
  statusCode: number;
  contentType: string;
  ok: boolean;
}> {
  await waitForGlobalBackoff();
  let lastResult = await fetchPageOnce(url);

  // On 429: bump the global backoff so other concurrent requests pause too.
  // We do not retry here — the caller will fall back to the headless browser
  // (real Chrome session) which is a much better escape hatch from WAF rate
  // limiters than retrying the same bare-fetch fingerprint.
  if (lastResult.statusCode === 429) {
    const wait = Math.min(
      lastResult.retryAfterMs ?? 2000 + Math.floor(Math.random() * 500),
      MAX_RETRY_AFTER_MS
    );
    globalBackoffUntil = Math.max(globalBackoffUntil, Date.now() + wait);
    console.log(`[crawler] 429 from ${url} — global backoff ${wait}ms, will try browser`);
  }

  // Optional retry loop kept for future tuning (currently 0 retries)
  for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
    if (lastResult.statusCode !== 429) break;
    const wait = Math.min(
      lastResult.retryAfterMs ?? 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500),
      MAX_RETRY_AFTER_MS
    );
    await new Promise((r) => setTimeout(r, wait));
    lastResult = await fetchPageOnce(url);
  }

  const { body, statusCode, contentType, ok } = lastResult;
  return { body, statusCode, contentType, ok };
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      // Timeout OK — DOM likely loaded
    }

    // Initial settle
    await new Promise((r) => setTimeout(r, 1200));

    // WAF challenge sweep — Imperva / Cloudflare / Akamai serve a tiny
    // bootstrap page that JS-resolves into the real content. If the body
    // still looks like a challenge after the first wait, keep waiting up
    // to 6 seconds for it to clear before giving up.
    const challengeRe =
      /_incapsula_resource|incapsula|cf-chl|cf_chl|__cf_chl|ak-challenge|_abck|dduser|datadome|challenge-platform|cf-mitigated/i;
    for (let i = 0; i < 6; i++) {
      let snippet = "";
      try {
        snippet = (await page.content()).slice(0, 4000);
      } catch {
        break;
      }
      if (!challengeRe.test(snippet) && snippet.length > 1500) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const body = await page.content();
    const stillChallenged = challengeRe.test(body.slice(0, 4000)) && body.length < 5000;
    const ok = responseStatus >= 200 && responseStatus < 400;
    return {
      body,
      statusCode: responseStatus,
      contentType: "text/html",
      ok: !stillChallenged && body.length > 500 ? true : ok,
    };
  } catch (err: any) {
    console.error("[crawler] browser fetch failed:", err.message);
    return { body: "", statusCode: 0, contentType: "error", ok: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Link extraction ─────────────────────────────────────────────

/**
 * Parse XML sitemap (<urlset>) or sitemap index (<sitemapindex>) and return
 * the <loc> URLs as "internal links" so the crawler queues them. Uses cheerio
 * in xmlMode rather than a heavier XML lib — sitemaps are simple enough.
 *
 * Cross-host <loc> entries are still treated as internal because publishers
 * commonly split sitemaps across subdomains (e.g. www -> static.).
 */
function extractSitemapXml(
  xml: string,
  url: string
): {
  title: string;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  links: { internal: string[]; externalCount: number };
} {
  const $ = cheerio.load(xml, { xmlMode: true });
  const baseHost = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const internalLinks: string[] = [];
  let externalCount = 0;

  $("loc").each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    const normalized = normalizeUrl(raw, url);
    if (!normalized) return;
    try {
      const h = new URL(normalized).hostname.replace(/^www\./, "");
      // Same registrable host OR same parent domain (e.g. about.foo.com vs www.foo.com)
      if (h === baseHost || h.endsWith("." + baseHost) || baseHost.endsWith("." + h)) {
        internalLinks.push(normalized);
      } else {
        externalCount++;
      }
    } catch {
      // Skip malformed
    }
  });

  const isIndex = /sitemapindex/i.test(xml.slice(0, 2000));
  const title = isIndex ? `Sitemap index (${internalLinks.length} sitemaps)` : `Sitemap (${internalLinks.length} URLs)`;

  return {
    title,
    metaDescription: null,
    h1: null,
    wordCount: 0,
    links: { internal: [...new Set(internalLinks)], externalCount },
  };
}

function extractPageInfo(
  html: string,
  url: string,
  contentType: string = ""
): {
  title: string;
  metaDescription: string | null;
  h1: string | null;
  wordCount: number;
  links: { internal: string[]; externalCount: number };
} {
  // ── XML sitemap detection ─────────────────────────────────────────────
  // Treat the body as an XML sitemap when any of these are true:
  //   - Content-Type advertises xml
  //   - URL ends in .xml / contains "sitemap"
  //   - Body starts with <?xml or contains <urlset / <sitemapindex
  const isXmlSitemap =
    /xml/i.test(contentType) ||
    /\.(xml|xml\.gz)(\?|$)/i.test(url) ||
    /^[\s\uFEFF]*<\?xml/i.test(html) ||
    /<(urlset|sitemapindex)\b/i.test(html.slice(0, 2000));

  if (isXmlSitemap && html) {
    return extractSitemapXml(html, url);
  }

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
  // If the seed is a sitemap (xml), DO NOT scope the crawl to the seed's
  // directory — the sitemap is just a manifest and discovered URLs live
  // anywhere on the host. Otherwise restrict to the seed subdirectory so
  // a user crawling /blog only gets /blog/* pages.
  const seedIsSitemap = /\.(xml|xml\.gz)(\?|$)/i.test(startUrl) || /sitemap/i.test(basePath);
  const pathPrefix = !seedIsSitemap && basePath !== "/" ? basePath : null;
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

  // ── Auto-seed sitemaps when crawling from a root/homepage ───────────────
  // On WAF-protected enterprise sites, the homepage often serves a JS challenge
  // that blocks link discovery. By seeding /sitemap.xml and /robots.txt's listed
  // sitemaps as depth-0 entries, the crawler gets a clean manifest of URLs in
  // parallel with the homepage crawl. Best-effort — failures are silent.
  if (!seedIsSitemap && basePath === "/") {
    try {
      const sitemapCandidates = new Set<string>([
        `${baseUrl.origin}/sitemap.xml`,
        `${baseUrl.origin}/sitemap_index.xml`,
        `${baseUrl.origin}/sitemap-index.xml`,
      ]);

      // Try to discover additional sitemaps from robots.txt
      try {
        const robotsRes = await fetch(`${baseUrl.origin}/robots.txt`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(5000),
        });
        if (robotsRes.ok) {
          const robotsTxt = await robotsRes.text();
          for (const m of robotsTxt.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
            sitemapCandidates.add(m[1].trim());
          }
        }
      } catch {
        // robots.txt fetch failed — fall back to the standard locations above
      }

      for (const sitemapUrl of sitemapCandidates) {
        const normalized = normalizeUrl(sitemapUrl, sitemapUrl);
        if (!normalized || visited.has(normalized)) continue;
        const sitemapId = randomUUID();
        visited.set(normalized, sitemapId);
        queue.push({ url: normalized, depth: 0, parentId: null });
      }
    } catch {
      // Sitemap seeding is best-effort — swallow errors
    }
  }

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

              // If HTTP fetch failed (403, 429, challenged, etc.), try browser
              // fallback. Many WAFs return 429 specifically to bare-fetch
              // fingerprints — a real Chrome session with cookies and JS often
              // gets through (different TLS fingerprint, real navigator, etc.).
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

          // Also run link extraction for XML sitemaps so <loc> URLs get queued.
          const isSitemapXml =
            !!body &&
            (/xml/i.test(contentType) ||
              /\.(xml|xml\.gz)(\?|$)/i.test(item.url) ||
              /^[\s\uFEFF]*<\?xml/i.test(body) ||
              /<(urlset|sitemapindex)\b/i.test(body.slice(0, 2000)));

          if (ok && body && (fileType === "html" || isSitemapXml)) {
            const info = extractPageInfo(body, item.url, contentType);
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
              // Skip static assets. We do NOT exclude .xml here because nested
              // sitemaps (sitemapindex → sub-sitemap.xml) need to be followed.
              if (
                lowered.match(
                  /\.(css|js|json|ico|woff|woff2|ttf|eot|zip|gz|tar|mp3|mp4|avi|mov)(\?|$)/
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

  // Hard cap — parallel batches can race past the soft maxPages guard. Trim
  // any overshoot so the page count never exceeds the user's tier limit.
  // Also drop any orphan childIds that point to trimmed pages.
  if (pages.length > maxPages) {
    const keptIds = new Set(pages.slice(0, maxPages).map((p) => p.id));
    const trimmed = pages.slice(0, maxPages);
    for (const p of trimmed) {
      p.childIds = p.childIds.filter((c) => keptIds.has(c));
    }
    return trimmed;
  }

  return pages;
}
