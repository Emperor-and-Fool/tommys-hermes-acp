import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { electronCapableEnv } from './childEnv';

/**
 * Windows' start-in-tray: the files it needs, the Startup shortcut, and what Desktop itself says.
 *
 * Three facts live here, and none of them is ours to write except the one shortcut:
 * - Desktop's own `minimize-to-tray.json` is read, never written (H2): whether closing the window
 *   hides it is Desktop's setting, set in Desktop's own UI;
 * - our shortcut is `<Startup>\Hermes Desktop (tray).lnk`, and the launch scripts are copied into our
 *   data home first, so an extension update cannot leave the login item pointing at nothing;
 * - the shortcut is written and removed by the script beside them, through PowerShell, because a
 *   `.lnk` cannot be made any other way on Windows.
 */

/** The one shortcut this extension owns. Named for the app, so the user can see what it is. */
export const TRAY_LINK_NAME = 'Hermes Desktop (tray).lnk';

/** The scripts, as they are shipped inside the extension under `packaging/windows/`. */
export const TRAY_SCRIPTS = ['Start-HermesInTray.vbs', 'Start-HermesInTray.ps1', 'Set-HermesTrayShortcut.ps1'];

/** The launcher a login item runs: the `.vbs`, so no console window is ever shown. */
export const TRAY_LAUNCHER = 'Start-HermesInTray.vbs';

/** How long the shortcut script may take. It writes one file. */
const SETUP_TIMEOUT_MS = 60_000;

/** The user's Startup folder: what Windows runs when they log in. */
export function startupFolder(appData: string = process.env.APPDATA || ''): string {
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function trayShortcutPath(startup: string): string {
    return path.join(startup, TRAY_LINK_NAME);
}

export function trayShortcutInstalled(startup: string = startupFolder()): boolean {
    return fs.existsSync(trayShortcutPath(startup));
}

/**
 * Whether Desktop's own close-to-tray is on. Read only (H2), and false when the file is absent —
 * which is Desktop's default, and the reason the user is told where to turn it on.
 */
export function minimizeToTrayEnabled(appData: string = process.env.APPDATA || ''): boolean {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(appData, 'Hermes', 'minimize-to-tray.json'), 'utf8')) as {
            enabled?: unknown;
        };
        return raw?.enabled === true;
    } catch {
        return false;
    }
}

/** What one shortcut write answered. */
export interface TraySetupResult {
    ok: boolean;
    /** What the script said, or why it never ran. */
    message: string;
}

/**
 * Write or remove the login shortcut, through the shipped script.
 *
 * `scriptsDir` is our copy in the data home, not the extension's folder: the shortcut has to survive
 * a new version folder. PowerShell runs hidden with a closed stdin and without the editor's
 * run-as-node variable, the same way the build is started.
 */
export function setTrayShortcut(
    action: 'enable' | 'disable',
    scriptsDir: string,
    startup: string = startupFolder(),
    launcher: string = path.join(scriptsDir, TRAY_LAUNCHER),
): Promise<TraySetupResult> {
    const script = path.join(scriptsDir, 'Set-HermesTrayShortcut.ps1');
    if (!fs.existsSync(script)) {
        return Promise.resolve({ ok: false, message: `the shortcut script is missing: ${script}` });
    }
    return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', script,
                '-Action', action,
                '-ScriptPath', launcher,
                '-Startup', startup,
            ], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                env: electronCapableEnv(),
            });
        } catch (error) {
            resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        let output = '';
        let settled = false;
        const finish = (result: TraySetupResult): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const timer = setTimeout(() => {
            finish({ ok: false, message: `the shortcut script did not finish within ${SETUP_TIMEOUT_MS / 1000} s` });
            try {
                proc.kill();
            } catch {
                // Already gone.
            }
        }, SETUP_TIMEOUT_MS);
        proc.stdout?.on('data', chunk => { output += String(chunk); });
        proc.stderr?.on('data', chunk => { output += String(chunk); });
        proc.on('error', error => {
            clearTimeout(timer);
            finish({ ok: false, message: error instanceof Error ? error.message : String(error) });
        });
        proc.on('close', code => {
            clearTimeout(timer);
            const message = output.trim().split(/\r?\n/).filter(Boolean).pop() || `exit ${code}`;
            finish({ ok: code === 0, message });
        });
    });
}
