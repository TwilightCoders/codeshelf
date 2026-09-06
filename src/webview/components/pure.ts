/**
 * Pure utility functions extracted from helpers.ts for testability.
 * No VS Code API dependency — safe to import in vitest.
 */
import type { ShelfItem, Project } from '../../shared/types';

export const LANGUAGE_ICONS: Record<string, string> = {
  javascript: 'JS', ruby: 'RB', rust: 'RS', go: 'GO', python: 'PY',
  elixir: 'EX', java: 'JV', cpp: 'C+', csharp: 'C#', swift: 'SW',
  php: 'PH', dart: 'DT', deno: 'DN', make: 'MK',
};

export const LANGUAGE_COLORS: Record<string, string> = {
  javascript: '#f7df1e', ruby: '#cc342d', rust: '#dea584', go: '#00add8',
  python: '#3776ab', elixir: '#6e4a7e', java: '#ed8b00', cpp: '#00599c',
  csharp: '#68217a', swift: '#fa7343', php: '#777bb4', dart: '#0175c2',
  deno: '#000000', make: '#6d8086',
};

export function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 40%, 35%)`;
}

export function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Does a project match the query, by name, keyword tag, or indexed doc corpus?
 * `q` is expected already lowercased + trimmed (callers do this once).
 *
 * Tags are matched explicitly: they're rendered as chips on every card, so they
 * read as a "click/type this to find it" affordance — searching one and getting
 * nothing was the single most common way search felt broken.
 */
export function projectMatchesQuery(p: Project, q: string): boolean {
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  if (p.tags?.some(t => t.toLowerCase().includes(q))) return true;
  return !!p.searchText && p.searchText.toLowerCase().includes(q);
}

/**
 * A short readable excerpt of `text` around the first case-insensitive match of
 * `q`, with ellipses, or undefined if there's no match. Used to show *why* a
 * content search hit.
 */
export function matchSnippet(text: string | undefined, q: string, radius = 40): string | undefined {
  if (!text || !q) return undefined;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return undefined;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s;
}

export function collectProjects(items: ShelfItem[]): Project[] {
  const projects: Project[] = [];
  for (const item of items) {
    if (item.kind === 'project') projects.push(item.project);
    else projects.push(...item.projects);
  }
  return projects;
}

export function flattenBooksets(items: ShelfItem[]): ShelfItem[] {
  const result: ShelfItem[] = [];
  for (const item of items) {
    if (item.kind === 'project') {
      result.push(item);
    } else {
      for (const p of item.projects) {
        result.push({ kind: 'project', project: { ...p, name: `${item.name}/${p.name}` } });
      }
    }
  }
  return result;
}

export type SortBy = 'date' | 'name' | 'language';

/** Narrow an arbitrary string (e.g. a <select> value) to a SortBy. */
export function asSortBy(value: string): SortBy {
  switch (value) {
    case 'name': return 'name';
    case 'language': return 'language';
    default: return 'date';
  }
}

// Starred projects always come first; ties broken by the chosen mode.
export function sortProjects(projects: Project[], sortBy: SortBy = 'date'): Project[] {
  return [...projects].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    switch (sortBy) {
      case 'name': return a.name.localeCompare(b.name);
      case 'language': return (a.primaryLanguage ?? '').localeCompare(b.primaryLanguage ?? '');
      default: return b.lastModified - a.lastModified;
    }
  });
}
