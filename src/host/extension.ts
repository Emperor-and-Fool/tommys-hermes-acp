import * as vscode from 'vscode';
import { App } from './app';
import { activateExtension } from './activate';
import { PRIMARY, commandId, setActiveIdentity } from '../shared/extensionId';
import { installSecondant, refreshSecondantContext, uninstallSecondant } from './secondantInstall';
import { installSystray, startSystrayWatch, uninstallSystray } from './systrayInstall';
import { migrateLegacyDesktop } from './desktop/legacy';

let app: App | undefined;

/**
 * What the secondant may read of us. Additive: the primary does not consult it, and nothing
 * here exposes the session, the tabs or the agent itself.
 */
export interface TommysHermesAcpApi {
    /** The profile the primary's agent is talking to; empty before it settles. */
    readonly activeProfile: string;
    /** Fires when the primary moves to another profile, so the secondant can step aside. */
    onDidChangeProfile(listener: (profile: string) => void): vscode.Disposable;
    /** The secondant's profile, so the primary can withhold it from its own picker. */
    registerSiblingProfile(profile: string): void;
}

export function activate(context: vscode.ExtensionContext): TommysHermesAcpApi {
    setActiveIdentity(PRIMARY);
    const running = activateExtension(context, PRIMARY);
    app = running;

    // The secondant is installed from here, and removed from here. Both go through the editor's
    // own installer so the registry and the reload prompt behave as they do for any extension.
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId('installSecondant'), () =>
            installSecondant(context.extensionUri)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId('uninstallSecondant'), () => uninstallSecondant())
    );
    // The systray app is a separate Qt program with its own installer window; this command
    // only starts it, so the questions (packages, autostart) are asked in its dialogs.
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId('installSystray'), () =>
            installSystray(context.extensionUri)
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId('uninstallSystray'), () =>
            uninstallSystray(context.extensionUri)
        )
    );
    context.subscriptions.push(startSystrayWatch());
    // 2.6.1 built Hermes Desktop and asked about a start in the tray; both left the extension.
    // What they wrote is taken back here, once, and only on Windows (no-op everywhere else).
    const legacy = migrateLegacyDesktop();
    for (const path of legacy.removed) {
        console.log(`Removed 2.6.1's Desktop leftover: ${path}`);
    }
    for (const line of legacy.failed) {
        console.warn(`2.6.1's Desktop leftover could not be removed: ${line}`);
    }
    void refreshSecondantContext();

    return {
        get activeProfile(): string {
            return running.activeProfile;
        },
        onDidChangeProfile(listener: (profile: string) => void): vscode.Disposable {
            return running.onDidChangeProfile(listener);
        },
        registerSiblingProfile(profile: string): void {
            running.registerSiblingProfile(profile);
        },
    };
}

export function deactivate(): void {
    app?.dispose();
    app = undefined;
}
