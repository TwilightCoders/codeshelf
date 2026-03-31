import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_MARKERS, GLOB_MARKERS, SKIP_DIRS,
  LANGUAGE_PRIORITY,
} from '../shared/constants';
import { Project, Shelf, ShelfItem, RootsConfig, RootConfig, ShelfMeta, ProjectMeta } from '../shared/types';
import { getBranch } from './gitInfo';
import { parseWorkspaceFile } from './workspaceFile';

// ── Low-level helpers ──

async function exists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

async function detectMarkers(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const marker of Object.keys(PROJECT_MARKERS)) {
    if (await exists(path.join(dir, marker))) found.push(marker);
  }
  try {
    const entries = await fs.promises.readdir(dir);
    for (const pattern of GLOB_MARKERS) {
      const ext = pattern.replace('*', '');
      if (entries.some(e => e.endsWith(ext))) found.push(pattern);
    }
  } catch { /* skip */ }
  return found;
}

function inferLanguage(markers: string[]): string | undefined {
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

async function buildProject(dir: string, markers: string[], projectMeta?: ProjectMeta): Promise<Project> {
  const stat = await fs.promises.stat(dir);
  const gitBranch = markers.includes('.git') ? await getBranch(dir) : undefined;
  const wsInfo = await parseWorkspaceFile(dir);

  return {
    name: projectMeta?.name ?? path.basename(dir),
    path: dir,
    markers,
    primaryLanguage: inferLanguage(markers),
    gitBranch,
    lastModified: stat.mtimeMs,
    poster: projectMeta?.poster,
    description: projectMeta?.description,
    workspaceFile: wsInfo?.filePath,
    starred: projectMeta?.starred,
  };
}

// ── Workspace-as-bookset: multi-folder workspace becomes a bookset ──

async function tryWorkspaceBookset(dir: string, shelfMeta?: ShelfMeta): Promise<ShelfItem[] | null> {
  const wsInfo = await parseWorkspaceFile(dir);
  if (!wsInfo || wsInfo.folders.length <= 1) return null;

  // Multi-folder workspace → each folder is a sub-project
  const items: ShelfItem[] = [];
  for (const folderPath of wsInfo.folders) {
    if (!await exists(folderPath)) continue;
    const markers = await detectMarkers(folderPath);
    if (markers.length === 0) markers.push('.code-workspace'); // mark it anyway
    const pMeta = resolveProjectMeta(folderPath, shelfMeta);
    if (pMeta?.hidden) continue;
    const project = await buildProject(folderPath, markers, pMeta);
    // The parent workspace file should be used to open the whole thing
    project.workspaceFile = wsInfo.filePath;
    items.push({ kind: 'project', project });
  }
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

  for (const subdir of subdirs) {
    // Check for workspace-as-bookset first
    const wsItems = await tryWorkspaceBookset(subdir, shelfMeta);
    if (wsItems) {
      const groupName = namePrefix ? `${namePrefix} / ${path.basename(subdir)}` : path.basename(subdir);
      groups.push({ name: groupName, path: subdir, projects: wsItems.map(i => (i as { kind: 'project'; project: Project }).project) });
      continue;
    }

    const markers = await detectMarkers(subdir);
    if (markers.length > 0) {
      const pMeta = resolveProjectMeta(subdir, shelfMeta);
      if (!pMeta?.hidden) {
        projects.push(await buildProject(subdir, markers, pMeta));
      }
    } else if (currentDepth < maxDepth) {
      // Check for single-child collapse
      const childEntries = await fs.promises.readdir(subdir, { withFileTypes: true }).catch(() => []);
      const childDirs = (childEntries as fs.Dirent[]).filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'));
      const subdirName = namePrefix ? `${namePrefix} / ${path.basename(subdir)}` : path.basename(subdir);

      if (childDirs.length === 1) {
        // Single-child collapse: recurse deeper with concatenated name
        const nested = await scanDirectory(subdir, maxDepth, shelfMeta, currentDepth + 1, subdirName);
        projects.push(...nested.projects);
        groups.push(...nested.groups);
      } else {
        const nested = await scanDirectory(subdir, maxDepth, shelfMeta, currentDepth + 1);
        if (nested.projects.length > 0 || nested.groups.length > 0) {
          const allProjects = [
            ...nested.projects,
            ...nested.groups.flatMap(g => g.projects),
          ];
          groups.push({ name: subdirName, path: subdir, projects: allProjects });
        }
      }
    }
  }

  return { projects, groups };
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

      // Check for workspace-as-bookset at the shelf level
      const wsItems = await tryWorkspaceBookset(topDir.path, shelfMeta);
      if (wsItems) {
        // Multi-folder workspace at shelf level → becomes a shelf with those items
        shelves.push({
          name: shelfMeta?.name ?? topDir.name,
          path: topDir.path,
          rootLabel,
          rootPath: expandedRoot,
          starred: shelfMeta?.starred,
          hidden: shelfMeta?.hidden,
          flatten: shelfMeta?.flatten,
          items: wsItems,
        });
        continue;
      }

      // Check if it's a regular project
      const topMarkers = await detectMarkers(topDir.path);
      if (topMarkers.length > 0) {
        const pMeta = resolveProjectMeta(topDir.path, shelfMeta);
        if (!pMeta?.hidden) {
          const project = await buildProject(topDir.path, topMarkers, pMeta);
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
        const totalProjects = items.reduce((n, item) =>
          n + (item.kind === 'project' ? 1 : item.projects.length), 0);

        // Single-project shelves → absorb into loose projects
        // Don't absorb shelves the user has explicitly configured
        const hasExplicitMeta = shelfMeta && Object.keys(shelfMeta).length > 0;
        if (totalProjects <= 3 && !hasExplicitMeta) {
          for (const item of items) {
            if (item.kind === 'project') {
              looseProjects.push({ kind: 'project', project: { ...item.project, name: `${topDir.name}/${item.project.name}` } });
            } else {
              for (const p of item.projects) {
                looseProjects.push({ kind: 'project', project: { ...p, name: `${topDir.name}/${p.name}` } });
              }
            }
          }
        } else {
          items.sort((a, b) => {
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
            items,
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
