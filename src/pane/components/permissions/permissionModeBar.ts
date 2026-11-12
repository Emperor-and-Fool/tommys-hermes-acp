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
import {
    beginApprovalModePending,
    createApprovalModeBlock,
    syncAllApprovalModeBlocks,
    syncApprovalModeBlock,
} from './approvalModeSwitch';

let open = false;

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
    bar.hidden = !open;
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

export function applyPermissionModeLabels(): void {
    // The button's words and accent belong to the state: the switch module writes them.
    syncAllApprovalModeBlocks();
    const close = byId('permissionModeClose');
    if (close) {
        const label = locale.permissionModeClose || 'Close';
        close.title = label;
        close.setAttribute('aria-label', label);
    }
}

export function initPermissionModeBtnClick(): void {
    applyPermissionModeLabels();
    // One switch, mounted once: everything it renders comes from `state.approvalMode`.
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
