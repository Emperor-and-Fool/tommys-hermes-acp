import path from 'path';
import { workspaceIdFor } from './workSpace';

/**
 * Containment by directory, not by string prefix: `/work/repo-secrets` is not inside `/work/repo`,
 * and neither is `/work/repo/../elsewhere`. Both passed when this was `startsWith()`.
 */
export function pathWithin(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The two roots a workspace records. Empty string means unset, and a workspace may have none. */
export interface RootState {
    primaryRoot: string;
    permissionRoot: string;
}

/** A workspace that has recorded no roots yet. */
export const NO_ROOTS: RootState = { primaryRoot: '', permissionRoot: '' };

/**
 * Which folders the picker offers: only a workspace showing two or more folders has a choice.
 * With one folder there is nothing to pick — that folder is the workspace (tier 1).
 */
export function offeredRoots(folders: string[]): string[] {
    return folders.length > 1 ? folders.slice() : [];
}

/**
 * What a workspace's roots become when the editor's folder list has changed.
 *
 * Three rules, and the third is why they are here:
 *   - a chosen root that is gone falls back to the primary;
 *   - a primary that is gone becomes the most recent folder — the last in the editor's order,
 *     which is where VS Code puts a folder added to a window (until folders record the moment
 *     they were opened, which is a later job);
 *   - a workspace that has never recorded a primary takes the first folder, and an empty folder
 *     list means no roots at all.
 */
export function reconcileRoots(state: RootState, folders: string[]): RootState {
    if (folders.length === 0) {
        return NO_ROOTS;
    }
    if (folders.length === 1) {
        // One folder is the whole workspace (tier 1): there is nothing to pick, so no pick is kept.
        return { primaryRoot: folders[0], permissionRoot: '' };
    }
    const permissionRoot = state.permissionRoot && folders.includes(state.permissionRoot)
        ? state.permissionRoot
        : '';
    let primaryRoot: string;
    if (!state.primaryRoot) {
        primaryRoot = folders[0];
    } else if (folders.includes(state.primaryRoot)) {
        primaryRoot = state.primaryRoot;
    } else {
        primaryRoot = folders[folders.length - 1];
    }
    return { primaryRoot, permissionRoot };
}

/** The folder Hermes works in: the chosen root, else the primary. */
export function effectiveRoot(state: RootState): string {
    return state.permissionRoot || state.primaryRoot;
}

/**
 * A workspace's roots, through the port: the store behind it is the only writer.
 *
 * The key is the workspace **id**, not its path: the record lives in a registry both extensions
 * write, while the roots belong to one agent (ST5: references are ids).
 */
export interface RootsSource {
    roots(workspaceId: string): RootState;
    setRoots(workspaceId: string, roots: RootState): void;
}

/** What the locator needs from the editor. Declared here; the composition root fills it. */
export interface CwdSource {
    /** The window's `.code-workspace` file, or '' when it opened plain folders. Not used to locate yet. */
    workspaceFile(): string;
    /** The folders the window opened, in the editor's order. */
    folders(): string[];
    /** Told when that list changes; returns the unsubscribe. Absent in tests that never move. */
    onFoldersChanged?(handler: () => void): () => void;
}

/**
 * The one owner of "which folder is this window's cwd".
 *
 * A workspace is our context; the folder is a member of it; the cwd is the one folder we hand to
 * Hermes, where its commands run and where Workspace edit mode lets it write. The editor decides
 * which folders are open — the user's Open menu, or the start — and nothing else does: focus does
 * not (no active-editor tier), settings do not (no `tommys.cwd`).
 *
 * Tiers, in the order they are tried:
 *   1. one folder, no `.code-workspace` -> that folder is the workspace, so it is the cwd.
 *   2. a `.code-workspace` -> its first folder.
 *   3. later: a picked root among those folders. The seam is this method and nowhere else.
 * No folder: `''` — not a working area, so no cwd, no session, and Hermes is not started.
 */
export class WorkspaceCwd {
    constructor(private readonly _source: CwdSource, private readonly _roots?: RootsSource) {}

    /**
     * The cwd for this window, or '' when the window opened no folder.
     *
     * Tier 1 and tier 2 are the first folder: with one folder that IS the workspace, and with a
     * `.code-workspace` the first of its folders is the primary. Tier 3 is the user's pick, which
     * only a workspace showing two or more folders can have.
     */
    forWindow(): string {
        const folders = this._source.folders();
        if (folders.length === 0) {
            return '';
        }
        if (folders.length === 1 || !this._roots) {
            return folders[0];
        }
        return effectiveRoot(this.roots()) || folders[0];
    }

    /**
     * This workspace's roots, reconciled with the folders the editor has now.
     *
     * Reconciling writes only when the rules actually moved something, so a plain read of the mode
     * on every card does not turn into a write on every card.
     */
    roots(): RootState {
        const folders = this._source.folders();
        const workspaceId = this.workspaceRootKey();
        const stored = this._roots && workspaceId ? this._roots.roots(workspaceId) : NO_ROOTS;
        const next = reconcileRoots(stored, folders);
        if (this._roots && workspaceId && (next.primaryRoot !== stored.primaryRoot || next.permissionRoot !== stored.permissionRoot)) {
            this._roots.setRoots(workspaceId, next);
        }
        return next;
    }

    /** This workspace's id: what its roots are filed under, in the agent's own file. */
    private workspaceRootKey(): string {
        return workspaceIdFor(this.workspaceIdentity());
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

    /** Record the folder the user picked. A folder this window does not show is refused. */
    setPermissionRoot(folder: string): boolean {
        if (folder && !this._source.folders().includes(folder)) {
            return false;
        }
        const workspaceId = this.workspaceRootKey();
        if (!this._roots || !workspaceId) {
            return false;
        }
        const current = this.roots();
        this._roots.setRoots(workspaceId, { primaryRoot: current.primaryRoot, permissionRoot: folder });
        return true;
    }

    /** Watch the window's folders; returns the unsubscribe, or a no-op when the port cannot. */
    watch(handler: () => void): () => void {
        return this._source.onFoldersChanged ? this._source.onFoldersChanged(handler) : () => {};
    }

}
