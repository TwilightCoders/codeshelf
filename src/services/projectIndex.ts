import * as fs from 'fs';
import * as path from 'path';

// Builds the per-project search corpus: a capped, cleaned blob of the README
// excerpt plus a one-line "blurb" pulled from the project's package manifest.
// Kept small so it ships in the shelf cache and matches cheaply client-side.

const README_RE = /^readme(\.(md|markdown|mdown|txt|rst))?$/i;
const README_CAP = 1500;
const BLURB_CAP = 400;
const TOTAL_CAP = 2000;

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

/** Assemble the capped corpus from a manifest blurb and a raw README. */
export function assembleSearchText(blurb: string, readme: string): string {
  const readmeExcerpt = cleanDocText(readme).slice(0, README_CAP);
  const blurbExcerpt = blurb.slice(0, BLURB_CAP);
  const corpus = [blurbExcerpt, readmeExcerpt].filter(Boolean).join(' — ');
  return corpus.slice(0, TOTAL_CAP).trim();
}

/**
 * Read a project's README + manifest and return its search corpus (undefined if
 * empty). `entryNames` may be supplied (the scanner already has them); otherwise
 * the directory is read here.
 */
export async function buildSearchText(dir: string, entryNames?: string[]): Promise<string | undefined> {
  const names = entryNames ?? await fs.promises.readdir(dir).catch((): string[] => []);
  const readmeName = names.find(e => README_RE.test(e));
  const manifestName = pickManifest(names);
  const [readme, manifest] = await Promise.all([
    readmeName ? fs.promises.readFile(path.join(dir, readmeName), 'utf-8').catch(() => '') : Promise.resolve(''),
    manifestName ? fs.promises.readFile(path.join(dir, manifestName), 'utf-8').catch(() => '') : Promise.resolve(''),
  ]);
  const blurb = manifestName ? extractManifestBlurb(manifestName, manifest) : '';
  return assembleSearchText(blurb, readme) || undefined;
}
