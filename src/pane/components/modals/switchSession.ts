import { byId, required } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { hideModal, showModal } from './modal';


function openSwitchSessionModal(sessionId) {
    state.pendingSwitchSessionId = sessionId;
    const titleEl = required('switchSessionModalTitle');
    const bodyEl = required('switchSessionModalBody');
    const stayBtn = required('switchSessionStayBtn');
    const confirmBtn = required('switchSessionConfirmBtn');
    if (titleEl) titleEl.textContent = locale.switchSessionPromptTitle || '';
    if (bodyEl) bodyEl.textContent = locale.switchSessionPromptBody || '';
    if (stayBtn) stayBtn.textContent = locale.switchSessionStay || '';
    if (confirmBtn) confirmBtn.textContent = locale.switchSessionConfirm || '';
    showModal(switchSessionModal);
}

function closeSwitchSessionModal() {
    state.pendingSwitchSessionId = null;
    hideModal(switchSessionModal);
}

function markSwitchQueued(sessionId) {
    state.switchQueuedFor = sessionId;
    const titleEl = required('switchSessionModalTitle');
    const bodyEl = required('switchSessionModalBody');
    const stayBtn = required('switchSessionStayBtn');
    const confirmBtn = required('switchSessionConfirmBtn');
    if (titleEl) titleEl.textContent = locale.switchSessionQueuedTitle || '';
    if (bodyEl) bodyEl.textContent = locale.switchSessionQueuedBody || '';
    if (stayBtn) stayBtn.hidden = true;
    if (confirmBtn) {
        confirmBtn.textContent = locale.switchSessionStopNow || locale.stop;
        confirmBtn.className = 'toolbar-btn switch-queued-btn';
        confirmBtn.dataset.queued = 'true';
    }
    const tab = [...document.querySelectorAll('.session-tab')].find(t => t.dataset.id === sessionId);
    if (tab) tab.classList.add('switch-pending');
}

export function clearSwitchQueued() {
    if (!state.switchQueuedFor) return;
    state.switchQueuedFor = null;
    const stayBtn = required('switchSessionStayBtn');
    const confirmBtn = required('switchSessionConfirmBtn');
    if (stayBtn) stayBtn.hidden = false;
    if (confirmBtn) {
        confirmBtn.textContent = locale.switchSessionConfirm || '';
        confirmBtn.className = 'toolbar-btn primary';
        delete confirmBtn.dataset.queued;
    }
    document.querySelectorAll('.session-tab.switch-pending').forEach(t => t.classList.remove('switch-pending'));
    hideModal(switchSessionModal);
    state.pendingSwitchSessionId = null;
}

export function requestSwitchSession(sessionId) {
    if (!sessionId || sessionId === state.activeSessionId) {
        return;
    }
    if (state.isPrompting) {
        openSwitchSessionModal(sessionId);
        return;
    }
    post({ type: 'switchSession', sessionId: sessionId });
}

const switchSessionModal = required('switchSessionModal');

const switchSessionStayBtn = required('switchSessionStayBtn');

const switchSessionConfirmBtn = required('switchSessionConfirmBtn');

export function initSwitchSessionStayBtnClick(): void {
    if (switchSessionStayBtn) {
        switchSessionStayBtn.addEventListener('click', closeSwitchSessionModal);
    }
}

export function initSwitchSessionConfirmBtnClick(): void {
    if (switchSessionConfirmBtn) {
        switchSessionConfirmBtn.addEventListener('click', function() {
            const confirmBtn = required('switchSessionConfirmBtn');
            if (confirmBtn && confirmBtn.dataset.queued === 'true') {
                // Stop the run; the switch is already queued and lands the moment it ends.
                post({ type: 'cancel' });
                return;
            }
            if (!state.pendingSwitchSessionId) {
                closeSwitchSessionModal();
                return;
            }
            const sessionId = state.pendingSwitchSessionId;
            post({ type: 'switchSession', sessionId, interrupt: true });
            markSwitchQueued(sessionId);
        });
    }
}

export function initSwitchSessionModalClick(): void {
    if (switchSessionModal) {
        switchSessionModal.addEventListener('click', function(e) {
            // While a switch is queued the dialog is the only thing explaining the wait, so
            // a click outside must not dismiss it.
            if (e.target === switchSessionModal && !state.switchQueuedFor) {
                closeSwitchSessionModal();
            }
        });
    }
}
