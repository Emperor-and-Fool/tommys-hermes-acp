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
 * Where the extension keeps its data.
 *
 * Deliberately not `context.globalStorageUri`: that folder lives inside the editor's user-data
 * directory, so uninstalling the extension, resetting a profile or starting a fresh editor version
 * can take the sessions, projects and attachments with it. Each platform gets the user's own
 * location for application data, and the extension id keeps the primary and the secondant apart:
 *
 *   Windows  %LOCALAPPDATA% (not Roaming: this state belongs to the machine)
 *   macOS    ~/Library/Application Support
 *   Linux    $XDG_DATA_HOME when it is absolute, else ~/.local/share
 */
export function dataHomeFor(extensionId: string): string {
    const home = os.homedir();
    const xdg = (process.env.XDG_DATA_HOME || '').trim();
    let base: string;
    if (process.platform === 'win32') {
        base = (process.env.LOCALAPPDATA || '').trim() || path.join(home, 'AppData', 'Local');
    } else if (process.platform === 'darwin') {
        base = path.join(home, 'Library', 'Application Support');
    } else {
        base = path.isAbsolute(xdg) ? xdg : path.join(home, '.local', 'share');
    }
    return path.join(base, extensionId.toLowerCase());
}

/**
 * Replace a target with a temp file and a rename, so a failed write cannot truncate it.
 *
 * `writeFileSync` straight onto the target leaves a truncated file if the write dies halfway, and
 * these files hold the only copy of what he made. A rename is the filesystem's one atomic step:
 * the target is the old file or the new one, never a half of either.
 */
function replaceViaTemp(target: string, contents: string): void {
    const temp = target + '.tmp';
    try {
        fs.writeFileSync(temp, contents);
        fs.renameSync(temp, target);
    } catch {
        try {
            fs.rmSync(temp, { force: true });
        } catch { /* the next write overwrites it */ }
    }
}

/** Write JSON through a temp file and a rename. */
export function writeAtomic(target: string, value: unknown): void {
    replaceViaTemp(target, JSON.stringify(value, null, 2));
}

/**
 * Write plain text through a temp file and a rename: the twin for a target that is not JSON.
 *
 * The active-session pointer is one bare id. Encoding it would change the file on disk (`"abc"`
 * instead of `abc`), so this variant keeps the exact bytes and takes the same care with them.
 */
export function writeAtomicText(target: string, text: string): void {
    replaceViaTemp(target, text);
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
