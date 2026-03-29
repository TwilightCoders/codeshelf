export interface Project {
  name: string;
  path: string;
  markers: string[];
  primaryLanguage?: string;
  gitBranch?: string;
  lastModified: number;
  poster?: string;
  description?: string;
  workspaceFile?: string;
}

export interface Shelf {
  name: string;
  path: string;
  rootLabel: string;
  items: ShelfItem[];
}

export type ShelfItem =
  | { kind: 'project'; project: Project }
  | { kind: 'bookset'; name: string; path: string; projects: Project[] };

// ── Settings schema ──

export interface ProjectMeta {
  name?: string;
  description?: string;
  poster?: string;
  tags?: string[];
}

export interface ShelfMeta {
  name?: string;
  description?: string;
  hidden?: boolean;
  projects?: Record<string, ProjectMeta>;
}

export interface RootConfig {
  label?: string;
  defaultVisibility?: 'show-all' | 'hide-all';
  filter?: {
    order?: string;
  };
  shelves?: Record<string, ShelfMeta>;
}

// codeshelf.roots — keyed by absolute path
export type RootsConfig = Record<string, RootConfig>;

// Extension -> Webview
export type ExtToWebview =
  | { type: 'projects:loaded'; shelves: Shelf[]; diff?: ScanDiff }
  | { type: 'projects:scanning'; scanning: boolean }
  | { type: 'settings:state'; hasRoots: boolean };

export interface ScanDiff {
  added: number;
  removed: number;
  changed: boolean;
}

// Webview -> Extension
export type WebviewToExt =
  | { type: 'projects:requestScan' }
  | { type: 'project:open'; path: string; workspaceFile?: string }
  | { type: 'settings:addRoot'; path: string }
  | { type: 'settings:pickRoot' }
  | { type: 'item:editMeta'; path: string }
  | { type: 'ready' };
