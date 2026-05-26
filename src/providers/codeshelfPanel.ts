import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExtToWebview, WebviewToExt, Shelf, ScanDiff, Project } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';
import { scanRoots } from '../services/projectScanner';
import { detectCapabilities } from '../services/capabilities';
import { PosterGenerator } from '../services/posterGenerator';
import { renderWebviewHtml } from './htmlTemplate';
import { getConfig, addRoot, updateItemMeta } from './config';

export function collectProjectPaths(shelves: Shelf[]): Set<string> {
  const paths = new Set<string>();
  for (const shelf of shelves) {
    for (const item of shelf.items) {
      if (item.kind === 'project') {
        paths.add(item.project.path);
      } else {
        for (const p of item.projects) {
          paths.add(p.path);
        }
      }
    }
  }
  return paths;
}

export function computeDiff(oldShelves: Shelf[], newShelves: Shelf[]): ScanDiff {
  const oldPaths = collectProjectPaths(oldShelves);
  const newPaths = collectProjectPaths(newShelves);
  const addedPaths: string[] = [];
  let removed = 0;
  for (const p of newPaths) {
    if (!oldPaths.has(p)) addedPaths.push(p);
  }
  for (const p of oldPaths) {
    if (!newPaths.has(p)) removed++;
  }
  const added = addedPaths.length;
  return { added, removed, changed: added > 0 || removed > 0, addedPaths };
}

/**
 * Strip active content from SVG markup before it is injected via
 * dangerouslySetInnerHTML. The webview CSP already blocks inline <script>,
 * but SVG can also carry event-handler attributes, <foreignObject> HTML, and
 * javascript: URLs — remove those as defense-in-depth.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/((?:xlink:)?href)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/((?:xlink:)?href)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
}

/**
 * Transform raw SVG markup for proper embedding:
 * - Sanitize active content (scripts, event handlers, foreignObject)
 * - Add viewBox from width/height if missing
 * - Strip hardcoded width/height
 * - Add preserveAspectRatio for cover-style scaling
 */
export function transformSvg(svg: string): string | undefined {
  if (!svg.includes('<svg')) return undefined;
  return sanitizeSvg(svg).replace(/<svg([^>]*)>/, (_match: string, attrs: string) => {
    let newAttrs = attrs;
    const wMatch = attrs.match(/width="(\d+)"/);
    const hMatch = attrs.match(/height="(\d+)"/);
    if (!attrs.includes('viewBox') && wMatch && hMatch) {
      newAttrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
    }
    newAttrs = newAttrs.replace(/\s*width="[^"]*"/g, '');
    newAttrs = newAttrs.replace(/\s*height="[^"]*"/g, '');
    if (!newAttrs.includes('preserveAspectRatio')) {
      newAttrs += ' preserveAspectRatio="xMidYMid slice"';
    }
    return `<svg${newAttrs}>`;
  });
}

