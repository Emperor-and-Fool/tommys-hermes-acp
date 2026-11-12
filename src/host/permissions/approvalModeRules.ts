/**
 * The approval-mode rules: what Hermes accepts, and what this front-end may write.
 *
 * Pure on purpose — no Node, no `vscode`, no CLI. Both the host control and the pane's switch can
 * read the same answers, and the rules are testable without an editor.
 */
import type { ApprovalMode } from '../../shared/webview';

/** The modes Hermes accepts, as `config get approvals.mode` reports them. */
export const APPROVAL_MODES: readonly string[] = ['manual', 'smart', 'off'];

/**
 * The modes this front-end may set — all three Hermes accepts. `off` is offered under the name
 * "None" in the UI: it silences every prompt in the profile, so the label has to say that plainly
 * rather than read like a third kind of asking.
 */
export const SETTABLE_APPROVAL_MODES: readonly string[] = ['manual', 'smart', 'off'];

/** One mode the pane can write: everything Hermes accepts except `unknown`. */
export type SettableApprovalMode = Exclude<ApprovalMode, 'unknown'>;

/** What `config get approvals.mode` printed, trimmed and lower-cased; `unknown` if it is not ours. */
export function parseApprovalMode(raw: unknown): ApprovalMode {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return APPROVAL_MODES.indexOf(value) >= 0 ? (value as ApprovalMode) : 'unknown';
}

/** Whether a value the pane sent may be written. */
export function isSettableApprovalMode(value: unknown): value is SettableApprovalMode {
    return typeof value === 'string' && SETTABLE_APPROVAL_MODES.indexOf(value) >= 0;
}
