import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findHermesExecutable, runHermesCommand } from '../environment/profileDiscovery';
import { normalizeHermesCliProfile } from '../environment/hermesProfile';
import type { ChatMessage } from '../../shared/chat';

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

const EXPORT_TIMEOUT_MS = 15000;

/** The export's content is a string or a list of parts; flatten it the way Hermes renders it. */
export function flattenContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') {
                    return part;
                }
                if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
                    return (part as { text: string }).text;
                }
                return '';
            })
            .join('');
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
        text: normalise(flattenContent(message.content)),
        id: typeof message.id === 'number' ? message.id : null,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
    }));

    const used = new Set<number>();
    const ids: Array<number | null> = [];
    let from: number | undefined;
    let to: number | undefined;

    for (const message of picked) {
        const role = message.role;
        const text = normalise(message.text || '');
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
 * Read one session's messages out of Hermes, ids and all.
 *
 * Only ever called at Attach time: the local copy is what the viewer shows, and its timestamps are
 * replay artefacts. The export is read-only and writes JSONL to a temp file, which is always
 * removed. A failed or slow export yields no messages, which the caller turns into an anchor.
 */
export async function exportSessionMessages(
    executable: string | undefined,
    profile: string,
    sessionId: string
): Promise<ExportedMessage[]> {
    const resolved = executable || (await findHermesExecutable(undefined));
    if (!resolved) {
        return [];
    }
    const cliProfile = normalizeHermesCliProfile(profile);
    const file = path.join(os.tmpdir(), `tommys-session-${process.pid}-${Date.now()}.jsonl`);

    try {
        await Promise.race([
            runHermesCommand(resolved, ['--profile', cliProfile, 'sessions', 'export', file, '--session-id', sessionId]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('export timed out')), EXPORT_TIMEOUT_MS)),
        ]);
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
    } catch {
        return [];
    } finally {
        await fs.promises.rm(file, { force: true }).catch(() => undefined);
    }
}
