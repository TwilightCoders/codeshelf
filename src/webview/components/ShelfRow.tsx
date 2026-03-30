import { useState } from 'react';
import type { Shelf } from '../../shared/types';
import { postMsg, collectProjects, flattenBooksets, sortProjects } from './helpers';
import { ProjectCard } from './ProjectCard';

interface Props {
  shelf: Shelf;
  query: string;
  booksetThreshold: number;
  forgingPaths: Set<string>;
  onProjectClick: (path: string) => void;
  onShelfClick: (shelf: Shelf) => void;
}

export function ShelfRow({ shelf, query, booksetThreshold, forgingPaths, onProjectClick, onShelfClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [inlineFilter, setInlineFilter] = useState('');

  // Bookset flattening
  let displayItems = shelf.items;
  const allBooksets = displayItems.every(i => i.kind === 'bookset');
  const projectCount = collectProjects(displayItems).length;
  const shouldFlatten = shelf.flatten === 'always' || (shelf.flatten !== 'never' && allBooksets && projectCount <= booksetThreshold);
  if (shouldFlatten) displayItems = flattenBooksets(displayItems);

  // Collect and filter
  let projects = collectProjects(displayItems);
  const q = query || inlineFilter.toLowerCase().trim();
  if (q) {
    const shelfMatch = shelf.name.toLowerCase().includes(q);
    if (!shelfMatch) projects = projects.filter(p => p.name.toLowerCase().includes(q));
  }
  if (projects.length === 0) return null;

  projects = sortProjects(projects);
  const isCompact = projects.length <= 3;

  return (
    <section className={`shelf-row ${collapsed ? 'collapsed' : ''} ${isCompact ? 'shelf-compact' : ''} ${shelf.starred ? 'starred-shelf' : ''}`}>
      <h3 className="shelf-row-title">
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`} onClick={() => setCollapsed(!collapsed)}>&#9656;</span>
        <span onClick={() => onShelfClick(shelf)} style={{ cursor: 'pointer' }}>{shelf.name}</span>
        <span className="shelf-actions">
          <button className={`action-btn star-btn ${shelf.starred ? 'starred' : ''}`} title="Star" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:star', path: shelf.path, rootPath: shelf.rootPath, starred: !shelf.starred }); }}>
            <i className={`codicon codicon-star-${shelf.starred ? 'full' : 'empty'}`} />
          </button>
          <button className="action-btn hide-btn" title="Hide" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:hide', path: shelf.path, rootPath: shelf.rootPath, hidden: true }); }}>
            <i className="codicon codicon-eye-closed" />
          </button>
          <button className="action-btn reveal-btn" title="Reveal in Finder" onClick={e => { e.stopPropagation(); postMsg({ type: 'folder:reveal', path: shelf.path }); }}>
            <i className="codicon codicon-folder-opened" />
          </button>
          <input type="text" className="shelf-filter-input" placeholder="Filter..." value={inlineFilter}
            onClick={e => e.stopPropagation()} onChange={e => setInlineFilter(e.target.value)} />
        </span>
      </h3>
      {!collapsed && (
        <div className="shelf-row-content">
          {projects.map(p => (
            <ProjectCard key={p.path} project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} onClick={() => onProjectClick(p.path)} />
          ))}
        </div>
      )}
    </section>
  );
}
