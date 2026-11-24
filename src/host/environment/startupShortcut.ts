import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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

/** How long the shortcut script may take. It writes one file. */
const SHORTCUT_TIMEOUT_MS = 60_000;

/**
 * Write or remove one named shortcut through the shipped script.
 *
 * PowerShell runs hidden, with a closed stdin; the script is the extension's own copy under
 * `packaging/windows/`, and it is the only thing that knows how to make a `.lnk` (there is no other
 * way on Windows). A missing script is answered, not guessed at.
 */
export function setStartupShortcut(options: {
    script: string;
    action: 'enable' | 'disable';
    name: string;
    /** The file the shortcut starts; ignored for `disable`. */
    target?: string;
    /** Arguments passed to the target, if any. */
    args?: string;
    windowStyle?: number;
    startup?: string;
}): Promise<ShortcutResult> {
    const { script, action, name } = options;
    if (!fs.existsSync(script)) {
        return Promise.resolve({ ok: false, message: `the shortcut script is missing: ${script}` });
    }
    const startup = options.startup ?? startupFolder();
    return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', script,
                '-Action', action,
                '-Name', name,
                '-Startup', startup,
                ...(options.target ? ['-Target', options.target] : []),
                ...(options.args ? ['-Arguments', options.args] : []),
                ...(options.windowStyle ? ['-WindowStyle', String(options.windowStyle)] : []),
            ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (error) {
            resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        let output = '';
        let settled = false;
        const finish = (result: ShortcutResult): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const timer = setTimeout(() => {
            finish({ ok: false, message: `the shortcut script did not finish within ${SHORTCUT_TIMEOUT_MS / 1000} s` });
            try { proc.kill(); } catch { /* already gone */ }
        }, SHORTCUT_TIMEOUT_MS);
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
