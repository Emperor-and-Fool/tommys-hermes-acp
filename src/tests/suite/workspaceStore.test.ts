import { describe, it, beforeEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceStore } from '../../host/cache/workspaceStore';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'workspaces-'));

describe('workspace store: the registry file', () => {
    let dir: string;
    let store: WorkspaceStore;

    beforeEach(() => {
        dir = tmp();
        store = new WorkspaceStore(dir);
    });

    it('records a workspace once and stamps the one it has seen again', () => {
        store.register('/proj/a.code-workspace');
        store.register('/proj/a.code-workspace');
        const entries = store.read();
        assert.strictEqual(entries.length, 1, 'one entry per path');
        assert.strictEqual(entries[0].path, '/proj/a.code-workspace');
    });

    it('reads the file it used to be: a bare array of workspaces', () => {
        fs.writeFileSync(store.path, JSON.stringify([{ path: '/proj/old', lastSeen: 1 }]));
        assert.deepStrictEqual(store.read().map(entry => entry.path), ['/proj/old']);
        assert.deepStrictEqual(store.folders(), [], 'a bare array carries no folders');
    });

    it('names a folder against the workspace it belongs to', () => {
        store.register('/proj/a.code-workspace');
        const folder = store.createFolder('  Timeless   admin ', '/proj/a.code-workspace');
        assert.ok(folder);
        assert.strictEqual(folder.name, 'Timeless admin', 'whitespace collapses, ends trim');
        assert.strictEqual(folder.workspace, '/proj/a.code-workspace');
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['Timeless admin']);
        assert.strictEqual(store.read().length, 1, 'naming a folder does not disturb the workspaces');
    });

    it('creates nothing from a blank name', () => {
        assert.strictEqual(store.createFolder('   ', '/proj/a'), undefined);
        assert.deepStrictEqual(store.folders(), []);
    });

    it('renames a folder in place, trimming the name like a create', () => {
        const folder = store.createFolder('One', '/proj/a');
        assert.ok(folder);
        const renamed = store.renameFolder(folder.id, '  Two   words ');
        assert.strictEqual(renamed?.name, 'Two words');
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['Two words']);
        assert.strictEqual(store.folders()[0].id, folder.id, 'the id survives: tabs point at it');
    });

    it('renames nothing with a blank name, and says so', () => {
        const folder = store.createFolder('One', '/proj/a');
        assert.ok(folder);
        assert.strictEqual(store.renameFolder(folder.id, '   '), undefined);
        assert.strictEqual(store.renameFolder('no-such-folder', 'Two'), undefined);
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['One']);
    });

    it('deletes one folder and leaves the others alone', () => {
        const first = store.createFolder('One', '/proj/a');
        const second = store.createFolder('Two', '/proj/a');
        assert.ok(first && second);
        assert.strictEqual(store.deleteFolder(first.id), true);
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['Two']);
        assert.strictEqual(store.deleteFolder('no-such-folder'), false);
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['Two']);
    });

    it('keeps the folders when a workspace is registered again', () => {
        store.createFolder('One', '/proj/a');
        store.register('/proj/b');
        assert.deepStrictEqual(store.folders().map(entry => entry.name), ['One']);
        assert.deepStrictEqual(store.read().map(entry => entry.path), ['/proj/b']);
    });
});
