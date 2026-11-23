/**
 * A connect whose catalog goes unanswered leaves the tabs exactly as they are.
 *
 * `_session/catalog` failing is not the profile being empty. Before this, the connect read the
 * failure as "no sessions", concluded that every remembered id was gone ("which this profile no
 * longer lists") and left the tab unbound — with nothing on screen saying why. The catalog is
 * unknown, not empty, and an unknown catalog may not delete a link or adopt a session.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sessions } from '../../host/workspace/sessions';
import { TabStore } from '../../host/workspace/store';
import { TabLifecycle } from '../../host/workspace/lifecycle';
import type { TabLifecycleHost } from '../../host/workspace/lifecycle';

describe('connect: the catalog does not answer', () => {
    it('keeps every tab and its link, and says what it kept', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-catalog-'));
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => '',
            knownWorkspaceIds: () => [],
            activeChanged: () => {},
        }, new TabStore(dir, 'scope'));
        session.activeId = 'tab-a';
        session.tabs = [
            { id: 'tab-a', title: 'A', createdAt: 0, updatedAt: 0, hermesSessionId: 'hermes-a' },
            { id: 'tab-b', title: 'B', createdAt: 0, updatedAt: 0 },
        ];

        const loads: string[] = [];
        const told: string[] = [];
        const logged: string[] = [];
        let connects = 0;
        const host = {
            acp: () => ({
                activeSessionId: 'hermes-throwaway',
                status: 'ready',
                listSessionCatalog: async () => {
                    throw new Error('Internal error');
                },
                loadSession: async (_cwd: string, sessionId: string) => {
                    loads.push(sessionId);
                },
            }),
            session,
            post: () => {},
            postTo: () => {},
            log: (line: string) => {
                logged.push(line);
            },
            resolveCwd: () => '/work',
            resolveCwdFor: () => '/work',
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
            enqueueChatOp: () => {},
            openSessionSurface: () => {},
            workspaceState: { get: () => undefined, update: () => Promise.resolve() },
            debugTabSwitch: () => false,
            catalog: {
                beginConnect: () => {
                    connects += 1;
                },
                failed: async (reason: string) => {
                    told.push(reason);
                },
            },
        } as unknown as TabLifecycleHost;

        await new TabLifecycle(host).resumeOrAdopt('/work');

        assert.strictEqual(connects, 1, 'the notice is told a connect began');
        assert.deepStrictEqual(told, ['Internal error'], 'and the reason Hermes gave, once');
        assert.deepStrictEqual(loads, [], 'no session is loaded: the catalog names no target');
        assert.deepStrictEqual(
            session.tabs.map(rec => rec.hermesSessionId),
            ['hermes-a', undefined],
            'every link survives — the unknown catalog deleted nothing',
        );
        assert.strictEqual(session.activeId, 'tab-a', 'and the active tab is still the one it was');
        assert.ok(
            logged.some(line => line.includes('leaving the tabs and their links as they are')),
            `the log says what was kept: ${logged.join(' | ')}`,
        );
        assert.ok(
            !logged.some(line => line.includes('no longer lists')),
            'an unanswered catalog may not conclude that a session is gone',
        );

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not empty the strip on an agent that answers no catalog at all', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-catalog-null-'));
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => '',
            knownWorkspaceIds: () => [],
            activeChanged: () => {},
        }, new TabStore(dir, 'scope'));
        session.activeId = 'tab-a';
        session.tabs = [{ id: 'tab-a', title: 'A', createdAt: 0, updatedAt: 0, hermesSessionId: 'hermes-a' }];

        const told: string[] = [];
        const host = {
            acp: () => ({
                activeSessionId: 'hermes-throwaway',
                status: 'ready',
                // A Hermes without the method: the request answers nothing, no error.
                listSessionCatalog: async () => ({ answered: false, reason: 'the agent answered no session catalog' }),
                loadSession: async () => {
                    throw new Error('must not be called');
                },
            }),
            session,
            post: () => {},
            postTo: () => {},
            log: () => {},
            resolveCwd: () => '/work',
            resolveCwdFor: () => '/work',
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
            enqueueChatOp: () => {},
            openSessionSurface: () => {},
            workspaceState: { get: () => undefined, update: () => Promise.resolve() },
            debugTabSwitch: () => false,
            catalog: {
                beginConnect: () => {},
                failed: async (reason: string) => {
                    told.push(reason);
                },
            },
        } as unknown as TabLifecycleHost;

        await new TabLifecycle(host).resumeOrAdopt('/work');

        assert.strictEqual(told.length, 1, 'the notice is told about the missing answer too');
        assert.ok(/no session catalog/i.test(told[0]), `the reason is the agent's own: ${told[0]}`);
        assert.deepStrictEqual(session.tabs.map(rec => rec.hermesSessionId), ['hermes-a'], 'the link survives');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

/**
 * The other side of the same edge: an answered catalog that is empty *is* empty.
 *
 * This is what `?? []` would destroy. If an unanswered read collapsed into `[]`, this case and the
 * two above would behave the same — and the dead bindings would come back silently.
 */
describe('connect: the catalog answers, and it is empty', () => {
    it('concludes that the remembered session is gone, because Hermes said so', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-catalog-empty-'));
        const session = new Sessions(dir, 'scope', {
            post: () => {},
            log: () => {},
            updatePanelTitle: () => {},
            modelLabel: () => undefined,
            currentWorkspaceId: () => '',
            knownWorkspaceIds: () => [],
            activeChanged: () => {},
        }, new TabStore(dir, 'scope'));
        session.activeId = 'tab-a';
        session.tabs = [{ id: 'tab-a', title: 'A', createdAt: 0, updatedAt: 0, hermesSessionId: 'hermes-a' }];

        const told: string[] = [];
        const logged: string[] = [];
        const host = {
            acp: () => ({
                activeSessionId: 'hermes-throwaway',
                status: 'ready',
                listSessionCatalog: async () => ({ answered: true, sessions: [] }),
                loadSession: async () => {
                    throw new Error('nothing to load: the catalog is empty');
                },
            }),
            session,
            post: () => {},
            postTo: () => {},
            log: (line: string) => {
                logged.push(line);
            },
            resolveCwd: () => '/work',
            resolveCwdFor: () => '/work',
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
            enqueueChatOp: () => {},
            openSessionSurface: () => {},
            workspaceState: { get: () => undefined, update: () => Promise.resolve() },
            debugTabSwitch: () => false,
            catalog: {
                beginConnect: () => {},
                failed: async (reason: string) => {
                    told.push(reason);
                },
            },
        } as unknown as TabLifecycleHost;

        await new TabLifecycle(host).resumeOrAdopt('/work');

        assert.deepStrictEqual(told, [], 'an answered catalog is not a failure');
        assert.ok(
            logged.some(line => line.includes('no longer lists')),
            `the answered-empty catalog is acted on: ${logged.join(' | ')}`,
        );
        assert.ok(
            !logged.some(line => line.includes('leaving the tabs and their links')),
            'the unknown-catalog path is not taken',
        );

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
