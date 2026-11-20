import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FoldersStore, foldersPathFor, workspaceFoldersPathFor } from '../../host/store/folders';

function tempHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-folders-'));
}

describe('the folder tables', () => {
    it('mints one row per path, and answers the path back', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            const row = store.folderFor('/w/a')!;
            assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
            assert.strictEqual(store.folderFor('/w/a')!.id, row.id, 'one row per path, shared');
            assert.strictEqual(store.pathFor(row.id), '/w/a');
            assert.strictEqual(store.rowFor('/w/b'), undefined, 'asking does not mint');
            assert.strictEqual(store.pathFor('not-a-folder'), '');
            assert.strictEqual(fs.existsSync(foldersPathFor(home)), true);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('records a workspace in the editor order, and the same path in two workspaces is one row', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            store.record('w1', ['/w/a', '/w/b'], 1000);
            store.record('w2', ['/w/b'], 2000);

            const first = store.foldersOf('w1');
            assert.deepStrictEqual(first.map(folder => [folder.path, folder.position, folder.removed]), [
                ['/w/a', 0, false],
                ['/w/b', 1, false],
            ]);
            assert.deepStrictEqual(store.foldersOf('w2').map(folder => folder.path), ['/w/b']);
            const rows = JSON.parse(fs.readFileSync(foldersPathFor(home), 'utf-8')).folders;
            assert.strictEqual(rows.length, 2, 'two paths, two rows');
            assert.strictEqual(store.foldersOf('w1')[0].folderId, store.folderFor('/w/a')!.id);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('retires a folder that leaves, keeps its row, and makes it live again when it returns', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            store.record('w1', ['/w/a', '/w/b'], 1000);
            store.record('w1', ['/w/a'], 2000);
            const afterRemoval = store.foldersOf('w1');
            assert.deepStrictEqual(afterRemoval.map(folder => [folder.path, folder.removed]), [['/w/a', false], ['/w/b', true]]);
            assert.deepStrictEqual(store.liveFoldersOf('w1').map(folder => folder.path), ['/w/a']);

            store.record('w1', ['/w/b', '/w/a'], 3000);
            const afterReturn = store.foldersOf('w1');
            assert.deepStrictEqual(afterReturn.map(folder => [folder.path, folder.position, folder.removed]), [
                ['/w/b', 0, false],
                ['/w/a', 1, false],
            ]);
            const links = JSON.parse(fs.readFileSync(workspaceFoldersPathFor(home), 'utf-8')).links;
            const readded = links.find((link: { folderId: string }) => link.folderId === afterReturn[0].folderId);
            assert.strictEqual(readded.addedAt, 3000, 'coming back is a fresh add');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('writes nothing when the editor reports what it reported last time', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            store.record('w1', ['/w/a', '/w/b'], 1000);
            const foldersBefore = fs.statSync(foldersPathFor(home)).mtimeMs;
            const linksBefore = fs.readFileSync(workspaceFoldersPathFor(home), 'utf-8');
            store.record('w1', ['/w/a', '/w/b'], 2000);
            assert.strictEqual(fs.statSync(foldersPathFor(home)).mtimeMs, foldersBefore);
            assert.strictEqual(fs.readFileSync(workspaceFoldersPathFor(home), 'utf-8'), linksBefore);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('gives a folder that joins the workspace the welcome, and one that comes back too', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            store.record('w1', ['/w/a'], 1000);
            assert.strictEqual(store.foldersOf('w1')[0].newSecondsLeft, 30, 'a new folder is new');

            store.record('w1', ['/w/a', '/w/b'], 2000);
            const second = store.foldersOf('w1')[1];
            assert.deepStrictEqual([second.path, second.newSecondsLeft], ['/w/b', 30]);

            // The welcome is spent, the folder leaves, and it joins again: that is a new joining.
            store.setNewSecondsLeft('w1', second.folderId, 0);
            store.record('w1', ['/w/a'], 3000);
            store.record('w1', ['/w/a', '/w/b'], 4000);
            const back = store.foldersOf('w1').find(folder => folder.path === '/w/b')!;
            assert.strictEqual(back.newSecondsLeft, 30, 'a returning folder is new again');

            // A plain re-record of the same list spends nothing and refreshes nothing.
            store.setNewSecondsLeft('w1', back.folderId, 12);
            store.record('w1', ['/w/a', '/w/b'], 5000);
            assert.strictEqual(store.foldersOf('w1').find(folder => folder.path === '/w/b')!.newSecondsLeft, 12);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('writes the seconds left only when the value changed', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            store.record('w1', ['/w/a'], 1000);
            const folderId = store.foldersOf('w1')[0].folderId;
            const linksPath = workspaceFoldersPathFor(home);
            const before = fs.statSync(linksPath);

            assert.strictEqual(store.setNewSecondsLeft('w1', folderId, 30), false, 'the same value is not written');
            const afterSame = fs.statSync(linksPath);
            assert.strictEqual(afterSame.mtimeMs, before.mtimeMs);
            assert.strictEqual(afterSame.ino, before.ino, 'no temp file was renamed over it');

            assert.strictEqual(store.setNewSecondsLeft('w1', folderId, 25.4), true);
            assert.strictEqual(store.foldersOf('w1')[0].newSecondsLeft, 25, 'seconds are whole');
            assert.strictEqual(store.setNewSecondsLeft('w1', 'not-a-folder', 10), false, 'no row, nothing written');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('keeps a row it does not understand, and reads a missing table as empty', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home);
            assert.deepStrictEqual(store.foldersOf('w1'), []);
            fs.writeFileSync(foldersPathFor(home), JSON.stringify({ folders: [{ id: 'f1', path: '/w/a', note: 'kept' }] }));
            store.folderFor('/w/b');
            const rows = JSON.parse(fs.readFileSync(foldersPathFor(home), 'utf-8')).folders;
            assert.strictEqual(rows[0].note, 'kept');
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(path.basename(foldersPathFor(home)), 'folders.json');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('one folder, many spellings', () => {
    it('mints one row for C:\\Repo and c:\\repo\\ on win32', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home, 'win32');
            const first = store.folderFor('C:\\Repo')!;
            assert.strictEqual(store.folderFor('c:\\repo\\')!.id, first.id, 'drive letter and trailing separator do not make a second row');
            assert.strictEqual(store.rowFor('c:/repo')!.id, first.id, 'a forward-slash spelling is the same folder');
            assert.strictEqual(first.path, 'C:\\Repo', 'the stored path is what the editor reported first');
            const rows = JSON.parse(fs.readFileSync(foldersPathFor(home), 'utf-8')).folders;
            assert.strictEqual(rows.length, 1);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('keeps the same two strings apart on linux', () => {
        const home = tempHome();
        try {
            const store = new FoldersStore(home, 'linux');
            const first = store.folderFor('C:\\Repo')!;
            assert.notStrictEqual(store.folderFor('c:\\repo\\')!.id, first.id, 'case and separators are the path here');
            const rows = JSON.parse(fs.readFileSync(foldersPathFor(home), 'utf-8')).folders;
            assert.strictEqual(rows.length, 2);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
