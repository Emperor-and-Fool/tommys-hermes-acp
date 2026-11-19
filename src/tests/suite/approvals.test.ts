import { describe, it } from 'mocha';
import assert from 'assert';
import { Approvals, editModeFor, type ApprovalsHost } from '../../host/permissions/approvals';
import type { HostToPane } from '../../shared/webview';

/** The feature with a recording control, so the order of its writes is what the test checks. */
function harness(options: { patterns?: string[]; backupFails?: boolean; reported?: string; echo?: boolean } = {}) {
    const calls: string[] = [];
    const posts: HostToPane[] = [];
    let openAccess = false;
    const control = {
        last: () => 'smart',
        lastDenyCount: () => 0,
        read: async () => 'smart',
        readDenyCount: async () => 0,
        readDenyList: async () => options.patterns ?? [],
        write: async (_e: string, _p: string, mode: string) => {
            calls.push(`write:${mode}`);
            return true;
        },
        clearDeny: async () => {
            calls.push('clearDeny');
            return true;
        },
        writeDenyList: async (_e: string, _p: string, patterns: string[]) => {
            calls.push(`writeDeny:${patterns.join(',')}`);
            return true;
        },
    };
    const store = {
        openAccess: () => openAccess,
        setOpenAccess: (next: boolean) => {
            openAccess = next;
            return true;
        },
        saveDenyBackup: (_profile: string, patterns: string[]) => {
            calls.push(`backup:${patterns.join(',')}`);
            return options.backupFails ? undefined : '/tmp/deny-backup.json';
        },
        newestDenyBackup: () => '/tmp/deny-backup.json',
        readDenyBackup: () => ['echo probe'],
    };
    let busy = false;
    let reported = options.reported ?? 'default';
    let sessionId = 'session-1';
    const sessionModes: string[] = [];
    const runEnded: Array<() => void> = [];
    const sessionModeHandlers: Array<(mode: string) => void> = [];
    const acp = {
        get activeSessionId() {
            return sessionId;
        },
        get currentSessionMode() {
            return reported;
        },
        setSessionMode: async (mode: string) => {
            sessionModes.push(mode);
            if (options.echo !== false) {
                reported = mode;
            }
        },
    };
    const host: ApprovalsHost = {
        post: (msg: HostToPane) => {
            posts.push(msg);
        },
        log: () => {},
        profile: () => 'dev-vsc',
        executable: async () => '/usr/local/bin/hermes',
        acp: () => (sessionModes || true) ? (acp as never) : undefined,
        activeSessionBusy: () => busy,
        onRunEnded: (handler: () => void) => {
            runEnded.push(handler);
            return () => undefined;
        },
        onSessionMode: (handler: (mode: string) => void) => {
            sessionModeHandlers.push(handler);
            return () => undefined;
        },
        respondToPermission: () => {},
        storedPermissionOption: () => undefined,
        locale: () => ({}) as never,
    };
    const approvals = new Approvals(host, store as never, control as never);
    approvals.start();
    return {
        approvals,
        calls,
        posts,
        sessionModes,
        isOpen: () => openAccess,
        setBusy: (value: boolean) => {
            busy = value;
        },
        endRun: () => runEnded.forEach(handler => handler()),
        /** Hermes says what a session's mode is: the client's report, then our listeners. */
        fireSessionMode: (mode: string) => {
            reported = mode;
            sessionModeHandlers.forEach(handler => handler(mode));
        },
        setSessionId: (id: string) => {
            sessionId = id;
        },
        reported: () => reported,
    };
}

describe('permissions feature: what it writes, and in what order', () => {
    it('a mode change writes the profile and ends the ALL state', async () => {
        const h = harness();
        await h.approvals.setMode('manual');
        assert.deepStrictEqual(h.calls, ['write:manual']);
        assert.strictEqual(h.isOpen(), false, 'any deliberate choice ends ALL');
    });

    it('refuses a mode it cannot set, without touching the profile', async () => {
        const h = harness();
        await h.approvals.setMode('sometimes');
        assert.deepStrictEqual(h.calls, []);
    });

    it('the red action saves the deny list before it clears anything', async () => {
        const h = harness({ patterns: ['echo probe'] });
        await h.approvals.openAccess();
        assert.deepStrictEqual(h.calls, ['backup:echo probe', 'clearDeny', 'write:off']);
        assert.strictEqual(h.isOpen(), true);
    });

    it('stops when the deny list could not be saved: nothing is cleared', async () => {
        const h = harness({ patterns: ['echo probe'], backupFails: true });
        await h.approvals.openAccess();
        assert.deepStrictEqual(h.calls, ['backup:echo probe'], 'the clear never happens');
        assert.strictEqual(h.isOpen(), false);
    });

    it('restores the saved list and ends the ALL state', async () => {
        const h = harness();
        await h.approvals.restoreDeny();
        assert.deepStrictEqual(h.calls, ['writeDeny:echo probe']);
        assert.strictEqual(h.isOpen(), false);
    });
});

