import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { onStoreWriteError, writeAtomic } from '../../host/store/connection';

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-writes-'));
}

function busy(): NodeJS.ErrnoException {
    const error = new Error('resource busy or locked') as NodeJS.ErrnoException;
    error.code = 'EBUSY';
    return error;
}

/**
 * The write discipline under a filesystem that says no.
 *
 * A Windows rename fails while another process holds the target; the retry is the only thing a
 * writer can do about it, and a write that never lands must be visible instead of silent. The
 * rename is injected, so this runs on any platform and without waiting.
 */
describe('the store write discipline', () => {
    it('retries a rename the filesystem refuses twice, then writes the file', () => {
        const dir = tempDir();
        try {
            const target = path.join(dir, 'sessions.json');
            let calls = 0;
            writeAtomic(target, { ok: true }, {
                waitMs: 0,
                rename: (from, to) => {
                    calls += 1;
                    if (calls <= 2) {
                        throw busy();
                    }
                    fs.renameSync(from, to);
                },
            });
            assert.strictEqual(calls, 3, 'two refusals, then the one that wrote');
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf-8')), { ok: true });
            assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'the temp file is gone');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('gives up after five tries, reports once, and leaves no temp file', () => {
        const dir = tempDir();
        const reports: string[] = [];
        onStoreWriteError(line => reports.push(line));
        try {
            const target = path.join(dir, 'workspace-folders.json');
            let calls = 0;
            writeAtomic(target, { links: [] }, {
                waitMs: 0,
                rename: () => {
                    calls += 1;
                    throw busy();
                },
            });
            assert.strictEqual(calls, 5, 'five tries');
            assert.strictEqual(reports.length, 1, 'reported once');
            assert.match(reports[0], /workspace-folders\.json/);
            assert.match(reports[0], /EBUSY/);
            assert.strictEqual(fs.existsSync(target), false, 'nothing was written');
            assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'the temp file is removed');
        } finally {
            onStoreWriteError(() => undefined);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not retry a failure that is not a lock', () => {
        const dir = tempDir();
        try {
            const target = path.join(dir, 'folders.json');
            let calls = 0;
            writeAtomic(target, { folders: [] }, {
                waitMs: 0,
                rename: () => {
                    calls += 1;
                    const error = new Error('no such file or directory') as NodeJS.ErrnoException;
                    error.code = 'ENOENT';
                    throw error;
                },
            });
            assert.strictEqual(calls, 1, 'a missing directory is not worth five tries');
            assert.strictEqual(fs.existsSync(`${target}.tmp`), false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
