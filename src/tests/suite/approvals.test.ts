import { describe, it } from 'mocha';
import assert from 'assert';
import { Approvals, type ApprovalsHost } from '../../host/permissions/approvals';
import type { HostToPane } from '../../shared/webview';

/** The feature with a recording control, so the order of its writes is what the test checks. */
function harness(options: { patterns?: string[]; backupFails?: boolean } = {}) {
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
    const host: ApprovalsHost = {
        post: (msg: HostToPane) => {
            posts.push(msg);
        },
        log: () => {},
        profile: () => 'dev-vsc',
        executable: async () => '/usr/local/bin/hermes',
    };
    const approvals = new Approvals(host, control as never, store as never);
    return { approvals, calls, posts, isOpen: () => openAccess };
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
