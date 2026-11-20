import { describe, it } from 'mocha';
import assert from 'assert';
import { Signal } from '../../host/chat/signal';

describe('the signal', () => {
    it('tells every listener, and one that left hears nothing', () => {
        const signal = new Signal();
        const heard: string[] = [];
        const off = signal.on(() => heard.push('a'));
        signal.on(() => heard.push('b'));

        signal.fire();
        assert.deepStrictEqual(heard, ['a', 'b']);

        off();
        signal.fire();
        assert.deepStrictEqual(heard, ['a', 'b', 'b'], 'the listener that unsubscribed is not called');
    });

    it('a listener that throws does not stop the others', () => {
        const signal = new Signal();
        let reached = 0;
        signal.on(() => {
            throw new Error('boom');
        });
        signal.on(() => {
            reached += 1;
        });

        signal.fire();
        assert.strictEqual(reached, 1, 'the second listener still heard it');
    });

    it('a listener added while firing hears the next change, not this one', () => {
        const signal = new Signal();
        let late = 0;
        signal.on(() => {
            signal.on(() => {
                late += 1;
            });
        });

        signal.fire();
        assert.strictEqual(late, 0, 'the list it is firing was already read');
        signal.fire();
        assert.strictEqual(late, 1);
    });
});
