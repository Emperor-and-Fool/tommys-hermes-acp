/**
 * When the patch dialog appears, and what its buttons do.
 *
 * The editor's modal is a port here, so the questions are asserted as they would be read: the
 * "Hermes was updated from X to Y" dialog only when the version changed, nothing at all when it did
 * not, and the fix only after the Patch button.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import assert from 'assert';
import { ALL_PATCHES } from '../../host/environment/hermesPatches';
import { GitResult } from '../../host/environment/patchState';
import { createPatchVersionStore, PatchSetup } from '../../host/patches/patchSetup';

interface Dialog {
    message: string;
    actions: string[];
    detail?: string;
}

function workspace(): { checkout: string; patchDir: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-setup-'));
    const checkout = path.join(root, 'hermes-agent');
    fs.mkdirSync(path.join(checkout, 'acp_adapter'), { recursive: true });
    const patchDir = path.join(root, 'patches');
    fs.mkdirSync(patchDir, { recursive: true });
    for (const patch of ALL_PATCHES) {
        fs.writeFileSync(path.join(patchDir, patch.file), 'diff --git a/x b/x\n');
    }
    return { checkout, patchDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const idOf = (file: string): string => ALL_PATCHES.find(patch => file.endsWith(patch.file))?.id ?? '?';

function harness(options: { version: string; present?: string[]; applicable?: string[]; answers?: string[] }) {
    const { checkout, patchDir, cleanup } = workspace();
    const dialogs: Dialog[] = [];
    const logs: string[] = [];
    const answers = [...(options.answers ?? [])];
    const present = new Set(options.present ?? []);
    const applicable = new Set(options.applicable ?? []);
    const calls: string[][] = [];
    let reconnects = 0;
    let stored: { checkout: string; version: string } | undefined;

    const run = async (args: string[]): Promise<GitResult> => {
        calls.push(args);
        const file = args[args.length - 1];
        if (args[0] === 'diff' && args[1] === '--quiet') {
            return { code: 0, output: '' };
        }
        if (args[1] === '--reverse' && args[2] === '--check') {
            return { code: present.has(idOf(file)) ? 0 : 1, output: '' };
        }
        if (args[1] === '--check') {
            return { code: applicable.has(idOf(file)) ? 0 : 1, output: '' };
        }
        if (args[1] === '--reverse') {
            present.delete(idOf(file));
            return { code: 0, output: '' };
        }
        if (args[1] === '--3way') {
            present.add(idOf(file));
            return { code: 0, output: '' };
        }
        return { code: 1, output: 'unexpected' };
    };

    const setup = new PatchSetup({
        checkout: () => checkout,
        patchDir: () => patchDir,
        hermesVersion: () => options.version,
        run,
        log: (line) => { logs.push(line); },
        store: {
            read: () => stored,
            write: (at, version) => { stored = { checkout: at, version }; },
        },
        choices: {
            pick: async () => undefined,
            prompt: async () => undefined,
            pickFolder: async () => undefined,
            showInFileManager: async () => undefined,
            home: () => '/home',
            ask: async () => undefined,
            modal: async (message, actions, detail) => {
                dialogs.push({ message, actions, detail });
                return answers.shift();
            },
        },
        reconnect: async () => { reconnects += 1; },
    });

    return {
        setup,
        checkout,
        dialogs,
        logs,
        calls,
        get reconnects() { return reconnects; },
        store: { get value() { return stored; }, set value(v) { stored = v; } },
        cleanup,
    };
}

describe('the patch dialog', () => {
    it('says nothing on a start where the set is already right', async () => {
        const h = harness({ version: '0.23.3', present: ['0003'] });
        try {
            await h.setup.onConnect();
            assert.deepStrictEqual(h.dialogs, [], 'no dialog');
            assert.strictEqual(h.store.value?.version, '0.23.3', 'the version is remembered');
        } finally {
            h.cleanup();
        }
    });

    it('says nothing again for the same version', async () => {
        const h = harness({ version: '0.23.3', present: ['0003'] });
        try {
            await h.setup.onConnect();
            h.calls.length = 0;
            h.store.value = { checkout: h.checkout, version: '0.23.3' };
            await h.setup.onConnect();
            assert.deepStrictEqual(h.dialogs, [], 'no dialog');
            assert.deepStrictEqual(h.calls, [], 'and no git call at all');
        } finally {
            h.cleanup();
        }
    });

    it('offers the test after an update, and the fix after the test', async () => {
        const h = harness({
            version: '0.23.4',
            present: ['0001', '0002'],
            applicable: ['0003'],
            answers: ['Test patch', 'Patch', 'Reconnect'],
        });
        try {
            h.store.value = { checkout: h.checkout, version: '0.22.6' };
            await h.setup.onConnect();
            assert.strictEqual(h.dialogs.length, 3, JSON.stringify(h.dialogs));
            assert.ok(h.dialogs[0].message.includes('0.22.6') && h.dialogs[0].message.includes('0.23.4'), h.dialogs[0].message);
            assert.deepStrictEqual(h.dialogs[0].actions, ['Test patch', 'Not now']);
            assert.deepStrictEqual(h.dialogs[1].actions, ['Patch', 'Not now']);
            assert.ok(h.dialogs[1].message.includes('0.23.4') && h.dialogs[1].message.includes('0003'), h.dialogs[1].message);
            assert.ok(h.dialogs[2].message.includes('0003'), h.dialogs[2].message);
            assert.strictEqual(h.reconnects, 1, 'reconnect asked for');
            assert.strictEqual(h.store.value?.version, '0.23.4');
        } finally {
            h.cleanup();
        }
    });

    it('shows the state on the first start only when it is not ok', async () => {
        const h = harness({ version: '0.23.3', present: ['0001', '0002'], applicable: ['0003'] });
        try {
            await h.setup.onConnect();
            assert.strictEqual(h.dialogs.length, 1, JSON.stringify(h.dialogs));
            assert.ok(h.dialogs[0].message.includes('0001 + 0002'), h.dialogs[0].message);
            assert.deepStrictEqual(h.dialogs[0].actions, ['Patch', 'Not now']);
        } finally {
            h.cleanup();
        }
    });

    it('changes nothing when the state cannot be decided', async () => {
        const h = harness({ version: '0.24.0', answers: ['OK'] });
        try {
            await h.setup.onConnect();
            assert.strictEqual(h.dialogs.length, 1, JSON.stringify(h.dialogs));
            assert.deepStrictEqual(h.dialogs[0].actions, ['Details', 'OK']);
            assert.deepStrictEqual(h.calls, [], 'no git command was run');
        } finally {
            h.cleanup();
        }
    });
});

describe('the version store', () => {
    it('round-trips one checkout and version, and answers nothing when the file is absent', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-store-'));
        try {
            const store = createPatchVersionStore(() => dir);
            assert.strictEqual(store.read(), undefined);
            store.write('/home/skdj/.hermes/hermes-agent', '0.23.4');
            assert.deepStrictEqual(store.read(), { checkout: '/home/skdj/.hermes/hermes-agent', version: '0.23.4' });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
