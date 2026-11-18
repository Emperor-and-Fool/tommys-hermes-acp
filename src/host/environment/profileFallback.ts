import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { HERMES_DEFAULT_PROFILE } from './hermesProfile';
import { resolveHermesRoot } from './hermesPaths';

/**
 * The profile that answers a name we no longer find, or the profile holding our tabs.
 *
 * A profile is keyed by its name, and a rename moves `~/.hermes/profiles/<name>` and re-keys Hermes'
 * own rows. So a name we stored yesterday can be gone today while the profile is still there under
 * a new one. Two searches find it, in the order the decision fixed:
 *
 *   fallback 1 — the profile.yaml whose `previous_names` holds the old name;
 *   fallback 2 — the profile whose state.db holds the session ids of the tabs we have open.
 *
 * Hermes' files are read here and never written (H2), and this is the folder allowed to touch them
 * (H1). Nothing calls either search yet: connect still resolves by name.
 */

/** A Hermes profile is both of these: what it is, and what it did. */
export function isHermesProfile(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'profile.yaml')) && fs.existsSync(path.join(dir, 'state.db'));
}

/**
 * The names under `previous_names` in a profile.yaml.
 *
 * A hand-written parser for this one key rather than a YAML dependency: the file is Hermes' own,
 * the key is a block list of plain scalars, and a new dependency for that would be a deviation
 * with nothing behind it. Block form (`- name`) and the inline form (`[name, name]`) both read;
 * an unquoted trailing `# comment` and surrounding quotes are stripped.
 */
export function parsePreviousNames(profileYaml: string): string[] {
    const names: string[] = [];
    let inBlock = false;
    for (const rawLine of profileYaml.split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, '');
        if (!inBlock) {
            const key = line.match(/^previous_names:\s*(.*)$/);
            if (!key) {
                continue;
            }
            inBlock = true;
            const inline = key[1].trim();
            if (inline.startsWith('[')) {
                for (const item of inline.replace(/^\[/, '').replace(/\]$/, '').split(',')) {
                    pushName(names, item);
                }
                inBlock = false;
            }
            continue;
        }
        const item = line.match(/^\s*-\s*(.+)$/);
        if (item) {
            pushName(names, item[1]);
            continue;
        }
        if (!line.trim()) {
            continue;
        }
        // A top-level key we do not care about ends the list.
        inBlock = false;
    }
    return names;
}

function pushName(names: string[], raw: string): void {
    const name = raw.replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '').trim();
    if (name && !names.includes(name)) {
        names.push(name);
    }
}

/**
 * Fallback 1: the profile whose `previous_names` holds this name.
 *
 * `dir` is `~/.hermes` unless a caller says otherwise, which is what makes this testable against
 * temp folders instead of his home.
 */
export function profileNameFromPreviousNames(staleName: string, hermesHome = resolveHermesRoot()): string | undefined {
    const wanted = (staleName || '').trim();
    if (!wanted) {
        return undefined;
    }
    const root = path.join(hermesHome, 'profiles');
    for (const name of profileFolders(root)) {
        const dir = path.join(root, name);
        if (!isHermesProfile(dir)) {
            continue;
        }
        if (parsePreviousNames(readText(path.join(dir, 'profile.yaml'))).includes(wanted)) {
            return name;
        }
    }
    return undefined;
}

/**
 * Fallback 2: the profile whose state.db holds these session ids.
 *
 * Named profiles keep their state in `profiles/<name>/state.db`; the default profile keeps it at the
 * root, `~/.hermes/state.db`, and is the answer when no named profile holds one. A named profile
 * that holds one wins over the default, which is also the order the folders are read in.
 */
export function profileNameHoldingSessions(sessionIds: string[], hermesHome = resolveHermesRoot()): string | undefined {
    const wanted = sessionIds.map(id => (id || '').trim()).filter(Boolean);
    if (wanted.length === 0) {
        return undefined;
    }
    const root = path.join(hermesHome, 'profiles');
    for (const name of profileFolders(root)) {
        const dir = path.join(root, name);
        if (!isHermesProfile(dir)) {
            continue;
        }
        if (holdsAny(path.join(dir, 'state.db'), wanted)) {
            return name;
        }
    }
    return holdsAny(path.join(hermesHome, 'state.db'), wanted) ? HERMES_DEFAULT_PROFILE : undefined;
}

/** The folder names under `profiles/`, sorted, so the same home always answers the same first. */
function profileFolders(root: string): string[] {
    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
    } catch {
        return [];
    }
}

function readText(target: string): string {
    try {
        return fs.readFileSync(target, 'utf-8');
    } catch {
        return '';
    }
}

/** Does this state.db hold any of the ids? A missing or unreadable database holds nothing. */
function holdsAny(dbPath: string, sessionIds: string[]): boolean {
    if (!fs.existsSync(dbPath)) {
        return false;
    }
    const db = openReadOnly(dbPath);
    if (!db) {
        return false;
    }
    try {
        const statement = db.prepare('select 1 as hit from sessions where id = ?');
        return sessionIds.some(id => statement.get(id) !== undefined);
    } catch {
        return false;
    } finally {
        try {
            db.close();
        } catch { /* already closed */ }
    }
}

/**
 * A state.db opened for reading, with no driver to install.
 *
 * `node:sqlite` ships with Node 22.5+ and VSCodium's runtime carries it (the installed build
 * answers `process.versions.node` 24.21.0, with `DatabaseSync` present), so a new dependency would
 * buy nothing. It is required lazily anyway: a host without the module loses the fallback, never
 * the extension.
 */
function openReadOnly(dbPath: string): DatabaseSync | undefined {
    try {
        const sqlite = require('node:sqlite') as typeof import('node:sqlite');
        return new sqlite.DatabaseSync(dbPath, { readOnly: true });
    } catch {
        return undefined;
    }
}
