#!/usr/bin/env node
/**
 * Release guard: fail if anything that ships in the package identifies the
 * machine it was built on — an absolute home-directory path, the local username
 * in a path, or the git author's email.
 *
 * The patterns are derived at runtime from whoever runs the build, so this file
 * itself names no one. Runs as part of `vscode:prepublish`, i.e. before every
 * `vsce package` and `vsce publish`.
 *
 *   node scripts/check-privacy.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir, userInfo } from 'os';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// What the package can contain. Scanning a superset of what actually ships is
// safe; missing something that ships is not.
const SHIPPED = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'out', 'out-webview', 'media'];
const TEXT = /\.(js|json|md|css|html|svg|txt)$/i;

/** Needles for the current machine. Exported for tests. */
export function machineNeedles({ home = homedir(), user = userInfo().username, email } = {}) {
  const needles = [];
  if (home && home.length > 1) needles.push({ label: 'home directory', text: home });
  if (user) {
    for (const prefix of ['/Users/', '/home/', 'C:\\Users\\']) needles.push({ label: 'username in a path', text: prefix + user });
  }
  if (email) needles.push({ label: 'git email', text: email });
  return needles;
}

/** Leaks in a text: every needle it contains, plus any absolute home path at all. */
export function findLeaks(text, needles) {
  const hits = [];
  for (const n of needles) if (text.includes(n.text)) hits.push(n.label);
  // Someone else's home path is a leak too, whoever is packaging.
  const generic = /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\/[A-Za-z0-9]/;
  if (generic.test(text)) hits.push('an absolute home-directory path');
  return [...new Set(hits)];
}

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) yield* walk(join(p, e));
  } else {
    yield p;
  }
}

function gitEmail() {
  try { return execFileSync('git', ['config', 'user.email'], { cwd: ROOT }).toString().trim() || undefined; }
  catch { return undefined; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const needles = machineNeedles({ email: gitEmail() });
  const problems = [];
  for (const entry of SHIPPED) {
    for (const file of walk(join(ROOT, entry))) {
      if (!TEXT.test(file) || file.endsWith('.map')) continue;
      const leaks = findLeaks(readFileSync(file, 'utf8'), needles);
      if (leaks.length) problems.push(`  ${relative(ROOT, file)}: ${leaks.join(', ')}`);
    }
  }
  if (problems.length) {
    console.error('check-privacy: shipped files identify the build machine:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('check-privacy: no machine-identifying data in shipped files ✓');
}
