import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import { Project } from '../shared/types';
import { POSTER_SYSTEM_PROMPT, POSTER_ALLOWED_TOOLS, buildPosterPrompt } from '../shared/constants';
import { Capabilities } from './capabilities';


export interface PosterResult {
  projectPath: string;
  posterUri: string;
}

/**
 * Extract a clean `<svg>…</svg>` document from CLI stdout, tolerating leading
 * chatter or trailing prose around it. Returns undefined when no SVG is found.
 */
export function extractSvg(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('<svg') && trimmed.endsWith('</svg>')) return trimmed;
  const match = trimmed.match(/<svg[\s\S]*<\/svg>/);
  return match ? match[0] : undefined;
}

/**
 * Cache path for a project's poster: `<cacheDir>/posters/<base64url(path)><ext>`.
 * The single source of truth for the on-disk poster layout — both the generator
 * and the panel's "attach custom image" path derive their paths here so they
 * can't drift.
 */
export function posterCachePath(cacheDir: string, projectPath: string, ext = '.svg'): string {
  const hash = Buffer.from(projectPath).toString('base64url');
  return path.join(cacheDir, 'posters', `${hash}${ext}`);
}

/**
 * Arguments for a one-shot poster run of the Claude CLI.
 *
 * `--restricted --strict-mcp-config` is load-bearing, not hardening for its own
 * sake. In `-p` mode the CLI otherwise loads the user's own settings — hooks
 * included — and a hook that runs at session end keeps the process alive after
 * it has printed its answer. The extension then waits until its timeout kills
 * the run and reports a failure, with a perfectly good SVG discarded. Skipping
 * settings and MCP servers also means generating a poster never fires the
 * user's hooks, and confines the file tools to the project directory.
 */
export function buildClaudeArgs(prompt: string): string[] {
  return [
    '-p', prompt,
    '--output-format', 'text',
    '--max-turns', '5',
    '--system-prompt', POSTER_SYSTEM_PROMPT,
    '--restricted', '--strict-mcp-config', '--no-session-persistence',
    '--allowedTools', ...POSTER_ALLOWED_TOOLS,
  ];
}

/**
 * Environment for the child CLI. Drops the markers a parent Claude Code session
 * leaves behind, which would make the child refuse to start as a nested session
 * when VS Code itself was launched from one.
 */
export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
  }
  return env;
}

/** Thrown when a run is stopped by the user — not a failure, so never surfaced. */
export class PosterCancelledError extends Error {
  constructor() { super('Poster generation cancelled'); this.name = 'PosterCancelledError'; }
}

const GENERATION_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

type PosterCallback = (result: PosterResult) => void;

export class PosterGenerator {
  private cacheDir: string;
  private capabilities: Capabilities;
  private onPoster: PosterCallback;
  private activeProcess: ChildProcess | null = null;
  private abortActive: ((reason: Error) => void) | null = null;

  constructor(
    context: vscode.ExtensionContext,
    capabilities: Capabilities,
    onPoster: PosterCallback,
  ) {
    this.cacheDir = context.globalStorageUri.fsPath;
    this.capabilities = capabilities;
    this.onPoster = onPoster;
  }

  private async ensureCacheDir() {
    await fs.promises.mkdir(path.join(this.cacheDir, 'posters'), { recursive: true });
  }

  private posterPath(project: Project): string {
    return posterCachePath(this.cacheDir, project.path);
  }

  public getCachedPosterPath(project: Project): string | undefined {
    const p = this.posterPath(project);
    try {
      fs.accessSync(p);
      return p;
    } catch {
      return undefined;
    }
  }

  public static getProjectPrompt(project: Project): string {
    const lang = project.primaryLanguage ?? 'software';
    const markers = project.markers.filter(m => m !== '.git').join(', ');
    return buildPosterPrompt(project.name, lang, markers);
  }

  public cancel() {
    this.abortActive?.(new PosterCancelledError());
  }

  public get isGenerating(): boolean {
    return this.activeProcess !== null;
  }

  public async generateOne(project: Project, userNotes?: string): Promise<void> {
    await this.ensureCacheDir();

    const projectPrompt = PosterGenerator.getProjectPrompt(project);
    const svg = await this.runGeneration(projectPrompt, userNotes, project.path);
    if (svg) {
      const posterFile = this.posterPath(project);
      await fs.promises.writeFile(posterFile, svg);
      this.onPoster({ projectPath: project.path, posterUri: posterFile });
    } else {
      throw new Error('Failed to generate valid SVG');
    }
  }

  private async runGeneration(projectPrompt: string, userNotes: string | undefined, cwd?: string): Promise<string | undefined> {
    switch (this.capabilities.bestMethod) {
      case 'claude-cli':
        return this.generateViaClaude(projectPrompt, userNotes, cwd);
      default:
        return undefined;
    }
  }

  private async generateViaClaude(projectPrompt: string, userNotes: string | undefined, cwd?: string): Promise<string | undefined> {
    if (!this.capabilities.claudeCliPath) return undefined;

    const parts = [projectPrompt];
    if (userNotes) {
      parts.push(`\nAdditional notes: ${userNotes}`);
    }
    const fullPrompt = parts.join('\n');

    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        // stdin MUST be closed: with an open pipe the CLI waits for piped input
        // and never produces output at all. `detached` puts the CLI in its own
        // process group so stopping it also stops anything it started (ripgrep
        // behind the Grep tool, say); otherwise an orphan keeps stdout open and
        // neither a cancel nor the timeout could ever end the run.
        const child = spawn(this.capabilities.claudeCliPath!, buildClaudeArgs(fullPrompt), {
          cwd: cwd ?? undefined,
          env: buildChildEnv(process.env),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
        this.activeProcess = child;

        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.activeProcess = null;
          this.abortActive = null;
          fn();
        };
        const killTree = () => {
          try {
            if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
            else child.kill();
          } catch {
            child.kill();
          }
        };
        // Settle at once rather than waiting for 'close': 'close' waits on every
        // holder of the pipes, which is exactly what a stuck grandchild prevents.
        this.abortActive = reason => { killTree(); finish(() => reject(reason)); };

        let out = '';
        let err = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          out += chunk.toString();
          if (out.length > MAX_OUTPUT_BYTES) this.abortActive?.(new Error('output exceeded limit'));
        });
        child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString(); });

        const timer = setTimeout(() => {
          // A complete SVG already printed is a success even if the CLI lingers.
          if (extractSvg(out)) { killTree(); finish(() => resolve(out)); return; }
          this.abortActive?.(new Error(`timed out after ${GENERATION_TIMEOUT_MS / 1000}s`));
        }, GENERATION_TIMEOUT_MS);

        child.on('error', e => finish(() => reject(e)));
        child.on('close', code => finish(() => {
          if (code === 0 || extractSvg(out)) resolve(out);
          else reject(new Error(`exited ${code}${err.trim() ? `: ${err.trim().slice(0, 200)}` : ''}`));
        }));
      });

      const svg = extractSvg(stdout);
      if (svg) return svg;
      const out = stdout.trim();
      throw new Error(`Claude returned non-SVG output (${out.length} chars, starts with: ${out.slice(0, 80)}...)`);
    } catch (err: unknown) {
      if (err instanceof PosterCancelledError) throw err;
      if (err instanceof Error && err.message.startsWith('Claude returned')) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude CLI error: ${msg}`);
    }
  }
}
