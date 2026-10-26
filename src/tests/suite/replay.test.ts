import * as assert from 'assert';
import { buildReplayMessages } from '../../host/cache/replay';
import { formatHistoryBlock } from '../../host/chat/historyAttach';

describe('buildReplayMessages', () => {
    it('drops empty records and keeps the order', () => {
        const messages = buildReplayMessages([
            { role: 'user', text: 'question' },
            { role: 'assistant', text: '   ' },
            { role: 'assistant', text: 'reply' },
        ], 1000);
        assert.deepStrictEqual(messages.map(m => m.role), ['user', 'assistant']);
        assert.deepStrictEqual(messages.map(m => m.timestamp), [1000, 1001]);
    });

    it('collapses a tool start and its completion into one card', () => {
        const messages = buildReplayMessages([
            { role: 'tool', text: 'starting', toolCallId: 't1' },
            { role: 'user', text: 'in between' },
            { role: 'tool', text: 'finished', toolCallId: 't1' },
        ], 1);
        assert.strictEqual(messages.length, 2, 'one tool card, not two');
        assert.strictEqual(messages[0].text, 'finished', 'the completion replaces the start text');
        assert.strictEqual(messages[0].toolCallId, 't1');
        assert.strictEqual(messages[1].text, 'in between');
    });

    it('keeps two different tool calls apart', () => {
        const messages = buildReplayMessages([
            { role: 'tool', text: 'a', toolCallId: 't1' },
            { role: 'tool', text: 'b', toolCallId: 't2' },
        ], 1);
        assert.strictEqual(messages.length, 2);
        assert.deepStrictEqual(messages.map(m => m.toolCallId), ['t1', 't2']);
    });

    it('answers an empty list for a replay with nothing in it', () => {
        assert.deepStrictEqual(buildReplayMessages([], 1), []);
        assert.deepStrictEqual(buildReplayMessages([{ role: 'user', text: '' }], 1), []);
    });

    it('splits an attached history block out of a replayed user message', () => {
        const block = formatHistoryBlock(
            { sessionId: 'sess-1', title: 'Earlier work', count: 0, from: 0, to: 0 },
            [
                { role: 'user', text: 'hi', timestamp: 10 },
                { role: 'assistant', text: 'hello', timestamp: 11 },
            ]
        );
        const messages = buildReplayMessages([{ role: 'user', text: `${block}\n\nWhat changed?` }], 5);
        assert.deepStrictEqual(messages.map(m => m.role), ['history', 'user']);
        assert.strictEqual(messages[0].history?.sessionId, 'sess-1');
        assert.strictEqual(messages[0].history?.count, 2);
        assert.strictEqual(messages[1].text, 'What changed?');
    });
});
