import * as assert from 'assert';
import { matchMessageIds } from '../../host/chat/historyLookup';
import type { ChatMessage } from '../../shared/chat';

function msg(role: string, text: string): ChatMessage {
    return { role, text, timestamp: 0 };
}

describe('matchMessageIds', () => {
    it('matches a string content and reports the real span in ms', () => {
        const { ids, from, to } = matchMessageIds([msg('user', 'hello there')], [
            { id: 3, role: 'user', content: 'hello  there', timestamp: 1600000000.5 },
        ]);
        assert.deepStrictEqual(ids, [3]);
        assert.strictEqual(from, 1600000000500);
        assert.strictEqual(to, 1600000000500);
    });

    it('flattens a list content', () => {
        const { ids } = matchMessageIds([msg('assistant', 'two parts')], [
            {
                id: 9,
                role: 'assistant',
                content: [
                    { type: 'text', text: 'two ' },
                    { type: 'text', text: 'parts' },
                ],
            },
        ]);
        assert.deepStrictEqual(ids, [9]);
    });

    it('joins parts by newline, as the replay does, and reads content-style parts', () => {
        const { ids } = matchMessageIds([msg('user', 'first block\nmy question')], [
            {
                id: 11,
                role: 'user',
                content: [
                    { type: 'text', text: 'first block' },
                    { type: 'text', content: 'my question' },
                ],
            },
        ]);
        assert.deepStrictEqual(ids, [11]);
    });

    it('takes the occurrence closest to the end when the text repeats', () => {
        const exported = [
            { id: 1, role: 'user', content: 'same', timestamp: 1 },
            { id: 2, role: 'assistant', content: 'reply', timestamp: 2 },
            { id: 3, role: 'user', content: 'same', timestamp: 3 },
        ];
        const { ids, from } = matchMessageIds([msg('user', 'same')], exported);
        assert.deepStrictEqual(ids, [3]);
        assert.strictEqual(from, 3000);
    });

    it('leaves an unmatched line null and reports no span', () => {
        const { ids, from, to } = matchMessageIds([msg('user', 'not in there')], [
            { id: 1, role: 'user', content: 'something else', timestamp: 5 },
        ]);
        assert.deepStrictEqual(ids, [null]);
        assert.strictEqual(from, undefined);
        assert.strictEqual(to, undefined);
    });
});
