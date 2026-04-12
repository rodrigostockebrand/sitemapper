import puppeteer from "puppeteer-core";
import type { PageNode } from "@shared/schema";

const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const NAV_TIMEOUT = 20000;
const CONCURRENT_SCREENSHOTS = 4;
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
        "--disable-features=TranslateUI",
        "--js-flags=--max-old-space-size=512",
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

        // Block heavy media to speed things up, but keep fonts/images/stylesheets
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (type === 'media') {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Navigate with networkidle2 (allows 2 inflight requests)
        try {
          await page.goto(pageNode.url, {
            waitUntil: "networkidle2",
            timeout: NAV_TIMEOUT,
          });
        } catch {
          // Timeout is ok — page likely rendered, just has lingering requests
        }

        // Extra wait for JS frameworks to hydrate and render
        await new Promise((r) => setTimeout(r, 1200));

        const screenshotBuffer = await page.screenshot({
          type: "jpeg",
          quality: 72,
          encoding: "base64",
        });

        pageNode.screenshotBase64 = screenshotBuffer as string;

        processed++;
        onProgress(processed);
      } catch (err) {
        // Close this page before retrying
        if (page) {
          await page.close().catch(() => {});
          page = undefined;
        }
        if (attempt < MAX_RETRIES) {
          // Small backoff before retry
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
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
