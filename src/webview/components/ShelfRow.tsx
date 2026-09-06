import { useState, useRef, useLayoutEffect } from 'react';
import type { Shelf, Project, BooksetItem } from '../../shared/types';
import { postMsg, sortProjects, projectMatchesQuery } from './helpers';
import type { SortBy } from './pure';
import { ProjectCard } from './ProjectCard';

interface Props {
  shelf: Shelf;
  query: string;
  booksetThreshold: number;
  forgingPaths: Set<string>;
  sortBy: SortBy;
  staleFade: boolean;
  newPaths: Set<string>;
  onProjectClick: (path: string) => void;
  onShelfClick: (shelf: Shelf) => void;
}

export function ShelfRow({ shelf, query, booksetThreshold, forgingPaths, sortBy, staleFade, newPaths, onProjectClick, onShelfClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [inlineFilter, setInlineFilter] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Filtering. The global query and this shelf's own inline filter are
  // INDEPENDENT narrowing steps: they used to share one `q`, so a global search
  // silently shadowed whatever the user typed into the shelf's filter box.
  const localQ = inlineFilter.toLowerCase().trim();
  const globalQ = query && !shelf.name.toLowerCase().includes(query) ? query : '';
  const narrow = (ps: Project[]) => {
    let out = ps;
    if (globalQ) out = out.filter(p => projectMatchesQuery(p, globalQ));
    if (localQ) out = out.filter(p => projectMatchesQuery(p, localQ));
    return sortProjects(out, sortBy);
  };

  // Whether a bookset stays a visible group. Per `codeshelf.booksetThreshold`:
  // "booksets with this many or fewer total projects are flattened into the
  // shelf grid". `flatten: 'never' | 'always'` forces it either way. Until now
  // this decision had no visual effect at all — booksets were always flattened
  // into one grid, so the whole `.bookset` stylesheet was dead code.
  const keepGrouped = (b: BooksetItem) =>
    shelf.flatten === 'never' || (shelf.flatten !== 'always' && b.projects.length > booksetThreshold);

  // Loose cards (including projects lifted out of flattened booksets), plus the
  // booksets that stay grouped.
  const loose: Project[] = [];
  const groups: BooksetItem[] = [];
  for (const item of shelf.items) {
    if (item.kind === 'project') { loose.push(item.project); continue; }
    if (keepGrouped(item)) {
      const kept = narrow(item.projects);
      if (kept.length > 0) groups.push({ ...item, projects: kept });
    } else {
      loose.push(...item.projects);
    }
  }
  const looseProjects = narrow(loose);

  const projectCount = looseProjects.length + groups.reduce((n, g) => n + g.projects.length, 0);
  const isCompact = projectCount <= 3 && groups.length === 0;
  const showEmpty = projectCount === 0;

  // Does the one-row preview clip anything? Drives the fade + "Show all".
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) { setOverflowing(false); return; }
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, expanded, projectCount]);

  // A GLOBAL search miss hides the shelf. A local-filter miss must NOT: the
  // filter input lives inside this subtree, so bailing out here would strand the
  // user with text they typed and no visible way to clear it.
  if (showEmpty && !localQ) return null;

  return (
    <section className={`shelf-row ${collapsed ? 'collapsed' : ''} ${isCompact ? 'shelf-compact' : ''} ${shelf.starred ? 'starred-shelf' : ''}`}>
      <h3 className="shelf-row-title">
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`} role="button" tabIndex={0}
          aria-expanded={!collapsed} aria-label={collapsed ? 'Expand shelf' : 'Collapse shelf'}
          onClick={() => setCollapsed(!collapsed)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); } }}>&#9656;</span>
        <span onClick={() => onShelfClick(shelf)} style={{ cursor: 'pointer' }}>{shelf.name}</span>
        <span className="shelf-actions">
          <button className={`action-btn star-btn ${shelf.starred ? 'starred' : ''}`} title="Star" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:star', path: shelf.path, rootPath: shelf.rootPath, starred: !shelf.starred, kind: 'shelf' }); }}>
            <i className={`codicon codicon-star-${shelf.starred ? 'full' : 'empty'}`} />
          </button>
          <button className="action-btn hide-btn" title="Hide" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:hide', path: shelf.path, rootPath: shelf.rootPath, hidden: true, kind: 'shelf' }); }}>
            <i className="codicon codicon-eye-closed" />
          </button>
          <button className="action-btn reveal-btn" title="Reveal in Finder" onClick={e => { e.stopPropagation(); postMsg({ type: 'folder:reveal', path: shelf.path }); }}>
            <i className="codicon codicon-folder-opened" />
          </button>
          <input type="text" className="shelf-filter-input" placeholder="Filter..." value={inlineFilter}
            onClick={e => e.stopPropagation()} onChange={e => setInlineFilter(e.target.value)} />
        </span>
      </h3>
      {!collapsed && (showEmpty ? (
        <p className="shelf-empty">
          No projects in this shelf match &ldquo;{inlineFilter}&rdquo;.
          <button className="shelf-empty-clear" onClick={() => setInlineFilter('')}>Clear filter</button>
        </p>
      ) : (
        <>
          <div ref={contentRef} className={`shelf-row-content ${expanded ? 'expanded' : ''} ${overflowing && !expanded ? 'has-overflow' : ''}`}>
            {groups.map(g => (
              <div key={g.path} className="bookset">
                <div className="bookset-header">
                  <span className="bookset-name">{g.name}</span>
                  <span className="bookset-count">{g.projects.length}</span>
                </div>
                <div className="bookset-projects">
                  {g.projects.map(p => (
                    <ProjectCard key={p.path} project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} staleFade={staleFade} isNew={newPaths.has(p.path)} onOpen={onProjectClick} />
                  ))}
                </div>
              </div>
            ))}
            {looseProjects.map(p => (
              <ProjectCard key={p.path} project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} staleFade={staleFade} isNew={newPaths.has(p.path)} onOpen={onProjectClick} />
            ))}
          </div>
          {(overflowing || expanded) && (
            <button className="shelf-showmore" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Show less' : `Show all ${projectCount}`}
            </button>
          )}
        </>
      ))}
    </section>
  );
}
