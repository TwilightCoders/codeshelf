import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import type { ExtToWebview, Shelf, Project, ScanDiff } from '../shared/types';
import { postMsg } from './components/helpers';
import { asSortBy, type SortBy } from './components/pure';
import { RootGroup } from './components/RootGroup';
import { ShelfDetailModal } from './components/ShelfDetailModal';
import { ProjectDetailModal } from './components/ProjectDetailModal';
import { CommandPalette, type ProjectEntry } from './components/CommandPalette';

// ── Timing constants (ms) ──

// The stylesheet clamps the per-card entrance delay (it cannot afford to run a
// 297-card ramp), so cleanup is bounded to match. Multiplying the step by the
// full card count meant holding .stagger-in plus an inline --stagger-i on every
// card for ~24 seconds after the library had finished animating.
const STAGGER_STEP_MS = 80;   // delay between successive card entrances
const STAGGER_MAX_CARDS = 42; // cards after which the delay stops growing
const STAGGER_TAIL_MS = 500;  // grace period after the last card before cleanup
const SYNC_TOAST_MS = 3000;   // how long the sync status lingers
const NEW_BADGE_MS = 4000;    // how long freshly-added cards stay highlighted

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
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [staleFade, setStaleFade] = useState(false);
  const [projectDetail, setProjectDetail] = useState<{ project: Project; rootPath: string } | null>(null);
  const [shelfDetail, setShelfDetail] = useState<Shelf | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newPaths, setNewPaths] = useState<Set<string>>(new Set());
  const newPathsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstLoadDone = useRef(false);

  // Fire confetti from each new card after render
  useEffect(() => {
    if (newPaths.size === 0) return;
    const count = newPaths.size;
    const inner: ReturnType<typeof setTimeout>[] = [];
    // Small delay to let React render the cards
    const timer = setTimeout(() => {
      const cards = document.querySelectorAll('.project-card.new-project');
      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const x = (rect.left + rect.width / 2) / window.innerWidth;
        const y = (rect.top + rect.height / 2) / window.innerHeight;
        // Stagger bursts slightly
        inner.push(setTimeout(() => {
          confetti({
            particleCount: Math.min(40, Math.max(15, 60 / count)),
            spread: 50,
            origin: { x, y },
            startVelocity: 20,
            gravity: 0.8,
            ticks: 120,
            colors: ['#e8b627', '#ff78c8', '#64c8ff', '#ff6b6b', '#6bff6b'],
            scalar: 0.8,
            disableForReducedMotion: true,
          });
        }, i * 150));
      });
    }, 100);
    // Cancel the outer timer AND any staggered bursts still pending, so a rapid
    // second scan (or unmount) doesn't fire bursts at stale card positions.
    return () => { clearTimeout(timer); inner.forEach(clearTimeout); };
  }, [newPaths]);

  const showSyncResult = useCallback((diff?: ScanDiff) => {
    const text = !diff ? 'updated' : !diff.changed ? 'up to date'
      : `updated: ${[diff.added > 0 && `+${diff.added} new`, diff.removed > 0 && `-${diff.removed} removed`].filter(Boolean).join(', ')}`;
    setState(s => ({ ...s, syncText: text, syncVisible: true }));
    setTimeout(() => setState(s => ({ ...s, syncVisible: false })), SYNC_TOAST_MS);
  }, []);

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
          if (!firstLoadDone.current) {
            firstLoadDone.current = true;
            // After React renders, stamp --stagger-i on each card and add class
            requestAnimationFrame(() => {
              const cards = document.querySelectorAll<HTMLElement>('.project-card');
              cards.forEach((card, i) => {
                card.style.setProperty('--stagger-i', String(i));
                card.classList.add('stagger-in');
              });
              // Remove stagger class after all animations finish
              setTimeout(() => {
                cards.forEach(card => {
                  card.classList.remove('stagger-in');
                  card.style.removeProperty('--stagger-i');
                });
              }, Math.min(cards.length, STAGGER_MAX_CARDS) * STAGGER_STEP_MS + STAGGER_TAIL_MS);
            });
          }
          if (msg.diff?.addedPaths?.length) {
            setNewPaths(new Set(msg.diff.addedPaths));
            if (newPathsTimer.current) clearTimeout(newPathsTimer.current);
            newPathsTimer.current = setTimeout(() => setNewPaths(new Set()), NEW_BADGE_MS);
          }
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
          // The open project-detail modal re-derives from state.shelves (below),
          // so no separate snapshot patch is needed here.
          break;
        }
        default: {
          // Compile-time exhaustiveness: a new ExtToWebview variant must be handled.
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [showSyncResult]);

  useEffect(() => { postMsg({ type: 'ready' }); }, []);

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
        if (paletteOpen) setPaletteOpen(false);
        else if (projectDetail) closeProjectDetail();
        else if (shelfDetail) closeShelfDetail();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paletteOpen, projectDetail, shelfDetail, closeProjectDetail, closeShelfDetail]);

  // Cmd/Ctrl+K toggles the global project quick-switcher.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Flat list of every project across all roots and shelves (hidden included) —
  // the corpus the Cmd+K palette searches.
  const allProjects = useMemo<ProjectEntry[]>(() => {
    const entries: ProjectEntry[] = [];
    for (const shelf of state.shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project') {
          entries.push({ project: item.project, rootLabel: shelf.rootLabel, shelfName: shelf.name });
        } else {
          for (const p of item.projects) {
            entries.push({ project: p, rootLabel: shelf.rootLabel, shelfName: shelf.name });
          }
        }
      }
    }
    return entries;
  }, [state.shelves]);

  if (state.screen === 'setup') return <SetupScreen />;
  if (state.screen === 'loading') return <LoadingScreen />;

  return (
    <>
      <ShelfScreen
        shelves={state.shelves} searchQuery={searchQuery} onSearchChange={setSearchQuery}
        syncText={state.syncText} syncVisible={state.syncVisible}
        booksetThreshold={state.booksetThreshold} forgingPaths={state.forgingPaths}
        sortBy={sortBy} onSortChange={setSortBy} staleFade={staleFade} onStaleFadeToggle={() => setStaleFade(!staleFade)}
        newPaths={newPaths}
        onProjectClick={openProjectDetail} onShelfClick={openShelfDetail}
      />
      {shelfDetail && (() => {
        // Always use the latest shelf data from state
        const currentShelf = state.shelves.find(s => s.path === shelfDetail.path) ?? shelfDetail;
        return (
          <ShelfDetailModal shelf={currentShelf} onClose={closeShelfDetail}
            onProjectClick={openProjectDetail} forgingPaths={state.forgingPaths} />
        );
      })()}
      {projectDetail && (() => {
        // Re-derive from the latest scan so the open modal isn't a stale snapshot
        // (mirrors the ShelfDetailModal pattern above).
        const live = findProject(projectDetail.project.path) ?? projectDetail;
        return (
          <ProjectDetailModal project={live.project} rootPath={live.rootPath}
            forging={state.forgingPaths.has(live.project.path)} onClose={closeProjectDetail} />
        );
      })()}
      {paletteOpen && <CommandPalette projects={allProjects} onClose={() => setPaletteOpen(false)} />}
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
  sortBy: SortBy; onSortChange: (s: SortBy) => void; staleFade: boolean; onStaleFadeToggle: () => void;
  newPaths: Set<string>;
  onProjectClick: (path: string) => void; onShelfClick: (shelf: Shelf) => void;
}

