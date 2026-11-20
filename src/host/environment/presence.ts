import type { PresenceRow, PresenceStore } from '../store/presence';

/** The beat: every 15 s, so three misses (`PRESENCE_STALE_MS`) is a window that is gone. */
const HEARTBEAT_MS = 15_000;

/** What the heartbeat needs from the rest of the extension. */
export interface ProfilePresenceHost {
    /** The table: one file per instance, in our data home. */
    store: PresenceStore;
    /** Which of the two extensions this is. */
    role: 'primary' | 'secondant';
    /** The CLI profile Hermes would run on; '' when this instance has none. */
    profile(): string;
    log(line: string): void;
}

/**
 * This instance's presence: the row other windows read before they offer a profile.
 *
 * It is not a store and owns no data — the store is `host/store/presence.ts`. This is the feature
 * side: when to say it, and what to do when there is nothing to say.
 *
 * Written on start, on every profile change (the same moment `profileChanged` fires) and on every
 * beat. A disconnected instance has no profile to announce, so its file is removed instead of
 * holding a row that says nothing. `dispose` removes it too: a closed window must not keep a
 * profile out of the other window's picker until the beat goes stale.
 */
export class ProfilePresence {
    private _timer?: ReturnType<typeof setInterval>;
    /** What the last write said, so the log speaks only when the answer changes. */
    private _announcedProfile = '';
    private _announcing = false;
    /**
     * Whether this instance has connected to a profile at all.
     *
     * A picker that offers a taken profile is not a connection: the guarantee refuses it, and
     * announcing it here would claim a profile another window is actually running. Only a connect
     * that got past that guarantee says this instance is on a profile.
     */
    private _connected = false;

    constructor(private readonly _host: ProfilePresenceHost) {}

    /** Say it now, then keep saying it. Nothing is announced until a connect has landed. */
    start(): void {
        this.beat();
        this._timer = setInterval(() => this.beat(), HEARTBEAT_MS);
    }

    /**
     * A connect got past the excluded-profile guarantee: this instance really is on that profile.
     *
     * From here the beat may announce it, and a refusal can no longer change it — a refused connect
     * leaves the row as it was, which is what the other windows should keep reading.
     */
    connected(): void {
        this._connected = true;
        this.beat();
    }

    /** Say where this instance stands: on a connect, on a profile change, and on every beat. */
    beat(): void {
        if (!this._connected) {
            return;
        }
        const cliProfile = this._host.profile();
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
