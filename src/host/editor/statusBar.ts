import * as vscode from 'vscode';
import { commandId } from '../../shared/extensionId';
import type { BudgetItem, BudgetView } from '../budget/budget';

/**
 * The window's status bar item, and nothing else.
 *
 * The feature decides every word it says (F4); this file knows only what an editor needs: where the
 * item sits, that a click has to arrive as a registered command, and that VS Code offers two warning
 * backgrounds and no green one — the green a connected account carries is a foreground colour.
 */
export function createEditorStatusBar(): BudgetItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    item.name = 'Hermes budget';
    let clicked: (() => void) | undefined;
    const command = vscode.commands.registerCommand(commandId('refreshBudget'), () => clicked?.());
    item.command = commandId('refreshBudget');
    return {
        show: () => item.show(),

        set: (view: BudgetView) => {
            item.text = view.text;
            // A MarkdownString carries theme icons and keeps the feature's line breaks.
            item.tooltip = new vscode.MarkdownString(view.tooltip, true);
            item.backgroundColor = view.background === 'error'
                ? new vscode.ThemeColor('statusBarItem.errorBackground')
                : view.background === 'warning'
                    ? new vscode.ThemeColor('statusBarItem.warningBackground')
                    : undefined;
            item.color = view.color === 'green' ? new vscode.ThemeColor('charts.green') : undefined;
        },

        onClick: (handler: () => void) => {
            clicked = handler;
        },

        dispose: () => {
            command.dispose();
            item.dispose();
        },
    };
}
