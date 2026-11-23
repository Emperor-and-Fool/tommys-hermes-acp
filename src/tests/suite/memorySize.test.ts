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

describe('the dialog: three answers, one confirmation, Hermes\' verdict', () => {
    const usage = { name: 'kitt', fill: 2210, limit: 2200 };

    it('offers double first, then the file as it is, then a number of its own', async () => {
        const d = dialog(usage);
        await d.size.run('id-kitt');
        assert.strictEqual(
            d.picks[0].title,
            t('memorySizeTitle', 'kitt', '2,210', '2,200', 100),
            'the title is the agent, the fill, the limit and the percentage',
        );
        assert.deepStrictEqual(d.picks[0].items.map(item => item.label), [
            t('memorySizeDouble', '4,420'),
            t('memorySizeKeep', '2,210'),
            t('memorySizeOther'),
        ]);
        assert.strictEqual(d.picks[0].items[0].suggested, true, 'the double is the suggested row');
    });

    it('says the cost in tokens before applying, and sets the doubled limit', async () => {
        const d = dialog(usage, 'double', undefined, t('memorySizeApply'));
        await d.size.run('id-kitt');

        const confirm = d.asked.find(entry => entry.startsWith('About +')) || '';
        assert.ok(confirm.includes('+807'), `+2220 characters / 2.75 is 807 tokens, got "${confirm}"`);
        assert.ok(confirm.includes('every session of kitt'));
        assert.deepStrictEqual(d.set, [{ id: 'id-kitt', limit: 4420 }]);
        assert.ok(d.infos[d.infos.length - 1].startsWith('Memory limit set to 4,420 for kitt'));
    });

    it('"Keep" writes the file\'s own size, and nothing when that is the limit already', async () => {
        const d = dialog(usage, 'keep', undefined, t('memorySizeApply'));
        await d.size.run('id-kitt');
        assert.deepStrictEqual(d.set, [{ id: 'id-kitt', limit: 2210 }]);

        const same = dialog({ name: 'kitt', fill: 2210, limit: 2210 }, 'keep');
        await same.size.run('id-kitt');
        assert.deepStrictEqual(same.set, [], 'nothing to write');
        assert.deepStrictEqual(same.infos, [t('memorySizeUnchanged', '2,210', 'kitt')]);
    });

    it('"Other…" takes a number, and refuses one below the file', async () => {
        const ok = dialog(usage, 'other', '3,000', t('memorySizeApply'));
        await ok.size.run('id-kitt');
        assert.ok(ok.asked[0].includes('at least 2,210'));
        assert.deepStrictEqual(ok.set, [{ id: 'id-kitt', limit: 3000 }]);

        const low = dialog(usage, 'other', '1000', t('memorySizeApply'));
        await low.size.run('id-kitt');
        assert.deepStrictEqual(low.set, [], 'below the fill is refused');
        assert.deepStrictEqual(low.infos, [t('memorySizeInvalid', '2,210')]);
    });

    it('a dismissed confirm applies nothing', async () => {
        const d = dialog(usage, 'double', undefined, t('memorySizeCancel'));
        await d.size.run('id-kitt');
        assert.deepStrictEqual(d.set, []);
        assert.deepStrictEqual(d.infos, []);
    });

    it('shows Hermes\' own error when the CLI refuses', async () => {
        const d = dialog(usage, 'double', undefined, t('memorySizeApply'));
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
