/**
 * The tray question, the one shortcut it may write, and the notice about Desktop's own setting.
 *
 * Windows only, and nothing here runs PowerShell: the two things that touch the machine — the
 * shortcut and Desktop's settings file — arrive as the two fakes the constructor takes. What is
 * under test is the decision: asked once, installed only on Yes, removed only ours, and said out
 * loud when Desktop would not honour it.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesktopStore } from '../../host/desktop/store';
import { DesktopTray, TRAY_ASK_AGAIN_MS, TRAY_CONTEXT_KEY } from '../../host/desktop/tray';
import type { TrayHost } from '../../host/desktop/tray';
import { TRAY_LINK_NAME, TRAY_SCRIPTS } from '../../host/environment/desktopTray';
import type { TraySetupResult } from '../../host/environment/desktopTray';
import { t } from '../../host/i18n';

const home = (): { data: string; startup: string; scripts: string } => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-data-'));
    const startup = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-startup-'));
    const scripts = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-scripts-'));
    for (const name of TRAY_SCRIPTS) {
        fs.writeFileSync(path.join(scripts, name), '');
    }
    return { data, startup, scripts };
};

/** The tray step over a fake machine: the real store, and fakes where the machine would be touched. */
const trayOver = (options: {
    data: string;
    startup: string;
    scripts: string;
    platform?: NodeJS.Platform;
    answers?: Array<string | undefined>;
    trayEnabled?: boolean;
    now?: number;
    shortcutResult?: TraySetupResult;
}) => {
    const store = new DesktopStore(options.data);
    const asked: Array<{ message: string; actions: string[] }> = [];
    const infos: string[] = [];
    const warns: string[] = [];
    const logs: string[] = [];
    const contexts: Array<{ key: string; value: boolean }> = [];
    const actions: string[] = [];
    const answers = [...(options.answers ?? [])];
    const host: TrayHost = {
        platform: () => options.platform ?? 'win32',
        scriptFolder: () => options.scripts,
        startupFolder: () => options.startup,
        setContext: (key, value) => { contexts.push({ key, value }); },
        choices: {
            pick: async () => undefined,
            prompt: async () => undefined,
            pickFolder: async () => undefined,
            home: () => os.homedir(),
            showInFileManager: async () => {},
            ask: async (message, actionsGiven) => {
                asked.push({ message, actions: actionsGiven });
                return answers.shift();
            },
        },
        notices: {
            info: (message) => { infos.push(message); },
            warn: (message) => { warns.push(message); },
        },
        log: (line) => { logs.push(line); },
        now: () => options.now ?? Date.now(),
    };
    // The shortcut fake performs the one filesystem change the real script performs, so
    // `installed()` and the context key answer as they would on Windows.
    const shortcut = async (action: 'enable' | 'disable', _dir: string, startup = ''): Promise<TraySetupResult> => {
        actions.push(action);
        if (options.shortcutResult && !options.shortcutResult.ok) {
            return options.shortcutResult;
        }
        const link = path.join(startup, TRAY_LINK_NAME);
        if (action === 'enable') {
            fs.writeFileSync(link, '');
        } else {
            fs.rmSync(link, { force: true });
        }
        return { ok: true, message: action === 'enable' ? `wrote ${link}` : `removed ${link}` };
    };
    const tray = new DesktopTray(store, host, shortcut, () => options.trayEnabled !== false);
    return { tray, store, asked, infos, warns, logs, contexts, actions };
};

