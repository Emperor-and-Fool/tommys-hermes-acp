import { tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { clearPopup, placePopup } from './projectGrouped';

/**
 * The workspace in the pane: the list of the ones this editor has opened, as a menu level.
 *
 * A workspace has no name of ours — it is a file or a folder — so a row shows the path's own name
 * and keeps the full path in its tooltip.
 */

/** The last path segment without the workspace extension: what a picker row can show. */
export function workspaceLabel(workspacePath: string): string {
    const base = workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath;
    return base.replace(/\.code-workspace$/i, '');
}

/** The workspaces this editor has opened, as the tab menu's second level. */
export function showWorkspacePicker(sessionId: string): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveWorkspace) + '</div>';
    state.lastWorkspaces.forEach(function(entry) {
        html += '<button type="button" class="tab-ctx-item" data-workspace="' + escapeHtml(entry.id) + '" title="' + escapeHtml(entry.path) + '">' + escapeHtml(workspaceLabel(entry.path)) + '</button>';
    });
    tabContextMenu.innerHTML = html;
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-workspace]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const workspaceId = item.dataset.workspace || '';
            clearPopup();
            post({ type: 'moveToWorkspace', sessionId: sessionId, workspace: workspaceId });
        });
    });
    placePopup(0, 0);
}
