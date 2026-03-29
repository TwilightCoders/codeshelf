import { ExtToWebview, WebviewToExt, Shelf, ShelfItem, Project } from '../shared/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

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

// Elements
const setupScreen = document.getElementById('setup')!;
const shelfScreen = document.getElementById('shelf')!;
const loadingScreen = document.getElementById('loading')!;
const shelfContent = document.getElementById('shelfContent')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const pickRootBtn = document.getElementById('pickRootBtn')!;
const addRootBtn = document.getElementById('addRootBtn')!;
const refreshBtn = document.getElementById('refreshBtn')!;

function showScreen(screen: 'setup' | 'shelf' | 'loading') {
  setupScreen.style.display = screen === 'setup' ? 'flex' : 'none';
  shelfScreen.style.display = screen === 'shelf' ? 'flex' : 'none';
  loadingScreen.style.display = screen === 'loading' ? 'flex' : 'none';
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
    <div class="project-card" data-path="${project.path}" title="${project.path}">
      <div class="card-poster" style="background-color: ${bgColor}">
        ${badge ? `<span class="card-badge">${badge}</span>` : ''}
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
  // If the shelf name itself matches, show everything in it
  const shelfMatches = query && shelf.name.toLowerCase().includes(query);

  const filteredItems = query && !shelfMatches
    ? shelf.items.map(item => {
        if (item.kind === 'project') {
          return item.project.name.toLowerCase().includes(query) ? item : null;
        }
        // If the bookset name matches, show all its projects
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

  return `
    <section class="shelf-row">
      <h2 class="shelf-row-title">${shelf.name}</h2>
      <div class="shelf-row-content">${content}</div>
    </section>
  `;
}

function renderShelves(query: string = '') {
  const q = query.toLowerCase().trim();
  const html = allShelves.map(s => renderShelf(s, q)).join('');
  shelfContent.innerHTML = html || '<p class="empty-state">No projects found.</p>';

  // Attach click handlers
  shelfContent.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const projectPath = (card as HTMLElement).dataset.path;
      if (projectPath) {
        vscode.postMessage({ type: 'project:open', path: projectPath });
      }
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
  renderShelves(searchInput.value);
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
      }
      break;
    case 'projects:loaded':
      allShelves = msg.shelves;
      renderShelves(searchInput.value);
      showScreen('shelf');
      break;
  }
});

// Signal ready
vscode.postMessage({ type: 'ready' });
