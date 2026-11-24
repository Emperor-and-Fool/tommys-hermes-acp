/**
 * The Hermes tray app: our own window on the dashboard, on Linux and Windows, from one source.
 *
 * The app is `extras/KDEdesktopGui` on both platforms, and its installer owns the flow there: the
 * three screens, the copy, the read-back and the login entries. This module does only what the
 * installer cannot do for itself:
 *
 * - the pre-flight. The installer imports PyQt6 at import time, so it cannot install PyQt6: on a
 *   machine without it the user would see nothing at all. Linux gets the two apt packages (pkexec),
 *   Windows gets a venv of its own built from Hermes' Python with Hermes' uv. Both run here, before
 *   the window opens, behind one notification, with the full output in the output channel.
 * - starting the installer, and reporting it if it dies: it runs with its stderr read, so a missing
 *   display, a broken venv or a crash is a message instead of silence.
 * - the menu context key: the app's own copy on disk, which is what "installed" means.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { dashboardUnitPath, ensureDashboardUnit } from './environment/dashboardUnit';
import { accessExecutable, buildHermesExecutableCandidates } from './environment/hermesPaths';
import {
    buildWindowsVenv,
    ensureLinuxPyQt,
    installedCopy,
    installerPython,
    installWheels,
    planWindowsVenv,
    runOnce,
} from './environment/trayPreflight';

const INSTALLER_RELATIVE = path.join('extras', 'KDEdesktopGui', 'installer_gui.py');
const CONTEXT_KEY = 'tommysSystrayInstalled';

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

/** True once the installer has copied the app in place. Drives which menu item is shown. */
export function systrayInstalled(): boolean {
    return fs.existsSync(installedCopy());
}

export function refreshSystrayContext(): void {
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, systrayInstalled());
}

/** Keeps the menu context honest: a 10 s stat, so the item flips after either dialog runs. */
export function startSystrayWatch(): vscode.Disposable {
    refreshSystrayContext();
    const handle = setInterval(refreshSystrayContext, 10_000);
    return { dispose: () => clearInterval(handle) };
}

export function installSystray(extensionUri?: vscode.Uri): Promise<void> {
    return process.platform === 'win32' ? installOnWindows(extensionUri) : installOnLinux(extensionUri);
}

export async function uninstallSystray(extensionUri?: vscode.Uri): Promise<void> {
    launchInstaller(['--uninstall'], extensionUri);
}

/** Linux: PyQt6 (apt when missing), then the dashboard's autostart, then the installer's dialogs. */
async function installOnLinux(extensionUri?: vscode.Uri): Promise<void> {
    const output = outputChannel();
    const failure = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Preparing the Hermes tray app…', cancellable: false },
        async (progress) => {
            const report = {
                running: (phase: string) => progress.report({ message: phase }),
                log: (line: string) => {
                    if (line.trim()) {
                        output.appendLine(line.trim());
                    }
                },
            };
            const pyqt = await ensureLinuxPyQt(runOnce, report);
            if (!pyqt.ok) {
                return pyqt.message;
            }
            if (pyqt.installed) {
                output.appendLine('PyQt6 was installed with apt.');
            }
            const unitPath = dashboardUnitPath();
            if (unitPath) {
                const unit = await ensureDashboardUnit(await resolveHermesCli(), unitPath);
                output.appendLine(`dashboard unit: ${unit.message} — ${unitPath}`);
            }
            return '';
        },
    );
    if (failure) {
        void vscode.window.showErrorMessage(`Hermes tray app: ${failure}. The installer was not started.`);
        return;
    }
    launchInstaller([], extensionUri);
}

/** Windows: the venv (built or repaired here), then the installer's dialogs — as on Linux. */
async function installOnWindows(extensionUri?: vscode.Uri): Promise<void> {
    const output = outputChannel();
    const failure = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Preparing the Hermes tray app…', cancellable: false },
        async (progress) => {
            const report = {
                running: (phase: string) => progress.report({ message: phase }),
                log: (line: string) => {
                    if (line.trim()) {
                        output.appendLine(line.trim());
                    }
                },
            };
            progress.report({ message: 'checking the venv' });
            const plan = await planWindowsVenv(runOnce);
            output.appendLine(`pre-flight: ${plan.reason}`);
            if (plan.action === 'ready') {
                return '';
            }
            const result = plan.action === 'install'
                ? await installWheels(runOnce, report)
                : await buildWindowsVenv(runOnce, report);
            return result.ok ? '' : result.message;
        },
    );
    if (failure) {
        void vscode.window.showErrorMessage(`Hermes tray app: ${failure}. The installer was not started.`);
        return;
    }
    launchInstaller([], extensionUri);
}

/**
 * Start the installer with the interpreter that has PyQt6 — and do not lose what it says.
 *
 * `stdio: 'ignore'` used to hide every failure. Now both streams are read: a non-zero exit becomes a
 * message with its last lines, and the context key is refreshed once it is over.
 */
function launchInstaller(args: string[], extensionUri?: vscode.Uri): void {
    const installer = findInstaller(extensionUri);
    if (!installer) {
        void vscode.window.showErrorMessage(
            'Hermes systray: installer not found. Set HERMES_DESKTOPGUI_INSTALLER to the path of ' +
            `${INSTALLER_RELATIVE}, or keep the repository checkout at ~/_GitProjects/emperorandfools-repos.`
        );
        return;
    }
    if (process.platform === 'linux' && !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
        void vscode.window.showErrorMessage(
            'Hermes systray: no graphical session in this editor process (DISPLAY / WAYLAND_DISPLAY ' +
            'unset), so the window cannot open.'
        );
        return;
    }
    const python = installerPython();
    if (process.platform !== 'linux' && !fs.existsSync(python)) {
        void vscode.window.showErrorMessage(
            'Hermes systray: the app\'s own Python is not in place yet. Run Install Desktop GUI again, ' +
            'so the pre-flight builds it.'
        );
        return;
    }
    const output = outputChannel();
    output.appendLine(`$ ${python} ${installer} ${args.join(' ')}`);
    let child: ReturnType<typeof spawn>;
    try {
        child = spawn(python, [installer, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
        void vscode.window.showErrorMessage(`Hermes systray: could not start the window (${String(error)}).`);
        return;
    }
    let stderr = '';
    child.stdout?.on('data', chunk => output.appendLine(String(chunk).trimEnd()));
    child.stderr?.on('data', chunk => {
        stderr += String(chunk);
        output.appendLine(String(chunk).trimEnd());
    });
    child.on('error', error => {
        void vscode.window.showErrorMessage(`Hermes systray: could not start the window (${String(error)}).`);
    });
    child.on('exit', code => {
        output.appendLine(`installer exited ${code ?? 'by signal'}`);
        refreshSystrayContext();
        if (code !== 0 && code !== null) {
            const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-5).join('\n');
            void vscode.window.showErrorMessage(
                `Hermes systray: the installer stopped with exit ${code}` + (tail ? `:\n${tail}` : '.')
            );
        }
    });
    // The window is the user's now: the extension host must not keep it alive or wait for it.
    try {
        child.unref();
    } catch {
        // Nothing to detach.
    }
}

/** One output channel for everything this feature prints, created on first use. */
let channel: vscode.OutputChannel | undefined;

function outputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Hermes systray');
    }
    return channel;
}

/** The `hermes` the unit runs: a configured path, else the first candidate that exists. */
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
