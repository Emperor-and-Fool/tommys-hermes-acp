import type { ChatMessage } from '../../shared/chat';

/**
 * The local mirror is the only place a message Hermes never received still exists. The replay
 * from the agent overwrites that mirror, so the comparison has to happen before the write.
 *
 * Pure: two lists in, one string out, so the rule is testable without files or a webview.
 */

/** The text of the last message the user sent, as the mirror holds it. */
export function lastUserMessageText(messages: ChatMessage[]): string | null {
    let last: string | null = null;
    for (const message of messages) {
        if (message && message.role === 'user' && typeof message.text === 'string' && message.text.trim()) {
            last = message.text;
        }
    }
    return last;
}

/**
 * The message the agent's replay does not contain. Compared trimmed, because the replay
 * carries the text as the agent stored it and surrounding whitespace is not part of the
 * question "did this arrive".
 */
export function findUndelivered(lastLocalUser: string | null, replayed: ChatMessage[]): string | null {
    if (!lastLocalUser || !lastLocalUser.trim()) {
        return null;
    }
    const arrived = new Set(
        replayed
            .filter(message => message.role === 'user')
            .map(message => (message.text || '').trim())
    );
    return arrived.has(lastLocalUser.trim()) ? null : lastLocalUser;
}