export class CodeShelfPanel {
  public static readonly viewType = 'codeshelf.startPage';
  private static instance: CodeShelfPanel | undefined;
  private static readonly CACHE_KEY = STORAGE_KEYS.cachedShelves;
  private static readonly PROMPTS_KEY = STORAGE_KEYS.posterPrompts;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private posterGenerator?: PosterGenerator;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExt) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, this.context.extensionUri);
  }

  public static createOrShow(context: vscode.ExtensionContext) {
    if (CodeShelfPanel.instance) {
      CodeShelfPanel.instance.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CodeShelfPanel.viewType,
      'CodeShelf',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out-webview'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
          context.globalStorageUri,
        ],
      },
    );

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'codeshelf-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'codeshelf-dark.svg'),
    };

    CodeShelfPanel.instance = new CodeShelfPanel(panel, context);
  }

  public static openSettings() {
    vscode.commands.executeCommand('workbench.action.openSettingsJson', {
      revealSetting: { key: 'codeshelf' },
    });
  }

  private postMessage(msg: ExtToWebview) {
    this.panel.webview.postMessage(msg);
  }

  private async handleMessage(msg: WebviewToExt) {
    switch (msg.type) {
      case 'ready':
        await this.onReady();
        break;
      case 'projects:requestScan':
        await this.scan();
        break;
      case 'project:open': {
        const target = msg.workspaceFile ?? msg.path;
        const uri = vscode.Uri.file(target);
        const { openInNewWindow } = getConfig();
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: openInNewWindow });
        break;
      }
      case 'settings:pickRoot': {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Project Root',
          title: 'Choose the root directory where your projects live',
        });
        if (picked && picked.length > 0) {
          await addRoot(picked[0].fsPath);
          await this.scan();
        }
        break;
      }
      case 'settings:addRoot': {
        await addRoot(msg.path);
        await this.scan();
        break;
      }
      case 'item:hide': {
        await updateItemMeta(msg.rootPath, msg.path, { hidden: msg.hidden });
        await this.scan();
        break;
      }
      case 'item:star': {
        await updateItemMeta(msg.rootPath, msg.path, { starred: msg.starred });
        await this.scan();
        break;
      }
      case 'poster:generate': {
        await this.generatePoster(msg.projectPath, msg.userNotes);
        break;
      }
      case 'poster:cancel': {
        if (this.posterGenerator) {
          this.posterGenerator.cancel();
          // Clear forge animation
          this.postMessage({
            type: 'poster:loaded',
            projectPath: msg.projectPath,
            posterUri: '',
          });
        }
        break;
      }
      case 'poster:attach': {
        await this.attachPoster(msg.projectPath);
        break;
      }
      case 'folder:reveal': {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        break;
      }
      case 'settings:openJson': {
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        break;
      }
    }
  }

  private stripPosters(shelves: Shelf[]) {
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project') {
          delete item.project.poster;
        } else {
          for (const p of item.projects) {
            delete p.poster;
          }
        }
      }
    }
  }

  private async onReady() {
    const { roots, booksetThreshold } = getConfig();
    const hasRoots = Object.keys(roots).length > 0;
    this.postMessage({
      type: 'settings:state',
      hasRoots,
      booksetThreshold,
    });

    if (hasRoots) {
      const cached = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY);
      if (cached && cached.length > 0) {
        // Strip any stale poster URIs from cached data, then re-apply from files
        this.stripPosters(cached);
        await this.ensurePosterGenerator();
        await this.applyPosterCache(cached);
        this.postMessage({ type: 'projects:loaded', shelves: cached });
      }
      await this.scan();
    }
  }

  private findProject(projectPath: string): Project | undefined {
    const shelves = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY, []);
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project' && item.project.path === projectPath) {
          return item.project;
        } else if (item.kind === 'bookset') {
          const found = item.projects.find(p => p.path === projectPath);
          if (found) return found;
        }
      }
    }
    return undefined;
  }

  private async generatePoster(projectPath: string, userNotes?: string) {
    await this.ensurePosterGenerator();
    if (!this.posterGenerator) {
      vscode.window.showErrorMessage('CodeShelf: No poster generation method available. Install the Claude CLI to generate posters.');
      return;
    }

    const project = this.findProject(projectPath);
    if (!project) return;

    // Signal the webview to show the forge animation
    this.postMessage({ type: 'poster:generating', projectPath });

    try {
      // Delete existing cached poster so regeneration works
      const existingPath = this.posterGenerator.getCachedPosterPath(project);
      if (existingPath) {
        await fs.promises.unlink(existingPath).catch(() => {});
      }

      await this.posterGenerator.generateOne(project, userNotes || undefined);
      // Save the prompt used
      const prompts = this.context.globalState.get<Record<string, string>>(CodeShelfPanel.PROMPTS_KEY, {});
      prompts[projectPath] = userNotes || '';
      await this.context.globalState.update(CodeShelfPanel.PROMPTS_KEY, prompts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CodeShelf: Failed to generate poster — ${msg}`);
      // Clear the forge animation
      this.postMessage({
        type: 'poster:loaded',
        projectPath,
        posterUri: project.poster ?? '',
      });
    }
  }

  private async attachPoster(projectPath: string) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select Poster Image',
      filters: { 'Images': ['svg', 'png', 'jpg', 'jpeg', 'webp'] },
    });
    if (!picked || picked.length === 0) return;

    const project = this.findProject(projectPath);
    if (!project) return;

    const sourcePath = picked[0].fsPath;

    // Copy to cache dir
    const cacheDir = path.join(this.context.globalStorageUri.fsPath, 'posters');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const hash = Buffer.from(project.path).toString('base64url');
    const ext = path.extname(sourcePath);
    const destPath = path.join(cacheDir, `${hash}${ext}`);

    // Remove any existing cached poster (might be different extension)
    const existingPoster = this.posterGenerator?.getCachedPosterPath(project);
    if (existingPoster) {
      await fs.promises.unlink(existingPoster).catch(() => {});
    }

    await fs.promises.copyFile(sourcePath, destPath);

    // Read and send as inline content
    if (ext === '.svg') {
      const svg = await this.readSvg(destPath);
      if (svg) {
        this.postMessage({ type: 'poster:loaded', projectPath, posterUri: svg });
      }
    } else {
      // For raster images, send as data URI
      const data = await fs.promises.readFile(destPath);
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const dataUri = `<img src="data:${mime};base64,${data.toString('base64')}" style="width:100%;height:100%;object-fit:cover" />`;
      this.postMessage({ type: 'poster:loaded', projectPath, posterUri: dataUri });
    }
  }

  private async ensurePosterGenerator() {
    if (this.posterGenerator) return;
    const caps = await detectCapabilities();
    if (caps.bestMethod === 'none') return;

    this.posterGenerator = new PosterGenerator(this.context, caps, async (result) => {
      const dataUri = await this.readSvg(result.posterUri);
      if (dataUri) {
        this.postMessage({
          type: 'poster:loaded',
          projectPath: result.projectPath,
          posterUri: dataUri,
        });
      }
    });
  }

  private async readSvg(filePath: string): Promise<string | undefined> {
    try {
      const svg: string = await fs.promises.readFile(filePath, 'utf-8');
      return transformSvg(svg);
    } catch {
      return undefined;
    }
  }

  private async applyPosterCache(shelves: Shelf[]) {
    if (!this.posterGenerator) return;
    const gen = this.posterGenerator;
    const prompts = this.context.globalState.get<Record<string, string>>(CodeShelfPanel.PROMPTS_KEY, {});
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project') {
          const cached = gen.getCachedPosterPath(item.project);
          if (cached) {
            item.project.poster = await this.readSvg(cached);
          }
          if (prompts[item.project.path] !== undefined) {
            item.project.posterPrompt = prompts[item.project.path];
          }
        } else {
          for (const p of item.projects) {
            const cached = gen.getCachedPosterPath(p);
            if (cached) {
              p.poster = await this.readSvg(cached);
            }
            if (prompts[p.path] !== undefined) {
              p.posterPrompt = prompts[p.path];
            }
          }
        }
      }
    }
  }

  private async scan() {
    const { roots, scanDepth } = getConfig();

    const cached = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY);
    if (!cached || cached.length === 0) {
      this.postMessage({ type: 'projects:scanning', scanning: true });
    }

    const shelves: Shelf[] = await scanRoots(roots, scanDepth);

    const diff = cached ? computeDiff(cached, shelves) : undefined;
    // Cache shelves WITHOUT poster URIs (those are transient webview URIs)
    await this.context.globalState.update(CodeShelfPanel.CACHE_KEY, shelves);

    // Apply cached poster files before sending to webview
    await this.ensurePosterGenerator();
    await this.applyPosterCache(shelves);

    this.postMessage({ type: 'projects:scanning', scanning: false });
    this.postMessage({ type: 'projects:loaded', shelves, diff });
  }

  private dispose() {
    CodeShelfPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
