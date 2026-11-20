/**
 * The rail's permission-mode control.
 *
 * The rail already lists its chats, so its closed-session picker gives way to this button: one
 * press opens a row directly under the toolbar, and that row holds the same approval-mode switch a
 * permission card carries — same renderer, same shared state, so the two can never disagree.
 *
 * Rail only: the markup is shared with the editor panel, and `surface-rail` on the body decides
 * which surface shows the button.
 */
import { byId } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { approvalModeNoticeApplies } from './permissionsState';
import {
    beginApprovalModePending,
    createApprovalModeBlock,
    syncAllApprovalModeBlocks,
    syncApprovalModeBlock,
} from './approvalModeSwitch';

let open = false;

/** The Hermes session the pane is showing: '' on a blank tab, which no notice can be about. */
function activeHermesSessionId(): string {
    const tab = state.lastSessions.find(session => session.id === state.activeSessionId);
    return tab?.hermesSessionId || '';
}

export function permissionModeRowIsOpen(): boolean {
    return open;
}

/** Show or hide the row and keep the button's own state honest. */
export function setPermissionModeRow(next: boolean): void {
    const bar = byId('permissionModeBar');
    const btn = byId('permissionModeBtn');
    if (!bar) {
        return;
    }
    open = next;
    bar.hidden = !(open || approvalModeNoticeApplies(activeHermesSessionId()));
    if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (open) {
        // Opening on the cached value would lie whenever the mode was changed in a terminal, so
        // the row asks Hermes again and says it is fetching until the answer lands.
        beginApprovalModePending();
        post({ type: 'requestApprovalMode' });
    }
}

/**
 * Say, beside the buttons, that the edit half waits for the run in flight.
 *
 * Commands follow the button at once — that is the profile's own setting — while the session's edit
 * mode is frozen per run by Hermes. Showing the row has the same rule as the permission root: the
 * row appears while it has something to say, and disappears when the run ends and it is applied.
 */
export function syncPermissionModeNotice(): void {
    const bar = byId('permissionModeBar');
    const notice = byId('permissionModeNotice');
    const waiting = approvalModeNoticeApplies(activeHermesSessionId());
    if (notice) {
        notice.textContent = waiting ? (locale.appliesNextRun || 'Applies from the next run.') : '';
        notice.hidden = !waiting;
    }
    if (bar) {
        bar.hidden = !(open || waiting);
    }
}

export function applyPermissionModeLabels(): void {
    // The button's words and accent belong to the state: the switch module writes them.
    syncAllApprovalModeBlocks();
    syncPermissionModeNotice();
    const close = byId('permissionModeClose');
    if (close) {
        const label = locale.permissionModeClose || 'Close';
        close.title = label;
        close.setAttribute('aria-label', label);
    }
}

export function initPermissionModeBtnClick(): void {
    applyPermissionModeLabels();
    // One switch, mounted once: everything it renders comes from `permissionsState.approvalMode`.
    const host = byId('permissionModeOptions');
    if (host && !host.querySelector('.permission-approval-block')) {
        const block = createApprovalModeBlock();
        host.appendChild(block);
        syncApprovalModeBlock(block);
    }
    const btn = byId('permissionModeBtn');
    if (btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            setPermissionModeRow(!open);
        });
    }
    const close = byId('permissionModeClose');
    if (close) {
        close.addEventListener('click', function(e) {
            e.stopPropagation();
            setPermissionModeRow(false);
        });
    }
    setPermissionModeRow(false);
    // Window load or reload: ask once, so the rail button shows the mode instead of a dash.
    post({ type: 'requestApprovalMode' });
}
