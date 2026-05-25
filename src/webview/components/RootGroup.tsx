import { useState } from 'react';
import type { Shelf } from '../../shared/types';
import { ShelfRow } from './ShelfRow';

interface Props {
  label: string;
  shelves: Shelf[];
  hiddenShelves: Shelf[];
  query: string;
  booksetThreshold: number;
  forgingPaths: Set<string>;
  sortBy: 'date' | 'name' | 'language';
  staleFade: boolean;
  newPaths: Set<string>;
  onProjectClick: (path: string) => void;
  onShelfClick: (shelf: Shelf) => void;
}

export function RootGroup({ label, shelves, hiddenShelves, query, booksetThreshold, forgingPaths, sortBy, staleFade, newPaths, onProjectClick, onShelfClick }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const sorted = [...shelves].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={`root-group ${collapsed ? 'collapsed' : ''}`}>
      <h2 className="root-header">
        <span className={`collapse-arrow ${collapsed ? 'collapsed' : ''}`} onClick={() => setCollapsed(!collapsed)}>&#9656;</span>
        <span onClick={() => setCollapsed(!collapsed)}>{label}</span>
        {hiddenShelves.length > 0 && (
          <span className="hidden-pills" onClick={e => e.stopPropagation()}>
            {hiddenShelves.map(s => (
              <button key={s.path} className="hidden-pill" title={`Show ${s.name}`} onClick={() => onShelfClick(s)}>{s.name}</button>
            ))}
          </span>
        )}
      </h2>
      {!collapsed && (
        <div className="root-shelves">
          {sorted.map(shelf => (
            <ShelfRow key={shelf.path} shelf={shelf} query={query} booksetThreshold={booksetThreshold}
              forgingPaths={forgingPaths} sortBy={sortBy} staleFade={staleFade} newPaths={newPaths}
              onProjectClick={onProjectClick} onShelfClick={onShelfClick} />
          ))}
        </div>
      )}
    </div>
  );
}
