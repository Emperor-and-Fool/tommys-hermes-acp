import path from 'path';

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

/** What the locator needs from the editor. Declared here; the composition root fills it. */
export interface CwdSource {
    /** The window's `.code-workspace` file, or '' when it opened plain folders. Not used to locate yet. */
    workspaceFile(): string;
    /** The folders the window opened, in the editor's order. */
    folders(): string[];
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
    constructor(private readonly _source: CwdSource) {}

    /** The cwd for this window, or '' when the window opened no folder. */
    forWindow(): string {
        const folders = this._source.folders();
        // Tiers 1 and 2 read the same field; they are named apart so tier 3 has one place to land.
        return folders.length > 0 ? folders[0] : '';
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

    /** Whether a cwd lies within one of this window's folders. */
    ownsCwd(cwd: string | undefined): boolean {
        if (!cwd) {
            return false;
        }
        return this._source.folders().some(folder => pathWithin(folder, cwd));
    }
}
