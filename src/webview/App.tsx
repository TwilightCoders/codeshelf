import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback } from 'react';
import type { ExtToWebview, WebviewToExt, Shelf, Project, ScanDiff } from '../shared/types';

// VS Code API
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function postMsg(msg: WebviewToExt) {
  vscode.postMessage(msg);
}

// ── App State ──

interface AppState {
  screen: 'setup' | 'shelf' | 'loading';
  shelves: Shelf[];
  booksetThreshold: number;
  syncText: string;
  syncVisible: boolean;
}

// ── App Component ──

function App() {
  const [state, setState] = useState<AppState>({
    screen: 'loading',
    shelves: [],
    booksetThreshold: 8,
    syncText: '',
    syncVisible: false,
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Message handler
  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'settings:state':
          setState(s => ({
            ...s,
            screen: msg.hasRoots ? 'loading' : 'setup',
            booksetThreshold: msg.booksetThreshold,
          }));
          break;
        case 'projects:scanning':
          if (msg.scanning) {
            setState(s => s.shelves.length === 0 ? { ...s, screen: 'loading' } : { ...s, syncText: 'syncing...', syncVisible: true });
          }
          break;
        case 'projects:loaded':
          setState(s => ({ ...s, screen: 'shelf', shelves: msg.shelves }));
          showSyncResult(msg.diff);
          break;
        case 'poster:generating':
          // TODO: forge animation via state
          break;
        case 'poster:loaded':
          // Update the poster in shelf data
          setState(s => ({
            ...s,
            shelves: s.shelves.map(shelf => ({
              ...shelf,
              items: shelf.items.map(item => {
                if (item.kind === 'project' && item.project.path === msg.projectPath) {
                  return { ...item, project: { ...item.project, poster: msg.posterUri } };
                }
                if (item.kind === 'bookset') {
                  return {
                    ...item,
                    projects: item.projects.map(p =>
                      p.path === msg.projectPath ? { ...p, poster: msg.posterUri } : p
                    ),
                  };
                }
                return item;
              }),
            })),
          }));
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Signal ready on mount
  useEffect(() => {
    postMsg({ type: 'ready' });
  }, []);

  const showSyncResult = useCallback((diff?: ScanDiff) => {
    const text = !diff ? 'updated'
      : !diff.changed ? 'up to date'
      : `updated: ${[diff.added > 0 && `+${diff.added} new`, diff.removed > 0 && `-${diff.removed} removed`].filter(Boolean).join(', ')}`;
    setState(s => ({ ...s, syncText: text, syncVisible: true }));
    setTimeout(() => setState(s => ({ ...s, syncVisible: false })), 3000);
  }, []);

  if (state.screen === 'setup') {
    return <SetupScreen />;
  }

  if (state.screen === 'loading') {
    return <LoadingScreen />;
  }

  return (
    <ShelfScreen
      shelves={state.shelves}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      syncText={state.syncText}
      syncVisible={state.syncVisible}
      booksetThreshold={state.booksetThreshold}
    />
  );
}

// ── Setup Screen ──

function SetupScreen() {
  return (
    <div className="screen" style={{ display: 'flex' }}>
      <div className="setup-container">
        <h1 className="setup-title">CodeShelf</h1>
        <p className="setup-subtitle">Your projects, organized beautifully.</p>
        <p className="setup-description">
          To get started, choose the root directory where your projects live.
        </p>
        <button className="btn btn-primary" onClick={() => postMsg({ type: 'settings:pickRoot' })}>
          Choose Directory
        </button>
      </div>
    </div>
  );
}

// ── Loading Screen ──

function LoadingScreen() {
  return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <div className="loading-spinner" />
      <p className="loading-text">Scanning projects...</p>
    </div>
  );
}

// ── Shelf Screen (placeholder — will be decomposed further) ──

interface ShelfScreenProps {
  shelves: Shelf[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  syncText: string;
  syncVisible: boolean;
  booksetThreshold: number;
}

function ShelfScreen({ shelves, searchQuery, onSearchChange, syncText, syncVisible, booksetThreshold }: ShelfScreenProps) {
  return (
    <div className="screen" style={{ display: 'flex' }}>
      <header className="shelf-header">
        <h1 className="shelf-logo">CodeShelf</h1>
        <div className="shelf-controls">
          <span className={`sync-status ${syncVisible ? 'visible' : ''}`}>{syncText}</span>
          <div className="search-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => onSearchChange('')}>&times;</button>
            )}
          </div>
          <button className="btn btn-ghost" title="Add another root directory" onClick={() => postMsg({ type: 'settings:pickRoot' })}>
            <i className="codicon codicon-add" />
          </button>
          <button className="btn btn-ghost" title="Rescan projects" onClick={() => postMsg({ type: 'projects:requestScan' })}>
            <i className="codicon codicon-refresh" />
          </button>
          <button className="btn btn-ghost" title="Edit settings (JSON)" onClick={() => postMsg({ type: 'settings:openJson' })}>
            <i className="codicon codicon-settings-gear" />
          </button>
          <button className="btn btn-ghost" title="Show walkthrough">
            <i className="codicon codicon-lightbulb" />
          </button>
        </div>
      </header>
      <div className="shelf-content">
        <PlaceholderShelfContent shelves={shelves} query={searchQuery} />
      </div>
    </div>
  );
}

