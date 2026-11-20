import path from 'path';

/**
 * Containment by directory, not by string prefix: `/work/repo-secrets` is not inside `/work/repo`,
 * and neither is `/work/repo/../elsewhere`. Both passed when this was `startsWith()`.
 */
export function pathWithin(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A folder a workspace offers: ours, by id, with the path it currently has. */
export interface OfferedFolder {
    folderId: string;
    /** The folder's path. Empty when its row was lost: nothing can be put there. */
    path: string;
    /** When it joined this workspace: the fallback answer for "the most recent folder". */
    addedAt: number;
    /** Gone from the workspace: shown in the dialog, and not choosable. */
    removed: boolean;
    /** Seconds left of the "new folder" welcome; 0 (or absent) for a folder that is not new. */
    newSecondsLeft?: number;
}

/**
 * A workspace's folders and its rows, through the port: the store behind it is the only writer.
 *
 * Ids, not paths: a session's cwd is `permissionRootFolderId`, so a folder that is moved changes one
 * value in the folder table instead of every reference to it (00.02 §1). The workspace is named by
 * its stored id, never by a hash of its path.
 */
export interface RootsSource {
    /** This workspace's folders, in the editor's last order. */
    offered(workspaceId: string): OfferedFolder[];
    /** The agent's default folder for this workspace: what a new session starts in. */
    defaultFolderId(workspaceId: string): string;
    setDefaultFolderId(workspaceId: string, folderId: string): void;
    /** What the editor reports for a workspace: the folder tables behind every later question. */
    record(workspaceId: string, paths: string[]): void;
    /** A folder's path today. '' when the id is not one of ours. */
    pathFor(folderId: string): string;
    /** How much of a folder's "new" welcome is left: the row is the record, not the caller. */
    setNewSecondsLeft(workspaceId: string, folderId: string, seconds: number): void;
    /** The stored id of a workspace, by the path the editor gives us. */
    workspaceId(workspacePath: string): string;
}

/** The folders the picker may offer: a workspace showing two or more has a choice (tier 1). */
export function offeredRoots(folders: string[]): string[] {
    return folders.length > 1 ? folders.slice() : [];
}

/**
 * Which folder a new session starts in, by the rules the old roots had, now on folder ids.
 *
 *   - one folder is the whole workspace: there is nothing to choose, so no choice is kept;
 *   - a workspace that has never chosen takes its first folder;
 *   - a chosen folder that is still there stays;
 *   - a chosen folder that is gone becomes the most recently added one still there — `addedAt`,
 *     not VS Code's position, because position says where it is drawn, not when it joined.
 */
export function defaultFolderFor(storedFolderId: string, offered: OfferedFolder[]): string {
    const live = offered.filter(folder => !folder.removed && folder.path);
    if (live.length === 0) {
        return '';
    }
    if (live.length === 1) {
        return live[0].folderId;
    }
    if (!storedFolderId) {
        return live[0].folderId;
    }
    if (live.some(folder => folder.folderId === storedFolderId)) {
        return storedFolderId;
    }
    return live.reduce((best, folder) => (folder.addedAt > best.addedAt ? folder : best), live[0]).folderId;
}

/** What the locator needs from the editor. Declared here; the composition root fills it. */
export interface CwdSource {
    /** The window's `.code-workspace` file, or '' when it opened plain folders. */
    workspaceFile(): string;
    /** The folders the window opened, in the editor's order. */
    folders(): string[];
    /** Told when that list changes; returns the unsubscribe. Absent in tests that never move. */
    onFoldersChanged?(handler: () => void): () => void;
}

/**
 * The one owner of "which folder does this session work in".
 *
 * One concept, not two: the folder Hermes works in for a session — its cwd, and the boundary for
 * edits. `primaryRoot` and `permissionRoot` were the default and the pick of that same thing; the
 * default is the agent's row per workspace (`defaultFolderId`) and the pick is the session's own
 * (`permissionRootFolderId`), and both are folder ids resolved through the folder table.
 *
 * The editor decides which folders are open — the user's Open menu, or the start — and nothing else:
 * focus does not (no active-editor tier), settings do not (no `tommys.cwd`). No folder means no
 * working area, so no cwd, no session, and Hermes is not started.
 */
export class WorkspaceCwd {
    constructor(private readonly _source: CwdSource, private readonly _roots: RootsSource) {}

    /**
     * The cwd of a session: its own folder, else the agent's default for this workspace, else the
     * one folder the workspace shows. `''` when nothing is left to work in.
     */
    forSession(permissionRootFolderId: string): string {
        const live = this.live();
        if (live.length === 0) {
            return '';
        }
        if (live.length === 1) {
            return live[0].path;
        }
        const chosen = live.find(folder => folder.folderId === permissionRootFolderId)
            || live.find(folder => folder.folderId === this.defaultFolderId())
            || live[0];
        return chosen.path;
    }

    /** The same answer as a path, for a caller with no session yet (a spawn, a new session). */
    defaultFolderPath(): string {
        const folderId = this.defaultFolderId();
        return folderId ? this._roots.pathFor(folderId) : (this.live()[0]?.path || '');
    }

    /**
     * This workspace's default folder for the agent, reconciled with the folders the editor has now.
     *
     * Written only when the rules actually moved something, so a plain read of the mode on every card
     * does not turn into a write on every card.
     */
    defaultFolderId(): string {
        const workspaceId = this.workspaceId();
        if (!workspaceId) {
            return '';
        }
        const stored = this._roots.defaultFolderId(workspaceId);
        const next = defaultFolderFor(stored, this._roots.offered(workspaceId));
        if (next && next !== stored) {
            this._roots.setDefaultFolderId(workspaceId, next);
        }
        return next;
    }

    /**
     * The folders this workspace offers, live ones only.
     *
     * Before the folder tables hold this workspace (a window that has not recorded yet) the editor's
     * own list is the truth, in its order: nothing else knows the folders at that moment.
     */
    live(): OfferedFolder[] {
        const workspaceId = this.workspaceId();
        const offered = workspaceId ? this._roots.offered(workspaceId) : [];
        if (offered.length === 0) {
            return this._source.folders().map((folderPath, index) => ({
                folderId: '',
                path: folderPath,
                addedAt: index,
                removed: false,
            }));
        }
        return offered.filter(folder => !folder.removed && folder.path);
    }

    /** This workspace's stored id: identity, not a hash of its path (00.02 §1). */
    workspaceId(): string {
        const identity = this.workspaceIdentity();
        return identity ? this._roots.workspaceId(identity) : '';
    }

    /**
     * Which window this is, as one path: a saved workspace file, else the first folder, else '' for a
     * window that opened nothing — a place of its own.
     *
     * The same source as the cwd, and deliberately so: the workspace a tab is filed under and the
     * folder Hermes runs in are two answers about one window.
     */
    workspaceIdentity(): string {
        return this._source.workspaceFile() || this._source.folders()[0] || '';
    }

    /** The folders this window shows, in the editor's order. */
    folders(): string[] {
        return this._source.folders();
    }

    /**
     * A folder's path by its id, live or not.
     *
     * `live()` drops the folders the editor no longer reports, and a notice about one of those has
     * to name it: "… left the workspace" without the name says nothing.
     */
    folderPath(folderId: string): string {
        return folderId ? this._roots.pathFor(folderId) : '';
    }

    /**
     * Watch the window's folders; returns the unsubscribe, or a no-op when the port cannot.
     *
     * The current list is recorded on subscribing and again on every change: the folder tables are
     * what every later root question is built on, so they are filled whenever the editor says.
     */
    watch(handler: () => void): () => void {
        this.recordFolders();
        if (!this._source.onFoldersChanged) {
            return () => {};
        }
        return this._source.onFoldersChanged(() => {
            this.recordFolders();
            handler();
        });
    }

    /** Record what the editor reports for this workspace (00.02 §2). */
    recordFolders(): void {
        const workspaceId = this.workspaceId();
        if (workspaceId) {
            this._roots.record(workspaceId, this._source.folders());
        }
    }

    /**
     * How much of a folder's "new" welcome is left, written to the row that owns it.
     *
     * The value sits on the workspace row, so the primary and the secondant share it: they share
     * the workspace, and a folder that just joined is new to both of them.
     */
    setFolderNewSeconds(folderId: string, seconds: number): void {
        const workspaceId = this.workspaceId();
        if (workspaceId && folderId) {
            this._roots.setNewSecondsLeft(workspaceId, folderId, seconds);
        }
    }
}
