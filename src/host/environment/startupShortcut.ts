import * as fs from 'fs';
import * as path from 'path';

/**
 * The one Startup shortcut we own, and the folder it may go in.
 *
 * Windows runs every `.lnk` in `Startup` at login. That folder belongs to the user: it holds every
 * program they added there. So we write one file per thing we install, name it, and remove exactly
 * that file — never a sweep of the folder. Linux has no such folder (systemd user units instead);
 * there these helpers answer '' and callers do nothing.
 */

/** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`, or '' off Windows. */
export function startupFolder(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string {
    if (platform !== 'win32') {
        return '';
    }
    const appData = (env.APPDATA || '').trim();
    if (!appData) {
        return '';
    }
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

/** One shortcut by name, or '' when there is no Startup folder to write it in. */
export function shortcutPath(name: string, startup: string = startupFolder()): string {
    return startup ? path.join(startup, name) : '';
}

export function shortcutInstalled(name: string, startup: string = startupFolder()): boolean {
    const target = shortcutPath(name, startup);
    return !!target && fs.existsSync(target);
}

/** What one shortcut write answered. */
export interface ShortcutResult {
    ok: boolean;
    /** What the script said, or why it never ran. */
    message: string;
}
