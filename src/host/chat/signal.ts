/**
 * One small signal: the owner of a fact says it, the features that act on it listen.
 *
 * Two facts are announced this way and they want the same shape, so there is one implementation
 * rather than a copy per fact:
 *
 * - **a run ended** — the permission root re-loads the session so Hermes moves it to the folder the
 *   user picked, and the edit mode applies the mode the button implies. Both were refused while
 *   the run was busy;
 * - **a profile became active** — the agent has connected and its sessions are on screen with
 *   their message counts, which is when the permission-root row says where the session is rooted.
 *   A tab switch is not this moment: it does not connect.
 *
 * `on()` returns the unsubscribe; a listener that throws does not stop the others.
 */
export class Signal {
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
