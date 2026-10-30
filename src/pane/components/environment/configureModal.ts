import { byId, configureEnvBrowseBtn, configureEnvCancelBtn, configureEnvCandidatesEmpty, configureEnvDetectBtn, configureEnvDetectCompactIcon, configureEnvDetectCompactText, configureEnvDetectSteps, configureEnvDetectToggle, configureEnvModal, configureEnvPathClearBtn, configureEnvPathInput, configureEnvSaveBtn, configureEnvSystemBtn, required } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { ensureDetectStepsList, formatDetectProgressDisplay, resetDetectStepsList, setDetectEnvIcon, updateDetectStepsList } from './detectPanel';


const configureEnvDetectSection = required('configureEnvDetectSection');

const configureEnvDetectCompactHint = required('configureEnvDetectCompactHint');

const configureEnvDetectClose = required('configureEnvDetectClose');

const configureEnvDetectDetails = required('configureEnvDetectDetails');

const configureEnvDetectDetailsTitle = required('configureEnvDetectDetailsTitle');

const configureEnvCandidatesSection = required('configureEnvCandidatesSection');

const configureEnvCandidatesList = required('configureEnvCandidatesList');

const configureEnvSystemHint = required('configureEnvSystemHint');

const configureEnvCloseBtn = required('configureEnvCloseBtn');

export function showConfigureEnvDetectPanel() {
    state.configureEnvDetectPanelVisible = true;
    if (configureEnvDetectSection) configureEnvDetectSection.hidden = false;
}

export function updateConfigureEnvPathClearVisibility() {
    if (!configureEnvPathClearBtn || !configureEnvPathInput) return;
    const hasValue = !!configureEnvPathInput.value.trim();
    configureEnvPathClearBtn.hidden = !hasValue;
}

function clearConfigureEnvPath() {
    if (!configureEnvPathInput) return;
    configureEnvPathInput.value = '';
    state.configureEnvSelectedPath = '';
    updateConfigureEnvPathClearVisibility();
    if (configureEnvCandidatesList) {
        configureEnvCandidatesList.querySelectorAll('.configure-env-candidate-row').forEach(function(el) {
            el.classList.remove('is-selected');
        });
    }
    configureEnvPathInput.focus();
}

export function hideConfigureEnvDetectProgress() {
    state.configureEnvDetectPanelVisible = false;
    state.configureEnvDetectFinished = false;
    state.configureEnvDetectDetailsOpen = false;
    if (configureEnvDetectSection) configureEnvDetectSection.hidden = true;
    setConfigureEnvDetectDetailsOpen(false);
    resetDetectStepsList('configureDetectStep-');
    if (configureEnvDetectCompactText) {
        configureEnvDetectCompactText.textContent = '';
        configureEnvDetectCompactText.title = '';
    }
    setDetectEnvIcon(configureEnvDetectCompactIcon, 'running');
}

function hideConfigureEnvDetectPanel() {
    hideConfigureEnvDetectProgress();
    if (configureEnvCandidatesSection) {
        configureEnvCandidatesSection.hidden = true;
        configureEnvCandidatesSection.classList.remove('is-visible');
    }
    if (configureEnvCandidatesList) configureEnvCandidatesList.textContent = '';
    if (configureEnvCandidatesEmpty) configureEnvCandidatesEmpty.hidden = true;
}

function closeConfigureEnvDetectPanel() {
    const wasVisible = state.configureEnvDetectPanelVisible;
    hideConfigureEnvDetectProgress();
    if (wasVisible) {
        setConfigureEnvDetecting(false);
        post({ type: 'configureEnvironmentDetectClose' });
    }
}

function createConfigureEnvFolderIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2 4.5h4.5L8 6h6v7.5H2z');
    svg.appendChild(path);
    return svg;
}

export function setConfigureEnvDetectDetailsOpen(open) {
    state.configureEnvDetectDetailsOpen = !!open;
    if (configureEnvDetectDetails) configureEnvDetectDetails.hidden = !state.configureEnvDetectDetailsOpen;
    if (configureEnvDetectCompactHint) {
        configureEnvDetectCompactHint.classList.toggle('is-open', state.configureEnvDetectDetailsOpen);
    }
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.setAttribute('aria-expanded', state.configureEnvDetectDetailsOpen ? 'true' : 'false');
        configureEnvDetectToggle.title = state.configureEnvDetectDetailsOpen
            ? (locale.detectEnvironmentHideDetails || '')
            : (locale.detectEnvironmentViewDetails || '');
    }
}

