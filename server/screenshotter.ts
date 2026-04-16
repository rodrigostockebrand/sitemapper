import puppeteer from "puppeteer-core";
import type { PageNode } from "@shared/schema";

const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const DEVICE_SCALE_FACTOR = 2;
const NAV_TIMEOUT = 15000;
const PAGE_TIMEOUT = 30000; // Hard per-page timeout — kill and move on
const CONCURRENT_SCREENSHOTS = 4;
const MAX_RETRIES = 1; // Keep retries low to avoid compounding hangs

// Realistic Chrome user agent (non-headless)
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Race a promise against a hard timeout. Rejects on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

export async function takeScreenshots(
  pages: PageNode[],
  onProgress: (screenshotsProcessed: number) => void
): Promise<PageNode[]> {
  // Only screenshot HTML pages with successful status codes
  const screenshottable = pages.filter(
    (p) => p.fileType === "html" && p.statusCode >= 200 && p.statusCode < 400
  );

  if (screenshottable.length === 0) return pages;

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
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=TranslateUI",
        "--js-flags=--max-old-space-size=512",
        // Stealth flags to avoid bot detection
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,800",
      ],
    });

    let processed = 0;

    async function captureOne(
      pageNode: PageNode,
      attempt: number = 0
    ): Promise<void> {
      let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;

      // Wrap the ENTIRE capture in a hard timeout
      try {
        await withTimeout(
          (async () => {
            page = await browser!.newPage();

            // Spoof user agent and remove headless markers
            await page.setUserAgent(USER_AGENT);
            await page.setViewport({
              width: SCREENSHOT_WIDTH,
              height: SCREENSHOT_HEIGHT,
              deviceScaleFactor: DEVICE_SCALE_FACTOR,
            });

            // Override webdriver/automation detection properties
            await page.evaluateOnNewDocument(() => {
              Object.defineProperty(navigator, "webdriver", {
                get: () => false,
              });
              Object.defineProperty(navigator, "plugins", {
                get: () => [1, 2, 3, 4, 5],
              });
              Object.defineProperty(navigator, "languages", {
                get: () => ["en-US", "en"],
              });
              (window as any).chrome = { runtime: {} };
              const originalQuery = window.navigator.permissions.query;
              window.navigator.permissions.query = (parameters: any) =>
                parameters.name === "notifications"
                  ? Promise.resolve({
                      state: Notification.permission,
                    } as PermissionStatus)
                  : originalQuery(parameters);
            });

            // Block heavy media to speed things up
            await page.setRequestInterception(true);
            page.on("request", (req) => {
              const type = req.resourceType();
              if (type === "media" || type === "websocket") {
                req.abort();
              } else {
                req.continue();
              }
            });

            // Navigate — use domcontentloaded as primary, it's faster and
            // won't hang on sites with persistent connections
            try {
              await page.goto(pageNode.url, {
                waitUntil: "domcontentloaded",
                timeout: NAV_TIMEOUT,
              });
            } catch {
              // Timeout is ok — DOM likely loaded, just has slow sub-resources
            }

            // Brief wait for JS to hydrate and render visible content
            await new Promise((r) => setTimeout(r, 1200));

            // Try to dismiss common cookie/consent banners (best-effort, with its own timeout)
            try {
              await withTimeout(
                page.evaluate(() => {
                  const selectors = [
                    '[id*="cookie"] button',
                    '[class*="cookie"] button',
                    '[id*="consent"] button',
                    '[class*="consent"] button',
                    '[id*="onetrust"] button#onetrust-accept-btn-handler',
                    '[class*="onetrust"] button',
                    'button[aria-label*="accept"]',
                    'button[aria-label*="Accept"]',
                    'button[aria-label*="agree"]',
                    'button[aria-label*="Agree"]',
                    '[id*="gdpr"] button',
                    '[class*="gdpr"] button',
                    '[data-testid*="cookie"] button',
                    '[data-testid*="accept"]',
                    'button[title*="Accept"]',
                    '.cc-btn.cc-dismiss',
                    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                  ];
                  for (const sel of selectors) {
                    const btn = document.querySelector<HTMLElement>(sel);
                    if (btn && btn.offsetParent !== null) {
                      btn.click();
                      break;
                    }
                  }
                  const overlaySelectors = [
                    '[id*="cookie-banner"]',
                    '[class*="cookie-banner"]',
                    '[id*="cookie-consent"]',
                    '[class*="cookie-consent"]',
                    '[id*="onetrust-banner"]',
                    '[class*="onetrust-banner"]',
                    '[id*="consent-banner"]',
                    '[class*="consent-modal"]',
                    '[class*="privacy-banner"]',
                  ];
                  for (const sel of overlaySelectors) {
                    const el = document.querySelector<HTMLElement>(sel);
                    if (el) el.remove();
                  }
                }),
                3000,
                "consent dismissal"
              );
            } catch {
              // Best-effort
            }

            // Quick scroll to trigger lazy content
            try {
              await withTimeout(
                (async () => {
                  await page!.evaluate(() => window.scrollTo(0, 300));
                  await new Promise((r) => setTimeout(r, 400));
                  await page!.evaluate(() => window.scrollTo(0, 0));
                  await new Promise((r) => setTimeout(r, 200));
                })(),
                2000,
                "scroll"
              );
            } catch {
              // Best-effort
            }

            const screenshotBuffer = await page.screenshot({
              type: "webp",
              quality: 85,
              encoding: "base64",
            });

            const b64 = screenshotBuffer as string;

            // Check if screenshot is blank — retry once if so
            if (b64.length < 5000 && attempt < MAX_RETRIES) {
              await page.close().catch(() => {});
              page = undefined;
              await new Promise((r) => setTimeout(r, 1000));
              return captureOne(pageNode, attempt + 1);
            }

            pageNode.screenshotBase64 = b64;
          })(),
          PAGE_TIMEOUT,
          `screenshot ${pageNode.url}`
        );

        processed++;
        onProgress(processed);
      } catch (err) {
        // Hard timeout or other error — close page and move on
        if (page) {
          await page.close().catch(() => {});
          page = undefined;
        }

        if (attempt < MAX_RETRIES) {
          return captureOne(pageNode, attempt + 1);
        }

        // Exhausted retries — skip this page
        processed++;
        onProgress(processed);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }

    // Process in batches
    for (let i = 0; i < screenshottable.length; i += CONCURRENT_SCREENSHOTS) {
      const batch = screenshottable.slice(i, i + CONCURRENT_SCREENSHOTS);
      await Promise.all(batch.map((pageNode) => captureOne(pageNode)));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return pages;
}
