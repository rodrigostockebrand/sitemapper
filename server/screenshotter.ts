import puppeteer from "puppeteer-core";
import type { PageNode } from "@shared/schema";

const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const NAV_TIMEOUT = 30000;
const CONCURRENT_SCREENSHOTS = 2;

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

    // Process in batches
    for (let i = 0; i < screenshottable.length; i += CONCURRENT_SCREENSHOTS) {
      const batch = screenshottable.slice(i, i + CONCURRENT_SCREENSHOTS);

      await Promise.all(
        batch.map(async (pageNode) => {
          let page;
          try {
            page = await browser!.newPage();
            await page.setViewport({
              width: SCREENSHOT_WIDTH,
              height: SCREENSHOT_HEIGHT,
            });

            // Try networkidle0 first (waits for all network activity to settle),
            // fall back to domcontentloaded if the page keeps making requests
            try {
              await page.goto(pageNode.url, {
                waitUntil: "networkidle0",
                timeout: NAV_TIMEOUT,
              });
            } catch {
              // If networkidle0 times out (page keeps polling), that's ok —
              // the page is probably rendered enough by now
            }

            // Extra wait for JS frameworks to finish rendering
            await new Promise((r) => setTimeout(r, 2500));

            const screenshotBuffer = await page.screenshot({
              type: "jpeg",
              quality: 70,
              encoding: "base64",
            });

            pageNode.screenshotBase64 = screenshotBuffer as string;

            processed++;
            onProgress(processed);
          } catch (err) {
            // Skip screenshot failures silently
            processed++;
            onProgress(processed);
          } finally {
            if (page) await page.close().catch(() => {});
          }
        })
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return pages;
}
