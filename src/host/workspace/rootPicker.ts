import * as fs from 'fs';
import { offeredRoots } from './cwd';
import type { WorkspaceCwd } from './cwd';
import type { HostToPane } from '../../shared/webview';

/** How often the welcome ticks: one second of the thirty the store hands a new folder. */
const TICK_MS = 1000;

/** What the pane may ask of the permission root: one member on RouterHost, not three (R2). */
export interface PermissionRootCommands {
    /** Pick a folder, or '' to fall back to the primary. */
    set(root: string): Promise<void>;
    /** Ask for the facts again: answered by a `permissionRootState`. */
    open(): void;
    /** The row was closed in the pane: the countdown stops, and a notice is spent. */
    close(): void;
}

/**
 * What the row has to say about the boundary, beyond the folders themselves.
 *
 * Each one describes something the user cannot see from the chips: a move that did not happen, a
 * folder that is only a row now, a root that left while the session was working in it.
 */
export type RootNotice =
    | { kind: 'lastRootRemoved' }
    | { kind: 'appliesNextRun' }
    | { kind: 'moveRefused'; folder: string; previous: string }
    | { kind: 'rootRemoved'; folder: string };

/** What the picker needs from the rest of the extension. */
export interface RootPickerHost {
    post(msg: HostToPane): void;
    log(line: string): void;
    /** The cwd owner: it reads, records and reconciles the roots. */
    cwd: WorkspaceCwd;
    /** Whether a run is in flight. A root change then applies to the next one. */
    activeSessionBusy(): boolean;
    /**
     * Re-load the active session so Hermes moves it to the new cwd now.
     *
     * False when the move was refused — and only a real refusal counts: a tab with no Hermes
     * session has nothing to move, which is not the same answer.
     */
    reloadActiveSession(): Promise<boolean>;
    /** The root folder id of the tab on screen; '' when it has not chosen one. */
    sessionRootId(): string;
    /** Put that tab's root folder. False when the tab is not one of ours. */
    setSessionRoot(folderId: string): boolean;
    /** The profile whose name the dialog uses. */
    profileLabel(): string;
    /** Told when a run ends: a pick refused while it ran applies then. */
    onRunEnded(handler: () => void): () => void;
    /** Told when a profile becomes active: the agent connected, its sessions are on screen. */
    onProfileActive(handler: () => void): () => void;
    /** Whether the rail is on screen right now: only the rail opens the row by itself. */
    railInView(): boolean;
    /**
     * Say something to the rail surfaces only. False when none is live: an automatic open is then
     * dropped, and the surface hears it on its next `republish()`.
     */
    postToRail(msg: HostToPane): boolean;
}

/**
 * The permission root: which folder of a multi-folder workspace Hermes works in.
 *
 * One folder is the workspace itself, so there is nothing to pick. The row opens by itself at the
 * moments something happened that the user has to see:
 *
 *   A. **a profile becomes active** — the agent connected and its sessions appear with their
 *      message counts. The row opens with the session's root marked. A tab switch is not this
 *      moment: it does not connect.
 *   B. **a folder is new and the rail is in view** — either the rail has just appeared, or the
 *      folder joined while it was showing. The row opens, the new folder's chip says so, and the
 *      welcome counts down while it is on screen.
 *   C. **a notice** — a move Hermes refused, or a root that left the workspace under a running
 *      session. The row opens with the notice, and no countdown runs: the notice stays until the
 *      user closes the row or picks a root.
 *
 * Nothing happens when a folder is added to a hidden rail: it waits for the rail, which is the one
 * surface that opens the row by itself. The editor panel's row is a place to click.
 *
 * The welcome lives on the workspace row (30 s, `NEW_FOLDER_SECONDS`), so it survives a window
 * closing and is shared by both panes: they share the workspace.
 */
export class RootPicker {
    /** The standing notice, so a pane that was not there hears it when it appears. */
    private _last?: RootNotice;

    /** A pick that arrived while a run was busy: it applies when that run ends. */
    private _pendingPick?: { previous: string; previousId: string; folder: string };

    /** Seconds left per folder while the row counts down; absent when nothing is counting. */
    private _counting?: Map<string, number>;

