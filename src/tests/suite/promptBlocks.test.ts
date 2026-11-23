/**
 * What one turn sends, and in which order.
 *
 * Composed in the turn's own runner since 2026-11-22 (it used to be built in `app.ts`): the
 * attached conversation, the tree notice, the user's own text, then one image block per image. The
 * order is the contract — the agent reads the conversation before the question it belongs to, and
 * an image is never split from the text that goes with it.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { PromptRunner } from '../../host/chat/promptRunner';
import type { PromptHost } from '../../host/chat/promptRunner';

/** A runner whose client records exactly what was handed to `sendMessage`. */
const harness = (blocks: { history?: string; tree?: string } = {}) => {
    const sent: unknown[] = [];
    const host = {
        acp: () => ({
            status: 'ready',
            sendMessage: async (prompt: unknown) => { sent.push(prompt); },
        }),
        historyBlock: () => blocks.history ?? '',
        treeBlock: () => blocks.tree ?? '',
    } as unknown as PromptHost;
    return { runner: new PromptRunner(host), sent };
};

type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; mimeType: string; data: string };

describe('the blocks a turn sends', () => {
    it('a turn with nothing to wrap is sent as its text alone', async () => {
        const { runner, sent } = harness();
        await runner.sendUserTurn('tab-a', 'hello');
        assert.deepStrictEqual(sent, ['hello'], 'a plain string, not a one-block array');
    });

    it('keeps the order: the conversation, the tree, the text, then the images', async () => {
        const { runner, sent } = harness({ history: 'CONVERSATION', tree: 'TREE' });
        await runner.sendUserTurn('tab-a', 'my question', [
            { mimeType: 'image/jpeg', data: 'AAA' },
            { data: 'BBB' },
        ]);

        assert.strictEqual(sent.length, 1);
        const blocks = sent[0] as Array<TextBlock | ImageBlock>;
        assert.deepStrictEqual(blocks, [
            { type: 'text', text: 'CONVERSATION' },
            { type: 'text', text: 'TREE' },
            { type: 'text', text: 'my question' },
            { type: 'image', mimeType: 'image/jpeg', data: 'AAA' },
            { type: 'image', mimeType: 'image/png', data: 'BBB' },
        ], 'an image without a type is a PNG');
    });

    it('an image on its own still makes a turn of blocks, without an empty text block', async () => {
        const { runner, sent } = harness();
        await runner.sendUserTurn('tab-a', '', [{ mimeType: 'image/png', data: 'AAA' }]);

        const blocks = sent[0] as Array<TextBlock | ImageBlock>;
        assert.deepStrictEqual(blocks, [{ type: 'image', mimeType: 'image/png', data: 'AAA' }]);
    });

    it('a notice alone is a turn of blocks: the tree line is what the agent needs', async () => {
        const { runner, sent } = harness({ tree: 'TREE' });
        await runner.sendUserTurn('tab-a', 'question');

        const blocks = sent[0] as Array<TextBlock | ImageBlock>;
        assert.deepStrictEqual(blocks.map(block => block.type), ['text', 'text']);
    });
});
