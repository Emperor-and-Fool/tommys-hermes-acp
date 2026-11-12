/**
 * The control is the only writer of `approvals.mode`, so what it does on a slow, a failed and a
 * shared read matters more than its happy path: the switch must never claim a mode Hermes did not
 * take, and two surfaces asking at once must not cost two CLI spawns.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import { ApprovalModeControl, type HermesRunner } from '../../host/permissions/approvalModeControl';

/** A runner that records its calls and answers from a queue. */
function fakeRunner(answer: (args: string[]) => Promise<string>) {
    const calls: string[][] = [];
    const runner: HermesRunner = async (_executable, args) => {
        calls.push(args);
        return answer(args);
    };
    return { runner, calls };
}

const PROFILE = 'dev-vsc';

describe('approval mode control', () => {
    it('reads the mode, caches the answer, and reports the arguments it used', async () => {
        const { runner, calls } = fakeRunner(async () => 'smart\n');
        const control = new ApprovalModeControl(runner);
        assert.strictEqual(control.last(PROFILE), 'unknown');
        assert.strictEqual(await control.read('/usr/bin/hermes', PROFILE), 'smart');
        assert.strictEqual(control.last(PROFILE), 'smart');
        assert.deepStrictEqual(calls[0], ['--profile', PROFILE, 'config', 'get', 'approvals.mode']);
    });

    it('shares one spawn between callers asking at the same time', async () => {
        let release: ((value: string) => void) | null = null;
        const { runner, calls } = fakeRunner(() => new Promise<string>(resolve => {
            release = resolve;
        }));
        const control = new ApprovalModeControl(runner);
        const first = control.read('/usr/bin/hermes', PROFILE);
        const second = control.read('/usr/bin/hermes', PROFILE);
        release!('manual');
        assert.deepStrictEqual(await Promise.all([first, second]), ['manual', 'manual']);
        assert.strictEqual(calls.length, 1);
    });

    it('reads a failure as unknown rather than throwing', async () => {
        const { runner } = fakeRunner(async () => {
            throw new Error('hermes exited with code 2');
        });
        const control = new ApprovalModeControl(runner);
        assert.strictEqual(await control.read('/usr/bin/hermes', PROFILE), 'unknown');
        assert.strictEqual(control.last(PROFILE), 'unknown');
    });

    it('writes through and follows the cache on success', async () => {
        const { runner, calls } = fakeRunner(async () => '');
        const control = new ApprovalModeControl(runner);
        assert.strictEqual(await control.write('/usr/bin/hermes', PROFILE, 'manual'), true);
        assert.strictEqual(control.last(PROFILE), 'manual');
        assert.deepStrictEqual(calls[0], ['--profile', PROFILE, 'config', 'set', 'approvals.mode', 'manual']);
    });

    it('keeps the old answer when the write fails', async () => {
        const { runner } = fakeRunner(async args => {
            if (args.includes('set')) {
                throw new Error('read-only config');
            }
            return 'smart\n';
        });
        const control = new ApprovalModeControl(runner);
        await control.read('/usr/bin/hermes', PROFILE);
        assert.strictEqual(await control.write('/usr/bin/hermes', PROFILE, 'manual'), false);
        assert.strictEqual(control.last(PROFILE), 'smart');
    });

    it('counts approvals.deny whether the CLI prints JSON or YAML', async () => {
        const answers = ['[]', '["rm -rf /", "sudo *"]', '- rm -rf /\n- sudo *\n'];
        for (const [index, answer] of answers.entries()) {
            const { runner, calls } = fakeRunner(async () => answer);
            const control = new ApprovalModeControl(runner);
            const expected = [0, 2, 2][index];
            assert.strictEqual(await control.readDenyCount('/usr/bin/hermes', PROFILE), expected);
            assert.strictEqual(control.lastDenyCount(PROFILE), expected);
            assert.deepStrictEqual(calls[0], ['--profile', PROFILE, 'config', 'get', 'approvals.deny']);
        }
    });

    it('clears approvals.deny, and says so only when the CLI took it', async () => {
        const ok = fakeRunner(async () => '');
        const control = new ApprovalModeControl(ok.runner);
        assert.strictEqual(await control.clearDeny('/usr/bin/hermes', PROFILE), true);
        assert.strictEqual(control.lastDenyCount(PROFILE), 0);
        assert.deepStrictEqual(ok.calls[0], ['--profile', PROFILE, 'config', 'set', 'approvals.deny', '[]']);

        const broken = fakeRunner(async () => {
            throw new Error('config is read-only');
        });
        const refused = new ApprovalModeControl(broken.runner);
        assert.strictEqual(await refused.clearDeny('/usr/bin/hermes', PROFILE), false);
    });

    it('forgets everything on clear', async () => {
        const { runner } = fakeRunner(async () => 'smart\n');
        const control = new ApprovalModeControl(runner);
        await control.read('/usr/bin/hermes', PROFILE);
        control.clear();
        assert.strictEqual(control.last(PROFILE), 'unknown');
    });
});
