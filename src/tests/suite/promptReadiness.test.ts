import { describe, it } from 'mocha';
import assert from 'assert';
import { PromptRunner } from '../../host/chat/promptRunner';
import type { PromptHost } from '../../host/chat/promptRunner';
import type { HostToPane } from '../../shared/webview';

/**
 * A tab with no bound session asks for one; whether it got one decides whether the send may go.
 *
 * Since the client stopped tearing the connection down on a refused `session/new`, the failure is
 * only visible in its status — so this is the check that has to hold, or a message is sent into a
 * session that does not exist.
 */
describe('session readiness', () => {
    const acp = (status: 'ready' | 'error', sessionId: string) => ({
        activeSessionId: sessionId,
        status,
        newSession: async () => undefined,
        loadSession: async () => undefined,
    });

    const host = (status: 'ready' | 'error', sessionId: string) => {
        const posted: HostToPane[] = [];
        let bound = '';
        const value = {
            acp: () => acp(status, sessionId) as never,
            acpStatus: () => status,
            sessionId: () => 'tab-a',
            messages: () => [],
            tabs: () => [{ id: 'tab-a', title: 'New Chat', createdAt: 0, updatedAt: 0 }],
            resolveCwd: () => '/tmp',
            log: () => undefined,
            post: (msg: HostToPane) => posted.push(msg),
            otherSessionIsPrompting: () => false,
            detachActivePrompt: async () => undefined,
            bindHermesSessionId: (id: string) => { bound = id; },
            applySessionModelPreference: async () => undefined,
            setBoundSessionId: () => undefined,
            saveMessage: () => undefined,
            savePermissionRequest: () => undefined,
            resolvePermissionHistory: () => undefined,
            permissionOptionLabel: () => undefined,
            isViewingPromptSession: () => true,
            cancelPendingPermissions: () => undefined,
            awaitSessionReady: async () => undefined,
        } as unknown as PromptHost;
        return { host: value, posted, bound: () => bound };
    };

    it('refuses the turn when session/new left the client in error', async () => {
        const harness = host('error', '');
        const readiness = await new PromptRunner(harness.host).ensureSessionReady();

        assert.deepStrictEqual(readiness, { ok: false, notified: false });
        assert.strictEqual(harness.bound(), '', 'nothing was bound');
    });

    it('binds the new session when the client is ready', async () => {
        const harness = host('ready', 'hermes-1');
        const readiness = await new PromptRunner(harness.host).ensureSessionReady();

        assert.deepStrictEqual(readiness, { ok: true });
        assert.strictEqual(harness.bound(), 'hermes-1');
    });

    it('says so, and reports no notification, when there is no client at all', async () => {
        const harness = host('ready', 'hermes-1');
        (harness.host as unknown as { acp: () => undefined }).acp = () => undefined;
        const readiness = await new PromptRunner(harness.host).ensureSessionReady();

        assert.deepStrictEqual(readiness, { ok: false, notified: false });
    });
});
