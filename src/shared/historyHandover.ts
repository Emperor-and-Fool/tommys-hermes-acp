import type { HistoryRef } from './chat';

/**
 * The lines that hand a slice of a conversation to an agent.
 *
 * One vocabulary for both routes: attaching a slice to your own draft (same profile, same tab) and
 * forwarding one to the sibling pane (a profile the reader does not own). It used to be written
 * twice, in two dialects — the forwarded block labelled nothing and warned about the profile
 * boundary, the attached block wrote `Span:` and never said how to read further. Both readers are
 * agents deciding where to search next, so they get the same four answers: which session, where in
 * it, what the handle permits, and the call that reads more.
 *
 * The `Note:` is the only conditional line: it states a cross-profile grant, which is false — and
 * would teach an agent to distrust its own history — when the slice came from the reader's profile.
 */

function iso(ms?: number): string | null {
    return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The handle `session_search` understands: profile and session, both required. */
export function historyHandle(ref: HistoryRef, fallbackProfile = ''): string {
    return `@session:${ref.profile || fallbackProfile}/${ref.sessionId}`;
}

/** The first real Hermes id in the slice, or null when none matched. */
export function firstMessageId(ref: HistoryRef): number | null {
    for (const id of ref.messageIds || []) {
        if (typeof id === 'number') {
            return id;
        }
    }
    return null;
}

export const HANDOVER_NOTE = 'Note: this session handle reads outside your profile — the sender '
    + 'granted it by forwarding. Read from it; do not go looking through that profile for anything '
    + 'else.';

export interface HandoverContext {
    /**
     * The profile of the agent that will read this. Omitted means "assume another profile", which
     * keeps the warning rather than silently dropping a grant the reader needs to know about.
     */
    readerProfile?: string;
    /** Fills the handle's profile when the ref carries none. */
    fallbackProfile?: string;
    /** The anchor to use when the ref has none of its own (an attach derives it from the text). */
    fallbackAnchor?: string;
}

/** Session, span or anchor, the cross-profile note when it applies, and how to read on. */
export function handoverLines(ref: HistoryRef, ctx: HandoverContext = {}): string[] {
    const handle = historyHandle(ref, ctx.fallbackProfile);
    const sourceProfile = ref.profile || ctx.fallbackProfile || '';
    const lines: string[] = [`Session: ${handle}`];

    const from = iso(ref.from);
    const to = iso(ref.to);
    if (from && to) {
        lines.push(`Span: ${from} → ${to}`);
    } else {
        const anchor = ref.anchor ?? ctx.fallbackAnchor ?? '';
        if (anchor) {
            lines.push(`Anchor: "${anchor}"`);
        }
    }

    const crossProfile = !ctx.readerProfile || ctx.readerProfile !== sourceProfile;
    if (crossProfile) {
        lines.push(HANDOVER_NOTE);
    }

    const id = firstMessageId(ref);
    if (id !== null) {
        lines.push('Hint: session_search(session_id="' + handle + '", around_message_id=<an id from '
            + 'the slice>) reads the turns around that message.');
    } else {
        const anchor = ref.anchor ?? ctx.fallbackAnchor ?? '';
        lines.push(anchor
            ? `Hint: no message ids matched this slice — search the transcript for "${anchor}" `
                + 'instead of scrolling to one.'
            : 'Hint: no message ids matched this slice — search the transcript for its opening '
                + 'words instead of scrolling to one.');
    }
    return lines;
}
