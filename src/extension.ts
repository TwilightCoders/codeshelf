import * as vscode from 'vscode';
import { CodeShelfPanel } from './providers/codeshelfPanel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeshelf.open', () => {
      CodeShelfPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand('codeshelf.editSettings', () => {
      CodeShelfPanel.openSettings();
    }),
    vscode.commands.registerCommand('codeshelf.clearCache', async () => {
      await context.globalState.update('codeshelf.cachedShelves', undefined);
      await context.globalState.update('codeshelf.posterPrompts', undefined);
      vscode.window.showInformationMessage('CodeShelf: Cache cleared. Reopen to see the fireworks.');
    }),
    vscode.commands.registerCommand('codeshelf.editCache', async () => {
      const fs = require('fs');
      const path = require('path');
      const shelves = context.globalState.get('codeshelf.cachedShelves', []);
      const tmpPath = path.join(context.globalStorageUri.fsPath, 'cache-edit.json');
      await fs.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true });
      await fs.promises.writeFile(tmpPath, JSON.stringify(shelves, null, 2));
      const doc = await vscode.workspace.openTextDocument(tmpPath);
      await vscode.window.showTextDocument(doc);
      const disposable = vscode.workspace.onDidSaveTextDocument(async saved => {
        if (saved.uri.fsPath === tmpPath) {
          try {
            const parsed = JSON.parse(saved.getText());
            await context.globalState.update('codeshelf.cachedShelves', parsed);
            vscode.window.showInformationMessage('CodeShelf: Cache updated. Rescan to see changes.');
          } catch {
            vscode.window.showErrorMessage('CodeShelf: Invalid JSON — cache not updated.');
          }
        }
      });
      const closeDisposable = vscode.window.onDidChangeVisibleTextEditors(editors => {
        if (!editors.some(e => e.document === doc)) {
          disposable.dispose();
          closeDisposable.dispose();
        }
      });
    }),
  );

  // Auto-open when no workspace folder is open
  // TODO: For production, gate this on: !vscode.workspace.workspaceFolders?.length
  CodeShelfPanel.createOrShow(context);
}

export function deactivate() {}
