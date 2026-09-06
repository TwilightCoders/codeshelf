import * as fs from 'fs';
import * as path from 'path';

/**
 * Read the current branch (or short hash if detached) from a git metadata dir
 * containing a HEAD file. Works for both a normal repo's `.git/` and a
 * worktree's `.git/worktrees/<name>/` dir.
 */
export async function branchFromGitDir(gitDir: string): Promise<string | undefined> {
  try {
    const trimmed = (await fs.promises.readFile(path.join(gitDir, 'HEAD'), 'utf-8')).trim();
    if (trimmed.startsWith('ref: refs/heads/')) {
      return trimmed.slice('ref: refs/heads/'.length);
    }
    // Detached HEAD — return short hash
    return trimmed.slice(0, 8);
  } catch {
    return undefined;
  }
}

export async function getBranch(projectPath: string): Promise<string | undefined> {
  return branchFromGitDir(path.join(projectPath, '.git'));
}
