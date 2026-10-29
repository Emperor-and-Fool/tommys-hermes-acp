/**
 * The shared-file inbox the two panes trade drafts through.
 *
 * Two extension hosts append to one NDJSON file under the Hermes home; each reads only what is
 * past its own cursor and takes only the envelopes addressed to its profile. Nothing here sends:
 * an envelope becomes text in the recipient's composer, and the recipient decides.
 *
 * Presence is a file per profile, rewritten every few seconds. It answers two questions the
 * extension cannot answer for itself: is the other pane running, and what is it called.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type * as vscode from 'vscode';
import { PANE_MAIL_DIR, PANE_MAIL_LOG, PaneMailEnvelope, parseEnvelope, serializeEnvelope } from '../../shared/paneMail';
import type { HistoryRef } from '../../shared/chat';
import { resolveDefaultHermesHome } from '../environment/hermesPaths';

/** A presence file older than this says the other pane is gone, whatever it last wrote. */
const PRESENCE_TTL_MS = 30_000;
const HEARTBEAT_MS = 10_000;

export interface PaneMailHost {
    /** This pane's profile, as the user sees it in the chip. */
    profile(): string;
    /** A draft arrived and is addressed here: put it in the transcript as a peer card. */
    onPeer(envelope: PaneMailEnvelope): void;
    /** Tell the pane whether the other side is live, and what it is called. */
    setOtherPaneLive(live: boolean, profile: string): void;
    /** Long-lived state: the read cursor must survive a reload. */
    state: vscode.Memento;
    log(line: string): void;
}

export function paneMailPaths(hermesHome = resolveDefaultHermesHome()) {
    const dir = path.join(hermesHome, PANE_MAIL_DIR);
    return {
        dir,
        log: path.join(dir, PANE_MAIL_LOG),
        presence: (profile: string) => path.join(dir, `presence-${sanitize(profile)}.json`),
    };
}

