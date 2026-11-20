import * as vscode from 'vscode';
import type { EditorNotices } from '../../shared/editor';

/**
 * The editor's notifications, behind the port the features call.
 *
 * Nothing here decides what to say: the text arrives already translated, because the feature that
 * knows the situation owns the words. This file only knows which of the two toasts to use.
 */
export function createEditorNotices(): EditorNotices {
    return {
        info: (message) => { void vscode.window.showInformationMessage(message); },
        warn: (message) => { void vscode.window.showWarningMessage(message); },
    };
}
