/**
 * Launch the Hermes tray app: our own window on the dashboard, on both platforms.
 *
 * Linux: a separate Qt program in this repository (`extras/KDEdesktopGui`) with its own installer
 * window; it owns the dialogs, the pkexec package step and the settings questions, and this module
 * only finds it and starts it detached.
 *
 * Windows: the same program, built as a zip on the release (532 MB unpacked, too large for the
 * VSIX). This module downloads it, verifies size and sha256 before anything is unpacked, unpacks with
 * Windows' own extractor, and writes the two login entries — the app, and a hidden
 * `hermes dashboard --no-open`.
 *
 * Either way the menu context key follows what is on disk, and a step that failed says so instead of
 * leaving the menu lying.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isDashboardServing } from './environment/dashboard';
import {
    dashboardUnitPath,
    ensureDashboardUnit,
    removeOurDashboardUnit,
} from './environment/dashboardUnit';
import { accessExecutable, buildHermesExecutableCandidates } from './environment/hermesPaths';
import { setStartupShortcut, shortcutInstalled, startupFolder } from './environment/startupShortcut';
import {
    downloadTrayApp,
    isTrayAppRunning,
    trayAppDir,
    trayAppExe,
    trayAppInstalled,
    unpackTrayApp,
    writeDashboardLauncher,
} from './environment/trayApp';

const INSTALLER_RELATIVE = path.join('extras', 'KDEdesktopGui', 'installer_gui.py');
const INSTALLED_SCRIPT = path.join(
    os.homedir(), '.local', 'share', 'hermes-desktopgui', 'hermes_desktop_gui.py'
);
const CONTEXT_KEY = 'tommysSystrayInstalled';

/** The two login entries on Windows, by name. Nothing else in that folder is ours. */
const APP_LINK = 'Hermes Desktop GUI.lnk';
const DASHBOARD_LINK = 'Hermes Dashboard.lnk';

/** Where the installer may live, most specific first. */
function candidatePaths(extensionUri?: vscode.Uri): string[] {
    const candidates: string[] = [];
    const fromEnv = process.env.HERMES_DESKTOPGUI_INSTALLER;
    if (fromEnv) {
        candidates.push(fromEnv);
    }
    if (extensionUri) {
        candidates.push(path.join(extensionUri.fsPath, INSTALLER_RELATIVE));
    }
    candidates.push(
        path.join(os.homedir(), '_GitProjects', 'emperorandfools-repos', 'tommys-hermes-acp', INSTALLER_RELATIVE)
    );
    return candidates;
}

function findInstaller(extensionUri?: vscode.Uri): string | undefined {
    return candidatePaths(extensionUri).find(candidate => fs.existsSync(candidate));
}

/** True once the app is in place. Drives which menu item is shown. */
export function systrayInstalled(): boolean {
    return process.platform === 'win32' ? trayAppInstalled() : fs.existsSync(INSTALLED_SCRIPT);
}

export function refreshSystrayContext(): void {
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, systrayInstalled());
}

function runInstaller(args: string[], extensionUri?: vscode.Uri): void {
    const installer = findInstaller(extensionUri);
    if (!installer) {
        void vscode.window.showErrorMessage(
            'Hermes systray: installer not found. Set HERMES_DESKTOPGUI_INSTALLER to the path of ' +
            `${INSTALLER_RELATIVE}, or keep the repository checkout at ~/_GitProjects/emperorandfools-repos.`
        );
        return;
    }

    const python = process.env.HERMES_DESKTOPGUI_PYTHON || '/usr/bin/python3';
    const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    if (!hasDisplay) {
        void vscode.window.showErrorMessage(
            'Hermes systray: no graphical session in this editor process (DISPLAY / WAYLAND_DISPLAY ' +
            'unset), so the window cannot open.'
        );
        return;
    }

    try {
        const child = spawn(python, [installer, ...args], { detached: true, stdio: 'ignore' });
        child.unref();
    } catch (error) {
        void vscode.window.showErrorMessage(`Hermes systray: could not start the window (${String(error)}).`);
    }
}

/** Keeps the menu context honest: a 10 s stat, so the item flips after either dialog runs. */
export function startSystrayWatch(): vscode.Disposable {
    refreshSystrayContext();
    const handle = setInterval(refreshSystrayContext, 10_000);
    return { dispose: () => clearInterval(handle) };
}

/** The script that writes a `.lnk`, shipped in the VSIX. */
function shortcutScript(extensionUri?: vscode.Uri): string {
    return extensionUri ? path.join(extensionUri.fsPath, 'packaging', 'windows', 'Set-HermesTrayShortcut.ps1') : '';
}

export function installSystray(extensionUri?: vscode.Uri): Promise<void> {
    return process.platform === 'win32'
        ? installWindowsTrayApp(extensionUri)
        : installLinuxTrayApp(extensionUri);
}

export function uninstallSystray(extensionUri?: vscode.Uri): Promise<void> {
    return process.platform === 'win32'
        ? uninstallWindowsTrayApp(extensionUri)
        : uninstallLinuxTrayApp(extensionUri);
}

/**
 * Linux: the dashboard's autostart, then the Qt installer's own dialogs.
 *
 * Nothing in Hermes writes `hermes-dashboard.service`, so this writes one — only when the user has
 * none — and starts it. An existing unit is left to the installer, which already offers `--no-open`
 * with a backup; ours only fills the gap.
 */
async function installLinuxTrayApp(extensionUri?: vscode.Uri): Promise<void> {
    const unitPath = dashboardUnitPath();
    if (unitPath) {
        const unit = await ensureDashboardUnit(await resolveHermesCli(), unitPath);
        if (unit.created) {
            console.log(`Dashboard unit: ${unit.message} — ${unitPath}`);
        } else if (!unit.ok) {
            console.warn(`Dashboard unit: ${unit.message}`);
        }
    }
    runInstaller([], extensionUri);
    refreshSystrayContext();
}

