import { byId, closedPicker, configureEnvModal, contextAttachPicker, detectEnvToggle, logModal, modelPicker, profilePicker, tabContextMenu } from '../../dom';
import { state } from '../../state';
import { hideContextAttachPreview, hideContextAttachTooltip } from '../composer/contextAttach';
import { hideFilePicker } from '../composer/fileMention';
import { closeConfigureEnvModal, setConfigureEnvDetectDetailsOpen } from '../environment/configureModal';
import { setDetectEnvDetailsOpen } from '../environment/detectPanel';
import { closeInsertDropdowns } from '../messages/messageActions';
import { hideTabContextMenu } from '../tabs/tabMenu';
import { maybeScrollLogToBottom, renderLogContent, resetLogAutoScrollFollow } from './logViewer';


export function isLogModalOpen() {
    return !!(logModal && logModal.classList.contains('is-open'));
}

export function showModal(el) {
    if (el) el.classList.add('is-open');
}

export function hideModal(el) {
    if (el) el.classList.remove('is-open');
}

export function openLogModal() {
    resetLogAutoScrollFollow();
    renderLogContent();
    showModal(logModal);
    maybeScrollLogToBottom(true);
}

export function initDocumentClick(): void {
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.insert-dropdown')) {
            closeInsertDropdowns();
        }
        if (tabContextMenu && !e.target.closest('.tab-context-menu')) {
            hideTabContextMenu();
        }
        if (state.detectEnvDetailsOpen && !e.target.closest('.detect-env-bar')) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = byId('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
    });
}

export function initDocumentKeydown(): void {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && tabContextMenu && !tabContextMenu.hidden) {
            hideTabContextMenu();
        }
        if (e.key === 'Escape' && state.detectEnvDetailsOpen) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = byId('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
        if (e.key === 'Escape' && state.configureEnvDetectDetailsOpen) {
            setConfigureEnvDetectDetailsOpen(false);
        }
        if (e.key === 'Escape' && configureEnvModal && configureEnvModal.classList.contains('is-open')) {
            closeConfigureEnvModal();
        }
    });
}

export function setMenuOpen(picker, open) {
    if (!picker) {
        return;
    }
    picker.dataset.open = open ? 'true' : 'false';
    picker.classList.toggle('is-open', open);
}

export function closeAllDropdowns() {
    setMenuOpen(closedPicker, false);
    setMenuOpen(profilePicker, false);
    setMenuOpen(modelPicker, false);
    setMenuOpen(contextAttachPicker, false);
    hideContextAttachTooltip();
    hideContextAttachPreview();
}

export function initDocumentClickDocument(): void {
    document.addEventListener('click', function(e) {
        if (e.target.closest('.picker')) {
            return;
        }
        if (e.target.closest('#contextAttachPreview')) {
            return;
        }
        if (!e.target.closest('#input-area')) {
            hideFilePicker();
        }
        closeAllDropdowns();
    });
}
