import * as assert from 'assert';
import {
    backfillAgentEngaged,
    hermesSessionIdFor,
    markAgentEngaged,
    normalizePinnedOrder,
    pinSession,
    registerSession,
    reorderSessions,
} from '../../tabs/tabs';
import type { ChatMessage, SessionInfo } from '../../types/chat';

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    ...over,
});

const message = (role: string): ChatMessage => ({ role, text: 'x', timestamp: 1 });

describe('session rules', () => {
    it('registers a tab once, at the front', () => {
        const sessions = [session('a')];
        const added = registerSession(sessions, { id: 'b', title: 'New chat', messageCount: 0, now: 50 });
        assert.deepStrictEqual(added.map(s => s.id), ['b', 'a']);
        assert.strictEqual(registerSession(added, { id: 'b', title: 'ignored', messageCount: 9 }), added);
    });

    it('marks the agent engaged only once', () => {
        const sessions = [session('a')];
        assert.strictEqual(markAgentEngaged(sessions, 'a', 99), true);
        assert.strictEqual(sessions[0].agentEngaged, true);
        assert.strictEqual(sessions[0].updatedAt, 99);
        assert.strictEqual(markAgentEngaged(sessions, 'a'), false, 'the second call has nothing to persist');
        assert.strictEqual(markAgentEngaged(sessions, 'missing'), false);
    });

    it('backfills from the transcript, and answers false when there is none', () => {
        const answered = backfillAgentEngaged(session('a'), [message('user'), message('assistant')]);
        assert.strictEqual(answered.agentEngaged, true);
        assert.strictEqual(backfillAgentEngaged(session('b'), [message('user')]).agentEngaged, false);
        assert.strictEqual(backfillAgentEngaged(session('c'), null).agentEngaged, false);
        const already = backfillAgentEngaged(session('d', { agentEngaged: true }), [message('user')]);
        assert.strictEqual(already.agentEngaged, true);
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
