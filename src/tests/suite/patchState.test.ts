/**
 * The patch set in a checkout: read, and — only on a request — brought to the right set.
 *
 * Every git call goes through an injected runner that models a checkout: which of our patches it
 * carries, whether `acp_adapter` has other edits, and whether a patch would apply. The real patch
 * files are on disk (a temp folder with the three names), because their presence is part of the
 * decision. Nothing here runs git against a real Hermes checkout.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import assert from 'assert';
import {
    ALL_PATCHES,
    PATCH_0001,
    PATCH_0002,
    PATCH_0003,
    requiredPatches,
} from '../../host/environment/hermesPatches';
import { fixPatchState, GitResult, readPatchState } from '../../host/environment/patchState';

interface FakeCheckout {
    run: (args: string[], cwd: string) => Promise<GitResult>;
    /** What the fake tree carries now. */
    present: Set<string>;
    clean: boolean;
    /** Patches that would apply to it (i.e. it is the version they were cut against). */
    applicable: Set<string>;
    calls: string[][];
}

const idOf = (file: string): string => {
    const hit = ALL_PATCHES.find(patch => file.endsWith(patch.file));
    return hit ? hit.id : '?';
};

function fakeCheckout(options: { present?: string[]; clean?: boolean; applicable?: string[] }): FakeCheckout {
    const state: FakeCheckout = {
        present: new Set(options.present ?? []),
        clean: options.clean ?? true,
        applicable: new Set(options.applicable ?? []),
        calls: [],
        run: async (args, _cwd) => {
            state.calls.push(args);
            const file = args[args.length - 1];
            if (args[0] === 'diff' && args[1] === '--quiet') {
                return { code: state.clean ? 0 : 1, output: '' };
            }
            if (args[0] === 'status' && args[1] === '--porcelain') {
                return { code: 0, output: '' };
            }
            if (args[0] === 'apply' && args[1] === '--reverse' && args[2] === '--check') {
                return { code: state.present.has(idOf(file)) ? 0 : 1, output: '' };
            }
            if (args[0] === 'apply' && args[1] === '--check') {
                return { code: state.applicable.has(idOf(file)) ? 0 : 1, output: '' };
            }
            if (args[0] === 'apply' && args[1] === '--reverse') {
                const id = idOf(file);
                if (!state.present.has(id)) {
                    return { code: 1, output: `patch does not apply: ${file}` };
                }
                state.present.delete(id);
                return { code: 0, output: '' };
            }
            if (args[0] === 'apply' && args[1] !== '--check' && args[1] !== '--reverse') {
                state.present.add(idOf(file));
                return { code: 0, output: '' };
            }
            return { code: 1, output: `unexpected git call: ${args.join(' ')}` };
        },
    };
    return state;
}

function workspace(): { checkout: string; patchDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-state-'));
    const checkout = path.join(root, 'hermes-agent');
    fs.mkdirSync(path.join(checkout, 'acp_adapter'), { recursive: true });
    const patchDir = path.join(root, 'patches');
    fs.mkdirSync(patchDir, { recursive: true });
    for (const patch of ALL_PATCHES) {
        fs.writeFileSync(path.join(patchDir, patch.file), 'diff --git a/x b/x\n');
    }
    return { checkout, patchDir };
}

