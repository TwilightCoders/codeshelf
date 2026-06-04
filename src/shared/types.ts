export interface Project {
  name: string;
  path: string;
  markers: string[];
  primaryLanguage?: string;
  gitBranch?: string;
  lastModified: number;
  poster?: string;
  posterPrompt?: string;
  description?: string;
  workspaceFile?: string;
  starred?: boolean;
  // Capped, cleaned text corpus (README excerpt + manifest blurb) the search
  // matches against, so a project can be found by what it is, not just its name.
  searchText?: string;
  // Top distinctive terms (TF-IDF over the whole library), shown as chips.
  tags?: string[];
  // Transient: candidate term→count map used to compute `tags` during the scan.
  // Stripped before the shelves are cached/sent to the webview.
  tagCounts?: Record<string, number>;
}

export interface Shelf {
  name: string;
  path: string;
  rootLabel: string;
  rootPath: string;
  starred?: boolean;
  hidden?: boolean;
  flatten?: 'auto' | 'always' | 'never';
  items: ShelfItem[];
}

export type ShelfItem =
  | { kind: 'project'; project: Project }
  | { kind: 'bookset'; name: string; path: string; projects: Project[] };

// Narrowed views of the ShelfItem union, for code/tests that have already
// established which variant they hold (avoids `as` assertions on the union).
export type ProjectItem = Extract<ShelfItem, { kind: 'project' }>;
export type BooksetItem = Extract<ShelfItem, { kind: 'bookset' }>;

// ── Settings schema ──

export interface ProjectMeta {
  name?: string;
  description?: string;
  poster?: string;
  tags?: string[];
  hidden?: boolean;
  starred?: boolean;
}

export interface ShelfMeta {
  name?: string;
  description?: string;
  hidden?: boolean;
  starred?: boolean;
  flatten?: 'auto' | 'always' | 'never';
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
  | { type: 'settings:state'; hasRoots: boolean; booksetThreshold: number }
  | { type: 'poster:generating'; projectPath: string }
  | { type: 'poster:loaded'; projectPath: string; posterUri: string };

export interface ScanDiff {
  added: number;
  removed: number;
  changed: boolean;
  addedPaths: string[];
}

// Whether a starred/hidden item is a collection (shelf) or an individual
// project — the webview knows which; the host must not guess it from path depth
// (collapsed shelves are many levels deep but are still shelves).
export type ItemKind = 'shelf' | 'project';

// Webview -> Extension
export type WebviewToExt =
  | { type: 'projects:requestScan' }
  | { type: 'project:open'; path: string; workspaceFile?: string }
  | { type: 'settings:addRoot'; path: string }
  | { type: 'settings:pickRoot' }
  | { type: 'item:hide'; path: string; rootPath: string; hidden: boolean; kind: ItemKind }
  | { type: 'item:star'; path: string; rootPath: string; starred: boolean; kind: ItemKind }
  | { type: 'poster:generate'; projectPath: string; userNotes?: string }
  | { type: 'poster:cancel'; projectPath: string }
  | { type: 'poster:attach'; projectPath: string }
  | { type: 'folder:reveal'; path: string }
  | { type: 'settings:openJson' }
  | { type: 'ready' };
