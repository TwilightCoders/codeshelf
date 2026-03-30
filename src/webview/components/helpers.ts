import type { WebviewToExt, ShelfItem, Project } from '../../shared/types';

// ── VS Code API ──

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();

export function postMsg(msg: WebviewToExt) {
  vscode.postMessage(msg);
}

// ── Language Maps ──

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

// ── Utility Functions ──

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

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return b.lastModified - a.lastModified;
  });
}
