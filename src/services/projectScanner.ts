import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_MARKERS, GLOB_MARKERS, SKIP_DIRS,
  LANGUAGE_PRIORITY, MANIFEST_FILE,
} from '../shared/constants';
import { Project, Shelf, ShelfItem, CodeShelfManifest } from '../shared/types';
import { getBranch } from './gitInfo';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(dir: string): Promise<CodeShelfManifest | undefined> {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as CodeShelfManifest;
  } catch {
    return undefined;
  }
}

async function detectMarkers(dir: string): Promise<string[]> {
  const found: string[] = [];

  // Check exact-name markers
  for (const marker of Object.keys(PROJECT_MARKERS)) {
    if (await exists(path.join(dir, marker))) {
      found.push(marker);
    }
  }

  // Check glob-pattern markers (*.gemspec, *.sln, etc.)
  try {
    const entries = await fs.promises.readdir(dir);
    for (const pattern of GLOB_MARKERS) {
      const ext = pattern.replace('*', '');
      if (entries.some(e => e.endsWith(ext))) {
        found.push(pattern);
      }
    }
  } catch {
    // Can't read directory — skip glob markers
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
    // Handle glob markers
    if (marker.endsWith('.gemspec')) languages.add('ruby');
    if (marker.endsWith('.sln') || marker.endsWith('.csproj')) languages.add('csharp');
    if (marker.endsWith('.xcodeproj') || marker.endsWith('.xcworkspace')) languages.add('swift');
  }
  for (const lang of LANGUAGE_PRIORITY) {
    if (languages.has(lang)) return lang;
  }
  return languages.size > 0 ? [...languages][0] : undefined;
}

async function buildProject(dir: string, markers: string[]): Promise<Project> {
  const stat = await fs.promises.stat(dir);
  const manifest = await readManifest(dir);
  const gitBranch = markers.includes('.git') ? await getBranch(dir) : undefined;

  return {
    name: manifest?.name ?? path.basename(dir),
    path: dir,
    markers,
    primaryLanguage: inferLanguage(markers),
    gitBranch,
    lastModified: stat.mtimeMs,
    poster: manifest?.poster,
    description: manifest?.description,
  };
}

async function scanDirectory(
  dir: string,
  maxDepth: number,
  hiddenSet: Set<string>,
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
      // This is a project
      projects.push(await buildProject(subdir, markers));
    } else if (currentDepth < maxDepth) {
      // Not a project — scan deeper for a bookset
      const nested = await scanDirectory(subdir, maxDepth, hiddenSet, currentDepth + 1);
      if (nested.projects.length > 0 || nested.groups.length > 0) {
        // Flatten nested groups' projects into this group
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
  roots: string[],
  hiddenPaths: string[],
  scanDepth: number,
): Promise<Shelf[]> {
  const hiddenSet = new Set(hiddenPaths.map(p => p.replace(/^~/, process.env.HOME ?? '')));
  const shelves: Shelf[] = [];

  for (const root of roots) {
    const expandedRoot = root.replace(/^~/, process.env.HOME ?? '');

    // Each top-level subdirectory of a root becomes a shelf
    let topEntries: fs.Dirent[];
    try {
      topEntries = await fs.promises.readdir(expandedRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    const topDirs = topEntries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(expandedRoot, e.name) }))
      .filter(d => !hiddenSet.has(d.path));

    for (const topDir of topDirs) {
      // Check if the top-level dir itself is a project
      const topMarkers = await detectMarkers(topDir.path);
      if (topMarkers.length > 0) {
        // It's a project at the top level — add as a single-item shelf
        const project = await buildProject(topDir.path, topMarkers);
        shelves.push({
          name: topDir.name,
          path: topDir.path,
          items: [{ kind: 'project', project }],
        });
        continue;
      }

      // It's a directory of projects — scan it to build a shelf
      const result = await scanDirectory(topDir.path, scanDepth - 1, hiddenSet);
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
        // Sort: booksets first, then projects by last modified
        items.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'bookset' ? -1 : 1;
          if (a.kind === 'project' && b.kind === 'project') {
            return b.project.lastModified - a.project.lastModified;
          }
          return 0;
        });

        shelves.push({ name: topDir.name, path: topDir.path, items });
      }
    }
  }

  return shelves;
}
