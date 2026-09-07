import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_MARKERS, GLOB_MARKERS, SKIP_DIRS,
  LANGUAGE_PRIORITY, UMBRELLA_MARKERS,
} from '../shared/constants';
import { Project, Shelf, ShelfItem, ProjectItem, RootsConfig, RootConfig, ShelfMeta, ProjectMeta, Worktree } from '../shared/types';
import { getBranch, branchFromGitDir } from './gitInfo';
import { parseWorkspaceFile, WorkspaceInfo } from './workspaceFile';
import { buildSearchText, applyTfIdfTags } from './projectIndex';

// Cap on how many sibling directories are probed at once. Keeps a very wide
// root from spawning hundreds of concurrent fs operations / open descriptors.
const SCAN_CONCURRENCY = 16;

// ── Low-level helpers ──

async function exists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

/**
 * Like `Promise.all(items.map(fn))` but with at most `limit` calls in flight.
 * Results are returned in input order.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function isWorktree(dir: string): Promise<boolean> {
  const gitPath = path.join(dir, '.git');
  try {
    const stat = await fs.promises.stat(gitPath);
    // Real repos have .git as a directory; worktrees have .git as a file
    // containing "gitdir: /path/to/main/.git/worktrees/name"
    return stat.isFile();
  } catch {
    return false;
  }
}

// A worktree collected during the scan, tagged with the main repo it belongs to
// so it can be attached to that project's deck after all projects are known.
interface CollectedWorktree {
  parentPath: string;
  worktree: Worktree;
}

/**
 * If `dir` is a git WORKTREE (its `.git` is a file pointing into another repo's
 * `.git/worktrees/<name>/`), return the main repo's working-dir path and the
 * worktree's git metadata dir. Returns undefined for normal repos AND for
 * submodules (whose gitdir points into `.git/modules/`, not `.git/worktrees/`).
 */
async function parseWorktree(dir: string): Promise<{ parentPath: string; gitDir: string } | undefined> {
  const content = await fs.promises.readFile(path.join(dir, '.git'), 'utf-8').catch(() => '');
  const m = /gitdir:\s*(.+)/.exec(content);
  if (!m) return undefined;
  const gitDir = m[1].trim();
  const marker = '/.git/worktrees/';
  const idx = gitDir.indexOf(marker);
  if (idx === -1) return undefined;
  return { parentPath: gitDir.slice(0, idx), gitDir };
}

/** Build a Worktree record (branch resolved from the worktree's own HEAD). */
async function buildWorktree(dir: string, gitDir: string): Promise<Worktree> {
  const [stat, gitBranch] = await Promise.all([
    fs.promises.stat(dir).catch(() => undefined),
    branchFromGitDir(gitDir),
  ]);
  return { name: path.basename(dir), path: dir, gitBranch, lastModified: stat?.mtimeMs ?? 0 };
}

/**
 * If `dir` is a git worktree, record it on `collector` (tagged with its parent
 * repo) and return true so the caller skips it — a worktree is never its own
 * card. `entryNames` lets us avoid touching the fs when there is no `.git`.
 */
async function collectIfWorktree(dir: string, entryNames: string[], collector: CollectedWorktree[]): Promise<boolean> {
  if (!entryNames.includes('.git')) return false;
  const wt = await parseWorktree(dir);
  if (!wt) return false;
  collector.push({ parentPath: wt.parentPath, worktree: await buildWorktree(dir, wt.gitDir) });
  return true;
}

// Detect project markers in a directory. The caller may pass the directory's
// entry names (it usually already read them) to avoid a redundant readdir;
// otherwise they are read here. File markers are resolved by set membership —
// only `.git` needs a stat, and only when present, to tell a real repo from a
// worktree (whose .git is a file, not a directory).
async function detectMarkers(dir: string, entries?: string[]): Promise<string[]> {
  const names = entries ?? await fs.promises.readdir(dir).catch((): string[] => []);
  const present = new Set(names);
  const found: string[] = [];

  for (const marker of Object.keys(PROJECT_MARKERS)) {
    if (!present.has(marker)) continue;
    if (marker === '.git' && await isWorktree(dir)) continue;
    found.push(marker);
  }
  for (const pattern of GLOB_MARKERS) {
    const ext = pattern.replace('*', '');
    if (names.some(e => e.endsWith(ext))) found.push(pattern);
  }
  return found;
}

