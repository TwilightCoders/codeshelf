#!/usr/bin/env node
/**
 * Marketplace screenshots, rendered from a SYNTHETIC library.
 * Deliberately not the author's real projects — a public listing shouldn't
 * publish someone's private project inventory.
 *   node scripts/demo-shots.mjs
 */
import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { chromeExecutablePath, CHROME_LAUNCH_OPTIONS } from './chrome.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const ago = d => Date.now() - d * DAY;
const p = (name, lang, days, extra = {}) => ({
  name, path: `/home/dev/code/${name}`, markers: ['.git'],
  primaryLanguage: lang, gitBranch: 'main', lastModified: ago(days), ...extra,
});

const shelves = [
  { name: 'Apps', path: '/home/dev/code/apps', rootLabel: 'code', rootPath: '/home/dev/code', items: [
    { kind: 'project', project: p('aurora-api', 'go', 0.12, { gitBranch: 'fix/rate-limit', tags: ['gateway', 'auth', 'graphql'], starred: true,
      description: 'GraphQL gateway and auth service.',
      worktrees: [{ name: 'wt', path: '/w/a', gitBranch: 'spike/tracing', lastModified: ago(2) }] }) },
    { kind: 'project', project: p('starlight-web', 'javascript', 0.04, { tags: ['dashboard', 'vite', 'spa'],
      description: 'Customer dashboard SPA.', workspaceFile: '/home/dev/code/apps/starlight-web/app.code-workspace' }) },
    { kind: 'project', project: p('pulse-ios', 'swift', 14, { tags: ['health', 'sensor', 'chart'] }) },
    { kind: 'project', project: p('ledger-etl', 'python', 21, { tags: ['ingest', 'ledger', 'airflow'] }) },
  ]},
  { name: 'Gems', path: '/home/dev/code/gems', rootLabel: 'code', rootPath: '/home/dev/code', items: [
    { kind: 'project', project: p('invoicer', 'ruby', 1, { starred: true, tags: ['billing', 'pdf', 'invoice'] }) },
    { kind: 'project', project: p('semver-bump', 'ruby', 42, { tags: ['release', 'version', 'tag'] }) },
    { kind: 'project', project: p('retry-rb', 'ruby', 150, { tags: ['backoff', 'jitter', 'retry'] }) },
    { kind: 'project', project: p('cartograph', 'ruby', 9, { tags: ['geo', 'tile', 'projection'] }) },
    { kind: 'project', project: p('ascii-tables', 'ruby', 480, { tags: ['table', 'render', 'ascii'] }) },
    { kind: 'project', project: p('scope-registry', 'ruby', 220, { tags: ['scope', 'registry'] }) },
  ]},
  { name: 'Infra', path: '/home/dev/code/infra', rootLabel: 'code', rootPath: '/home/dev/code', items: [
    { kind: 'project', project: p('nimbus-platform', undefined, 2, { tags: ['terraform', 'cluster'], subProjectCount: 5,
      description: 'Multi-service platform monorepo.' }) },
    { kind: 'project', project: p('dns-proxy', 'go', 190, { tags: ['dns', 'cache'] }) },
    { kind: 'project', project: p('vault-sync', 'go', 95, { tags: ['secrets', 'sync'] }) },
  ]},
  { name: 'Sketches', path: '/home/dev/code/sketches', rootLabel: 'code', rootPath: '/home/dev/code', items: [
    { kind: 'project', project: p('raytracer-weekend', 'cpp', 16, { tags: ['bvh', 'shader'] }) },
    { kind: 'project', project: p('tetris-canvas', 'javascript', 400, { tags: ['canvas', 'tetromino'] }) },
  ]},
  { name: 'Archive', path: '/home/dev/code/archive', rootLabel: 'code', rootPath: '/home/dev/code', items: [
    { kind: 'bookset', name: 'legacy-crm', path: '/home/dev/code/archive/legacy-crm', projects: [
      p('crm-web', 'javascript', 700), p('crm-api', 'ruby', 720), p('crm-jobs', 'ruby', 760),
      p('crm-admin', 'javascript', 800), p('crm-reports', 'python', 900),
    ]},
    { kind: 'project', project: p('old-blog', undefined, 980, { tags: ['markdown', 'static'] }) },
  ]},
];

const browser = await puppeteer.launch({ executablePath: chromeExecutablePath(), ...CHROME_LAUNCH_OPTIONS });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('file://' + resolve(import.meta.dirname, '..', 'dev.html'), { waitUntil: 'networkidle0' });
await page.evaluate(() => document.querySelectorAll('link[rel=stylesheet]').forEach(l => { if (l.href.includes('main.css')) l.remove(); }));
await page.addStyleTag({ content: readFileSync(resolve(import.meta.dirname, '..', 'media/styles/main.css'), 'utf8') });
await page.evaluate(s => window.__mockHost.injectShelves(s), shelves);
await new Promise(r => setTimeout(r, 1400));

const out = n => resolve(import.meta.dirname, '..', 'media/screenshots', n);
const shot = async (name, h = 760) => {
  await page.setViewport({ width: 1440, height: h, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: out(name) });
  console.log('  ' + name);
};
const view = async label => {
  await page.evaluate(l => Array.from(document.querySelectorAll('.view-switch-btn')).find(b => b.textContent === l)?.click(), label);
  await new Promise(r => setTimeout(r, 700));
};

await shot('shelves.png', 720);
await view('Workbench'); await shot('workbench.png', 720);
await view('Timeline');  await shot('timeline.png', 640);
await view('Shelves');
await browser.close();
