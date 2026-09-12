import * as vscode from 'vscode';
import * as path from 'path';
import { RootsConfig, ItemKind } from '../shared/types';

/**
 * The mutable scalar metadata fields the UI can set on a shelf or project.
 * (A superset of the common fields of ShelfMeta and ProjectMeta — both are
 * structurally assignable to this, so it doubles as the in-place mutation
 * target without any `as` assertion.)
 */
export interface ItemMetaUpdate {
  name?: string;
  description?: string;
  poster?: string;
  hidden?: boolean;
  starred?: boolean;
  flatten?: 'auto' | 'always' | 'never';
  tags?: string[];
}

const META_UPDATE_KEYS = ['name', 'description', 'poster', 'hidden', 'starred', 'flatten', 'tags'] as const;

// Apply one field: a falsy/empty value clears the key (so unstarring etc. prunes
// the entry), anything else sets it. Generic over the key so target[key] and the
// value share a type — no cast needed.
function copyField<K extends keyof ItemMetaUpdate>(target: ItemMetaUpdate, updates: ItemMetaUpdate, key: K): void {
  if (!(key in updates)) return;
  const value = updates[key];
  if (value === false || value === undefined || value === '') {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function applyUpdates(target: ItemMetaUpdate, updates: ItemMetaUpdate): void {
  for (const key of META_UPDATE_KEYS) copyField(target, updates, key);
}

/** Read the CodeShelf workspace/user configuration. */
export function getConfig() {
  const config = vscode.workspace.getConfiguration('codeshelf');
  return {
    roots: config.get<RootsConfig>('roots', {}),
    scanDepth: config.get<number>('scanDepth', 3),
    openInNewWindow: config.get<boolean>('openInNewWindow', false),
    booksetThreshold: config.get<number>('booksetThreshold', 8),
  };
}

/**
 * Apply metadata updates to a roots config. `kind` says whether the target is a
 * collection (shelf) or an individual project — supplied by the webview rather
 * than guessed from path depth, so a collapsed shelf many levels below the root
 * (or the synthetic loose "Projects" shelf, whose path is the root itself) is
 * still keyed where the scanner's resolveShelfMeta/resolveProjectMeta will find
 * it. Returns the mutated rootsConfig.
 */
export function applyItemMeta(
  rootsConfig: RootsConfig,
  rootPath: string,
  itemPath: string,
  kind: ItemKind,
  updates: ItemMetaUpdate,
  homePath?: string,
): RootsConfig {
  const rootKey = Object.keys(rootsConfig).find(k =>
    k === rootPath || k.replace(/^~/, homePath ?? '') === rootPath
  );
  if (!rootKey) return rootsConfig;
  const expandedRoot = rootKey.replace(/^~/, homePath ?? '');

  const root = rootsConfig[rootKey];
  if (!root.shelves) root.shelves = {};

  if (kind === 'shelf') {
    // Key by basename (what resolveShelfMeta falls back to) regardless of depth,
    // preferring an existing full-path key if the user wrote one. Empty entries
    // are kept, not pruned, so an unstarred/unhidden shelf stays addressable.
    const shelfKey = root.shelves[itemPath] ? itemPath : path.basename(itemPath);
    if (!root.shelves[shelfKey]) root.shelves[shelfKey] = {};
    applyUpdates(root.shelves[shelfKey], updates);
  } else {
    // Project: the metadata nests under its shelf. Use the first path segment as
    // the shelf key and the basename as the project key (preferring existing
    // full-path keys), matching resolveProjectMeta's lookup.
    const relativePath = path.relative(expandedRoot, itemPath);
    const parts = relativePath.split(path.sep);
    const shelfKey = parts[0];
    const projKey = path.basename(itemPath);
    if (!root.shelves[shelfKey]) root.shelves[shelfKey] = {};
    const shelf = root.shelves[shelfKey];
    if (!shelf.projects) shelf.projects = {};
    if (!shelf.projects[projKey]) shelf.projects[projKey] = {};
    applyUpdates(shelf.projects[projKey], updates);
    if (Object.keys(shelf.projects[projKey]).length === 0) {
      delete shelf.projects[projKey];
    }
    if (shelf.projects && Object.keys(shelf.projects).length === 0) {
      delete shelf.projects;
    }
    if (Object.keys(shelf).length === 0) {
      delete root.shelves[shelfKey];
    }
  }

  if (root.shelves && Object.keys(root.shelves).length === 0) {
    delete root.shelves;
  }

  return rootsConfig;
}

/** Add a root to `codeshelf.roots` if absent. Returns true if it was added. */
/**
 * `codeshelf.roots` as a plain, mutable copy.
 *
 * VS Code returns configuration values as read-only proxies. Adding keys to one
 * happens to work, but deleting throws ("'isExtensible' on proxy: trap result
 * does not reflect extensibility") — which is exactly what un-starring or
 * un-hiding does, so those toggles silently failed in a real extension host
 * while passing every test that used a plain object. Always edit a copy.
 */
function readRoots(config: vscode.WorkspaceConfiguration): RootsConfig {
  const copy: RootsConfig = JSON.parse(JSON.stringify(config.get<RootsConfig>('roots', {})));
  return copy;
}

export async function addRoot(rootPath: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('codeshelf');
  const roots = readRoots(config);
  if (roots[rootPath]) return false;
  roots[rootPath] = {};
  await config.update('roots', roots, vscode.ConfigurationTarget.Global);
  return true;
}

/** Apply metadata updates (star/hide/…) to an item and persist them. */
export async function updateItemMeta(
  rootPath: string,
  itemPath: string,
  kind: ItemKind,
  updates: ItemMetaUpdate,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('codeshelf');
  const roots = readRoots(config);
  applyItemMeta(roots, rootPath, itemPath, kind, updates, process.env.HOME);
  await config.update('roots', roots, vscode.ConfigurationTarget.Global);
}
