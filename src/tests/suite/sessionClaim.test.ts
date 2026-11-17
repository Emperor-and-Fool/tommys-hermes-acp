import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/workspace/sessions';
import { TabStore } from '../../host/workspace/store';
import type { HostToPane } from '../../shared/webview';

/**
 * Nothing claims a session for a window because its cwd happens to sit in one of the window's
 * folders. A session written before tags existed, or by the TUI or another surface, stays untagged
 * until the user opens it from Closed Sessions — that is the only way in.
 */
describe('sessions: an untagged tab is never claimed by its cwd', () => {
    it('leaves the tag absent however well the cwd fits this window', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-claim-'));
        const store = new TabStore(dir, 'scope');
        store.writeCatalog([
            // Written before workspaces had ids, its cwd inside this window's only folder.
            { id: 'tab-legacy', title: 'Legacy', createdAt: 0, updatedAt: 1,
              hermesSessionId: 'hermes-legacy', cwd: '/w/current/sub' } as never,
            // A tag the registry no longer holds: still not ours to rewrite.
            { id: 'tab-stale', title: 'Stale', createdAt: 0, updatedAt: 2,
              hermesSessionId: 'hermes-stale', cwd: '/w/current', workspaceId: 'gone' } as never,
        ]);

        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => 'current-window',
            knownWorkspaceIds: () => ['current-window'],
        }, store);
        session.init();

        const legacy = session.tabs.find(tab => tab.id === 'tab-legacy');
        const stale = session.tabs.find(tab => tab.id === 'tab-stale');
        assert.strictEqual(legacy?.workspaceId, undefined, 'an untagged tab stays untagged');
        assert.strictEqual(stale?.workspaceId, 'gone', 'an existing tag is never rewritten');
        assert.deepStrictEqual(session.tabsInWindow(), [], 'so this window shows neither');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

/**
 * What Closed Sessions offers: the rows Hermes hid, and every session no window owns — which is the
 * only way a session from the TUI, the CLI, Desktop or before tags existed becomes reachable.
 */
describe('sessions: what Closed Sessions lists', () => {
    it('offers untagged and stale-tagged sessions beside the hidden ones', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-unowned-'));
        const store = new TabStore(dir, 'scope');
        store.writeCatalog([
            { id: 'tab-mine', title: 'Mine', createdAt: 0, updatedAt: 3,
              hermesSessionId: 'hermes-mine', cwd: '/w/current', workspaceId: 'current-window' } as never,
            { id: 'tab-untagged', title: 'From the TUI', createdAt: 0, updatedAt: 4,
              hermesSessionId: 'hermes-untagged', cwd: '/w/elsewhere' } as never,
        ]);

        const posted: HostToPane[] = [];
        const session = new Sessions(dir, 'scope', {
            post: msg => posted.push(msg),
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => 'current-window',
            knownWorkspaceIds: () => ['current-window'],
        }, store);
        session.init();
        session.hiddenSessions = [{ sessionId: 'hermes-hidden', title: 'Closed', hidden: true,
                                    messageCount: 3, updatedAt: 5 }];
        session.postHidden();

        const msg = posted[posted.length - 1] as Extract<HostToPane, { type: 'hiddenSessions' }>;
        assert.deepStrictEqual(msg.sessions.map(row => row.sessionId).sort(),
            ['hermes-hidden', 'hermes-untagged'],
            'the window\'s own tab is not offered, the unowned session is');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

/** The other half of the rule: an untagged session is claimed only by opening it here. */
describe('sessions: opening one from Closed Sessions claims it', () => {
    const harness = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-claim-open-'));
        const store = new TabStore(dir, 'scope');
        store.writeCatalog([
            { id: 'tab-untagged', title: 'From the TUI', createdAt: 0, updatedAt: 4,
              hermesSessionId: 'hermes-untagged', cwd: '/w/elsewhere' } as never,
        ]);
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => 'current-window',
            knownWorkspaceIds: () => ['current-window'],
        }, store);
        session.init();
        return { dir, session };
    };

    it('tags it to this window and writes the index', () => {
        const { dir, session } = harness();
        assert.strictEqual(session.claim('tab-untagged'), true);
        assert.strictEqual(session.tabs[0].workspaceId, 'current-window');
        assert.strictEqual(session.tabsInWindow().length, 1, 'and it now appears here');
        const written = new TabStore(dir, 'scope').readCatalog();
        assert.strictEqual(written.find(tab => tab.id === 'tab-untagged')?.workspaceId, 'current-window');

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does nothing for a session that already belongs to a window', () => {
        const { dir, session } = harness();
        session.claim('tab-untagged');
        assert.strictEqual(session.claim('tab-untagged'), false, 'a second open changes nothing');
        assert.strictEqual(session.claim('nothing-here'), false);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
