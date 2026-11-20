import { describe, it } from 'mocha';
import assert from 'assert';
import { treeNoticeBlock } from '../../host/workspace/workSpace';

/**
 * Hermes uses "workspace" for the folder it works in. This block describes the editor window —
 * its projects and tabs — so it must never use that word for it.
 */
describe('the tree notice block: its words', () => {
    const block = treeNoticeBlock({ current: '/p/tree-current.json', passive: '/p/tree-passive.json' });

    it('names the window a clientworkspace, and says what it is not', () => {
        assert.ok(block.includes('current (this clientworkspace: projects and tabs, not your working folder):'));
        assert.ok(block.includes('previous clientworkspace: /p/tree-passive.json'));
        assert.ok(block.startsWith('<clientworkspace-tree>') && block.endsWith('</clientworkspace-tree>'));
    });

    it('never calls the window "workspace"', () => {
        assert.ok(!/(^|[^a-z])workspace:/m.test(block), 'no "workspace:" label');
        assert.ok(!block.includes('this workspace)'), 'no bare "this workspace"');
    });

    it('carries both paths, and nothing else about the window', () => {
        assert.ok(block.includes('/p/tree-current.json'));
        assert.ok(block.includes('/p/tree-passive.json'));
    });
});
