import { memo } from 'react';
import type { Project } from '../../shared/types';
import { postMsg, LANGUAGE_ICONS, LANGUAGE_COLORS, hashColor, timeAgo } from './helpers';

interface Props {
  project: Project;
  rootPath: string;
  forging: boolean;
  staleFade?: boolean;
  isNew?: boolean;
  // Stable opener (takes the path) so memoized cards aren't busted by a fresh
  // per-card closure on every parent render.
  onOpen: (path: string) => void;
}

function stalenessOpacity(lastModified: number): number {
  const daysAgo = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
  if (daysAgo < 7) return 1;
  if (daysAgo < 30) return 0.9;
  if (daysAgo < 90) return 0.75;
  if (daysAgo < 365) return 0.6;
  return 0.45;
}

export const ProjectCard = memo(function ProjectCard({ project, rootPath, forging, staleFade, isNew, onOpen }: Props) {
  const lang = project.primaryLanguage;
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const hasPoster = !!project.poster;
  const opacity = staleFade ? stalenessOpacity(project.lastModified) : 1;

  return (
    <div className={`project-card ${hasPoster ? 'has-poster' : ''} ${forging ? 'forging' : ''} ${isNew ? 'new-project' : ''}`}
      title={project.path} onClick={() => onOpen(project.path)} role="button" tabIndex={0} aria-label={`Open ${project.name}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(project.path); } }}
      style={{ opacity, transition: 'opacity 0.3s ease' }}>
      <div className={`card-poster-flip ${hasPoster ? 'flipped' : ''}`}>
        <div className="card-poster-face card-poster-fallback" style={{ backgroundColor: bgColor }}>
          {badge && <span className="card-badge">{badge}</span>}
        </div>
        {hasPoster && <div className="card-poster-face card-poster-image" dangerouslySetInnerHTML={{ __html: project.poster! }} />}
      </div>
      <div className="card-overlay">
        <button className={`action-btn star-btn ${project.starred ? 'starred' : ''}`} title="Star" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:star', path: project.path, rootPath, starred: !project.starred }); }}>
          <i className={`codicon codicon-star-${project.starred ? 'full' : 'empty'}`} />
        </button>
        <button className="action-btn hide-btn" title="Hide" onClick={e => { e.stopPropagation(); postMsg({ type: 'item:hide', path: project.path, rootPath, hidden: true }); }}>
          <i className="codicon codicon-eye-closed" />
        </button>
      </div>
      <div className={`card-open-group ${project.workspaceFile ? 'has-workspace' : ''}`}>
        <button className="card-open-btn action-btn" title="Open folder" onClick={e => { e.stopPropagation(); postMsg({ type: 'project:open', path: project.path }); }}>
          <i className="codicon codicon-folder" /><i className="codicon codicon-folder-opened" />
        </button>
        {project.workspaceFile && (
          <button className="card-open-btn card-open-workspace action-btn" title="Open workspace" onClick={e => { e.stopPropagation(); postMsg({ type: 'project:open', path: project.path, workspaceFile: project.workspaceFile }); }}>
            <i className="codicon codicon-multiple-windows" />
          </button>
        )}
      </div>
      <div className="card-info">
        <span className="card-name">{project.name}</span>
        {project.description && <p className="card-description">{project.description}</p>}
        <div className="card-meta">
          {project.gitBranch && <span className="card-branch"><i className="codicon codicon-git-branch" /> {project.gitBranch}</span>}
          <span className="card-time">{timeAgo(project.lastModified)}</span>
        </div>
      </div>
    </div>
  );
});
