/**
 * How the loading state reports a replay.
 *
 * Display only: nothing here gates a load. The gate is the load response resolving. The count is
 * chunks, because that is what the replay sends; it is never compared with Hermes' `message_count`,
 * which is a different quantity — see the note below.
 *
 * Why no comparison exists any more: `sessions.message_count` is a *maintained counter*, not a row
 * count. It is bumped per insert and **reset to the length of the compressed history** when the
 * session is compacted (hermes_state_compression.py:469, hermes_state_mutation_compress.py:26). The
 * live dev-vsc session has 2230 transcript rows, 1874 of them absorbed by compaction, against a
 * counter of 128. A replay carries the transcript; the catalog carries the counter. Warning that
 * they disagree says nothing about either, so the warning is gone.
 */

/** Every N chunks the pane hears about progress; more often is noise, less is a frozen count. */
export const REPLAY_PROGRESS_EVERY = 25;

/** The throttle marks: the first chunk, so the count moves at once, then every 25th. */
export function shouldReportReplay(received: number): boolean {
    return received > 0 && (received === 1 || received % REPLAY_PROGRESS_EVERY === 0);
}
