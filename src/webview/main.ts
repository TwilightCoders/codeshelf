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
let booksetThreshold = 8;
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
const settingsBtn = document.getElementById('settingsBtn')!;
const detailModal = document.getElementById('detailModal')!;
const detailPoster = document.getElementById('detailPoster')!;
const detailName = document.getElementById('detailName')!;
const detailPath = document.getElementById('detailPath')!;
const detailMeta = document.getElementById('detailMeta')!;
const detailOpen = document.getElementById('detailOpen')!;
const detailGenerate = document.getElementById('detailGenerate')!;
const detailGenerateMenu = document.getElementById('detailGenerateMenu')!;
const detailGenerateDropdown = document.getElementById('detailGenerateDropdown')!;
const detailGenerateWithPrompt = document.getElementById('detailGenerateWithPrompt')!;
const detailAttach = document.getElementById('detailAttach')!;
const detailCancelGenerate = document.getElementById('detailCancelGenerate')!;
const walkthroughBtn = document.getElementById('walkthroughBtn')!;
const promptEditor = document.getElementById('promptEditor')!;
const promptPre = document.getElementById('promptPre')!;
const promptPost = document.getElementById('promptPost')!;
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
const promptSubmit = document.getElementById('promptSubmit')!;
const promptCancel = document.getElementById('promptCancel')!;

let activeDetailProject: { project: Project; rootPath: string } | null = null;

function showScreen(screen: 'setup' | 'shelf' | 'loading') {
  setupScreen.style.display = screen === 'setup' ? 'flex' : 'none';
  shelfScreen.style.display = screen === 'shelf' ? 'flex' : 'none';
  loadingScreen.style.display = screen === 'loading' ? 'flex' : 'none';
}

function findProjectByPath(projectPath: string): { project: Project; rootPath: string } | null {
  for (const shelf of allShelves) {
    for (const item of shelf.items) {
      if (item.kind === 'project' && item.project.path === projectPath) {
        return { project: item.project, rootPath: shelf.rootPath };
      } else if (item.kind === 'bookset') {
        const found = item.projects.find(p => p.path === projectPath);
        if (found) return { project: found, rootPath: shelf.rootPath };
      }
    }
  }
  return null;
}

function showDetail(projectPath: string) {
  const result = findProjectByPath(projectPath);
  if (!result) return;
  activeDetailProject = result;
  const { project } = result;

  // Poster area
  if (project.poster) {
    detailPoster.innerHTML = project.poster;
    detailPoster.classList.add('has-poster');
  } else {
    const lang = project.primaryLanguage;
    const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
    const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
    detailPoster.innerHTML = badge ? `<span class="card-badge">${badge}</span>` : '';
    detailPoster.style.backgroundColor = bgColor;
    detailPoster.classList.remove('has-poster');
  }

  // Info
  detailName.textContent = project.name;
  detailPath.textContent = project.path;

  let metaHtml = '';
  if (project.gitBranch) {
    metaHtml += `<span class="detail-branch"><i class="codicon codicon-git-branch"></i> ${project.gitBranch}</span>`;
  }
  metaHtml += `<span class="detail-time">${timeAgo(project.lastModified)}</span>`;
  if (project.primaryLanguage) {
    metaHtml += `<span class="detail-lang">${project.primaryLanguage}</span>`;
  }
  detailMeta.innerHTML = metaHtml;

  // Update generate button tooltip
  detailGenerate.title = project.poster ? 'Regenerate poster' : 'Generate poster';

  detailModal.style.display = 'flex';
}

function hideDetail() {
  detailModal.style.display = 'none';
  promptEditor.style.display = 'none';
  activeDetailProject = null;
}

function showPromptEditor(project: Project) {
  const lang = project.primaryLanguage ?? 'software';
  const markers = project.markers.filter(m => m !== '.git').join(', ');

  promptPre.textContent = [
    `Explore the project directory to understand what "${project.name}" is about.`,
    'Read the README.md if it exists, look for logos, icons, or branding.',
    `Then generate a minimal, elegant SVG poster for this ${lang} project.`,
    '400x240px, dark background, subtle geometric elements, project name prominent.',
    'Modern technical style, like a Steam game library card.',
    markers ? `Tech detected: ${markers}` : '',
  ].filter(Boolean).join('\n');

  promptPost.textContent = [
    'Final output: ONLY raw SVG markup. 400x240px.',
    'Read-only tools allowed: Read, Glob, Grep.',
    'Final message starts with <svg, ends with </svg>.',
  ].join('\n');

  promptInput.value = project.posterPrompt ?? '';
  promptEditor.style.display = 'flex';
  promptInput.focus();
}

