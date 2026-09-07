#!/usr/bin/env node
/**
 * Render a candidate stylesheet against the REAL scanned library.
 *   node scripts/theme-preview.mjs <theme.css> <out.png> [--light]
 * Swaps out media/styles/main.css in dev.html, keeps the codicon font and the
 * VS Code theme-variable block, then injects real shelves via the mock host.
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { chromeExecutablePath, CHROME_LAUNCH_OPTIONS } from './chrome.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const light = args.includes('--light');
const [cssPath, outPath] = args.filter(a => !a.startsWith('--'));
if (!cssPath || !outPath) { console.error('usage: theme-preview.mjs <theme.css> <out.png>'); process.exit(1); }
const css = readFileSync(cssPath, 'utf8');

const scanner = require(resolve(import.meta.dirname, '..', 'out/services/projectScanner.js'));
const shelves = await scanner.scanRoots({
  '/Users/alex/code': {},
  '/Users/alex/Workspace': { label: '🔨 Workspace', shelves: { Archive: { hidden: true }, Legacy: { hidden: true } } },
}, 3);

const browser = await puppeteer.launch({ executablePath: chromeExecutablePath(), ...CHROME_LAUNCH_OPTIONS });
const page = await browser.newPage();
await page.setViewport({ width: 1760, height: 1250, deviceScaleFactor: 1 });
await page.goto('file://' + resolve(import.meta.dirname, '..', 'dev.html') + (light ? '?light' : ''), { waitUntil: 'networkidle0' });
// Real VS Code sets its theme variables on the document ROOT. dev.html's mock
// puts the light set on `body.vscode-light`, which breaks any theme that aliases
// tokens in `:root` (the alias snapshots the dark value). Apply them at :root.
if (light) {
  await page.addStyleTag({ content: readFileSync('/tmp/light-root.css', 'utf8') });
}
// Drop the shipped stylesheet, install the candidate.
await page.evaluate(() => {
  document.querySelectorAll('link[rel=stylesheet]').forEach(l => { if (l.href.includes('main.css')) l.remove(); });
});
await page.addStyleTag({ content: css });
await new Promise(r => setTimeout(r, 300));
await page.evaluate(s => window.__mockHost.injectShelves(s), JSON.parse(JSON.stringify(shelves)));
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: outPath });
const unstyled = await page.evaluate(() => {
  // crude sanity check: any element whose computed background AND color are both initial
  const cards = document.querySelectorAll('.project-card').length;
  const shelvesN = document.querySelectorAll('.shelf-row').length;
  return { cards, shelves: shelvesN, bodyBg: getComputedStyle(document.body).backgroundColor };
});
console.log(JSON.stringify(unstyled));
await browser.close();