    private _timer?: ReturnType<typeof setInterval>;

    /** The removed root already announced, so one removal is one notice. */
    private _announcedRemovedRoot = '';

    /** The missing-folder set last logged, so the log says it when it changes. */
    private _loggedMissing = '';

    /**
     * The pane's commands, as the router reaches them.
     *
     * The surface has already opened its own row when it asks, so `open` only needs the facts.
     */
    readonly commands: PermissionRootCommands = {
        set: (root) => this.setRoot(root),
        open: () => this.state(),
        close: () => this.close(),
    };

    constructor(private readonly _host: RootPickerHost) {}

    /**
     * Say it again for a pane that has just been shown.
     *
     * The host posts to whichever surface exists; the standing notice would otherwise be lost, and
     * the window's boundary would have moved without a word. Nothing is opened here: a rail that
     * has just appeared asks through `railShown()`, which is the one path that opens the row.
     */
    republish(): void {
        this.state(this._last ? { notice: this._last } : undefined);
    }

    /**
     * Start watching the three things that decide the row: the folder list, the end of a run, and a
     * profile becoming active.
     *
     * Nothing opens here. The window begins with the facts posted and the row closed; the moments
     * that open it are `profileBecameActive()`, `railShown()` and a notice.
     */
    start(): () => void {
        const unwatch = this._host.cwd.watch(() => this.onFoldersChanged());
        const unlistenRun = this._host.onRunEnded(() => this.afterRun());
        const unlistenProfile = this._host.onProfileActive(() => this.profileBecameActive());
        this.state();
        return () => {
            unwatch();
            unlistenRun();
            unlistenProfile();
            this._discardCounting();
        };
    }

    /** Moment A: a profile became active, so its sessions are on screen with their counts. */
    private profileBecameActive(): void {
        this._openByItself('profile');
    }

    /**
     * Moment B, one of its two ways in: the rail is in view now.
     *
     * Called when the rail becomes visible, where a folder that joined while it was hidden is
     * finally on screen with the row closed.
     */
    railShown(): void {
        this._openByItself('rail');
    }

    /**
     * Open the row in the rail, and count the welcome down.
     *
     * `profile` opens whenever there is a choice; `rail` only when a folder there is still new —
     * appearing in view is not a reason to open a row that has nothing to point at.
     */
    private _openByItself(moment: 'profile' | 'rail'): void {
        if (offeredRoots(this._host.cwd.folders()).length === 0) {
            return;
        }
        this._startCounting();
        const fresh = this._newFolders();
        if (moment === 'rail' && (fresh.length === 0 || !this._host.railInView())) {
            return;
        }
        this.state({ open: true });
        const list = fresh.length
            ? fresh.map(folder => `${folder.path} (${folder.seconds}s)`).join(', ')
            : 'none';
        this._host.log(
            `Permission root: opened by itself (${moment === 'profile' ? 'profile active' : 'rail in view'})`
            + `, new: ${list}`
        );
    }

    /**
     * Start the welcome countdown, if there is something to count and the rail is on screen.
     *
     * In memory only: the row is a view of the number, and the number is written when the countdown
     * stops, so a window that closes mid-way resumes from what it had reached.
     */
    private _startCounting(): void {
        if (this._timer || !this._host.railInView()) {
            return;
        }
        const fresh = this._host.cwd.live().filter(folder => (folder.newSecondsLeft || 0) > 0);
        if (fresh.length === 0) {
            return;
        }
        this._counting = new Map(fresh.map(folder => [folder.folderId, folder.newSecondsLeft as number]));
        this._timer = setInterval(() => this._tick(), TICK_MS);
    }

    private _tick(): void {
        if (!this._counting) {
            return;
        }
        if (!this._host.railInView()) {
            this._stopCounting('rail hidden');
            return;
        }
        let reachedZero = false;
        for (const [folderId, seconds] of this._counting) {
            const next = seconds - 1;
            this._counting.set(folderId, next);
            if (next <= 0) {
                reachedZero = true;
            }
        }
        if (!reachedZero) {
            return;
        }
        this._stopCounting('zero');
        // The row now reads the stored 0, so the same message without new folders takes "New" away.
        this.state();
    }

