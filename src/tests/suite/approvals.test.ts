import { describe, it } from 'mocha';
import assert from 'assert';
import { Approvals, editModeFor, type ApprovalsHost } from '../../host/permissions/approvals';
import type { HostToPane } from '../../shared/webview';

/** The feature with a recording control, so the order of its writes is what the test checks. */
function harness(options: {
    patterns?: string[];
    backupFails?: boolean;
    reported?: string;
    echo?: boolean;
    /** What the cache holds before any read: 'unknown' is a fresh switch. */
    lastMode?: string;
    /** What the CLI answers when a read does run. */
    readReturns?: string;
    /** Held open by a test that wants to watch the caller wait. */
    readGate?: Promise<void>;
} = {}) {
    const calls: string[] = [];
    const posts: HostToPane[] = [];
    const logs: string[] = [];
    let openAccess = false;
    let lasts = options.lastMode ?? 'smart';
    const control = {
        last: () => lasts,
        lastDenyCount: () => 0,
        read: async () => {
            calls.push('read');
            if (options.readGate) {
                await options.readGate;
            }
            lasts = options.readReturns ?? 'smart';
            return lasts;
        },
        readDenyCount: async () => 0,
        readDenyList: async () => options.patterns ?? [],
        write: async (_e: string, _p: string, mode: string) => {
            calls.push(`write:${mode}`);
            return true;
        },
        /** The agent switch: what the last read said is no longer this profile's answer. */
        clear: () => {
            calls.push('clear');
            lasts = 'unknown';
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
        log: (line: string) => {
            logs.push(line);
        },
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
        logs,
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

/**
 * An agent switch clears the cached mode, and Hermes then opens the session on `default`. Nothing
 * used to read `approvals.mode` again, so the session ran Manual while the row said None.
 */
describe('permissions feature: an unknown mode is read, never skipped', () => {
    it('after a switch, a session that reports default gets set_mode once the read answers off', async () => {
        const h = harness({ lastMode: 'unknown', readReturns: 'off', reported: 'default' });
        h.approvals.onProfileChanged();

        await h.approvals.applyEdits();

        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'None means accept_edits, not Manual');
        assert.deepStrictEqual(h.calls.filter(call => call === 'read'), ['read'], 'one read, not a loop');
        assert.strictEqual(h.reported(), 'accept_edits');
    });

    it('the first prompt of a blank chat waits for that read before a mode is set', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const h = harness({ lastMode: 'unknown', readReturns: 'off', reported: 'default', readGate: gate });
        h.approvals.onProfileChanged();

        let settled = false;
        const pending = h.approvals.applyEdits().then(() => {
            settled = true;
        });
        // promptRunner awaits this before the prompt goes out: nothing may be sent meanwhile.
        await Promise.resolve();
        assert.strictEqual(settled, false, 'the caller is still waiting');
        assert.deepStrictEqual(h.sessionModes, [], 'no mode is sent before one is known');

        release();
        await pending;
        assert.strictEqual(settled, true);
        assert.deepStrictEqual(h.sessionModes, ['accept_edits'], 'one request, after the read');
    });

    it('a read that answers nothing is said out loud, and sends nothing', async () => {
        const h = harness({ lastMode: 'unknown', readReturns: 'unknown', reported: 'default' });
        h.approvals.onProfileChanged();

        await h.approvals.applyEdits();

        assert.deepStrictEqual(h.sessionModes, [], 'no mode is invented');
        assert.ok(h.logs.some(line => line.includes('Edit mode unknown for profile "dev-vsc"')),
            'the log says why nothing happened');
    });

    it('the read puts the row on the mode that was applied', async () => {
        const h = harness({ lastMode: 'unknown', readReturns: 'off', reported: 'default' });
        h.approvals.onProfileChanged();

        await h.approvals.applyEdits();

        const posts = h.posts.filter(msg => (msg as { type: string }).type === 'approvalMode') as Array<{ mode?: string }>;
        assert.strictEqual(posts[posts.length - 1]?.mode, 'off', 'the row shows what the session was told');
    });
});
