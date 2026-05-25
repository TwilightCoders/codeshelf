import { useState, useEffect, useRef } from 'react';
import type { Project } from '../../shared/types';
import { postMsg, LANGUAGE_ICONS, LANGUAGE_COLORS, hashColor, timeAgo } from './helpers';

interface Props {
  project: Project;
  rootPath: string;
  forging: boolean;
  onClose: () => void;
}

export function ProjectDetailModal({ project, forging, onClose }: Props) {
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [promptValue, setPromptValue] = useState(project.posterPrompt ?? '');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const lang = project.primaryLanguage ?? 'software';
  const bgColor = lang ? LANGUAGE_COLORS[lang] ?? hashColor(project.name) : hashColor(project.name);
  const badge = lang ? LANGUAGE_ICONS[lang] ?? lang.slice(0, 2).toUpperCase() : '';
  const hasPoster = !!project.poster;
  const markers = project.markers.filter(m => m !== '.git').join(', ');

  useEffect(() => {
    if (showPromptEditor && promptRef.current) promptRef.current.focus();
  }, [showPromptEditor]);

  useEffect(() => {
    const handler = () => setShowDropdown(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div className="detail-modal" style={{ display: 'flex' }}>
      <div className="detail-backdrop" onClick={onClose} />
      <div className="detail-panel">
        <div className={`detail-poster ${forging ? 'forging' : ''}`}>
          <div className="detail-poster-content" style={!hasPoster ? { backgroundColor: bgColor } : undefined}>
            {hasPoster
              ? <div dangerouslySetInnerHTML={{ __html: project.poster! }} />
              : badge && <span className="card-badge">{badge}</span>
            }
          </div>

          {/* Poster action dropdown */}
          <div className="detail-poster-btn-group" onClick={e => e.stopPropagation()}>
            <button className="detail-poster-btn" title="Poster options" onClick={e => { e.stopPropagation(); setShowDropdown(!showDropdown); }}>
              <i className="codicon codicon-sparkle" />
            </button>
            {showDropdown && (
              <div className="detail-generate-dropdown" style={{ display: 'flex' }}>
                <button className="dropdown-item" onClick={() => { setShowDropdown(false); postMsg({ type: 'poster:generate', projectPath: project.path, userNotes: project.posterPrompt || undefined }); }}>
                  <i className="codicon codicon-sparkle" /> Generate poster
                </button>
                <button className="dropdown-item" onClick={() => { setShowDropdown(false); setShowPromptEditor(true); setPromptValue(project.posterPrompt ?? ''); }}>
                  <i className="codicon codicon-edit" /> Generate with prompt
                </button>
                <button className="dropdown-item" onClick={() => { setShowDropdown(false); postMsg({ type: 'poster:attach', projectPath: project.path }); }}>
                  <i className="codicon codicon-file-media" /> Attach custom image
                </button>
                {forging && (
                  <button className="dropdown-item" onClick={() => { setShowDropdown(false); postMsg({ type: 'poster:cancel', projectPath: project.path }); }}>
                    <i className="codicon codicon-close" /> Cancel generation
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="detail-poster-btn detail-close" onClick={onClose}><i className="codicon codicon-close" /></button>

          {/* Prompt editor */}
          {showPromptEditor && (
            <div className="prompt-editor" style={{ display: 'flex' }}>
              <textarea ref={promptRef} className="prompt-input" placeholder="Describe what you want..." value={promptValue} onChange={e => setPromptValue(e.target.value)} />
              <div className="prompt-editor-row">
                <div className="prompt-actions">
                  <button className="btn btn-primary" onClick={() => { setShowPromptEditor(false); postMsg({ type: 'poster:generate', projectPath: project.path, userNotes: promptValue.trim() || undefined }); }}>
                    <i className="codicon codicon-sparkle" /> Generate
                  </button>
                  <button className="btn btn-ghost" onClick={() => setShowPromptEditor(false)}>Cancel</button>
                </div>
                <details className="prompt-spoiler">
                  <summary className="prompt-spoiler-toggle"><i className="codicon codicon-eye" /> Show prompt</summary>
                  <div className="prompt-section">
                    {[
                      `Generate a minimal, elegant SVG poster for a ${lang} project called "${project.name}".`,
                      '400x240px, dark background, subtle geometric elements, project name prominent.',
                      'Modern technical style, like a Steam game library card.',
                      markers ? `Tech detected: ${markers}` : '',
                    ].filter(Boolean).join('\n')}
                  </div>
                  <div className="prompt-section">
                    {'Final output: ONLY raw SVG markup. 400x240px.\nRead-only tools allowed: Read, Glob, Grep.\nFinal message starts with <svg, ends with </svg>.'}
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="detail-title-row">
            <h2 className="detail-name">{project.name}</h2>
            <div className={`detail-open-group ${project.workspaceFile ? 'has-workspace' : ''}`}>
              <button className="detail-open-btn" title="Open folder" onClick={() => postMsg({ type: 'project:open', path: project.path })}>
                <i className="codicon codicon-folder" /><i className="codicon codicon-folder-opened" />
              </button>
              {project.workspaceFile && (
                <button className="detail-open-btn detail-open-workspace" title="Open workspace" onClick={() => postMsg({ type: 'project:open', path: project.path, workspaceFile: project.workspaceFile })}>
                  <i className="codicon codicon-multiple-windows" />
                </button>
              )}
            </div>
          </div>
          <p className="detail-path">{project.path}</p>
          <div className="detail-meta">
            {project.gitBranch && <span className="detail-branch"><i className="codicon codicon-git-branch" /> {project.gitBranch}</span>}
            <span className="detail-time">{timeAgo(project.lastModified)}</span>
            {project.primaryLanguage && <span className="detail-lang">{project.primaryLanguage}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