    /**
     * Stop counting and keep what is left.
     *
     * Closed after 5 s, the row holds 25; the next time the rail is in view the row opens again and
     * counts down the rest of the welcome.
     */
    private _stopCounting(reason: 'closed' | 'rail hidden' | 'zero'): void {
        if (!this._counting) {
            return;
        }
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
        const left: string[] = [];
        for (const folder of this._host.cwd.live()) {
            const seconds = this._counting.get(folder.folderId);
            if (seconds === undefined) {
                continue;
            }
            const remaining = Math.max(0, seconds);
            this._host.cwd.setFolderNewSeconds(folder.folderId, remaining);
            left.push(`${folder.path} (${remaining}s)`);
        }
        this._counting = undefined;
        this._host.log(`Permission root: countdown stopped (${reason}), left: ${left.join(', ') || 'nothing'}`);
    }

    /** The window is going away: the timer goes with it, and nothing is written for that. */
    private _discardCounting(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
        this._counting = undefined;
    }

    /**
     * The pane closed the row.
     *
     * Two things end here: the countdown (which keeps the seconds it reached) and the notice, which
     * has been read by the person who closed it.
     */
    close(): void {
        this._stopCounting('closed');
        this._last = undefined;
    }

    /** The live folders whose welcome has not run out, with the seconds left. */
    private _newFolders(): Array<{ path: string; seconds: number }> {
        return this._host.cwd.live()
            .map(folder => ({
                path: folder.path,
                seconds: this._counting?.get(folder.folderId) ?? (folder.newSecondsLeft || 0),
            }))
            .filter(folder => folder.seconds > 0);
    }

    /** The run that refused the pick is over: move the session now, and say whether it moved. */
    async afterRun(): Promise<void> {
        const pending = this._pendingPick;
        if (!pending) {
            return;
        }
        this._pendingPick = undefined;
        if (await this._host.reloadActiveSession()) {
            this.state();
            return;
        }
        this._host.setSessionRoot(pending.previousId);
        this.state({
            open: true,
            notice: { kind: 'moveRefused', folder: pending.folder, previous: pending.previous },
        });
    }

    /** The current state, as the pane draws it. */
    state(options?: { open?: boolean; notice?: RootNotice }): void {
        this._last = options?.notice;
        const folders = this._host.cwd.folders();
        const root = this._host.cwd.forSession(this._host.sessionRootId());
        const offered = offeredRoots(folders);
        const newFolders = this._newFolders()
            .map(folder => folder.path)
            .filter(folderPath => offered.includes(folderPath));
        const missingFolders = this._missing(offered);
        const notice = options?.notice;
        const state = {
            type: 'permissionRootState' as const,
            root,
            folders,
            offered,
            newFolders,
            missingFolders,
            profile: this._host.profileLabel(),
            ...(notice ? this._noticeFields(notice) : {}),
        };
        // The facts go everywhere: both surfaces draw the button from them.
        this._host.post({ ...state, open: false });
        // The automatic open goes to the rail only, and is dropped when no rail is live. A notice
        // is a reason on its own: the row shows it even when there is one folder left to choose.
        if ((options?.open ?? false) && (offered.length > 0 || !!notice)) {
            const sent = this._host.postToRail({ ...state, open: true });
            if (!sent) {
                this._host.log('Permission root: no rail surface to open the dialog in');
            }
        }
        if (notice) {
            this._host.log(`Permission root: notice ${notice.kind}${this._noticeDetail(notice)}`);
        }
        this._host.log(`Permission root: ${root || '(none)'} of ${folders.length} folder(s)`);
    }

    /** The wire shape of a notice: its kind, and the names its text fills in. */
    private _noticeFields(notice: RootNotice): {
        notice: RootNotice['kind'];
        noticeFolder?: string;
        noticePrevious?: string;
    } {
        if (notice.kind === 'moveRefused') {
            return { notice: notice.kind, noticeFolder: notice.folder, noticePrevious: notice.previous };
        }
        if (notice.kind === 'rootRemoved') {
            return { notice: notice.kind, noticeFolder: notice.folder };
        }
        return { notice: notice.kind };
    }

