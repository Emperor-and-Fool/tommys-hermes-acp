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

/** The two messages a press of the row's own button can send. */
export type RootRowPress = { type: 'openPermissionRoot' } | { type: 'permissionRootClose' };

/**
 * What a press of the row's button means: it toggles, like the permission-mode button does.
 *
 * A closed row opens. An open one closes through the same path as the X, so the host hears
 * `permissionRootClose` — a countdown that is running stops and keeps the seconds it reached.
 * Returns the row's state after the press.
 */
export function pressRootButton(open: boolean, send: (msg: RootRowPress) => void): boolean {
    if (open) {
        send({ type: 'permissionRootClose' });
        return false;
    }
    send({ type: 'openPermissionRoot' });
    return true;
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
