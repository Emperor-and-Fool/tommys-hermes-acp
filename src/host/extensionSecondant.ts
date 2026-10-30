import * as vscode from 'vscode';
import { App } from './app';
import { activateExtension } from './activate';
import { PRIMARY, SECONDANT, setActiveIdentity } from '../shared/extensionId';

/** The primary's API, as far as the secondant is concerned. */
interface PrimaryApi {
    readonly activeProfile: string;
    onDidChangeProfile?(listener: (profile: string) => void): vscode.Disposable;
    /** Present from 2.0.0; the secondant's profile goes up so the primary's picker hides it too. */
    registerSiblingProfile?(profile: string): void;
}

let app: App | undefined;
/** Kept so the primary's withholding can be released when this extension goes away. */
let primaryApi: PrimaryApi | undefined;

/**
 * The secondant: the same client as the primary, on its own ids, with one rule of its own —
 * it may not run on the profile the primary is using.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    setActiveIdentity(SECONDANT);

    const primary = vscode.extensions.getExtension<PrimaryApi>(PRIMARY.extensionId);
    if (!primary) {
        void vscode.window.showErrorMessage(
            'Tommys Hermes ACP (primary) is required; the secondant will not start without it.'
        );
        return;
    }

    // Activate the primary first: its exports carry the profile this one has to avoid.
    const exports = await primary.activate();
    if (!exports) {
        void vscode.window.showErrorMessage('Tommys Hermes ACP (primary) did not start.');
        return;
    }

    const running = activateExtension(context, SECONDANT, exports);
    app = running;
    primaryApi = exports;

    if (running.dropSharedProfile(exports.activeProfile)) {
        warn(exports.activeProfile);
    }
    exports.onDidChangeProfile?.(profile => {
        if (app?.dropSharedProfile(profile)) {
            warn(profile);
        }
    });
    // And the other direction: the primary must not offer the profile this pane is on either.
    // Later moves are pushed from the profile-changed callback in App.
    exports.registerSiblingProfile?.(running.activeProfile);
}

function warn(profile: string): void {
    void vscode.window.showWarningMessage(
        `The primary is using "${profile}" too. The secondant has disconnected — choose another profile.`
    );
}

export function deactivate(): void {
    app?.dispose();
    app = undefined;
    // Release the withholding: an empty profile means "nothing to avoid", so the primary's
    // picker stops hiding a profile this extension no longer uses.
    primaryApi?.registerSiblingProfile?.('');
    primaryApi = undefined;
}
