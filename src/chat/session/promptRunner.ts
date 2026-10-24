/**
 * State of the turn in flight.
 *
 * Step 1 of the PromptRunner extraction: the state moves first, alone, so the move can be
 * verified before any behaviour follows it. Nothing here decides anything — the provider
 * still does all the reading and writing, through these fields.
 *
 * Turn state is per turn, not per tab and not per window:
 * - `promptSessionId` names the tab this turn belongs to, so a turn cannot be confused with
 *   whichever tab happens to be active (a catalog refresh can change that mid-turn).
 * - `lastAssistantText` / `lastThoughtText` accumulate the stream and are flushed on
 *   completion or detach.
 * - `sendEpoch` is bumped on every detach so chunks from an abandoned turn are ignored.
 * - `stallTimer` fires when a prompt produces no output for a while (Hermes plugin init).
 */
export class PromptRunner {
    promptSessionId: string | undefined;
    lastAssistantText = '';
    lastThoughtText = '';
    sendEpoch = 0;
    stallTimer: ReturnType<typeof setTimeout> | undefined;
}
