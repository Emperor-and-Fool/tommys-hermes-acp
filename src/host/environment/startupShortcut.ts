import * as path from 'path';

/**
 * The one Startup shortcut we own, and the folder it may go in.
 *
 * Windows runs every `.lnk` in `Startup` at login. That folder belongs to the user: it holds every
 * program they added there. The installer writes one file per thing it installs and removes exactly
 * those files (extras/KDEdesktopGui/installer_gui.py, through packaging/windows/Set-HermesTrayShortcut.ps1);
 * this module only answers where that folder is, for the one migration that still has to look in it.
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
