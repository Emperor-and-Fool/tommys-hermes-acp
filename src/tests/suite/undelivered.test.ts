import * as assert from 'assert';
import { findUndelivered, lastUserMessageText } from '../../cache/undelivered';
import type { ChatMessage } from '../../types/chat';

const user = (text: string): ChatMessage => ({ role: 'user', text, timestamp: 1 });
const assistant = (text: string): ChatMessage => ({ role: 'assistant', text, timestamp: 2 });

describe('undelivered message', () => {
    it('finds the last user message in the mirror', () => {
        assert.strictEqual(lastUserMessageText([user('one'), assistant('ok'), user('two')]), 'two');
        assert.strictEqual(lastUserMessageText([]), null);
        assert.strictEqual(lastUserMessageText([assistant('only a reply')]), null);
        assert.strictEqual(lastUserMessageText([user('   ')]), null);
    });

    it('offers back a message the replay does not contain', () => {
        const last = lastUserMessageText([user('did you get this?')]);
        assert.strictEqual(findUndelivered(last, [user('earlier question'), assistant('reply')]), 'did you get this?');
    });

    it('stays quiet when the replay has the message, spaces aside', () => {
        const last = lastUserMessageText([user('  same text  ')]);
        assert.strictEqual(findUndelivered(last, [user('same text')]), null);
    });

    it('says nothing when there is no local user message', () => {
        assert.strictEqual(findUndelivered(null, [assistant('reply')]), null);
        assert.strictEqual(findUndelivered('   ', [assistant('reply')]), null);
    });
});
