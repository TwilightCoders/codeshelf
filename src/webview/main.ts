import { ExtToWebview, WebviewToExt, Shelf, ShelfItem, Project, ScanDiff } from '../shared/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface ViewState {
  collapsedRoots: Record<string, boolean>;
  collapsedShelves: Record<string, boolean>;
}

const vscode = acquireVsCodeApi();

function loadState(): ViewState {
  const saved = vscode.getState() as ViewState | null;
  return saved ?? { collapsedRoots: {}, collapsedShelves: {} };
}

let viewState = loadState();

function saveState() {
  vscode.setState(viewState);
}

const LANGUAGE_ICONS: Record<string, string> = {
  javascript: 'JS',
  ruby: 'RB',
  rust: 'RS',
  go: 'GO',
  python: 'PY',
  elixir: 'EX',
  java: 'JV',
  cpp: 'C+',
  csharp: 'C#',
  swift: 'SW',
  php: 'PH',
  dart: 'DT',
  deno: 'DN',
  make: 'MK',
};

const LANGUAGE_COLORS: Record<string, string> = {
  javascript: '#f7df1e',
  ruby: '#cc342d',
  rust: '#dea584',
  go: '#00add8',
  python: '#3776ab',
  elixir: '#6e4a7e',
  java: '#ed8b00',
  cpp: '#00599c',
  csharp: '#68217a',
  swift: '#fa7343',
  php: '#777bb4',
  dart: '#0175c2',
  deno: '#000000',
  make: '#6d8086',
};

let allShelves: Shelf[] = [];
let syncFadeTimer: ReturnType<typeof setTimeout> | undefined;

// Elements
const setupScreen = document.getElementById('setup')!;
const shelfScreen = document.getElementById('shelf')!;
const loadingScreen = document.getElementById('loading')!;
const shelfContent = document.getElementById('shelfContent')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchClear = document.getElementById('searchClear')!;
const syncStatus = document.getElementById('syncStatus')!;
const pickRootBtn = document.getElementById('pickRootBtn')!;
const addRootBtn = document.getElementById('addRootBtn')!;
const refreshBtn = document.getElementById('refreshBtn')!;

function showScreen(screen: 'setup' | 'shelf' | 'loading') {
  setupScreen.style.display = screen === 'setup' ? 'flex' : 'none';
  shelfScreen.style.display = screen === 'shelf' ? 'flex' : 'none';
  loadingScreen.style.display = screen === 'loading' ? 'flex' : 'none';
}

function showSyncStatus(text: string, persistent: boolean = false) {
  if (syncFadeTimer) clearTimeout(syncFadeTimer);
  syncStatus.textContent = text;
  syncStatus.classList.remove('fade-out');
  syncStatus.classList.add('visible');

  if (!persistent) {
    syncFadeTimer = setTimeout(() => {
      syncStatus.classList.add('fade-out');
      syncFadeTimer = setTimeout(() => {
        syncStatus.classList.remove('visible', 'fade-out');
      }, 600);
    }, 3000);
  }
}

function showSyncScanning() {
  showSyncStatus('syncing...', true);
}

