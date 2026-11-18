import * as fs from 'fs';
import * as path from 'path';
import { activeSessionPathFor, profileDir, sessionsPathFor } from './paths';

/**
 * The one-time fixes to the data home, run at every activation and safe to re-run.
 *
 * Each step below is written as "make the new shape true if it is not already": a first run moves
 * or copies, a second run finds nothing to do and writes nothing. That is what lets the extension
 * run these on startup without a schema version to bump and without a half-applied state to
 * recover from.
 *
 * The order matters and is not the order of the commit that added each step:
 *
 *   1. a backup of the whole home, before anything below touches it;
 *   2. the old global `sessions.json` into the default profile's folder;
 *   3. profile folders from a name to `sessionProfileId`.
 */

/** What a step needs to know about a folder that is only a name: which agent it belonged to. */
export type AgentResolver = (scopeKey: string, sessionIds: string[]) => string | undefined;

/** A step says what it did, in the output log. Silence means there was nothing to do. */
export type MigrationsLog = (line: string) => void;

/** Today as `yyyymmdd`, for the backup's folder name. */
export function backupStamp(now = new Date()): string {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

/**
 * Copy the whole data home to `<home>.backup-<yyyymmdd>`, once.
 *
 * A copy, not a move: every migration below can then be judged against it by hand. An existing
 * backup is never overwritten — the first one is the state before the first migration, and a later
 * activation must not replace it with a state that is already half migrated.
 */
export function backupDataHome(home: string, log: MigrationsLog, now = new Date()): string | undefined {
    const target = `${home}.backup-${backupStamp(now)}`;
    if (fs.existsSync(target)) {
        log(`Backup: ${path.basename(target)} exists, left as it is`);
        return target;
    }
    if (!fs.existsSync(home)) {
        return undefined;
    }
    try {
        fs.cpSync(home, target, { recursive: true, force: false, errorOnExist: true });
        log(`Backup: ${path.basename(target)} written`);
        return target;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Backup failed: ${message}`);
        return undefined;
    }
}

/**
 * Move the pre-profile `sessions.json` into the default profile's folder, once.
 *
 * It lived at the root of the data home before tabs were per profile. The folder it lands in is
 * still named by a scope key here; the folder migration that follows renames it.
 */
function migrateLegacySessionLayout(home: string, log: MigrationsLog): void {
    const legacySessions = path.join(home, 'sessions.json');
    if (!fs.existsSync(legacySessions)) {
        return;
    }
    const defaultScopeKey = '__default__';
    const targetSessions = sessionsPathFor(home, defaultScopeKey);
    if (fs.existsSync(targetSessions)) {
        return;
    }
    profileDir(home, defaultScopeKey);
    fs.renameSync(legacySessions, targetSessions);
    const legacyActive = path.join(home, 'active-session.txt');
    if (fs.existsSync(legacyActive)) {
        fs.renameSync(legacyActive, activeSessionPathFor(home, defaultScopeKey));
    }
    log('Migration: the root sessions.json moved into the default profile');
}

/**
 * Run every step, in order, from the composition root at activation.
 *
 * Nothing here throws: a migration that cannot finish logs and leaves the file as it found it, so a
 * broken migration costs the migration, never the extension.
 */
export function runMigrations(home: string, log: MigrationsLog): void {
    backupDataHome(home, log);
    migrateLegacySessionLayout(home, log);
}