/**
 * ── Directory classification ──────────────────────────────────────────────
 *
 * The git repository boundary is the ground truth for coupling: things that are
 * versioned together are one project; things versioned separately are
 * independent. That single observable yields the three layer kinds, at any depth
 * and for any organic folder structure:
 *
 *   project   — the directory IS a repo (or declares itself one). Its
 *               marker-bearing children are components, so we do not recurse.
 *               `platform/` (one repo, 13 component dirs) is one card.
 *   category  — not a repo, but its children ARE projects. A shelf.
 *               `vscode/`, `Gems/`, `Games/` (independent repos side by side).
 *   grouping  — not a repo and no project children, but projects live deeper.
 *               Recurse. `Plugins/`, `Archive/`, and the roots themselves.
 *
 * This subsumes machinery that used to be special-cased: a monorepo with one
 * `.git` is a super-project for free, so umbrella markers become a mere
 * declaration rather than the mechanism.
 */
export type DirKind = 'project' | 'category' | 'grouping' | 'empty';

/** A real repo — worktrees have `.git` as a FILE and are handled elsewhere. */
async function isRepo(dir: string, entryNames: string[]): Promise<boolean> {
  if (!entryNames.includes('.git')) return false;
  try {
    return (await fs.promises.stat(path.join(dir, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

/** An explicit `.codeshelf` declaration, which outranks every inferred signal. */
async function readDeclaration(dir: string, entryNames: string[]): Promise<DirKind | undefined> {
  if (!entryNames.includes('.codeshelf')) return undefined;
  const raw = await fs.promises.readFile(path.join(dir, '.codeshelf'), 'utf-8').catch(() => '');
  const m = /^\s*kind\s*:\s*(project|category)\s*$/mi.exec(raw);
  return m ? (m[1].toLowerCase() as DirKind) : undefined;
}

/** Cheap, NON-recursive "does this look like a project at all?" — used to count
 *  a directory's project children without descending the whole tree. */
async function looksLikeProject(dir: string, entryNames: string[]): Promise<boolean> {
  if (await isRepo(dir, entryNames)) return true;
  if (detectUmbrellaMarkers(entryNames).length > 0) return true;
  return (await detectMarkers(dir, entryNames)).length > 0;
}

/** How many immediate child directories look like projects. Stops at `cap`. */
async function countProjectChildren(dir: string, entryNames: string[], cap = 2): Promise<number> {
  let n = 0;
  for (const name of entryNames) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const child = path.join(dir, name);
    let childNames: string[];
    try {
      if (!(await fs.promises.stat(child)).isDirectory()) continue;
      childNames = await fs.promises.readdir(child);
    } catch {
      continue;
    }
    if (await looksLikeProject(child, childNames) && ++n >= cap) return n;
  }
  return n;
}

/**
 * Is this directory ONE project? Precedence: explicit declaration > repo
 * boundary > umbrella declaration > marker-that-isn't-outvoted.
 *
 * The last clause is what keeps a stray marker from swallowing a category: a
 * `*.code-workspace` dropped on a folder purely to set a window title, or a
 * build `Makefile` sitting beside several independent repos, must not stop
 * recursion. A `.git` directory always wins, because that IS the coupling
 * boundary.
 */
export async function isProjectDir(dir: string, entryNames: string[]): Promise<boolean> {
  const declared = await readDeclaration(dir, entryNames);
  if (declared) return declared === 'project';
  if (await isRepo(dir, entryNames)) return true;
  if (detectUmbrellaMarkers(entryNames).length > 0) return true;
  if ((await detectMarkers(dir, entryNames)).length === 0) return false;
  return (await countProjectChildren(dir, entryNames)) < 2;
}

/** Full three-way classification. Exported for tests and tooling. */
export async function classifyDirectory(dir: string, entryNames?: string[]): Promise<DirKind> {
  const names = entryNames ?? await fs.promises.readdir(dir).catch((): string[] => []);
  if (await isProjectDir(dir, names)) return 'project';
  if (await countProjectChildren(dir, names, 1) >= 1) return 'category';
  for (const name of names) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const child = path.join(dir, name);
    try {
      if (!(await fs.promises.stat(child)).isDirectory()) continue;
      const childNames = await fs.promises.readdir(child);
      if (await countProjectChildren(child, childNames, 1) >= 1) return 'grouping';
    } catch { /* unreadable child */ }
  }
  return 'empty';
}

// Umbrella markers present in a directory (monorepo / multi-service roots that
// should be treated as one super-project rather than recursed into). Pure — works
// off the already-read entry names.
function detectUmbrellaMarkers(entryNames: string[]): string[] {
  return entryNames.filter(name => UMBRELLA_MARKERS.has(name));
}

export function inferLanguage(markers: string[]): string | undefined {
  const languages = new Set<string>();
  for (const marker of markers) {
    const lang = PROJECT_MARKERS[marker];
    if (lang && lang !== 'git') languages.add(lang);
    if (marker.endsWith('.gemspec')) languages.add('ruby');
    if (marker.endsWith('.sln') || marker.endsWith('.csproj')) languages.add('csharp');
    if (marker.endsWith('.xcodeproj') || marker.endsWith('.xcworkspace')) languages.add('swift');
  }
  for (const lang of LANGUAGE_PRIORITY) {
    if (languages.has(lang)) return lang;
  }
  return languages.size > 0 ? [...languages][0] : undefined;
}

function resolveProjectMeta(projectPath: string, shelfMeta?: ShelfMeta): ProjectMeta | undefined {
  if (!shelfMeta?.projects) return undefined;
  return shelfMeta.projects[projectPath] ?? shelfMeta.projects[path.basename(projectPath)];
}

function resolveShelfMeta(shelfPath: string, rootMeta?: RootConfig): ShelfMeta | undefined {
  if (!rootMeta?.shelves) return undefined;
  return rootMeta.shelves[shelfPath] ?? rootMeta.shelves[path.basename(shelfPath)];
}

// `wsInfo` may be supplied by the caller to avoid re-parsing the workspace
// file (the scanner already parses it once per directory). Pass `null` to skip
// the lookup entirely; leave `undefined` to parse on demand. `entryNames`, if
// supplied, lets the doc indexer avoid a redundant readdir.
async function buildProject(
  dir: string,
  markers: string[],
  projectMeta?: ProjectMeta,
  wsInfo?: WorkspaceInfo | null,
  entryNames?: string[],
): Promise<Project> {
  const [stat, ws, index] = await Promise.all([
    fs.promises.stat(dir),
    wsInfo === undefined ? parseWorkspaceFile(dir) : Promise.resolve(wsInfo),
    buildSearchText(dir, entryNames),
  ]);
  const gitBranch = markers.includes('.git') ? await getBranch(dir) : undefined;

  // Only umbrella-marked projects get a package count. Counting children for all
  // 297 projects would mean a readdir per child for no visible benefit; a
  // docker-compose/turbo/lerna root is exactly the case the badge is for.
  const names = entryNames ?? [];
  const subProjectCount = detectUmbrellaMarkers(names).length > 0
    ? await countProjectChildren(dir, names, 99)
    : undefined;

  return {
    name: projectMeta?.name ?? path.basename(dir),
    path: dir,
    markers,
    primaryLanguage: inferLanguage(markers),
    gitBranch,
    lastModified: stat.mtimeMs,
    poster: projectMeta?.poster,
    description: projectMeta?.description,
    workspaceFile: ws?.filePath,
    starred: projectMeta?.starred,
    searchText: index.searchText,
    tagCounts: index.tagCounts,
    subProjectCount,
  };
}

// ── Workspace-as-bookset: multi-folder workspace becomes a bookset ──

async function tryWorkspaceBookset(
  dir: string,
  wsInfo: WorkspaceInfo | undefined,
  shelfMeta?: ShelfMeta,
): Promise<ProjectItem[] | null> {
  if (!wsInfo || wsInfo.folders.length <= 1) return null;

  // If one of the folders is "." (the directory itself), this is a single
  // project with extra folders included — not a multi-project bookset
  const resolvedDir = path.resolve(dir);
  const hasSelfRef = wsInfo.folders.some(f => path.resolve(f) === resolvedDir);
  if (hasSelfRef) return null;

  // Multi-folder workspace → each folder is a sub-project. Build them
  // concurrently; the parent workspace file opens the whole thing.
  const built = await Promise.all(wsInfo.folders.map(async (folderPath): Promise<ProjectItem | null> => {
    if (!await exists(folderPath)) return null;
    const markers = await detectMarkers(folderPath);
    if (markers.length === 0) markers.push('.code-workspace'); // mark it anyway
    const pMeta = resolveProjectMeta(folderPath, shelfMeta);
    if (pMeta?.hidden) return null;
    const project = await buildProject(folderPath, markers, pMeta, null);
    project.workspaceFile = wsInfo.filePath;
    return { kind: 'project', project };
  }));
  const items = built.filter((i): i is ProjectItem => i !== null);
  return items.length > 0 ? items : null;
}

// ── Single-child collapsing ──
// If a non-project directory has exactly 1 child directory and 0 projects,
// collapse it: concatenate names with " / " and recurse.

interface ScanResult {
  projects: Project[];
  groups: { name: string; path: string; projects: Project[] }[];
}

async function scanDirectory(
  dir: string,
  maxDepth: number,
  shelfMeta: ShelfMeta | undefined,
  collector: CollectedWorktree[],
  currentDepth: number = 0,
): Promise<ScanResult> {
  const projects: Project[] = [];
  const groups: ScanResult['groups'] = [];

  if (currentDepth > maxDepth) return { projects, groups };

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { projects, groups };
  }

  const subdirs = entries
    .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map(e => path.join(dir, e.name));

  // Process siblings concurrently (bounded). mapLimit preserves input order, so
  // the merged result is deterministic and matches a sequential walk.
  const perSubdir = await mapLimit(subdirs, SCAN_CONCURRENCY, async (subdir): Promise<ScanResult> => {
    const local: ScanResult = { projects: [], groups: [] };

    // Read this directory's entries ONCE (with file types) and feed all three
    // consumers — workspace-file lookup, marker detection, and the single-child
    // collapse check — instead of re-reading the same directory three times.
    const dirents = await fs.promises.readdir(subdir, { withFileTypes: true }).catch((): fs.Dirent[] => []);
    const entryNames = dirents.map(d => d.name);

    // A git worktree is a secondary checkout — collect it onto its parent's
    // deck and skip it entirely (no card, no recursion).
    if (await collectIfWorktree(subdir, entryNames, collector)) return local;

    const wsInfo = await parseWorkspaceFile(subdir, entryNames);

    if (await isProjectDir(subdir, entryNames)) {
      // One project — its marker-bearing children are components, not cards.
      const markers = await detectMarkers(subdir, entryNames);
      const pMeta = resolveProjectMeta(subdir, shelfMeta);
      if (!pMeta?.hidden) {
        const effective = markers.length > 0 ? markers : detectUmbrellaMarkers(entryNames);
        local.projects.push(await buildProject(subdir, effective, pMeta, wsInfo, entryNames));
      }
      return local;
    }

    const wsItems = await tryWorkspaceBookset(subdir, wsInfo, shelfMeta);
    if (wsItems) {
      local.groups.push({ name: path.basename(subdir), path: subdir, projects: wsItems.map(i => i.project) });
      return local;
    }

    if (currentDepth < maxDepth) {
      // Category or grouping → recurse. A nested category becomes a bookset in
      // the parent shelf; names are NOT prefixed (the shelf/bookset already
      // carries the context, and prefixing produced things like
      // "Harbor-worktrees/agent-a3c09…").
      const nested = await scanDirectory(subdir, maxDepth, shelfMeta, collector, currentDepth + 1);
      if (nested.projects.length > 0 || nested.groups.length > 0) {
        const allProjects = [...nested.projects, ...nested.groups.flatMap(g => g.projects)];
        local.groups.push({ name: path.basename(subdir), path: subdir, projects: allProjects });
      }
    }
    return local;
  });

  for (const r of perSubdir) {
    projects.push(...r.projects);
    groups.push(...r.groups);
  }

  return { projects, groups };
}

/**
 * Guarantee each project appears exactly once across all shelves.
 *
 * A `.code-workspace` may list folders living anywhere on disk — platform's
 * names `../Gems/widgets`, `../lib` and `../../elsewhere/tool` — so a
 * project surfaced as part of a workspace bookset can also be discovered in its
 * real home. Ownership goes to the shelf that physically contains the project;
 * anything left over falls to its first occurrence.
 */
function dedupeProjects(shelves: Shelf[]): void {
  const projectsOf = (shelf: Shelf): Project[] =>
    shelf.items.flatMap(i => (i.kind === 'project' ? [i.project] : i.projects));
  const isHome = (shelf: Shelf, p: Project) =>
    p.path === shelf.path || p.path.startsWith(shelf.path + path.sep);

  const owner = new Map<string, Shelf>();
  for (const shelf of shelves) {
    for (const p of projectsOf(shelf)) if (isHome(shelf, p) && !owner.has(p.path)) owner.set(p.path, shelf);
  }
  for (const shelf of shelves) {
    for (const p of projectsOf(shelf)) if (!owner.has(p.path)) owner.set(p.path, shelf);
  }

  const emitted = new Set<string>();
  const claim = (shelf: Shelf, p: Project) => {
    if (owner.get(p.path) !== shelf || emitted.has(p.path)) return false;
    emitted.add(p.path);
    return true;
  };
  for (const shelf of shelves) {
    shelf.items = shelf.items.flatMap((item): ShelfItem[] => {
      if (item.kind === 'project') return claim(shelf, item.project) ? [item] : [];
      const kept = item.projects.filter(p => claim(shelf, p));
      return kept.length > 0 ? [{ ...item, projects: kept }] : [];
    });
  }
}

// ── Main scan ──

export async function scanRoots(
  rootsConfig: RootsConfig,
  scanDepth: number,
): Promise<Shelf[]> {
  const shelves: Shelf[] = [];
  // Worktrees found anywhere in the scan, attached to their parent projects at the end.
  const collectedWorktrees: CollectedWorktree[] = [];

  const allRootPaths = new Set<string>();
  for (const root of Object.keys(rootsConfig)) {
    allRootPaths.add(root.replace(/^~/, process.env.HOME ?? ''));
  }

  for (const [root, rootConfig] of Object.entries(rootsConfig)) {
    const expandedRoot = root.replace(/^~/, process.env.HOME ?? '');
    const rootLabel = rootConfig.label ?? path.basename(expandedRoot);

    let topEntries: fs.Dirent[];
    try {
      topEntries = await fs.promises.readdir(expandedRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    const topDirs = topEntries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(expandedRoot, e.name) }));

    const looseProjects: ShelfItem[] = [];

    for (const topDir of topDirs) {
      if (allRootPaths.has(topDir.path)) continue;

      const shelfMeta = resolveShelfMeta(topDir.path, rootConfig);

      // Read the top dir's entries once; reuse for the workspace-file lookup and
      // marker detection (the recurse branch re-reads with file types itself).
      const topEntryNames = await fs.promises.readdir(topDir.path).catch((): string[] => []);

      // A top-level dir that is itself a git worktree → collect onto its parent, skip.
      if (await collectIfWorktree(topDir.path, topEntryNames, collectedWorktrees)) continue;

      const topWsInfo = await parseWorkspaceFile(topDir.path, topEntryNames);

      // The repo boundary outranks the workspace-as-bookset heuristic: a
      // directory that IS a project is one card, full stop. Otherwise a repo
      // shipping a multi-folder `.code-workspace` would be exploded into a
      // bookset of whatever that file happens to list — including paths outside
      // the tree (platform's lists `../Gems/widgets` and `../../elsewhere/…`),
      // which duplicates projects discovered in their real home.
      if (await isProjectDir(topDir.path, topEntryNames)) {
        const topMarkers = await detectMarkers(topDir.path, topEntryNames);
        const pMeta = resolveProjectMeta(topDir.path, shelfMeta);
        if (!pMeta?.hidden) {
          const effective = topMarkers.length > 0 ? topMarkers : detectUmbrellaMarkers(topEntryNames);
          looseProjects.push({ kind: 'project', project: await buildProject(topDir.path, effective, pMeta, topWsInfo, topEntryNames) });
        }
        continue;
      }

      // Check for workspace-as-bookset at the shelf level
      const wsItems = await tryWorkspaceBookset(topDir.path, topWsInfo, shelfMeta);
      if (wsItems) {
        // Multi-folder workspace — run through rollup like any other shelf
        {
          const finalItems: ShelfItem[] = wsItems;
          shelves.push({
            name: shelfMeta?.name ?? topDir.name,
            path: topDir.path,
            rootLabel,
            rootPath: expandedRoot,
            starred: shelfMeta?.starred,
            hidden: shelfMeta?.hidden,
            flatten: shelfMeta?.flatten,
            items: finalItems,
          });
        }
        continue;
      }

      // Not a project — scan deeper
      const result = await scanDirectory(topDir.path, scanDepth - 1, shelfMeta, collectedWorktrees);
      const items: ShelfItem[] = [];

      for (const project of result.projects) {
        items.push({ kind: 'project', project });
      }
      for (const group of result.groups) {
        items.push({
          kind: 'bookset',
          name: group.name,
          path: group.path,
          projects: group.projects,
        });
      }

      if (items.length > 0) {
        {
          // A category is a shelf, at whatever size. Small ones render compact
          // and sit side by side (`.root-shelves` is a wrapping flex row), which
          // is what the old ≤3 rollup was approximating — except that rollup
          // also renamed the projects and tipped them into a synthetic
          // "Projects" heap, which is exactly what made placement feel arbitrary.
          const finalItems = items;
          finalItems.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'bookset' ? -1 : 1;
            if (a.kind === 'project' && b.kind === 'project') return b.project.lastModified - a.project.lastModified;
            return 0;
          });

          shelves.push({
            name: shelfMeta?.name ?? topDir.name,
            path: topDir.path,
            rootLabel,
            rootPath: expandedRoot,
            starred: shelfMeta?.starred,
            hidden: shelfMeta?.hidden,
            flatten: shelfMeta?.flatten,
            items: finalItems,
          });
        }
      }
    }

    if (looseProjects.length > 0) {
      looseProjects.sort((a, b) => {
        if (a.kind === 'project' && b.kind === 'project') {
          if (a.project.starred !== b.project.starred) return a.project.starred ? -1 : 1;
          return b.project.lastModified - a.project.lastModified;
        }
        return 0;
      });
      // The synthetic "Projects" shelf is addressable for star/hide too — its
      // path is the root itself, so resolve meta keyed by the root's basename.
      const looseMeta = resolveShelfMeta(expandedRoot, rootConfig);
      // A real directory can also be called "Projects" (a typical workspace has
      // one), which would put two identically-titled shelves in the same root.
      const takenNames = new Set(shelves.filter(sh => sh.rootPath === expandedRoot).map(sh => sh.name));
      const looseName = takenNames.has('Projects') ? 'Loose Projects' : 'Projects';
      shelves.push({
        name: looseName,
        path: expandedRoot,
        rootLabel,
        rootPath: expandedRoot,
        starred: looseMeta?.starred,
        hidden: looseMeta?.hidden,
        items: looseProjects,
      });
    }
  }

  // With every project indexed, weight each one's candidate terms by rarity
  // across the whole library (TF-IDF) to pick distinctive tags; strips tagCounts.
  // Exactly one card per project, before tags are weighted across the library.
  dedupeProjects(shelves);

  const allProjects: Project[] = [];
  for (const shelf of shelves) {
    for (const item of shelf.items) {
      if (item.kind === 'project') allProjects.push(item.project);
      else allProjects.push(...item.projects);
    }
  }

  // Attach collected worktrees to their parent project's deck (orphans whose main
  // repo is outside the scanned roots are simply dropped — never shown as cards).
  if (collectedWorktrees.length > 0) {
    const byPath = new Map(allProjects.map(p => [p.path, p]));
    for (const { parentPath, worktree } of collectedWorktrees) {
      const parent = byPath.get(parentPath);
      if (parent) (parent.worktrees ??= []).push(worktree);
    }
    for (const p of allProjects) {
      if (p.worktrees) p.worktrees.sort((a, b) => b.lastModified - a.lastModified);
    }
  }

  applyTfIdfTags(allProjects);

  return shelves;
}
