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

/** A profile's own folder: everything scoped by profile lives in it. */
export function profileDir(historyDir: string, scopeKey: string): string {
    const dir = path.join(historyDir, 'profiles', scopeKey);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** The tabs of one profile. */
export function sessionsPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'sessions.json');
}

/** The tab that profile was last on. */
export function activeSessionPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'active-session.txt');
}

/**
 * The workspace registry, above the profiles.
 *
 * The one path helper that takes no scope key: a workspace is the same fact for every profile
 * that runs in that window, and the primary and the secondant do not share one.
 */
export function workspacesPathFor(historyDir: string): string {
    return path.join(historyDir, 'workspaces.json');
}

/** The model choice a profile kept. */
export function profileStatePathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'profile-state.json');
}
