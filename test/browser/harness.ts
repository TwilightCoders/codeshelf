/**
 * Browser test harness — launches headless Chrome on dev.html via puppeteer-core.
 * Provides page object for interaction tests and screenshot utilities.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

function findChrome(): string {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const p of paths) {
    try { execSync(`test -f "${p}"`); return p; } catch { /* skip */ }
  }
  throw new Error('No Chrome/Chromium found. Install Chrome or set CHROME_PATH.');
}

let browser: Browser | null = null;

export async function launchBrowser(): Promise<Browser> {
  if (browser) return browser;
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? findChrome(),
    headless: true,
    args: ['--no-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Opens dev.html and waits for React to render project cards.
 * Returns a page ready for interaction testing.
 */
export async function openDevPage(): Promise<Page> {
  const b = await launchBrowser();
  const page = await b.newPage();
  const devHtml = resolve(PROJECT_ROOT, 'dev.html');
  await page.goto(`file://${devHtml}`, { waitUntil: 'networkidle0' });

  // Wait for React to mount and render cards
  await page.waitForSelector('.project-card', { timeout: 5000 });
  // Let animations settle
  await new Promise(r => setTimeout(r, 300));
  return page;
}

/**
 * Takes a screenshot and saves to test/browser/screenshots/.
 * Returns the absolute path to the saved image.
 */
export async function screenshot(page: Page, name: string): Promise<string> {
  const dir = resolve(PROJECT_ROOT, 'test/browser/screenshots');
  execSync(`mkdir -p "${dir}"`);
  const filePath = resolve(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}
