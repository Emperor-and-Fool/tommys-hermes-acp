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
