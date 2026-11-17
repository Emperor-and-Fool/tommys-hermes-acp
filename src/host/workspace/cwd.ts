import path from 'path';

/**
 * Containment by directory, not by string prefix: `/work/repo-secrets` is not inside `/work/repo`,
 * and neither is `/work/repo/../elsewhere`. Both passed when this was `startsWith()`.
 */
export function pathWithin(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
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

    /** Whether a cwd lies within one of this window's folders. */
    ownsCwd(cwd: string | undefined): boolean {
        if (!cwd) {
            return false;
        }
        return this._source.folders().some(folder => pathWithin(folder, cwd));
    }
}
