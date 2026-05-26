import * as vscode from 'vscode';
import * as path from 'path';
import { RootsConfig } from '../shared/types';

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
 * Apply metadata updates to a roots config, determining whether the target
 * is a shelf (direct child of root) or project (deeper) by relative path depth.
 * Returns the mutated rootsConfig.
 */
export function applyItemMeta(
  rootsConfig: RootsConfig,
  rootPath: string,
  itemPath: string,
  updates: Record<string, unknown>,
  homePath?: string,
): RootsConfig {
  const rootKey = Object.keys(rootsConfig).find(k =>
    k === rootPath || k.replace(/^~/, homePath ?? '') === rootPath
  );
  if (!rootKey) return rootsConfig;
  const expandedRoot = rootKey.replace(/^~/, homePath ?? '');

  const root = rootsConfig[rootKey];
  if (!root.shelves) root.shelves = {};

  const relativePath = path.relative(expandedRoot, itemPath);
  const parts: string[] = relativePath.split(path.sep);

  const applyUpdates = (obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(updates)) {
      if (value === false || value === undefined || value === null || value === '') {
        delete obj[key];
      } else {
        obj[key] = value;
      }
    }
  };

  if (parts.length === 1) {
    // Prefer an existing full-path key, otherwise key by the shelf's basename.
    const shelfKey = root.shelves[itemPath] ? itemPath : parts[0];
    if (!root.shelves[shelfKey]) root.shelves[shelfKey] = {};
    applyUpdates(root.shelves[shelfKey] as Record<string, unknown>);
  } else {
    const shelfKey = parts[0];
    const projKey = path.basename(itemPath);
    if (!root.shelves[shelfKey]) root.shelves[shelfKey] = {};
    const shelf = root.shelves[shelfKey];
    if (!shelf.projects) shelf.projects = {};
    if (!shelf.projects[projKey]) shelf.projects[projKey] = {};
    applyUpdates(shelf.projects[projKey] as Record<string, unknown>);
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
export async function addRoot(rootPath: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('codeshelf');
  const roots = config.get<RootsConfig>('roots', {});
  if (roots[rootPath]) return false;
  roots[rootPath] = {};
  await config.update('roots', roots, vscode.ConfigurationTarget.Global);
  return true;
}

/** Apply metadata updates (star/hide/…) to an item and persist them. */
export async function updateItemMeta(
  rootPath: string,
  itemPath: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('codeshelf');
  const roots = config.get<RootsConfig>('roots', {});
  applyItemMeta(roots, rootPath, itemPath, updates, process.env.HOME);
  await config.update('roots', roots, vscode.ConfigurationTarget.Global);
}
