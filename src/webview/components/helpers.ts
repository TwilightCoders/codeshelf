import type { WebviewToExt } from '../../shared/types';

// Re-export pure functions (these are also importable directly from ./pure)
export {
  LANGUAGE_ICONS, LANGUAGE_COLORS,
  hashColor, timeAgo,
  collectProjects, flattenBooksets, sortProjects,
  projectMatchesQuery, matchSnippet,
} from './pure';

// ── VS Code API ──

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();

export function postMsg(msg: WebviewToExt) {
  vscode.postMessage(msg);
}
