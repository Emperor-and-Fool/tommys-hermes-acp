/**
 * Launch the Hermes systray app's installer and uninstaller.
 *
 * Both live in a separate Qt program in this repository (`extras/KDEdesktopGui`): it owns
 * the dialogs, the pkexec package step and the settings questions. This module only finds
 * it, starts it detached, and keeps the menu context key in sync with what is on disk.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const INSTALLER_RELATIVE = path.join('extras', 'KDEdesktopGui', 'installer_gui.py');
const INSTALLED_SCRIPT = path.join(
    os.homedir(), '.local', 'share', 'hermes-desktopgui', 'hermes_desktop_gui.py'
);
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

/** True once the installer has put the app in place. Drives which menu item is shown. */
export function systrayInstalled(): boolean {
    return fs.existsSync(INSTALLED_SCRIPT);
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

export function installSystray(extensionUri?: vscode.Uri): void {
    runInstaller([], extensionUri);
}

export function uninstallSystray(extensionUri?: vscode.Uri): void {
    runInstaller(['--uninstall'], extensionUri);
}