function hidePromptEditor() {
  promptEditor.style.display = 'none';
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

function renderProjectCard(project: Project, rootPath: string = ''): string {
  const lang = project.primaryLanguage;
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const branch = project.gitBranch ? `<span class="card-branch"><i class="codicon codicon-git-branch"></i> ${project.gitBranch}</span>` : '';
  const modified = `<span class="card-time">${timeAgo(project.lastModified)}</span>`;
  const desc = project.description ? `<p class="card-description">${project.description}</p>` : '';

  const hasPoster = !!project.poster;
  const posterFront = hasPoster
    ? `<div class="card-poster-face card-poster-image">${project.poster}</div>`
    : '';
  const posterBack = `<div class="card-poster-face card-poster-fallback" style="background-color: ${bgColor}">${badge ? `<span class="card-badge">${badge}</span>` : ''}</div>`;

  return `
    <div class="project-card ${hasPoster ? 'has-poster' : ''}" data-path="${project.path}" ${project.workspaceFile ? `data-workspace="${project.workspaceFile}"` : ''} title="${project.path}">
      <div class="card-poster-flip ${hasPoster ? 'flipped' : ''}">
        ${posterBack}
        ${posterFront}
      </div>
      <div class="card-overlay">
        <button class="action-btn star-btn ${project.starred ? 'starred' : ''}" data-star-path="${project.path}" data-root-path="${rootPath}" title="Star"><i class="codicon codicon-star-${project.starred ? 'full' : 'empty'}"></i></button>
        <button class="action-btn hide-btn" data-hide-path="${project.path}" data-root-path="${rootPath}" title="Hide"><i class="codicon codicon-eye-closed"></i></button>
        <button class="action-btn edit-btn" data-edit-path="${project.path}" title="Edit"><i class="codicon codicon-edit"></i></button>
      </div>
      <button class="card-open-btn action-btn" data-open-path="${project.path}" ${project.workspaceFile ? `data-open-workspace="${project.workspaceFile}"` : ''} title="Open project">
        <i class="codicon codicon-folder"></i><i class="codicon codicon-folder-opened"></i>
      </button>
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

function renderBookset(item: Extract<ShelfItem, { kind: 'bookset' }>, rootPath: string): string {
  const cards = item.projects
    .sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return b.lastModified - a.lastModified;
    })
    .map(p => renderProjectCard(p, rootPath))
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
  // Hidden shelves are not rendered (pills shown in root header instead)
  if (shelf.hidden) return '';

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

  // Determine if booksets should be flattened
  const allBooksets = filteredItems.every(i => i.kind === 'bookset');
  const projectCount = filteredItems.reduce((n, item) =>
    n + (item.kind === 'project' ? 1 : item.projects.length), 0);

  const shouldFlatten = shelf.flatten === 'always'
    || (shelf.flatten !== 'never' && allBooksets && projectCount <= booksetThreshold);

  let displayItems: ShelfItem[];
  if (shouldFlatten) {
    // Flatten booksets: prefix project names with bookset name
    displayItems = [];
    for (const item of filteredItems) {
      if (item.kind === 'project') {
        displayItems.push(item);
      } else {
        for (const p of item.projects) {
          displayItems.push({
            kind: 'project',
            project: { ...p, name: `${item.name}/${p.name}` },
          });
        }
      }
    }
  } else {
    displayItems = filteredItems;
  }

  const content = displayItems.map(item => {
    if (item.kind === 'project') return renderProjectCard(item.project, shelf.rootPath);
    return renderBookset(item, shelf.rootPath);
  }).join('');
  const isCollapsed = viewState.collapsedShelves[shelf.path] ?? false;
  const arrowClass = isCollapsed ? 'collapse-arrow collapsed' : 'collapse-arrow';
  const starredClass = shelf.starred ? 'starred-shelf' : '';

  return `
    <section class="shelf-row ${isCollapsed ? 'collapsed' : ''} ${starredClass} ${projectCount <= 3 ? 'shelf-compact' : ''}" data-shelf-path="${shelf.path}">
      <h3 class="shelf-row-title">
        <span class="shelf-collapse ${arrowClass}" data-collapse-shelf="${shelf.path}">&#9656;</span>
        ${shelf.name}
        <span class="shelf-actions">
          <button class="action-btn star-btn ${shelf.starred ? 'starred' : ''}" data-star-path="${shelf.path}" data-root-path="${shelf.rootPath}" title="Star shelf"><i class="codicon codicon-star-${shelf.starred ? 'full' : 'empty'}"></i></button>
          <button class="action-btn hide-btn" data-hide-path="${shelf.path}" data-root-path="${shelf.rootPath}" title="Hide shelf"><i class="codicon codicon-eye-closed"></i></button>
          <button class="action-btn edit-btn" data-edit-path="${shelf.path}" title="Edit shelf metadata"><i class="codicon codicon-edit"></i></button>
          <button class="action-btn reveal-btn" data-reveal-path="${shelf.path}" title="Reveal in Finder"><i class="codicon codicon-folder-opened"></i></button>
        </span>
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

  // Sort shelves within each root: starred first, then by name
  for (const [, group] of groups) {
    group.sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Sort roots: those with any starred content first
  const sorted = new Map<string, Shelf[]>();
  const entries = [...groups.entries()];
  entries.sort(([, a], [, b]) => {
    const aHasStarred = a.some(s => s.starred || s.items.some(
      i => i.kind === 'project' && i.project.starred
    ));
    const bHasStarred = b.some(s => s.starred || s.items.some(
      i => i.kind === 'project' && i.project.starred
    ));
    if (aHasStarred !== bHasStarred) return aHasStarred ? -1 : 1;
    return 0;
  });
  for (const [k, v] of entries) sorted.set(k, v);
  return sorted;
}

function renderShelves(query: string = '') {
  const q = query.toLowerCase().trim();

  const rootGroups = groupShelvesByRoot(allShelves);
  let html = '';

  for (const [rootLabel, shelves] of rootGroups) {
    // If searching and root label matches, show all shelves in this root
    const rootMatches = q && rootLabel.toLowerCase().includes(q);

    const hiddenInRoot = shelves.filter(s => s.hidden);
    const shelfHtml = shelves
      .map(s => renderShelf(s, rootMatches ? '' : q))
      .filter(h => h.length > 0)
      .join('');

    if (!shelfHtml && hiddenInRoot.length === 0) continue;

    const isCollapsed = viewState.collapsedRoots[rootLabel] ?? false;
    const arrowClass = isCollapsed ? 'collapse-arrow collapsed' : 'collapse-arrow';

    const hiddenPills = hiddenInRoot.map(s =>
      `<button class="hidden-pill" data-unhide-path="${s.path}" data-root-path="${s.rootPath}" title="Show ${s.name}">${s.name}</button>`
    ).join('');

    html += `
      <div class="root-group ${isCollapsed ? 'collapsed' : ''}" data-root-label="${rootLabel}">
        <h2 class="root-header">
          <span class="root-collapse ${arrowClass}" data-collapse-root="${rootLabel}">&#9656;</span>
          ${rootLabel}
          ${hiddenPills ? `<span class="hidden-pills">${hiddenPills}</span>` : ''}
        </h2>
        <div class="root-shelves ${isCollapsed ? 'hidden' : ''}">${shelfHtml}</div>
      </div>
    `;
  }

  shelfContent.innerHTML = html || '<p class="empty-state">No projects found.</p>';
  attachHandlers();
}

function attachHandlers() {
  // Project card clicks → show detail
  shelfContent.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.action-btn')) return;
      const el = card as HTMLElement;
      const projectPath = el.dataset.path;
      if (projectPath) {
        showDetail(projectPath);
      }
    });
  });

  // Folder open buttons (bottom-right of card)
  shelfContent.querySelectorAll('.card-open-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      vscode.postMessage({
        type: 'project:open',
        path: el.dataset.openPath!,
        workspaceFile: el.dataset.openWorkspace,
      });
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

  // Hide buttons
  shelfContent.querySelectorAll('.hide-btn[data-hide-path]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const hidePath = el.dataset.hidePath;
      const rootPath = el.dataset.rootPath;
      if (hidePath && rootPath) {
        vscode.postMessage({ type: 'item:hide', path: hidePath, rootPath, hidden: true });
      }
    });
  });

  // Star buttons
  shelfContent.querySelectorAll('.star-btn[data-star-path]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const starPath = el.dataset.starPath;
      const rootPath = el.dataset.rootPath;
      const isCurrentlyStarred = el.classList.contains('starred');
      if (starPath && rootPath) {
        vscode.postMessage({ type: 'item:star', path: starPath, rootPath, starred: !isCurrentlyStarred });
      }
    });
  });

  // Unhide pills
  shelfContent.querySelectorAll('.hidden-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const unhidePath = el.dataset.unhidePath;
      const rootPath = el.dataset.rootPath;
      if (unhidePath && rootPath) {
        vscode.postMessage({ type: 'item:hide', path: unhidePath, rootPath, hidden: false });
      }
    });
  });

  // Reveal in Finder buttons
  shelfContent.querySelectorAll('.reveal-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const revealPath = (btn as HTMLElement).dataset.revealPath;
      if (revealPath) {
        vscode.postMessage({ type: 'folder:reveal', path: revealPath });
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

settingsBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'settings:openJson' });
});

