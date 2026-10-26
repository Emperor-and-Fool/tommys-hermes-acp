import * as assert from 'assert';
import {
    MAX_HISTORY_MESSAGES,
    HistoryAttach,
    formatHistoryBlock,
    parseHistoryBlocks,
} from '../../host/chat/historyAttach';
import type { ChatMessage, HistoryRef } from '../../shared/chat';

function ref(over: Partial<HistoryRef> = {}): HistoryRef {
    return { sessionId: 'sess-1', title: 'Earlier work', count: 0, from: 0, to: 0, ...over };
}

function msg(role: string, text: string, timestamp: number): ChatMessage {
    return { role, text, timestamp };
}

describe('history attach', () => {
    it('round trips a block through the marker', () => {
        const block = formatHistoryBlock(ref(), [msg('user', 'why is it slow?', 10), msg('assistant', 'the loop is O(n^2)', 11)]);
        const parsed = parseHistoryBlocks(block);
        assert.strictEqual(parsed.blocks.length, 1);
        assert.deepStrictEqual(parsed.blocks[0].ref, {
            sessionId: 'sess-1',
            title: 'Earlier work',
            count: 2,
            from: 10,
            to: 11,
        });
        assert.strictEqual(parsed.blocks[0].body, 'user: why is it slow?\nassistant: the loop is O(n^2)');
        assert.strictEqual(parsed.rest, '');
    });

    it('caps an attach at the message limit', () => {
        const many = Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`, i));
        const parsed = parseHistoryBlocks(formatHistoryBlock(ref(), many));
        assert.strictEqual(parsed.blocks[0].ref.count, MAX_HISTORY_MESSAGES);
        assert.strictEqual(parsed.blocks[0].body.split('\n').length, MAX_HISTORY_MESSAGES);
        assert.strictEqual(parsed.blocks[0].ref.to, MAX_HISTORY_MESSAGES - 1);
    });

    it('leaves the user text after a block as the rest', () => {
        const block = formatHistoryBlock(ref(), [msg('user', 'earlier', 1)]);
        const parsed = parseHistoryBlocks(`${block}\n\nWhat changed since?`);
        assert.strictEqual(parsed.blocks.length, 1);
        assert.strictEqual(parsed.rest, 'What changed since?');
    });

    it('stages a selection, reports it, and clears it', () => {
        const attach = new HistoryAttach();
        assert.strictEqual(attach.block(), '');
        const staged = attach.stage(ref(), [msg('user', 'a', 5), msg('assistant', 'b', 6)]);
        assert.strictEqual(staged.ref.count, 2);
        assert.strictEqual(staged.ref.from, 5);
        assert.strictEqual(attach.count, 2);
        assert.ok(attach.block().startsWith('[From conversation: Earlier work]'));
        attach.clear();
        assert.strictEqual(attach.count, 0);
        assert.strictEqual(attach.block(), '');
    });
});
