import * as vscode from 'vscode';

/** What the identity needs from the extension: a log line, and where a new value is recorded. */
export interface WorkspaceIdentityHost {
    log(line: string): void;
    /** The window opened, or its folders changed: the registry records what it now is. */
    onWorkspace(value: string): void;
}

/**
 * The workspace this window is, as one string.
 *
 * VS Code is the authority for *which* window this is: `workspaceFile` for a saved workspace,
 * otherwise the window's first root folder. It is not the authority for names — it has no project
 * name and hands out no id — so naming and membership stay ours.
 *
 * Empty means a window with no folder and no workspace file: nothing to tag, nothing to record.
 */
export function currentWorkspace(): string {
    const file = vscode.workspace.workspaceFile;
    if (file && file.scheme === 'file') {
        return file.fsPath;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return '';
}

/**
 * The window's workspace, plus the one subscription that follows it.
 *
 * A tab is tagged with `current()` at the moment it is registered, so a folder added after the
 * window opened is picked up by the next tab; `start()` keeps the registry in step in between.
 */
export class WorkspaceIdentity {
    constructor(private readonly _host: WorkspaceIdentityHost) {}

    current(): string {
        return currentWorkspace();
    }

    /** Record the window it opened in, then every change to its folders. */
    start(): vscode.Disposable {
        this._record('opened');
        return vscode.workspace.onDidChangeWorkspaceFolders(() => this._record('changed'));
    }

    private _record(reason: string): void {
        const value = this.current();
        if (!value) {
            return;
        }
        this._host.onWorkspace(value);
        this._host.log(`Workspace ${reason}: ${value}`);
    }
}
