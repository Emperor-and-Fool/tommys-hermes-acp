import { describe, it } from 'mocha';
import assert from 'assert';
import { WorkspaceCwd, defaultFolderFor } from '../../host/workspace/cwd';
import type { CwdSource, OfferedFolder, RootsSource } from '../../host/workspace/cwd';


describe('cwd locator', () => {
    const roots = (paths: string[]): RootsSource =>
        fakeRoots('w-1', paths).source;

    it('tier 1: one folder and no workspace file is itself the cwd', () => {
        const cwd = new WorkspaceCwd(source(['/work/repo']), roots(['/work/repo']));
        assert.strictEqual(cwd.forSession(''), '/work/repo');
    });

    it('tier 2: a workspace file gives its first folder', () => {
        const cwd = new WorkspaceCwd(source(['/work/a', '/work/b'], '/work/x.code-workspace'), roots(['/work/a', '/work/b']));
        assert.strictEqual(cwd.forSession(''), '/work/a');
    });

    it('no folder: no cwd, so no session', () => {
        assert.strictEqual(new WorkspaceCwd(source([], ''), roots([])).forSession(''), '');
    });

    it('names the window by its workspace file, else its first folder, else nothing', () => {
        const one = roots(['/work/a']);
        assert.strictEqual(new WorkspaceCwd(source(['/work/a'], '/work/x.code-workspace'), one).workspaceIdentity(),
            '/work/x.code-workspace');
        assert.strictEqual(new WorkspaceCwd(source(['/work/a', '/work/b'], ''), roots(['/work/a', '/work/b'])).workspaceIdentity(), '/work/a');
        assert.strictEqual(new WorkspaceCwd(source([], ''), roots([])).workspaceIdentity(), '');
    });
});

/** A workspace record that keeps what it is told, so a read can be checked against a write. */

function fakeRoots(
    workspaceId: string,
    paths: string[],
    options: { defaultFolderId?: string; removed?: string[] } = {},
): { source: RootsSource; writes: string[]; stored: () => string } {
    const offered: OfferedFolder[] = paths.map((folderPath, index) => ({
        folderId: `f${index}`,
        path: folderPath,
        addedAt: index,
        removed: (options.removed || []).includes(folderPath),
    }));
    let stored = options.defaultFolderId || '';
    const writes: string[] = [];
    return {
        writes,
        stored: () => stored,
        source: {
            offered: () => offered,
            defaultFolderId: () => stored,
            setDefaultFolderId: (_workspaceId, folderId) => {
                stored = folderId;
                writes.push(folderId);
            },
            record: () => undefined,
            pathFor: folderId => offered.find(folder => folder.folderId === folderId)?.path || '',
            workspaceId: () => workspaceId,
        },
    };
}

function source(paths: string[], workspaceFile = '/w/x.code-workspace'): CwdSource {
    return { workspaceFile: () => workspaceFile, folders: () => paths.slice() };
}

describe('permission root: the cwd it produces', () => {
    it('a session with a root of its own works in that folder', () => {
        const roots = fakeRoots('w-1', ['/w/a', '/w/b']);
        const cwd = new WorkspaceCwd(source(['/w/a', '/w/b']), roots.source);
        assert.strictEqual(cwd.forSession('f1'), '/w/b');
        assert.strictEqual(roots.writes.length, 0, 'a session root is not a default write');
    });

    it('a session without one works in the default, and a fresh workspace records its first folder once', () => {
        const roots = fakeRoots('w-1', ['/w/a', '/w/b']);
        const cwd = new WorkspaceCwd(source(['/w/a', '/w/b']), roots.source);
        assert.strictEqual(cwd.defaultFolderPath(), '/w/a');
        assert.deepStrictEqual(roots.writes, ['f0'], 'reconciling a fresh workspace writes its default once');
        assert.strictEqual(cwd.forSession(''), '/w/a');
        assert.strictEqual(fakeRoots('w-1', ['/w/a', '/w/b']).writes.length, 0);
    });

    it('one folder is never a choice, whatever the record still says', () => {
        const roots = fakeRoots('w-1', ['/w/only'], { defaultFolderId: 'f-gone' });
        const cwd = new WorkspaceCwd(source(['/w/only']), roots.source);
        assert.strictEqual(cwd.forSession('f-old'), '/w/only');
        assert.strictEqual(cwd.defaultFolderPath(), '/w/only');
    });

    it('no folder is no cwd, even with a default on record', () => {
        const roots = fakeRoots('w-1', [], { defaultFolderId: 'f0' });
        const cwd = new WorkspaceCwd(source([]), roots.source);
        assert.strictEqual(cwd.forSession(''), '');
        assert.strictEqual(cwd.defaultFolderPath(), '');
    });

    it('a default that is gone becomes the most recently added folder still there', () => {
        const offered: OfferedFolder[] = [
            { folderId: 'f0', path: '/w/a', addedAt: 30, removed: false },
            { folderId: 'f1', path: '/w/b', addedAt: 10, removed: false },
            { folderId: 'f2', path: '/w/c', addedAt: 99, removed: true },
        ];
        assert.strictEqual(defaultFolderFor('f-gone', offered), 'f0');
        assert.strictEqual(defaultFolderFor('f1', offered), 'f1');
        assert.strictEqual(defaultFolderFor('', offered), 'f0');
        assert.strictEqual(defaultFolderFor('f0', []), '');
    });
});
