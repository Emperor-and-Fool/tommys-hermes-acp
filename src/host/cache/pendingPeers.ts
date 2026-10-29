/**
 * Forwarded drafts that have arrived but not been decided, kept on disk.
 *
 * Hermes cannot hold these for us: a peer card is not a turn until the moderator delivers it, so
 * nothing about it exists in the agent's transcript. That made the card memory-only, and the inbox
 * advances its cursor and its seen-set the moment it injects one — so a reload, a tab switch or a
 * catalog settle lost the draft for good.
 *
 * The state a card carries is the whole card: the envelope id (the dedupe key and the address of
 * the Deliver/Dismiss action), the body, who sent it, and the history ref it may hold. One file
 * per tab, capped; a decision removes its entry, which is what makes "the first decision stands".
 */
import * as fs from 'fs';
import path from 'path';
import type { HistoryRef, PeerRef } from '../../shared/chat';

/** A stack can be longer than the user sidecar's five: these are drafts waiting on a human. */
export const PENDING_PEER_LIMIT = 20;

export interface PendingPeer {
    envelopeId: string;
    text: string;
    peer: PeerRef;
    history?: HistoryRef;
    savedAt: number;
}

export class PendingPeerStore {
    constructor(private readonly _historyDir: string) {}

    pathFor(tabId: string): string {
        const safe = (tabId || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
        return path.join(this._historyDir, `pending_peers_${safe}.json`);
    }

    read(tabId: string): PendingPeer[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.pathFor(tabId), 'utf-8')) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.filter((entry): entry is PendingPeer => !!entry
                && typeof (entry as PendingPeer).envelopeId === 'string'
                && typeof (entry as PendingPeer).text === 'string'
                && !!(entry as PendingPeer).peer
            ).slice(-PENDING_PEER_LIMIT);
        } catch {
            return [];
        }
    }

    /** One write per arrival; an envelope id seen before is not written twice. */
    append(tabId: string, entry: PendingPeer): void {
        if (!entry.envelopeId) {
            return;
        }
        const existing = this.read(tabId).filter(item => item.envelopeId !== entry.envelopeId);
        this._write(tabId, [...existing, entry].slice(-PENDING_PEER_LIMIT));
    }

    /** A decision: the entry stops existing, so it cannot come back on the next reload. */
    remove(tabId: string, envelopeId: string): void {
        const keep = this.read(tabId).filter(item => item.envelopeId !== envelopeId);
        if (keep.length === 0) {
            this.clear(tabId);
            return;
        }
        this._write(tabId, keep);
    }

    clear(tabId: string): void {
        try {
            fs.unlinkSync(this.pathFor(tabId));
        } catch { /* already gone */ }
    }

    private _write(tabId: string, peers: PendingPeer[]): void {
        try {
            fs.mkdirSync(this._historyDir, { recursive: true });
            fs.writeFileSync(this.pathFor(tabId), JSON.stringify(peers), 'utf-8');
        } catch { /* the sidecar is a guard, never a blocker */ }
    }
}
