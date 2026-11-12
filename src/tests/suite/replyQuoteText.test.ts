import { describe, it } from 'mocha';
import assert from 'assert';

import { formatReplyQuote, parseReplyQuote } from '../../shared/replyQuoteText';

describe('reply quote text', () => {
    it('writes the block the agent receives, then the user words', () => {
        const text = formatReplyQuote([{ role: 'dev-vsc@HermesHomeBase', text: 'the quoted line' }], 'my answer');
        assert.strictEqual(
            text,
            '[replying-to]\n--- dev-vsc@HermesHomeBase ---\nthe quoted line\n[/replying-to]\n\nmy answer'
        );
    });

    it('reads a quote back, leaving the user words as the rest', () => {
        const text = formatReplyQuote([{ role: 'dev-vsc@HermesHomeBase', text: 'the quoted line' }], 'my answer');
        assert.deepEqual(parseReplyQuote(text), {
            segments: [{ role: 'dev-vsc@HermesHomeBase', text: 'the quoted line' }],
            rest: 'my answer',
        });
    });

    it('keeps every segment of a multi-message quote, in order', () => {
        const text = formatReplyQuote(
            [
                { role: 'you', text: 'first' },
                { role: 'dev-vsc@HermesHomeBase', text: 'second' },
            ],
            ''
        );
        assert.deepEqual(parseReplyQuote(text), {
            segments: [
                { role: 'you', text: 'first' },
                { role: 'dev-vsc@HermesHomeBase', text: 'second' },
            ],
            rest: '',
        });
    });

    it('keeps a multi-line quote inside its own segment', () => {
        const text = formatReplyQuote([{ role: 'agent', text: 'line one\nline two' }], 'reply');
        assert.deepEqual(parseReplyQuote(text).segments[0].text, 'line one\nline two');
    });

    it('leaves a message without the markers exactly as it is', () => {
        assert.deepEqual(parseReplyQuote('just words'), { segments: [], rest: 'just words' });
        assert.deepEqual(parseReplyQuote(''), { segments: [], rest: '' });
    });

    it('does not eat a message whose block never closes', () => {
        const text = '[replying-to]\n--- agent ---\nquote that never ends';
        assert.deepEqual(parseReplyQuote(text), { segments: [], rest: text });
    });

    it('does not read a block that closes but carries no segment header', () => {
        const text = '[replying-to]\nprose only\n[/replying-to]\n\nmy answer';
        assert.deepEqual(parseReplyQuote(text), { segments: [], rest: text });
    });
});
