import * as fs from 'fs';
import * as path from 'path';
import { writeAtomic } from '../store/connection';
import { desktopDirFor } from '../store/paths';
import { TRAY_LAUNCHER, TRAY_SCRIPTS } from '../environment/desktopTray';

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

/**
 * What the user said to the start-in-tray question, and when a "remind me later" comes due.
 *
 * The same shape as the notes-mirror question (one file, one record), because it is the same kind of
 * thing: a first-run question with three answers, of which one expires.
 */
export type TrayAnswer = 'later' | 'never';

export interface TrayQuestion {
    answer: TrayAnswer;
    /** For `later`: when to ask again, ms since the epoch. Ignored for `never`. */
    askAfter: number;
}

export class DesktopStore {
    private readonly _dir: string;
    private readonly _record: string;
    private readonly _lock: string;
    private readonly _question: string;

    constructor(historyDir: string) {
        this._dir = desktopDirFor(historyDir);
        this._record = path.join(this._dir, 'build.json');
        this._lock = path.join(this._dir, 'build.lock');
        this._question = path.join(this._dir, 'tray.json');
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

    /** The tray question's state, or undefined when it was never answered. */
    readTrayQuestion(): TrayQuestion | undefined {
        try {
            const raw = JSON.parse(fs.readFileSync(this._question, 'utf8')) as Partial<TrayQuestion>;
            if (raw?.answer !== 'later' && raw?.answer !== 'never') {
                return undefined;
            }
            return { answer: raw.answer, askAfter: typeof raw.askAfter === 'number' ? raw.askAfter : 0 };
        } catch {
            return undefined;
        }
    }

    writeTrayQuestion(answer: TrayAnswer, askAfter: number): void {
        fs.mkdirSync(this._dir, { recursive: true });
        writeAtomic(this._question, { answer, askAfter });
    }

    /** The login item's scripts, copied out of the extension so a new version folder cannot break it. */
    trayScriptsDir(): string {
        return path.join(this._dir, 'tray');
    }

    /**
     * Copy the shipped scripts into our data home, and answer where they are.
     *
     * `sourceDir` is the extension's own `packaging/windows/`. Missing files are named rather than
     * guessed at: a login item that runs nothing is worse than an answer that says so.
     */
    installScripts(sourceDir: string): { dir: string; missing: string[] } {
        const dir = this.trayScriptsDir();
        fs.mkdirSync(dir, { recursive: true });
        const missing: string[] = [];
        for (const name of TRAY_SCRIPTS) {
            const from = path.join(sourceDir, name);
            try {
                fs.copyFileSync(from, path.join(dir, name));
            } catch {
                missing.push(name);
            }
        }
        return { dir, missing };
    }

    /** The launcher a login item runs, once it is in our data home. */
    trayLauncher(): string {
        return path.join(this.trayScriptsDir(), TRAY_LAUNCHER);
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
