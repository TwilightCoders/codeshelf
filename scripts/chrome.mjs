/**
 * Shared Chrome/Chromium discovery and puppeteer launch options for the dev
 * screenshot script and the browser test harness.
 */
import { execSync } from 'child_process';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export function findChrome() {
  for (const p of CHROME_PATHS) {
    try { execSync(`test -f "${p}"`); return p; } catch { /* skip */ }
  }
  throw new Error('No Chrome/Chromium found. Install Chrome or set CHROME_PATH.');
}

/** Resolve the Chrome executable, honoring the CHROME_PATH override. */
export function chromeExecutablePath() {
  return process.env.CHROME_PATH ?? findChrome();
}

/** Common puppeteer launch options (1080p, headless, sandbox off for CI). */
export const CHROME_LAUNCH_OPTIONS = {
  headless: true,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
};
