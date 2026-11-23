import type { EditorChoices, EditorNotices } from '../../shared/editor';
import type { DesktopStore } from './store';
import { minimizeToTrayEnabled, setTrayShortcut, trayShortcutInstalled } from '../environment/desktopTray';
import { t } from '../i18n';

/**
 * Hermes Desktop started in the tray when the user logs in — a Windows question, asked once.
 *
 * The order of things here is deliberate:
 * - nothing is asked when there is no Desktop to start, or on a machine that is not Windows;
 * - the launch scripts are copied into our own data home, and one Startup shortcut points at them,
 *   so an extension update cannot leave the login item pointing at a folder that no longer exists;
 * - the shortcut is ours and only ours: removing it removes that file and nothing else, in a folder
 *   the user's other logins live in;
 * - Desktop's own close-to-tray setting is read, never written (H2). With it off, closing the window
 *   would quit the app, so the launcher starts it normally instead — and the user is told once where
 *   that setting is, because we cannot turn it on for them.
 */

/** How long "Remind me in 2 weeks" waits. */
export const TRAY_ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;

/** The menu's context key: which of the two entries the user sees. */
export const TRAY_CONTEXT_KEY = 'tommysDesktopTraySet';

/** What the tray step needs from outside: this machine, the editor's notifications, and our paths. */
export interface TrayHost {
    platform(): NodeJS.Platform;
    /** The extension's own folder: `packaging/windows/` hangs off it. */
    scriptFolder(): string;
    /** Windows' Startup folder, where our one shortcut goes. */
    startupFolder(): string;
    /** The menu's context key, so the entry flips as soon as the shortcut does. */
    setContext(key: string, value: boolean): void;
    choices: EditorChoices;
    notices: EditorNotices;
    log(line: string): void;
    now(): number;
}

export class DesktopTray {
    /** One notice per run at most: Desktop's setting can be turned off later, but not nagged about. */
    private _warned = false;

    /**
     * `shortcut` and `trayEnabled` are the two things a test must not do for real — write to the
     * user's Startup folder, and read Desktop's own settings file. The defaults are the shipped
     * behaviour; a test passes fakes.
     */
    constructor(
        private readonly _store: DesktopStore,
        private readonly _host: TrayHost,
        private readonly _shortcut: typeof setTrayShortcut = setTrayShortcut,
        private readonly _trayEnabled: () => boolean = () => minimizeToTrayEnabled(),
    ) {}

    /**
     * Called once per start, on a machine whose Desktop exists.
     *
     * Asks the first-run question when it is due, and otherwise only makes sure the menu shows the
     * right entry — plus one reminder when our shortcut is there but Desktop would not honour it.
     */
    async askIfDue(desktopExists: boolean): Promise<void> {
        if (this._host.platform() !== 'win32') {
            return;
        }
        this.refreshContext();
        if (!desktopExists) {
            this._host.log('Tray: no Desktop on this machine; nothing to start at login');
            return;
        }
        if (this.installed()) {
            await this._warnIfDesktopSettingOff();
            return;
        }
        if (!this._due()) {
            return;
        }
        const yes = t('trayAskYes');
        const answer = await this._host.choices.ask(t('trayAsk'), [yes, t('trayAskLater'), t('trayAskNever')]);
        if (!answer) {
            // Closed: nothing written, so the next start asks again.
            return;
        }
        if (answer === yes) {
            await this.install();
            return;
        }
        if (answer === t('trayAskLater')) {
            this._store.writeTrayQuestion('later', this._host.now() + TRAY_ASK_AGAIN_MS);
            return;
        }
        if (answer === t('trayAskNever')) {
            this._store.writeTrayQuestion('never', 0);
        }
    }

    /** The menu's "start in the tray": the same work as answering Yes, asked by a click. */
    async install(): Promise<void> {
        if (this._host.platform() !== 'win32') {
            this._host.notices.warn(t('trayWindowsOnly'));
            return;
        }
        const { dir, missing } = this._store.installScripts(this._host.scriptFolder());
        if (missing.length > 0) {
            this._host.log(`Tray: the shipped scripts are missing from ${this._host.scriptFolder()}: ${missing.join(', ')}`);
            this._host.notices.warn(t('trayFailed', `missing ${missing.join(', ')}`));
            return;
        }
        const result = await this._shortcut('enable', dir, this._host.startupFolder(), this._store.trayLauncher());
        this._host.log(`Tray: enable -> ${result.ok ? 'ok' : 'failed'}: ${result.message}`);
        this.refreshContext();
        if (!result.ok) {
            this._host.notices.warn(t('trayFailed', result.message));
            return;
        }
        this._host.notices.info(t('trayInstalled', this._host.startupFolder()));
        await this._warnIfDesktopSettingOff();
    }

    /** The menu's turn-off: our shortcut, and nothing else in that folder. */
    async remove(): Promise<void> {
        if (this._host.platform() !== 'win32') {
            return;
        }
        const result = await this._shortcut('disable', this._store.trayScriptsDir(), this._host.startupFolder());
        this._host.log(`Tray: disable -> ${result.ok ? 'ok' : 'failed'}: ${result.message}`);
        this.refreshContext();
        if (result.ok) {
            this._host.notices.info(t('trayRemoved', result.message));
        } else {
            this._host.notices.warn(t('trayFailed', result.message));
        }
    }

    /** Whether our shortcut is on disk. The menu key and this answer come from the same file. */
    installed(): boolean {
        return trayShortcutInstalled(this._host.startupFolder());
    }

    refreshContext(): void {
        this._host.setContext(TRAY_CONTEXT_KEY, this.installed());
    }

    /** Is the question due? No answer yet, or a `later` whose date has passed. */
    private _due(): boolean {
        const answer = this._store.readTrayQuestion();
        if (!answer) {
            return true;
        }
        return answer.answer === 'later' && this._host.now() >= answer.askAfter;
    }

    /**
     * Desktop can only start in the tray if its own close-to-tray is on; with it off, closing the
     * window quits the app. We read that setting and cannot write it (H2), so we say where it is.
     */
    private async _warnIfDesktopSettingOff(): Promise<void> {
        if (this._warned || this._trayEnabled()) {
            return;
        }
        this._warned = true;
        this._host.log('Tray: Desktop\'s own close-to-tray setting is off');
        this._host.notices.info(t('traySettingOff'));
    }
}
