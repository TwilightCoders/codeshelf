#!/usr/bin/env node
/**
 * Which classes actually used by the components does a candidate stylesheet
 * fail to style?  node scripts/theme-coverage.mjs <theme.css>
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
const root = resolve(import.meta.dirname, '..');
const css = readFileSync(process.argv[2], 'utf8');

// classes referenced by the JSX
const files = [resolve(root, 'src/webview/App.tsx'),
  ...readdirSync(resolve(root, 'src/webview/components')).filter(f => f.endsWith('.tsx'))
      .map(f => resolve(root, 'src/webview/components', f))];
const used = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const tok of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      const t = tok.replace(/\$\{[^}]*\}/g, '').trim();
      // `heat-${h}` leaves the fragment `heat-`; a trailing dash means the real
      // class name was interpolated, so there is nothing to check.
      if (t && !t.endsWith('-') && /^[a-z][a-z0-9-]*$/i.test(t)) used.add(t);
    }
  }
}
// classes the stylesheet defines a rule for
const styled = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m => m[1]));
// codicon-* names come from VS Code's icon font, not from the theme.
const IGNORE = new Set(['codicon', 'id']);
const missing = [...used].filter(c => !styled.has(c) && !IGNORE.has(c) && !c.startsWith('codicon-')).sort();
console.log(`classes used by components: ${used.size}`);
console.log(`styled by this sheet:       ${used.size - missing.length}`);
console.log(missing.length ? `UNSTYLED (${missing.length}): ${missing.join(' ')}` : 'UNSTYLED: none ✓');
