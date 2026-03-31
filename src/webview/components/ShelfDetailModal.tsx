import { useState } from 'react';
import type { Shelf } from '../../shared/types';
import { postMsg, collectProjects, sortProjects } from './helpers';
import { ProjectCard } from './ProjectCard';

interface Props {
  shelf: Shelf;
  onClose: () => void;
  onProjectClick: (path: string) => void;
  forgingPaths: Set<string>;
}

export function ShelfDetailModal({ shelf, onClose, onProjectClick, forgingPaths }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.toLowerCase().trim();
  const projects = sortProjects(collectProjects(shelf.items));

  return (
    <div className="detail-modal" style={{ display: 'flex' }}>
      <div className="detail-backdrop" onClick={onClose} />
      <div className="shelf-modal-panel">
        <div className="shelf-modal-header">
          <h2 className="shelf-modal-title">{shelf.name}</h2>
          <div className="shelf-modal-actions">
            <input type="text" className="search-input shelf-modal-search" placeholder="Filter projects..." value={filter} onChange={e => setFilter(e.target.value)} />
            <button className={`action-btn ${shelf.starred ? 'starred' : ''}`} title="Star shelf" onClick={() => postMsg({ type: 'item:star', path: shelf.path, rootPath: shelf.rootPath, starred: !shelf.starred })}>
              <i className={`codicon codicon-star-${shelf.starred ? 'full' : 'empty'}`} />
            </button>
            <button className="action-btn" title={shelf.hidden ? 'Unhide shelf' : 'Hide shelf'} onClick={() => { postMsg({ type: 'item:hide', path: shelf.path, rootPath: shelf.rootPath, hidden: !shelf.hidden }); if (!shelf.hidden) onClose(); }}>
              <i className={`codicon codicon-${shelf.hidden ? 'eye' : 'eye-closed'}`} />
            </button>
            <button className="action-btn" title="Reveal in Finder" onClick={() => postMsg({ type: 'folder:reveal', path: shelf.path })}>
              <i className="codicon codicon-folder-opened" />
            </button>
            <button className="action-btn" title="Close" onClick={onClose}><i className="codicon codicon-close" /></button>
          </div>
        </div>
        <div className="shelf-modal-grid">
          {projects.map(p => {
            const match = !q || p.name.toLowerCase().includes(q);
            return (
              <div key={p.path} style={{ opacity: match ? 1 : 0.1, order: match ? 0 : 9999, pointerEvents: match ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
                <ProjectCard project={p} rootPath={shelf.rootPath} forging={forgingPaths.has(p.path)} onClick={() => onProjectClick(p.path)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
