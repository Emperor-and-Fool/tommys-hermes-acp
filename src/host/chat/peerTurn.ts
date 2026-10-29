import type { HistoryRef } from '../../shared/chat';

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
}

/** Between two delivered cards in one turn: a rule the agent can see, not a sentence about one. */
export const PEER_TURN_SEPARATOR = '\n\n---\n\n';

function spanLine(ref: HistoryRef): string {
    if (typeof ref.from === 'number' && typeof ref.to === 'number') {
        return `${new Date(ref.from).toISOString()} → ${new Date(ref.to).toISOString()}`;
    }
    // No id matched, so there is no span: the opening words are what the agent can search for.
    return ref.anchor ? `Anchor: "${ref.anchor}"` : '';
}

/** The first real Hermes id in the slice, or null when none matched. */
function firstMessageId(ref: HistoryRef): number | null {
    for (const id of ref.messageIds || []) {
        if (typeof id === 'number') {
            return id;
        }
    }
    return null;
}

/**
 * What the receiving agent may do with the handle, said where it reads it.
 *
 * Two lines, deliberately: the warning is that this is a deliberate cross-profile grant (not a
 * sandbox escape to brag about, and not a reason to go rummaging in the rest of that profile), the
 * hint is the call that reads more of *this* conversation.
 */
function accessLines(ref: HistoryRef, handle: string, anchorOnly: boolean): string[] {
    const note = 'Note: this session handle reads outside your profile — the sender granted it by ' +
        'forwarding. Read from it; do not go looking through that profile for anything else.';
    const hint = anchorOnly
        ? `Hint: no message ids matched this slice — search the transcript for "${ref.anchor || ''}" ` +
          'instead of scrolling to one.'
        : 'Hint: session_search(session_id="' + handle + '", around_message_id=<an id from the ' +
          'slice>) reads the turns around that message.';
    return [note, hint];
}

/** One forwarded card as turn text: sender, session handle, how to read more, then the body. */
export function peerTurnBlock(item: PeerTurnItem): string {
    const lines = [`[forwarded from ${item.fromProfile}@${item.fromHost}]`];
    const ref = item.history;
    if (ref) {
        const profile = ref.profile || item.fromProfile;
        const handle = `@session:${profile}/${ref.sessionId}`;
        lines.push(`Session: ${handle}`);
        const span = spanLine(ref);
        if (span) {
            lines.push(span);
        }
        lines.push(...accessLines(ref, handle, firstMessageId(ref) === null));
    }
    return lines.join('\n') + '\n\n' + item.body.trim();
}

/** Every pending card in arrival order, as the single turn Deliver sends. */
export function peerTurnText(items: PeerTurnItem[]): string {
    return items.map(peerTurnBlock).join(PEER_TURN_SEPARATOR);
}
