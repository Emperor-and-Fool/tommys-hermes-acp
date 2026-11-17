/**
 * The permission cards this pane is showing.
 *
 * The feature's own slice (S1): which requests are still waiting for an answer, which ones were
 * answered, and the element that draws each. It lives beside the card rather than in
 * `pane/state.ts`, because no other feature owns or needs it — the rail's switch, the root picker
 * and the card itself read their state from their own places.
 */
export class CardState<TGroup> {
    private readonly _pending = new Map<string, TGroup>();
    private readonly _answered = new Set<string>();

    /** A request the pane is showing: it is waiting until it is answered. */
    open(id: string, group: TGroup): void {
        this._pending.set(id, group);
        this._answered.delete(id);
    }

    /** It was answered (or dismissed): it stops waiting, and is remembered as answered. */
    close(id: string): void {
        this._pending.delete(id);
        this._answered.add(id);
    }

    /** The element drawing this request, while it is still waiting. */
    group(id: string): TGroup | undefined {
        return this._pending.get(id);
    }

    isPending(id: string): boolean {
        return this._pending.has(id);
    }

    /** Whether this id was answered here: a replay of the same card must not ask again. */
    isAnswered(id: string): boolean {
        return this._answered.has(id);
    }

    /** Every card still waiting, so a pushed change reaches all of them. */
    eachPending(visit: (group: TGroup, id: string) => void): void {
        this._pending.forEach((group, id) => visit(group, id));
    }

    /** A rebuilt transcript: nothing that was waiting is on screen any more. */
    clear(): void {
        this._pending.clear();
    }

    /** Forget everything: a transcript rebuilt from scratch has no answered cards to honour. */
    reset(): void {
        this._pending.clear();
        this._answered.clear();
    }
}
