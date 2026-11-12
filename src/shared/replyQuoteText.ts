/**
 * The reply-quote block, in one place.
 *
 * A reply travels inside the user message as plain text — the agent receives it verbatim — so the
 * markers are part of the prompt, not decoration:
 *
 *     [replying-to]
 *     --- dev-vsc@HermesHomeBase ---
 *     what was quoted
 *     [/replying-to]
 *
 *     the user's own words
 *
 * The composer writes it and the transcript has to read it back, or the sent message shows the
 * markers instead of the quote panel the user just saw. Both halves live here, so the writer and
 * the reader cannot drift apart.
 */
export interface QuoteSegment {
    role: string;
    text: string;
}

export const REPLY_QUOTE_OPEN = '[replying-to]';
export const REPLY_QUOTE_CLOSE = '[/replying-to]';

const ROLE_RX = /^--- (.+) ---$/;

export function formatReplyQuote(segments: QuoteSegment[], text: string): string {
    if (!segments.length) {
        return text;
    }
    const lines: string[] = [REPLY_QUOTE_OPEN];
    for (let i = 0; i < segments.length; i++) {
        lines.push('--- ' + segments[i].role + ' ---');
        lines.push(segments[i].text);
    }
    lines.push(REPLY_QUOTE_CLOSE);
    const quoted = lines.join('\n');
    return text ? quoted + '\n\n' + text : quoted;
}

/**
 * Split a sent message back into its quote and the user's own words.
 *
 * A message without the opening marker comes back with no segments and its text untouched, so the
 * caller can render it exactly as before. An unterminated block is treated the same way: better a
 * literal block than a quote that swallowed the rest of the message.
 */
export function parseReplyQuote(text: string): { segments: QuoteSegment[]; rest: string } {
    const body = text || '';
    const open = body.indexOf(REPLY_QUOTE_OPEN);
    if (open === -1) {
        return { segments: [], rest: body };
    }
    const close = body.indexOf(REPLY_QUOTE_CLOSE, open);
    if (close === -1) {
        return { segments: [], rest: body };
    }
    const inner = body.slice(open + REPLY_QUOTE_OPEN.length, close);
    const segments: QuoteSegment[] = [];
    const lines = inner.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = ROLE_RX.exec(line);
        if (match) {
            segments.push({ role: match[1], text: '' });
            continue;
        }
        if (!segments.length) {
            if (line.trim()) {
                // Something that is not a segment header: not our block after all.
                return { segments: [], rest: body };
            }
            continue;
        }
        segments[segments.length - 1].text += (segments[segments.length - 1].text ? '\n' : '') + line;
    }
    if (!segments.length) {
        return { segments: [], rest: body };
    }
    // The line break before the closing marker belongs to the block, not to the last segment.
    for (let i = 0; i < segments.length; i++) {
        segments[i].text = segments[i].text.replace(/\n+$/, '');
    }
    const rest = (body.slice(0, open) + body.slice(close + REPLY_QUOTE_CLOSE.length)).replace(/^\n+/, '').trim();
    return { segments: segments, rest: rest };
}
