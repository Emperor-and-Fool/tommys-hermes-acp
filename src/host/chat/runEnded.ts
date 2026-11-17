/**
 * The one place that says a run has ended.
 *
 * Two features act after a run: the permission root re-loads the session so Hermes moves it to the
 * folder the user picked, and the edit mode applies the mode the button implies. Both were refused
 * while the run was busy, so both listen here instead of each inventing a timer or a second hook.
 */
export class RunEnded {
    private readonly _handlers = new Set<() => void>();

    /** Listen; the returned function stops listening. */
    on(handler: () => void): () => void {
        this._handlers.add(handler);
        return () => {
            this._handlers.delete(handler);
        };
    }

    /** Say it. One listener that throws must not stop the others. */
    fire(): void {
        for (const handler of [...this._handlers]) {
            try {
                handler();
            } catch {
                /* a listener's failure is its own */
            }
        }
    }
}