// Detail modal handlers
detailModal.querySelector('.detail-backdrop')!.addEventListener('click', hideDetail);
detailModal.querySelector('.detail-close')!.addEventListener('click', hideDetail);

detailOpen.addEventListener('click', () => {
  if (!activeDetailProject) return;
  const { project } = activeDetailProject;
  vscode.postMessage({
    type: 'project:open',
    path: project.path,
    workspaceFile: project.workspaceFile,
  });
});

// Sparkle button: toggle dropdown
detailGenerateMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const showing = detailGenerateDropdown.style.display !== 'none';
  detailGenerateDropdown.style.display = showing ? 'none' : 'flex';
});

// Generate (re-uses last prompt if any)
detailGenerate.addEventListener('click', () => {
  if (!activeDetailProject) return;
  detailGenerateDropdown.style.display = 'none';
  vscode.postMessage({
    type: 'poster:generate',
    projectPath: activeDetailProject.project.path,
    userNotes: activeDetailProject.project.posterPrompt || undefined,
  });
});

// Generate with prompt
detailGenerateWithPrompt.addEventListener('click', () => {
  if (!activeDetailProject) return;
  detailGenerateDropdown.style.display = 'none';
  showPromptEditor(activeDetailProject.project);
});

// Cancel generation
detailCancelGenerate.addEventListener('click', () => {
  if (!activeDetailProject) return;
  detailGenerateDropdown.style.display = 'none';
  vscode.postMessage({
    type: 'poster:cancel',
    projectPath: activeDetailProject.project.path,
  });
});

