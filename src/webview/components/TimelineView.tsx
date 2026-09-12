import type { Project } from '../../shared/types';
import { timeAgo, heatOf, groupByAge, LANGUAGE_COLORS, LANGUAGE_ICONS, hashColor } from './helpers';

interface Props {
  projects: Project[];
  onOpen: (path: string) => void;
}

/**
 * The library as stratigraphy: everything laid out by when it was last touched,
 * newest at the top, sinking into the deep past as it cools.
 *
 * Folder structure says where a project was filed; it says nothing about whether
 * it is alive. When most projects are long cold, time is the axis that
 * actually separates the handful of live projects from the archive — so this view
 * drops shelves entirely and sorts the whole library by age.
 */
export function TimelineView({ projects, onOpen }: Props) {
  const bands = groupByAge(projects);

  if (bands.length === 0) return <p className="empty-state">No projects found.</p>;

  return (
    <div className="timeline">
      <div className="tl-now"><span className="tl-now-dot" />NOW</div>
      {bands.map(({ band, projects: inBand }) => (
        <section key={band.id} className={`tl-band tl-band-${band.id}`}>
          <header className="tl-label">
            <span className="tl-band-name">{band.label}</span>
            <span className="tl-band-hint">{band.hint}</span>
            <span className="tl-band-count">{inBand.length}</span>
          </header>
          <div className="tl-items">
            {inBand.map(p => {
              const lang = p.primaryLanguage;
              const color = lang ? LANGUAGE_COLORS[lang] ?? hashColor(p.name) : hashColor(p.name);
              const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
              return (
                <button key={p.path} className={`tl-item heat-${heatOf(p.lastModified)}`}
                  title={p.path} onClick={() => onOpen(p.path)}>
                  <span className="tl-avatar" style={{ backgroundColor: color }}>{badge}</span>
                  <span className="tl-name">
                    {p.name}
                    {p.starred && <i className="codicon codicon-star-full tl-star" />}
                  </span>
                  <span className="tl-meta">
                    {lang && <span className="tl-lang">{lang}</span>}
                    {p.gitBranch && <span className="tl-branch"><i className="codicon codicon-git-branch" /> {p.gitBranch}</span>}
                  </span>
                  <span className="tl-age">{timeAgo(p.lastModified)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
