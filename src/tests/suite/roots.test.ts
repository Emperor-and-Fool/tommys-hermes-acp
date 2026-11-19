import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NO_ROOTS, effectiveRoot, offeredRoots, reconcileRoots } from '../../host/workspace/cwd';
import { ProfileWorkspaceStore } from '../../host/workspace/store';
import { FoldersStore } from '../../host/store/folders';

/**
 * The permission root: which folder Hermes works in when a workspace shows several. The rules are
 * pure so every case can be named without an editor, and the store keeps the answer per workspace.
 */
describe('permission root: the rules', () => {
    it('a workspace that recorded nothing takes the first folder as primary', () => {
        assert.deepStrictEqual(reconcileRoots(NO_ROOTS, ['/w/a', '/w/b']),
            { primaryRoot: '/w/a', permissionRoot: '' });
    });

    it('keeps the primary it has, and keeps the pick while its folder is still there', () => {
        const state = { primaryRoot: '/w/a', permissionRoot: '/w/b' };
        assert.deepStrictEqual(reconcileRoots(state, ['/w/a', '/w/b', '/w/c']), state);
    });

    it('a chosen root that went away falls back to the primary', () => {
        assert.deepStrictEqual(reconcileRoots({ primaryRoot: '/w/a', permissionRoot: '/w/b' }, ['/w/a']),
            { primaryRoot: '/w/a', permissionRoot: '' });
    });

    it('a primary that went away becomes the most recent folder, the last in the editor list', () => {
        assert.deepStrictEqual(reconcileRoots({ primaryRoot: '/w/a', permissionRoot: '' }, ['/w/b', '/w/c']),
            { primaryRoot: '/w/c', permissionRoot: '' });
    });

    it('one folder is the whole workspace: the pick is dropped and that folder is the root', () => {
        assert.deepStrictEqual(reconcileRoots({ primaryRoot: '/w/a', permissionRoot: '/w/b' }, ['/w/b']),
            { primaryRoot: '/w/b', permissionRoot: '' });
    });

    it('no folders means no roots at all', () => {
        assert.deepStrictEqual(reconcileRoots({ primaryRoot: '/w/a', permissionRoot: '/w/b' }, []), NO_ROOTS);
    });

    it('the root Hermes works in is the pick, else the primary', () => {
        assert.strictEqual(effectiveRoot({ primaryRoot: '/w/a', permissionRoot: '/w/b' }), '/w/b');
        assert.strictEqual(effectiveRoot({ primaryRoot: '/w/a', permissionRoot: '' }), '/w/a');
        assert.strictEqual(effectiveRoot(NO_ROOTS), '');
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

    it('answers the roots port in paths while the cwd owner still asks in paths', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new ProfileWorkspaceStore(dir, () => 'id-dev-vsc');
        try {
            store.setRoots('w-1', { primaryRoot: '/w/a', permissionRoot: '/w/b' });
            // The pick belongs to the session now; only the default is this table's business.
            assert.deepStrictEqual(store.roots('w-1'), { primaryRoot: '/w/a', permissionRoot: '' });
            assert.strictEqual(store.defaultFolderId('w-1'), new FoldersStore(dir).folderFor('/w/a')!.id);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
