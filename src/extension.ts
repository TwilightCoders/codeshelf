import * as vscode from 'vscode';
import { CodeShelfPanel } from './providers/codeshelfPanel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeshelf.open', () => {
      CodeShelfPanel.createOrShow(context);
    }),
  );

  // Auto-open when no workspace folder is open
  // TODO: For production, gate this on: !vscode.workspace.workspaceFolders?.length
  CodeShelfPanel.createOrShow(context);
}

export function deactivate() {}
