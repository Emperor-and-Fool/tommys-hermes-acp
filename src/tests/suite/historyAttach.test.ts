import * as assert from 'assert';
import {
    MAX_HISTORY_MESSAGES,
    HistoryAttach,
    blockMessageLines,
    formatHistoryBlock,
    parseHistoryBlocks,
} from '../../host/chat/historyAttach';
import type { ChatMessage, HistoryRef } from '../../shared/chat';

function ref(over: Partial<HistoryRef> = {}): HistoryRef {
    return { sessionId: 'sess-1', profile: 'dev', title: 'Earlier work', count: 0, messageIds: [], ...over };
}

function msg(role: string, text: string, timestamp: number): ChatMessage {
    return { role, text, timestamp };
}

describe('history attach', () => {
    it('round trips a block carrying real ids', () => {
        const block = formatHistoryBlock(ref({ messageIds: [41, 42], from: 1000, to: 2000 }), [
            msg('user', 'why is it slow?', 10),
            msg('assistant', 'the loop is O(n^2)', 11),
        ]);
        assert.ok(block.includes('Session: @session:dev/sess-1'));
        assert.ok(block.includes('Span: 1970-01-01T00:00:01.000Z → 1970-01-01T00:00:02.000Z'));
        assert.ok(!block.includes('Anchor:'));

        const parsed = parseHistoryBlocks(block);
        assert.strictEqual(parsed.blocks.length, 1);
        assert.deepStrictEqual(parsed.blocks[0].ref.messageIds, [41, 42]);
        assert.strictEqual(parsed.blocks[0].ref.profile, 'dev');
        assert.strictEqual(parsed.blocks[0].ref.sessionId, 'sess-1');
        assert.strictEqual(parsed.blocks[0].ref.count, 2);
        assert.strictEqual(parsed.blocks[0].ref.from, 1000);
        assert.strictEqual(parsed.blocks[0].ref.to, 2000);
        assert.strictEqual(parsed.blocks[0].body, 'user #41: why is it slow?\nassistant #42: the loop is O(n^2)');
        assert.strictEqual(parsed.rest, '');
    });

    it('falls back to an anchor when no id matched', () => {
        const block = formatHistoryBlock(ref(), [msg('user', 'why is it  slow?', 1)]);
        assert.ok(block.includes('Anchor: "why is it slow?"'));
        assert.ok(!block.includes('Span:'));

        const parsed = parseHistoryBlocks(block);
        assert.deepStrictEqual(parsed.blocks[0].ref.messageIds, [null]);
        assert.strictEqual(parsed.blocks[0].ref.anchor, 'why is it slow?');
        assert.strictEqual(parsed.blocks[0].ref.from, undefined);
        assert.strictEqual(parsed.blocks[0].body, 'user: why is it slow?');
    });

    it('marks only the lines that matched', () => {
        const block = formatHistoryBlock(ref({ messageIds: [7, null], from: 1000, to: 1000 }), [
            msg('user', 'a', 1),
            msg('assistant', 'b', 2),
        ]);
        assert.ok(block.includes('user #7: a'));
        assert.ok(block.includes('assistant: b'));
        assert.ok(block.includes('Span:'));
        assert.deepStrictEqual(parseHistoryBlocks(block).blocks[0].ref.messageIds, [7, null]);
    });

    it('caps an attach at the message limit', () => {
        const many = Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`, i));
        const parsed = parseHistoryBlocks(formatHistoryBlock(ref(), many));
        assert.strictEqual(parsed.blocks[0].ref.count, MAX_HISTORY_MESSAGES);
        assert.strictEqual(parsed.blocks[0].body.split('\n').length, MAX_HISTORY_MESSAGES);
    });

    it('leaves the user text after a block as the rest', () => {
        const block = formatHistoryBlock(ref(), [msg('user', 'earlier', 1)]);
        const parsed = parseHistoryBlocks(`${block}\n\nWhat changed since?`);
        assert.strictEqual(parsed.blocks.length, 1);
        assert.strictEqual(parsed.rest, 'What changed since?');
    });

    it('stages with looked-up ids, with an anchor without them, and clears', () => {
        const attach = new HistoryAttach();
        assert.strictEqual(attach.block(), '');

        const withIds = attach.stage(ref({ from: 5000, to: 6000 }), [msg('user', 'x', 1), msg('assistant', 'y', 2)], [11, 12]);
        assert.deepStrictEqual(withIds.ref.messageIds, [11, 12]);
        assert.strictEqual(withIds.ref.from, 5000);
        assert.ok(attach.block().includes('user #11: x'));

        const without = attach.stage(ref(), [msg('user', 'x', 1)]);
        assert.deepStrictEqual(without.ref.messageIds, [null]);
        assert.strictEqual(without.ref.from, undefined);
        assert.strictEqual(without.ref.anchor, 'x');

        attach.clear();
        assert.strictEqual(attach.count, 0);
        assert.strictEqual(attach.block(), '');
    });

    it('blockMessageLines is exactly what the block carries, ids and all', () => {
        const picked = [msg('user', 'x', 1), msg('assistant', 'y', 2)];
        assert.deepStrictEqual(blockMessageLines(ref({ messageIds: [11, null] }), picked), ['user #11: x', 'assistant: y']);
        const block = formatHistoryBlock(ref({ messageIds: [11, null] }), picked);
        for (const line of blockMessageLines(ref({ messageIds: [11, null] }), picked)) {
            assert.ok(block.includes(line));
        }
    });
});
