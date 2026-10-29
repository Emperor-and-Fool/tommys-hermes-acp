/**
 * Two different counts, on purpose — do not let one stand in for the other.
 *
 * `AcpClient._noteReplayChunk` counts what the loading state shows: every content chunk the replay
 * sent. `countsTowardMessageCount` is only for the one comparison made against Hermes'
 * `message_count`, which counts different things again.
 *
 * Display only: nothing here gates a load. The gate is the load response resolving.
 */

/** Every N chunks the pane hears about progress; more often is noise, less is a frozen count. */
export const REPLAY_PROGRESS_EVERY = 25;

/**
 * Hermes stores reasoning *on* the assistant row, so its `message_count` never includes a thought,
 * while a replay sends thoughts as their own chunks. Counting them for *display* is honest — they
 * are chunks, and the label says so — but comparing them to `message_count` would overshoot it.
 */
export function countsTowardMessageCount(role: string): boolean {
    return role !== 'thought';
}

/** The throttle marks: the first chunk, so the count moves at once, then every 25th. */
export function shouldReportReplay(received: number): boolean {
    return received > 0 && (received === 1 || received % REPLAY_PROGRESS_EVERY === 0);
}

/**
 * A replay carrying more rows than the catalog counts means Hermes' own two answers disagree.
 * The ≤5 pending user turns can account for a few; beyond that it is worth a log line, not a gate.
 */
export function replayCountDiffers(countedRows: number, sourceCount: number, pendingTurns: number): boolean {
    return sourceCount > 0 && countedRows > sourceCount + pendingTurns;
}
