import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_MARKERS, GLOB_MARKERS, SKIP_DIRS,
  LANGUAGE_PRIORITY,
} from '../shared/constants';
import { Project, Shelf, ShelfItem, RootsConfig, RootConfig, ShelfMeta, ProjectMeta } from '../shared/types';
import { getBranch } from './gitInfo';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectMarkers(dir: string): Promise<string[]> {
  const found: string[] = [];

  for (const marker of Object.keys(PROJECT_MARKERS)) {
    if (await exists(path.join(dir, marker))) {
      found.push(marker);
    }
  }

  try {
    const entries = await fs.promises.readdir(dir);
    for (const pattern of GLOB_MARKERS) {
      const ext = pattern.replace('*', '');
      if (entries.some(e => e.endsWith(ext))) {
        found.push(pattern);
      }
    }
  } catch {
    // Can't read directory
  }

  return found;
}

function inferLanguage(markers: string[]): string | undefined {
  const languages = new Set<string>();
  for (const marker of markers) {
    const lang = PROJECT_MARKERS[marker];
    if (lang && lang !== 'git') {
      languages.add(lang);
    }
    if (marker.endsWith('.gemspec')) languages.add('ruby');
    if (marker.endsWith('.sln') || marker.endsWith('.csproj')) languages.add('csharp');
    if (marker.endsWith('.xcodeproj') || marker.endsWith('.xcworkspace')) languages.add('swift');
  }
  for (const lang of LANGUAGE_PRIORITY) {
    if (languages.has(lang)) return lang;
  }
  return languages.size > 0 ? [...languages][0] : undefined;
}

async function findWorkspaceFile(dir: string): Promise<string | undefined> {
  try {
    const entries = await fs.promises.readdir(dir);
    const wsFile = entries.find(e => e.endsWith('.code-workspace'));
    return wsFile ? path.join(dir, wsFile) : undefined;
  } catch {
    return undefined;
  }
}

function resolveProjectMeta(
  projectPath: string,
  shelfMeta?: ShelfMeta,
): ProjectMeta | undefined {
  if (!shelfMeta?.projects) return undefined;
  // Try absolute path first, then basename
  return shelfMeta.projects[projectPath]
    ?? shelfMeta.projects[path.basename(projectPath)];
}

async function buildProject(
  dir: string,
  markers: string[],
  projectMeta?: ProjectMeta,
): Promise<Project> {
  const stat = await fs.promises.stat(dir);
  const gitBranch = markers.includes('.git') ? await getBranch(dir) : undefined;
  const workspaceFile = await findWorkspaceFile(dir);

  return {
    name: projectMeta?.name ?? path.basename(dir),
    path: dir,
    markers,
    primaryLanguage: inferLanguage(markers),
    gitBranch,
    lastModified: stat.mtimeMs,
    poster: projectMeta?.poster,
    description: projectMeta?.description,
    workspaceFile,
    starred: projectMeta?.starred,
  };
}

function resolveShelfMeta(
  shelfPath: string,
  rootMeta?: RootConfig,
): ShelfMeta | undefined {
  if (!rootMeta?.shelves) return undefined;
  // Try absolute path first, then basename
  return rootMeta.shelves[shelfPath]
    ?? rootMeta.shelves[path.basename(shelfPath)];
}

async function scanDirectory(
  dir: string,
  maxDepth: number,
  hiddenSet: Set<string>,
  shelfMeta?: ShelfMeta,
  currentDepth: number = 0,
): Promise<{ projects: Project[]; groups: { name: string; path: string; projects: Project[] }[] }> {
  const projects: Project[] = [];
  const groups: { name: string; path: string; projects: Project[] }[] = [];

  if (currentDepth > maxDepth) return { projects, groups };

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { projects, groups };
  }

  const subdirs = entries
    .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map(e => path.join(dir, e.name))
    .filter(p => !hiddenSet.has(p));

  for (const subdir of subdirs) {
    const markers = await detectMarkers(subdir);
    if (markers.length > 0) {
      const pMeta = resolveProjectMeta(subdir, shelfMeta);
      if (!pMeta?.hidden) {
        projects.push(await buildProject(subdir, markers, pMeta));
      }
    } else if (currentDepth < maxDepth) {
      const nested = await scanDirectory(subdir, maxDepth, hiddenSet, shelfMeta, currentDepth + 1);
      if (nested.projects.length > 0 || nested.groups.length > 0) {
        const allProjects = [
          ...nested.projects,
          ...nested.groups.flatMap(g => g.projects),
        ];
        groups.push({ name: path.basename(subdir), path: subdir, projects: allProjects });
      }
    }
  }

  return { projects, groups };
}

export async function scanRoots(
  rootsConfig: RootsConfig,
  scanDepth: number,
): Promise<Shelf[]> {
  const shelves: Shelf[] = [];

  // Build a set of all expanded root paths for de-duplication
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

    // Collect top-level projects (dirs that are themselves projects)
    // into a single shelf instead of one shelf per project
    const looseProjects: ShelfItem[] = [];

    for (const topDir of topDirs) {
      // Skip if this directory is itself configured as a root
      if (allRootPaths.has(topDir.path)) continue;

      const shelfMeta = resolveShelfMeta(topDir.path, rootConfig);

      // Don't skip hidden shelves — pass them through so the webview can show pills

      const topMarkers = await detectMarkers(topDir.path);
      if (topMarkers.length > 0) {
        const pMeta = resolveProjectMeta(topDir.path, shelfMeta);
        if (!pMeta?.hidden) {
          const project = await buildProject(topDir.path, topMarkers, pMeta);
          looseProjects.push({ kind: 'project', project });
        }
        continue;
      }

      const result = await scanDirectory(topDir.path, scanDepth - 1, new Set(), shelfMeta);
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
        // Count total projects across all items
        const totalProjects = items.reduce((n, item) =>
          n + (item.kind === 'project' ? 1 : item.projects.length), 0);

        // Single-project shelves get absorbed into loose projects
        if (totalProjects === 1) {
          for (const item of items) {
            if (item.kind === 'project') {
              const prefixed = { ...item.project, name: `${topDir.name}/${item.project.name}` };
              looseProjects.push({ kind: 'project', project: prefixed });
            } else {
              for (const p of item.projects) {
                const prefixed = { ...p, name: `${topDir.name}/${p.name}` };
                looseProjects.push({ kind: 'project', project: prefixed });
              }
            }
          }
        } else {
          items.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'bookset' ? -1 : 1;
            if (a.kind === 'project' && b.kind === 'project') {
              return b.project.lastModified - a.project.lastModified;
            }
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

    // Add collected loose projects as a single "Projects" shelf
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
