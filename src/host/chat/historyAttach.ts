import type { ChatMessage, HistoryRef } from '../../shared/chat';

/** One attach may carry at most this many messages. */
export const MAX_HISTORY_MESSAGES = 15;

const MARKER_OPEN = '[From conversation: ';
const MARKER_CLOSE = '[/From conversation]';
const URI_PREFIX = 'tommys-session://';

const BLOCK_RX = new RegExp(
    '\\[From conversation: ([\\s\\S]*?)\\]\\r?\\n' +
    'URI: tommys-session:\\/\\/([^?\\s]+)\\?([^\\r\\n]*)\\r?\\n' +
    '([\\s\\S]*?)\\r?\\n?\\[\\/From conversation\\]',
    'g');

/** What one attach carries: non-empty, never a nested attach, clamped to the cap. */
export function attachableMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
        .filter(m => m.role !== 'history' && (m.text || '').trim())
        .slice(0, MAX_HISTORY_MESSAGES);
}

/**
 * The block the composer sends in front of the prompt.
 *
 * Not an embedded resource: Hermes advertises image support only, so the selection travels as
 * text with a marker of our own. The URI carries the source session id, which is what lets the
 * agent look further into that conversation on its own.
 */
export function formatHistoryBlock(ref: HistoryRef, messages: ChatMessage[]): string {
    const picked = attachableMessages(messages);
    const count = picked.length;
    const from = picked.length ? picked[0].timestamp : ref.from;
    const to = picked.length ? picked[picked.length - 1].timestamp : ref.to;
    const uri = `${URI_PREFIX}${ref.sessionId}?count=${count}&from=${from}&to=${to}`;
    const lines = [`${MARKER_OPEN}${ref.title}]`, `URI: ${uri}`];
    const body = picked.map(m => `${m.role}: ${(m.text || '').trim()}`).join('\n');
    if (body) {
        lines.push(body);
    }
    lines.push(MARKER_CLOSE);
    return lines.join('\n');
}

/** One block lifted back out of a prompt, with the source it named. */
export interface ParsedHistoryBlock {
    ref: HistoryRef;
    body: string;
}

/**
 * Split attached history out of a user message.
 *
 * Hermes' replay returns user messages as flattened text, so the block can arrive anywhere inside
 * one. Everything the marker covers is lifted out; whatever remains is the user's own words.
 */
export function parseHistoryBlocks(text: string): { blocks: ParsedHistoryBlock[]; rest: string } {
    const blocks: ParsedHistoryBlock[] = [];
    const rest = text.replace(BLOCK_RX, (_match, title: string, sessionId: string, query: string, body: string) => {
        const params = new URLSearchParams(query);
        blocks.push({
            ref: {
                sessionId,
                title,
                count: Number(params.get('count')) || 0,
                from: Number(params.get('from')) || 0,
                to: Number(params.get('to')) || 0,
            },
            body: body.trim(),
        });
        return '';
    }).trim();
    return { blocks, rest };
}

/** The staged selection: what the composer shows as a chip and sends on the next prompt. */
export interface StagedHistory {
    ref: HistoryRef;
    messages: ChatMessage[];
}

/** Holds the one selection the composer may attach to its next send. */
export class HistoryAttach {
    private staged: StagedHistory | null = null;

    stage(ref: HistoryRef, messages: ChatMessage[]): StagedHistory {
        const picked = attachableMessages(messages);
        this.staged = {
            ref: {
                ...ref,
                count: picked.length,
                from: picked.length ? picked[0].timestamp : ref.from,
                to: picked.length ? picked[picked.length - 1].timestamp : ref.to,
            },
            messages: picked,
        };
        return this.staged;
    }

    clear(): void {
        this.staged = null;
    }

    get current(): StagedHistory | null {
        return this.staged;
    }

    get count(): number {
        return this.staged ? this.staged.messages.length : 0;
    }

    /** The block to send, or '' when nothing is staged. */
    block(): string {
        return this.staged ? formatHistoryBlock(this.staged.ref, this.staged.messages) : '';
    }
}
