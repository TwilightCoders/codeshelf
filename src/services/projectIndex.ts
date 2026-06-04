import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { SKIP_DIRS } from '../shared/constants';
import { NON_NOUN_WORDS } from './nonNouns.generated';

// Builds the per-project search corpus: a capped, cleaned blob of the README
// excerpt plus a one-line "blurb" pulled from the project's package manifest.
// Kept small so it ships in the shelf cache and matches cheaply client-side.

const README_RE = /^readme(\.(md|markdown|mdown|txt|rst))?$/i;
const DOC_CAP = 2400;
const BLURB_CAP = 400;
const TOTAL_CAP = 3000;

// Manifests we know how to pull a description/keywords blurb from, by priority.
const MANIFESTS = ['package.json', 'composer.json', 'deno.json', 'Cargo.toml', 'pyproject.toml'];

/** Choose which manifest file (if any) to read a blurb from. */
export function pickManifest(entryNames: string[]): string | undefined {
  for (const m of MANIFESTS) if (entryNames.includes(m)) return m;
  return entryNames.find(e => e.endsWith('.gemspec'));
}

/** Extract a short description/keywords blurb from a manifest's raw content. */
export function extractManifestBlurb(filename: string, content: string): string {
  try {
    if (filename.endsWith('.json')) {
      const o: unknown = JSON.parse(content);
      if (typeof o !== 'object' || o === null) return '';
      const rec = o as { description?: unknown; keywords?: unknown };
      const parts: string[] = [];
      if (typeof rec.description === 'string') parts.push(rec.description);
      if (Array.isArray(rec.keywords)) {
        parts.push(rec.keywords.filter((k): k is string => typeof k === 'string').join(' '));
      }
      return parts.join(' ').trim();
    }
    if (filename.endsWith('.gemspec')) {
      const out: string[] = [];
      const re = /\.(summary|description)\s*=\s*["']([^"']*)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) out.push(m[2]);
      return out.join(' ').trim();
    }
    // TOML-ish (Cargo.toml, pyproject.toml): the first single-line description = "…"
    const m = content.match(/(?:^|\n)[ \t]*description[ \t]*=[ \t]*["']([^"'\n]*)["']/);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

/** Strip Markdown/HTML noise from doc text, leaving plain searchable words. */
export function cleanDocText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, ' ')          // HTML comments
    .replace(/```[\s\S]*?```/g, ' ')           // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → link text
    .replace(/^[ \t]*[#>*\-+][ \t]*/gm, '')    // line-leading markers (kept inline hyphens)
    .replace(/[*_`~]/g, '')                    // inline emphasis chars
    .replace(/\s+/g, ' ')
    .trim();
}

/** Assemble the capped corpus from a manifest blurb and raw doc text. */
export function assembleSearchText(blurb: string, docText: string): string {
  const docExcerpt = cleanDocText(docText).slice(0, DOC_CAP);
  const blurbExcerpt = blurb.slice(0, BLURB_CAP);
  const corpus = [blurbExcerpt, docExcerpt].filter(Boolean).join(' — ');
  return corpus.slice(0, TOTAL_CAP).trim();
}

// ── Local word-index over the project's own files ──

const FINAL_CAP = 6000;
const VOCAB_CAP = 300;          // max distinct residue words kept per project
const WORD_SPLIT = /[^A-Za-z0-9]+/;

// Texty file extensions worth tokenizing (source + prose + config); binaries,
// lockfiles, and minified bundles are excluded.
const TEXT_EXT = new Set([
  'md', 'markdown', 'mdown', 'txt', 'rst', 'adoc',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'cs', 'php', 'lua', 'ex', 'exs',
  'erl', 'dart', 'vue', 'svelte', 'scala', 'clj', 'sh', 'bash', 'zsh', 'fish', 'sql',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'html', 'htm', 'xml',
  'css', 'scss', 'sass', 'less', 'styl', 'gradle', 'groovy', 'r', 'jl', 'm', 'mm',
  'pl', 'pm', 'tf', 'proto', 'graphql', 'gql',
]);
const SKIP_FILE_RE = /\.min\.(js|css)$|^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock)$|\.map$/i;

const MAX_FILES = 50;            // bound the walk: files read per project
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;

let _denylist: Set<string> | undefined;
function denylist(): Set<string> {
  if (!_denylist) _denylist = new Set(NON_NOUN_WORDS.split('\n'));
  return _denylist;
}

function isTexty(name: string): boolean {
  if (SKIP_FILE_RE.test(name)) return false;
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_EXT.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Tokenize text and return its distinct "content vocabulary": camelCase/snake
 * split, lowercased, with non-nouns (verbs/adverbs/function words via the
 * denylist), pure-numbers, and too-short/long tokens removed. What survives is
 * nouns + adjectives + out-of-vocabulary custom words. Pure + capped.
 */
export function extractVocabulary(text: string, deny: Set<string>, cap = VOCAB_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(WORD_SPLIT)) {
    if (!raw) continue;
    const split = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')          // camelCase → camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');      // HTTPServer → HTTP Server
    for (const piece of split.split(' ')) {
      const w = piece.toLowerCase();
      if (w.length < 3 || w.length > 24) continue;
      if (/^\d+$/.test(w)) continue;                    // pure number
      if (!/[a-z]/.test(w)) continue;                   // must contain a letter
      if (deny.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * Concatenate a bounded sample of the project's own text files, honoring
 * SKIP_DIRS (hard floor) AND the project's `.gitignore` (via the `ignore`
 * package — correct negation/anchoring/globstar handling). Dotfiles/dirs are
 * skipped (`.git`, `.claude` etc.; `.claude/CONTEXT.md` is read elsewhere).
 */
export async function gatherProjectText(dir: string, rootEntryNames: string[]): Promise<string> {
  const ig = ignore();
  if (rootEntryNames.includes('.gitignore')) {
    const gi = await fs.promises.readFile(path.join(dir, '.gitignore'), 'utf-8').catch(() => '');
    if (gi) ig.add(gi);
  }
  const chunks: string[] = [];
  let files = 0;
  let bytes = 0;
  const walk = async (absDir: string): Promise<void> => {
    if (files >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) return;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(absDir, e.name);
      const rel = path.relative(dir, abs);
      if (rel && ig.ignores(rel)) continue;
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile() && isTexty(e.name)) {
        const text = await fs.promises.readFile(abs, 'utf-8').catch(() => '');
        if (!text) continue;
        const slice = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
        chunks.push(slice);
        files += 1;
        bytes += slice.length;
      }
    }
  };
  await walk(dir);
  return chunks.join('\n');
}

/**
 * Read a project's docs + manifest + own source files and return its search
 * corpus (undefined if empty). Sources: a top-level README, the project's own
 * `.claude/CONTEXT.md`, a manifest description/keywords blurb (kept verbatim),
 * and the noun+adjective+custom-word vocabulary extracted from its text files
 * (gitignore-respecting). `entryNames` may be supplied (the scanner already has
 * them); otherwise the directory is read here.
 */
export async function buildSearchText(dir: string, entryNames?: string[]): Promise<string | undefined> {
  const names = entryNames ?? await fs.promises.readdir(dir).catch((): string[] => []);
  const readmeName = names.find(e => README_RE.test(e));
  const manifestName = pickManifest(names);
  const read = (...rel: string[]) => fs.promises.readFile(path.join(dir, ...rel), 'utf-8').catch(() => '');
  const [readme, context, manifest, fileText] = await Promise.all([
    readmeName ? read(readmeName) : Promise.resolve(''),
    names.includes('.claude') ? read('.claude', 'CONTEXT.md') : Promise.resolve(''),
    manifestName ? read(manifestName) : Promise.resolve(''),
    gatherProjectText(dir, names),
  ]);
  const blurb = manifestName ? extractManifestBlurb(manifestName, manifest) : '';
  const docText = [readme, context].filter(Boolean).join('\n\n');
  const base = assembleSearchText(blurb, docText);
  const vocab = extractVocabulary(fileText, denylist()).join(' ');
  const corpus = [base, vocab].filter(Boolean).join(' — ').slice(0, FINAL_CAP);
  return corpus || undefined;
}
