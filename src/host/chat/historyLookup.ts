import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findHermesExecutable, runHermesCommand } from '../environment/profileDiscovery';
import { normalizeHermesCliProfile } from '../environment/hermesProfile';
import { unwrapSteer, type ChatMessage } from '../../shared/chat';
import { identity } from '../../shared/extensionId';

/** One message as `hermes sessions export` writes it. */
export interface ExportedMessage {
    id?: number;
    role?: string;
    content?: unknown;
    /** Seconds since the epoch, as Hermes stores them. */
    timestamp?: number;
}

/** The ids found for a selection, plus the real span of what matched. */
export interface MessageIdMatch {
    ids: Array<number | null>;
    /** Real timestamps in ms, only when at least one message matched. */
    from?: number;
    to?: number;
}

/**
 * Hermes' export rows as transcript messages.
 *
 * The window is Hermes' own: whatever the export returns is what the viewer shows, because there
 * is no local copy to bound it to any more.
 *
 * `timestamp` is seconds in Hermes and milliseconds here; permission rows are cards, not
 * messages, and take no part in a history attach.
 */
export function toChatMessages(exported: ExportedMessage[]): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const item of exported) {
        const role = typeof item.role === 'string' ? item.role.trim() : '';
        if (!role || role === 'permission') {
            continue;
        }
        const text = flattenContent(item.content);
        if (!text) {
            continue;
        }
        const seconds = typeof item.timestamp === 'number' ? item.timestamp : 0;
        messages.push({ role, text, timestamp: seconds ? seconds * 1000 : Date.now() });
    }
    return messages;
}

/**
 * The export's content is a string or a list of parts; flatten it exactly as Hermes' replay does
 * (`_flatten_history_text`): parts trimmed, empty ones dropped, joined by newlines. Anything else
 * would never match a message the agent sent in several parts.
 */
export function flattenContent(content: unknown): string {
    if (typeof content === 'string') {
        return content.trim();
    }
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const part of content) {
            if (typeof part === 'string') {
                parts.push(part);
            } else if (part && typeof part === 'object') {
                const { text, type, content: inner } = part as { text?: unknown; type?: unknown; content?: unknown };
                if (typeof text === 'string') {
                    parts.push(text);
                } else if (type === 'text' && typeof inner === 'string') {
                    parts.push(inner);
                }
            }
        }
        return parts.map(part => part.trim()).filter(Boolean).join('\n').trim();
    }
    return '';
}

function normalise(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find the Hermes id of each picked message in the exported original.
 *
 * Matching is role plus whitespace-normalised text. The same text can occur more than once in a
 * session, so a match takes the occurrence closest to the end, and an already-used message is not
 * matched twice. Anything unmatched stays null: the attach still goes out, with the anchor.
 */
export function matchMessageIds(picked: ChatMessage[], exported: ExportedMessage[]): MessageIdMatch {
    const pool = exported.map((message, index) => ({
        index,
        role: message.role || '',
        // The export keeps the steer's delivery wrapper; the local copy it is matched against
        // does not, so both sides are unwrapped before their text is compared.
        text: normalise(unwrapSteer(flattenContent(message.content)).text),
        id: typeof message.id === 'number' ? message.id : null,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
    }));

    const used = new Set<number>();
    const ids: Array<number | null> = [];
    let from: number | undefined;
    let to: number | undefined;

    for (const message of picked) {
        const role = message.role;
        const text = normalise(unwrapSteer(message.text || '').text);
        let hit: (typeof pool)[number] | null = null;
        for (let index = pool.length - 1; index >= 0; index -= 1) {
            const candidate = pool[index];
            if (used.has(index) || candidate.role !== role || candidate.text !== text) {
                continue;
            }
            hit = candidate;
            break;
        }
        if (!hit || hit.id === null) {
            ids.push(null);
            continue;
        }
        used.add(hit.index);
        ids.push(hit.id);
        if (hit.timestamp !== undefined) {
            const ms = Math.round(hit.timestamp * 1000);
            from = from === undefined ? ms : Math.min(from, ms);
            to = to === undefined ? ms : Math.max(to, ms);
        }
    }

    return { ids, from, to };
}

/**
 * The export could not be read. Distinct from an export that succeeded and held no rows: the
 * viewer says "could not read it" for this, and "empty" only for the other.
 */
export class HistoryExportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HistoryExportError';
    }
}

/**
 * Read one session's messages out of Hermes, ids and all.
 *
 * Only ever called at Attach time: the local copy is what the viewer shows, and its timestamps are
 * replay artefacts. The export is read-only and writes JSONL to a temp file, which is always
 * removed. A failed export throws: an empty list means Hermes had nothing to send.
 */
export async function exportSessionMessages(
    executable: string | undefined,
    profile: string,
    sessionId: string
): Promise<ExportedMessage[]> {
    const resolved = executable || (await findHermesExecutable(undefined));
    if (!resolved) {
        throw new HistoryExportError('no Hermes executable found');
    }
    const cliProfile = normalizeHermesCliProfile(profile);
    const file = path.join(
        os.tmpdir(),
        `${identity().prefix}-session-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
    );

    try {
        // runHermesCommand stops the process itself after 15 s.
        await runHermesCommand(resolved, ['--profile', cliProfile, 'sessions', 'export', file, '--session-id', sessionId]);
        const raw = await fs.promises.readFile(file, 'utf-8');
        const messages: ExportedMessage[] = [];
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                const parsed = JSON.parse(trimmed) as { messages?: unknown };
                const list = Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [];
                for (const message of list as ExportedMessage[]) {
                    messages.push(message);
                }
            } catch {
                // One unreadable line does not invalidate the rest of the export.
            }
        }
        return messages;
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new HistoryExportError(`hermes sessions export failed: ${reason}`);
    } finally {
        await fs.promises.rm(file, { force: true }).catch(() => undefined);
    }
}
