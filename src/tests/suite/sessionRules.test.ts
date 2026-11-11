import * as assert from 'assert';
import {
    hermesSessionIdFor,
    moveSessionToFolder,
    moveSessionToWorkspace,
    normalizeStickyOrder,
    stickSession,
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

    it('keeps sticky tabs in front when normalising', () => {
        const sessions = [session('a'), session('p', { sticky: true }), session('b')];
        assert.deepStrictEqual(normalizeStickyOrder(sessions).map(s => s.id), ['p', 'a', 'b']);
    });

    it('sticks by the one order rule: sticky first, then the most recently touched', () => {
        const sessions = [session('p1', { sticky: true, updatedAt: 1 }), session('a', { updatedAt: 1 }), session('b')];

        const sticky = stickSession(sessions, 'a', 10);
        assert.deepStrictEqual(sticky.map(s => s.id), ['a', 'p1', 'b'], 'the tab just sticky goes to the front');
        assert.strictEqual(sticky[0].updatedAt, 10);
        assert.strictEqual(sticky[0].sticky, true);

        const unsticky = stickSession(sticky, 'a', 11);
        assert.deepStrictEqual(unsticky.map(s => s.id), ['p1', 'a', 'b'], 'unsticky, it lands by recency');
        assert.strictEqual(unsticky[1].sticky, false);

        assert.strictEqual(stickSession(sessions, 'missing'), sessions, 'unknown id changes nothing');
    });

    it('applies the order the strip reported, ignores what it cannot place, and keeps sticky tabs in front', () => {
        const sessions = [session('a'), session('b'), session('p', { sticky: true })];
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

describe('registerSession: the workspace tag', () => {
    it('records the workspace the tab was opened in', () => {
        const added = registerSession([], { id: 'b', title: 'New chat', now: 50, workspace: '/proj/x' });
        assert.strictEqual(added[0].workspace, '/proj/x');
    });

    it('records nothing when the window has no workspace', () => {
        const added = registerSession([], { id: 'b', title: 'New chat', now: 50, workspace: '' });
        assert.deepStrictEqual(Object.keys(added[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);
    });
});

describe('moveSessionToWorkspace', () => {
    it('writes the tag and leaves the other records alone', () => {
        const sessions = [session('a'), session('b', { workspace: '/old' })];
        const moved = moveSessionToWorkspace(sessions, 'b', '/new');
        assert.strictEqual(moved[1].workspace, '/new');
        assert.strictEqual(sessions[1].workspace, '/old', 'the input is not mutated');
        assert.strictEqual(moved[0], sessions[0], 'an untouched record is the same object');
    });

    it('is a no-op for an unknown tab, an empty workspace, or the one it already has', () => {
        const sessions = [session('a', { workspace: '/w' })];
        assert.strictEqual(moveSessionToWorkspace(sessions, 'nope', '/w'), sessions);
        assert.strictEqual(moveSessionToWorkspace(sessions, 'a', ''), sessions);
        assert.strictEqual(moveSessionToWorkspace(sessions, 'a', '/w'), sessions);
    });
});

describe('moveSessionToFolder', () => {
    it('files a tab under a folder id and leaves the rest alone', () => {
        const sessions = [session('a'), session('b')];
        const filed = moveSessionToFolder(sessions, 'b', 'f1');
        assert.strictEqual(filed[1].folder, 'f1');
        assert.strictEqual(sessions[1].folder, undefined, 'the input is not mutated');
        assert.strictEqual(filed[0], sessions[0]);
    });

    it('puts a tab back on the plane with an empty id, dropping the field', () => {
        const sessions = [session('a', { folder: 'f1' })];
        const cleared = moveSessionToFolder(sessions, 'a', '');
        assert.ok(!('folder' in cleared[0]), 'absent stays absent, so the file stays small');
    });

    it('is a no-op for an unknown tab, or one already where it was asked to go', () => {
        const sessions = [session('a', { folder: 'f1' }), session('b')];
        assert.strictEqual(moveSessionToFolder(sessions, 'nope', 'f1'), sessions);
        assert.strictEqual(moveSessionToFolder(sessions, 'a', 'f1'), sessions);
        assert.strictEqual(moveSessionToFolder(sessions, 'b', ''), sessions);
    });
});
