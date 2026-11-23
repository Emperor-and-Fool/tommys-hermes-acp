/**
 * "Agent memory size…": what the numbers mean, and what the dialog does with them.
 *
 * Everything runs on temp folders: the memory file and the config.yaml are Hermes' own and are only
 * read here. The one write goes through the CLI, so nothing in these tests spawns a process — the
 * fake answers with what `hermes config set` would have said.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { countText, MemorySize } from '../../host/notes/memory';
import type { MemorySizeHost } from '../../host/notes/memory';
import {
    DEFAULT_MEMORY_LIMIT,
    memoryFill,
    memoryLimitFor,
    memoryPathFor,
    profileConfigPathFor,
} from '../../host/environment/profileMemory';
import { configSetArgs } from '../../host/environment/hermesConfig';
import { t } from '../../host/i18n';
import type { EditorChoiceItem, EditorChoices } from '../../shared/editor';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'memory-size-'));

/** A Hermes home with one profile's MEMORY.md and config.yaml written as Hermes would. */
const homeWith = (profile: string, memory: string, config: string): string => {
    const hermes = dir();
    const memoryFile = memoryPathFor(profile, hermes);
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(memoryFile, memory);
    const configFile = profileConfigPathFor(profile, hermes);
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, config);
    return hermes;
};

/** The dialog over a fixed set of numbers, recording what it was asked and what it set. */
const dialog = (usage: { name: string; fill: number; limit: number }, answer?: string, typed?: string, confirm?: string) => {
    const picks: Array<{ title: string; items: EditorChoiceItem[] }> = [];
    const asked: string[] = [];
    const infos: string[] = [];
    const logs: string[] = [];
    const set: Array<{ id: string; limit: number }> = [];
    const result = { ok: true, message: 'Set memory.memory_char_limit = ' + (usage.limit * 2) };
    const choices = {
        pick: async (title: string, items: EditorChoiceItem[]) => {
            picks.push({ title, items });
            return answer;
        },
        prompt: async (title: string) => {
            asked.push(title);
            return typed;
        },
        ask: async (message: string, _actions: string[]) => {
            asked.push(message);
            return confirm;
        },
    } as unknown as EditorChoices;
    const host: MemorySizeHost = {
        log: line => logs.push(line),
        info: message => infos.push(message),
        choices,
        usage: () => usage,
        setLimit: async (id: string, limit: number) => {
            set.push({ id, limit });
            return result;
        },
    };
    return { size: new MemorySize(host), picks, asked, infos, logs, set };
};

