import * as path from 'path';
import * as vscode from 'vscode';
import type { EditorFiles } from '../../shared/editor';

/** Only the kinds of noise nobody means to attach: dependencies, builds, and Hermes' own data. */
const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.hermes/**}';

/**
 * The editor, behind the port the chat feature declares.
 *
 * This is the only place the pane's file actions meet `vscode`: listing, reading a head, opening a
 * file, inserting at the cursor. The rule about what may be read lives with the feature; this file
 * only answers what the editor knows.
 */
export function createEditorFiles(): EditorFiles {
    return {
        folders: () => (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath),

        list: async (limit: number) => {
            const uris = await vscode.workspace.findFiles('**/*', EXCLUDE, limit * 20);
            return uris.map(uri => display(uri));
        },

        readHead: async (filePath: string, maxLines: number) => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const end = Math.min(doc.lineCount, maxLines);
            const lines: string[] = [];
            for (let index = 0; index < end; index += 1) {
                lines.push(doc.lineAt(index).text);
            }
            return { lines, total: doc.lineCount, language: doc.languageId };
        },

        open: async (filePath: string) => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc);
        },

        insertAtCursor: async (text: string) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return false;
            }
            await editor.edit(builder => {
                builder.insert(editor.selection.active, text);
            });
            return true;
        },

        display: (filePath: string) => display(vscode.Uri.file(filePath)),

        notify: (message: string, level: 'warn' | 'info') => {
            if (level === 'warn') {
                void vscode.window.showWarningMessage(message);
                return;
            }
            void vscode.window.showInformationMessage(message);
        },
    };
}

/** Relative to its folder when the folder is one of ours; a full path otherwise. */
function display(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const shown = folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath;
    return shown.replace(/\\/g, '/');
}
