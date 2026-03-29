import * as fs from 'fs';
import * as path from 'path';

export async function getBranch(projectPath: string): Promise<string | undefined> {
  const headPath = path.join(projectPath, '.git', 'HEAD');
  try {
    const content = await fs.promises.readFile(headPath, 'utf-8');
    const trimmed = content.trim();
    if (trimmed.startsWith('ref: refs/heads/')) {
      return trimmed.slice('ref: refs/heads/'.length);
    }
    // Detached HEAD — return short hash
    return trimmed.slice(0, 8);
  } catch {
    return undefined;
  }
}