export function setConfigureEnvDetectDetailsTitle() {
    if (!configureEnvDetectDetailsTitle) return;
    configureEnvDetectDetailsTitle.textContent = state.configureEnvDetectFinished
        ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
        : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
}

export function updateConfigureEnvSystemHint() {
    if (!configureEnvSystemHint) return;
    const hint = localeText(
        'configureEnvironmentSystemVarHint',
        state.configureEnvSystemVar || 'PATH',
        state.configureEnvSystemTarget || '',
    );
    configureEnvSystemHint.innerHTML = hint.replace(
        state.configureEnvSystemVar,
        '<code>' + escapeHtml(state.configureEnvSystemVar) + '</code>',
    );
    if (configureEnvSystemBtn) {
        configureEnvSystemBtn.title = localeText(
            'detectEnvironmentConfigureSystemDesc',
            state.configureEnvSystemVar || 'PATH',
            state.configureEnvSystemTarget || '',
        );
    }
}

export function setConfigureEnvDetecting(detecting) {
    if (configureEnvBrowseBtn) configureEnvBrowseBtn.disabled = !!detecting;
    if (configureEnvDetectBtn) configureEnvDetectBtn.disabled = !!detecting;
    if (configureEnvSaveBtn) configureEnvSaveBtn.disabled = !!detecting;
    if (configureEnvSystemBtn) configureEnvSystemBtn.disabled = !!detecting;
}

function resetConfigureEnvDetectPanel() {
    hideConfigureEnvDetectPanel();
    state.configureEnvSelectedPath = '';
}

export function openConfigureEnvModal(currentPath, systemEnvVar, systemEnvTarget) {
    if (!configureEnvModal) return;
    state.configureEnvSystemVar = systemEnvVar || 'PATH';
    state.configureEnvSystemTarget = systemEnvTarget || '';
    updateConfigureEnvSystemHint();
    resetConfigureEnvDetectPanel();
    if (configureEnvPathInput) configureEnvPathInput.value = currentPath || '';
    updateConfigureEnvPathClearVisibility();
    configureEnvModal.classList.add('is-open');
    if (configureEnvPathInput) configureEnvPathInput.focus();
}

export function closeConfigureEnvModal() {
    if (!configureEnvModal) return;
    configureEnvModal.classList.remove('is-open');
    resetConfigureEnvDetectPanel();
}

function initConfigureEnvDetectStart() {
    state.configureEnvDetectFinished = false;
    ensureDetectStepsList(configureEnvDetectSteps, 'configureDetectStep-');
    resetDetectStepsList('configureDetectStep-');
    showConfigureEnvDetectPanel();
    setConfigureEnvDetectDetailsOpen(false);
    setConfigureEnvDetectDetailsTitle();
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.title = locale.detectEnvironmentViewDetails || '';
    }
    setDetectEnvIcon(configureEnvDetectCompactIcon, 'running');
    if (configureEnvDetectCompactText) {
        const text = formatDetectProgressDisplay('0%');
        configureEnvDetectCompactText.textContent = text;
        configureEnvDetectCompactText.title = text;
    }
}

export function updateConfigureEnvDetectProgress(msg) {
    if (!configureEnvDetectSection || !state.configureEnvDetectPanelVisible) return;
    updateDetectStepsList(
        msg,
        'configureDetectStep-',
        configureEnvDetectCompactIcon,
        configureEnvDetectCompactText,
    );
}

function basenameFromPath(filePath) {
    if (!filePath) return 'hermes';
    const parts = filePath.split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : 'hermes';
}

function selectConfigureEnvCandidate(path, rowEl) {
    state.configureEnvSelectedPath = path || '';
    if (configureEnvPathInput) {
        configureEnvPathInput.value = state.configureEnvSelectedPath;
        updateConfigureEnvPathClearVisibility();
    }
    if (configureEnvCandidatesList) {
        configureEnvCandidatesList.querySelectorAll('.configure-env-candidate-row').forEach(function(el) {
            el.classList.toggle('is-selected', el === rowEl);
        });
    }
}

