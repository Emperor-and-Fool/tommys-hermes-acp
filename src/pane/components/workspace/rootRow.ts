/** The facts the host sends about the permission root: no more, no less. */
export interface RootFacts {
    root: string;
    folders: string[];
    offered: string[];
    profile: string;
    /** The offered folders whose welcome has not run out: drawn with the word "New". */
    newFolders?: string[];
    /** The offered folders that are not on disk: drawn dimmed, not choosable. */
    missingFolders?: string[];
    notice?: 'lastRootRemoved' | 'appliesNextRun' | 'moveRefused' | 'rootRemoved';
    /** The folder a notice is about, when its text names one. */
    noticeFolder?: string;
    /** Where the session was before a move Hermes refused. */
    noticePrevious?: string;
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
