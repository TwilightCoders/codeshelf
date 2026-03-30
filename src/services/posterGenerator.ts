import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Project } from '../shared/types';
import { Capabilities } from './capabilities';

const execFileAsync = promisify(execFile);

export interface PosterResult {
  projectPath: string;
  posterUri: string;
}

type PosterCallback = (result: PosterResult) => void;

export class PosterGenerator {
  private cacheDir: string;
  private capabilities: Capabilities;
  private onPoster: PosterCallback;

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

  public static buildDefaultPrompt(project: Project): string {
    const lang = project.primaryLanguage ?? 'software';
    const parts = [
      `Explore the project at "${project.path}".`,
      `Read the README.md if it exists, and any other files that help you understand the project.`,
      `Then generate a minimal, elegant SVG poster/cover image for this ${lang} project called "${project.name}".`,
      `The SVG must be exactly 400x240 pixels.`,
      `Use a dark background with subtle geometric elements and the project name.`,
      `The design should feel modern and technical, like a Steam game library card.`,
      `Let the project's purpose and personality inform the visual design.`,
    ];
    if (project.description) {
      parts.push(`Project description: ${project.description}`);
    }
    return parts.join(' ');
  }

  public async generateOne(project: Project, userPrompt: string): Promise<void> {
    await this.ensureCacheDir();

    const svg = await this.runGeneration(userPrompt, project.path);
    if (svg) {
      const posterFile = this.posterPath(project);
      await fs.promises.writeFile(posterFile, svg);
      this.onPoster({ projectPath: project.path, posterUri: posterFile });
    } else {
      throw new Error('Failed to generate valid SVG');
    }
  }

  private async runGeneration(prompt: string, cwd?: string): Promise<string | undefined> {
    switch (this.capabilities.bestMethod) {
      case 'claude-cli':
        return this.generateViaClaude(prompt, cwd);
      default:
        return undefined;
    }
  }

  private async generateViaClaude(userPrompt: string, cwd?: string): Promise<string | undefined> {
    if (!this.capabilities.claudeCliPath) return undefined;

    const fullPrompt = [
      userPrompt,
      'Output ONLY the raw SVG markup, nothing else. No markdown fences, no explanation.',
      'Start with <svg and end with </svg>.',
    ].join(' ');

    try {
      const { stdout } = await execFileAsync(
        this.capabilities.claudeCliPath,
        ['-p', fullPrompt, '--output-format', 'text'],
        {
          timeout: 120000,
          maxBuffer: 1024 * 512,
          cwd: cwd ?? undefined,
          env: { ...process.env },
        },
      );

      const svg = stdout.trim();
      if (svg.startsWith('<svg') && svg.endsWith('</svg>')) {
        return svg;
      }
      const match = svg.match(/<svg[\s\S]*<\/svg>/);
      return match ? match[0] : undefined;
    } catch (err) {
      console.error('CodeShelf: claude CLI error:', err);
      return undefined;
    }
  }
}
