/**
 * The mailbox two panes share, and the shape of what travels through it.
 *
 * Pure types and pure string work only: the pane bundle imports this file too, so nothing here
 * may touch `fs` or `path`. Where the file lives is the host's business (see
 * `src/host/chat/paneMail.ts`).
 *
 * One envelope per line, append-only. Nothing is ever rewritten or deleted: a reader keeps a
 * byte cursor, so "what is new" is arithmetic rather than bookkeeping.
 */
import type { HistoryRef } from './chat';

/**
 * One message inside an envelope: the text, and who wrote it.
 *
 * An envelope can carry several, which is what lets the card draw one bubble per message instead
 * of one fused paragraph. `sentBy` here is the sender of this message; the envelope's `forwarder*`
 * fields are the pane that relayed it. The envelope itself has no sender.
 */
export interface PaneMailMessage {
    text: string;
    /**
     * Who wrote this message: `'user'`, `'agent'`, `'tool'`, or the profile that forwarded it when
     * the message was itself a peer card. Read at selection time, because that is the only place
     * the origin is still known — a flattened body cannot tell you afterwards.
     */
    sentBy?: string;
    sourceMessageId?: string;
}

export interface PaneMailEnvelope {
    /** Dedupe key: the same envelope read twice must inject once. */
    id: string;
    /** Epoch ms, for the reader's eyes and for ordering. */
    writtenAt: number;
    /**
     * Who forwarded it: a pane, not a person. The profile and host name the forwarding side;
     * `forwarderRole` says which pane acted. Nothing here identifies who wrote the text.
     */
    forwarderProfile: string;
    forwarderHost: string;
    forwarderRole?: 'primary' | 'secondant';
    /** Who it is for. A reader ignores everything else. */
    toProfile: string;
    /** The forwarded message, verbatim. */
    body: string;
    /**
     * The messages themselves, in order, each with its own sender. This is the only place a sender
     * is recorded: an envelope has a forwarder, not an author.
     */
    
    messages?: PaneMailMessage[];
    /** The forwarded message's local id, for traceability. */
    sourceMessageId?: string;
    /**
     * Set when the forwarded message was a session-memory pick: the recipient draws the envelope
     * from this rather than parsing a description of itself out of the body.
     */
    history?: HistoryRef;
}

/** Directory under the Hermes home, and the file inside it. */
export const PANE_MAIL_DIR = 'pane-mail';
export const PANE_MAIL_LOG = 'log.ndjson';

/** One line of the log: no embedded newlines, so a partial append can never straddle lines. */
export function serializeEnvelope(envelope: PaneMailEnvelope): string {
    return JSON.stringify(envelope) + '\n';
}

/** A ref read from the log: only what a recipient can actually render. */
function parseHistory(value: unknown): HistoryRef | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const ref = value as Partial<HistoryRef>;
    if (typeof ref.sessionId !== 'string' || !ref.sessionId) {
        return undefined;
    }
    return {
        sessionId: ref.sessionId,
        profile: typeof ref.profile === 'string' ? ref.profile : '',
        title: typeof ref.title === 'string' ? ref.title : '',
        count: typeof ref.count === 'number' ? ref.count : 0,
        messageIds: Array.isArray(ref.messageIds) ? ref.messageIds as Array<number | null> : [],
        from: typeof ref.from === 'number' ? ref.from : undefined,
        to: typeof ref.to === 'number' ? ref.to : undefined,
        anchor: typeof ref.anchor === 'string' ? ref.anchor : undefined,
    };
}

export function parseEnvelope(line: string): PaneMailEnvelope | null {
    const text = line.trim();
    if (!text) {
        return null;
    }
    try {
        const value = JSON.parse(text) as Partial<PaneMailEnvelope> & {
            fromProfile?: unknown;
            fromHost?: unknown;
            senderRole?: unknown;
        };
        // Envelopes written before the forwarder rename carry the old names: read both, so a
        // non-empty log never has to be rolled (the standing rule) to stay readable.
        const forwarderProfile = typeof value.forwarderProfile === 'string'
            ? value.forwarderProfile
            : typeof value.fromProfile === 'string' ? value.fromProfile : undefined;
        const forwarderHost = typeof value.forwarderHost === 'string'
            ? value.forwarderHost
            : typeof value.fromHost === 'string' ? value.fromHost : undefined;
        const rawRole = value.forwarderRole ?? value.senderRole;
        const forwarderRole = rawRole === 'primary' || rawRole === 'secondant' ? rawRole : undefined;
        if (
            typeof value.id !== 'string' ||
            typeof forwarderProfile !== 'string' ||
            typeof value.toProfile !== 'string' ||
            typeof value.body !== 'string'
        ) {
            return null;
        }
        const messages = Array.isArray(value.messages)
            ? (value.messages as PaneMailMessage[])
                .filter(m => m && typeof m.text === 'string')
                .map(m => ({
                    text: m.text,
                    // Keep the sender verbatim: it may be 'user', 'agent', 'tool' or a profile name,
                    // and collapsing it here is what made every message read as "you".
                    sentBy: typeof m.sentBy === 'string' && m.sentBy.trim() ? m.sentBy.trim() : undefined,
                    sourceMessageId: typeof m.sourceMessageId === 'string' ? m.sourceMessageId : undefined,
                }))
            : undefined;
        return {
            id: value.id,
            writtenAt: typeof value.writtenAt === 'number' ? value.writtenAt : 0,
            forwarderProfile,
            forwarderHost: typeof forwarderHost === 'string' ? forwarderHost : '',
            forwarderRole,
            toProfile: value.toProfile,
            body: value.body,
            messages,
            sourceMessageId: typeof value.sourceMessageId === 'string' ? value.sourceMessageId : undefined,
            history: parseHistory(value.history),
        };
    } catch {
        return null;
    }
}

