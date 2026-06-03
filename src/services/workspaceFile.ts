import * as fs from 'fs';
import * as path from 'path';

export interface WorkspaceInfo {
  filePath: string;
  name: string;
  folders: string[];
  settings?: Record<string, unknown>;
}

// `entries` may be supplied by the caller (which usually already read the
// directory) to avoid a redundant readdir.
export async function parseWorkspaceFile(dir: string, entries?: string[]): Promise<WorkspaceInfo | undefined> {
  let names: string[];
  if (entries) {
    names = entries;
  } else {
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return undefined;
    }
  }

  const wsFile = names.find(e => e.endsWith('.code-workspace'));
  if (!wsFile) return undefined;

  const filePath = path.join(dir, wsFile);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    // Workspace files can have comments (JSONC) — strip them
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(cleaned);

    const folders: string[] = [];
    if (Array.isArray(parsed.folders)) {
      for (const f of parsed.folders) {
        const folderPath = typeof f === 'string' ? f : f?.path;
        if (typeof folderPath === 'string') {
          // Resolve relative paths against the workspace directory
          folders.push(path.resolve(dir, folderPath));
        }
      }
    }

    // Derive a name from the workspace file or window.title setting
    const name = parsed.settings?.['window.title']
      ?? wsFile.replace('.code-workspace', '')
      ?? path.basename(dir);

    return {
      filePath,
      name: String(name),
      folders,
      settings: parsed.settings,
    };
  } catch {
    return undefined;
  }
}
