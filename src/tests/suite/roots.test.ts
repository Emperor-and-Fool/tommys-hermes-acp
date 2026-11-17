import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NO_ROOTS, effectiveRoot, offeredRoots, reconcileRoots } from '../../host/workspace/cwd';
import { WorkspaceStore } from '../../host/workspace/store';

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
    it('writes the two roots against the workspace path and reads them back', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new WorkspaceStore(dir);
        const workspace = store.register('/w/space.code-workspace');

        store.setRoots(workspace[0].path, { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        assert.deepStrictEqual(store.roots('/w/space.code-workspace'),
            { primaryRoot: '/w/a', permissionRoot: '/w/b' });

        const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.strictEqual(written.workspaces[0].primaryRoot, '/w/a');
        assert.strictEqual(written.workspaces[0].permissionRoot, '/w/b');

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('clears a root by writing an empty string, rather than leaving the old one behind', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new WorkspaceStore(dir);
        const workspace = store.register('/w/space');
        store.setRoots(workspace[0].path, { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        store.setRoots(workspace[0].path, { primaryRoot: '/w/a', permissionRoot: '' });

        assert.deepStrictEqual(store.roots('/w/space'), { primaryRoot: '/w/a', permissionRoot: '' });
        const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.strictEqual('permissionRoot' in written.workspaces[0], false, 'unset stays absent');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
