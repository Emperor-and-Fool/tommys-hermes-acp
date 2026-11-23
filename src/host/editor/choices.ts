import * as os from 'os';
import * as vscode from 'vscode';
import type { EditorChoices, EditorChoiceItem } from '../../shared/editor';

/**
 * The user's answers, behind one port (F6).
 *
 * A picker, the OS folder dialog, the OS file manager, and the home folder: the four things the
 * notes mirror asks of the person and the shell. Nothing here decides anything — the feature
 * supplies the title and the rows, and this file is the one that knows how VS Code draws them.
 */
export function createEditorChoices(): EditorChoices {
    return {
        pick: async (title, items) => {
            const rows: vscode.QuickPickItem[] = items.map(row => ({
                label: row.label,
                description: row.detail,
                picked: row.suggested === true,
            }));
            const picked = await vscode.window.showQuickPick(rows, { title, ignoreFocusOut: true });
            if (!picked) {
                return undefined;
            }
            // The same objects, in the same order: the id is read from the row the user took.
            const index = rows.indexOf(picked);
            return index >= 0 ? (items[index] as EditorChoiceItem).id : undefined;
        },

        prompt: async (title, value) => vscode.window.showInputBox({
            title,
            value,
            ignoreFocusOut: true,
        }),

        pickFolder: async (title, startAt) => {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: title,
                defaultUri: startAt ? vscode.Uri.file(startAt) : undefined,
            });
            return picked && picked.length > 0 ? picked[0].fsPath : undefined;
        },

        showInFileManager: async (folderPath) => {
            // The OS opens a directory URI in its own file manager: the user's browser, not ours.
            await vscode.env.openExternal(vscode.Uri.file(folderPath));
        },

        ask: async (message, actions) => {
            // Closing the notice answers nothing: no button is the same as undefined.
            const picked = actions.length > 0
                ? await vscode.window.showInformationMessage(message, ...actions)
                : undefined;
            return picked ?? undefined;
        },

        home: () => os.homedir(),
    };
}
