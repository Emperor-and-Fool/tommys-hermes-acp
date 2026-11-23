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

/**
 * Where an agent's own notes are rides in this same notice: the agent reads one block, once per
 * session and workspace, and gets both the window's files and its own folder.
 */
describe('the tree notice block: the notes section', () => {
    const notes = '<agent-notes>\nYour notes folder: /n (index: 00 Index.md)\n'
        + 'Keep notes per project here, so your memory stays small.\n</agent-notes>';

    it('comes after the tree, and leaves the block alone when there is none', () => {
        const paths = { current: '/p/tree-current.json', passive: '/p/tree-passive.json' };
        const withNotes = treeNoticeBlock(paths, notes);
        assert.ok(withNotes.startsWith('<clientworkspace-tree>'));
        assert.ok(withNotes.indexOf('/p/tree-passive.json') < withNotes.indexOf('<agent-notes>'), 'the notes come second');
        assert.ok(withNotes.endsWith('</agent-notes>'));

        assert.ok(withNotes.endsWith("Repeats each session; don't save to memory."), 'the closing line comes last');

        const alone = treeNoticeBlock(paths);
        assert.ok(alone.endsWith('</clientworkspace-tree>'), 'no notes, no second section');
        assert.ok(!alone.includes('<agent-notes>'));
    });
});