promptSubmit.addEventListener('click', () => {
  if (!activeDetailProject) return;
  const notes = promptInput.value.trim() || undefined;
  hidePromptEditor();
  vscode.postMessage({
    type: 'poster:generate',
    projectPath: activeDetailProject.project.path,
    userNotes: notes,
  });
});

promptCancel.addEventListener('click', () => {
  hidePromptEditor();
});

detailAttach.addEventListener('click', () => {
  if (!activeDetailProject) return;
  vscode.postMessage({
    type: 'poster:attach',
    projectPath: activeDetailProject.project.path,
  });
});

walkthroughBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'settings:openJson' }); // TODO: wire to walkthrough
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    detailGenerateDropdown.style.display = 'none';
    if (promptEditor.style.display !== 'none') {
      hidePromptEditor();
    } else if (activeDetailProject) {
      hideDetail();
    }
  }
});

document.addEventListener('click', () => {
  detailGenerateDropdown.style.display = 'none';
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
      booksetThreshold = msg.booksetThreshold;
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
    case 'poster:generating': {
      // Show forge animation on the card
      const forgeCard = shelfContent.querySelector(
        `.project-card[data-path="${CSS.escape(msg.projectPath)}"]`
      );
      if (forgeCard) {
        forgeCard.classList.add('forging');
      }
      // Also show on the detail modal if it's open for this project
      if (activeDetailProject?.project.path === msg.projectPath) {
        detailPoster.closest('.detail-poster')?.classList.add('forging');
      }
      // Show cancel option in dropdown
      detailCancelGenerate.style.display = 'flex';
      break;
    }
    case 'poster:loaded': {
      // Hide cancel option
      detailCancelGenerate.style.display = 'none';

      // Clear forge animation
      const forgingCard = shelfContent.querySelector(
        `.project-card.forging[data-path="${CSS.escape(msg.projectPath)}"]`
      );
      if (forgingCard) forgingCard.classList.remove('forging');
      if (activeDetailProject?.project.path === msg.projectPath) {
        detailPoster.closest('.detail-poster')?.classList.remove('forging');
        // Update the detail modal poster
        if (msg.posterUri) {
          detailPoster.innerHTML = msg.posterUri;
          detailPoster.classList.add('has-poster');
          detailPoster.style.backgroundColor = '';
          activeDetailProject.project.poster = msg.posterUri;
          detailGenerate.title = 'Regenerate poster';
        }
      }

      // Find the card and trigger a flip animation
      const card = shelfContent.querySelector(
        `.project-card[data-path="${CSS.escape(msg.projectPath)}"]`
      );
      if (!card) break;
      const flipContainer = card.querySelector('.card-poster-flip');
      if (!flipContainer) break;

      // Add the poster image face
      const imgFace = document.createElement('div');
      imgFace.className = 'card-poster-face card-poster-image';
      imgFace.innerHTML = msg.posterUri;
      flipContainer.appendChild(imgFace);

      // Trigger flip after a brief delay for the image to load
      requestAnimationFrame(() => {
        flipContainer.classList.add('flipped');
        card.classList.add('has-poster');
      });

      // Update the shelf data so re-renders preserve the poster
      for (const shelf of allShelves) {
        for (const item of shelf.items) {
          if (item.kind === 'project' && item.project.path === msg.projectPath) {
            item.project.poster = msg.posterUri;
          } else if (item.kind === 'bookset') {
            for (const p of item.projects) {
              if (p.path === msg.projectPath) p.poster = msg.posterUri;
            }
          }
        }
      }
      break;
    }
  }
});

// Signal ready
vscode.postMessage({ type: 'ready' });
