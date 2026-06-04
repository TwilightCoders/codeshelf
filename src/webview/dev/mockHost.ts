/**
 * Mock extension host for dev.html and the browser test harness.
 *
 * Simulates the real extension host message protocol so the webview can run in
 * a plain browser. Because it is type-checked against the shared WebviewToExt /
 * ExtToWebview unions, a renamed or removed message becomes a compile error
 * here too — the mock can't silently drift from the real host.
 */
import type { Shelf, Project, ScanDiff, WebviewToExt, ExtToWebview } from '../../shared/types';

interface VsCodeApi {
  postMessage: (msg: WebviewToExt) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

/** Test hooks the puppeteer harness reaches via page.evaluate(). */
export interface MockHostApi {
  getShelves: () => Shelf[];
  resetShelves: () => void;
  injectShelves: (shelves: Shelf[]) => void;
  addProject: (shelfName: string, project: Project) => void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    __mockHost?: MockHostApi;
  }
}

const BOOKSET_THRESHOLD = 8;
const DAY = 86_400_000;

let shelves: Shelf[] = [];

function post(msg: ExtToWebview): void {
  window.postMessage(msg, '*');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createMockShelves(): Shelf[] {
  return [
    {
      name: 'Apps', path: '/mock/code/Apps', rootLabel: 'Code', rootPath: '/mock/code',
      items: [
        { kind: 'project', project: { name: 'Harbor', path: '/mock/code/Apps/Harbor', markers: ['.git', '*.xcodeproj'], primaryLanguage: 'swift', gitBranch: 'master', lastModified: Date.now() - DAY } },
        { kind: 'project', project: { name: 'Snooze', path: '/mock/code/Apps/Snooze', markers: ['.git', '*.xcodeproj'], primaryLanguage: 'swift', gitBranch: 'main', lastModified: Date.now() - DAY * 3 } },
      ],
    },
    {
      name: 'Gems', path: '/mock/code/Gems', rootLabel: 'Code', rootPath: '/mock/code',
      items: [
        { kind: 'project', project: { name: 'glossary', path: '/mock/code/Gems/glossary', markers: ['.git', '*.gemspec'], primaryLanguage: 'ruby', gitBranch: 'main', lastModified: Date.now() - DAY * 2, starred: true, searchText: 'Translation toolkit for constructed languages like Esperanto and Ido. A lexicon builder.' } },
        { kind: 'project', project: { name: 'task_queue-redis', path: '/mock/code/Gems/task_queue-redis', markers: ['.git', '*.gemspec'], primaryLanguage: 'ruby', gitBranch: 'overhaul', lastModified: Date.now() - DAY * 30 } },
        { kind: 'project', project: { name: 'radio-client', path: '/mock/code/Gems/radio-client', markers: ['.git', '*.gemspec'], primaryLanguage: 'ruby', gitBranch: 'main', lastModified: Date.now() - DAY * 180 } },
        { kind: 'project', project: { name: 'created_at', path: '/mock/code/Gems/created_at', markers: ['.git', '*.gemspec'], primaryLanguage: 'ruby', gitBranch: 'main', lastModified: Date.now() - DAY * 365 } },
      ],
    },
    {
      name: 'vscode', path: '/mock/code/vscode', rootLabel: 'Code', rootPath: '/mock/code',
      items: [
        { kind: 'project', project: { name: 'termkit', path: '/mock/code/vscode/termkit', markers: ['.git', 'package.json'], primaryLanguage: 'javascript', gitBranch: 'main', lastModified: Date.now() - 3_600_000 } },
        { kind: 'project', project: { name: 'startpage', path: '/mock/code/vscode/startpage', markers: ['.git', 'package.json'], primaryLanguage: 'javascript', gitBranch: 'react-migration', lastModified: Date.now() - 600_000, workspaceFile: '/mock/code/vscode/startpage/startpage.code-workspace' } },
      ],
    },
    {
      name: 'Other', path: '/mock/Workspace/Other', rootLabel: 'Workspace', rootPath: '/mock/Workspace',
      items: [
        { kind: 'project', project: { name: 'flock', path: '/mock/Workspace/Other/flock', markers: ['.git', 'Makefile'], primaryLanguage: 'make', gitBranch: 'master', lastModified: Date.now() - DAY * 7 } },
        { kind: 'project', project: { name: 'xterm-link-provider', path: '/mock/Workspace/Other/xterm-link-provider', markers: ['.git', 'package.json'], primaryLanguage: 'javascript', gitBranch: 'fix-indexOf', lastModified: Date.now() - DAY * 14 } },
      ],
    },
    {
      name: 'Archive', path: '/mock/Workspace/Archive', rootLabel: 'Workspace', rootPath: '/mock/Workspace', hidden: true,
      items: [
        { kind: 'project', project: { name: 'old-project', path: '/mock/Workspace/Archive/old-project', markers: ['.git'], gitBranch: 'master', lastModified: Date.now() - DAY * 400 } },
      ],
    },
  ];
}

function forEachProject(cb: (project: Project, shelf: Shelf) => void): void {
  for (const shelf of shelves) {
    for (const item of shelf.items) {
      if (item.kind === 'project') cb(item.project, shelf);
      else for (const project of item.projects) cb(project, shelf);
    }
  }
}

function findShelf(path: string): Shelf | undefined {
  return shelves.find(s => s.path === path);
}

/** Remove a project from whichever shelf/bookset holds it. Returns true if found. */
function removeProject(path: string): boolean {
  for (const shelf of shelves) {
    for (let i = 0; i < shelf.items.length; i++) {
      const item = shelf.items[i];
      if (item.kind === 'project' && item.project.path === path) {
        shelf.items.splice(i, 1);
        return true;
      }
      if (item.kind === 'bookset') {
        const j = item.projects.findIndex(p => p.path === path);
        if (j !== -1) { item.projects.splice(j, 1); return true; }
      }
    }
  }
  return false;
}

function sendShelves(diff?: ScanDiff): void {
  post({ type: 'projects:loaded', shelves: clone(shelves), diff });
}

function handleMessage(msg: WebviewToExt): void {
  console.log('[postMessage]', msg.type, JSON.stringify(msg));

  switch (msg.type) {
    case 'ready':
      shelves = createMockShelves();
      setTimeout(() => post({ type: 'settings:state', hasRoots: true, booksetThreshold: BOOKSET_THRESHOLD }), 50);
      setTimeout(() => sendShelves(), 150);
      break;

    case 'item:star': {
      let found = false;
      forEachProject(project => {
        if (project.path === msg.path) { project.starred = msg.starred; found = true; }
      });
      if (!found) {
        const shelf = findShelf(msg.path);
        if (shelf) shelf.starred = msg.starred;
      }
      setTimeout(() => sendShelves(), 50);
      break;
    }

    case 'item:hide': {
      if (!removeProject(msg.path)) {
        const shelf = findShelf(msg.path);
        if (shelf) shelf.hidden = msg.hidden;
      }
      setTimeout(() => sendShelves(), 50);
      break;
    }

    case 'projects:requestScan':
      post({ type: 'projects:scanning', scanning: true });
      setTimeout(() => {
        post({ type: 'projects:scanning', scanning: false });
        sendShelves({ added: 0, removed: 0, changed: false, addedPaths: [] });
      }, 100);
      break;

    case 'poster:generate': {
      post({ type: 'poster:generating', projectPath: msg.projectPath });
      setTimeout(() => {
        const svg = '<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice"><rect width="400" height="240" fill="#2d2d3d"/><text x="200" y="130" text-anchor="middle" font-size="24" fill="#ccc">Mock Poster</text></svg>';
        forEachProject(project => { if (project.path === msg.projectPath) project.poster = svg; });
        post({ type: 'poster:loaded', projectPath: msg.projectPath, posterUri: svg });
      }, 500);
      break;
    }

    case 'poster:cancel':
      post({ type: 'poster:loaded', projectPath: msg.projectPath, posterUri: '' });
      break;

    // No response needed in the mock.
    case 'project:open':
    case 'folder:reveal':
    case 'settings:openJson':
    case 'settings:pickRoot':
    case 'settings:addRoot':
    case 'poster:attach':
      break;
  }
}

window.acquireVsCodeApi = () => ({
  postMessage: handleMessage,
  getState: () => null,
  setState: (state: unknown) => console.log('[setState]', state),
});

// Test helpers, reachable from puppeteer page.evaluate().
window.__mockHost = {
  getShelves: () => clone(shelves),
  resetShelves: () => { shelves = createMockShelves(); },
  injectShelves: (newShelves: Shelf[]) => {
    shelves = newShelves;
    sendShelves();
  },
  /** Add a project and announce it via addedPaths so the sparkle/confetti fires. */
  addProject: (shelfName: string, project: Project) => {
    const shelf = shelves.find(s => s.name === shelfName);
    if (!shelf) return;
    shelf.items.push({ kind: 'project', project });
    sendShelves({ added: 1, removed: 0, changed: true, addedPaths: [project.path] });
  },
};
