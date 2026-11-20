import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The data home, and how it is written.
 *
 * This is the one backend file that names where our data lives and carries the write rules (ST1).
 * Stores commit through `writeAtomic` or `transaction`; every other `fs` writer of a data file of
 * ours is still a finding to be moved here or behind a store.
 *
 * The write discipline is temp file + rename: the target is the old file or the new one, never a
 * half of either. Rename is the filesystem's one atomic step, and these files hold the only copy
 * of what the user made.
 *
 * On JSON a transaction is all-or-nothing per call, but not crash-atomic across files. The writes
 * are collected before anything is touched, so a throw in the caller's function writes nothing;
 * the commits that follow are then separate renames, so a crash between two of them leaves the
 * earlier ones applied. SQLite turns the same call into a real transaction — one BEGIN/COMMIT —
 * without changing a caller: the function keeps its shape and stays synchronous (ST4).
 */

/**
 * The data home: one folder for both extensions.
 *
 * The name is the primary's historical home and stays a constant on purpose. It used to be derived
 * from the extension id, which gave the primary and the secondant a copy of everything each — the
 * reason Kitt's projects looked lost when the primary moved to her. Per-agent records live under
 * `profiles/<sessionProfileId>/`, which is the same fact for both extensions, so the home is too.
 *
 * Deliberately not `context.globalStorageUri`: that folder lives inside the editor's user-data
 * directory, so uninstalling the extension, resetting a profile or starting a fresh editor version
 * can take the sessions, projects and attachments with it. Each platform gets the user's own
 * location for application data:
 *
 *   Windows  %LOCALAPPDATA% (not Roaming: this state belongs to the machine)
 *   macOS    ~/Library/Application Support
 *   Linux    $XDG_DATA_HOME when it is absolute, else ~/.local/share
 */
const DATA_HOME_NAME = 'emperorandfool.tommys-hermes-acp';

/**
 * The secondant's own home, from before the two shared one.
 *
 * Named once, here, because it is a migration source: our code reads it and never writes it (its
 * documents are the secondant's), and no extension id derives a data home any more.
 */
const LEGACY_SECONDANT_HOME_NAME = 'emperorandfool.tommys-hermes-secondant';

/** The user's application-data folder, per platform. */
function dataRoot(): string {
    const home = os.homedir();
    const xdg = (process.env.XDG_DATA_HOME || '').trim();
    if (process.platform === 'win32') {
        return (process.env.LOCALAPPDATA || '').trim() || path.join(home, 'AppData', 'Local');
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support');
    }
    return path.isAbsolute(xdg) ? xdg : path.join(home, '.local', 'share');
}

/** Where both extensions keep their data. */
export function dataHome(): string {
    return path.join(dataRoot(), DATA_HOME_NAME);
}

/** Where the secondant kept its data alone: read by the migration, never written by us. */
export function legacySecondantHome(): string {
    return path.join(dataRoot(), LEGACY_SECONDANT_HOME_NAME);
}

/**
 * The data home, created if it is not there yet.
 *
 * Because every store that follows opens a file inside it. The `mkdir` used to sit in the
 * composition root, which is a write to the data home from outside `host/store/` (ST1).
 */
export function ensureDataHome(): string {
    const home = dataHome();
    fs.mkdirSync(home, { recursive: true });
    return home;
}

/**
 * A rename that survives a file another process still has open.
 *
 * On POSIX a rename over an open file is fine. On Windows it fails with `EPERM`, `EBUSY` or `EACCES`
 * while any other process holds the target — and four windows of ours share these files, so the
 * window is not theoretical. Same-rename retries are the only thing a writer can do about it: the
 * other process is watched by nobody here, and a wait is cheap next to losing the write.
 */
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 50;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface RenameRetryOptions {
    attempts?: number;
    waitMs?: number;
    /** Injected by the tests to fail on demand; the default is `fs.renameSync`. */
    rename?: (from: string, to: string) => void;
    /** Injected by the tests so they do not actually wait. */
    wait?: (ms: number) => void;
}

/** A synchronous wait, so the store stays synchronous (ST4). */
function sleepSync(ms: number): void {
    if (ms <= 0) {
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renameWithRetry(from: string, to: string, options: RenameRetryOptions = {}): void {
    const attempts = options.attempts ?? RENAME_ATTEMPTS;
    const waitMs = options.waitMs ?? RENAME_WAIT_MS;
    const rename = options.rename ?? ((a: string, b: string) => fs.renameSync(a, b));
    const wait = options.wait ?? sleepSync;
    for (let attempt = 1; ; attempt += 1) {
        try {
            rename(from, to);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code || '';
            if (attempt >= attempts || !RETRYABLE_RENAME_CODES.has(code)) {
                throw error;
            }
            wait(waitMs);
        }
    }
}

/** The one reporter for a store write that failed for good; wired to the output log in app.ts. */
export type StoreWriteErrorReporter = (line: string) => void;

let storeWriteErrorReporter: StoreWriteErrorReporter | undefined;

/** Register the reporter. Called once, from the composition root. */
export function onStoreWriteError(reporter: StoreWriteErrorReporter): void {
    storeWriteErrorReporter = reporter;
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code ? `${code}: ${error.message}` : error.message;
    }
    return String(error);
}

/**
 * Replace a target with a temp file and a rename, so a failed write cannot truncate it.
 *
 * `writeFileSync` straight onto the target leaves a truncated file if the write dies halfway, and
 * these files hold the only copy of what he made. A rename is the filesystem's one atomic step:
 * the target is the old file or the new one, never a half of either.
 *
 * A rename that still fails after its retries is reported, not swallowed: a write that never landed
 * is the one failure a user must be able to see.
 */
function replaceViaTemp(target: string, contents: string, options: RenameRetryOptions = {}): void {
    const temp = target + '.tmp';
    try {
        fs.writeFileSync(temp, contents);
        renameWithRetry(temp, target, options);
    } catch (error) {
        try {
            fs.rmSync(temp, { force: true });
        } catch { /* the next write overwrites it */ }
        storeWriteErrorReporter?.(`${path.basename(target)} could not be written (${describeError(error)})`);
    }
}

/** Write JSON through a temp file and a rename. */
export function writeAtomic(target: string, value: unknown, options: RenameRetryOptions = {}): void {
    replaceViaTemp(target, JSON.stringify(value, null, 2), options);
}

/**
 * Write plain text through a temp file and a rename: the twin for a target that is not JSON.
 *
 * The active-session pointer is one bare id. Encoding it would change the file on disk (`"abc"`
 * instead of `abc`), so this variant keeps the exact bytes and takes the same care with them.
 */
export function writeAtomicText(target: string, text: string, options: RenameRetryOptions = {}): void {
    replaceViaTemp(target, text, options);
}

/** What a transaction hands the caller's function: the writes to commit, collected first. */
export interface Transaction {
    /** Stage a write. Nothing reaches the disk until the function returns. */
    write(target: string, value: unknown): void;
}

/**
 * Run a unit of work whose writes belong together.
 *
 * The caller's function stages its writes instead of performing them; each is committed with
 * `writeAtomic` once the function returns. If the function throws, nothing is written.
 *
 * On JSON this is all-or-nothing per call but not crash-atomic across files: a crash during the
 * commits leaves the earlier ones applied. SQLite will make the same call one real transaction
 * without changing a caller (ST3, ST4).
 */
export function transaction(fn: (tx: Transaction) => void): void {
    const writes: { target: string; value: unknown }[] = [];
    fn({ write: (target, value) => { writes.push({ target, value }); } });
    for (const entry of writes) {
        writeAtomic(entry.target, entry.value);
    }
}
