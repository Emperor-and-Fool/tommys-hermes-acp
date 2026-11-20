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
    const acp = (status: 'ready' | 'error', sessionId: string, order: string[]) => ({
        activeSessionId: sessionId,
        status,
        newSession: async () => {
            order.push('session/new');
        },
        loadSession: async () => undefined,
    });

    const host = (status: 'ready' | 'error', sessionId: string, editModeFails = false) => {
        const posted: HostToPane[] = [];
        const logged: string[] = [];
        const order: string[] = [];
        let bound = '';
        const value = {
            acp: () => acp(status, sessionId, order) as never,
            acpStatus: () => status,
            sessionId: () => 'tab-a',
            messages: () => [],
            tabs: () => [{ id: 'tab-a', title: 'New Chat', createdAt: 0, updatedAt: 0 }],
            resolveCwd: () => '/tmp/window',
            resolveCwdFor: () => '/tmp',
            log: (line: string) => {
                logged.push(line);
            },
            post: (msg: HostToPane) => posted.push(msg),
            otherSessionIsPrompting: () => false,
            detachActivePrompt: async () => undefined,
            bindHermesSessionId: (id: string) => { bound = id; },
            applySessionModelPreference: async () => undefined,
            applySessionEditMode: async () => {
                order.push('set_mode');
                if (editModeFails) {
                    throw new Error('Internal error');
                }
            },
            setBoundSessionId: () => undefined,
            saveMessage: () => undefined,
            savePermissionRequest: () => undefined,
            resolvePermissionHistory: () => undefined,
            permissionOptionLabel: () => undefined,
            isViewingPromptSession: () => true,
            cancelPendingPermissions: () => undefined,
            awaitSessionReady: async () => undefined,
        } as unknown as PromptHost;
        return { host: value, posted, order, logged, bound: () => bound };
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

    it('session/new, then the edit mode, and only then does the send go on', async () => {
        const harness = host('ready', 'hermes-1');
        const readiness = await new PromptRunner(harness.host).ensureSessionReady();

        assert.deepStrictEqual(readiness, { ok: true });
        assert.deepStrictEqual(harness.order, ['session/new', 'set_mode'], 'the mode is asked for before the prompt');
    });

    it('a refused edit mode is logged, and the send still goes through', async () => {
        const harness = host('ready', 'hermes-1', true);
        const readiness = await new PromptRunner(harness.host).ensureSessionReady();

        assert.deepStrictEqual(readiness, { ok: true }, 'the message the user asked for is not held back');
        assert.ok(harness.logged.some(line => line.includes('Edit mode not applied before the first prompt')));
    });
});
