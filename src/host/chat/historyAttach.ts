import type { ChatMessage, HistoryRef } from '../../shared/chat';
import { MAX_HISTORY_MESSAGES } from '../../shared/chat';

/** The cap lives in `shared/` because the pane refuses the tick as well; re-exported for callers here. */
export { MAX_HISTORY_MESSAGES };

const MARKER_OPEN = '[From conversation: ';
const MARKER_CLOSE = '[/From conversation]';

const BLOCK_RX = new RegExp(
    '\\[From conversation: ([\\s\\S]*?)\\]\\r?\\n' +
    'Session: @session:([^/\\s]+)/([^\\r\\n]+)\\r?\\n' +
    '([\\s\\S]*?)\\r?\\n?\\[\\/From conversation\\]',
    'g');

/** What one attach carries: non-empty, never a nested attach, clamped to the cap. */
export function attachableMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages
        .filter(m => m.role !== 'history' && (m.text || '').trim())
        .slice(0, MAX_HISTORY_MESSAGES);
}

function normalise(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function iso(ms?: number): string | null {
    return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The opening words of the first attached message: what the agent can search when no id matched. */
export function anchorFor(messages: ChatMessage[]): string {
    const first = messages.length ? normalise(messages[0].text || '') : '';
    return first.slice(0, 80);
}

/**
 * The block the composer sends in front of the prompt.
 *
 * Not an embedded resource: Hermes advertises image support only. The Session line is the handle
 * the agent's session_search understands; per-line ids let it scroll to one message with
 * session_id + around_message_id. When no id matched, the anchor is all it gets.
 */
export function formatHistoryBlock(ref: HistoryRef, messages: ChatMessage[]): string {
    const picked = attachableMessages(messages);
    const ids = picked.map((_, index) => {
        const id = ref.messageIds ? ref.messageIds[index] : undefined;
        return typeof id === 'number' ? id : null;
    });
    const matched = ids.some(id => id !== null);

    const lines = [`${MARKER_OPEN}${ref.title}]`, `Session: @session:${ref.profile}/${ref.sessionId}`];
    const from = matched ? iso(ref.from) : null;
    const to = matched ? iso(ref.to) : null;
    if (from && to) {
        lines.push(`Span: ${from} → ${to}`);
    }
    if (!matched) {
        const anchor = ref.anchor ?? anchorFor(picked);
        if (anchor) {
            lines.push(`Anchor: "${anchor}"`);
        }
    }
    for (let index = 0; index < picked.length; index += 1) {
        const id = ids[index];
        const text = normalise(picked[index].text || '');
        lines.push(id === null ? `${picked[index].role}: ${text}` : `${picked[index].role} #${id}: ${text}`);
    }
    lines.push(MARKER_CLOSE);
    return lines.join('\n');
}

/** One block lifted back out of a prompt, with the source it named. */
export interface ParsedHistoryBlock {
    ref: HistoryRef;
    body: string;
}

const LINE_RX = /^(\S+)(?: #(\d+))?: ([\s\S]*)$/;

/**
 * Split attached history out of a user message.
 *
 * Hermes' replay returns user messages as flattened text, so the block can arrive anywhere inside
 * one. Everything the marker covers is lifted out; whatever remains is the user's own words.
 */
export function parseHistoryBlocks(text: string): { blocks: ParsedHistoryBlock[]; rest: string } {
    const blocks: ParsedHistoryBlock[] = [];
    const rest = text.replace(BLOCK_RX, (_m, title: string, profile: string, sessionId: string, inner: string) => {
        const ids: Array<number | null> = [];
        const body: string[] = [];
        let from: number | undefined;
        let to: number | undefined;
        let anchor: string | undefined;

        for (const raw of inner.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) {
                continue;
            }
            const span = /^Span: (.+?) → (.+)$/.exec(line);
            if (span) {
                const start = Date.parse(span[1]);
                const end = Date.parse(span[2]);
                if (Number.isFinite(start)) from = start;
                if (Number.isFinite(end)) to = end;
                continue;
            }
            const anchored = /^Anchor: "(.*)"$/.exec(line);
            if (anchored) {
                anchor = anchored[1];
                continue;
            }
            const bodyLine = LINE_RX.exec(line);
            if (bodyLine) {
                ids.push(bodyLine[2] === undefined ? null : Number(bodyLine[2]));
                body.push(line);
                continue;
            }
            body.push(line);
            ids.push(null);
        }

        blocks.push({
            ref: { sessionId, profile, title, count: body.length, messageIds: ids, from, to, anchor },
            body: body.join('\n'),
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

/**
 * Holds the one selection the composer may attach to its next send.
 *
 * The ids arrive from the export lookup at Attach time; without them the block falls back to the
 * anchor, so an attach still says where it came from when the lookup failed.
 */
export class HistoryAttach {
    private staged: StagedHistory | null = null;

    stage(ref: HistoryRef, messages: ChatMessage[], ids?: Array<number | null>): StagedHistory {
        const picked = attachableMessages(messages);
        const messageIds = picked.map((_, index) => {
            const id = ids ? ids[index] : undefined;
            return typeof id === 'number' ? id : null;
        });
        const matched = messageIds.some(id => id !== null);
        this.staged = {
            ref: {
                ...ref,
                count: picked.length,
                messageIds,
                from: matched ? ref.from : undefined,
                to: matched ? ref.to : undefined,
                anchor: matched ? undefined : ref.anchor ?? anchorFor(picked),
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
