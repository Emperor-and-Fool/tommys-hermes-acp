import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Installing and removing the secondant from the primary.
 *
 * The install goes through the editor's own installer (`workbench.extensions.installExtension`
 * with the bundled VSIX), because that is what writes the registry entry, extracts the version
 * directory and asks for the reload — nothing here reimplements it. What this adds is the
 * reversal: after the editor's uninstall, every version directory for the secondant is removed
 * too, so nothing is left behind for the scanner to find later.
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

/**
 * Every directory the secondant could occupy. VSCodium's uninstall removes the registry entry and
 * normally leaves the version directories for a later sweep; this takes them now.
 */
function secondantDirectories(extensionsDir: string): string[] {
    if (!extensionsDir || !fs.existsSync(extensionsDir)) {
        return [];
    }
    // Extension directories are lower-cased on disk, the manifest id is not: compare case-blind
    // or every candidate is missed and the uninstall leaves the folder behind.
    const prefix = `${SECONDANT_ID}-`.toLowerCase();
    return fs
        .readdirSync(extensionsDir)
        .filter(name => name.toLowerCase().startsWith(prefix))
        .map(name => path.join(extensionsDir, name));
}

/** The editor parks a removed extension in `.obsolete` until its next start; the folder is gone now. */
function forgetObsolete(extensionsDir: string): void {
    const marker = path.join(extensionsDir, '.obsolete');
    if (!extensionsDir || !fs.existsSync(marker)) {
        return;
    }
    try {
        const entries = JSON.parse(fs.readFileSync(marker, 'utf8')) as Record<string, unknown>;
        const kept = Object.fromEntries(
            Object.entries(entries).filter(
                ([name]) => !name.toLowerCase().includes(SECONDANT_ID.toLowerCase())
            )
        );
        if (Object.keys(kept).length !== Object.keys(entries).length) {
            fs.writeFileSync(marker, JSON.stringify(kept));
        }
    } catch (err) {
        console.error('[secondant] could not read .obsolete', err);
    }
}

export async function uninstallSecondant(): Promise<void> {
    const live = vscode.extensions.getExtension(SECONDANT_ID);
    // The directory the editor is loading is the only reliable pointer to the extensions folder.
    const extensionsDir = live ? path.dirname(live.extensionPath) : '';

    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', SECONDANT_ID);

    const candidates = secondantDirectories(extensionsDir);
    if (!extensionsDir || candidates.length === 0) {
        console.log(
            `[secondant] no version directory found under ${extensionsDir || '(unknown extensions folder)'}`
        );
    }

    let removed = 0;
    for (const dir of candidates) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            removed += 1;
            console.log('[secondant] removed', dir);
        } catch (err) {
            console.error('[secondant] could not remove', dir, err);
        }
    }
    forgetObsolete(extensionsDir);
    await refreshSecondantContext();

    const suffix = removed ? ` (${removed} folder${removed === 1 ? '' : 's'} removed)` : '';
    const reload = 'Reload window';
    void vscode.window
        .showInformationMessage(`Tommys Hermes Secondant uninstalled${suffix}.`, reload)
        .then(choice => {
            if (choice === reload) {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
}
