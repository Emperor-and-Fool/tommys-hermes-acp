import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/cache/sessions';
import { TabStore } from '../../host/workspace/store';

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
