import { setConfigureEnvDetectDetailsTitle, updateConfigureEnvPathClearVisibility, updateConfigureEnvSystemHint } from './components/environment/configureModal';
import { DETECT_STEP_IDS, detectStepLabel, refreshDetectStepLabels, setDetectEnvDetailsTitle } from './components/environment/detectPanel';
import { SESSION_RENDER_BANNER_ID } from './components/messages/markdown';
import { pendingPermissions, refreshApprovalModeLabels, refreshPermissionOptionLabels, syncPermissionDetailView } from './components/messages/permissionCard';
import { auxiliaryRoleLabel, syncAuxiliaryDetailView } from './components/messages/toolCards';
import { buildFaqAccordion } from './components/modals/info';
import { updateMultiSelectToolbar } from './components/multiSelect';
import { applyHistoryPickerLocale } from './components/composer/historyAttach';
import { updateModelButtonDisplay } from './components/pickers/modelPicker';
import { profileDisplayName } from './components/pickers/profilePicker';
import { applyInputPlaceholder } from './components/status/statusBar';
import { byId, cancelBtn, chatSearchInput, chatSearchNext, chatSearchPrev, clearInputBtn, closedPickerBtn, closedPickerLabel, configureEnvBrowseBtn, configureEnvCancelBtn, configureEnvCandidatesEmpty, configureEnvDetectBtn, configureEnvDetectSteps, configureEnvDetectToggle, configureEnvPathClearBtn, configureEnvPathInput, configureEnvSaveBtn, configureEnvSystemBtn, copyLogBtn, copySessionBtn, detectEnvBtn, detectEnvToggle, faqModalBody, inputResizeHandle, messagesEl, modelBtn, multiSelectAllBtn, multiSelectAttachConfirmBtn, multiSelectCopyBtn, multiSelectDeleteBtn, multiSelectExitBtn, multiSelectExportBtn, openTabBtn, profileBtn, quickToggleBtn, retryBtn, sendBtn, statusText, tokenUsageRing } from './dom';
import { state } from './state';


