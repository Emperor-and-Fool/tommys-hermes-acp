import * as vscode from 'vscode';
import { setting } from '../../shared/extensionId';
import { appName } from './env';
import type { EditorCommands } from '../../shared/editor';

/**
 * The editor commands this extension runs, behind the port the callers know.
 *
 * Everything here is a `workbench.*` or `vscode.*` command id and the small decision around it
 * (which settings editor to open, whether this is Cursor). The commands that show one of our own
 * views are not here: those are `webview/surfaces.ts`'s, because the view is ours (F6).
 */
export function createEditorCommands(): EditorCommands {
    return {
        openFolder: (folderPath) => {
            void vscode.commands.executeCommand(
                'vscode.openFolder',
                vscode.Uri.file(folderPath),
                { forceNewWindow: false }
            );
        },

        reloadWindow: async () => {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        },

        setContext: (key, value) => {
            void vscode.commands.executeCommand('setContext', key, value);
        },

        checkForUpdate: async (extensionId) => {
            await vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
            await vscode.commands.executeCommand(
                'workbench.extensions.action.showExtensionsWithIds',
                [extensionId]
            );
        },

        openSettings: async (extensionId) => {
            const preferJsonEditor = vscode.workspace
                .getConfiguration('workbench.settings')
                .get<string>('editor') === 'json';
            const isCursor = /cursor/i.test(appName());

            // Cursor: always open Settings UI (JSON editor command often does nothing visible).
            if (preferJsonEditor && !isCursor) {
                await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
                    revealSetting: { key: setting('path'), edit: false },
                });
                return;
            }

            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `@ext:${extensionId}`,
            );
        },
    };
}
