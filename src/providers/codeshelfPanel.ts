import * as vscode from 'vscode';
import { ExtToWebview, WebviewToExt, Shelf, ScanDiff, RootsConfig, Project } from '../shared/types';
import { scanRoots } from '../services/projectScanner';
import { detectCapabilities } from '../services/capabilities';
import { PosterGenerator } from '../services/posterGenerator';

function collectProjectPaths(shelves: Shelf[]): Set<string> {
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

function computeDiff(oldShelves: Shelf[], newShelves: Shelf[]): ScanDiff {
  const oldPaths = collectProjectPaths(oldShelves);
  const newPaths = collectProjectPaths(newShelves);
  let added = 0;
  let removed = 0;
  for (const p of newPaths) {
    if (!oldPaths.has(p)) added++;
  }
  for (const p of oldPaths) {
    if (!newPaths.has(p)) removed++;
  }
  return { added, removed, changed: added > 0 || removed > 0 };
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('codeshelf');
  return {
    roots: config.get<RootsConfig>('roots', {}),
    scanDepth: config.get<number>('scanDepth', 3),
    openInNewWindow: config.get<boolean>('openInNewWindow', false),
  };
}

export class CodeShelfPanel {
  public static readonly viewType = 'codeshelf.startPage';
  private static instance: CodeShelfPanel | undefined;
  private static readonly CACHE_KEY = 'codeshelf.cachedShelves';

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
    this.panel.webview.html = this.getHtml();
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
          await this.addRoot(picked[0].fsPath);
        }
        break;
      }
      case 'settings:addRoot': {
        await this.addRoot(msg.path);
        break;
      }
      case 'item:editMeta': {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'codeshelf.roots',
        );
        break;
      }
      case 'item:hide': {
        await this.updateShelfMeta(msg.rootPath, msg.path, { hidden: true });
        await this.scan();
        break;
      }
      case 'item:star': {
        await this.updateShelfMeta(msg.rootPath, msg.path, { starred: msg.starred });
        await this.scan();
        break;
      }
      case 'poster:generate': {
        await this.generatePoster(msg.projectPath, msg.userNotes);
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

  private async addRoot(rootPath: string) {
    const config = vscode.workspace.getConfiguration('codeshelf');
    const roots = config.get<RootsConfig>('roots', {});
    if (!roots[rootPath]) {
      roots[rootPath] = {};
      await config.update('roots', roots, vscode.ConfigurationTarget.Global);
    }
    await this.scan();
  }

  private async updateShelfMeta(rootPath: string, shelfPath: string, updates: Record<string, unknown>) {
    const config = vscode.workspace.getConfiguration('codeshelf');
    const roots = config.get<RootsConfig>('roots', {});
    // Find root by expanded or raw path
    const rootKey = Object.keys(roots).find(k =>
      k === rootPath || k.replace(/^~/, process.env.HOME ?? '') === rootPath
    );
    if (!rootKey) return;

    const root = roots[rootKey];
    if (!root.shelves) root.shelves = {};

    // Try to find existing shelf entry by full path or basename
    const basename = require('path').basename(shelfPath);
    const shelfKey = root.shelves[shelfPath] ? shelfPath
      : root.shelves[basename] ? basename
      : basename; // default to basename for new entries

    if (!root.shelves[shelfKey]) root.shelves[shelfKey] = {};
    const shelf = root.shelves[shelfKey];
    for (const [key, value] of Object.entries(updates)) {
      if (value === false || value === undefined || value === null || value === '') {
        delete (shelf as Record<string, unknown>)[key];
      } else {
        (shelf as Record<string, unknown>)[key] = value;
      }
    }
    // Clean up empty shelf entries
    if (Object.keys(shelf).length === 0) {
      delete root.shelves[shelfKey];
    }
    // Clean up empty shelves object
    if (Object.keys(root.shelves).length === 0) {
      delete root.shelves;
    }

    await config.update('roots', roots, vscode.ConfigurationTarget.Global);
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
    const { roots } = getConfig();
    const hasRoots = Object.keys(roots).length > 0;
    this.postMessage({ type: 'settings:state', hasRoots });

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
        await require('fs').promises.unlink(existingPath).catch(() => {});
      }

      await this.posterGenerator.generateOne(project, userNotes || undefined);
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
    const fs = require('fs');
    const path = require('path');

    // Copy to cache dir
    const cacheDir = require('path').join(this.context.globalStorageUri.fsPath, 'posters');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const hash = Buffer.from(project.path).toString('base64url');
    const ext = path.extname(sourcePath);
    const destPath = require('path').join(cacheDir, `${hash}${ext}`);

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
      const fs = require('fs');
      let svg: string = await fs.promises.readFile(filePath, 'utf-8');
      if (!svg.includes('<svg')) return undefined;
      // Make SVG scale properly when embedded:
      // - Ensure viewBox exists (needed for scaling)
      // - Remove hardcoded width/height so CSS controls sizing
      // - Add preserveAspectRatio for cover-style scaling
      svg = svg.replace(/<svg([^>]*)>/, (_match: string, attrs: string) => {
        let newAttrs = attrs;
        // Extract width/height to build viewBox if missing
        const wMatch = attrs.match(/width="(\d+)"/);
        const hMatch = attrs.match(/height="(\d+)"/);
        if (!attrs.includes('viewBox') && wMatch && hMatch) {
          newAttrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
        }
        // Remove hardcoded width/height
        newAttrs = newAttrs.replace(/\s*width="[^"]*"/g, '');
        newAttrs = newAttrs.replace(/\s*height="[^"]*"/g, '');
        // Add preserveAspectRatio
        if (!newAttrs.includes('preserveAspectRatio')) {
          newAttrs += ' preserveAspectRatio="xMidYMid slice"';
        }
        return `<svg${newAttrs}>`;
      });
      return svg;
    } catch {
      return undefined;
    }
  }

  private async applyPosterCache(shelves: Shelf[]) {
    if (!this.posterGenerator) return;
    const gen = this.posterGenerator;
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        if (item.kind === 'project') {
          const cached = gen.getCachedPosterPath(item.project);
          if (cached) {
            item.project.poster = await this.readSvg(cached);
          }
        } else {
          for (const p of item.projects) {
            const cached = gen.getCachedPosterPath(p);
            if (cached) {
              p.poster = await this.readSvg(cached);
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

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out-webview', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles', 'main.css'),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
    );
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${codiconUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>CodeShelf</title>
</head>
<body>
  <div id="app">
    <!-- Setup screen (first launch) -->
    <div id="setup" class="screen" style="display:none">
      <div class="setup-container">
        <h1 class="setup-title">CodeShelf</h1>
        <p class="setup-subtitle">Your projects, organized beautifully.</p>
        <p class="setup-description">
          To get started, choose the root directory where your projects live.
        </p>
        <button id="pickRootBtn" class="btn btn-primary">
          Choose Directory
        </button>
      </div>
    </div>

    <!-- Main shelf view -->
    <div id="shelf" class="screen" style="display:none">
      <header class="shelf-header">
        <h1 class="shelf-logo">CodeShelf</h1>
        <div class="shelf-controls">
          <span id="syncStatus" class="sync-status"></span>
          <div class="search-wrapper">
            <input type="text" id="searchInput" class="search-input" placeholder="Search projects..." />
            <button id="searchClear" class="search-clear" title="Clear search">&times;</button>
          </div>
          <button id="addRootBtn" class="btn btn-ghost" title="Add another root directory"><i class="codicon codicon-add"></i></button>
          <button id="refreshBtn" class="btn btn-ghost" title="Rescan projects"><i class="codicon codicon-refresh"></i></button>
          <button id="settingsBtn" class="btn btn-ghost" title="Edit settings (JSON)"><i class="codicon codicon-settings-gear"></i></button>
          <button id="walkthroughBtn" class="btn btn-ghost" title="Show walkthrough"><i class="codicon codicon-lightbulb"></i></button>
        </div>
      </header>
      <div id="shelfContent" class="shelf-content"></div>
    </div>

    <!-- Project detail modal -->
    <div id="detailModal" class="detail-modal" style="display:none">
      <div class="detail-backdrop"></div>
      <div class="detail-panel">
        <div class="detail-poster">
          <div class="detail-poster-content" id="detailPoster"></div>
          <button class="detail-poster-btn detail-generate-btn" id="detailGenerate" title="Generate poster"><i class="codicon codicon-sparkle"></i></button>
          <button class="detail-poster-btn detail-attach-btn" id="detailAttach" title="Attach custom poster"><i class="codicon codicon-file-media"></i></button>
          <button class="detail-poster-btn detail-close" title="Close"><i class="codicon codicon-close"></i></button>
        </div>
        <div class="detail-info">
          <h2 class="detail-name" id="detailName"></h2>
          <p class="detail-path" id="detailPath"></p>
          <div class="detail-meta" id="detailMeta"></div>
          <button class="btn btn-primary detail-open" id="detailOpen">
            <i class="codicon codicon-folder-opened"></i> Open Project
          </button>
        </div>
        <!-- Prompt editor (shown when generating) -->
        <div class="prompt-editor" id="promptEditor" style="display:none">
          <div class="prompt-section prompt-pre" id="promptPre"></div>
          <textarea class="prompt-input" id="promptInput" rows="2" placeholder="Optional: your notes here..."></textarea>
          <div class="prompt-section prompt-post" id="promptPost"></div>
          <div class="prompt-actions">
            <button class="btn btn-primary" id="promptSubmit"><i class="codicon codicon-sparkle"></i> Generate</button>
            <button class="btn btn-ghost" id="promptCancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div id="loading" class="screen" style="display:none">
      <div class="loading-spinner"></div>
      <p class="loading-text">Scanning projects...</p>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}" type="module"></script>
</body>
</html>`;
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

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
