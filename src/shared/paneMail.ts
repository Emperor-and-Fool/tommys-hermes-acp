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
}

/** Directory under the Hermes home, and the file inside it. */
export const PANE_MAIL_DIR = 'pane-mail';
export const PANE_MAIL_LOG = 'log.ndjson';

/** One line of the log: no embedded newlines, so a partial append can never straddle lines. */
export function serializeEnvelope(envelope: PaneMailEnvelope): string {
    return JSON.stringify(envelope) + '\n';
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
        };
    } catch {
        return null;
    }
}

/**
 * What lands in the recipient's composer: who sent it, where it was going, then the text quoted.
 * Never sent on its own — the recipient edits and presses Send.
 */
export function forwardBlock(header: string, body: string): string {
    const quoted = body
        .split('\n')
        .map(line => (line ? `> ${line}` : '>'))
        .join('\n');
    return `${header}\n${quoted}`;
}
