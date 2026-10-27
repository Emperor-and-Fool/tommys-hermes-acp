/**
 * What the composer's one button means while a run is in progress.
 *
 * Stop is the default: pressing it cancels the turn. As soon as there is text, the same button
 * offers to steer instead — the text goes into the running turn rather than becoming a new one.
 */

/** `steer` when there is something to say, `cancel` when there is not. */
export function stopButtonIntent(text: string): 'steer' | 'cancel' {
    return (text || '').trim() ? 'steer' : 'cancel';
}
