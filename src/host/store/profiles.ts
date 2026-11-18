import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeAtomic } from './connection';

/**
 * Which profile we mean, for good.
 *
 * Hermes keys a profile by its name: renaming one moves `~/.hermes/profiles/<name>` and re-keys
 * Hermes' own rows. A name is therefore the one thing about a profile that changes, and everything
 * we store under it (projects, tabs, the model choice, the deny list) would be orphaned by a rename.
 * So a profile gets an id of ours, `session_profile_id`, and the name Hermes uses today becomes a
 * field of that row: `agent_name`. Nothing in the data home switches to the id yet — this file and
 * the table behind it are the foundation, added next to what works rather than under it.
 *
 * THE SHAPE THIS FILE IS WRITTEN FOR, so a move to SQLite is a schema, not a rewrite:
 *
 *   profiles(session_profile_id TEXT PRIMARY KEY, agent_name TEXT NOT NULL)
 *
 * The rules that make that schema honest:
 * - `session_profile_id` is minted here, once, and never rewritten. A UUID rather than the base36
 *   time id the workspace store mints: two windows can mint in the same millisecond, and this id is
 *   the one every other record will point at (ST5).
 * - `agent_name` is the only field a rename touches.
 * - One file, at the root of the data home and above `profiles/<name>/`: it answers which folder a
 *   profile owns, so it cannot live inside one of those folders. No other file reads or writes it.
 * - Rows are read as unknown-tolerant: a key this file does not know is carried through a write,
 *   never dropped, which is the courtesy a later migration backfill needs.
 */

/** One row: the id we minted, and what Hermes calls that profile today. */
export interface ProfileRow {
    sessionProfileId: string;
    agentName: string;
    /** A key this file does not know is carried through a write, never dropped. */
    [key: string]: unknown;
}

/** A folder name that is one of our ids: an agent folder, not a name. */
const ID_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Is this folder already keyed by an id of ours (so it is not a name to seed)? */
export function isSessionProfileId(folderName: string): boolean {
    return ID_FOLDER.test(folderName);
}

/** The table's file. */
export function profilesPathFor(dataHome: string): string {
    return path.join(dataHome, 'profiles.json');
}

/** Where the per-profile folders live. Their names are scope keys, not Hermes names. */
export function profilesDirFor(dataHome: string): string {
    return path.join(dataHome, 'profiles');
}

/** The file's shape. */
interface ProfilesFile {
    profiles: ProfileRow[];
}

function readText(target: string): string {
    try {
        return fs.readFileSync(target, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * The profile table.
 *
 * Synchronous (ST4), domain-shaped (ST2), one file, and the only writer of `profiles.json` (ST1).
 * Every method reads the file again before it writes: every window has its own backend and all of
 * them read-modify-write the same table, so a cached copy would be the last writer's copy.
 */
export class ProfilesStore {
    constructor(private readonly _dataHome: string) {}

    get path(): string {
        return profilesPathFor(this._dataHome);
    }

    /** Every row, in the order the profiles were first seen. */
    all(): ProfileRow[] {
        return this._read().map(row => ({ sessionProfileId: row.sessionProfileId, agentName: row.agentName }));
    }

    /**
     * The id of a profile, minting the row when its name is new.
     *
     * Connecting by name is what the extension does today, so this is the first hop: a name is
     * asked for an id, and the row is created if nobody has seen that name before.
     */
    idFor(agentName: string): string {
        const name = this._requireName(agentName, 'idFor');
        const rows = this._read();
        const existing = rows.find(row => row.agentName === name);
        if (existing) {
            return existing.sessionProfileId;
        }
        const row: ProfileRow = { sessionProfileId: randomUUID(), agentName: name };
        rows.push(row);
        this._write(rows);
        return row.sessionProfileId;
    }

    /** What Hermes calls the profile with this id now. Nothing when the id is unknown. */
    nameFor(sessionProfileId: string): string | undefined {
        return this._read().find(row => row.sessionProfileId === sessionProfileId)?.agentName;
    }

    /**
     * Hermes renamed a profile: the id stays, the name it answers to changes.
     *
     * A name another row already holds is written as given. Both rows then describe one profile
     * under an old and a new name, which is what a seed leaves behind when it meets a folder from
     * before the rename; this call re-keys nothing and deletes nothing.
     */
    rename(sessionProfileId: string, agentName: string): void {
        const name = this._requireName(agentName, 'rename');
        const rows = this._read();
        const row = rows.find(entry => entry.sessionProfileId === sessionProfileId);
        if (!row || row.agentName === name) {
            return;
        }
        row.agentName = name;
        this._write(rows);
    }

    /**
     * Give every name a row it does not have yet. Returns how many rows were added.
     *
     * Additive on purpose: nothing is renamed, moved or re-keyed, so seeding an existing data home
     * cannot change what works. One write for the whole list (ST3).
     */
    seed(agentNames: string[]): number {
        const rows = this._read();
        const known = new Set(rows.map(row => row.agentName));
        const added: ProfileRow[] = [];
        for (const raw of agentNames) {
            const name = (raw || '').trim();
            if (!name || known.has(name)) {
                continue;
            }
            known.add(name);
            added.push({ sessionProfileId: randomUUID(), agentName: name });
        }
        if (added.length > 0) {
            this._write(rows.concat(added));
        }
        return added.length;
    }

    /**
     * The folders under `profiles/` that are still named: what our data home holds under a name it
     * was written with. These are scope keys, not Hermes names (`__default__` is the default
     * profile). An id folder is skipped — it is already keyed by us, and reading it as a name would
     * mint a row whose agent is a uuid.
     */
    localScopes(): string[] {
        try {
            return fs.readdirSync(profilesDirFor(this._dataHome), { withFileTypes: true })
                .filter(entry => entry.isDirectory() && !isSessionProfileId(entry.name))
                .map(entry => entry.name)
                .sort();
        } catch {
            return [];
        }
    }

    private _requireName(agentName: string, method: string): string {
        const name = (agentName || '').trim();
        if (!name) {
            throw new Error(`profiles.${method}: a profile name is required`);
        }
        return name;
    }

    /** The rows on disk. A missing or unreadable file is an empty table, not a throw. */
    private _read(): ProfileRow[] {
        try {
            const parsed = JSON.parse(readText(this.path)) as Partial<ProfilesFile>;
            const rows = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
            return rows.filter(row => this._isRow(row));
        } catch {
            return [];
        }
    }

    private _isRow(row: unknown): row is ProfileRow {
        if (!row || typeof row !== 'object') {
            return false;
        }
        const candidate = row as { sessionProfileId?: unknown; agentName?: unknown };
        return typeof candidate.sessionProfileId === 'string' && typeof candidate.agentName === 'string';
    }

    /** One write per call, through the store's temp-file-and-rename discipline. */
    private _write(rows: ProfileRow[]): void {
        const table: ProfilesFile = { profiles: rows };
        writeAtomic(this.path, table);
    }
}
