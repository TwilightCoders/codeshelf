#!/usr/bin/env node
/**
 * Takes a screenshot of dev.html using headless Chrome via puppeteer-core.
 * Requires Chrome/Chromium installed on the system.
 *
 * Usage: node scripts/screenshot.mjs [output.png]
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { chromeExecutablePath, CHROME_LAUNCH_OPTIONS } from './chrome.mjs';

const outputPath = process.argv[2] ?? 'screenshot.png';
const devHtml = resolve(import.meta.dirname, '..', 'dev.html');

const browser = await puppeteer.launch({
  executablePath: chromeExecutablePath(),
  ...CHROME_LAUNCH_OPTIONS,
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
