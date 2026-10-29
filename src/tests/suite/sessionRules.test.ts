import * as assert from 'assert';
import {
    hermesSessionIdFor,
    normalizePinnedOrder,
    pinSession,
    registerSession,
    reorderSessions,
} from '../../host/tabs/tabs';
import type { SessionInfo } from '../../shared/chat';

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...over,
});

describe('session rules', () => {
    it('registers a tab once, at the front', () => {
        const sessions = [session('a')];
        const added = registerSession(sessions, { id: 'b', title: 'New chat', now: 50 });
        assert.deepStrictEqual(added.map(s => s.id), ['b', 'a']);
        assert.strictEqual(registerSession(added, { id: 'b', title: 'ignored' }), added);
        assert.deepStrictEqual(Object.keys(added[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt'], 'ids and titles only');
    });

    it('keeps pinned tabs in front when normalising', () => {
        const sessions = [session('a'), session('p', { pinned: true }), session('b')];
        assert.deepStrictEqual(normalizePinnedOrder(sessions).map(s => s.id), ['p', 'a', 'b']);
    });

    it('pins by the one order rule: pinned first, then the most recently touched', () => {
        const sessions = [session('p1', { pinned: true, updatedAt: 1 }), session('a', { updatedAt: 1 }), session('b')];

        const pinned = pinSession(sessions, 'a', 10);
        assert.deepStrictEqual(pinned.map(s => s.id), ['a', 'p1', 'b'], 'the tab just pinned goes to the front');
        assert.strictEqual(pinned[0].updatedAt, 10);
        assert.strictEqual(pinned[0].pinned, true);

        const unpinned = pinSession(pinned, 'a', 11);
        assert.deepStrictEqual(unpinned.map(s => s.id), ['p1', 'a', 'b'], 'unpinned, it lands by recency');
        assert.strictEqual(unpinned[1].pinned, false);

        assert.strictEqual(pinSession(sessions, 'missing'), sessions, 'unknown id changes nothing');
    });

    it('applies the order the strip reported, ignores what it cannot place, and keeps pins in front', () => {
        const sessions = [session('a'), session('b'), session('p', { pinned: true })];
        // Tabs the strip left out, ids it invented and ids it repeated are all survivable:
        // they are ignored or appended, never dropped.
        assert.deepStrictEqual(reorderSessions(sessions, ['a', 'b'])?.map(s => s.id), ['p', 'a', 'b']);
        assert.deepStrictEqual(reorderSessions(sessions, ['a', 'a', 'b', 'p'])?.map(s => s.id), ['p', 'a', 'b']);
        assert.deepStrictEqual(reorderSessions(sessions, ['zzz', 'b'])?.map(s => s.id), ['p', 'b', 'a']);
        assert.strictEqual(reorderSessions(sessions, []), null, 'an empty list is not an order');
        assert.deepStrictEqual(reorderSessions(sessions, ['b', 'p', 'a'])?.map(s => s.id), ['p', 'b', 'a']);
    });
});

describe('hermesSessionIdFor', () => {
    it('returns the Hermes id behind an adopted tab, not the local one', () => {
        const sessions = [session('local-1', { hermesSessionId: 'h-9' }), session('h-2')];
        assert.strictEqual(hermesSessionIdFor(sessions, 'local-1'), 'h-9');
    });

    it('falls back to the id when the tab is unknown or carries no Hermes id', () => {
        const sessions = [session('local-1', { hermesSessionId: 'h-9' })];
        assert.strictEqual(hermesSessionIdFor(sessions, 'h-2'), 'h-2');
    });
});
