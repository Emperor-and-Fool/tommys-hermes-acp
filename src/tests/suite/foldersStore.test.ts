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
