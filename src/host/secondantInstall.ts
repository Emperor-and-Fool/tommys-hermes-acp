import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Installing and removing the secondant from the primary.
 *
 * Both go through the editor's own extension management — `workbench.extensions.installExtension`
 * with the bundled VSIX, `workbench.extensions.uninstallExtension` — because that is what writes
 * the registry entry, extracts the version directory and asks for the reload. Nothing here
 * reimplements it.
 *
 * The folder is not ours to delete. An uninstall removes the entry from the current profile only;
 * once no profile lists `id@version` the editor marks it in `.obsolete` and deletes the folder at
 * its next start, and while another profile still lists it the folder has to stay for that profile.
 */

export const SECONDANT_ID = 'EmperorAndFool.tommys-hermes-secondant';

/** Where the secondant VSIX travels inside the primary's package. */
const BUNDLED_VSIX = path.join('secondant', 'tommys-hermes-secondant.vsix');

/** Context key the menu reads: one item while absent, the other once installed. */
const INSTALLED_KEY = 'tommys2Installed';

export function isSecondantInstalled(): boolean {
    return vscode.extensions.getExtension(SECONDANT_ID) !== undefined;
}

export async function refreshSecondantContext(): Promise<void> {
    await vscode.commands.executeCommand('setContext', INSTALLED_KEY, isSecondantInstalled());
}

function bundledVsixPath(extensionUri: vscode.Uri): string | undefined {
    const candidate = path.join(extensionUri.fsPath, BUNDLED_VSIX);
    return fs.existsSync(candidate) ? candidate : undefined;
}

export async function installSecondant(extensionUri: vscode.Uri): Promise<void> {
    if (isSecondantInstalled()) {
        void vscode.window.showInformationMessage('Tommys Hermes Secondant is already installed.');
        await refreshSecondantContext();
        return;
    }
    const vsix = bundledVsixPath(extensionUri);
    if (!vsix) {
        void vscode.window.showErrorMessage(
            `The secondant package is missing from this build (${BUNDLED_VSIX}).`
        );
        return;
    }

    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsix));
    await refreshSecondantContext();

    if (isSecondantInstalled()) {
        const reload = 'Reload window';
        void vscode.window
            .showInformationMessage('Tommys Hermes Secondant installed.', reload)
            .then(choice => {
                if (choice === reload) {
                    void vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
    } else {
        // The installer accepted the file but the entry is not visible in this session yet.
        void vscode.window.showInformationMessage(
            'Tommys Hermes Secondant installed. Reload the window to use it.'
        );
    }
}

export async function uninstallSecondant(): Promise<void> {
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', SECONDANT_ID);
    await refreshSecondantContext();

    const reload = 'Reload window';
    void vscode.window
        .showInformationMessage('Tommys Hermes Secondant uninstalled.', reload)
        .then(choice => {
            if (choice === reload) {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
}