function ShelfScreen({ shelves, searchQuery, onSearchChange, syncText, syncVisible, booksetThreshold, forgingPaths, sortBy, onSortChange, staleFade, onStaleFadeToggle, newPaths, onProjectClick, onShelfClick }: ShelfScreenProps) {
  const q = searchQuery.toLowerCase().trim();

  // Grouping/sorting depends only on shelves, so memoize it — it shouldn't
  // recompute on every search keystroke, sort change, or sync-toast tick.
  const { sortedRoots, allForRoot } = useMemo(() => {
    const grouped = new Map<string, Shelf[]>();
    const allForRoot = new Map<string, Shelf[]>();
    for (const shelf of shelves) {
      const key = shelf.rootLabel;
      let all = allForRoot.get(key);
      if (!all) { all = []; allForRoot.set(key, all); }
      all.push(shelf);
      if (!shelf.hidden) {
        let visible = grouped.get(key);
        if (!visible) { visible = []; grouped.set(key, visible); }
        visible.push(shelf);
      }
    }
    const sortedRoots = Array.from(grouped.entries()).sort(([, a], [, b]) => {
      const aHas = a.some(s => s.starred || s.items.some(i => i.kind === 'project' && i.project.starred));
      const bHas = b.some(s => s.starred || s.items.some(i => i.kind === 'project' && i.project.starred));
      if (aHas !== bHas) return aHas ? -1 : 1;
      return 0;
    });
    return { sortedRoots, allForRoot };
  }, [shelves]);

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
          <select className="sort-select" value={sortBy} onChange={e => onSortChange(asSortBy(e.target.value))} title="Sort projects">
            <option value="date">Recent</option>
            <option value="name">A-Z</option>
            <option value="language">Language</option>
          </select>
          <button className={`btn btn-ghost ${staleFade ? 'active' : ''}`} title="Fade stale projects" onClick={onStaleFadeToggle}>
            <i className="codicon codicon-clock" />
          </button>
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
              sortBy={sortBy} staleFade={staleFade} newPaths={newPaths}
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
