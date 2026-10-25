/**
 * The workspace, as the pane and the agent may touch it.
 *
 * Everything here was the provider's: resolving the working directory, deciding whether a path
 * is reachable at all, the file picker behind '@', previews, opening a file, inserting into the
 * editor, and the two ACP callbacks that let Hermes read or write a file in the workspace.
 * Moved unchanged.
 *
 * One rule governs the lot: nothing outside the workspace folders (or, with no workspace, the
 * configured cwd) is readable. That is why the read and write callbacks live here rather than
 * next to the connection: they are this rule, not the protocol.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import type { HostToPane } from '../types/webview';

/** What the host supplies: the pane and the log. Nothing else is needed. */
export interface WorkspaceHost {
    post(msg: HostToPane): void;
    log(line: string): void;
}

export class WorkspaceFiles {
    constructor(private _host: WorkspaceHost) {}

    resolveCwd(configCwd?: string): string {
        if (configCwd) return configCwd;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) return folder.uri.fsPath;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) return folders[0].uri.fsPath;
        return process.cwd();
    }

    isPathAllowed(p: string): boolean {
        if (!path.isAbsolute(p)) return true; // relative paths are fine
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders.some(f => p.startsWith(f.uri.fsPath));
        }
        // No workspace: restrict to cwd
        const config = vscode.workspace.getConfiguration('tommys');
        const configCwd = config.get<string>('cwd');
        const cwd = configCwd || process.cwd();
        return p.startsWith(cwd);
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

    /** ACP's fs/read_text_file: the agent asks this side to read, so the pane applies its own rules. */
    async readTextFile(p: string): Promise<string> {
        this._host.log(`fs.readTextFile: ${p}`);
        if (!this.isPathAllowed(p)) {
            throw new Error(`Access denied: '${p}' is outside workspace folders`);
        }
        const uri = vscode.Uri.file(p);
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(bytes);
    }

    /** ACP's fs/write_text_file: same rule as the read side. */
    async writeTextFile(p: string, content: string): Promise<void> {
        this._host.log(`fs.writeTextFile: ${p} (${content.length} chars)`);
        if (!this.isPathAllowed(p)) {
            throw new Error(`Access denied: '${p}' is outside workspace folders`);
        }
        const uri = vscode.Uri.file(p);
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    }
}
