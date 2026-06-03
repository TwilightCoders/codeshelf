import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_MARKERS, GLOB_MARKERS, SKIP_DIRS,
  LANGUAGE_PRIORITY,
} from '../shared/constants';
import { Project, Shelf, ShelfItem, ProjectItem, RootsConfig, RootConfig, ShelfMeta, ProjectMeta } from '../shared/types';
import { getBranch } from './gitInfo';
import { parseWorkspaceFile, WorkspaceInfo } from './workspaceFile';

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

async function detectMarkers(dir: string): Promise<string[]> {
  const markerNames = Object.keys(PROJECT_MARKERS);
  // Check all file markers concurrently; Promise.all preserves order.
  const hits = await Promise.all(markerNames.map(async marker => {
    if (marker === '.git') {
      // Only count .git if it's a real repo, not a worktree
      return (await exists(path.join(dir, marker))) && !(await isWorktree(dir)) ? marker : null;
    }
    return (await exists(path.join(dir, marker))) ? marker : null;
  }));
  const found = hits.filter((m): m is string => m !== null);
  try {
    const entries = await fs.promises.readdir(dir);
    for (const pattern of GLOB_MARKERS) {
      const ext = pattern.replace('*', '');
      if (entries.some(e => e.endsWith(ext))) found.push(pattern);
    }
  } catch { /* skip */ }
  return found;
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
// the lookup entirely; leave `undefined` to parse on demand.
async function buildProject(
  dir: string,
  markers: string[],
  projectMeta?: ProjectMeta,
  wsInfo?: WorkspaceInfo | null,
): Promise<Project> {
  const [stat, ws] = await Promise.all([
    fs.promises.stat(dir),
    wsInfo === undefined ? parseWorkspaceFile(dir) : Promise.resolve(wsInfo),
  ]);
  const gitBranch = markers.includes('.git') ? await getBranch(dir) : undefined;

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
  shelfMeta?: ShelfMeta,
  currentDepth: number = 0,
  namePrefix: string = '',
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

    // Parse the workspace file once and reuse it for both the bookset check
    // and (for plain projects) buildProject.
    const wsInfo = await parseWorkspaceFile(subdir);
    const wsItems = await tryWorkspaceBookset(subdir, wsInfo, shelfMeta);
    if (wsItems) {
      const groupName = namePrefix ? `${namePrefix}/${path.basename(subdir)}` : path.basename(subdir);
      local.groups.push({ name: groupName, path: subdir, projects: wsItems.map(i => i.project) });
      return local;
    }

    const markers = await detectMarkers(subdir);
    if (markers.length > 0) {
      const pMeta = resolveProjectMeta(subdir, shelfMeta);
      if (!pMeta?.hidden) {
        const project = await buildProject(subdir, markers, pMeta, wsInfo);
        // Apply collapsed name prefix if we're inside a single-child chain
        if (namePrefix) {
          project.name = `${namePrefix}/${project.name}`;
        }
        local.projects.push(project);
      }
    } else if (currentDepth < maxDepth) {
      // Check for single-child collapse
      const childEntries = await fs.promises.readdir(subdir, { withFileTypes: true }).catch((): fs.Dirent[] => []);
      const childDirs = childEntries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));
      const subdirName = namePrefix ? `${namePrefix}/${path.basename(subdir)}` : path.basename(subdir);

      if (childDirs.length === 1) {
        // Single-child collapse: recurse deeper with concatenated name
        const nested = await scanDirectory(subdir, maxDepth, shelfMeta, currentDepth + 1, subdirName);
        local.projects.push(...nested.projects);
        local.groups.push(...nested.groups);
      } else {
        const nested = await scanDirectory(subdir, maxDepth, shelfMeta, currentDepth + 1);
        if (nested.projects.length > 0 || nested.groups.length > 0) {
          const allProjects = [
            ...nested.projects,
            ...nested.groups.flatMap(g => g.projects),
          ];
          local.groups.push({ name: subdirName, path: subdir, projects: allProjects });
        }
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

// ── Recursive rollup heuristic ──
// If a group (bookset) has ≤threshold total projects, flatten it:
// prefix each project name with the group name and push up to the parent.
// Works bottom-up recursively through the tree.

export const ROLLUP_THRESHOLD = 3;

export function rollupItems(items: ShelfItem[]): ShelfItem[] {
  const result: ShelfItem[] = [];

  for (const item of items) {
    if (item.kind === 'project') {
      result.push(item);
    } else {
      // It's a bookset — check if it should be rolled up
      if (item.projects.length <= ROLLUP_THRESHOLD) {
        // Roll up: prefix each project name with the bookset name
        for (const p of item.projects) {
          result.push({
            kind: 'project',
            project: { ...p, name: `${item.name}/${p.name}` },
          });
        }
      } else {
        // Keep as bookset
        result.push(item);
      }
    }
  }

  return result;
}

// After rolling up booksets, check if the entire shelf is small enough
// to be absorbed into the loose projects row.
// Returns null if should be absorbed, or the items if it should stay as a shelf.
export function rollupShelf(
  items: ShelfItem[],
  shelfName: string,
  hasExplicitMeta: boolean,
): { keep: true; items: ShelfItem[] } | { keep: false; looseProjects: ShelfItem[] } {
  // First, recursively roll up small booksets
  const rolled = rollupItems(items);

  // Count total projects after rollup
  const totalProjects = rolled.reduce((n, item) =>
    n + (item.kind === 'project' ? 1 : item.projects.length), 0);

  // If still small and no explicit metadata, absorb into loose projects
  if (totalProjects <= ROLLUP_THRESHOLD && !hasExplicitMeta) {
    const loose: ShelfItem[] = [];
    for (const item of rolled) {
      if (item.kind === 'project') {
        loose.push({ kind: 'project', project: { ...item.project, name: `${shelfName}/${item.project.name}` } });
      } else {
        for (const p of item.projects) {
          loose.push({ kind: 'project', project: { ...p, name: `${shelfName}/${p.name}` } });
        }
      }
    }
    return { keep: false, looseProjects: loose };
  }

  return { keep: true, items: rolled };
}

// ── Main scan ──

export async function scanRoots(
  rootsConfig: RootsConfig,
  scanDepth: number,
): Promise<Shelf[]> {
  const shelves: Shelf[] = [];

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

      // Parse the workspace file once; reuse for the bookset check and, if this
      // turns out to be a plain project, buildProject below.
      const topWsInfo = await parseWorkspaceFile(topDir.path);

      // Check for workspace-as-bookset at the shelf level
      const wsItems = await tryWorkspaceBookset(topDir.path, topWsInfo, shelfMeta);
      if (wsItems) {
        // Multi-folder workspace — run through rollup like any other shelf
        const hasExplicitMeta = shelfMeta && Object.keys(shelfMeta).length > 0;
        const rollupResult = rollupShelf(wsItems, topDir.name, !!hasExplicitMeta);
        if (!rollupResult.keep) {
          looseProjects.push(...rollupResult.looseProjects);
        } else {
          shelves.push({
            name: shelfMeta?.name ?? topDir.name,
            path: topDir.path,
            rootLabel,
            rootPath: expandedRoot,
            starred: shelfMeta?.starred,
            hidden: shelfMeta?.hidden,
            flatten: shelfMeta?.flatten,
            items: rollupResult.items,
          });
        }
        continue;
      }

      // Check if it's a regular project
      const topMarkers = await detectMarkers(topDir.path);
      if (topMarkers.length > 0) {
        const pMeta = resolveProjectMeta(topDir.path, shelfMeta);
        if (!pMeta?.hidden) {
          const project = await buildProject(topDir.path, topMarkers, pMeta, topWsInfo);
          looseProjects.push({ kind: 'project', project });
        }
        continue;
      }

      // Not a project — scan deeper
      const result = await scanDirectory(topDir.path, scanDepth - 1, shelfMeta);
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
        const hasExplicitMeta = shelfMeta && Object.keys(shelfMeta).length > 0;
        const rollupResult = rollupShelf(items, topDir.name, !!hasExplicitMeta);

        if (!rollupResult.keep) {
          // Absorbed into loose projects
          looseProjects.push(...rollupResult.looseProjects);
        } else {
          // Keep as its own shelf (with booksets already rolled up)
          const finalItems = rollupResult.items;
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
      shelves.push({
        name: 'Projects',
        path: expandedRoot,
        rootLabel,
        rootPath: expandedRoot,
        items: looseProjects,
      });
    }
  }

  return shelves;
}
