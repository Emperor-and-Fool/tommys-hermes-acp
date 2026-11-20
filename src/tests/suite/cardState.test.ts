import { describe, it } from 'mocha';
import assert from 'assert';
import { CardState } from '../../pane/components/permissions/cardState';

/** The slice holds whatever the card feature puts in it: these tests put a named object. */
type Group = { id: string };

/** The card feature's slice: what waits, what was answered, and what a rebuild forgets. */
describe('permission card state', () => {
    it('a waiting card is findable, and stops waiting when answered', () => {
        const cards = new CardState<Group>();
        const group: Group = { id: 'card-1' };

        cards.open('perm_1', group);
        assert.strictEqual(cards.isPending('perm_1'), true);
        assert.strictEqual(cards.group('perm_1'), group);

        cards.close('perm_1');
        assert.strictEqual(cards.isPending('perm_1'), false);
        assert.strictEqual(cards.group('perm_1'), undefined);
        assert.strictEqual(cards.isAnswered('perm_1'), true, 'the answer is remembered');
    });

    it('answers only what it saw, so a replayed card still asks', () => {
        const cards = new CardState<Group>();
        assert.strictEqual(cards.isAnswered('perm_never_seen'), false);
    });

    it('reaches every waiting card, and only those', () => {
        const cards = new CardState<Group>();
        const seen: string[] = [];
        cards.open('a', { id: 'group' });
        cards.open('b', { id: 'group' });
        cards.close('b');

        cards.eachPending((_group, id) => seen.push(id));
        assert.deepStrictEqual(seen, ['a']);
    });

    it('a rebuilt transcript clears what waited but keeps what was answered', () => {
        const cards = new CardState<Group>();
        cards.open('a', { id: 'group' });
        cards.close('b');

        cards.clear();
        assert.strictEqual(cards.isPending('a'), false);
        assert.strictEqual(cards.isAnswered('b'), true);

        cards.reset();
        assert.strictEqual(cards.isAnswered('b'), false, 'a fresh start forgets everything');
    });
});
