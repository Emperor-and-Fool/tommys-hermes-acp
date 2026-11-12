/**
 * Hermes' `approvals.mode`, read and written through its own CLI.
 *
 * We never touch the config file: `hermes --profile <p> config get|set` is the only handle, which
 * is why both directions are one `runHermesCommand` call and nothing here parses a path.
 *
 * The three values are the whole vocabulary. Anything else — a typo in the file, a newer Hermes
 * with a fourth mode — reads as `unknown`, so the switch shows nothing pressed instead of guessing.
 */
import { runHermesCommand } from './profileDiscovery';
import { normalizeHermesCliProfile } from './hermesProfile';
import type { ApprovalMode } from '../../shared/webview';

/** The modes Hermes accepts, as `config get approvals.mode` reports them. */
export const APPROVAL_MODES: readonly string[] = ['manual', 'smart', 'off'];

/**
 * The modes this front-end may set. `off` is read but never written: silencing every prompt in
 * the profile is a deliberate act, taken in Hermes itself, not a click inside a card.
 */
export const SETTABLE_APPROVAL_MODES: readonly string[] = ['manual', 'smart'];

/** One mode the pane can write: everything Hermes accepts except `unknown` and `off`. */
export type SettableApprovalMode = Exclude<ApprovalMode, 'unknown' | 'off'>;

/** What `config get approvals.mode` printed, trimmed and lower-cased; `unknown` if it is not ours. */
export function parseApprovalMode(raw: unknown): ApprovalMode {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return APPROVAL_MODES.indexOf(value) >= 0 ? (value as SettableApprovalMode) : 'unknown';
}

/** Whether a value the pane sent may be written. */
export function isSettableApprovalMode(value: unknown): value is SettableApprovalMode {
    return typeof value === 'string' && SETTABLE_APPROVAL_MODES.indexOf(value) >= 0;
}

/** Read the profile's mode. A missing CLI or a failed call is `unknown`, never an exception. */
export async function readApprovalMode(executable: string, profile: string): Promise<ApprovalMode> {
    try {
        const raw = await runHermesCommand(executable, [
            '--profile', normalizeHermesCliProfile(profile),
            'config', 'get', 'approvals.mode',
        ]);
        return parseApprovalMode(raw);
    } catch {
        return 'unknown';
    }
}

/** Write the profile's mode. True when the CLI took it. */
export async function writeApprovalMode(
    executable: string,
    profile: string,
    mode: SettableApprovalMode
): Promise<boolean> {
    try {
        await runHermesCommand(executable, [
            '--profile', normalizeHermesCliProfile(profile),
            'config', 'set', 'approvals.mode', mode,
        ]);
        return true;
    } catch {
        return false;
    }
}
