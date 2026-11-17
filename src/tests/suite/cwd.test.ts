import { describe, it } from 'mocha';
import assert from 'assert';
import { WorkspaceCwd } from '../../host/workspace/cwd';

/** The editor, as the locator sees it: the folders it opened and whether it opened a workspace file. */
function source(folders: string[], workspaceFile = '') {
    return { workspaceFile: () => workspaceFile, folders: () => folders };
}

describe('cwd locator', () => {
    it('tier 1: one folder and no workspace file is itself the cwd', () => {
        const cwd = new WorkspaceCwd(source(['/work/repo']));
        assert.strictEqual(cwd.forWindow(), '/work/repo');
    });

    it('tier 2: a workspace file gives its first folder', () => {
        const cwd = new WorkspaceCwd(source(['/work/a', '/work/b'], '/work/x.code-workspace'));
        assert.strictEqual(cwd.forWindow(), '/work/a');
    });

    it('no folder: no cwd, so no session', () => {
        assert.strictEqual(new WorkspaceCwd(source([])).forWindow(), '');
    });

    it('names the window by its workspace file, else its first folder, else nothing', () => {
        assert.strictEqual(new WorkspaceCwd(source(['/work/a'], '/work/x.code-workspace')).workspaceIdentity(),
            '/work/x.code-workspace');
        assert.strictEqual(new WorkspaceCwd(source(['/work/a', '/work/b'])).workspaceIdentity(), '/work/a');
        assert.strictEqual(new WorkspaceCwd(source([])).workspaceIdentity(), '');
    });

    it('owns a cwd under any folder of a workspace whose file sits elsewhere', () => {
        // The old rule compared against the .code-workspace file's own directory, which holds none
        // of the roots, so every cwd looked foreign.
        const cwd = new WorkspaceCwd(source(['/repos/a', '/repos/b'], '/config/tools.code-workspace'));
        assert.strictEqual(cwd.ownsCwd('/repos/b'), true);
        assert.strictEqual(cwd.ownsCwd('/repos/b/sub'), true);
        assert.strictEqual(cwd.ownsCwd('/repos'), false);
    });

    it('owns nothing when the window opened no folder', () => {
        assert.strictEqual(new WorkspaceCwd(source([])).ownsCwd('/repos/a'), false);
    });

    it('owns a cwd inside any of its folders, and not a sibling that shares the prefix', () => {
        const cwd = new WorkspaceCwd(source(['/work/a', '/work/b']));
        assert.strictEqual(cwd.ownsCwd('/work/a'), true);
        assert.strictEqual(cwd.ownsCwd('/work/b/sub/file.ts'), true);
        assert.strictEqual(cwd.ownsCwd('/work/a-secrets'), false);
        assert.strictEqual(cwd.ownsCwd('/work/a/../elsewhere'), false);
        assert.strictEqual(cwd.ownsCwd(''), false);
        assert.strictEqual(cwd.ownsCwd(undefined), false);
    });
});

/** A workspace record that keeps what it is told, so a read can be checked against a write. */
function roots(initial: { primaryRoot: string; permissionRoot: string } = { primaryRoot: '', permissionRoot: '' }) {
    const state = { ...initial };
    const writes: Array<{ primaryRoot: string; permissionRoot: string }> = [];
    return {
        source: {
            roots: () => ({ ...state }),
            setRoots: (_path: string, next: { primaryRoot: string; permissionRoot: string }) => {
                writes.push(next);
                state.primaryRoot = next.primaryRoot;
                state.permissionRoot = next.permissionRoot;
            },
        },
        state,
        writes,
    };
}

describe('permission root: the cwd it produces', () => {
    it('tier 3: a picked folder is the cwd, and it is what the record gets', () => {
        const record = roots();
        const cwd = new WorkspaceCwd(source(['/w/a', '/w/b'], '/w/x.code-workspace'), record.source);
        record.source.setRoots('/w/x.code-workspace', { primaryRoot: '/w/a', permissionRoot: '/w/b' });

        assert.strictEqual(cwd.forWindow(), '/w/b');
    });

    it('without a pick the first folder is the cwd, and that is recorded once', () => {
        const record = roots();
        const cwd = new WorkspaceCwd(source(['/w/a', '/w/b'], '/w/x.code-workspace'), record.source);

        assert.strictEqual(cwd.forWindow(), '/w/a');
        assert.deepStrictEqual(record.writes, [{ primaryRoot: '/w/a', permissionRoot: '' }],
            'reconciling a fresh workspace writes its primary once');
        assert.strictEqual(record.source.roots().primaryRoot, '/w/a');
    });

    it('one folder is never a choice, whatever the record still says', () => {
        const record = roots({ primaryRoot: '/w/a', permissionRoot: '/w/b' });
        const cwd = new WorkspaceCwd(source(['/w/only']), record.source);
        assert.strictEqual(cwd.forWindow(), '/w/only');
    });

    it('no folder is no cwd, even with roots on record', () => {
        const record = roots({ primaryRoot: '/w/a', permissionRoot: '/w/b' });
        const cwd = new WorkspaceCwd(source([]), record.source);
        assert.strictEqual(cwd.forWindow(), '');
    });
});
