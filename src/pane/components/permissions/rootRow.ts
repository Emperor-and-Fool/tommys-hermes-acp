/** The facts the host sends about the permission root: no more, no less. */
export interface RootFacts {
    root: string;
    folders: string[];
    offered: string[];
    profile: string;
    notice?: 'lastRootRemoved' | 'appliesNextRun';
}

/**
 * Whether the row is on screen.
 *
 * Two reasons to be visible, one answer: the reader opened it, and there is something to choose
 * between; or the host has something to say (the last root went, or a pick applies next run) —
 * a notice is shown even when there is nothing left to pick.
 */
export function shouldShowRow(facts: Pick<RootFacts, 'offered' | 'notice'>, open: boolean): boolean {
    if (facts.notice) {
        return true;
    }
    return open && facts.offered.length > 0;
}
