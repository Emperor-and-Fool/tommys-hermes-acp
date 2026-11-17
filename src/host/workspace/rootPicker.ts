import { offeredRoots } from './cwd';
import type { WorkspaceCwd } from './cwd';
import type { HostToPane } from '../../shared/webview';

/** What the picker needs from the rest of the extension. */
export interface RootPickerHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    /** The cwd owner: it reads, records and reconciles the roots. */
    cwd: WorkspaceCwd;
    /** Whether a run is in flight. A root change then applies to the next one. */
    activeSessionBusy(): boolean;
    /** Re-load the active session so Hermes moves it to the new cwd now. */
    reloadActiveSession(): Promise<void>;
    /** The profile whose name the dialog uses. */
    profileLabel(): string;
}

/**
 * The permission root: which folder of a multi-folder workspace Hermes works in.
 *
 * One folder is the workspace itself, so there is nothing to pick; two or more open the dialog by
 * themselves whenever the folder list changes, because a folder appearing or disappearing is the
 * moment the boundary moved under the user's feet. The choice is per workspace, never per tab.
 */
export class RootPicker {
    constructor(private readonly _host: RootPickerHost) {}

    /** Start watching: the window's folders decide when the dialog opens. */
    start(): () => void {
        return this._host.cwd.watch(() => this.onFoldersChanged());
    }

    /** The current state, as the pane draws it. */
    state(options?: { open?: boolean; notice?: 'lastRootRemoved' | 'appliesNextRun' }): void {
        const folders = this._host.cwd.folders();
        const root = this._host.cwd.forWindow();
        const offered = offeredRoots(folders);
        this._host.post({
            type: 'permissionRootState',
            root,
            folders,
            offered,
            open: (options?.open ?? false) && offered.length > 0,
            profile: this._host.profileLabel(),
            ...(options?.notice ? { notice: options.notice } : {}),
        });
        this._host.log(`Permission root: ${root || '(none)'} of ${folders.length} folder(s)`);
    }

    /** A folder appeared or went: reconcile, say so, and open the dialog when there is a choice. */
    onFoldersChanged(): void {
        const folders = this._host.cwd.folders();
        if (folders.length === 0) {
            // The last root went: nothing in this window can reach the projects any more.
            this.state({ notice: 'lastRootRemoved' });
            return;
        }
        this.state({ open: offeredRoots(folders).length > 0 });
    }

    /** The pane's picker answered. */
    async setRoot(folder: string): Promise<void> {
        const before = this._host.cwd.forWindow();
        if (!this._host.cwd.setPermissionRoot(folder)) {
            this.state();
            return;
        }
        const after = this._host.cwd.forWindow();
        if (after === before) {
            this.state();
            return;
        }
        if (this._host.activeSessionBusy()) {
            // Hermes moves a session only while it is idle, so say when this one takes effect.
            this.state({ notice: 'appliesNextRun' });
            return;
        }
        await this._host.reloadActiveSession();
        this.state();
    }
}
