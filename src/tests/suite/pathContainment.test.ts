import { describe, it } from 'mocha';
import assert from 'assert';
import * as path from 'path';
import { pathWithin } from '../../host/workspace/files';

/**
 * The workspace rule, stated as a pure function so it can be tested without an editor: a path is
 * allowed when it sits inside the root. That is the whole rule — and it is not a string prefix.
 */
describe('workspace path containment', () => {
    const root = path.resolve('/work/repo');
    const inside = (p: string) => pathWithin(root, path.resolve(p));

    it('allows the root itself and anything under it', () => {
        assert.strictEqual(inside('/work/repo'), true);
        assert.strictEqual(inside('/work/repo/src/a.ts'), true);
        assert.strictEqual(inside('/work/repo/src/deep/../a.ts'), true);
    });

    it('refuses a sibling that shares the root as a string prefix', () => {
        // `'/work/repo-secrets/key.txt'.startsWith('/work/repo')` was true; that is the bug.
        assert.strictEqual(inside('/work/repo-secrets/key.txt'), false);
    });

    it('refuses a path that walks back out', () => {
        assert.strictEqual(inside('/work/repo/../secrets/key.txt'), false);
        assert.strictEqual(inside('/work/repo/a/b/../../../secret'), false);
    });

    it('refuses a path that is above the root, and an unrelated branch', () => {
        assert.strictEqual(inside('/work'), false);
        assert.strictEqual(inside('/etc/passwd'), false);
    });

    it('refuses a prefix that matches the root text but not a directory segment', () => {
        assert.strictEqual(inside('/work/repo.bak/file'), false);
    });
});
