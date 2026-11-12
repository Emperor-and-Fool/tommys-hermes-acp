/**
 * The approval-mode switch: Manual · Smart, plus the read-only line a profile that is `off` earns.
 *
 * One renderer, mounted twice — inside a permission card and in the rail's row — so the two can
 * never disagree about the mode. It is a setting, not an answer: it changes the whole profile and
 * leaves the card in front of you untouched.
 *
 * `off` is deliberately absent as a button: silencing every prompt in the profile is a deliberate
 * act, taken in Hermes itself, not a click inside the surface that is asking you something.
 */
import type { ApprovalMode } from '../../../shared/webview';
import { post } from '../../post';
import { state } from '../../state';

/** The positions the switch offers, in the order it shows them. */
const MODE_CHOICES: Array<'manual' | 'smart' | 'off'> = ['manual', 'smart', 'off'];

/**
 * The red action clears the user's own deny list, and that list has no second copy, so a first
 * press only arms it. A second press, on the same open row, does the work.
 */
let openAccessArmed = false;

/** The pending guard: a spinner that outlives its answer is a lie about the state. */
const PENDING_GUARD_MS = 4000;
let pendingGuard: ReturnType<typeof setTimeout> | null = null;

export function beginApprovalModePending(): void {
    state.approvalModePending = true;
    if (pendingGuard) {
        clearTimeout(pendingGuard);
    }
    pendingGuard = setTimeout(function() {
        pendingGuard = null;
        state.approvalModePending = false;
        syncAllApprovalModeBlocks();
    }, PENDING_GUARD_MS);
    syncAllApprovalModeBlocks();
}

export function endApprovalModePending(): void {
    if (pendingGuard) {
        clearTimeout(pendingGuard);
        pendingGuard = null;
    }
    state.approvalModePending = false;
}

/** What the rail button says: the short name of the state that is actually in force. */
function permissionModeValue(): string {
    if (isAllOn()) {
        return locale.permissionModeAll || 'ALL';
    }
    if (state.approvalMode === 'manual') {
        return locale.permissionModeMan || 'Man';
    }
    if (state.approvalMode === 'smart') {
        return locale.permissionModeSmart || 'Smart';
    }
    if (state.approvalMode === 'off') {
        return locale.permissionModeNone || 'None';
    }
    return '\u2014';
}

/**
 * The widest state. Recorded by the host when the red action engaged, never inferred: `None`
 * with an empty deny list is still None — rules default-block, they are just not written down.
 */
function isAllOn(): boolean {
    return state.approvalOpenAccess && state.approvalMode === 'off';
}

function accentClass(): string {
    if (isAllOn()) {
        return 'accent-all';
    }
    if (state.approvalMode === 'manual') {
        return 'accent-manual';
    }
    if (state.approvalMode === 'smart') {
        return 'accent-smart';
    }
    if (state.approvalMode === 'off') {
        return 'accent-none';
    }
    return '';
}

function modeLabel(mode: ApprovalMode): string {
    if (mode === 'manual') return locale.approvalModeManual || 'Manual';
    if (mode === 'smart') return locale.approvalModeSmart || 'Smart';
    return locale.approvalModeOff || 'None';
}

/** Build one switch. It renders from `state.approvalMode`; nothing is local to the element. */
export function createApprovalModeBlock(): HTMLElement {
    const block = document.createElement('div');
    block.className = 'permission-approval-block';
    const tip = locale.approvalModeTooltip || '';
    const row = document.createElement('div');
    row.className = 'permission-approval';
    row.setAttribute('role', 'group');
    row.title = tip;
    if (tip) {
        row.setAttribute('aria-label', tip);
    }
    MODE_CHOICES.forEach(function(mode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'permission-approval-btn';
        btn.dataset.approvalMode = mode;
        btn.textContent = modeLabel(mode);
        btn.setAttribute('aria-pressed', 'false');
        btn.title = tip;
        btn.disabled = true;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (btn.disabled) {
                return;
            }
            // Pending until the host answers with the new mode (or with an error): the row says
            // it is working rather than looking like a click that did nothing.
            beginApprovalModePending();
            post({ type: 'setApprovalMode', mode: mode });
        });
        row.appendChild(btn);
    });
    block.appendChild(row);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'permission-open-btn';
    open.textContent = '\u26a0';
    open.setAttribute('aria-pressed', 'false');
    open.addEventListener('click', function(e) {
        e.stopPropagation();
        if (open.disabled) {
            return;
        }
        const engaged = isAllOn();
        if (engaged || state.approvalModePending) {
            // Second press stops it — even while the request is still in flight. The mode we left
            // is resumed; smart is the fallback when nothing was recorded.
            const resume = state.approvalModeBeforeOpen || 'smart';
            state.approvalModeBeforeOpen = null;
            openAccessArmed = false;
            beginApprovalModePending();
            post({ type: 'setApprovalMode', mode: resume });
            return;
        }
        if (state.approvalDenyCount > 0 && !openAccessArmed) {
            openAccessArmed = true;
            syncAllApprovalModeBlocks();
            return;
        }
        openAccessArmed = false;
        state.approvalModeBeforeOpen = state.approvalMode === 'unknown' ? null : state.approvalMode;
        beginApprovalModePending();
        post({ type: 'setOpenAccess' });
    });
    block.appendChild(open);
    // The other half of the red action: the patterns it cleared can be written back from the JSON
    // the host saved first. Only shown when such a file exists and nothing of it is in place.
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'permission-restore-btn';
    restore.hidden = true;
    restore.addEventListener('click', function(e) {
        e.stopPropagation();
        beginApprovalModePending();
        post({ type: 'restoreDeny' });
    });
    block.appendChild(restore);
    const error = document.createElement('div');
    error.className = 'permission-approval-error';
    error.hidden = true;
    block.appendChild(error);
    return block;
}

