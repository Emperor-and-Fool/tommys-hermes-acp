import * as vscode from 'vscode';
import type { EditorFolders } from '../../shared/editor';

/**
 * The window's folders, behind the port two features ask for.
 *
 * `vscode.workspace` answers three things the cwd owner and the project group need, and they must
 * agree: a tab's workspace is `currentWorkspacePath()`, which is `workspaceFile()` first and the
 * folder list second. Two adapters would be two chances to disagree, so there is one (F6).
 *
 * The scheme is checked because VS Code reports a workspace file on some remote schemes that is
 * not a path we can open or compare; those windows are plain-folder windows to us.
 */
export function createEditorFolders(): EditorFolders {
    return {
        workspaceFile: () => {
            const file = vscode.workspace.workspaceFile;
            return file && file.scheme === 'file' ? file.fsPath : '';
        },

        folders: () => (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath),

        onFoldersChanged: (handler) => {
            const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => handler());
            return () => subscription.dispose();
        },
    };
}
