import { tabContextMenu } from '../dom';

/**
 * The one popup in the pane: the strip's context-menu element, reused by every level that opens a
 * menu — a tab's, a project's, and the workspace picker.
 *
 * Placing and clearing it belongs to no single subject, so it lives outside the feature files that
 * draw into it. Whoever owns the state behind the menu clears that itself.
 */

/** Place the popup where it was asked for, kept inside the pane. */
export function placePopup(x: number, y: number): void {
    if (!tabContextMenu) return;
    tabContextMenu.hidden = false;
    tabContextMenu.style.left = '0px';
    tabContextMenu.style.top = '0px';
    const rect = tabContextMenu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    tabContextMenu.style.left = Math.min(x, maxLeft) + 'px';
    tabContextMenu.style.top = Math.min(y, maxTop) + 'px';
}

/** Empty the popup. */
export function clearPopup(): void {
    if (!tabContextMenu) return;
    tabContextMenu.hidden = true;
    tabContextMenu.innerHTML = '';
}
