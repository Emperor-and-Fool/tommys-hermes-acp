import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * Our tray app for Windows, as a release asset — and the checks it must pass before it runs.
 *
 * The app is 532 MB unpacked, so it cannot ride in the VSIX: it is attached to the release and
 * downloaded on the click that installs it. Nothing here trusts a download: the size and the sha256
 * below are the only reason a file is allowed to be unpacked, and both live in this one place so the
 * installer, the tests and the report can never disagree about which build is meant.
 */

/** The release asset, and the one build it names. */
export const TRAY_APP = {
    /** GitHub release asset; the tag is part of the URL, so a release cannot drift from this file. */
    url: 'https://github.com/Emperor-and-Fool/tommys-hermes-acp/releases/download/v2.6.1/hermesdesktopgui-windows-x86_64.zip',
    bytes: 199053972,
    sha256: '9baa9ceb689894ec15841afaf993fe247a19f0b94c74bc30f119c8f821541091',
    /** The folder Compress-Archive wrote, and the executable inside it. */
    folder: 'hermesdesktopgui',
    exe: 'hermesdesktopgui.exe',
} as const;

/** What a verification answered, and why it refused. */
export interface TrayAppCheck {
    ok: boolean;
    reason?: string;
}

/**
 * The one test a downloaded file must pass.
 *
 * Size first: it is cheap, it catches a truncated download and a GitHub error page, and it names the
 * problem in words the user can act on. The hash then catches everything else.
 */
export function verifyTrayAppZip(data: Buffer, expected: { bytes: number; sha256: string } = TRAY_APP): TrayAppCheck {
    if (data.length !== expected.bytes) {
        return { ok: false, reason: `the download is ${data.length} bytes, expected ${expected.bytes}` };
    }
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    if (digest !== expected.sha256) {
        return { ok: false, reason: `the download's sha256 is ${digest}, expected ${expected.sha256}` };
    }
    return { ok: true };
}

/**
 * Where the app lives once unpacked.
 *
 * `%LOCALAPPDATA%\hermesdesktopgui` — deliberately outside our data home: that home was renamed to
 * `.backup-<date>` on the test machine, and a login shortcut pointing into a renamed folder is a
 * dead entry. This is an application folder of its own, per user, and uninstalling removes it whole.
 */
export function trayAppDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    if (platform !== 'win32') {
        return '';
    }
    const local = (env.LOCALAPPDATA || '').trim() || path.join(env.USERPROFILE || '', 'AppData', 'Local');
    return path.join(local, TRAY_APP.folder);
}

export function trayAppExe(dir: string = trayAppDir()): string {
    return dir ? path.join(dir, TRAY_APP.exe) : '';
}

export function trayAppInstalled(dir: string = trayAppDir()): boolean {
    const exe = trayAppExe(dir);
    return !!exe && fs.existsSync(exe);
}

/** A download that failed, with what to tell the user. */
export interface TrayAppDownload {
    path?: string;
    error?: string;
}

/**
 * Fetch the asset to a temp file and verify it there.
 *
 * A refused file is deleted before answering: a failed hash must never be left on disk where a later
 * run (or a person) could mistake it for the installer.
 */
export async function downloadTrayApp(
    dir: string = os.tmpdir(),
    fetchImpl: typeof fetch = fetch,
): Promise<TrayAppDownload> {
    const target = path.join(dir, `${TRAY_APP.folder}-${process.pid}.zip`);
    let data: Buffer;
    try {
        const response = await fetchImpl(TRAY_APP.url, { redirect: 'follow' });
        if (!response.ok) {
            return { error: `GitHub answered ${response.status} for ${TRAY_APP.url}` };
        }
        data = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
    const check = verifyTrayAppZip(data);
    if (!check.ok) {
        return { error: check.reason };
    }
    try {
        fs.writeFileSync(target, data);
    } catch (error) {
        return { error: `could not write the download: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { path: target };
}

/**
 * Unpack with PowerShell's `Expand-Archive`.
 *
 * The zip was written by `Compress-Archive`, so its entry paths may use backslashes; a Node zip
 * library reads those as literal characters in a file name. Windows' own extractor wrote it and
 * Windows' own extractor unpacks it.
 */
export function unpackTrayApp(zip: string, destination: string, timeoutMs = 300_000): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: { ok: boolean; message: string }): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        let proc: ReturnType<typeof spawn>;
        try {
            fs.mkdirSync(destination, { recursive: true });
            proc = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-Command',
                `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
            ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (error) {
            finish({ ok: false, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        let output = '';
        const timer = setTimeout(() => {
            finish({ ok: false, message: `Expand-Archive did not finish within ${Math.round(timeoutMs / 1000)} s` });
            try { proc.kill(); } catch { /* already gone */ }
        }, timeoutMs);
        proc.stdout?.on('data', chunk => { output += String(chunk); });
        proc.stderr?.on('data', chunk => { output += String(chunk); });
        proc.on('error', error => {
            clearTimeout(timer);
            finish({ ok: false, message: error instanceof Error ? error.message : String(error) });
        });
        proc.on('close', code => {
            clearTimeout(timer);
            const tail = output.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
            finish({ ok: code === 0, message: code === 0 ? 'unpacked' : `Expand-Archive exited ${code}: ${tail}` });
        });
    });
}

/** The hidden launcher that starts the dashboard at login: no console window, no browser. */
export const DASHBOARD_LAUNCHER = 'Start-HermesDashboard.vbs';

/**
 * Write the launcher that runs `hermes dashboard --no-open` with no window.
 *
 * A `.lnk` to `hermes.exe` would flash a console every login; the script library Windows uses for
 * that (`WScript.Shell.Run …, 0, False`) starts it hidden and returns at once. Quoting goes through
 * `Chr(34)` so a path with spaces needs no escaping.
 */
export function writeDashboardLauncher(hermesExe: string, dir: string = trayAppDir()): string {
    const target = path.join(dir, DASHBOARD_LAUNCHER);
    const body = [
        "' Start the Hermes dashboard with no console window. Written by the extension, at install time.",
        "' It is started hidden and not waited for, so a slow dashboard never holds the login up.",
        'Set shell = CreateObject("WScript.Shell")',
        `shell.Run Chr(34) & "${hermesExe.replace(/"/g, "''")}" & Chr(34) & " dashboard --no-open", 0, False`,
        '',
    ].join('\r\n');
    fs.writeFileSync(target, body, 'utf8');
    return target;
}

/** Whether the tray app is running now, by its image name. */
export function isTrayAppRunning(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn('tasklist', ['/FI', `IMAGENAME eq ${TRAY_APP.exe}`, '/NH'],
                { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        } catch {
            resolve(false);
            return;
        }
        let out = '';
        const timer = setTimeout(() => {
            try { proc.kill(); } catch { /* already gone */ }
            resolve(out.toLowerCase().includes(TRAY_APP.exe.toLowerCase()));
        }, timeoutMs);
        proc.stdout?.on('data', chunk => { out += String(chunk); });
        proc.on('error', () => { clearTimeout(timer); resolve(false); });
        proc.on('close', () => { clearTimeout(timer); resolve(out.toLowerCase().includes(TRAY_APP.exe.toLowerCase())); });
    });
}
