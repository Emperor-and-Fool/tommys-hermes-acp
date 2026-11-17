import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/cache/sessions';
import { TabStore } from '../../host/workspace/store';
import { TabLifecycle, TabLifecycleHost } from '../../host/workspace/lifecycle';
import { t } from '../../host/i18n';
import type { HostToPane } from '../../shared/webview';

/**
 * A tab bound to a Hermes session that cannot be replayed has to say so. Painting nothing instead is
 * indistinguishable from a conversation that is genuinely empty, which is how a failed load was being
 * read as data loss.
 */
describe('tab switch: a session that will not replay', () => {
    it('posts the failure instead of an empty transcript', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-replay-'));
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => '',
            knownWorkspaceIds: () => [],
        }, new TabStore(dir, 'scope'));
        session.activeId = 'tab-a';
        session.tabs = [
            { id: 'tab-a', title: 'A', createdAt: 0, updatedAt: 0, hermesSessionId: 'hermes-a' },
            { id: 'tab-b', title: 'B', createdAt: 0, updatedAt: 0, hermesSessionId: 'hermes-b' },
        ];

        const posted: HostToPane[] = [];
        const host = {
            acp: () => ({
                activeSessionId: 'hermes-a',
                status: 'ready',
                loadSession: async () => {
                    throw new Error('the adapter refused the load');
                },
            }),
            session,
            post: (msg: HostToPane) => {
                posted.push(msg);
            },
            postTo: (_surface: unknown, msg: HostToPane) => {
                posted.push(msg);
            },
            log: () => {},
            resolveCwd: () => dir,
            profile: () => 'test',
            attachments: { hydrateImages: () => [] },
            promptSessionId: () => undefined,
            detachActivePrompt: async () => {},
            otherSessionIsPrompting: () => false,
            syncModelStateForCurrentSession: async () => {},
            syncPromptUiIfReturningToOwner: () => {},
            snapshotModelFromProfile: () => {},
            saveCatalog: () => true,
            saveCurrent: () => {},
            ensureRegistered: () => {},
            postSessionList: () => {},
            postHistoryState: () => {},
            dropHistoryStage: () => {},
            activate: () => {},
            workspaceState: { get: () => undefined, update: () => Promise.resolve() },
        } as unknown as TabLifecycleHost;

        await new TabLifecycle(host).switchTo('tab-b');

        const said = posted.filter(m => m.type === 'addMessage');
        assert.strictEqual(said.length, 1, 'exactly one line explains the empty pane');
        assert.strictEqual((said[0] as { text: string }).text, t('sessionReplayFailed'));
        assert.strictEqual(
            posted.filter(m => m.type === 'restoreHistory').length,
            0,
            'the transcript is left alone rather than repainted empty'
        );

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

/**
 * A tab moved to another workspace belongs to that workspace's folder: the tab's recorded cwd is a
 * mirror of what Hermes reported, not a decision. Loading it with the new workspace's cwd is also
 * what moves the session (session/load with a different cwd moves it).
 */
describe('tab move: the workspace cwd decides, not the tab record', () => {
    it('loads a moved tab with this window\'s cwd and not the recorded one', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-move-'));
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => '/work/new',
            knownWorkspaceIds: () => ['/work/new'],
        }, new TabStore(dir, 'scope'));
        session.activeId = 'tab-moved';
        session.tabs = [
            { id: 'tab-moved', title: 'Moved', createdAt: 0, updatedAt: 0,
              hermesSessionId: 'hermes-moved', cwd: '/work/old' },
        ];

        const loaded: Array<{ cwd: string; sessionId: string }> = [];
        const host = {
            acp: () => ({
                activeSessionId: 'hermes-elsewhere',
                status: 'ready',
                loadSession: async (cwd: string, sessionId: string) => {
                    loaded.push({ cwd, sessionId });
                },
            }),
            session,
            post: () => {},
            postTo: () => {},
            log: () => {},
            resolveCwd: () => '/work/new',
            profile: () => 'test',
            attachments: { hydrateImages: () => [] },
            promptSessionId: () => undefined,
            detachActivePrompt: async () => {},
            otherSessionIsPrompting: () => false,
            syncModelStateForCurrentSession: async () => {},
            syncPromptUiIfReturningToOwner: () => {},
            snapshotModelFromProfile: () => {},
            saveCatalog: () => true,
            saveCurrent: () => {},
            ensureRegistered: () => {},
            postSessionList: () => {},
            postHistoryState: () => {},
            dropHistoryStage: () => {},
            activate: () => {},
            workspaceState: { get: () => undefined, update: () => Promise.resolve() },
        } as unknown as TabLifecycleHost;

        await new TabLifecycle(host).resumeTabHermesSession('tab-moved');

        assert.deepStrictEqual(loaded, [{ cwd: '/work/new', sessionId: 'hermes-moved' }],
            'the new workspace\'s cwd is what Hermes is given');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