/** Linux: remove our unit (only when it is ours), then the installer's own uninstall dialog. */
async function uninstallLinuxTrayApp(extensionUri?: vscode.Uri): Promise<void> {
    const unitPath = dashboardUnitPath();
    if (unitPath) {
        const unit = await removeOurDashboardUnit(unitPath);
        if (unit.removed || !unit.ok) {
            console.log(`Dashboard unit: ${unit.message}`);
        }
    }
    runInstaller(['--uninstall'], extensionUri);
    refreshSystrayContext();
}

/**
 * Download, verify, unpack, and put both login entries in place — each only when it is missing.
 *
 * Nothing is started here: the entries run at the next login, and the state is read back so the user
 * knows what they got without opening a folder.
 */
async function installWindowsTrayApp(extensionUri?: vscode.Uri): Promise<void> {
    const dir = trayAppDir();
    const script = shortcutScript(extensionUri);
    if (!trayAppInstalled(dir)) {
        const outcome = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Installing the Hermes desktop app…', cancellable: false },
            async (progress) => {
                progress.report({ message: 'downloading the release asset' });
                const download = await downloadTrayApp();
                if (!download.path) {
                    return { ok: false, message: download.error ?? 'the download failed' };
                }
                progress.report({ message: 'unpacking' });
                const unpacked = await unpackTrayApp(download.path, dir);
                try {
                    fs.unlinkSync(download.path);
                } catch {
                    // A temp file that outlives the run is not worth a message.
                }
                if (!unpacked.ok) {
                    return { ok: false, message: unpacked.message };
                }
                return trayAppInstalled(dir)
                    ? { ok: true, message: 'installed' }
                    : { ok: false, message: `the archive did not contain ${trayAppExe(dir)}` };
            },
        );
        if (!outcome.ok) {
            void vscode.window.showErrorMessage(
                `Hermes desktop app: not installed — ${outcome.message}. Nothing was unpacked or run.`
            );
            refreshSystrayContext();
            return;
        }
    }

    const startup = startupFolder();
    const appLink = shortcutInstalled(APP_LINK, startup)
        ? { ok: true, message: 'already there' }
        : await setStartupShortcut({ script, action: 'enable', name: APP_LINK, target: trayAppExe(dir), startup });
    // The dashboard starts hidden, from a launcher beside the app, so a new extension version cannot
    // break the login entry. Skipped when something already serves the port.
    const dashboardAlready = await isDashboardServing();
    let dashboardLink = { ok: true, message: dashboardAlready ? 'already serving' : 'not written' };
    if (!dashboardAlready) {
        const launcher = writeDashboardLauncher(await resolveHermesCli(), dir);
        dashboardLink = shortcutInstalled(DASHBOARD_LINK, startup)
            ? { ok: true, message: 'already there' }
            : await setStartupShortcut({ script, action: 'enable', name: DASHBOARD_LINK, target: launcher, startup });
    }

    refreshSystrayContext();
    if (!appLink.ok || !dashboardLink.ok) {
        const failed = [appLink, dashboardLink].filter(entry => !entry.ok).map(entry => entry.message);
        void vscode.window.showErrorMessage(
            `Hermes desktop app: installed, but a login entry could not be written — ${failed.join('; ')}`
        );
        return;
    }
    await reportWindowsState(dir);
}

/** Remove exactly our two entries and our unpacked folder; nothing else in either place. */
async function uninstallWindowsTrayApp(extensionUri?: vscode.Uri): Promise<void> {
    const script = shortcutScript(extensionUri);
    const startup = startupFolder();
    const answers: Array<{ ok: boolean; message: string }> = [];
    for (const name of [APP_LINK, DASHBOARD_LINK]) {
        answers.push(await setStartupShortcut({ script, action: 'disable', name, startup }));
    }
    const dir = trayAppDir();
    let removed = true;
    try {
        if (dir && fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (error) {
        removed = false;
        void vscode.window.showErrorMessage(`Hermes desktop app: could not remove ${dir} (${String(error)}).`);
    }
    refreshSystrayContext();
    if (removed && answers.every(answer => answer.ok)) {
        void vscode.window.showInformationMessage(
            'Hermes desktop app: removed (the two login entries and the app folder).'
        );
    }
}

/** One report after installing: what is on disk, what answers, what runs. */
async function reportWindowsState(dir: string): Promise<void> {
    const serving = await isDashboardServing();
    const running = await isTrayAppRunning();
    const startup = startupFolder();
    const lines = [
        `Hermes desktop app installed: ${trayAppExe(dir)}`,
        `login: app ${shortcutInstalled(APP_LINK, startup) ? 'yes' : 'no'}, ` +
        `dashboard ${shortcutInstalled(DASHBOARD_LINK, startup) ? 'yes' : 'no'}`,
        serving
            ? `dashboard: http://127.0.0.1:9119/ answers${running ? ', app running' : ', app not running yet'}`
            : 'dashboard: nothing on 127.0.0.1:9119 yet — it starts at the next login',
    ];
    void vscode.window.showInformationMessage(lines.join('\n'));
    refreshSystrayContext();
}

/**
 * The `hermes` a login entry runs: the configured path, else the first candidate that exists, else
 * the bare command (a unit or a `.vbs` runs it through the shell, where PATH decides).
 */
async function resolveHermesCli(): Promise<string> {
    const configured = (process.env.HERMES_CLI_PATH || '').trim();
    if (configured) {
        return configured;
    }
    for (const candidate of buildHermesExecutableCandidates()) {
        if (await accessExecutable(candidate)) {
            return candidate;
        }
    }
    return 'hermes';
}
