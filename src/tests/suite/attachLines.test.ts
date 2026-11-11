import { describe, it } from 'mocha';
import assert from 'assert';

import { parseAttachLines } from '../../shared/attachLines';

describe('parseAttachLines', () => {
    it('reads one message per line, with the Hermes id when there is one', () => {
        const body = 'user #343156: how do we fix the pane?\nassistant #343157: the refocus runs first';
        assert.deepEqual(parseAttachLines(body), [
            { role: 'user', id: 343156, text: 'how do we fix the pane?' },
            { role: 'assistant', id: 343157, text: 'the refocus runs first' },
        ]);
    });

    it('keeps an unmatched message, which carries no id', () => {
        assert.deepEqual(parseAttachLines('user: no id here'), [
            { role: 'user', id: null, text: 'no id here' },
        ]);
    });

    it('keeps every role a transcript can carry, and its empty text', () => {
        const body = 'tool #7: \nthought #8: hmm\npermission #9: allow?\nsystem #10: note';
        assert.deepEqual(parseAttachLines(body).map(line => [line.role, line.id, line.text]), [
            ['tool', 7, ''],
            ['thought', 8, 'hmm'],
            ['permission', 9, 'allow?'],
            ['system', 10, 'note'],
        ]);
    });

    it('treats a line that is not a role line as a continuation', () => {
        const body = 'assistant #5: first\nstill the same message';
        assert.deepEqual(parseAttachLines(body), [
            { role: 'assistant', id: 5, text: 'first\nstill the same message' },
        ]);
    });

    it('returns nothing for a body that never opens with a role line', () => {
        assert.deepEqual(parseAttachLines('Note: this is prose, not an attach'), []);
        assert.deepEqual(parseAttachLines(''), []);
        assert.deepEqual(parseAttachLines('   '), []);
    });

    it('does not read the first message out of a body that starts with prose', () => {
        assert.deepEqual(parseAttachLines('prose first\nuser #1: second'), []);
    });
});
