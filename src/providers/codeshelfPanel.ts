import * as vscode from 'vscode';
import { ExtToWebview, WebviewToExt, Shelf, ScanDiff, RootsConfig } from '../shared/types';
import { scanRoots } from '../services/projectScanner';

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

  private async onReady() {
    const { roots } = getConfig();
    const hasRoots = Object.keys(roots).length > 0;
    this.postMessage({ type: 'settings:state', hasRoots });

    if (hasRoots) {
      const cached = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY);
      if (cached && cached.length > 0) {
        this.postMessage({ type: 'projects:loaded', shelves: cached });
      }
      await this.scan();
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
    await this.context.globalState.update(CodeShelfPanel.CACHE_KEY, shelves);
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
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
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
          <button id="addRootBtn" class="btn btn-ghost" title="Add another root directory">+</button>
          <button id="refreshBtn" class="btn btn-ghost" title="Rescan projects">&#x21bb;</button>
        </div>
      </header>
      <div id="shelfContent" class="shelf-content"></div>
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