    /** What the log line adds after the kind: the facts the notice is about. */
    private _noticeDetail(notice: RootNotice): string {
        if (notice.kind === 'moveRefused') {
            return ` (${notice.folder} <- ${notice.previous || '(none)'})`;
        }
        if (notice.kind === 'rootRemoved') {
            return ` (${notice.folder})`;
        }
        return '';
    }

    /**
     * The live folders that are not on disk any more.
     *
     * `fs`, not `vscode`: a folder is missing when the path is gone, and that is a filesystem fact
     * (F6). Checked where the state is built, because a folder can be deleted while the editor
     * still lists it. The log says it once per set, not once per post.
     */
    private _missing(offered: string[]): string[] {
        const missing = offered.filter(folderPath => !fs.existsSync(folderPath));
        const key = missing.join('\n');
        if (missing.length && key !== this._loggedMissing) {
            this._loggedMissing = key;
            this._host.log(`Permission root: not on disk: ${missing.join(', ')}`);
        }
        if (!missing.length) {
            this._loggedMissing = '';
        }
        return missing;
    }

    /**
     * A folder appeared or went: reconcile and say so.
     *
     * Three of the four things an open needs are decided here: a root that left the workspace under
     * the session (a notice, and nothing is reloaded), a folder that joined while the rail is in
     * view (moment B), and the plain facts. One that joined while the rail was hidden waits for the
     * rail, which is what `railShown()` is for.
     */
    onFoldersChanged(): void {
        const folders = this._host.cwd.folders();
        if (folders.length === 0) {
            // The last root went: nothing in this window can reach the projects any more.
            this.state({ notice: { kind: 'lastRootRemoved' } });
            return;
        }
        const removed = this._removedRoot();
        if (removed) {
            this.state({ open: true, notice: removed });
            return;
        }
        this.state();
        this._openByItself('rail');
    }

    /**
     * The session's chosen root is no longer a folder of this workspace.
     *
     * Said once per root: the folders change for other reasons too, and a notice that repeats on
     * every one of them is noise. Nothing is reloaded — Hermes keeps the cwd it has, and moving a
     * running session is not this row's job.
     */
    private _removedRoot(): RootNotice | undefined {
        const chosenId = this._host.sessionRootId();
        if (!chosenId) {
            return undefined;
        }
        if (this._host.cwd.live().some(folder => folder.folderId === chosenId)) {
            this._announcedRemovedRoot = '';
            return undefined;
        }
        const folder = this._host.cwd.folderPath(chosenId);
        if (!folder || this._announcedRemovedRoot === chosenId) {
            return undefined;
        }
        this._announcedRemovedRoot = chosenId;
        return { kind: 'rootRemoved', folder };
    }

    /** The pane's picker answered. */
    async setRoot(folder: string): Promise<void> {
        const before = this._host.cwd.forSession(this._host.sessionRootId());
        const previousId = this._host.sessionRootId();
        const chosen = this._host.cwd.live().find(entry => entry.path === folder);
        if (!chosen || !this._host.setSessionRoot(chosen.folderId)) {
            this.state();
            return;
        }
        if (this._missing([folder]).length > 0) {
            // The chip is disabled in the pane; this is the same refusal on this side, because a
            // message can arrive without a click.
            this._host.setSessionRoot(previousId);
            this._host.log(`Permission root: refused ${folder} — it is not on disk`);
            this.state();
            return;
        }
        const after = this._host.cwd.forSession(this._host.sessionRootId());
        if (after === before) {
            this.state();
            return;
        }
        if (this._host.activeSessionBusy()) {
            // Hermes moves a session only while it is idle, so say when this one takes effect —
            // and remember to do it, because nothing else will.
            this._pendingPick = { previous: before, previousId, folder };
            this.state({ notice: { kind: 'appliesNextRun' } });
            return;
        }
        if (await this._host.reloadActiveSession()) {
            this.state();
            return;
        }
        // Hermes refused the move. The stored root would point at a folder the session is not
        // working in, so it goes back to what it was, and the row says why.
        this._host.setSessionRoot(previousId);
        this.state({ open: true, notice: { kind: 'moveRefused', folder, previous: before } });
    }
}