// ── Placeholder: renders shelves as raw HTML for now ──
// This will be replaced with proper React components incrementally

function PlaceholderShelfContent({ shelves, query }: { shelves: Shelf[]; query: string }) {
  // For now, render a simple list to verify React is working
  const q = query.toLowerCase().trim();

  const grouped = new Map<string, Shelf[]>();
  for (const shelf of shelves) {
    if (shelf.hidden) continue;
    const key = shelf.rootLabel;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(shelf);
  }

  if (grouped.size === 0) {
    return <p className="empty-state">No projects found.</p>;
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([rootLabel, rootShelves]) => {
        const hiddenShelves = shelves.filter(s => s.hidden && s.rootLabel === rootLabel);
        return (
          <RootGroup
            key={rootLabel}
            label={rootLabel}
            shelves={rootShelves}
            hiddenShelves={hiddenShelves}
            query={q}
          />
        );
      })}
    </>
  );
}

// ── Root Group ──

function RootGroup({ label, shelves, hiddenShelves, query }: {
  label: string;
  shelves: Shelf[];
  hiddenShelves: Shelf[];
  query: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`root-group ${collapsed ? 'collapsed' : ''}`}>
      <h2 className="root-header" onClick={() => setCollapsed(!collapsed)}>
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`}>&#9656;</span>
        {label}
        {hiddenShelves.length > 0 && (
          <span className="hidden-pills">
            {hiddenShelves.map(s => (
              <button key={s.path} className="hidden-pill" title={`Show ${s.name}`}>
                {s.name}
              </button>
            ))}
          </span>
        )}
      </h2>
      {!collapsed && (
        <div className="root-shelves">
          {shelves.map(shelf => (
            <ShelfRow key={shelf.path} shelf={shelf} query={query} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shelf Row (minimal for now) ──

function ShelfRow({ shelf, query }: { shelf: Shelf; query: string }) {
  const [collapsed, setCollapsed] = useState(false);

  // Collect all projects
  const allProjects: Project[] = [];
  for (const item of shelf.items) {
    if (item.kind === 'project') allProjects.push(item.project);
    else allProjects.push(...item.projects);
  }

  // Filter
  const filtered = query
    ? allProjects.filter(p => p.name.toLowerCase().includes(query) || shelf.name.toLowerCase().includes(query))
    : allProjects;

  if (filtered.length === 0) return null;

  // Sort: starred first
  filtered.sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return b.lastModified - a.lastModified;
  });

  const isCompact = filtered.length <= 3;

  return (
    <section className={`shelf-row ${collapsed ? 'collapsed' : ''} ${isCompact ? 'shelf-compact' : ''} ${shelf.starred ? 'starred-shelf' : ''}`} data-shelf-path={shelf.path}>
      <h3 className="shelf-row-title">
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`} onClick={() => setCollapsed(!collapsed)}>&#9656;</span>
        {shelf.name}
        <span className="shelf-actions">
          <button className={`action-btn star-btn ${shelf.starred ? 'starred' : ''}`} title="Star shelf" onClick={e => {
            e.stopPropagation();
            postMsg({ type: 'item:star', path: shelf.path, rootPath: shelf.rootPath, starred: !shelf.starred });
          }}>
            <i className={`codicon codicon-star-${shelf.starred ? 'full' : 'empty'}`} />
          </button>
          <button className="action-btn hide-btn" title="Hide shelf" onClick={e => {
            e.stopPropagation();
            postMsg({ type: 'item:hide', path: shelf.path, rootPath: shelf.rootPath, hidden: true });
          }}>
            <i className="codicon codicon-eye-closed" />
          </button>
          <button className="action-btn edit-btn" title="Edit shelf metadata" onClick={e => {
            e.stopPropagation();
            postMsg({ type: 'item:editMeta', path: shelf.path });
          }}>
            <i className="codicon codicon-edit" />
          </button>
          <button className="action-btn reveal-btn" title="Reveal in Finder" onClick={e => {
            e.stopPropagation();
            postMsg({ type: 'folder:reveal', path: shelf.path });
          }}>
            <i className="codicon codicon-folder-opened" />
          </button>
        </span>
      </h3>
      {!collapsed && (
        <div className="shelf-row-content">
          {filtered.map(project => (
            <ProjectCard key={project.path} project={project} rootPath={shelf.rootPath} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Project Card ──

const LANGUAGE_ICONS: Record<string, string> = {
  javascript: 'JS', ruby: 'RB', rust: 'RS', go: 'GO', python: 'PY',
  elixir: 'EX', java: 'JV', cpp: 'C+', csharp: 'C#', swift: 'SW',
  php: 'PH', dart: 'DT', deno: 'DN', make: 'MK',
};

const LANGUAGE_COLORS: Record<string, string> = {
  javascript: '#f7df1e', ruby: '#cc342d', rust: '#dea584', go: '#00add8',
  python: '#3776ab', elixir: '#6e4a7e', java: '#ed8b00', cpp: '#00599c',
  csharp: '#68217a', swift: '#fa7343', php: '#777bb4', dart: '#0175c2',
  deno: '#000000', make: '#6d8086',
};

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 40%, 35%)`;
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

function ProjectCard({ project, rootPath }: { project: Project; rootPath: string }) {
  const lang = project.primaryLanguage;
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const hasPoster = !!project.poster;

  return (
    <div
      className={`project-card ${hasPoster ? 'has-poster' : ''}`}
      title={project.path}
      onClick={() => {/* TODO: show detail modal */}}
    >
      <div className={`card-poster-flip ${hasPoster ? 'flipped' : ''}`}>
        <div className="card-poster-face card-poster-fallback" style={{ backgroundColor: bgColor }}>
          {badge && <span className="card-badge">{badge}</span>}
        </div>
        {hasPoster && (
          <div className="card-poster-face card-poster-image" dangerouslySetInnerHTML={{ __html: project.poster! }} />
        )}
      </div>
      <div className="card-overlay">
        <button className={`action-btn star-btn ${project.starred ? 'starred' : ''}`} title="Star" onClick={e => {
          e.stopPropagation();
          postMsg({ type: 'item:star', path: project.path, rootPath, starred: !project.starred });
        }}>
          <i className={`codicon codicon-star-${project.starred ? 'full' : 'empty'}`} />
        </button>
        <button className="action-btn hide-btn" title="Hide" onClick={e => {
          e.stopPropagation();
          postMsg({ type: 'item:hide', path: project.path, rootPath, hidden: true });
        }}>
          <i className="codicon codicon-eye-closed" />
        </button>
      </div>
      <button className="card-open-btn action-btn" title="Open project" onClick={e => {
        e.stopPropagation();
        postMsg({ type: 'project:open', path: project.path, workspaceFile: project.workspaceFile });
      }}>
        <i className="codicon codicon-folder" /><i className="codicon codicon-folder-opened" />
      </button>
      <div className="card-info">
        <span className="card-name">{project.name}</span>
        {project.description && <p className="card-description">{project.description}</p>}
        <div className="card-meta">
          {project.gitBranch && (
            <span className="card-branch"><i className="codicon codicon-git-branch" /> {project.gitBranch}</span>
          )}
          <span className="card-time">{timeAgo(project.lastModified)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Mount ──

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
