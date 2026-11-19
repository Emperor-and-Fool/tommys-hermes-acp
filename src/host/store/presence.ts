import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { writeAtomic } from './connection';

/**
 * One running extension instance, as it announces itself to the other windows.
 *
 * A second VS Code window runs its own extension host, so the two extensions inside one window
 * cannot see it: the in-window withholding is an in-process export. This table is the other half —
 * who is running what, across windows — and it exists for one question only: may this instance run
 * on that Hermes profile?
 */
export interface PresenceRow {
    instanceId: string;
    role: 'primary' | 'secondant';
    /** The CLI profile it runs on. '' when it is not connected to one. */
    cliProfile: string;
    /** When it last said so. A row older than `PRESENCE_STALE_MS` is a window that went away. */
    liveAt: number;
}

/**
 * How long a row stays believable.
 *
 * The beat is every 15 s, so three missed beats in a row is a window that died, crashed or was
 * killed — the one case a `dispose` cannot report.
 */
export const PRESENCE_STALE_MS = 45_000;

export function presenceDirFor(dataHome: string): string {
    return path.join(dataHome, 'presence');
}

/**
 * The presence table: one file per instance, in our data home.
 *
 * **One file per instance, never one shared file.** Four instances write this table, and a shared
 * file would have them overwrite each other — each write reads the whole file, changes one row and
 * writes it back, so two writers in one moment lose a row. With a file each, the only writer of a
 * file is the instance it names.
 *
 * Every write goes through `writeAtomic` (ST1): the reader sees a whole row or the previous one.
 * Rows are read as unknown-tolerant, so a later column does not lose a row.
 */
export class PresenceStore {
    /** This instance's own id: the file it writes, and the row every reader of it skips. */
    readonly instanceId = randomUUID();

    constructor(private readonly _dataHome: string) {}

    get dir(): string {
        return presenceDirFor(this._dataHome);
    }

    fileFor(instanceId: string): string {
        return path.join(this.dir, `${instanceId}.json`);
    }

    /** Announce this instance. It touches no other instance's file. */
    write(row: { role: 'primary' | 'secondant'; cliProfile: string; liveAt: number }): void {
        fs.mkdirSync(this.dir, { recursive: true });
        writeAtomic(this.fileFor(this.instanceId), { instanceId: this.instanceId, ...row });
    }

    /** This instance is going away: take its row with it. Unreadable or absent is not an error. */
    remove(): void {
        try {
            fs.unlinkSync(this.fileFor(this.instanceId));
        } catch {
            /* already gone, or never written */
        }
    }

    /**
     * The rows of the other instances that are still fresh.
     *
     * This instance's own row is skipped by id, not by content: two windows may sit on the same
     * profile, and comparing profiles would hide each one from the other.
     */
    live(now = Date.now(), staleMs = PRESENCE_STALE_MS): PresenceRow[] {
        let names: string[];
        try {
            names = fs.readdirSync(this.dir);
        } catch {
            return [];
        }
        const rows: PresenceRow[] = [];
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }
            const instanceId = name.slice(0, -'.json'.length);
            if (instanceId === this.instanceId) {
                continue;
            }
            const row = this._read(path.join(this.dir, name), instanceId);
            if (row && now - row.liveAt <= staleMs) {
                rows.push(row);
            }
        }
        return rows;
    }

    /** One file, or nothing: a half-written or hand-edited row is skipped, never thrown over. */
    private _read(file: string, instanceId: string): PresenceRow | undefined {
        try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
            if (!raw || typeof raw !== 'object') {
                return undefined;
            }
            return {
                instanceId: typeof raw.instanceId === 'string' && raw.instanceId ? raw.instanceId : instanceId,
                role: raw.role === 'secondant' ? 'secondant' : 'primary',
                cliProfile: typeof raw.cliProfile === 'string' ? raw.cliProfile : '',
                liveAt: typeof raw.liveAt === 'number' ? raw.liveAt : 0,
            };
        } catch {
            return undefined;
        }
    }
}
