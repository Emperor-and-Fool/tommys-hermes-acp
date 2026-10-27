import { unwrapSteer, type ChatMessage } from '../../shared/chat';
import { parseHistoryBlocks } from '../chat/historyAttach';

/** One record from the agent's replay, as ACP delivers it. */
export interface ReplayItem {
    role: string;
    text?: string;
    toolCallId?: string;
}

/**
 * Fold the agent's replay into transcript records.
 *
 * Tools arrive as a start/complete pair per call, so a second record with the same call id
 * replaces the text of the first rather than adding a card. Empty records are dropped, and
 * timestamps are positional: the replay carries none, and the order is what the pane renders.
 */
export function buildReplayMessages(replay: ReplayItem[], base: number = Date.now()): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const toolIndex = new Map<string, number>();

    for (const item of replay) {
        const text = (item.text || '').trim();
        if (!text) {
            continue;
        }
        if (item.role === 'user') {
            // A steer is a user message that went into a running turn: keep the sentence, drop
            // the wrapper, and let the transcript mark it as what it was.
            const steer = unwrapSteer(text);
            // Attached history rides inside the user text; lift it back out as its own card.
            const parsed = parseHistoryBlocks(steer.text);
            if (parsed.blocks.length) {
                for (const block of parsed.blocks) {
                    messages.push({
                        role: 'history',
                        text: block.body,
                        timestamp: base + messages.length,
                        history: block.ref,
                    });
                }
                if (parsed.rest) {
                    messages.push({
                        role: 'user',
                        text: parsed.rest,
                        timestamp: base + messages.length,
                        steer: steer.steer,
                    });
                }
                continue;
            }
        }
        if (item.role === 'tool' && item.toolCallId) {
            const at = toolIndex.get(item.toolCallId);
            if (at !== undefined) {
                messages[at].text = item.text as string;
                continue;
            }
            toolIndex.set(item.toolCallId, messages.length);
            messages.push({
                role: 'tool',
                text: item.text as string,
                timestamp: base + messages.length,
                toolCallId: item.toolCallId,
            });
            continue;
        }
        const own = item.role === 'user' ? unwrapSteer(item.text as string) : { text: item.text as string, steer: false };
        messages.push({
            role: item.role,
            text: own.text,
            timestamp: base + messages.length,
            steer: own.steer,
        });
    }

    return messages;
}
