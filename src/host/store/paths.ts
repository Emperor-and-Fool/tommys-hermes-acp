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

/** The tabs of one profile. */
export function sessionsPathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'sessions.json');
}

/** The tab that profile was last on. */
export function activeSessionPathFor(historyDir: string, sessionProfileId: string): string {
    return path.join(profileDir(historyDir, sessionProfileId), 'active-session.txt');
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
