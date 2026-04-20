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

            // Pre-set common consent cookies BEFORE navigation
            // This prevents consent modals from appearing at all
            const domain = new URL(pageNode.url).hostname;
            const baseDomain = domain.replace(/^www\./, "");
            try {
              await page.setCookie(
                // OneTrust
                { name: "OptanonConsent", value: "isGpcEnabled=0&datestamp=" + encodeURIComponent(new Date().toISOString()) + "&version=202409.2.0&isIABGlobal=false&hosts=&consentId=00000000-0000-0000-0000-000000000000&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&geolocation=US%3BCA", domain: "." + baseDomain, path: "/" },
                { name: "OptanonAlertBoxClosed", value: new Date().toISOString(), domain: "." + baseDomain, path: "/" },
                // CookieBot
                { name: "CookieConsent", value: "{stamp:%27-1%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1%2Cutc:" + Date.now() + "%2Cregion:%27us%27}", domain: "." + baseDomain, path: "/" },
                // Generic cookie consent flags
                { name: "cookie_consent", value: "accepted", domain: "." + baseDomain, path: "/" },
                { name: "cookies_accepted", value: "true", domain: "." + baseDomain, path: "/" },
                { name: "gdpr_consent", value: "1", domain: "." + baseDomain, path: "/" },
                { name: "cookie-agreed", value: "2", domain: "." + baseDomain, path: "/" },
                { name: "cookieconsent_status", value: "dismiss", domain: "." + baseDomain, path: "/" },
                { name: "cc_cookie", value: '{"categories":["necessary","analytics","targeting"]}', domain: "." + baseDomain, path: "/" },
              );
            } catch {
              // Cookie setting is best-effort
            }

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

            // Layer 1: Try to click common accept/dismiss buttons
            try {
              await withTimeout(
                page.evaluate(() => {
                  // Find buttons by text content (most reliable)
                  const acceptTexts = [
                    "accept all", "accept cookies", "allow all", "allow cookies",
                    "i agree", "i accept", "agree", "got it", "ok", "okay",
                    "continue", "dismiss", "close", "accept & close",
                    "accept and close", "accept recommended",
                  ];
                  const allButtons = Array.from(document.querySelectorAll<HTMLElement>(
                    "button, a[role=button], [role=button], .btn, [class*=btn]"
                  ));
                  for (const btn of allButtons) {
                    const text = btn.textContent?.trim().toLowerCase() || "";
                    if (acceptTexts.some((t) => text === t || text.startsWith(t))) {
                      btn.click();
                      return; // Found and clicked
                    }
                  }

                  // Fallback: try specific selectors
                  const selectors = [
                    "#onetrust-accept-btn-handler",
                    "#accept-recommended-btn-handler",
                    ".onetrust-close-btn-handler",
                    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
                    "#CybotCookiebotDialogBodyButtonAccept",
                    ".cc-btn.cc-dismiss",
                    ".cc-accept",
                    "[data-testid=cookie-accept]",
                    "[data-testid=accept-cookies]",
                    'button[aria-label*="ccept"]',
                    'button[aria-label*="gree"]',
                    'button[title*="ccept"]',
                  ];
                  for (const sel of selectors) {
                    const btn = document.querySelector<HTMLElement>(sel);
                    if (btn) {
                      btn.click();
                      return;
                    }
                  }
                }),
                2000,
                "consent click"
              );
            } catch {
              // Best-effort
            }

            // Small wait for consent modal to animate away
            await new Promise((r) => setTimeout(r, 500));

            // Layer 2: Nuclear — remove ANY fixed/sticky overlay covering the viewport
            try {
              await withTimeout(
                page.evaluate(() => {
                  const vw = window.innerWidth;
                  const vh = window.innerHeight;
                  const threshold = 0.3; // covers >30% of viewport

                  // Remove known consent frameworks by selector
                  const knownOverlays = [
                    "#onetrust-consent-sdk", "#onetrust-banner-sdk",
                    "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay",
                    "[class*=cookie-banner]", "[class*=cookie-consent]",
                    "[class*=cookieBanner]", "[class*=cookieConsent]",
                    "[class*=consent-banner]", "[class*=consent-modal]",
                    "[class*=privacy-banner]", "[class*=gdpr]",
                    "[id*=cookie-banner]", "[id*=cookie-consent]",
                    "[id*=consent-banner]", "[id*=gdpr]",
                    ".truste_box_overlay", "#truste-consent-track",
                    "[class*=evidon]", "#_evidon_banner",
                  ];
                  for (const sel of knownOverlays) {
                    document.querySelectorAll(sel).forEach((el) => el.remove());
                  }

                  // Find and remove any large fixed/sticky overlays
                  const allElements = document.querySelectorAll("*");
                  for (const el of allElements) {
                    const style = window.getComputedStyle(el);
                    const pos = style.position;
                    if (pos !== "fixed" && pos !== "sticky") continue;

                    const rect = (el as HTMLElement).getBoundingClientRect();
                    const coverageX = rect.width / vw;
                    const coverageY = rect.height / vh;

                    // Remove if it covers a significant portion of the viewport
                    if (coverageX * coverageY > threshold) {
                      (el as HTMLElement).remove();
                      continue;
                    }

                    // Also remove backdrop/overlay elements (dark semi-transparent backgrounds)
                    const bg = style.backgroundColor;
                    const opacity = parseFloat(style.opacity);
                    if (
                      coverageX > 0.8 && coverageY > 0.8 &&
                      (bg.includes("rgba") || opacity < 0.95)
                    ) {
                      (el as HTMLElement).remove();
                    }
                  }

                  // Reset any body overflow locks that consent modals set
                  document.body.style.overflow = "";
                  document.body.style.position = "";
                  document.documentElement.style.overflow = "";
                  document.documentElement.style.position = "";
                }),
                3000,
                "overlay removal"
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
