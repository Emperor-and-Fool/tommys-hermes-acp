/**
 * Who this build of the extension is.
 *
 * One codebase, two identities: the primary and the secondant share every module, and the only
 * difference between them is the object below. Nothing else in `src/` may name the extension —
 * a hard-coded `tommys.…` is a bug that only shows up in the secondant's build.
 *
 * The active identity is set once, first thing in each `activate()`. That is enough because the
 * two extensions load their own copy of this module from their own folder: each extension host
 * module registry keys by absolute path, so `PRIMARY` and `SECONDANT` never share a variable.
 */

export interface ExtensionIdentity {
    /** Settings and command prefix: `tommys` | `tommys2`. */
    readonly prefix: string;
    /** Marketplace id: `EmperorAndFool.tommys-hermes-acp` | `…-secondant`. */
    readonly extensionId: string;
    /** Side bar view: `tommysChat` | `tommys2Chat`. */
    readonly chatViewId: string;
    /** Activity-bar container: `tommys-sidebar` | `tommys2-sidebar`. */
    readonly sidebarId: string;
    /** Editor-tab panel type, restored by the serializer. */
    readonly chatPanelType: string;
    /** Read-only history viewer's editor tab. */
    readonly historyViewerType: string;
    /** Which of the two this is; the pane uses it for its accent. */
    readonly role: 'primary' | 'secondant';
    /** `id.cmd('openChat')` → `tommys.openChat` | `tommys2.openChat`. */
    cmd(name: string): string;
}

function identityFor(prefix: string, extensionId: string, role: 'primary' | 'secondant'): ExtensionIdentity {
    return Object.freeze({
        prefix,
        extensionId,
        role,
        chatViewId: `${prefix}Chat`,
        sidebarId: `${prefix}-sidebar`,
        chatPanelType: `${prefix}.chatPanel`,
        historyViewerType: `${prefix}.historyViewer`,
        cmd: (name: string): string => `${prefix}.${name}`,
    });
}

export const PRIMARY: ExtensionIdentity = identityFor(
    'tommys',
    'EmperorAndFool.tommys-hermes-acp',
    'primary'
);

export const SECONDANT: ExtensionIdentity = identityFor(
    'tommys2',
    'EmperorAndFool.tommys-hermes-secondant',
    'secondant'
);

let active: ExtensionIdentity = PRIMARY;

/** Called once per activation, before anything reads a setting or registers a command. */
export function setActiveIdentity(identity: ExtensionIdentity): void {
    active = identity;
}

export function identity(): ExtensionIdentity {
    return active;
}

/** A settings key: `setting('path')` → `tommys.path` | `tommys2.path`. */
export function setting(key: string): string {
    return `${active.prefix}.${key}`;
}

/** The settings section itself, for `getConfiguration`. */
export function settingsSection(): string {
    return active.prefix;
}

/** A command id: `commandId('openChat')` → `tommys.openChat` | `tommys2.openChat`. */
export function commandId(name: string): string {
    return active.cmd(name);
}
