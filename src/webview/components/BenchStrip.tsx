import type { Project } from '../../shared/types';
import { postMsg, timeAgo, heatOf, LANGUAGE_COLORS, LANGUAGE_ICONS, hashColor } from './helpers';

interface Props {
  projects: Project[];
  onOpen: (path: string) => void;
}

/**
 * "On the bench" — the handful of projects actually in flight.
 *
 * Of ~300 projects roughly a dozen are warm at any time, so the shelves below
 * are mostly an archive. This strip answers "what am I working on?" without
 * scrolling, and is the one place a project gets room for its description and a
 * direct open button.
 */
export function BenchStrip({ projects, onOpen }: Props) {
  if (projects.length === 0) return null;

  return (
    <section className="bench">
      <h2 className="bench-title">
        On the bench
        <span className="bench-count">{projects.length} active</span>
      </h2>
      <div className="bench-strip">
        {projects.map(p => {
          const lang = p.primaryLanguage;
          const color = lang ? LANGUAGE_COLORS[lang] ?? hashColor(p.name) : hashColor(p.name);
          const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
          return (
            <article key={p.path} className={`bench-card heat-${heatOf(p.lastModified)}`}
              title={p.path} role="button" tabIndex={0}
              onClick={() => onOpen(p.path)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.path); } }}>
              <div className="bench-cover" style={{ backgroundColor: color }}
                dangerouslySetInnerHTML={p.poster ? { __html: p.poster } : undefined}>
                {p.poster ? undefined : <span className="bench-badge">{badge}</span>}
              </div>
              <div className="bench-body">
                <h3 className="bench-name">
                  {p.name}
                  {p.starred && <i className="codicon codicon-star-full bench-star" />}
                </h3>
                <div className="bench-meta">
                  {lang && <span className="bench-lang">{lang}</span>}
                  {p.gitBranch && <span className="bench-branch"><i className="codicon codicon-git-branch" /> {p.gitBranch}</span>}
                  <span className="bench-time">{timeAgo(p.lastModified)}</span>
                </div>
                {p.description && <p className="bench-desc">{p.description}</p>}
                <button className="bench-open" onClick={e => {
                  e.stopPropagation();
                  postMsg({ type: 'project:open', path: p.path, workspaceFile: p.workspaceFile });
                }}>
                  <i className="codicon codicon-folder-opened" />
                  {p.workspaceFile ? 'Open workspace' : 'Open folder'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