/** A profile name is user-chosen; keep it usable as a file name. */
function sanitize(profile: string): string {
    return profile.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/** Append-only writer. One `appendFileSync` per envelope keeps lines whole across processes. */
export class PaneMailOutbox {
    constructor(private readonly _host: PaneMailHost) {}

    send(envelope: PaneMailEnvelope): boolean {
        const paths = paneMailPaths();
        try {
            fs.mkdirSync(paths.dir, { recursive: true });
            fs.appendFileSync(paths.log, serializeEnvelope(envelope), 'utf8');
            this._host.log(`Forwarded to ${envelope.toProfile} (${envelope.id})`);
            return true;
        } catch (err) {
            this._host.log(`Forward failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
}

/** Heartbeat per profile; also the only way a pane learns the other side's name. */
export class PaneMailPresence {
    private _timer?: NodeJS.Timeout;
    private _lastLive = false;
    private _lastProfile = '';

    constructor(private readonly _host: PaneMailHost) {}

    start(): void {
        this.beat();
        this._timer = setInterval(() => this.beat(), HEARTBEAT_MS);
    }

    beat(): void {
        const paths = paneMailPaths();
        const profile = this._host.profile();
        if (!profile) {
            return;
        }
        try {
            fs.mkdirSync(paths.dir, { recursive: true });
            fs.writeFileSync(paths.presence(profile), JSON.stringify({ liveAt: Date.now(), host: os.hostname() }));
        } catch (err) {
            this._host.log(`Presence write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.refresh();
    }

    /** The newest other profile that has written recently. */
    other(): { profile: string; host: string } | null {
        const paths = paneMailPaths();
        const mine = sanitize(this._host.profile());
        let best: { profile: string; host: string; liveAt: number } | null = null;
        try {
            for (const name of fs.readdirSync(paths.dir)) {
                if (!name.startsWith('presence-') || !name.endsWith('.json')) {
                    continue;
                }
                const profile = name.slice('presence-'.length, -'.json'.length);
                if (profile === mine) {
                    continue;
                }
                const raw = JSON.parse(fs.readFileSync(path.join(paths.dir, name), 'utf8')) as {
                    liveAt?: number;
                    host?: string;
                };
                const liveAt = typeof raw.liveAt === 'number' ? raw.liveAt : 0;
                if (!best || liveAt > best.liveAt) {
                    best = { profile, host: typeof raw.host === 'string' ? raw.host : '', liveAt };
                }
            }
        } catch {
            return null;
        }
        if (!best || Date.now() - best.liveAt > PRESENCE_TTL_MS) {
            return null;
        }
        return { profile: best.profile, host: best.host };
    }

    /** Tells the pane only when the answer changed: this runs every ten seconds. */
    refresh(force = false): void {
        const other = this.other();
        const live = !!other;
        const profile = other?.profile ?? '';
        if (!force && live === this._lastLive && profile === this._lastProfile) {
            return;
        }
        this._lastLive = live;
        this._lastProfile = profile;
        this._host.setOtherPaneLive(live, profile);
    }

    dispose(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }
}

/** Reader: a byte cursor in global state, one injection per envelope id. */
export class PaneMailInbox {
    private _watcher?: fs.FSWatcher;
    private _seen?: Set<string>;

    constructor(private readonly _host: PaneMailHost) {}

    private get _cursorKey(): string {
        return `paneMail.cursor.${this._host.profile()}`;
    }

    private get _seenKey(): string {
        return `paneMail.seen.${this._host.profile()}`;
    }

    /** Envelope ids already taken for this profile, kept across reloads (see `drain`). */
    private seen(): Set<string> {
        if (!this._seen) {
            const stored = this._host.state.get<string[]>(this._seenKey) ?? [];
            this._seen = new Set(stored);
        }
        return this._seen;
    }

    start(): void {
        const paths = paneMailPaths();
        try {
            fs.mkdirSync(paths.dir, { recursive: true });
            if (!fs.existsSync(paths.log)) {
                fs.writeFileSync(paths.log, '');
            }
        } catch (err) {
            this._host.log(`Mailbox unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        // Watch the directory: the log can be replaced, and a watcher on a missing path is silent.
        try {
            this._watcher = fs.watch(paths.dir, (_event, file) => {
                if (!file || file === PANE_MAIL_LOG) {
                    this.drain();
                }
            });
        } catch (err) {
            this._host.log(`Mailbox watch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.drain();
    }

    /** Read everything past the cursor and inject what is addressed here. */
    drain(): number {
        const paths = paneMailPaths();
        const stored = this._host.state.get<number>(this._cursorKey) ?? 0;
        let buf: Buffer;
        try {
            buf = fs.readFileSync(paths.log);
        } catch {
            return 0;
        }
        // A shorter file than the cursor means the log was recreated; start over rather than skip.
        //
        // Not replay-safe on its own: if the log is ever rolled or truncated while unread
        // envelopes are still in it, both panes re-ingest from zero and the moderator sees
        // duplicate cards. That is why taken envelope ids are remembered in global state and
        // not only in memory — a roll plus a reload would otherwise take the same card twice.
        // The standing rule stays: never roll a non-empty log.
        const offset = stored > buf.length ? 0 : stored;
        const fresh = buf.subarray(offset).toString('utf8');
        if (!fresh) {
            return 0;
        }

        const profile = this._host.profile();
        let injected = 0;
        const lines = fresh.split('\n');
        // The last element is either '' (clean append) or a half-written line: keep it for later.
        const tail = lines.pop() ?? '';
        for (const line of lines) {
            const envelope = parseEnvelope(line);
            if (!envelope) {
                continue;
            }
            const seen = this.seen();
            if (envelope.toProfile !== profile || seen.has(envelope.id)) {
                continue;
            }
            seen.add(envelope.id);
            void this._host.state.update(this._seenKey, [...seen].slice(-200));
            this._host.onPeer(envelope);
            injected += 1;
        }
        const consumed = lines.map(line => line + '\n').join('');
        const nextOffset = offset + Buffer.byteLength(consumed, 'utf8');
        void this._host.state.update(this._cursorKey, nextOffset);
        if (injected) {
            this._host.log(`Received ${injected} forwarded draft(s)`);
        }
        void tail;
        return injected;
    }

    dispose(): void {
        this._watcher?.close();
        this._watcher = undefined;
    }
}

/** One envelope, built where the host knows all four names. */
export function newEnvelope(input: {
    fromProfile: string;
    toProfile: string;
    body: string;
    sourceMessageId?: string;
    history?: HistoryRef;
}): PaneMailEnvelope {
    return {
        id: crypto.randomUUID(),
        writtenAt: Date.now(),
        fromProfile: input.fromProfile,
        fromHost: os.hostname(),
        toProfile: input.toProfile,
        body: input.body,
        sourceMessageId: input.sourceMessageId,
        history: input.history,
    };
}
