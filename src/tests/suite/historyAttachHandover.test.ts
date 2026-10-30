import { describe, it } from 'mocha';
import assert from 'assert';
import { formatHistoryBlock, parseHistoryBlocks } from '../../host/chat/historyAttach';
import type { ChatMessage, HistoryRef } from '../../shared/chat';

const msg = (role: string, text: string, timestamp: number): ChatMessage => ({ role, text, timestamp });

const ref = (over: Partial<HistoryRef> = {}): HistoryRef => ({
    sessionId: 'h-1',
    profile: 'pa',
    title: 'Secondant 01',
    count: 2,
    messageIds: [41, 42],
    from: 1000,
    to: 2000,
    ...over,
});

const messages = [msg('user', 'why is it  slow?', 1), msg('assistant', 'because', 2)];

/**
 * The attach block is the same handover in a wrapper: markers around it, the picked messages after
 * it. The advice lines are for the agent, and the parser must not mistake them for content.
 */
describe('attach block carries the handover', () => {
    it('states the hint, and no cross-profile note when the slice is your own', () => {
        const block = formatHistoryBlock(ref({ profile: 'dev-vsc' }), messages, 'dev-vsc');
        const lines = block.split('\n');

        assert.strictEqual(lines[0], '[From conversation: Secondant 01]');
        assert.ok(block.includes('Session: @session:dev-vsc/h-1'));
        assert.ok(block.includes('Span: '));
        assert.ok(block.includes('Hint: '), 'the attach path gained the reading hint');
        assert.ok(!block.includes('Note: '), 'no grant to state inside one profile');
    });

    it('keeps the note when the reader is another profile', () => {
        const block = formatHistoryBlock(ref({ profile: 'pa' }), messages, 'dev-vsc');
        assert.ok(block.includes('Note: '));
    });

    it('round-trips: the advice lines are not content', () => {
        const block = formatHistoryBlock(ref(), messages, 'pa');
        const { blocks } = parseHistoryBlocks(`${block}\n\nmy own words`);

        assert.strictEqual(blocks.length, 1);
        const body = blocks[0].body.split('\n');
        assert.ok(!body.some(line => /^(Note|Hint): /.test(line)), 'advice stays out of the body');
        assert.strictEqual(blocks[0].ref.sessionId, 'h-1');
        assert.deepStrictEqual(blocks[0].ref.messageIds, [41, 42]);
    });
});
