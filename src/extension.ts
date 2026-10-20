import * as vscode from 'vscode';
import { HermesChatProvider } from './chat/HermesChatProvider';
import { initI18n, t } from './i18n';

let chatProvider: HermesChatProvider | undefined;

function bindChatCommand(
    context: vscode.ExtensionContext,
    command: string,
    run: (provider: HermesChatProvider) => void | Promise<void>
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(command, () => {
            if (!chatProvider) {
                return;
            }
            void run(chatProvider);
        })
    );
}

export function activate(context: vscode.ExtensionContext) {
    initI18n();
    console.log('Tommys Hermes ACP activating...');

    // Register the chat webview provider
    chatProvider = new HermesChatProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tommysChat', chatProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('tommys.newChat', () => {
            chatProvider?.newChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tommys.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.tommys-sidebar');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tommys.sendSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage(t('selectCodeFirst'));
                return;
            }
            const selection = editor.document.getText(editor.selection);
            const fileName = editor.document.fileName;
            const line = editor.selection.start.line + 1;
            const text = `At ${fileName}:${line}\n\`\`\`\n${selection}\n\`\`\``;

            vscode.commands.executeCommand('workbench.view.extension.tommys-sidebar');
            chatProvider?.insertIntoInput(text);
        })
    );

    bindChatCommand(context, 'tommys.reloadExtension', provider => provider.reloadExtension());
    bindChatCommand(context, 'tommys.reloadSession', provider => provider.reloadSession());
    bindChatCommand(context, 'tommys.openSettings', provider => provider.openSettings());
    bindChatCommand(context, 'tommys.checkUpdate', provider => provider.checkForUpdate());
    bindChatCommand(context, 'tommys.openAbout', provider => provider.openAbout());
    bindChatCommand(context, 'tommys.openHelp', provider => provider.openHelp());
    bindChatCommand(context, 'tommys.openFaq', provider => provider.openFaq());
    bindChatCommand(context, 'tommys.openLogs', provider => provider.openLogs());
    bindChatCommand(context, 'tommys.detectEnvironment', provider => provider.detectEnvironment());
    bindChatCommand(context, 'tommys.detectEnvironmentBusy', () => undefined);
    bindChatCommand(context, 'tommys.configureEnvironment', provider => provider.configureEnvironment());

    console.log('Tommys Hermes ACP activated');
}

export function deactivate() {
    chatProvider?.dispose();
}