const clean = (...dirs: string[]): void => {
    for (const dir of dirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

describe('the tray question: asked once, and only on Windows', () => {
    it('is not asked on Linux', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, platform: 'linux', answers: [t('trayAskYes')] });
        await it.tray.askIfDue(true);
        assert.deepStrictEqual(it.asked, [], 'no question');
        assert.deepStrictEqual(it.actions, [], 'no shortcut');
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('is not asked when there is no Desktop to start', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, answers: [t('trayAskYes')] });
        await it.tray.askIfDue(false);
        assert.deepStrictEqual(it.asked, [], 'nothing to start at login, nothing to ask');
        assert.ok(it.logs.some(line => line.includes('no Desktop')), it.logs.join(' | '));
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('asks with three answers', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, answers: [undefined] });
        await it.tray.askIfDue(true);
        assert.strictEqual(it.asked.length, 1);
        assert.strictEqual(it.asked[0].message, t('trayAsk'));
        assert.deepStrictEqual(it.asked[0].actions, [t('trayAskYes'), t('trayAskLater'), t('trayAskNever')]);
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('writes the shortcut on Yes, and says where it is', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, answers: [t('trayAskYes')] });
        await it.tray.askIfDue(true);
        assert.deepStrictEqual(it.actions, ['enable'], 'one shortcut written');
        assert.ok(fs.existsSync(path.join(dirs.startup, TRAY_LINK_NAME)), 'the login item is there');
        assert.ok(it.infos.some(message => message.includes(dirs.startup)), it.infos.join(' | '));
        assert.deepStrictEqual(it.contexts.at(-1), { key: TRAY_CONTEXT_KEY, value: true }, 'the menu flips');
        assert.deepStrictEqual(
            fs.readdirSync(path.join(dirs.data, 'desktop', 'tray')).sort(),
            [...TRAY_SCRIPTS].sort(),
            'the scripts are copied into our data home, not run from the extension folder',
        );
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('writes no shortcut on "Remind me in 2 weeks", and is due again after them', async () => {
        const dirs = home();
        const now = 1_700_000_000_000;
        const first = trayOver({ ...dirs, answers: [t('trayAskLater')], now });
        await first.tray.askIfDue(true);
        assert.deepStrictEqual(first.actions, [], 'a postpone writes nothing');
        assert.strictEqual(first.store.readTrayQuestion()?.askAfter, now + TRAY_ASK_AGAIN_MS);

        const early = trayOver({ ...dirs, answers: [t('trayAskYes')], now: now + 1000 });
        await early.tray.askIfDue(true);
        assert.deepStrictEqual(early.asked, [], 'not yet due');

        const late = trayOver({ ...dirs, answers: [t('trayAskLater')], now: now + TRAY_ASK_AGAIN_MS + 1 });
        await late.tray.askIfDue(true);
        assert.strictEqual(late.asked.length, 1, 'two weeks later it is asked again');
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('writes no shortcut on "Don\'t ask again", and never asks again', async () => {
        const dirs = home();
        const first = trayOver({ ...dirs, answers: [t('trayAskNever')] });
        await first.tray.askIfDue(true);
        assert.deepStrictEqual(first.actions, []);
        assert.strictEqual(first.store.readTrayQuestion()?.answer, 'never');

        const second = trayOver({ ...dirs, answers: [t('trayAskYes')], now: Date.now() + 10 * TRAY_ASK_AGAIN_MS });
        await second.tray.askIfDue(true);
        assert.deepStrictEqual(second.asked, [], 'never means never');
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('asks again next start when the notice was closed unanswered', async () => {
        const dirs = home();
        const first = trayOver({ ...dirs, answers: [undefined] });
        await first.tray.askIfDue(true);
        assert.strictEqual(first.store.readTrayQuestion(), undefined, 'a closed notice records nothing');
        const second = trayOver({ ...dirs, answers: [t('trayAskYes')] });
        await second.tray.askIfDue(true);
        assert.strictEqual(second.asked.length, 1);
        clean(dirs.data, dirs.startup, dirs.scripts);
    });
});

describe('the tray notice: Desktop\'s own setting decides whether it works', () => {
    it('says where the setting is when it is off, once per run', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, answers: [t('trayAskYes')], trayEnabled: false });
        await it.tray.askIfDue(true);
        assert.ok(it.infos.includes(t('traySettingOff')), it.infos.join(' | '));
        await it.tray.askIfDue(true);
        assert.strictEqual(
            it.infos.filter(message => message === t('traySettingOff')).length,
            1,
            'one notice, not a nag',
        );
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('says nothing when Desktop would honour it', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, answers: [t('trayAskYes')], trayEnabled: true });
        await it.tray.askIfDue(true);
        assert.ok(!it.infos.includes(t('traySettingOff')), it.infos.join(' | '));
        clean(dirs.data, dirs.startup, dirs.scripts);
    });
});

describe('the tray menu entries', () => {
    it('install puts the shortcut in place, without asking anything', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs });
        await it.tray.install();
        assert.deepStrictEqual(it.asked, [], 'a click is not a question');
        assert.deepStrictEqual(it.actions, ['enable']);
        assert.ok(fs.existsSync(path.join(dirs.startup, TRAY_LINK_NAME)));
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('remove takes our shortcut and leaves every other login entry alone', async () => {
        const dirs = home();
        const foreign = path.join(dirs.startup, 'Someone else.lnk');
        fs.writeFileSync(foreign, '');
        const it = trayOver({ ...dirs, answers: [t('trayAskYes')] });
        await it.tray.askIfDue(true);
        assert.ok(fs.existsSync(path.join(dirs.startup, TRAY_LINK_NAME)), 'ours is there first');

        await it.tray.remove();
        assert.deepStrictEqual(it.actions, ['enable', 'disable']);
        assert.ok(!fs.existsSync(path.join(dirs.startup, TRAY_LINK_NAME)), 'ours is gone');
        assert.ok(fs.existsSync(foreign), 'and only ours');
        assert.deepStrictEqual(it.contexts.at(-1), { key: TRAY_CONTEXT_KEY, value: false });
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('reports a shortcut script that failed, instead of pretending', async () => {
        const dirs = home();
        const it = trayOver({ ...dirs, shortcutResult: { ok: false, message: 'access denied' } });
        await it.tray.install();
        assert.strictEqual(it.warns.length, 1);
        assert.ok(it.warns[0].includes('access denied'), it.warns[0]);
        assert.ok(!fs.existsSync(path.join(dirs.startup, TRAY_LINK_NAME)));
        clean(dirs.data, dirs.startup, dirs.scripts);
    });

    it('names the scripts that are missing rather than installing a login item that runs nothing', async () => {
        const dirs = home();
        fs.rmSync(dirs.scripts, { recursive: true, force: true });
        fs.mkdirSync(dirs.scripts, { recursive: true });
        const it = trayOver({ ...dirs });
        await it.tray.install();
        assert.deepStrictEqual(it.actions, [], 'nothing installed');
        assert.strictEqual(it.warns.length, 1);
        assert.ok(it.warns[0].includes('Start-HermesInTray.vbs'), it.warns[0]);
        clean(dirs.data, dirs.startup, dirs.scripts);
    });
});
