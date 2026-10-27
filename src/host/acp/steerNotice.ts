/**
 * Hermes' own words about a steer, arriving on the same stream as the running turn.
 *
 * `/steer <text>` answered by a running agent produces an agent_message_chunk that belongs to
 * the steer, not to the assistant's reply: "⏩ Steer queued for the active turn: …" when it was
 * accepted, "⚠️ Steer failed: …" when it was not. The chunk is diverted before it reaches the
 * response buffer, so the reply reads as if no steer had happened.
 *
 * Only Hermes' exact openings count: reply text arrives as deltas, and a delta that merely
 * starts with a warning sign is still the model's text.
 */

const NOTICE_PREFIXES = ['⏩ Steer queued', '⚠️ Steer failed', '⚠ Steer failed'];

/** True for the steer's own reply line. */
export function isSteerNotice(text: string): boolean {
    const trimmed = (text || '').trim();
    return NOTICE_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}
