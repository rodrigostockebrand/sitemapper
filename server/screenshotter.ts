import puppeteer from "puppeteer-core";
import type { PageNode } from "@shared/schema";

const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const NAV_TIMEOUT = 15000;
const CONCURRENT_SCREENSHOTS = 5;
const MAX_RETRIES = 2;

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
        "--js-flags=--max-old-space-size=256",
        "--single-process",
        "--disable-features=TranslateUI",
      ],
    });

    let processed = 0;

    async function captureOne(pageNode: PageNode, attempt: number = 0): Promise<void> {
      let page;
      try {
        page = await browser!.newPage();
        await page.setViewport({
          width: SCREENSHOT_WIDTH,
          height: SCREENSHOT_HEIGHT,
        });

        // Block heavy resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (['font', 'media'].includes(type)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Try networkidle2 (allows 2 open connections) — faster than networkidle0
        try {
          await page.goto(pageNode.url, {
            waitUntil: "networkidle2",
            timeout: NAV_TIMEOUT,
          });
        } catch {
          // If networkidle2 times out, try domcontentloaded as fallback
          try {
            await page.goto(pageNode.url, {
              waitUntil: "domcontentloaded",
              timeout: NAV_TIMEOUT,
            });
          } catch {
            // Page is likely rendered enough at this point
          }
        }

        // Short wait for JS rendering
        await new Promise((r) => setTimeout(r, 800));

        const screenshotBuffer = await page.screenshot({
          type: "jpeg",
          quality: 70,
          encoding: "base64",
        });

        pageNode.screenshotBase64 = screenshotBuffer as string;

        processed++;
        onProgress(processed);
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          if (page) await page.close().catch(() => {});
          return captureOne(pageNode, attempt + 1);
        }
        // Exhausted retries — skip
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
