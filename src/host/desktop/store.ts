import * as fs from 'fs';
import * as path from 'path';
import { writeAtomic } from '../store/connection';
import { desktopDirFor } from '../store/paths';

/**
 * The Desktop step's one door to the data home (ST1).
 *
 * Two facts live here, both machine-wide rather than per agent: what the last build attempt did, and
 * the lock that keeps two windows from building at once. Nothing of Hermes' own is written — the
 * build is Hermes' command, and this only remembers that we ran it.
 */

/** How long a lock may sit before it is treated as a window that died mid-build. */
export const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/** The last attempt: when it ended, and how. A success is kept too, as evidence of the build. */
export interface DesktopAttempt {
    /** When the attempt finished, ms since the epoch. */
    at: number;
    ok: boolean;
    /** The artifact a successful attempt produced. */
    build?: string;
    /** What Hermes said when it failed: its last lines, for the notice. */
    failure?: string;
}

export class DesktopStore {
    private readonly _dir: string;
    private readonly _record: string;
    private readonly _lock: string;

    constructor(historyDir: string) {
        this._dir = desktopDirFor(historyDir);
        this._record = path.join(this._dir, 'build.json');
        this._lock = path.join(this._dir, 'build.lock');
    }

    /** The last attempt, or undefined when this machine has never tried. */
    read(): DesktopAttempt | undefined {
        try {
            const raw = JSON.parse(fs.readFileSync(this._record, 'utf8')) as Partial<DesktopAttempt>;
            if (typeof raw?.at !== 'number') {
                return undefined;
            }
            return {
                at: raw.at,
                ok: raw.ok === true,
                build: typeof raw.build === 'string' ? raw.build : undefined,
                failure: typeof raw.failure === 'string' ? raw.failure : undefined,
            };
        } catch {
            return undefined;
        }
    }

    write(attempt: DesktopAttempt): void {
        fs.mkdirSync(this._dir, { recursive: true });
        writeAtomic(this._record, attempt);
    }

    /**
     * Take the machine's build lock: false when another window holds a live one.
     *
     * A lock older than `LOCK_STALE_MS` is taken over rather than waited on — a window that died
     * mid-build must not stop every later window from ever trying — and the takeover is written
     * over the file, so the next reader sees who holds it now.
     */
    lock(at: number, pid = process.pid): boolean {
        fs.mkdirSync(this._dir, { recursive: true });
        const content = JSON.stringify({ pid, at });
        try {
            fs.writeFileSync(this._lock, content, { flag: 'wx' });
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                return false;
            }
        }
        if (!this._lockIsStale(at)) {
            return false;
        }
        fs.writeFileSync(this._lock, content);
        return true;
    }

    unlock(): void {
        try {
            fs.unlinkSync(this._lock);
        } catch {
            // Already gone, or never ours: nothing to release.
        }
    }

    private _lockIsStale(now: number): boolean {
        try {
            const held = JSON.parse(fs.readFileSync(this._lock, 'utf8')) as { at?: number };
            const since = typeof held?.at === 'number' ? held.at : fs.statSync(this._lock).mtimeMs;
            return now - since > LOCK_STALE_MS;
        } catch {
            // Unreadable: an interrupted write. Older than it looks, treat it as stale.
            return true;
        }
    }
}
