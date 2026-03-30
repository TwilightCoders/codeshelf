import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { Project } from '../shared/types';
import { POSTER_SYSTEM_PROMPT, buildPosterPrompt } from '../shared/constants';
import { Capabilities } from './capabilities';


export interface PosterResult {
  projectPath: string;
  posterUri: string;
}

type PosterCallback = (result: PosterResult) => void;

export class PosterGenerator {
  private cacheDir: string;
  private capabilities: Capabilities;
  private onPoster: PosterCallback;
  private activeProcess: ReturnType<typeof execFile> | null = null;

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
    const hash = Buffer.from(project.path).toString('base64url');
    return path.join(this.cacheDir, 'posters', `${hash}.svg`);
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
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
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
        this.activeProcess = execFile(
          this.capabilities.claudeCliPath!,
          ['-p', fullPrompt, '--output-format', 'text', '--max-turns', '1', '--system-prompt', POSTER_SYSTEM_PROMPT],
          {
            timeout: 120000,
            maxBuffer: 1024 * 512,
            cwd: cwd ?? undefined,
            env: { ...process.env },
          },
          (err, stdout) => {
            this.activeProcess = null;
            if (err) reject(err);
            else resolve(stdout);
          },
        );
      });

      const svg = stdout.trim();
      if (svg.startsWith('<svg') && svg.endsWith('</svg>')) {
        return svg;
      }
      const match = svg.match(/<svg[\s\S]*<\/svg>/);
      if (match) return match[0];
      throw new Error(`Claude returned non-SVG output (${svg.length} chars, starts with: ${svg.slice(0, 80)}...)`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Claude returned')) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude CLI error: ${msg}`);
    }
  }
}
