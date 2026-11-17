/**
 * The workspace as the pane may touch it: the file picker behind '@', previews, opening a file,
 * inserting into the editor.
 *
 * One rule governs the lot: nothing outside the folders this window opened is readable, and a
 * window with no folder has no readable root at all. Where the cwd comes from is not a question
 * for this file — the cwd owner answers that.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import type { HostToPane } from '../../shared/webview';

/** What the host supplies: the pane and the log. Nothing else is needed. */
export interface WorkspaceHost {
    post(msg: HostToPane): void;
    log(line: string): void;
}

import { pathWithin } from './cwd';

export { pathWithin };

export class WorkspaceFiles {
    constructor(private _host: WorkspaceHost) {}

    /** Every directory the agent may reach: the folders this window opened, and nothing else. */
    private allowedRoots(): string[] {
        return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
    }

    /** A path as the filesystem will see it: symlinks followed, missing tails resolved by parent. */
    private realPath(p: string): string {
        const resolved = path.resolve(p);
        try {
            return fs.realpathSync(resolved);
        } catch {
            try {
                return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
            } catch {
                return resolved;
            }
        }
    }

    /**
     * Containment, not a string prefix.
     *
     * `startsWith()` passed for two paths it should not have: a sibling with the same prefix
     * (`/work/repo-secrets` for `/work/repo`) and an absolute path that walks back out
     * (`/work/repo/../secrets`). Relative paths were allowed outright, which is the same hole
     * through a different door. Resolve first, then require the result to sit inside a root.
     */
    isPathAllowed(p: string): boolean {
        if (!p) {
            return false;
        }
        const target = this.realPath(p);
        return this.allowedRoots().some(root => pathWithin(this.realPath(root), target));
    }

    resolveFileUri(filePath: string): vscode.Uri | undefined {
        const normalized = filePath.replace(/^@/, '').trim();
        if (!normalized) {
            return undefined;
        }
        if (path.isAbsolute(normalized)) {
            return vscode.Uri.file(normalized);
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            for (const folder of folders) {
                const candidate = vscode.Uri.joinPath(folder.uri, normalized);
                if (this.isPathAllowed(candidate.fsPath)) {
                    return candidate;
                }
            }
            return vscode.Uri.joinPath(folders[0].uri, normalized);
        }
        return vscode.Uri.file(normalized);
    }

    toDisplayPath(uri: vscode.Uri): string {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) {
            return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        }
        return uri.fsPath.replace(/\\/g, '/');
    }

    async listFiles(query: string, requestId: string): Promise<void> {
        const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.hermes/**}';
        const q = query.trim().toLowerCase();
        try {
            const uris = await vscode.workspace.findFiles('**/*', exclude, 500);
            const files = uris
                .map(uri => this.toDisplayPath(uri))
                .filter(p => !q || p.toLowerCase().includes(q))
                .slice(0, 30);
            this._host.post({ type: 'fileList', requestId, files });
        } catch {
            this._host.post({ type: 'fileList', requestId, files: [] });
        }
    }

    async previewFile(filePath: string, requestId: string): Promise<void> {
        const normalized = filePath.replace(/^@/, '').trim();
        try {
            const uri = this.resolveFileUri(normalized);
            if (!uri || !this.isPathAllowed(uri.fsPath)) {
                this._host.post({
                    type: 'filePreview',
                    requestId,
                    path: normalized,
                    error: t('fileAccessDenied'),
                });
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            const maxLines = 24;
            let content: string;
            if (doc.lineCount <= maxLines) {
                content = doc.getText();
            } else {
                const endLine = doc.lineAt(maxLines - 1);
                content = doc.getText(new vscode.Range(0, 0, maxLines - 1, endLine.text.length)) + '\n…';
            }
            this._host.post({
                type: 'filePreview',
                requestId,
                path: this.toDisplayPath(uri),
                content,
                language: doc.languageId,
            });
        } catch {
            this._host.post({
                type: 'filePreview',
                requestId,
                path: normalized,
                error: t('fileReadError'),
            });
        }
    }

    async openFile(filePath: string): Promise<void> {
        this._host.log(`Open file: ${filePath}`);
        try {
            const uri = this.resolveFileUri(filePath);
            if (!uri) {
                vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
        }
    }

    async insertEditor(text: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage(t('noActiveEditor'));
            return;
        }
        await editor.edit((editBuilder) => {
            editBuilder.insert(editor.selection.active, text);
        });
    }

}