export function applyLocale() {
    const toolbarStatus = byId('toolbarStatus');
    const retryBtnEl = byId('retryBtn');
    const profileBtnEl = byId('profileBtn');
    const modelBtnEl = byId('modelBtn');
    const cancelBtnEl = byId('cancelBtn');
    const filePickerElLocal = byId('filePicker');

    if (toolbarStatus) toolbarStatus.title = locale.connectionStatus;
    if (retryBtnEl) retryBtnEl.title = locale.retry;
    const detectEnvBtnEl = byId('detectEnvBtn');
    if (detectEnvBtnEl) {
        detectEnvBtnEl.textContent = locale.detectEnvironment || '';
        detectEnvBtnEl.title = locale.detectEnvironment || '';
    }
    const profileLabelText = byId('profileLabelText');
    if (profileLabelText) profileLabelText.textContent = locale.profile;
    if (profileBtnEl) profileBtnEl.title = locale.switchProfile;
    const profilesHeader = byId('profilesHeader');
    if (profilesHeader) profilesHeader.textContent = locale.profiles;
    if (modelBtnEl) modelBtnEl.title = locale.switchModel;
    const modelsHeader = byId('modelsHeader');
    if (modelsHeader) modelsHeader.textContent = locale.models;
    updateModelButtonDisplay(state.lastModelPayload);
    applyHistoryPickerLocale();
    const openTabLabelFull = byId('openTabLabelFull');
    if (openTabLabelFull) openTabLabelFull.textContent = locale.openTab;
    if (openTabBtn) openTabBtn.title = locale.openTab;
    if (closedPickerBtn) closedPickerBtn.title = locale.chooseChat;
    const closedPickerLabelEl = byId('closedPickerLabel');
    if (closedPickerLabelEl && !state.pendingOpenSessionId) {
        closedPickerLabelEl.textContent = locale.chooseChat;
    }
    const detectEnvClose = byId('detectEnvClose');
    if (detectEnvClose) {
        detectEnvClose.title = locale.detectEnvironmentClose || '';
        detectEnvClose.setAttribute('aria-label', locale.detectEnvironmentClose || 'Close');
    }
    if (state.detectEnvPanelReady) {
        setDetectEnvDetailsTitle();
        const toggle = byId('detectEnvToggle');
        if (toggle) {
            toggle.title = state.detectEnvDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
        const hint = byId('detectEnvCompactHint');
        if (hint) hint.classList.toggle('is-open', state.detectEnvDetailsOpen);
        DETECT_STEP_IDS.forEach(function(stepId) {
            const row = document.getElementById('detectStep-' + stepId);
            if (!row) return;
            const label = row.querySelector('.detect-env-step-label');
            if (label) label.textContent = detectStepLabel(stepId);
        });
    }
    if (inputResizeHandle) {
        inputResizeHandle.title = locale.resizeHandle;
        inputResizeHandle.setAttribute('aria-label', locale.resizeHandle);
    }
    if (filePickerElLocal) filePickerElLocal.setAttribute('aria-label', locale.filePicker);
    if (chatSearchInput) {
        chatSearchInput.placeholder = locale.searchChat;
        chatSearchInput.setAttribute('aria-label', locale.searchChat);
    }
    if (chatSearchPrev) {
        chatSearchPrev.title = locale.searchPrev;
        chatSearchPrev.setAttribute('aria-label', locale.searchPrev);
    }
    if (chatSearchNext) {
        chatSearchNext.title = locale.searchNext;
        chatSearchNext.setAttribute('aria-label', locale.searchNext);
    }
    if (clearInputBtn) {
        clearInputBtn.title = locale.clearInput;
        clearInputBtn.setAttribute('aria-label', locale.clearInput);
    }
    if (copySessionBtn) {
        copySessionBtn.title = locale.copySession;
        copySessionBtn.setAttribute('aria-label', locale.copySession);
    }
    if (multiSelectAllBtn) multiSelectAllBtn.textContent = locale.multiSelectAll;
    if (multiSelectDeleteBtn) multiSelectDeleteBtn.textContent = locale.multiSelectDelete;
    if (multiSelectCopyBtn) multiSelectCopyBtn.textContent = locale.multiSelectCopy;
    if (multiSelectExportBtn) multiSelectExportBtn.textContent = locale.multiSelectExport;
    if (multiSelectExitBtn) multiSelectExitBtn.textContent = locale.multiSelectExit;
    updateMultiSelectToolbar();
    if (quickToggleBtn) {
        quickToggleBtn.title = locale.quickActions;
        quickToggleBtn.setAttribute('aria-label', locale.quickActions);
    }
    applyInputPlaceholder();
    if (tokenUsageRing) {
        tokenUsageRing.title = locale.tokenUsage;
        tokenUsageRing.setAttribute('aria-label', locale.tokenUsage);
    }
    if (sendBtn) sendBtn.textContent = locale.send;
    const stopBtnLabel = byId('stopBtnLabel');
    if (stopBtnLabel) stopBtnLabel.textContent = locale.stop;
    if (cancelBtnEl) {
        cancelBtnEl.title = locale.cancelResponse;
        cancelBtnEl.setAttribute('aria-label', locale.cancelResponse);
    }
    const logModalTitle = byId('logModalTitle');
    if (logModalTitle) logModalTitle.textContent = locale.hermesLogs;
    const renderBannerText = document.querySelector('#' + SESSION_RENDER_BANNER_ID + ' .session-render-text');
    if (renderBannerText) renderBannerText.textContent = locale.sessionRendering || '';
    const copyLogBtn = byId('copyLogBtn');
    if (copyLogBtn) copyLogBtn.textContent = locale.copy;
    const clearLogBtn = byId('clearLogBtn');
    if (clearLogBtn) clearLogBtn.textContent = locale.clear;
    const aboutModalTitle = byId('aboutModalTitle');
    if (aboutModalTitle) aboutModalTitle.textContent = locale.aboutTitle;
    const helpModalTitle = byId('helpModalTitle');
    if (helpModalTitle) helpModalTitle.textContent = locale.helpTitle;
    const helpModalBody = byId('helpModalBody');
    if (helpModalBody) helpModalBody.innerHTML = locale.helpHtml;
    const faqModalTitle = byId('faqModalTitle');
    if (faqModalTitle) faqModalTitle.textContent = locale.faqTitle;
    const faqModalBody = byId('faqModalBody');
    if (faqModalBody) {
        faqModalBody.innerHTML = locale.faqHtml || '';
        buildFaqAccordion(faqModalBody);
    }
    const configureEnvModalTitle = byId('configureEnvModalTitle');
    if (configureEnvModalTitle) configureEnvModalTitle.textContent = locale.configureEnvironmentTitle || '';
    const configureEnvPathLabel = byId('configureEnvPathLabel');
    if (configureEnvPathLabel) configureEnvPathLabel.textContent = locale.configureEnvironmentPathLabel || '';
    if (configureEnvPathInput) {
        configureEnvPathInput.placeholder = locale.configureEnvironmentPathPlaceholder || '';
    }
    if (configureEnvPathClearBtn) {
        configureEnvPathClearBtn.setAttribute(
            'aria-label',
            locale.configureEnvironmentClearPath || 'Clear path',
        );
        configureEnvPathClearBtn.title = locale.configureEnvironmentClearPath || 'Clear path';
    }
    updateConfigureEnvPathClearVisibility();
    if (configureEnvBrowseBtn) configureEnvBrowseBtn.textContent = locale.configureEnvironmentBrowse || '';
    if (configureEnvDetectBtn) configureEnvDetectBtn.textContent = locale.configureEnvironmentDetect || '';
    const configureEnvCandidatesTitle = byId('configureEnvCandidatesTitle');
    if (configureEnvCandidatesTitle) {
        configureEnvCandidatesTitle.textContent = locale.configureEnvironmentCandidatesTitle || '';
    }
    if (configureEnvCandidatesEmpty) {
        configureEnvCandidatesEmpty.textContent = locale.configureEnvironmentNoCandidates || '';
    }
    if (configureEnvSaveBtn) configureEnvSaveBtn.textContent = locale.configureEnvironmentSave || '';
    if (configureEnvCancelBtn) configureEnvCancelBtn.textContent = locale.configureEnvironmentCancel || '';
    if (configureEnvSystemBtn) {
        configureEnvSystemBtn.textContent = locale.detectEnvironmentConfigureSystem || '';
    }
    updateConfigureEnvSystemHint();
    refreshDetectStepLabels(configureEnvDetectSteps, 'configureDetectStep-');
    setConfigureEnvDetectDetailsTitle();
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.title = state.configureEnvDetectDetailsOpen
            ? (locale.detectEnvironmentHideDetails || '')
            : (locale.detectEnvironmentViewDetails || '');
    }
    if (statusText) statusText.textContent = locale.statusDisconnected;
    pendingPermissions.forEach(function(group) {
        const labelEl = group.querySelector('.permission-label');
        if (labelEl) labelEl.textContent = locale.permissionTitle || 'Permission required';
        refreshPermissionOptionLabels(group);
        refreshApprovalModeLabels(group);
        if (group._permissionState) {
            group._permissionState.moreBtn.textContent = locale.permissionShowMore || 'Show more';
            group._permissionState.lessBtn.textContent = locale.permissionCollapse || 'Collapse';
            syncPermissionDetailView(group);
        }
    });
    document.querySelectorAll('.message-group.thought, .message-group.tool').forEach(function(group) {
        if (!group._auxState) return;
        group._auxState.moreBtn.textContent = locale.permissionShowMore || 'Show more';
        group._auxState.lessBtn.textContent = locale.permissionCollapse || 'Collapse';
        const labelEl = group.querySelector('.aux-label');
        if (labelEl) {
            labelEl.textContent = auxiliaryRoleLabel(group._auxState.role, group._auxState.rawText);
        }
        syncAuxiliaryDetailView(group);
    });
}

export function assistantRoleLabel() {
    return profileDisplayName() + '@HermesHomeBase';
}

export function refreshRoleLabels() {
    if (!messagesEl) return;
    messagesEl.querySelectorAll('.message-group').forEach(function(group) {
        if (group.classList.contains('assistant')) {
            const labelEl = group.querySelector('.message.assistant > .label');
            if (labelEl) labelEl.textContent = assistantRoleLabel();
        } else if (group.classList.contains('thought') || group.classList.contains('tool')) {
            const labelEl = group.querySelector('.aux-label');
            if (labelEl && group._auxState) {
                labelEl.textContent = auxiliaryRoleLabel(group._auxState.role, group._auxState.rawText);
            }
        }
    });
}

export function initApplyLocale(): void {
    applyLocale();
}
