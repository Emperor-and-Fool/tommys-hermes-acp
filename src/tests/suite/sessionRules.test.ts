import * as assert from 'assert';
import {
    hermesSessionIdFor,
    normalizeStickyOrder,
    stickSession,
    registerSession,
    reorderSessions,
} from '../../host/workspace/sessionTab';
import { moveTabIntoProject, moveTabToProject, moveTabToWorkspace, projectsInWorkspace, tabsInWorkspace, workspaceOwnsCwd } from '../../host/workspace/projectRules';
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
        const added = registerSession([], { id: 'b', title: 'New chat', now: 50, workspaceId: '/proj/x' });
        assert.strictEqual(added[0].workspaceId, '/proj/x');
    });

    it('records nothing when the window has no workspace', () => {
        const added = registerSession([], { id: 'b', title: 'New chat', now: 50, workspaceId: '' });
        assert.deepStrictEqual(Object.keys(added[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);
    });
});

describe('moveTabToWorkspace', () => {
    it('writes the tag and leaves the other records alone', () => {
        const sessions = [session('a'), session('b', { workspaceId: '/old' })];
        const moved = moveTabToWorkspace(sessions, 'b', '/new');
        assert.strictEqual(moved[1].workspaceId, '/new');
        assert.strictEqual(sessions[1].workspaceId, '/old', 'the input is not mutated');
        assert.strictEqual(moved[0], sessions[0], 'an untouched record is the same object');
    });

    it('is a no-op for an unknown tab, an empty workspace, or the one it already has', () => {
        const sessions = [session('a', { workspaceId: '/w' })];
        assert.strictEqual(moveTabToWorkspace(sessions, 'nope', '/w'), sessions);
        assert.strictEqual(moveTabToWorkspace(sessions, 'a', ''), sessions);
        assert.strictEqual(moveTabToWorkspace(sessions, 'a', '/w'), sessions);
    });
});

describe('moveTabToProject', () => {
    it('files a tab under a project id and leaves the rest alone', () => {
        const sessions = [session('a'), session('b')];
        const filed = moveTabToProject(sessions, 'b', 'f1');
        assert.strictEqual(filed[1].project, 'f1');
        assert.strictEqual(sessions[1].project, undefined, 'the input is not mutated');
        assert.strictEqual(filed[0], sessions[0]);
    });

    it('puts a tab back on the plane with an empty id, dropping the field', () => {
        const sessions = [session('a', { project: 'f1' })];
        const cleared = moveTabToProject(sessions, 'a', '');
        assert.ok(!('project' in cleared[0]), 'absent stays absent, so the file stays small');
    });

    it('is a no-op for an unknown tab, or one already where it was asked to go', () => {
        const sessions = [session('a', { project: 'f1' }), session('b')];
        assert.strictEqual(moveTabToProject(sessions, 'nope', 'f1'), sessions);
        assert.strictEqual(moveTabToProject(sessions, 'a', 'f1'), sessions);
        assert.strictEqual(moveTabToProject(sessions, 'b', ''), sessions);
    });
});

describe('tabsInWorkspace', () => {
    it("keeps only the tabs this window owns", () => {
        const tabs = [session('a', { workspaceId: '/w1' }), session('b', { workspaceId: '/w2' }), session('c', { workspaceId: '/w1' })];
        assert.deepStrictEqual(tabsInWorkspace(tabs, '/w1').map(t => t.id), ['a', 'c']);
    });

    it('treats an untagged tab and a window with no workspace as the same place', () => {
        const tabs = [session('a', { workspaceId: '/w1' }), session('c')];
        assert.deepStrictEqual(tabsInWorkspace(tabs, '').map(t => t.id), ['c'], 'the window with no folder owns the untagged tab');
        assert.deepStrictEqual(tabsInWorkspace(tabs, '/w1').map(t => t.id), ['a']);
    });
});

describe('moveTabIntoProject', () => {
    it("moves the tab into the project's workspace as well, and does not touch the input", () => {
        const tabs = [session('a', { workspaceId: '/w1' })];
        const moved = moveTabIntoProject(tabs, 'a', { id: 'p1', name: 'One', workspaceId: '/w2' });
        assert.strictEqual(moved[0].project, 'p1');
        assert.strictEqual(moved[0].workspaceId, '/w2');
        assert.strictEqual(tabs[0].workspaceId, '/w1', 'the input array is untouched');
        assert.strictEqual(tabs[0].project, undefined);
    });
});

describe('workspaceOwnsCwd', () => {
    it('claims a cwd inside a workspace root', () => {
        assert.strictEqual(workspaceOwnsCwd('/repos/a', '/repos/a'), true);
        assert.strictEqual(workspaceOwnsCwd('/repos/a', '/repos/a/sub/'), true);
    });

    it('does not claim a sibling or a parent', () => {
        assert.strictEqual(workspaceOwnsCwd('/repos/a', '/repos/ab'), false);
        assert.strictEqual(workspaceOwnsCwd('/repos/a', '/repos'), false);
        assert.strictEqual(workspaceOwnsCwd('/repos/a', undefined), false);
    });

    it('reads a .code-workspace file as the folder that holds it', () => {
        assert.strictEqual(workspaceOwnsCwd('/repos/a/a.code-workspace', '/repos/a'), true);
        assert.strictEqual(workspaceOwnsCwd('/repos/a/a.code-workspace', '/repos/b'), false);
    });
});

describe('projectsInWorkspace', () => {
    it('hands a window only the projects named against its workspace', () => {
        const projects = [
            { id: 'p1', name: 'Here', workspaceId: '/w1' },
            { id: 'p2', name: 'Elsewhere', workspaceId: '/w2' },
            { id: 'p3', name: 'Nowhere', workspaceId: '' },
        ];
        assert.deepStrictEqual(projectsInWorkspace(projects, '/w1').map(p => p.id), ['p1']);
        assert.deepStrictEqual(projectsInWorkspace(projects, '/w2').map(p => p.id), ['p2']);
    });

    it('gives the projects with no workspace to the window that has none', () => {
        const projects = [
            { id: 'p1', name: 'Here', workspaceId: '/w1' },
            { id: 'p3', name: 'Nowhere', workspaceId: '' },
        ];
        assert.deepStrictEqual(projectsInWorkspace(projects, '').map(p => p.id), ['p3']);
    });
});

describe('a new tab is born where the work is', () => {
    it('lands in the project that was in use, and has no project field otherwise', () => {
        const inside = registerSession([], { id: 'a', title: 'One', project: 'p1' });
        assert.strictEqual(inside.length, 1);
        assert.strictEqual(inside[0].project, 'p1');

        const onThePlane = registerSession([], { id: 'b', title: 'Two' });
        assert.ok(!('project' in onThePlane[0]), 'absent stays absent');
    });
});
