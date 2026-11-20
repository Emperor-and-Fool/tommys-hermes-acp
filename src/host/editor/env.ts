import * as vscode from 'vscode';
import type { EditorEnv, EditorExtensionInfo, EditorSelection } from '../../shared/editor';

/** The editor's own name, kept separate because the commands read it too. */
export function appName(): string {
    return vscode.env.appName;
}

/**
 * The editor itself, behind the port the features and the composition root call.
 *
 * Four unrelated answers, one folder: the name of the shell we run in, the theme the pane must
 * match, the text the user has selected, and the extension's own manifest. They share only this —
 * that none of them is one of our views, so none of them belongs in `webview/` (F6).
 */
export function createEditorEnv(): EditorEnv {
    return {
        appName,

        themeKind: () => vscode.window.activeColorTheme.kind,

        selection: () => readSelection(),

        openExternal: (url) => {
            void vscode.env.openExternal(vscode.Uri.parse(url));
        },

        extensionInfo: (extensionId) => readExtensionInfo(extensionId),

        outputChannel: (name, id) => vscode.window.createOutputChannel(name, id),
    };
}

/**
 * The selection, or nothing.
 *
 * An empty selection is not a selection: the caller used to test both `!editor` and
 * `selection.isEmpty`, and both mean "there is nothing to send".
 */
function readSelection(): EditorSelection | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        return undefined;
    }
    return {
        text: editor.document.getText(editor.selection),
        fileName: editor.document.fileName,
        line: editor.selection.start.line + 1,
    };
}

/** `repository` is an object in most manifests and a bare string in some: both become a URL. */
function readExtensionInfo(extensionId: string): EditorExtensionInfo {
    const pkg = vscode.extensions.getExtension(extensionId)?.packageJSON;
    return {
        displayName: pkg?.displayName || '',
        version: pkg?.version || '',
        publisher: pkg?.publisher || '',
        description: pkg?.description || '',
        repository: pkg?.repository?.url || pkg?.repository || '',
    };
}
