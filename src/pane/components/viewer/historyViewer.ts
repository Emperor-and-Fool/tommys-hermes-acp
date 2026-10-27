/* The history viewer's half: a read-only transcript that can be ticked, and nothing else. */
import { historyRoleReload, multiSelectAttachConfirmBtn, multiSelectExitBtn } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { enterMultiSelectMode, getSelectedMessageIndices } from '../multiSelect';

/** The session this tab is showing, as the host named it; it comes back with the ticks. */
let viewerSessionId = '';

/** `surfaceRole` with role 'viewer': this page is the viewer, not a chat surface. */
export function applyViewerSurfaceRole(): void {
    document.body.classList.add('is-viewer');
}

/**
 * The transcript arrived. The viewer's only interaction is ticking messages for a history attach,
 * so multi-select starts as soon as there is something to show. An empty local copy says so in
 * one line and still offers Cancel.
 */
export function afterHistoryRestored(messages: any[], sessionId?: string): void {
    if (!document.body.classList.contains('is-viewer')) {
        return;
    }
    viewerSessionId = sessionId || '';
    if (!messages || messages.length === 0) {
        state.placeholder.style.display = 'block';
        state.placeholder.textContent = locale.historyViewerUnavailable || 'Not available locally.';
    }
    enterMultiSelectMode(null, 'historyPick');
}

/** The viewer's own page, rather than a chat surface that happens to be in multi-select. */
function isViewer(): boolean {
    return document.body.classList.contains('is-viewer');
}

/** Post the ticks, or give up; the host closes the tab either way. */
export function initHistoryViewer(): void {
    if (multiSelectAttachConfirmBtn) {
        multiSelectAttachConfirmBtn.addEventListener('click', function() {
            if (!isViewer() || multiSelectAttachConfirmBtn.disabled) {
                return;
            }
            const indices = getSelectedMessageIndices();
            if (!indices.length) {
                return;
            }
            post({ type: 'historyPicked', sessionId: viewerSessionId, indices });
        });
    }
    if (historyRoleReload) {
        historyRoleReload.textContent = locale.historyRoleReload || 'Re-render';
        historyRoleReload.addEventListener('click', function() {
            if (!isViewer()) {
                return;
            }
            // A fresh transcript is the only thing that re-applies the role filter to cards that
            // were built before it changed, so this is an explicit action rather than a guess.
            post({ type: 'reloadHistoryViewer' });
        });
    }
    if (multiSelectExitBtn) {
        multiSelectExitBtn.addEventListener('click', function() {
            // No purpose check: `initMultiSelectExitBtnClick` runs first and exits the mode, which
            // resets the purpose; the body class is what says this page is the viewer.
            if (!isViewer()) {
                return;
            }
            post({ type: 'historyViewerCancel' });
        });
    }
}
