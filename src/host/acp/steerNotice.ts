/**
 * Hermes' own words about a steer, arriving on the same stream as the running turn.
 *
 * `/steer <text>` answered by a running agent produces an agent_message_chunk that belongs to
 * the steer, not to the assistant's reply: "⏩ Steer queued for the active turn: …" when it was
 * accepted, "⚠️ Steer failed: …" when it was not. The chunk is diverted before it reaches the
 * response buffer, so the reply reads as if no steer had happened.
 */

const QUEUED_PREFIX = '⏩';

const FAILED_PREFIX = '⚠';

/** True for the steer's own reply line: the four-point arrow, or the warning sign. */
export function isSteerNotice(text: string): boolean {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return false;
    }
    return trimmed.startsWith(QUEUED_PREFIX) || trimmed.startsWith(FAILED_PREFIX);
}
