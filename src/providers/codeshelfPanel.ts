import * as vscode from 'vscode';
import { ExtToWebview, WebviewToExt, Shelf } from '../shared/types';
import { scanRoots } from '../services/projectScanner';

export class CodeShelfPanel {
  public static readonly viewType = 'codeshelf.startPage';
  private static instance: CodeShelfPanel | undefined;

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

    CodeShelfPanel.instance = new CodeShelfPanel(panel, context);
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
        const uri = vscode.Uri.file(msg.path);
        const config = vscode.workspace.getConfiguration('codeshelf');
        const newWindow = config.get<boolean>('openInNewWindow', false);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
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
          const rootPath = picked[0].fsPath;
          const config = vscode.workspace.getConfiguration('codeshelf');
          const roots = config.get<string[]>('roots', []);
          if (!roots.includes(rootPath)) {
            roots.push(rootPath);
            await config.update('roots', roots, vscode.ConfigurationTarget.Global);
          }
          await this.scan();
        }
        break;
      }
      case 'settings:addRoot': {
        const config = vscode.workspace.getConfiguration('codeshelf');
        const roots = config.get<string[]>('roots', []);
        if (!roots.includes(msg.path)) {
          roots.push(msg.path);
          await config.update('roots', roots, vscode.ConfigurationTarget.Global);
        }
        await this.scan();
        break;
      }
      case 'project:editManifest': {
        const manifestPath = vscode.Uri.file(
          require('path').join(msg.path, '.codeshelf.json'),
        );
        try {
          await vscode.workspace.fs.stat(manifestPath);
        } catch {
          // Create default manifest if it doesn't exist
          const defaultManifest = JSON.stringify({
            name: require('path').basename(msg.path),
            description: '',
            poster: '',
            tags: [],
          }, null, 2) + '\n';
          await vscode.workspace.fs.writeFile(manifestPath, Buffer.from(defaultManifest));
        }
        await vscode.commands.executeCommand('vscode.open', manifestPath);
        break;
      }
      case 'settings:openConfig': {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'codeshelf',
        );
        break;
      }
    }
  }

  private static readonly CACHE_KEY = 'codeshelf.cachedShelves';

  private async onReady() {
    const config = vscode.workspace.getConfiguration('codeshelf');
    const roots = config.get<string[]>('roots', []);
    this.postMessage({ type: 'settings:state', hasRoots: roots.length > 0 });

    if (roots.length > 0) {
      // Show cached data immediately if available
      const cached = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY);
      if (cached && cached.length > 0) {
        this.postMessage({ type: 'projects:loaded', shelves: cached });
      }
      // Then rescan in background and update
      await this.scan();
    }
  }

  private async scan() {
    const config = vscode.workspace.getConfiguration('codeshelf');
    const roots = config.get<string[]>('roots', []);
    const hidden = config.get<string[]>('hidden', []);
    const depth = config.get<number>('scanDepth', 3);

    // Only show scanning indicator if we have no cached data
    const cached = this.context.globalState.get<Shelf[]>(CodeShelfPanel.CACHE_KEY);
    if (!cached || cached.length === 0) {
      this.postMessage({ type: 'projects:scanning', scanning: true });
    }

    const shelves: Shelf[] = await scanRoots(roots, hidden, depth);
    await this.context.globalState.update(CodeShelfPanel.CACHE_KEY, shelves);
    this.postMessage({ type: 'projects:scanning', scanning: false });
    this.postMessage({ type: 'projects:loaded', shelves });
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
