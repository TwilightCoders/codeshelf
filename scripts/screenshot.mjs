#!/usr/bin/env node
/**
 * Takes a screenshot of dev.html using headless Chrome via puppeteer-core.
 * Requires Chrome/Chromium installed on the system.
 *
 * Usage: node scripts/screenshot.mjs [output.png]
 */
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import { resolve } from 'path';

// Find Chrome on macOS
function findChrome() {
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

const chromePath = process.env.CHROME_PATH ?? findChrome();
const outputPath = process.argv[2] ?? 'screenshot.png';
const devHtml = resolve(import.meta.dirname, '..', 'dev.html');

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
});

const page = await browser.newPage();
await page.goto(`file://${devHtml}`, { waitUntil: 'networkidle0' });

// Wait for React to render
await page.waitForSelector('.project-card', { timeout: 5000 }).catch(() => {
  console.log('Warning: no project cards found, taking screenshot anyway');
});

// Small delay for animations to settle
await new Promise(r => setTimeout(r, 500));

await page.screenshot({ path: outputPath, fullPage: true });
console.log(`Screenshot saved to ${outputPath}`);

await browser.close();