function renderConfigureEnvCandidates(executables) {
    if (!configureEnvCandidatesSection || !configureEnvCandidatesList || !configureEnvCandidatesEmpty) return;
    configureEnvCandidatesList.textContent = '';
    const list = Array.isArray(executables) ? executables : [];
    configureEnvCandidatesSection.hidden = false;
    configureEnvCandidatesSection.classList.remove('is-visible');
    void configureEnvCandidatesSection.offsetWidth;
    configureEnvCandidatesSection.classList.add('is-visible');
    if (list.length === 0) {
        configureEnvCandidatesEmpty.hidden = false;
        configureEnvCandidatesEmpty.textContent = locale.configureEnvironmentNoCandidates || '';
        return;
    }
    configureEnvCandidatesEmpty.hidden = true;
    list.forEach(function(item, index) {
        const li = document.createElement('li');
        li.className = 'configure-env-candidate-row';
        if (item.path === state.configureEnvSelectedPath) {
            li.classList.add('is-selected');
        }
        li.style.animationDelay = (index * 0.06) + 's';

        const body = document.createElement('div');
        body.className = 'configure-env-candidate-body';
        const icon = document.createElement('span');
        icon.className = 'configure-env-candidate-icon detect-env-icon ' + (item.verified ? 'ok' : 'fail');
        const main = document.createElement('div');
        main.className = 'configure-env-candidate-main';
        const head = document.createElement('div');
        head.className = 'configure-env-candidate-head';
        const name = document.createElement('span');
        name.className = 'configure-env-candidate-name';
        name.textContent = basenameFromPath(item.path);
        const badge = document.createElement('span');
        badge.className = 'configure-env-candidate-badge ' + (item.verified ? 'is-verified' : 'is-unverified');
        badge.textContent = item.verified
            ? (locale.detectEnvironmentCandidateVerified || 'verified')
            : (locale.detectEnvironmentCandidateUnverified || 'unverified');
        const tag = document.createElement('span');
        tag.className = 'configure-env-candidate-tag';
        tag.textContent = item.source || '';
        head.appendChild(name);
        head.appendChild(badge);
        if (item.source) head.appendChild(tag);
        const pathEl = document.createElement('div');
        pathEl.className = 'configure-env-candidate-path';
        pathEl.textContent = item.path || '';
        main.appendChild(head);
        main.appendChild(pathEl);
        if (item.version) {
            const versionEl = document.createElement('div');
            versionEl.className = 'configure-env-candidate-version';
            versionEl.textContent = item.version;
            main.appendChild(versionEl);
        }
        body.appendChild(icon);
        body.appendChild(main);
        body.addEventListener('click', function() {
            selectConfigureEnvCandidate(item.path || '', li);
        });

        const actions = document.createElement('div');
        actions.className = 'configure-env-candidate-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'configure-env-candidate-open';
        openBtn.title = locale.configureEnvironmentOpenDirectory || 'Open folder';
        openBtn.setAttribute('aria-label', openBtn.title);
        openBtn.appendChild(createConfigureEnvFolderIcon());
        openBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!item.path) return;
            post({
                type: 'configureEnvironmentOpenDirectory',
                path: item.path,
            });
        });

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'configure-env-candidate-select';
        selectBtn.setAttribute('aria-label', locale.configureEnvironmentSelectCandidate || 'Select');
        selectBtn.textContent = '✓';
        selectBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            selectConfigureEnvCandidate(item.path || '', li);
        });

        actions.appendChild(openBtn);
        actions.appendChild(selectBtn);

        li.appendChild(body);
        li.appendChild(actions);
        configureEnvCandidatesList.appendChild(li);
    });
}

