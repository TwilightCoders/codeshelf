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

// ── Heat & age bands ──
//
// The library is 297 projects of which ~39 were touched in the last 90 days and
// the median is over a year cold. Age is therefore the most useful single signal
// there is, and both the Workbench and Timeline views are built on it.

const DAY = 86_400_000;

export type Heat = 'hot' | 'warm' | 'cool' | 'cold' | 'frozen';

/** Where a project sits on the hot→frozen scale, by days since last touched. */
export function heatOf(lastModified: number, now = Date.now()): Heat {
  const days = (now - lastModified) / DAY;
  if (days < 2) return 'hot';
  if (days < 14) return 'warm';
  if (days < 60) return 'cool';
  if (days < 365) return 'cold';
  return 'frozen';
}

export interface AgeBand {
  id: string;
  label: string;
  hint: string;
  /** Upper bound in days; Infinity for the last band. */
  maxDays: number;
}

export const AGE_BANDS: AgeBand[] = [
  { id: 'today', label: 'Today', hint: 'last 24h', maxDays: 1 },
  { id: 'week', label: 'This week', hint: '1–6 days', maxDays: 7 },
  { id: 'month', label: 'This month', hint: '1–4 wks', maxDays: 31 },
  { id: 'months', label: 'Months', hint: '2–5 mo', maxDays: 182 },
  { id: 'year', label: 'This year', hint: '6–12 mo', maxDays: 365 },
  { id: 'deep', label: 'The deep past', hint: '> 1 yr', maxDays: Infinity },
];

/** The band a project falls into. Always returns one — the last is unbounded. */
export function bandOf(lastModified: number, now = Date.now()): AgeBand {
  const days = (now - lastModified) / DAY;
  return AGE_BANDS.find(b => days < b.maxDays) ?? AGE_BANDS[AGE_BANDS.length - 1];
}

/** Group projects into age bands, newest first, dropping empty bands. */
export function groupByAge<T extends { lastModified: number }>(
  projects: T[],
  now = Date.now(),
): Array<{ band: AgeBand; projects: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const p of projects) {
    const id = bandOf(p.lastModified, now).id;
    const list = buckets.get(id);
    if (list) list.push(p); else buckets.set(id, [p]);
  }
  return AGE_BANDS
    .map(band => ({ band, projects: (buckets.get(band.id) ?? []).sort((a, b) => b.lastModified - a.lastModified) }))
    .filter(g => g.projects.length > 0);
}
