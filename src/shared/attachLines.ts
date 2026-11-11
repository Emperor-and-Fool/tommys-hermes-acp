/**
 * An attached history body, read back into messages.
 *
 * The host writes one line per attached message — `role #id: text`, with the id left out when no
 * Hermes id matched (`historyAttach.ts:blockMessageLines`) — and each message text is normalised to
 * a single line first, so a line boundary is a message boundary and nothing else.
 *
 * A body that does not open with a role line is not an attach (a forwarded slice, an imported
 * transcript): it comes back empty and the caller keeps rendering it as plain text. Only the roles
 * a transcript can carry are accepted, so prose that happens to contain `Note: …` stays prose.
 */
export interface AttachLine {
    role: string;
    /** The real Hermes message id, when the lookup found one. */
    id: number | null;
    text: string;
}

const LINE_RX = /^(user|assistant|tool|thought|permission|system)(?: #(\d+))?: ([\s\S]*)$/;

export function parseAttachLines(body: string): AttachLine[] {
    const out: AttachLine[] = [];
    const lines = (body || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = LINE_RX.exec(line);
        if (match) {
            out.push({
                role: match[1],
                id: match[2] ? parseInt(match[2], 10) : null,
                text: match[3],
            });
            continue;
        }
        if (out.length) {
            // Only our own join can produce a break inside a message; keep it with its message.
            out[out.length - 1].text += '\n' + line;
            continue;
        }
        if (line.trim()) {
            return [];
        }
    }
    return out;
}
