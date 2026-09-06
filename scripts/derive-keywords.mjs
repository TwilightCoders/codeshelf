#!/usr/bin/env node
/**
 * Regenerate src/services/programmingKeywords.generated.ts — the programming
 * language keyword denylist the project indexer subtracts from source tokens
 * (on top of the WordNet "never-a-noun" denylist) so that structural noise
 * (`func`, `const`, `unsigned`, `nil`, `iota`, `endif`…) never becomes a search
 * term or an auto-tag.
 *
 * Source: VS Code's OWN bundled TextMate grammars — we dog-food the editor's
 * syntax-highlighting definitions. Every language extension ships a
 * `*.tmLanguage.json`; patterns scoped `keyword.*` / `storage.*` /
 * `constant.language.*` / `variable.language.*` carry bareword alternations like
 * `(catch|finally|throw|try)` whose contents are exactly the language keywords.
 * One stock VS Code install yields ~80 languages for free, and the set tracks
 * whatever VS Code ships next.
 *
 * Two scopes are deliberately NOT harvested:
 *   • the SQL grammar — its "keywords" (table/view/index/schema/column/order/
 *     group/key) are ordinary English nouns that make excellent project tags.
 *   • `support.type` — built-in type aliases pull in DSL noise (vbCrLf, …) and
 *     overlap with useful nouns; TF-IDF already demotes ubiquitous type names.
 *
 * A small SUPPLEMENT covers unambiguous tokens the grammars bury inside larger
 * metacharacter patterns the bareword extractor can't see (`var`, `func`, `fn`,
 * `unsigned`, the fixed-width int/float type names, `endif`/`elsif`, …).
 *
 * Run from the repo root, with VS Code installed:
 *   node scripts/derive-keywords.mjs                 # auto-locate VS Code
 *   node scripts/derive-keywords.mjs --from <extdir> # explicit extensions dir
 *   VSCODE_GRAMMARS=<extdir> node scripts/derive-keywords.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Locate VS Code's bundled extensions directory ──
function locateExtensionsDir() {
  const fromArg = process.argv.indexOf('--from');
  const candidates = [];
  if (fromArg !== -1 && process.argv[fromArg + 1]) candidates.push(process.argv[fromArg + 1]);
  if (process.env.VSCODE_GRAMMARS) candidates.push(process.env.VSCODE_GRAMMARS);
  const home = os.homedir();
  const apps = [
    'Visual Studio Code.app', 'Visual Studio Code - Insiders.app',
    'VSCodium.app', 'Cursor.app',
  ];
  for (const base of [path.join(home, 'Applications'), '/Applications']) {
    for (const app of apps) {
      candidates.push(path.join(base, app, 'Contents/Resources/app/extensions'));
    }
  }
  // Linux / portable installs
  candidates.push(
    '/usr/share/code/resources/app/extensions',
    '/usr/share/code-insiders/resources/app/extensions',
    '/opt/visual-studio-code/resources/app/extensions',
    path.join(home, '.vscode/extensions'),
  );
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* keep looking */ }
  }
  return null;
}

// Scopes whose matched literals are language keywords / storage modifiers /
// language constants — structural noise, not a project's own nouns.
const KW_SCOPE_RE = /\b(keyword|storage|constant\.language|variable\.language)\b/;
// A paren group whose entire content is barewords joined by `|`, e.g.
// `(catch|finally|throw|try)`. Lookarounds/char-classes contain metachars and
// are skipped by construction.
const ALT_RE = /\(([A-Za-z][A-Za-z0-9_]*(?:\|[A-Za-z][A-Za-z0-9_]*)*)\)/g;

function findGrammarFiles(extDir) {
  const files = [];
  const stack = [extDir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') stack.push(abs);
      } else if (e.name.endsWith('.tmLanguage.json')) {
        // Skip SQL grammars — see header.
        if (/\bsql\b/i.test(abs)) continue;
        files.push(abs);
      }
    }
  }
  return files;
}

function harvest(extDir) {
  const kw = new Set();
  let grammars = 0;
  for (const f of findGrammarFiles(extDir)) {
    let g;
    try { g = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    grammars++;
    const visit = (o) => {
      if (Array.isArray(o)) { o.forEach(visit); return; }
      if (o && typeof o === 'object') {
        if (typeof o.name === 'string' && KW_SCOPE_RE.test(o.name)) {
          for (const field of ['match', 'begin', 'end']) {
            const src = o[field];
            if (typeof src !== 'string') continue;
            let m;
            while ((m = ALT_RE.exec(src))) {
              for (const w of m[1].split('|')) {
                const lw = w.toLowerCase();
                if (lw.length >= 2 && !/^\d+$/.test(lw)) kw.add(lw);
              }
            }
          }
        }
        for (const k in o) visit(o[k]);
      }
    };
    visit(g);
  }
  return { kw, grammars };
}

// Unambiguous language tokens the grammars bury inside larger metacharacter
// patterns (so the bareword extractor misses them). Intentionally excludes
// common standalone English nouns (make/range/open/set/get/key/value/string) —
// TF-IDF already handles those, and they can be legitimate tags.
const SUPPLEMENT = `
var func fn fun val defn defmacro defmethod lambda typealias typedef
unsigned signed nullptr noexcept constexpr decltype const_cast static_cast dynamic_cast reinterpret_cast
int uint int8 int16 int32 int64 uint8 uint16 uint32 uint64 usize isize size_t uintptr ssize_t
float32 float64 char bool boolean
endif endwhile endfor endforeach endswitch endclass endmodule enddef elsif fi esac
attr_accessor attr_reader attr_writer require_relative
println printf sprintf fprintf goroutine iota puts gets
`.trim().split(/\s+/).filter(Boolean);

const extDir = locateExtensionsDir();
if (!extDir) {
  console.error('Could not locate a VS Code extensions directory.');
  console.error('Pass one explicitly:  node scripts/derive-keywords.mjs --from "<…/app/extensions>"');
  console.error('or set VSCODE_GRAMMARS=<…/app/extensions>.');
  process.exit(1);
}

const { kw, grammars } = harvest(extDir);
for (const s of SUPPLEMENT) kw.add(s.toLowerCase());

const body = [...kw].sort().join('\n');
fs.writeFileSync('src/services/programmingKeywords.generated.ts',
  '// GENERATED FILE — do not edit by hand. Regenerate: node scripts/derive-keywords.mjs\n' +
  "// Programming-language keyword denylist harvested from VS Code's OWN bundled\n" +
  '// TextMate grammars (keyword/storage/constant.language/variable.language scopes),\n' +
  '// excluding the SQL grammar and support.type (whose literals are useful nouns),\n' +
  '// plus a small supplement of tokens the grammars bury in larger patterns. The\n' +
  '// indexer subtracts these from source tokens so structural keywords never become\n' +
  '// search terms or auto-tags. See scripts/derive-keywords.mjs for provenance.\n' +
  '/* eslint-disable */\n' +
  'export const PROGRAMMING_KEYWORDS = `' + body + '`;\n');

console.log(`extDir=${extDir}`);
console.log(`grammars=${grammars}  harvested=${kw.size - SUPPLEMENT.length}+supplement(${SUPPLEMENT.length})  total=${kw.size}  bodyBytes=${body.length}`);
