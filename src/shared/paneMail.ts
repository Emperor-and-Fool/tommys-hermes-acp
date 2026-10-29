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

export interface PaneMailEnvelope {
    /** Dedupe key: the same envelope read twice must inject once. */
    id: string;
    /** Epoch ms, for the reader's eyes and for ordering. */
    writtenAt: number;
    /** Who forwarded it. */
    fromProfile: string;
    fromHost: string;
    /** Who it is for. A reader ignores everything else. */
    toProfile: string;
    /** The forwarded message, verbatim. */
    body: string;
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
        const value = JSON.parse(text) as Partial<PaneMailEnvelope>;
        if (
            typeof value.id !== 'string' ||
            typeof value.fromProfile !== 'string' ||
            typeof value.toProfile !== 'string' ||
            typeof value.body !== 'string'
        ) {
            return null;
        }
        return {
            id: value.id,
            writtenAt: typeof value.writtenAt === 'number' ? value.writtenAt : 0,
            fromProfile: value.fromProfile,
            fromHost: typeof value.fromHost === 'string' ? value.fromHost : '',
            toProfile: value.toProfile,
            body: value.body,
            sourceMessageId: typeof value.sourceMessageId === 'string' ? value.sourceMessageId : undefined,
            history: parseHistory((value as Partial<PaneMailEnvelope>).history),
        };
    } catch {
        return null;
    }
}
