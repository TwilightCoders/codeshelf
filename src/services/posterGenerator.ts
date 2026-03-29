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
  private queue: Project[] = [];
  private running = false;
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
    // Hash the project path to a safe filename
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

  public enqueue(projects: Project[]) {
    // Only enqueue projects that don't already have a cached poster
    const newProjects = projects.filter(p => !this.getCachedPosterPath(p));
    // Don't re-enqueue projects already in the queue
    const existing = new Set(this.queue.map(p => p.path));
    for (const p of newProjects) {
      if (!existing.has(p.path)) {
        this.queue.push(p);
      }
    }
    if (!this.running) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.capabilities.bestMethod === 'none') return;
    this.running = true;
    await this.ensureCacheDir();

    while (this.queue.length > 0) {
      const project = this.queue.shift()!;
      // Double-check it hasn't been cached while waiting in queue
      if (this.getCachedPosterPath(project)) continue;

      try {
        const svg = await this.generate(project);
        if (svg) {
          const posterFile = this.posterPath(project);
          await fs.promises.writeFile(posterFile, svg);
          this.onPoster({ projectPath: project.path, posterUri: posterFile });
        }
      } catch (err) {
        // Log but don't stop the queue
        console.error(`CodeShelf: Failed to generate poster for ${project.name}:`, err);
      }

      // Throttle: wait a bit between generations to be respectful
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    this.running = false;
  }

  private async generate(project: Project): Promise<string | undefined> {
    switch (this.capabilities.bestMethod) {
      case 'claude-cli':
        return this.generateViaClaude(project);
      default:
        return undefined;
    }
  }

  private async generateViaClaude(project: Project): Promise<string | undefined> {
    if (!this.capabilities.claudeCliPath) return undefined;

    const lang = project.primaryLanguage ?? 'software';
    const prompt = [
      `Generate a minimal, elegant SVG poster/cover image for a ${lang} project called "${project.name}".`,
      `The SVG should be exactly 400x240 pixels.`,
      `Use a dark background with subtle geometric elements and the project name.`,
      `The design should feel modern and technical, like a Steam game library card.`,
      project.description ? `Project description: ${project.description}` : '',
      `Output ONLY the raw SVG markup, nothing else. No markdown fences, no explanation.`,
      `Start with <svg and end with </svg>.`,
    ].filter(Boolean).join(' ');

    try {
      const { stdout } = await execFileAsync(
        this.capabilities.claudeCliPath,
        ['-p', prompt, '--output-format', 'text'],
        {
          timeout: 60000,
          maxBuffer: 1024 * 512,
          env: { ...process.env },
        },
      );

      const svg = stdout.trim();
      // Validate it's actually SVG
      if (svg.startsWith('<svg') && svg.endsWith('</svg>')) {
        return svg;
      }
      // Try to extract SVG from any surrounding text
      const match = svg.match(/<svg[\s\S]*<\/svg>/);
      return match ? match[0] : undefined;
    } catch (err) {
      console.error('CodeShelf: claude CLI error:', err);
      return undefined;
    }
  }
}
