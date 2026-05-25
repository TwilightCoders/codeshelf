import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GenerationMethod = 'claude-cli' | 'none';

export interface Capabilities {
  bestMethod: GenerationMethod;
  available: GenerationMethod[];
  claudeCliPath?: string;
}

async function findExecutable(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('which', [name], { timeout: 3000 });
    const path = stdout.trim();
    return path || undefined;
  } catch {
    return undefined;
  }
}

async function checkClaudeCli(): Promise<string | undefined> {
  const path = await findExecutable('claude');
  if (!path) return undefined;
  try {
    // Verify it's actually Claude CLI, not something else
    await execFileAsync(path, ['--version'], { timeout: 5000 });
    return path;
  } catch {
    return undefined;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  const available: GenerationMethod[] = [];
  const claudeCliPath = await checkClaudeCli();
  if (claudeCliPath) {
    available.push('claude-cli');
  }

  return {
    bestMethod: available[0] ?? 'none',
    available,
    claudeCliPath,
  };
}