describe('the numbers the dialog shows', () => {
    it('counts thousands, and says nothing else', () => {
        assert.strictEqual(countText(2210), '2,210');
        assert.strictEqual(countText(4420), '4,420');
        assert.strictEqual(countText(999), '999');
        assert.strictEqual(countText(0), '0');
    });

    it('reads the fill from MEMORY.md, and the limit from config.yaml', () => {
        const hermes = homeWith('kitt', 'x'.repeat(2210), 'memory:\n  memory_char_limit: 3000\n');
        try {
            assert.strictEqual(memoryFill('kitt', hermes), 2210);
            assert.strictEqual(memoryLimitFor('kitt', hermes), 3000);
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('falls back to Hermes\' default when the key, the block, or the file is missing', () => {
        const noKey = homeWith('kitt', '', 'agent:\n  name: kitt\n');
        const otherBlock = homeWith('iris', '', 'agent:\n  memory_char_limit: 9999\n');
        try {
            assert.strictEqual(memoryLimitFor('kitt', noKey), DEFAULT_MEMORY_LIMIT);
            assert.strictEqual(memoryLimitFor('iris', otherBlock), DEFAULT_MEMORY_LIMIT, 'the key is only read inside memory:');
            assert.strictEqual(memoryLimitFor('nobody', noKey), DEFAULT_MEMORY_LIMIT, 'no file at all');
            assert.strictEqual(memoryFill('nobody', noKey), 0, 'no memory file is nothing to count');
        } finally {
            fs.rmSync(noKey, { recursive: true, force: true });
            fs.rmSync(otherBlock, { recursive: true, force: true });
        }
    });

    it('counts characters the way Hermes does, not UTF-16 units', () => {
        const hermes = homeWith('kitt', 'aé☃🙂', '');
        try {
            assert.strictEqual(memoryFill('kitt', hermes), 4, 'four characters, not the bytes or the surrogate pairs');
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });
});

describe('the dialog: a fixed recommendation, a look-only "Keep", and Hermes\' verdict', () => {
    const usage = { name: 'kitt', fill: 2210, limit: 2200 };

    it('recommends twice Hermes\' default, and only while the agent is under it', async () => {
        const under = dialog(usage);
        await under.size.run('id-kitt');
        assert.strictEqual(under.picks[0].title, t('memorySizeTitle', 'kitt', '2,210', '2,200', 100));
        assert.deepStrictEqual(under.picks[0].items.map(item => item.label), [
            t('memorySizeRecommended', '4,400'),
            t('memorySizeKeep', '2,200'),
            t('memorySizeOther'),
        ]);
        assert.strictEqual(under.picks[0].items[0].suggested, true);

        // dev-vsc after cc73048: 4,350 is under 4,400, so the row is still offered — with the
        // limit it would set, not with a doubling of the file.
        const raised = dialog({ name: 'dev-vsc', fill: 2175, limit: 4350 });
        await raised.size.run('id-dev');
        assert.deepStrictEqual(raised.picks[0].items.map(item => item.label), [
            t('memorySizeRecommended', '4,400'),
            t('memorySizeKeep', '4,350'),
            t('memorySizeOther'),
        ]);

        const above = dialog({ name: 'kitt', fill: 2210, limit: 4400 });
        await above.size.run('id-kitt');
        assert.deepStrictEqual(above.picks[0].items.map(item => item.label), [
            t('memorySizeKeep', '4,400'),
            t('memorySizeOther'),
        ], 'at or above the recommendation there is no recommended row');
        assert.strictEqual(above.picks[0].items[0].suggested, undefined);
    });

    it('says the cost in tokens before applying, and sets the recommendation', async () => {
        const d = dialog(usage, 'recommended', undefined, t('memorySizeApply'));
        await d.size.run('id-kitt');

        const confirm = d.asked.find(entry => entry.startsWith('About +')) || '';
        assert.ok(confirm.includes('+800'), `+2200 characters / 2.75 is 800 tokens, got "${confirm}"`);
        assert.ok(confirm.includes('every session of kitt'));
        assert.deepStrictEqual(d.set, [{ id: 'id-kitt', limit: 4400 }]);
        assert.ok(d.infos[d.infos.length - 1].startsWith('Memory limit set to 4,400 for kitt'));
    });

    it('"Keep" is the limit in force: no write, no CLI call, no notice', async () => {
        const d = dialog({ name: 'dev-vsc', fill: 2175, limit: 4350 }, 'keep');
        await d.size.run('id-dev');
        assert.deepStrictEqual(d.set, []);
        assert.deepStrictEqual(d.infos, []);
        assert.deepStrictEqual(d.asked, [], 'nothing is confirmed either');
    });

    it('"Other…" takes a number, refuses one below the file, and confirms a lowering once more', async () => {
        const ok = dialog(usage, 'other', '3,000', t('memorySizeApply'));
        await ok.size.run('id-kitt');
        assert.ok(ok.asked[0].includes('at least 2,210'));
        assert.deepStrictEqual(ok.set, [{ id: 'id-kitt', limit: 3000 }]);

        const low = dialog(usage, 'other', '1000', t('memorySizeApply'));
        await low.size.run('id-kitt');
        assert.deepStrictEqual(low.set, [], 'below the fill is refused');
        assert.deepStrictEqual(low.infos, [t('memorySizeInvalid', '2,210')]);

        // A lowering: limit 4,350 → 3,000, with the fill already under it. Two answers, in order.
        const lowered = dialog({ name: 'dev-vsc', fill: 2175, limit: 4350 }, 'other', '3000');
        lowered.asked.length = 0;
        (lowered.size as unknown as { _host: { choices: { ask: unknown } } })._host.choices.ask =
            async (message: string) => message.startsWith('Lower the limit')
                ? t('memorySizeLowerConfirm')
                : t('memorySizeApply');
        await lowered.size.run('id-dev');
        assert.deepStrictEqual(lowered.set, [{ id: 'id-dev', limit: 3000 }], 'lowering applied after both answers');
        assert.ok(lowered.asked.some(entry => entry.includes('fewer tokens')), 'and the cost is said as fewer');
    });

    it('a dismissed confirm applies nothing', async () => {
        const d = dialog(usage, 'recommended', undefined, t('memorySizeCancel'));
        await d.size.run('id-kitt');
        assert.deepStrictEqual(d.set, []);
        assert.deepStrictEqual(d.infos, []);
    });

    it('shows the same number, twice, as nothing to do', async () => {
        // The typed number is the limit already in force, and it is not below the file: the file
        // sits exactly at it, which is the case the dialog can answer with "nothing to do".
        const d = dialog({ name: 'kitt', fill: 2200, limit: 2200 }, 'other', '2200', t('memorySizeApply'));
        await d.size.run('id-kitt');
        assert.deepStrictEqual(d.set, []);
        assert.deepStrictEqual(d.infos, [t('memorySizeUnchanged', '2,200', 'kitt')]);
    });

    it('shows Hermes\' own error when the CLI refuses', async () => {
        const d = dialog(usage, 'recommended', undefined, t('memorySizeApply'));
        (d.size as unknown as { _host: MemorySizeHost })._host.setLimit = async () => ({
            ok: false,
            message: 'unknown config key "memory.memory_char_limit"',
        });
        await d.size.run('id-kitt');
        assert.ok(d.infos[0].startsWith('Hermes could not set the limit: unknown config key'));
    });
});

describe('the command Hermes is given', () => {
    it('names the profile with -p, then config set, the key and the number', () => {
        assert.deepStrictEqual(
            configSetArgs('kitt', 'memory.memory_char_limit', '4420'),
            ['-p', 'kitt', 'config', 'set', 'memory.memory_char_limit', '4420'],
        );
    });
});