describe('permissions feature: edits follow the buttons', () => {
    it('maps each button to Hermes\' edit mode', () => {
        assert.strictEqual(editModeFor('manual', false), 'default');
        assert.strictEqual(editModeFor('smart', false), 'accept_edits');
        assert.strictEqual(editModeFor('off', false), 'accept_edits', 'None is not DANGER');
        assert.strictEqual(editModeFor('off', true), 'dont_ask', 'DANGER frees everywhere');
        assert.strictEqual(editModeFor('unknown', false), '', 'an unknown state changes nothing');
    });

    it('a session opened on default takes the mode the button implies', async () => {
        const h = harness({ reported: 'default' });
        await h.approvals.applyEdits();
        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'smart frees the permission root');
        assert.strictEqual(h.reported(), 'accept_edits');
    });

    it('says nothing when the session is already on that mode', async () => {
        const h = harness({ reported: 'accept_edits' });
        await h.approvals.applyEdits();
        assert.deepStrictEqual(h.sessionModes, []);
    });

    it('a run in flight defers the change, and it is applied when the run ends', async () => {
        const h = harness({ reported: 'default' });
        h.setBusy(true);
        await h.approvals.applyEdits();
        assert.deepStrictEqual(h.sessionModes, [], 'nothing is sent while the run is busy');

        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'applied once the run is over');
    });
});

/**
 * The press has two halves. Commands follow the button at once; the session's edit mode is frozen
 * for the run in flight, so the pane is told to expect it at the next run — and told when it lands.
 */
describe('permissions feature: a change made while a run is in flight', () => {
    it('says the edit half waits, and stops saying it when the run applies it', async () => {
        // The session is on Hermes' own default, the button implies something else.
        const h = harness({ reported: 'default' });
        h.setBusy(true);
        await h.approvals.applyEdits();

        const waiting = h.posts.filter(msg => msg.type === 'approvalMode') as Array<{ notice?: string }>;
        assert.strictEqual(waiting[waiting.length - 1]?.notice, 'appliesNextRun');
        assert.deepStrictEqual(h.sessionModes, [], 'nothing is sent during the run');

        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'applied when the run ends');
        const after = h.posts.filter(msg => msg.type === 'approvalMode') as Array<{ notice?: string }>;
        assert.strictEqual(after[after.length - 1]?.notice, undefined, 'the notice is gone with it');
    });

    it('an idle change never raises the notice', async () => {
        const h = harness({ reported: 'default' });
        await h.approvals.applyEdits();
        const posts = h.posts.filter(msg => msg.type === 'approvalMode') as Array<{ notice?: string }>;
        assert.strictEqual(posts[posts.length - 1]?.notice, undefined);
        assert.deepStrictEqual(h.sessionModes, ['accept_edits']);
    });
});

describe('permissions feature: the edit mode a first prompt waits for', () => {
    it('one intent is one set_mode, even with the session-mode listener in the way', async () => {
        // Hermes does not echo the mode here: that is the window in which a second caller could
        // send the same request again.
        const h = harness({ echo: false });
        const awaited = h.approvals.applyEdits();
        const listener = h.approvals.applyEdits();
        h.fireSessionMode('default');

        await Promise.all([awaited, listener]);
        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'one request, not two');
    });

    it('a refused set_mode is logged, and the state still says a mode is waiting for that session', async () => {
        const h = harness();
        h.setBusy(true);
        await h.approvals.applyEdits();

        const last = h.posts.filter(post => post.type === 'approvalMode').pop() as
            { notice?: string; noticeSessionId?: string };
        assert.strictEqual(last.notice, 'appliesNextRun');
        assert.strictEqual(last.noticeSessionId, 'session-1', 'the notice names the session it waits for');
        assert.deepStrictEqual(h.sessionModes, [], 'nothing was sent while the run was busy');
    });

    it('a blank chat has nothing deferred, so it posts no notice', async () => {
        const h = harness();
        h.setSessionId('');
        h.setBusy(true);
        await h.approvals.applyEdits();
        assert.ok(!h.posts.some(post => (post as { notice?: string }).notice), 'no session, no notice');
    });

    it('a run that ends on another session does not apply the mode here', async () => {
        const h = harness();
        h.setBusy(true);
        await h.approvals.applyEdits();
        assert.strictEqual((h.posts.length > 0), true);

        h.setSessionId('session-2');
        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(h.sessionModes, [], 'the mode belongs to session-1, which is not loaded');
    });

    it('the mode it waited for is applied when that session is the one that ended', async () => {
        const h = harness();
        h.setBusy(true);
        await h.approvals.applyEdits();
        h.setBusy(false);
        h.endRun();
        await new Promise(resolve => setImmediate(resolve));

        assert.deepStrictEqual(h.sessionModes, ['accept_edits']);
        const last = h.posts.filter(post => post.type === 'approvalMode').pop() as { notice?: string };
        assert.strictEqual(last.notice, undefined, 'and the notice is over');
    });
});
