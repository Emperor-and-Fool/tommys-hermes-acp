import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NO_ROOTS, effectiveRoot, offeredRoots, reconcileRoots } from '../../host/workspace/cwd';
import { ProfileRootsStore } from '../../host/workspace/store';

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
    it('files the two roots under the workspace id, in the agent folder', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new ProfileRootsStore(dir, () => 'id-dev-vsc');
        const workspaceId = 'w-1';

        store.setRoots(workspaceId, { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        assert.deepStrictEqual(store.roots(workspaceId), { primaryRoot: '/w/a', permissionRoot: '/w/b' });

        const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.deepStrictEqual(written[workspaceId], { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        assert.strictEqual(store.path, path.join(dir, 'profiles', 'id-dev-vsc', 'workspace-roots.json'));

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('clears a root by writing an empty string, rather than leaving the old one behind', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        const store = new ProfileRootsStore(dir, () => 'id-dev-vsc');
        store.setRoots('w-1', { primaryRoot: '/w/a', permissionRoot: '/w/b' });
        store.setRoots('w-1', { primaryRoot: '/w/a', permissionRoot: '' });

        assert.deepStrictEqual(store.roots('w-1'), { primaryRoot: '/w/a', permissionRoot: '' });
        const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.strictEqual('permissionRoot' in written['w-1'], true, 'the cleared root is written, not dropped');
        assert.strictEqual(written['w-1'].permissionRoot, '');

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('follows the profile it is asked about, and answers nothing for a workspace it has not seen', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roots-'));
        let current = 'id-one';
        const store = new ProfileRootsStore(dir, () => current);
        store.setRoots('w-1', { primaryRoot: '/w/a', permissionRoot: '' });
        current = 'id-two';
        assert.deepStrictEqual(store.roots('w-1'), { primaryRoot: '', permissionRoot: '' });
        assert.deepStrictEqual(store.roots(''), { primaryRoot: '', permissionRoot: '' });

        current = 'id-one';
        assert.deepStrictEqual(store.roots('w-1'), { primaryRoot: '/w/a', permissionRoot: '' });

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
