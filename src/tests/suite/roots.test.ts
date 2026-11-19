import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defaultFolderFor, offeredRoots } from '../../host/workspace/cwd';
import type { OfferedFolder } from '../../host/workspace/cwd';
import { ProfileWorkspaceStore } from '../../host/workspace/store';

/**
 * The permission root: which folder Hermes works in when a workspace shows several. The rules are
 * pure so every case can be named without an editor, and the store keeps the answer per workspace.
 */
describe('permission root: the rules', () => {
    const offered = (rows: Array<[string, number, boolean]>): OfferedFolder[] =>
        rows.map(([path, addedAt, removed]) => ({ folderId: `f-${path}`, path, addedAt, removed }));

    it('a workspace that recorded nothing takes the first folder as its default', () => {
        assert.strictEqual(defaultFolderFor('', offered([['/w/a', 1, false], ['/w/b', 2, false]])), 'f-/w/a');
    });

    it('keeps the default it has while its folder is still there', () => {
        assert.strictEqual(defaultFolderFor('f-/w/b', offered([['/w/a', 1, false], ['/w/b', 2, false]])), 'f-/w/b');
    });

    it('a default that went away becomes the most recently added folder still there', () => {
        assert.strictEqual(
            defaultFolderFor('f-gone', offered([['/w/a', 50, false], ['/w/b', 10, false], ['/w/c', 99, true]])),
            'f-/w/a',
        );
    });

    it('one folder is the whole workspace: the default is that folder', () => {
        assert.strictEqual(defaultFolderFor('f-old', offered([['/w/only', 1, false]])), 'f-/w/only');
    });

    it('no folders means no default at all', () => {
        assert.strictEqual(defaultFolderFor('f-old', []), '');
    });

    it('a picker is offered only when there are two or more folders to choose between', () => {
        assert.deepStrictEqual(offeredRoots(['/w/a']), []);
        assert.deepStrictEqual(offeredRoots([]), []);
        assert.deepStrictEqual(offeredRoots(['/w/a', '/w/b']), ['/w/a', '/w/b']);
    });
});

describe('permission root: the store', () => {
    it('files the default folder and the active session per workspace, in the agent folder', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new ProfileWorkspaceStore(dir, () => 'id-dev-vsc');
        try {
            assert.deepStrictEqual(store.row('w-1'), { defaultFolderId: '', activeSessionId: '' }, 'a workspace it has not seen');
            store.setDefaultFolderId('w-1', 'f-a');
            store.setActiveSessionId('w-1', 'tab-9');
            store.setDefaultFolderId('w-2', 'f-b');

            const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
            assert.deepStrictEqual(written, {
                'w-1': { defaultFolderId: 'f-a', activeSessionId: 'tab-9' },
                'w-2': { defaultFolderId: 'f-b', activeSessionId: '' },
            });
            assert.strictEqual(store.path, path.join(dir, 'profiles', 'id-dev-vsc', 'workspaces.json'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('follows the profile it is asked about', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        let current = 'id-one';
        const store = new ProfileWorkspaceStore(dir, () => current);
        try {
            store.setDefaultFolderId('w-1', 'f-a');
            current = 'id-two';
            assert.strictEqual(store.defaultFolderId('w-1'), '');
            current = 'id-one';
            assert.strictEqual(store.defaultFolderId('w-1'), 'f-a');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('answers the port in folder ids, and names a workspace by its stored id', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new ProfileWorkspaceStore(dir, () => 'id-dev-vsc');
        try {
            store.record('w-1', ['/w/a', '/w/b']);
            const offered = store.offered('w-1');
            assert.deepStrictEqual(offered.map(folder => folder.path), ['/w/a', '/w/b']);
            assert.strictEqual(store.pathFor(offered[1].folderId), '/w/b');
            const workspaceId = store.workspaceId('/w/space.code-workspace');
            assert.ok(workspaceId.length > 0);
            assert.strictEqual(store.workspaceId('/w/space.code-workspace'), workspaceId, 'a stored id, not a new one per call');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
