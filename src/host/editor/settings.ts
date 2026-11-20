import * as vscode from 'vscode';
import { settingsSection } from '../../shared/extensionId';
import type { EditorSettings } from '../../shared/editor';

/** One setting, in our section: with a default when the caller has one, else what is stored. */
function readSetting<T>(key: string): T | undefined;
function readSetting<T>(key: string, defaultValue: T): T;
function readSetting<T>(key: string, defaultValue?: T): T | undefined {
    return vscode.workspace.getConfiguration(settingsSection()).get<T>(key, defaultValue as T);
}

/**
 * Our own settings, behind the port the features read them through.
 *
 * The section is applied here, once: a caller asks for `path`, not `tommys.path`. The change
 * subscription is filtered the same way — the editor reports every setting of every extension,
 * and the composition root used to sift them with `affectsConfiguration`.
 */
export function createEditorSettings(): EditorSettings {
    return {
        get: readSetting,

        onDidChange: (handler) => {
            const subscription = vscode.workspace.onDidChangeConfiguration(event => {
                if (!event.affectsConfiguration(settingsSection())) {
                    return;
                }
                const section = settingsSection();
                handler(key => event.affectsConfiguration(`${section}.${key}`));
            });
            return { dispose: () => subscription.dispose() };
        },
    };
}
