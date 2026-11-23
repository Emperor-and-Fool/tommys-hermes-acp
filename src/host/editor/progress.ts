import * as vscode from 'vscode';
import type { EditorProgress } from '../../shared/editor';

/**
 * A long job in the editor's notification area, behind the port features call.
 *
 * `ProgressLocation.Notification` and not the window's status bar: the work is a one-off the user
 * should be able to see without hunting for it, and `cancellable: false` because a half-finished
 * Hermes build is worse than a finished one — the step reports its own end instead.
 */
export function createEditorProgress(): EditorProgress {
    return {
        run: async (title, job) => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title, cancellable: false },
                (progress) => job((phase) => progress.report({ message: phase })),
            );
        },
    };
}
