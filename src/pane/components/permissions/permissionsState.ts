import type { ApprovalMode } from '../../../shared/webview';

/**
 * The permissions feature's own slice of the pane state (S1).
 *
 * The approval mode as the host last reported it, whether a write to it is in flight, the
 * deny-list facts behind the red action, and the one deferred notice. It sits beside the switch
 * that draws it because no other feature reads it — the same reason the cards keep their slice in
 * `cardState.ts`.
 *
 * A plain object rather than a class: these are values the switch writes and reads back, with no
 * invariant of their own to guard.
 */
export interface PermissionsPaneState {
    /** Hermes' approvals.mode as last reported by the host: one truth for card and rail row. */
    approvalMode: ApprovalMode;
    /** A mode write is in flight: the switch shows it is working instead of looking inert. */
    approvalModePending: boolean;
    approvalModeError: string;
    /** While an edit mode waits for the run in flight; '' when nothing is deferred. */
    approvalModeNotice: 'appliesNextRun' | '';
    /** Entries in the profile's `approvals.deny`; 0 means nothing of the user's own is blocking. */
    approvalDenyCount: number;
    /** The mode to resume when the red action is stopped; null when nothing is engaged. */
    approvalModeBeforeOpen: ApprovalMode | null;
    /** Path of the deny list saved before a clear; empty when nothing was ever cleared. */
    approvalDenyBackup: string;
    /** The red action is engaged (ALL): recorded by the host, never inferred from the values. */
    approvalOpenAccess: boolean;
}

/** The live slice: one object, written by the switch and by the message that answers it. */
export const permissionsState: PermissionsPaneState = {
    approvalMode: 'unknown',
    approvalModePending: false,
    approvalModeError: '',
    approvalModeNotice: '',
    approvalDenyCount: 0,
    approvalModeBeforeOpen: null,
    approvalDenyBackup: '',
    approvalOpenAccess: false,
};