function showSyncResult(diff?: ScanDiff) {
  if (!diff) {
    showSyncStatus('updated');
    return;
  }
  if (!diff.changed) {
    showSyncStatus('up to date');
    return;
  }
  const parts: string[] = [];
  if (diff.added > 0) parts.push(`+${diff.added} new`);
  if (diff.removed > 0) parts.push(`-${diff.removed} removed`);
  showSyncStatus(`updated: ${parts.join(', ')}`);
}

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 40%, 35%)`;
}

function timeAgo(ms: number): string {
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

function renderProjectCard(project: Project): string {
  const lang = project.primaryLanguage;
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const branch = project.gitBranch ? `<span class="card-branch">${project.gitBranch}</span>` : '';
  const modified = `<span class="card-time">${timeAgo(project.lastModified)}</span>`;
  const desc = project.description ? `<p class="card-description">${project.description}</p>` : '';

  return `
    <div class="project-card" data-path="${project.path}" ${project.workspaceFile ? `data-workspace="${project.workspaceFile}"` : ''} title="${project.path}">
      <div class="card-poster" style="background-color: ${bgColor}">
        ${badge ? `<span class="card-badge">${badge}</span>` : ''}
        <button class="edit-btn card-edit" data-edit-path="${project.path}" title="Edit project metadata">&#9998;</button>
      </div>
      <div class="card-info">
        <span class="card-name">${project.name}</span>
        ${desc}
        <div class="card-meta">
          ${branch}
          ${modified}
        </div>
      </div>
    </div>
  `;
}

function renderBookset(item: Extract<ShelfItem, { kind: 'bookset' }>): string {
  const cards = item.projects
    .sort((a, b) => b.lastModified - a.lastModified)
    .map(renderProjectCard)
    .join('');

  return `
    <div class="bookset">
      <div class="bookset-header">
        <span class="bookset-name">${item.name}</span>
        <span class="bookset-count">${item.projects.length}</span>
      </div>
      <div class="bookset-projects">${cards}</div>
    </div>
  `;
}

function renderShelf(shelf: Shelf, query: string): string {
  const shelfMatches = query && shelf.name.toLowerCase().includes(query);

  const filteredItems = query && !shelfMatches
    ? shelf.items.map(item => {
        if (item.kind === 'project') {
          return item.project.name.toLowerCase().includes(query) ? item : null;
        }
        if (item.name.toLowerCase().includes(query)) return item;
        const filtered = item.projects.filter(p => p.name.toLowerCase().includes(query));
        return filtered.length > 0 ? { ...item, projects: filtered } : null;
      }).filter(Boolean) as ShelfItem[]
    : shelf.items;

  if (filteredItems.length === 0) return '';

  const content = filteredItems.map(item => {
    if (item.kind === 'project') return renderProjectCard(item.project);
    return renderBookset(item);
  }).join('');

  const isCollapsed = viewState.collapsedShelves[shelf.path] ?? false;
  const arrowClass = isCollapsed ? 'collapse-arrow collapsed' : 'collapse-arrow';

  return `
    <section class="shelf-row ${isCollapsed ? 'collapsed' : ''}" data-shelf-path="${shelf.path}">
      <h3 class="shelf-row-title">
        <span class="shelf-collapse ${arrowClass}" data-collapse-shelf="${shelf.path}">&#9656;</span>
        ${shelf.name}
        <button class="edit-btn shelf-edit" data-edit-path="${shelf.path}" title="Edit shelf metadata">&#9998;</button>
      </h3>
      <div class="shelf-row-content ${isCollapsed ? 'hidden' : ''}">${content}</div>
    </section>
  `;
}

function groupShelvesByRoot(shelves: Shelf[]): Map<string, Shelf[]> {
  const groups = new Map<string, Shelf[]>();
  for (const shelf of shelves) {
    const key = shelf.rootLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shelf);
  }
  return groups;
}

function renderShelves(query: string = '') {
  const q = query.toLowerCase().trim();

  const rootGroups = groupShelvesByRoot(allShelves);
  let html = '';

  for (const [rootLabel, shelves] of rootGroups) {
    // If searching and root label matches, show all shelves in this root
    const rootMatches = q && rootLabel.toLowerCase().includes(q);

    const shelfHtml = shelves
      .map(s => renderShelf(s, rootMatches ? '' : q))
      .filter(h => h.length > 0)
      .join('');

    if (!shelfHtml) continue;

    const isCollapsed = viewState.collapsedRoots[rootLabel] ?? false;
    const arrowClass = isCollapsed ? 'collapse-arrow collapsed' : 'collapse-arrow';

    html += `
      <div class="root-group ${isCollapsed ? 'collapsed' : ''}" data-root-label="${rootLabel}">
        <h2 class="root-header">
          <span class="root-collapse ${arrowClass}" data-collapse-root="${rootLabel}">&#9656;</span>
          ${rootLabel}
        </h2>
        <div class="root-shelves ${isCollapsed ? 'hidden' : ''}">${shelfHtml}</div>
      </div>
    `;
  }

  shelfContent.innerHTML = html || '<p class="empty-state">No projects found.</p>';
  attachHandlers();
}

function attachHandlers() {
  // Project card clicks
  shelfContent.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.edit-btn')) return;
      const el = card as HTMLElement;
      const projectPath = el.dataset.path;
      if (projectPath) {
        vscode.postMessage({
          type: 'project:open',
          path: projectPath,
          workspaceFile: el.dataset.workspace,
        });
      }
    });
  });

  // Edit buttons
  shelfContent.querySelectorAll('.edit-btn[data-edit-path]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const editPath = (btn as HTMLElement).dataset.editPath;
      if (editPath) {
        vscode.postMessage({ type: 'item:editMeta', path: editPath });
      }
    });
  });

  // Root collapse toggles
  shelfContent.querySelectorAll('.root-collapse').forEach(el => {
    el.addEventListener('click', () => {
      const rootLabel = (el as HTMLElement).dataset.collapseRoot!;
      viewState.collapsedRoots[rootLabel] = !viewState.collapsedRoots[rootLabel];
      saveState();
      renderShelves(searchInput.value);
    });
  });

  // Shelf collapse toggles
  shelfContent.querySelectorAll('.shelf-collapse').forEach(el => {
    el.addEventListener('click', () => {
      const shelfPath = (el as HTMLElement).dataset.collapseShelf!;
      viewState.collapsedShelves[shelfPath] = !viewState.collapsedShelves[shelfPath];
      saveState();
      renderShelves(searchInput.value);
    });
  });
}

// Event listeners
pickRootBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'settings:pickRoot' });
});

addRootBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'settings:pickRoot' });
});

refreshBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'projects:requestScan' });
});

searchInput.addEventListener('input', () => {
  searchClear.style.display = searchInput.value ? 'block' : 'none';
  renderShelves(searchInput.value);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  renderShelves();
  searchInput.focus();
});

// Message handler
window.addEventListener('message', (event: MessageEvent<ExtToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'settings:state':
      if (msg.hasRoots) {
        showScreen('loading');
      } else {
        showScreen('setup');
      }
      break;
    case 'projects:scanning':
      if (msg.scanning && allShelves.length === 0) {
        showScreen('loading');
      } else if (msg.scanning) {
        showSyncScanning();
      }
      break;
    case 'projects:loaded':
      allShelves = msg.shelves;
      renderShelves(searchInput.value);
      showScreen('shelf');
      showSyncResult(msg.diff);
      break;
  }
});

// Signal ready
vscode.postMessage({ type: 'ready' });