describe('the patch state of a checkout', () => {
    it('reads ok when exactly the required set is in the tree', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0003'] });
        const state = await readPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(state.kind, 'ok');
        assert.deepStrictEqual(state.kind === 'ok' ? state.present : [], ['0003']);
    });

    it('reads missing when the tree is clean and the set applies', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ applicable: ['0003'] });
        const state = await readPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(state.kind, 'missing');
        assert.deepStrictEqual(state.kind === 'missing' ? state.applicable : [], ['0003']);
    });

    it('reads wrong when the 0.22 set is on a 0.23 checkout', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0001', '0002'], applicable: ['0003'] });
        const state = await readPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(state.kind, 'wrong');
        assert.deepStrictEqual(state.kind === 'wrong' ? state.extra : [], ['0001', '0002']);
        assert.deepStrictEqual(state.kind === 'wrong' ? state.missing : [], ['0003']);
    });

    it('reads wrong when 0003 is there but the 0.22 set came back with it', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0001', '0002', '0003'] });
        const state = await readPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(state.kind, 'wrong');
        assert.deepStrictEqual(state.kind === 'wrong' ? state.extra : [], ['0001', '0002']);
        assert.deepStrictEqual(state.kind === 'wrong' ? state.missing : [], []);
    });

    it('reads unknown for an edit that is not one of our sets', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ clean: false, applicable: ['0003'] });
        const state = await readPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(state.kind, 'unknown');
        assert.ok(state.kind === 'unknown' && state.reason.includes('not the patch set'), state.kind === 'unknown' ? state.reason : '');
    });

    it('reads unknown for a version with no set', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({});
        const state = await readPatchState({ checkout, patchDir, version: '0.24.0', run: fake.run });
        assert.strictEqual(state.kind, 'unknown');
        assert.deepStrictEqual(fake.calls, [], 'no git call is made');
    });
});

describe('fixing the patch state', () => {
    it('reverses the wrong set newest-first, then applies the required one', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0001', '0002'], applicable: ['0003'] });
        const result = await fixPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(result.changed, true, result.log.join('\n'));
        const writes = fake.calls.filter(args => args[0] === 'apply' && !args.includes('--check'));
        const reversed = writes
            .filter(args => args[1] === '--reverse')
            .map(args => idOf(args[args.length - 1]));
        assert.deepStrictEqual(reversed, ['0002', '0001'], 'newest first');
        const applied = writes
            .filter(args => args[1] !== '--reverse')
            .map(args => idOf(args[args.length - 1]));
        assert.deepStrictEqual(applied, ['0003']);
        assert.ok(!fake.calls.some(args => args.includes('--3way')), 'no --3way: it stages the result');
        assert.strictEqual(result.state.kind, 'ok');
    });

    it('applies a missing set in order', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ applicable: ['0001', '0002'] });
        await fixPatchState({ checkout, patchDir, version: '0.22.6', run: fake.run });
        const applied = fake.calls
            .filter(args => args[0] === 'apply' && !args.includes('--check') && args[1] !== '--reverse')
            .map(args => idOf(args[args.length - 1]));
        assert.deepStrictEqual(applied, ['0001', '0002']);
    });

    it('reads again before acting: a second fix on an already-right tree does nothing', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0001', '0002'], applicable: ['0003'] });
        const first = await fixPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(first.changed, true);
        fake.calls.length = 0;
        // The same window (or the other one) still holding the old picture: it asks for the fix again.
        const second = await fixPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(second.changed, false);
        assert.deepStrictEqual(fake.calls.filter(args => args[0] === 'apply' && !args.includes('--check')), [],
            'not one write on the second run');
        assert.ok(second.log[0].includes('already in place'), second.log[0]);
        assert.strictEqual(second.state.kind, 'ok');
    });

    it('changes nothing when the state is already ok', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ present: ['0003'] });
        const result = await fixPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(result.changed, false);
        assert.deepStrictEqual(fake.calls.filter(a => a[0] === 'apply' && !a.includes('--check')), []);
    });

    it('leaves an unknown tree byte for byte alone', async () => {
        const { checkout, patchDir } = workspace();
        const fake = fakeCheckout({ clean: false });
        const result = await fixPatchState({ checkout, patchDir, version: '0.23.3', run: fake.run });
        assert.strictEqual(result.changed, false);
        assert.deepStrictEqual(fake.calls.filter(a => a[0] === 'apply' && !a.includes('--check')), [], 'not one write');
    });
});

describe('the version table', () => {
    it('is one place, and it says what each version needs', () => {
        assert.deepStrictEqual(requiredPatches('0.22.3').map(p => p.id), [PATCH_0001.id]);
        assert.deepStrictEqual(requiredPatches('0.22.6').map(p => p.id), [PATCH_0001.id, PATCH_0002.id]);
        assert.deepStrictEqual(requiredPatches('0.23.4').map(p => p.id), [PATCH_0003.id]);
        assert.deepStrictEqual(requiredPatches('0.24.0').map(p => p.id), []);
        assert.deepStrictEqual(requiredPatches('').map(p => p.id), []);
    });
});
