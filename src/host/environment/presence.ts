import type { PresenceRow, PresenceStore } from '../store/presence';

/** The beat: every 15 s, so three misses (`PRESENCE_STALE_MS`) is a window that is gone. */
const HEARTBEAT_MS = 15_000;

/** What the heartbeat needs from the rest of the extension. */
export interface ProfilePresenceHost {
    /** The table: one file per instance, in our data home. */
    store: PresenceStore;
    /** Which of the two extensions this is. */
    role: 'primary' | 'secondant';
    /** The CLI profile the picker would connect to; '' when this instance has none selected. */
    profile(): string;
    /** Whether a client is connected at all: a dropped link means no profile is being run. */
    live(): boolean;
    log(line: string): void;
}

/**
 * This instance's presence: the row other windows read before they offer a profile.
 *
 * It is not a store and owns no data — the store is `host/store/presence.ts`. This is the feature
 * side: when to say it, and what to do when there is nothing to say.
 *
 * **It announces the profile a connect landed on, never the one the picker selected.** A selection
 * is set before the excluded-profile guarantee runs, so a switch to a profile another window holds
 * would otherwise be announced for the moment between the selection and the refusal — and the
 * other window would then be told its own profile is taken. `connected()` records the profile the
 * connect got past the guarantee with; the beat writes that record and nothing else.
 *
 * The row goes when there is nothing to announce: no profile, no live connection (a dropped link),
 * or the window closing. A closed window must not keep a profile out of another window's picker
 * until the beat goes stale.
 */
export class ProfilePresence {
    private _timer?: ReturnType<typeof setInterval>;
    /** What the last write said, so the log speaks only when the answer changes. */
    private _announcedProfile = '';
    private _announcing = false;
    /** Whether a connect has landed at all: before that there is nothing to announce. */
    private _connected = false;
    /** The profile that connect landed on. Beats write this, never the current selection. */
    private _liveProfile = '';

    constructor(private readonly _host: ProfilePresenceHost) {}

    /** Start the beat. Nothing is announced until a connect has landed. */
    start(): void {
        this.beat();
        this._timer = setInterval(() => this.beat(), HEARTBEAT_MS);
    }

    /**
     * A connect got past the excluded-profile guarantee: this instance really is on that profile.
     *
     * Read from the selection at this moment and recorded; a later selection that never connects
     * (the guarantee refuses it) changes nothing here.
     */
    connected(): void {
        this._liveProfile = this._host.profile();
        this._connected = true;
        this.beat();
    }

    /** Say where this instance stands, from the recorded profile and the live connection. */
    beat(): void {
        if (!this._connected) {
            return;
        }
        if (!this._host.live()) {
            // A dropped client runs no profile: say nothing rather than the last one.
            this._stopAnnouncing('disconnected');
            this._liveProfile = '';
            return;
        }
        const cliProfile = this._liveProfile;
        if (!cliProfile) {
            this._stopAnnouncing('no profile');
            return;
        }
        if (!this._announcing || cliProfile !== this._announcedProfile) {
            this._host.log(`Presence: this instance runs "${cliProfile}"`);
        }
        try {
            this._host.store.write({ role: this._host.role, cliProfile, liveAt: Date.now() });
            this._announcing = true;
            this._announcedProfile = cliProfile;
        } catch (err) {
            this._host.log(`Presence: could not write this instance's row: ${String(err)}`);
        }
    }

    /** The window is closing: the timer stops and the row goes, so no one waits for it to go stale. */
    dispose(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
        this._stopAnnouncing('disposed');
    }

    /** The other instances that are still live: the rows every picker's exclusions are built from. */
    live(): PresenceRow[] {
        try {
            return this._host.store.live();
        } catch {
            return [];
        }
    }

    private _stopAnnouncing(reason: string): void {
        if (!this._announcing) {
            return;
        }
        this._host.store.remove();
        this._announcing = false;
        this._announcedProfile = '';
        this._host.log(`Presence: this instance's row removed (${reason})`);
    }
}
