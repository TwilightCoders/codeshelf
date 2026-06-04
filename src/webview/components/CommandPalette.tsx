import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from 'react';
import type { Project } from '../../shared/types';
import { postMsg, LANGUAGE_ICONS, projectMatchesQuery, matchSnippet } from './helpers';

/** A project plus the root/shelf context it was found under. */
export interface ProjectEntry {
  project: Project;
  rootLabel: string;
  shelfName: string;
}

interface Props {
  projects: ProjectEntry[];
  onClose: () => void;
}

const MAX_RESULTS = 50;

function badgeFor(lang: string | undefined): string {
  if (!lang) return '–';
  return LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase();
}

/**
 * Cmd/Ctrl+K quick-switcher: fuzzy-by-substring search across every project in
 * every root and shelf (including hidden ones), keyboard-navigable, Enter opens.
 */
export function CommandPalette({ projects, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.toLowerCase().trim();
  const results = useMemo(() => {
    if (!q) return projects.slice(0, MAX_RESULTS);
    return projects
      .filter(e => e.project.path.toLowerCase().includes(q) || projectMatchesQuery(e.project, q))
      .slice(0, MAX_RESULTS);
  }, [projects, q]);

  // Selection resets to the top whenever the query changes.
  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the highlighted row scrolled into view as you arrow through.
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openProject = (entry: ProjectEntry) => {
    postMsg({ type: 'project:open', path: entry.project.path, workspaceFile: entry.project.workspaceFile });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const entry = results[selected]; if (entry) openProject(entry); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="cmdk-overlay" role="dialog" aria-modal="true" aria-label="Search all projects" onClick={onClose}>
      <div className="cmdk-panel" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <i className="codicon codicon-search" />
          <input ref={inputRef} className="cmdk-input" placeholder="Search all projects…"
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
          <span className="cmdk-count">{results.length}{query ? '' : ' projects'}</span>
        </div>
        <div className="cmdk-results" ref={listRef}>
          {results.length === 0 && <div className="cmdk-empty">No projects match “{query}”.</div>}
          {results.map((entry, i) => {
            // Show a corpus snippet only when the match is in the docs, not the name.
            const snippet = q && !entry.project.name.toLowerCase().includes(q)
              ? matchSnippet(entry.project.searchText, q)
              : undefined;
            return (
              <div key={entry.project.path}
                className={`cmdk-item ${i === selected ? 'selected' : ''}`}
                onClick={() => openProject(entry)}
                onMouseMove={() => setSelected(i)}>
                <div className="cmdk-row-main">
                  <span className="cmdk-badge">{badgeFor(entry.project.primaryLanguage)}</span>
                  <span className="cmdk-name">{entry.project.name}</span>
                  {entry.project.gitBranch && <span className="cmdk-branch"><i className="codicon codicon-git-branch" /> {entry.project.gitBranch}</span>}
                  <span className="cmdk-context">{entry.rootLabel} / {entry.shelfName}</span>
                  {entry.project.workspaceFile && <i className="codicon codicon-multiple-windows" title="Opens workspace" />}
                </div>
                {snippet && <div className="cmdk-snippet">{snippet}</div>}
              </div>
            );
          })}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
