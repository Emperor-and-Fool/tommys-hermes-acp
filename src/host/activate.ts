/**
 * The activation both extensions share.
 *
 * The primary and the secondant register the same commands, the same view and the same panel
 * serializer; only the ids differ, and every id comes from the identity. Anything that belongs
 * to one of them alone (the install/uninstall menu, the hierarchy API, the profile guard) stays
 * in that extension's own entry point.
 */
import * as vscode from 'vscode';
import { App } from './app';
import { initI18n, t } from './i18n';
import type { ExtensionIdentity } from '../shared/extensionId';

/** What the secondant may ask the primary: only which profile it is on. */
export interface PrimaryProfileSource {
    readonly activeProfile: string;
    /** The secondant's profile, handed up so this side can withhold it too. */
    registerSiblingProfile?(profile: string): void;
}

/** The commands every surface offers: the chat ones, bound to the running App. */
const CHAT_COMMANDS: Array<[string, (app: App) => void | Promise<void>]> = [
    ['reloadExtension', app => app.reloadExtension()],
    ['reloadSession', app => app.reloadSession()],
    ['openSettings', app => app.openSettings()],
    ['checkUpdate', app => app.checkForUpdate()],
    ['openAbout', app => app.openAbout()],
    ['openHelp', app => app.openHelp()],
    ['openFaq', app => app.openFaq()],
    ['openLogs', app => app.openLogs()],
    ['detectEnvironment', app => app.detectEnvironment()],
    ['detectEnvironmentBusy', () => undefined],
    ['configureEnvironment', app => app.configureEnvironment()],
];

/**
 * Register everything the identity names, and return the App that is now running.
 * The caller keeps the App for the profile API and its own extra commands.
 */
export function activateExtension(
    context: vscode.ExtensionContext,
    id: ExtensionIdentity,
    primary?: PrimaryProfileSource
): App {
    initI18n();
    console.log(`Tommys Hermes (${id.role}) activating...`);

    const app = new App(id, context.extensionUri, context, primary);

    const bind = (command: string, run: (app: App) => void | Promise<void>): void => {
        context.subscriptions.push(
            vscode.commands.registerCommand(command, () => void run(app))
        );
    };

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(id.chatViewId, app, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    bind(id.cmd('toggleChatSurface'), instance => instance.toggleChatSurface());

    // Restores the editor-tab chat after a window reload / app restart.
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(id.chatPanelType, {
            deserializeWebviewPanel(panel: vscode.WebviewPanel) {
                app.restoreChatPanel(panel);
                return Promise.resolve();
            },
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(id.cmd('openChat'), () => {
            void vscode.commands.executeCommand(`workbench.view.extension.${id.sidebarId}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(id.cmd('sendSelection'), () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                void vscode.window.showInformationMessage(t('selectCodeFirst'));
                return;
            }
            const selection = editor.document.getText(editor.selection);
            const fileName = editor.document.fileName;
            const line = editor.selection.start.line + 1;
            const text = `At ${fileName}:${line}\n\`\`\`\n${selection}\n\`\`\``;

            void vscode.commands.executeCommand(`workbench.view.extension.${id.sidebarId}`);
            app.insertIntoInput(text);
        })
    );

    for (const [name, run] of CHAT_COMMANDS) {
        bind(id.cmd(name), run);
    }

    console.log(`Tommys Hermes (${id.role}) activated`);
    return app;
}