/** Point one block at the shared state. `withError` is false while a card is being mounted. */
export function syncApprovalModeBlock(block: HTMLElement, withError = true): void {
    const mode = state.approvalMode;
    const pending = state.approvalModePending;
    const row = block.querySelector('.permission-approval');
    // Anything the host could not read arrives as `unknown`: nothing is pressed then.
    const known = mode !== 'unknown';
    if (row) {
        row.dataset.mode = mode;
        row.classList.toggle('is-pending', pending);
        row.querySelectorAll('.permission-approval-btn').forEach(function(btn) {
            const selected = known && !pending && btn.dataset.approvalMode === mode;
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            btn.classList.toggle('is-selected', selected);
            btn.disabled = !known || pending;
        });
    }
    const error = block.querySelector('.permission-approval-error');
    if (error) {
        error.hidden = !(withError && state.approvalModeError);
        error.textContent = state.approvalModeError;
    }
    const openBtn = block.querySelector('.permission-open-btn') as HTMLButtonElement | null;
    if (openBtn) {
        // On means both halves are in place: approvals off, and nothing of the user's own blocking.
        const on = state.approvalMode === 'off' && state.approvalDenyCount === 0;
        openBtn.classList.toggle('is-on', on);
        openBtn.classList.toggle('is-armed', openAccessArmed);
        openBtn.classList.toggle('is-pending', pending && !on);
        openBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        // Never disabled: a second press has to be able to stop a request already in flight.
        openBtn.disabled = false;
        const restoreBtn = block.querySelector('.permission-restore-btn') as HTMLButtonElement | null;
        if (restoreBtn) {
            restoreBtn.hidden = !state.approvalDenyBackup || state.approvalDenyCount > 0;
            restoreBtn.disabled = pending;
            restoreBtn.textContent = locale.permissionRestoreLabel || 'Restore deny rules';
            restoreBtn.title = state.approvalDenyBackup || '';
        }
        openBtn.title = openAccessArmed
            ? (locale.permissionOpenConfirm || 'Press again: approvals off and approvals.deny cleared')
            : (locale.permissionOpenTooltip
                || 'Approvals off and approvals.deny cleared. Blocking left: the hardline list only.');
    }
}

/** Every mounted switch — a card's and the rail's — follows the same state in one call. */
export function syncAllApprovalModeBlocks(): void {
    document.querySelectorAll('.permission-approval-block').forEach(function(block) {
        syncApprovalModeBlock(block as HTMLElement);
    });
    // The rail button carries the state: its words, and the accent of the mode in force.
    const indicator = document.getElementById('permissionModeBtn');
    if (indicator) {
        const on = isAllOn();
        indicator.classList.toggle('is-open', on);
        for (const name of ['accent-manual', 'accent-smart', 'accent-none', 'accent-all']) {
            indicator.classList.remove(name);
        }
        const accent = accentClass();
        if (accent) {
            indicator.classList.add(accent);
        }
        const label = document.getElementById('permissionModeBtnLabel');
        if (label) {
            const template = locale.permissionModeBtnTemplate || 'Permissions: {mode}';
            label.textContent = template.replace('{mode}', permissionModeValue());
        }
        const tip = locale.permissionModeBtnTooltip || 'To allow session permissions mode must be manual';
        indicator.title = tip;
        indicator.setAttribute('aria-label', tip);
    }
}

/** A locale change: the switch's words are ours, so they move with the rest. */
export function refreshApprovalModeLabels(): void {
    const tip = locale.approvalModeTooltip || '';
    document.querySelectorAll('.permission-approval-block').forEach(function(block) {
        const row = block.querySelector('.permission-approval');
        if (row) {
            row.title = tip;
            if (tip) {
                row.setAttribute('aria-label', tip);
            }
        }
        block.querySelectorAll('.permission-approval-btn').forEach(function(btn) {
            const mode = (btn as HTMLElement).dataset.approvalMode as ApprovalMode | undefined;
            if (mode) {
                btn.textContent = modeLabel(mode);
            }
            btn.title = tip;
        });
    });
}
