import * as fs from 'fs';
import * as path from 'path';

/**
 * Where our data lives inside the data home.
 *
 * Paths only, with the one exception a path helper has to make: `profileDir` creates the folder it
 * names, because every other path here hangs off it and a caller that asks for one needs it to
 * exist. Nothing here reads or writes a file's contents — that is `store/connection.ts`'s write
 * discipline, and a store asks for a path here then commits through there (ST1).
 */

/** An agent's own folder: keyed by `sessionProfileId`, the key that never changes. */
export function profileDir(historyDir: string, sessionProfileId: string): string {
    const dir = path.join(historyDir, 'profiles', sessionProfileId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * An agent's own notes: `profiles/<id>/notes/`, beside its tabs and tree files.
 *
 * One level down from the profile folder on purpose — that folder also holds our machine files,
 * and a folder handed to an agent (or to a vault) is the notes, not `sessions.json`. Nothing here
 * creates it: the notes feature's store does, when an agent connects.
 */
export function notesDirFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'notes');
}

/**
 * The notes mirror's record: where the user put it, and which link belongs to which agent.
 *
 * At the data home's root, not inside a profile: the mirror is one thing for the whole home, and
 * both the primary and the secondant (each in its own data home) name their own.
 */
export function notesMirrorPathFor(historyDir: string): string {
    return path.join(historyDir, 'notes-mirror.json');
}

/** The tabs of one profile. */
export function sessionsPathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'sessions.json');
}

/**
 * The workspace registry, above the profiles.
 *
 * The one path helper that takes no profile key: a workspace is the same fact for every agent
 * that runs in that window, and the primary and the secondant do not share one.
 */
export function workspacesPathFor(historyDir: string): string {
    return path.join(historyDir, 'workspaces.json');
}

/** The model choice a profile kept. */
export function profileStatePathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'profile-state.json');
}

/**
 * The Desktop step's machine-wide facts: the last build attempt, and the lock one window holds.
 *
 * Above the profiles, like the workspace registry, and for the same reason: there is one Hermes
 * Desktop per machine, not one per agent, and both windows of this data home see the same answer.
 */
export function desktopDirFor(historyDir: string): string {
    return path.join(historyDir, 'desktop');
}

/**
 * The identity of a folder path: what makes two reports name the same folder.
 *
 * Windows has many spellings for one folder — the drive letter arrives as `C:` or `c:`, and the same
 * folder comes with or without a trailing separator — so a keyed comparison has to fold both. On
 * every other platform a path is compared exactly, after `normalize`. The stored path is never
 * rewritten: this is the key two reports are matched on, and the row keeps the string the editor
 * reported first, for display.
 *
 * The platform is a parameter, not `process.platform`, so the Windows cases run as tests on Linux.
 */
export function folderPathKey(folderPath: string, platform: NodeJS.Platform = process.platform): string {
    const trimmed = (folderPath || '').trim();
    if (!trimmed) {
        return '';
    }
    if (platform === 'win32') {
        let normalized = path.win32.normalize(trimmed);
        // `C:\` is a root; anything longer that ends in a separator is the same folder without it.
        if (normalized.length > 3 && normalized.endsWith('\\')) {
            normalized = normalized.replace(/\\+$/, '');
        }
        return normalized.toLowerCase();
    }
    return path.normalize(trimmed);
}

/** Do two reports name the same folder? */
export function sameFolderPath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
    const key = folderPathKey(left, platform);
    return key !== '' && key === folderPathKey(right, platform);
}
