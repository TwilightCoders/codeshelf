import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback } from 'react';
import type { ExtToWebview, Shelf, Project, ScanDiff } from '../shared/types';
import { postMsg } from './components/helpers';
import { RootGroup } from './components/RootGroup';
import { ShelfDetailModal } from './components/ShelfDetailModal';
import { ProjectDetailModal } from './components/ProjectDetailModal';

// ── App State ──

interface AppState {
  screen: 'setup' | 'shelf' | 'loading';
  shelves: Shelf[];
  booksetThreshold: number;
  syncText: string;
  syncVisible: boolean;
  forgingPaths: Set<string>;
}

// ── App ──

function App() {
  const [state, setState] = useState<AppState>({
    screen: 'loading', shelves: [], booksetThreshold: 8,
    syncText: '', syncVisible: false, forgingPaths: new Set(),
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [projectDetail, setProjectDetail] = useState<{ project: Project; rootPath: string } | null>(null);
  const [shelfDetail, setShelfDetail] = useState<Shelf | null>(null);

  // Message handler
  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'settings:state':
          setState(s => ({ ...s, screen: msg.hasRoots ? 'loading' : 'setup', booksetThreshold: msg.booksetThreshold }));
          break;
        case 'projects:scanning':
          if (msg.scanning) setState(s => s.shelves.length === 0 ? { ...s, screen: 'loading' } : { ...s, syncText: 'syncing...', syncVisible: true });
          break;
        case 'projects:loaded':
          setState(s => ({ ...s, screen: 'shelf', shelves: msg.shelves }));
          showSyncResult(msg.diff);
          break;
        case 'poster:generating':
          setState(s => ({ ...s, forgingPaths: new Set(s.forgingPaths).add(msg.projectPath) }));
          break;
        case 'poster:loaded': {
          setState(s => {
            const newForging = new Set(s.forgingPaths);
            newForging.delete(msg.projectPath);
            return {
              ...s, forgingPaths: newForging,
              shelves: s.shelves.map(shelf => ({
                ...shelf,
                items: shelf.items.map(item => {
                  if (item.kind === 'project' && item.project.path === msg.projectPath)
                    return { ...item, project: { ...item.project, poster: msg.posterUri } };
                  if (item.kind === 'bookset')
                    return { ...item, projects: item.projects.map(p => p.path === msg.projectPath ? { ...p, poster: msg.posterUri } : p) };
                  return item;
                }),
              })),
            };
          });
          setProjectDetail(prev => prev && prev.project.path === msg.projectPath
            ? { ...prev, project: { ...prev.project, poster: msg.posterUri } } : prev);
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => { postMsg({ type: 'ready' }); }, []);

  const showSyncResult = useCallback((diff?: ScanDiff) => {
    const text = !diff ? 'updated' : !diff.changed ? 'up to date'
      : `updated: ${[diff.added > 0 && `+${diff.added} new`, diff.removed > 0 && `-${diff.removed} removed`].filter(Boolean).join(', ')}`;
    setState(s => ({ ...s, syncText: text, syncVisible: true }));
    setTimeout(() => setState(s => ({ ...s, syncVisible: false })), 3000);
  }, []);

  const findProject = useCallback((path: string): { project: Project; rootPath: string } | null => {
    for (const shelf of state.shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project' && item.project.path === path) return { project: item.project, rootPath: shelf.rootPath };
        if (item.kind === 'bookset') {
          const found = item.projects.find(p => p.path === path);
          if (found) return { project: found, rootPath: shelf.rootPath };
        }
      }
    }
    return null;
  }, [state.shelves]);

  const openProjectDetail = useCallback((path: string) => {
    const result = findProject(path);
    if (result) { setProjectDetail(result); document.body.classList.add('modal-open'); }
  }, [findProject]);

  const closeProjectDetail = useCallback(() => {
    setProjectDetail(null); document.body.classList.remove('modal-open');
  }, []);

  const openShelfDetail = useCallback((shelf: Shelf) => {
    setShelfDetail(shelf); document.body.classList.add('modal-open');
  }, []);

  const closeShelfDetail = useCallback(() => {
    setShelfDetail(null); document.body.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (projectDetail) closeProjectDetail();
        else if (shelfDetail) closeShelfDetail();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [projectDetail, shelfDetail, closeProjectDetail, closeShelfDetail]);

  if (state.screen === 'setup') return <SetupScreen />;
  if (state.screen === 'loading') return <LoadingScreen />;

  return (
    <>
      <ShelfScreen
        shelves={state.shelves} searchQuery={searchQuery} onSearchChange={setSearchQuery}
        syncText={state.syncText} syncVisible={state.syncVisible}
        booksetThreshold={state.booksetThreshold} forgingPaths={state.forgingPaths}
        onProjectClick={openProjectDetail} onShelfClick={openShelfDetail}
      />
      {shelfDetail && (
        <ShelfDetailModal shelf={shelfDetail} onClose={closeShelfDetail}
          onProjectClick={openProjectDetail} forgingPaths={state.forgingPaths} />
      )}
      {projectDetail && (
        <ProjectDetailModal project={projectDetail.project} rootPath={projectDetail.rootPath}
          forging={state.forgingPaths.has(projectDetail.project.path)} onClose={closeProjectDetail} />
      )}
    </>
  );
}

// ── Simple Screens ──

function SetupScreen() {
  return (
    <div className="screen" style={{ display: 'flex' }}>
      <div className="setup-container">
        <h1 className="setup-title">CodeShelf</h1>
        <p className="setup-subtitle">Your projects, organized beautifully.</p>
        <p className="setup-description">To get started, choose the root directory where your projects live.</p>
        <button className="btn btn-primary" onClick={() => postMsg({ type: 'settings:pickRoot' })}>Choose Directory</button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <div className="loading-spinner" />
      <p className="loading-text">Scanning projects...</p>
    </div>
  );
}

// ── Shelf Screen ──

interface ShelfScreenProps {
  shelves: Shelf[]; searchQuery: string; onSearchChange: (q: string) => void;
  syncText: string; syncVisible: boolean; booksetThreshold: number; forgingPaths: Set<string>;
  onProjectClick: (path: string) => void; onShelfClick: (shelf: Shelf) => void;
}

function ShelfScreen({ shelves, searchQuery, onSearchChange, syncText, syncVisible, booksetThreshold, forgingPaths, onProjectClick, onShelfClick }: ShelfScreenProps) {
  const q = searchQuery.toLowerCase().trim();

  const grouped = new Map<string, Shelf[]>();
  const allForRoot = new Map<string, Shelf[]>();
  for (const shelf of shelves) {
    const key = shelf.rootLabel;
    if (!allForRoot.has(key)) allForRoot.set(key, []);
    allForRoot.get(key)!.push(shelf);
    if (!shelf.hidden) {
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(shelf);
    }
  }

  const sortedRoots = Array.from(grouped.entries()).sort(([, a], [, b]) => {
    const aHas = a.some(s => s.starred || s.items.some(i => i.kind === 'project' && i.project.starred));
    const bHas = b.some(s => s.starred || s.items.some(i => i.kind === 'project' && i.project.starred));
    if (aHas !== bHas) return aHas ? -1 : 1;
    return 0;
  });

  return (
    <div className="screen" style={{ display: 'flex' }}>
      <header className="shelf-header">
        <h1 className="shelf-logo">CodeShelf</h1>
        <div className="shelf-controls">
          <span className={`sync-status ${syncVisible ? 'visible' : ''}`}>{syncText}</span>
          <div className="search-wrapper">
            <input type="text" className="search-input" placeholder="Search projects..." value={searchQuery} onChange={e => onSearchChange(e.target.value)} />
            {searchQuery && <button className="search-clear" onClick={() => onSearchChange('')}>&times;</button>}
          </div>
          <button className="btn btn-ghost" title="Add root" onClick={() => postMsg({ type: 'settings:pickRoot' })}><i className="codicon codicon-add" /></button>
          <button className="btn btn-ghost" title="Rescan" onClick={() => postMsg({ type: 'projects:requestScan' })}><i className="codicon codicon-refresh" /></button>
          <button className="btn btn-ghost" title="Settings (JSON)" onClick={() => postMsg({ type: 'settings:openJson' })}><i className="codicon codicon-settings-gear" /></button>
        </div>
      </header>
      <div className="shelf-content">
        {sortedRoots.map(([rootLabel, rootShelves]) => {
          const hidden = (allForRoot.get(rootLabel) ?? []).filter(s => s.hidden);
          return (
            <RootGroup key={rootLabel} label={rootLabel} shelves={rootShelves} hiddenShelves={hidden}
              query={q} booksetThreshold={booksetThreshold} forgingPaths={forgingPaths}
              onProjectClick={onProjectClick} onShelfClick={onShelfClick} />
          );
        })}
        {sortedRoots.length === 0 && <p className="empty-state">No projects found.</p>}
      </div>
    </div>
  );
}

// ── Mount ──

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
