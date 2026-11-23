/**
 * A send on a tab whose Hermes session Hermes itself refuses.
 *
 * The 2.6.0 Windows report: a session synced from another machine keeps a cwd the Windows VM does
 * not have, so `session/load` is refused (`invalid_params field=cwd`). The tab kept the dead id, the
 * pane was blank, and the message the user then typed never left — no prompt, no error, twice over.
 *
 * The rule these tests hold: an empty tab is given a session of its own and the message goes; a tab
 * that shows a conversation is never re-sessioned behind the user's back, and says why instead.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { PromptRunner } from '../../host/chat/promptRunner';
import type { PromptHost } from '../../host/chat/promptRunner';
import type { ChatMessage, SessionInfo } from '../../shared/chat';

const DEAD = '9f02b95d-6716-428c-a637-7d870aaf6323';
const TAB_CWD = 'D:\\TheCaves (backup)\\_GitProjects';

interface Sent {
    kind: 'load' | 'new' | 'prompt';
    arg: unknown;
}

/** A tab bound to a session Hermes refuses, and a client that records every call it is asked to make. */
const harness = (options: { bound?: string; messages?: ChatMessage[] } = {}) => {
    const calls: Sent[] = [];
    const bound = options.bound === undefined ? DEAD : options.bound;
    const posted: Array<{ type: string; text?: string; role?: string }> = [];
    const logged: string[] = [];
    const boundTo: string[] = [];
    let active = '';
    const acp = {
        status: 'ready',
        get activeSessionId() {
            return active;
        },
        loadSession: async (cwd: string, id: string) => {
            calls.push({ kind: 'load', arg: { cwd, id } });
            // Hermes' own answer for a session whose cwd this machine does not have.
            throw new Error('Internal error');
        },
        newSession: async (cwd: string) => {
            calls.push({ kind: 'new', arg: cwd });
            active = 'new-session-1';
        },
        sendMessage: async (prompt: unknown) => {
            calls.push({ kind: 'prompt', arg: prompt });
        },
    };
    const tabs = [{ id: 'tab-a', hermesSessionId: bound }] as unknown as SessionInfo[];
    const host = {
        acp: () => acp as never,
        sessionId: () => 'tab-a',
        messages: () => options.messages || [],
        tabs: () => tabs,
        resolveCwd: () => TAB_CWD,
        resolveCwdFor: () => TAB_CWD,
        historyBlock: () => '',
        treeBlock: () => '',
        log: (line: string) => logged.push(line),
        post: (msg: { type: string; text?: string; role?: string }) => posted.push(msg),
        otherSessionIsPrompting: () => false,
        detachActivePrompt: async () => undefined,
        bindHermesSessionId: (id: string) => boundTo.push(id),
        applySessionModelPreference: async () => undefined,
        applySessionEditMode: async () => undefined,
        setBoundSessionId: () => undefined,
        saveMessage: () => undefined,
        savePermissionRequest: () => undefined,
        resolvePermissionHistory: () => undefined,
        permissionOptionLabel: () => undefined,
        acpStatus: () => acp.status,
        isViewingPromptSession: () => true,
        cancelPendingPermissions: () => undefined,
        awaitSessionReady: async () => undefined,
    } as unknown as PromptHost;
    const runner = new PromptRunner(host);
    return { runner, calls, posted, logged, boundTo };
};

describe('a tab whose Hermes session cannot be resumed', () => {
    it('an empty tab gets a session in its own folder, and the message goes', async () => {
        const { runner, calls, boundTo, logged } = harness();

        const readiness = await runner.ensureSessionReady();
        assert.deepStrictEqual(readiness, { ok: true }, 'the send may go on');
        assert.deepStrictEqual(calls, [
            { kind: 'load', arg: { cwd: TAB_CWD, id: DEAD } },
            { kind: 'new', arg: TAB_CWD },
        ], 'the dead id is tried once, then a session is created in the tab\'s own cwd');
        assert.deepStrictEqual(boundTo, ['new-session-1'], 'the tab is rebound to the session that exists');
        assert.ok(logged.some(line => line.startsWith(`Resume failed for ${DEAD}`)), 'the refusal stays in the log');

        // And the turn itself is what the user typed — nothing is held back once the tab is ready.
        await runner.sendUserTurn('tab-a', 'Hey. Hello. How are you?');
        assert.deepStrictEqual(calls[calls.length - 1], { kind: 'prompt', arg: 'Hey. Hello. How are you?' });
    });

    it('a tab that shows a conversation is not re-sessioned, and the pane gets the reason', async () => {
        const { runner, calls, posted } = harness({
            messages: [{ role: 'user', text: 'earlier', timestamp: 1 } as ChatMessage],
        });

        const readiness = await runner.ensureSessionReady();
        assert.deepStrictEqual(readiness, { ok: false, notified: true });
        assert.strictEqual(calls.filter(call => call.kind === 'new').length, 0, 'no session is created over it');
        const line = posted.find(msg => msg.type === 'addMessage');
        assert.ok(line, 'one line reaches the pane');
        assert.ok(line!.text!.includes(DEAD), 'it names the session');
        assert.ok(line!.text!.includes('Internal error'), 'and carries Hermes\' own reason');
        assert.ok(!line!.text!.includes('closed chats'), 'not the generic "reopen it" text');
    });

    it('a tab with no session at all and a conversation keeps the older answer', async () => {
        const { runner, calls, posted } = harness({
            bound: '',
            messages: [{ role: 'assistant', text: 'earlier', timestamp: 1 } as ChatMessage],
        });

        const readiness = await runner.ensureSessionReady();
        assert.deepStrictEqual(readiness, { ok: false, notified: true });
        assert.strictEqual(calls.length, 0, 'nothing is loaded and nothing is created');
        assert.ok(posted.some(msg => msg.type === 'addMessage' && msg.text!.includes('no Hermes session')));
    });
});
