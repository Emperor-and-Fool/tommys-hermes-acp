import { createHash } from 'crypto';
import * as vscode from 'vscode';

/**
 * The workspace: which one this window is.
 *
 * The registry that persists workspaces is `WorkspaceStore` in `store.ts`, beside the projects and
 * tabs that point at it. What is left here is the identity: the path VS Code says this window is,
 * and the one subscription that records it. A workspace is the same fact for every profile in the
 * window; projects and tabs are per profile, so they are not here.
 */

/** An id for a thing this file owns: the time it was made, plus four characters against a tie. */
export function mintId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * The id of a workspace: derived from its path, so it cannot change.
 *
 * Everything a tab and a project point at hangs off this. A minted id looked equivalent until a
 * registry rewrite re-minted it: every tab then carried a reference to an id that no longer
 * existed, so every tab and every project disappeared from the window at once. A hash of the path
 * is the same id forever — a lost, truncated or rewritten registry re-creates it identically.
 *
 * "No workspace" (`''`) has no id: it is the absence of one, not a workspace.
 */
export function workspaceIdFor(workspacePath: string): string {
    if (!workspacePath) {
        return '';
    }
    return createHash('sha256').update(workspacePath).digest('hex').slice(0, 12);
}

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
 * name and hands out no id — so naming stays ours.
 *
 * Empty means a window with no folder and no workspace file: a place of its own, with its own tabs.
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
