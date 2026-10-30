import { describe, it } from 'mocha';
import assert from 'assert';
import { PromptRunner } from '../../host/chat/promptRunner';
import type { PromptHost } from '../../host/chat/promptRunner';
import type { HostToPane } from '../../shared/webview';

/**
 * An unanswered permission card used to leave the ACP request open for the rest of the turn: the
 * agent waited, the pane waited, and nothing said which side had given up. The timeout is the only
 * thing that ends that standoff, so it is worth proving both halves — that it fires, and that it
 * does not fire over an answer that already arrived.
 */
describe('permission timeout', () => {
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const makeHost = () => {
        const posted: HostToPane[] = [];
        const outcomes: string[] = [];
        const saved: Array<[string, string]> = [];
        const value = {
            acp: () => undefined,
            sessionId: () => 'tab-a',
            messages: () => [],
            tabs: () => [],
            resolveCwd: () => '/tmp',
            log: () => undefined,
            post: (msg: HostToPane) => posted.push(msg),
            otherSessionIsPrompting: () => false,
            detachActivePrompt: async () => undefined,
            bindHermesSessionId: () => undefined,
            applySessionModelPreference: async () => undefined,
            setBoundSessionId: () => undefined,
            saveMessage: (role: string, text: string) => saved.push([role, text]),
            savePermissionRequest: () => undefined,
            resolvePermissionHistory: (_id: string, outcome: string) => outcomes.push(outcome),
            permissionOptionLabel: () => undefined,
            acpStatus: () => undefined,
            isViewingPromptSession: () => true,
            cancelPendingPermissions: () => undefined,
            awaitSessionReady: async () => undefined,
        } as unknown as PromptHost;
        return { host: value, posted, outcomes, saved };
    };

    const request = {
        title: 'Run shell command',
        detail: 'rm -rf build',
        options: [{ optionId: 'allow-once', name: 'Allow once' }],
    };

    const cardId = (posted: HostToPane[]): string => {
        const card = posted.find(msg => msg.type === 'permissionRequest');
        assert.ok(card && card.type === 'permissionRequest', 'a card was posted');
        return card.id;
    };

    it('cancels a card nobody answers, dismisses it and says why', async () => {
        const { host, posted, outcomes, saved } = makeHost();
        const runner = new PromptRunner(host, 1000);

        const answer = runner.requestPermission(request as never);
        const id = cardId(posted);

        assert.strictEqual(await answer, null, 'the ACP request gets an outcome');
        assert.deepStrictEqual(outcomes, ['cancelled']);
        assert.ok(
            posted.some(msg => msg.type === 'permissionDismiss' && msg.id === id),
            'the card leaves the pane',
        );
        assert.strictEqual(saved.length, 1, 'one line in the transcript, not none and not two');
        assert.strictEqual(saved[0][0], 'assistant');
        assert.ok(saved[0][1].includes('1'), `the line names the timeout: ${saved[0][1]}`);
    });

    it('does not fire over an answer that already arrived', async () => {
        const { host, posted, outcomes, saved } = makeHost();
        const runner = new PromptRunner(host, 60);

        const answer = runner.requestPermission(request as never);
        const id = cardId(posted);
        runner.handlePermissionResponse(id, 'allow-once');

        assert.strictEqual(await answer, 'allow-once');
        await wait(120);

        assert.deepStrictEqual(outcomes, ['selected'], 'one outcome, not one per path');
        assert.strictEqual(
            posted.filter(msg => msg.type === 'permissionDismiss').length,
            0,
            'the timer must not dismiss a card that was answered',
        );
        assert.strictEqual(saved.length, 0, 'no timeout line is written over a real answer');
    });

    it('cancels the wait when the turn is torn down', async () => {
        const { host, posted, outcomes } = makeHost();
        const runner = new PromptRunner(host, 60);

        const answer = runner.requestPermission(request as never);
        cardId(posted);
        runner.cancelPendingPermissions();

        assert.strictEqual(await answer, null);
        await wait(120);
        assert.deepStrictEqual(outcomes, ['cancelled'], 'the detach resolves it exactly once');
    });
});