export function finishConfigureEnvDetect(msg) {
    setConfigureEnvDetecting(false);
    if (msg.status === 'cancelled' || !state.configureEnvDetectPanelVisible) {
        hideConfigureEnvDetectProgress();
        return;
    }
    state.configureEnvDetectFinished = true;
    setConfigureEnvDetectDetailsTitle();
    const summaryStatus = msg.status === 'ready' ? 'ok' : (msg.executables && msg.executables.length ? 'ok' : 'fail');
    updateConfigureEnvDetectProgress({
        step: 'summary',
        status: summaryStatus,
        reportStatus: msg.status,
        brief: '100%',
        detail: msg.summary,
    });
    renderConfigureEnvCandidates(msg.executables || []);
}

function startConfigureEnvDetect() {
    if (!configureEnvDetectBtn || configureEnvDetectBtn.disabled) return;
    if (configureEnvCandidatesSection) {
        configureEnvCandidatesSection.hidden = true;
        configureEnvCandidatesSection.classList.remove('is-visible');
    }
    if (configureEnvCandidatesList) configureEnvCandidatesList.textContent = '';
    if (configureEnvCandidatesEmpty) configureEnvCandidatesEmpty.hidden = true;
    state.configureEnvSelectedPath = configureEnvPathInput ? configureEnvPathInput.value.trim() : '';
    setConfigureEnvDetecting(true);
    initConfigureEnvDetectStart();
    post({
        type: 'configureEnvironmentDetect',
        currentPath: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
    });
}

function saveConfigureEnvPath() {
    if (!configureEnvSaveBtn || configureEnvSaveBtn.disabled) return;
    post({
        type: 'configureEnvironmentSave',
        path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
    });
}

function browseConfigureEnvPath() {
    if (!configureEnvBrowseBtn || configureEnvBrowseBtn.disabled) return;
    post({ type: 'configureEnvironmentBrowse' });
}

function requestConfigureEnvSystemPath() {
    if (!configureEnvSystemBtn || configureEnvSystemBtn.disabled) return;
    post({
        type: 'configureEnvironmentSystem',
        path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
    });
}

export function initConfigureEnvBrowseBtnClick(): void {
    if (configureEnvBrowseBtn) {
        configureEnvBrowseBtn.addEventListener('click', browseConfigureEnvPath);
    }
}

export function initConfigureEnvDetectBtnClick(): void {
    if (configureEnvDetectBtn) {
        configureEnvDetectBtn.addEventListener('click', startConfigureEnvDetect);
    }
}

export function initConfigureEnvDetectCloseClick(): void {
    if (configureEnvDetectClose) {
        configureEnvDetectClose.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeConfigureEnvDetectPanel();
        });
    }
}

export function initConfigureEnvPathClearBtnClick(): void {
    if (configureEnvPathClearBtn) {
        configureEnvPathClearBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            clearConfigureEnvPath();
        });
    }
}

export function initConfigureEnvPathInputInput(): void {
    if (configureEnvPathInput) {
        configureEnvPathInput.addEventListener('input', function() {
            state.configureEnvSelectedPath = configureEnvPathInput.value.trim();
            updateConfigureEnvPathClearVisibility();
        });
    }
}

export function initConfigureEnvDetectToggleClick(): void {
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setConfigureEnvDetectDetailsOpen(!state.configureEnvDetectDetailsOpen);
        });
    }
}

export function initConfigureEnvSaveBtnClick(): void {
    if (configureEnvSaveBtn) {
        configureEnvSaveBtn.addEventListener('click', saveConfigureEnvPath);
    }
}

export function initConfigureEnvCancelBtnClick(): void {
    if (configureEnvCancelBtn) {
        configureEnvCancelBtn.addEventListener('click', closeConfigureEnvModal);
    }
}

export function initConfigureEnvCloseBtnClick(): void {
    if (configureEnvCloseBtn) {
        configureEnvCloseBtn.addEventListener('click', closeConfigureEnvModal);
    }
}

export function initConfigureEnvSystemBtnClick(): void {
    if (configureEnvSystemBtn) {
        configureEnvSystemBtn.addEventListener('click', requestConfigureEnvSystemPath);
    }
}

export function initConfigureEnvModalClick(): void {
    if (configureEnvModal) {
        configureEnvModal.addEventListener('click', function(e) {
            if (e.target === configureEnvModal) {
                closeConfigureEnvModal();
            }
        });
    }
}
