import { byId, closedPicker, configureEnvModal, historyPicker, detectEnvToggle, logModal, modelPicker, profilePicker, tabContextMenu, required } from '../../dom';
import { state } from '../../state';
import { hideFilePicker } from '../composer/fileMention';
import { closeConfigureEnvModal, setConfigureEnvDetectDetailsOpen } from '../environment/configureModal';
import { setDetectEnvDetailsOpen } from '../environment/detectPanel';
import { closeInsertDropdowns } from '../messages/messageActions';
import { hideTabContextMenu } from '../tabs/tabMenu';
import { maybeScrollLogToBottom, renderLogContent, resetLogAutoScrollFollow } from './logViewer';


export function isLogModalOpen() {
    return !!(logModal && logModal.classList.contains('is-open'));
}

export function showModal(el: HTMLElement) {
    if (el) el.classList.add('is-open');
}

export function hideModal(el: HTMLElement) {
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
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        if (!target.closest('.insert-dropdown')) {
            closeInsertDropdowns();
        }
        if (tabContextMenu && !target.closest('.tab-context-menu')) {
            hideTabContextMenu();
        }
        if (state.detectEnvDetailsOpen && !target.closest('.detect-env-bar')) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = required('detectEnvToggle');
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
            const detectToggle = required('detectEnvToggle');
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

export function setMenuOpen(picker: HTMLElement, open: boolean) {
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
    setMenuOpen(historyPicker, false);
}

/**
 * A toolbar button that opens its picker: one press opens it, a second closes it. `onOpen` runs
 * once the picker is open, so the caller can ask the host for the list it is about to show.
 */
export function wirePickerButton(button: HTMLElement, picker: HTMLElement, onOpen: () => void): void {
    button.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = picker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(picker, true);
            onOpen();
        }
    });
}

export function initDocumentClickDocument(): void {
    document.addEventListener('click', function(e) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        if (target.closest('.picker')) {
            return;
        }
        if (!target.closest('#input-area')) {
            hideFilePicker();
        }
        closeAllDropdowns();
    });
}
