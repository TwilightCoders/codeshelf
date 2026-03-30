import type { Project } from '../../shared/types';
import { postMsg, LANGUAGE_ICONS, LANGUAGE_COLORS, hashColor, timeAgo } from './helpers';

interface Props {
  project: Project;
  rootPath: string;
  forging: boolean;
  onClick: () => void;
}

export function ProjectCard({ project, rootPath, forging, onClick }: Props) {
  const lang = project.primaryLanguage;
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const hasPoster = !!project.poster;

  return (
    <div className={`project-card ${hasPoster ? 'has-poster' : ''} ${forging ? 'forging' : ''}`} title={project.path} onClick={onClick}>
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
      <button className="card-open-btn action-btn" title="Open project" onClick={e => { e.stopPropagation(); postMsg({ type: 'project:open', path: project.path, workspaceFile: project.workspaceFile }); }}>
        <i className="codicon codicon-folder" /><i className="codicon codicon-folder-opened" />
      </button>
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
}
