import type { HistoryRef } from '../../shared/chat';
import { handoverLines } from '../../shared/historyHandover';

/**
 * What a delivered peer card becomes: one user turn.
 *
 * The card on screen is a pill, a body and (for a session-memory pick) an envelope. A turn is
 * text, so each of those becomes a line the agent can read: who forwarded it, where the slice came
 * from, what it may do with that handle, then the body unchanged. Several cards delivered at once
 * are the same block, separated.
 *
 * The `Note:` and `Hint:` lines are for the agent only — the pane's card does not show them. They
 * exist because a forwarded session handle is a working key (measured: `session_search` with
 * `"<profile>/<id>"` reads across profiles), and an agent that does not know that reads a slice as
 * if it were the whole context.
 */
export interface PeerTurnItem {
    fromProfile: string;
    fromHost: string;
    body: string;
    history?: HistoryRef;
    /** The profile reading this turn. Same as the slice's profile means no cross-profile note. */
    readerProfile?: string;
}

/** Between two delivered cards in one turn: a rule the agent can see, not a sentence about one. */
export const PEER_TURN_SEPARATOR = '\n\n---\n\n';

/**
 * What the receiving agent may do with the handle, said where it reads it.
 *
 * Two lines, deliberately: the warning is that this is a deliberate cross-profile grant (not a
 * sandbox escape to brag about, and not a reason to go rummaging in the rest of that profile), the
 * hint is the call that reads more of *this* conversation.
 */


/** One forwarded card as turn text: sender, session handle, how to read more, then the body. */
export function peerTurnBlock(item: PeerTurnItem): string {
    const lines = [`[forwarded from ${item.fromProfile}@${item.fromHost}]`];
    const ref = item.history;
    if (ref) {
        lines.push(...handoverLines(ref, {
            readerProfile: item.readerProfile,
            fallbackProfile: item.fromProfile,
        }));
    }
    return lines.join('\n') + '\n\n' + item.body.trim();
}

/** Every pending card in arrival order, as the single turn Deliver sends. */
export function peerTurnText(items: PeerTurnItem[]): string {
    return items.map(peerTurnBlock).join(PEER_TURN_SEPARATOR);
}
