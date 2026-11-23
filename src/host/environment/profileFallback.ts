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
 *
 * Each search asks for the one file its own question needs, because `profile.yaml` is optional
 * metadata in Hermes and not part of what makes a profile: `read_profile_meta` returns empty
 * defaults when it is missing (hermes_cli/profiles.py:860-887), `hermes profile create` writes it
 * only when a `--description` is given (hermes_cli/profiles_initialization.py:66-70), and a folder
 * under `profiles/` is identified as a profile by any one of `config.yaml`, `.env`, `SOUL.md`,
 * `profile.yaml`, `auth.json` or `state.db` (hermes_constants.py:399). A profile can therefore have
 * a state.db and no profile.yaml — fallback 2 must still reach its sessions. A folder with neither
 * file (the leftover of the dev -> dev-vsc rename) is skipped by both.
 */

/** Fallback 1 knows a profile by its names, so it needs the file the names live in. */
export function hasProfileMeta(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'profile.yaml'));
}

/** Fallback 2 knows a profile by its sessions, so it needs the database the sessions live in. */
export function hasProfileState(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'state.db'));
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

/**
 * The one-line `description:` in a profile.yaml, or '' when there is none.
 *
 * Single-line scalars only: Hermes writes the description as one plain line, and a block scalar
 * (`description: |`) is left unanswered rather than half-read — an empty description is honest,
 * a guessed one would end up in another agent's index.
 */
export function parseDescription(profileYaml: string): string {
    for (const rawLine of profileYaml.split(/\r?\n/)) {
        const match = rawLine.match(/^description:\s*(.*)$/);
        if (!match) {
            continue;
        }
        const value = match[1].replace(/\s+#.*$/, '').trim();
        if (!value || value.startsWith('|') || value.startsWith('>')) {
            return '';
        }
        return value.replace(/^['"]|['"]$/g, '').trim();
    }
    return '';
}

/**
 * The description Hermes holds for a profile, read from Hermes' own folder (H1, H2: read, never
 * written). The default profile keeps its state at the root of the home and has no folder of its
 * own, so its `profile.yaml` is read from the home itself. A missing file or key is ''.
 */
export function profileDescription(profileName: string, hermesHome = resolveHermesRoot()): string {
    const name = (profileName || '').trim();
    if (!name) {
        return '';
    }
    const dir = name === HERMES_DEFAULT_PROFILE ? hermesHome : path.join(hermesHome, 'profiles', name);
    return parseDescription(readText(path.join(dir, 'profile.yaml')));
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
 * Only a folder with a profile.yaml can answer: that is where the names live. A profile without one
 * is simply not a candidate here, which is not a miss — fallback 2 asks a different question.
 *
 * `hermesHome` is `~/.hermes` unless a caller says otherwise, which is what makes this testable
 * against temp folders instead of his home.
 */
export function profileNameFromPreviousNames(staleName: string, hermesHome = resolveHermesRoot()): string | undefined {
    const wanted = (staleName || '').trim();
    if (!wanted) {
        return undefined;
    }
    const root = path.join(hermesHome, 'profiles');
    for (const name of profileFolders(root)) {
        const dir = path.join(root, name);
        if (!hasProfileMeta(dir)) {
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
 * A state.db is enough: profile.yaml is optional metadata, so requiring it would skip a real profile
 * whose sessions are exactly what we came for. Named profiles keep their state in
 * `profiles/<name>/state.db`; the default profile keeps it at the root, `~/.hermes/state.db`, and is
 * the answer when no named profile holds one. A named profile that holds one wins over the default,
 * which is also the order the folders are read in.
 */
export function profileNameHoldingSessions(
    sessionIds: string[],
    hermesHome = resolveHermesRoot(),
    log: (line: string) => void = () => {},
): string | undefined {
    const wanted = sessionIds.map(id => (id || '').trim()).filter(Boolean);
    if (wanted.length === 0) {
        return undefined;
    }
    const root = path.join(hermesHome, 'profiles');
    for (const name of profileFolders(root)) {
        const dir = path.join(root, name);
        if (!hasProfileState(dir)) {
            continue;
        }
        if (holdsAny(path.join(dir, 'state.db'), wanted, name, log)) {
            return name;
        }
    }
    return holdsAny(path.join(hermesHome, 'state.db'), wanted, HERMES_DEFAULT_PROFILE, log)
        ? HERMES_DEFAULT_PROFILE
        : undefined;
}

/**
 * Is this a profile Hermes has today?
 *
 * The default profile has no folder of its own (its state sits at the root), so it is always one;
 * a named profile is one when its folder holds a state.db. Used by the folder migration to decide
 * whether a name in our data home is still Hermes' name for that agent.
 */
export function isCurrentProfile(profileName: string, hermesHome = resolveHermesRoot()): boolean {
    if (profileName === HERMES_DEFAULT_PROFILE) {
        return true;
    }
    return hasProfileState(path.join(hermesHome, 'profiles', profileName));
}

/**
 * Does this Hermes home hold a profiles folder at all?
 *
 * The question a caller asks before trusting an absence: on a machine Hermes has never run on, every
 * name is missing, and that says nothing about the profile.
 */
export function hasProfilesRoot(hermesHome = resolveHermesRoot()): boolean {
    return fs.existsSync(path.join(hermesHome, 'profiles'));
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

/** A `code: message` line for a filesystem or driver error. */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code ? `${code}: ${error.message}` : error.message;
    }
    return String(error);
}

/**
 * Does this state.db hold any of the ids?
 *
 * Hermes writes this database while we read it, so a lock, a busy file or a half-written one is an
 * ordinary answer, not a failure: the read is logged once, for this one database, and the search
 * moves on to its next source. Nothing here throws.
 */
function holdsAny(dbPath: string, sessionIds: string[], label: string, log: (line: string) => void): boolean {
    if (!fs.existsSync(dbPath)) {
        return false;
    }
    const db = openReadOnly(dbPath, label, log);
    if (!db) {
        return false;
    }
    try {
        const statement = db.prepare('select 1 as hit from sessions where id = ?');
        return sessionIds.some(id => statement.get(id) !== undefined);
    } catch (error) {
        log(`Profile search: ${label} state.db could not be read (${describeError(error)}); skipped`);
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
 * the extension. Opening read-only is what keeps a running Hermes out of our way — no journal we
 * write, no lock we take.
 */
function openReadOnly(dbPath: string, label: string, log: (line: string) => void): DatabaseSync | undefined {
    try {
        const sqlite = require('node:sqlite') as typeof import('node:sqlite');
        return new sqlite.DatabaseSync(dbPath, { readOnly: true });
    } catch (error) {
        log(`Profile search: ${label} state.db could not be opened read-only (${describeError(error)}); skipped`);
        return undefined;
    }
}
