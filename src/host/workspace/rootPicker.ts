import { offeredRoots } from './cwd';
import type { WorkspaceCwd } from './cwd';
import type { HostToPane } from '../../shared/webview';

/** What the pane may ask of the permission root: one member on RouterHost, not two (R2). */
export interface PermissionRootCommands {
    /** Pick a folder, or '' to fall back to the primary. */
    set(root: string): Promise<void>;
    /** Open the dialog: answered by a `permissionRootState` with `open`. */
    open(): void;
}

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
    /** Told when a run ends: a pick refused while it ran applies then. */
    onRunEnded(handler: () => void): () => void;
    /**
     * Say something to the rail surfaces only. False when none is live: an automatic open is then
     * dropped, and the surface hears it on its next `republish()`.
     */
    postToRail(msg: HostToPane): boolean;
}

/**
 * The permission root: which folder of a multi-folder workspace Hermes works in.
 *
 * One folder is the workspace itself, so there is nothing to pick; two or more open the dialog by
 * themselves whenever the folder list changes, because a folder appearing or disappearing is the
 * moment the boundary moved under the user's feet. The choice is per workspace, never per tab.
 */
export class RootPicker {
    /** What was last said, so a pane that was not there hears it when it appears. */
    private _last?: { open?: boolean; notice?: 'lastRootRemoved' | 'appliesNextRun' };

    /**
     * The pane's two commands, as the router reaches them.
     *
     * The surface has already opened its own row when it asks, so `open` only needs the facts.
     */
    readonly commands: PermissionRootCommands = {
        set: (root) => this.setRoot(root),
        open: () => this.state(),
    };

    constructor(private readonly _host: RootPickerHost) {}

    /**
     * Say it again for a pane that has just been shown.
     *
     * The host posts to whichever surface exists; a dialog due while the view was hidden would
     * otherwise be lost, and the window's boundary would have moved without a word.
     */
    republish(): void {
        if (this._last) {
            this.state(this._last);
        }
    }

    /** A pick that arrived while a run was busy: it applies when that run ends. */
    private _appliesAfterRun = false;

    /**
     * Start watching, and say the state once so the window begins where it left off.
     *
     * A workspace showing two or more folders opens the dialog every time, with the active root
     * marked — the first time that is the primary, afterwards the stored choice. Reconciling the
     * stored roots already happens on every read, so this asks the owner and reports; it does not
     * compare anything itself. With one folder there is nothing to choose and only the state is
     * posted. A surface that is not up yet hears the same thing through `republish()`.
     */
    start(): () => void {
        const unwatch = this._host.cwd.watch(() => this.onFoldersChanged());
        const unlisten = this._host.onRunEnded(() => this.afterRun());
        this.state({ open: offeredRoots(this._host.cwd.folders()).length > 0 });
        return () => {
            unwatch();
            unlisten();
        };
    }

    /** The run that refused the pick is over: move the session now, and say so. */
    async afterRun(): Promise<void> {
        if (!this._appliesAfterRun) {
            return;
        }
        this._appliesAfterRun = false;
        await this._host.reloadActiveSession();
        this.state();
    }

    /** The current state, as the pane draws it. */
    state(options?: { open?: boolean; notice?: 'lastRootRemoved' | 'appliesNextRun' }): void {
        this._last = options;
        const folders = this._host.cwd.folders();
        const root = this._host.cwd.forWindow();
        const offered = offeredRoots(folders);
        const state = {
            type: 'permissionRootState' as const,
            root,
            folders,
            offered,
            profile: this._host.profileLabel(),
            ...(options?.notice ? { notice: options.notice } : {}),
        };
        // The facts go everywhere: both surfaces draw the button from them.
        this._host.post({ ...state, open: false });
        // The automatic open goes to the rail only, and is dropped when no rail is live.
        if ((options?.open ?? false) && offered.length > 0) {
            const sent = this._host.postToRail({ ...state, open: true });
            if (!sent) {
                this._host.log('Permission root: no rail surface to open the dialog in');
            }
        }
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
            // Hermes moves a session only while it is idle, so say when this one takes effect —
            // and remember to do it, because nothing else will.
            this._appliesAfterRun = true;
            this.state({ notice: 'appliesNextRun' });
            return;
        }
        await this._host.reloadActiveSession();
        this.state();
    }
}
