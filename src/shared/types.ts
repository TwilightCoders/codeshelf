export interface Project {
  name: string;
  path: string;
  markers: string[];
  primaryLanguage?: string;
  gitBranch?: string;
  lastModified: number;
  poster?: string;
  description?: string;
}

export interface ProjectGroup {
  name: string;
  path: string;
  projects: Project[];
  groups: ProjectGroup[];
}

export interface Shelf {
  name: string;
  path: string;
  items: ShelfItem[];
}

export type ShelfItem =
  | { kind: 'project'; project: Project }
  | { kind: 'bookset'; name: string; path: string; projects: Project[] };

export interface CodeShelfManifest {
  name?: string;
  description?: string;
  poster?: string;
  tags?: string[];
}

// Extension -> Webview
export type ExtToWebview =
  | { type: 'projects:loaded'; shelves: Shelf[] }
  | { type: 'projects:scanning'; scanning: boolean }
  | { type: 'settings:state'; hasRoots: boolean };

// Webview -> Extension
export type WebviewToExt =
  | { type: 'projects:requestScan' }
  | { type: 'project:open'; path: string }
  | { type: 'settings:addRoot'; path: string }
  | { type: 'settings:pickRoot' }
  | { type: 'ready' };
