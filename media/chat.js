(function() {
    const vscode = acquireVsCodeApi();
    /** Report one line to the extension host's output channel (no devtools needed). */
    function hostLog(line) {
        try {
            vscode.postMessage({ type: 'webviewLog', line: String(line) });
        } catch (err) {
            /* ignore */
        }
    }
    const messagesEl = document.getElementById('messages');
    const chatBodyEl = document.getElementById('chat-body');
    const inputEl = document.getElementById('input');
    const inputAreaEl = document.getElementById('input-area');
    const inputCompositeEl = document.getElementById('inputComposite');
    const inputCompositeShellEl = inputCompositeEl ? inputCompositeEl.closest('.input-composite-shell') : null;
    const inputResizeHandle = document.getElementById('inputResizeHandle');
    const sendBtn = document.getElementById('sendBtn');
    const tokenUsageRing = document.getElementById('tokenUsageRing');
    const tokenUsageArc = document.getElementById('tokenUsageArc');
    const tokenUsagePct = document.getElementById('tokenUsagePct');
    const TOKEN_RING_RADIUS = 11;
    const TOKEN_RING_CIRCUMFERENCE = 2 * Math.PI * TOKEN_RING_RADIUS;
    const clearInputBtn = document.getElementById('clearInputBtn');
    const copySessionBtn = document.getElementById('copySessionBtn');
    const quickToggleBtn = document.getElementById('quickToggleBtn');
    const inputQuickPanel = document.getElementById('inputQuickPanel');
    const chatSearchInput = document.getElementById('chatSearchInput');
    const chatSearchCount = document.getElementById('chatSearchCount');
    const chatSearchPrev = document.getElementById('chatSearchPrev');
    const chatSearchNext = document.getElementById('chatSearchNext');
    const openTabBtn = document.getElementById('openTabBtn');
    const closedPicker = document.getElementById('closedPicker');
    const closedPickerBtn = document.getElementById('closedPickerBtn');
    const closedDropdown = document.getElementById('closedDropdown');
    const closedList = document.getElementById('closedList');
    const closedPickerLabel = document.getElementById('closedPickerLabel');
    const replyQuoteEl = document.getElementById('replyQuote');
    const replyQuoteTitle = document.getElementById('replyQuoteTitle');
    const replyQuoteToggle = document.getElementById('replyQuoteToggle');
    const replyQuoteClear = document.getElementById('replyQuoteClear');
    const replyQuoteBody = document.getElementById('replyQuoteBody');
    const composerHint = document.getElementById('composerHint');
    const undeliveredNotice = document.getElementById('undeliveredNotice');
    const undeliveredNoticeText = document.getElementById('undeliveredNoticeText');
    const undeliveredPrimaryBtn = document.getElementById('undeliveredPrimaryBtn');
    const undeliveredDiscardBtn = document.getElementById('undeliveredDiscardBtn');
    /** The message the provider says Hermes never received, held until the user decides. */
    let undeliveredText = '';
    /** True when the notice itself put the text in the composer and could clear it again. */
    let undeliveredFilledComposer = false;
    /** The quote the user assembled from a selection, and the floating action that makes one. */
    let replyQuote = null;
    let quoteActionEl = null;
    let composerHintTimer = null;
    /** null = "new session"; a string = the closed session the user picked. */
    let pendingOpenSessionId = null;
    /** Title/count of the pending pick, so the toolbar can show what Open Tab will open. */
    let pendingOpenTitle = '';
    let pendingOpenCount = 0;
    const multiSelectToolbar = document.getElementById('multiSelectToolbar');
    const multiSelectCount = document.getElementById('multiSelectCount');
    const multiSelectAllBtn = document.getElementById('multiSelectAllBtn');
    const multiSelectDeleteBtn = document.getElementById('multiSelectDeleteBtn');
    const multiSelectCopyBtn = document.getElementById('multiSelectCopyBtn');
    const multiSelectExportBtn = document.getElementById('multiSelectExportBtn');
    const multiSelectAttachConfirmBtn = document.getElementById('multiSelectAttachConfirmBtn');
    const multiSelectExitBtn = document.getElementById('multiSelectExitBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    let placeholder = document.getElementById('placeholder');
    let lastSessions = [];
    let lastActiveSessionId = '';
    let sessionMsgCounter = 0;
    let multiSelectMode = false;
    let multiSelectPurpose = 'normal';
    let sessionRenderJobId = 0;
    /** True while messages are still waiting to be converted from raw text to markdown. */
    let sessionMarkdownPending = false;
    const SESSION_RENDER_BANNER_ID = 'sessionRenderBanner';
    const RESTORE_BATCH_SIZE = 30;
    const MARKDOWN_RENDER_BATCH_SIZE = 4;

    function setConnectingPlaceholder() {
        if (!placeholder) return;
        placeholder.className = 'placeholder';
        placeholder.textContent = '';
        placeholder.appendChild(document.createTextNode(locale.connectingTitle || ''));
        placeholder.appendChild(document.createElement('br'));
        const hint = document.createElement('span');
        hint.style.fontSize = '11px';
        hint.style.opacity = '0.6';
        hint.textContent = locale.connectingHint || '';
        placeholder.appendChild(hint);
    }

    const DETECT_STEP_IDS = [
        'config', 'path_lookup', 'known_path', 'pip', 'python_import', 'hermes_home', 'verify', 'acp_check', 'acp_install', 'summary',
    ];
    const DETECT_STEP_LOCALE_KEYS = {
        config: 'detectEnvironmentStepConfig',
        path_lookup: 'detectEnvironmentStepPath',
        known_path: 'detectEnvironmentStepKnownPath',
        pip: 'detectEnvironmentStepPip',
        python_import: 'detectEnvironmentStepPython',
        hermes_home: 'detectEnvironmentStepHermesHome',
        verify: 'detectEnvironmentStepVerify',
        acp_check: 'detectEnvironmentStepAcpCheck',
        acp_install: 'detectEnvironmentStepAcpInstall',
        summary: 'detectEnvironmentStepSummary',
    };

    let detectEnvDetailsOpen = false;
    let detectEnvPanelReady = false;
    let detectEnvFinished = false;

    function detectStepLabel(stepId) {
        const key = DETECT_STEP_LOCALE_KEYS[stepId];
        return key ? (locale[key] || stepId) : stepId;
    }

    function formatDetectStepDetail(msg) {
        if (msg.status === 'running') return '…';
        if (msg.status === 'skip') return locale.detectEnvironmentStepSkipped || 'Skipped';
        if (msg.step === 'verify') {
            return localeText(
                'detectEnvironmentStepVerifyCount',
                msg.verifiedCount != null ? msg.verifiedCount : 0,
                msg.totalCount != null ? msg.totalCount : 0,
            );
        }
        if (msg.step === 'acp_check') {
            if (msg.status === 'ok') return msg.detail || locale.detectEnvironmentStepAcpOk || '';
            if (msg.status === 'fail') return msg.detail || locale.detectEnvironmentStepAcpFail || '';
        }
        if (msg.step === 'acp_install') {
            if (msg.status === 'ok') return msg.detail || locale.detectEnvironmentStepAcpInstallOk || '';
            if (msg.status === 'fail') return msg.detail || locale.detectEnvironmentStepAcpInstallFail || '';
        }
        if (msg.step === 'summary') {
            if (msg.detail) return msg.detail;
            if (msg.reportStatus === 'ready') return locale.detectEnvironmentSummaryReady || '';
            if (msg.reportStatus === 'broken') return locale.detectEnvironmentSummaryBroken || '';
            return locale.detectEnvironmentSummaryInstall || locale.detectEnvironmentSummaryNotFound || '';
        }
        if (msg.count > 0) {
            const summary = localeText('detectEnvironmentStepFoundCount', msg.count);
            if (msg.detail) return summary + '\n' + msg.detail;
            return summary;
        }
        if (msg.status === 'fail' && msg.detail) return msg.detail;
        return locale.detectEnvironmentStepNotFound || 'Not found';
    }

    function setDetectEnvIcon(el, status) {
        if (!el) return;
        const keepStep = el.classList.contains('detect-env-step-icon');
        el.className = (keepStep ? 'detect-env-step-icon ' : '') + 'detect-env-icon ' + (status || 'running');
        el.textContent = '';
    }

    function formatDetectProgressDisplay(brief) {
        if (!brief) return '';
        return localeText('detectEnvironmentProgressPrefix', brief);
    }

    function setDetectEnvDetailsTitle() {
        const detailsTitle = document.getElementById('detectEnvDetailsTitle');
        if (!detailsTitle) return;
        detailsTitle.textContent = detectEnvFinished
            ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
            : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
    }

    function setDetectEnvDetailsOpen(open) {
        detectEnvDetailsOpen = !!open;
        const details = document.getElementById('detectEnvDetails');
        const hint = document.getElementById('detectEnvCompactHint');
        const toggle = document.getElementById('detectEnvToggle');
        if (details) details.hidden = !detectEnvDetailsOpen;
        if (hint) hint.classList.toggle('is-open', detectEnvDetailsOpen);
        if (toggle) {
            toggle.setAttribute('aria-expanded', detectEnvDetailsOpen ? 'true' : 'false');
            toggle.title = detectEnvDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
    }

    function buildDetectStepRow(stepId, rowId) {
        const li = document.createElement('li');
        li.className = 'detect-env-step';
        li.id = rowId;
        li.style.display = 'none';
        const stepIcon = document.createElement('span');
        stepIcon.className = 'detect-env-step-icon detect-env-icon running';
        const body = document.createElement('div');
        body.className = 'detect-env-step-body';
        const label = document.createElement('div');
        label.className = 'detect-env-step-label';
        label.textContent = detectStepLabel(stepId);
        const detail = document.createElement('div');
        detail.className = 'detect-env-step-detail';
        body.appendChild(label);
        body.appendChild(detail);
        li.appendChild(stepIcon);
        li.appendChild(body);
        return li;
    }

    function ensureDetectStepsList(listEl, stepIdPrefix) {
        if (!listEl || listEl.dataset.ready === '1') {
            return;
        }
        listEl.textContent = '';
        DETECT_STEP_IDS.forEach(function(stepId) {
            listEl.appendChild(buildDetectStepRow(stepId, stepIdPrefix + stepId));
        });
        listEl.dataset.ready = '1';
    }

    function refreshDetectStepLabels(listEl, stepIdPrefix) {
        if (!listEl) return;
        DETECT_STEP_IDS.forEach(function(stepId) {
            const label = listEl.querySelector('#' + stepIdPrefix + stepId + ' .detect-env-step-label');
            if (label) label.textContent = detectStepLabel(stepId);
        });
    }

    function resetDetectStepsList(stepIdPrefix) {
        DETECT_STEP_IDS.forEach(function(stepId) {
            const row = document.getElementById(stepIdPrefix + stepId);
            if (!row) return;
            row.style.display = 'none';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = '';
        });
    }

    function updateDetectStepsList(msg, stepIdPrefix, compactIconEl, compactTextEl) {
        const row = document.getElementById(stepIdPrefix + msg.step);
        if (row) {
            row.style.display = '';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), msg.status || 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = formatDetectStepDetail(msg);
        }
        if (compactIconEl && compactTextEl && msg.brief) {
            setDetectEnvIcon(compactIconEl, msg.status || 'running');
            const text = formatDetectProgressDisplay(msg.brief);
            compactTextEl.textContent = text;
            compactTextEl.title = text;
        }
    }

    function ensureDetectEnvironmentPanel() {
        const list = document.getElementById('detectEnvSteps');
        ensureDetectStepsList(list, 'detectStep-');
        if (!detectEnvPanelReady && list) {
            detectEnvPanelReady = true;
        }
    }

    function showDetectEnvironmentBar() {
        ensureDetectEnvironmentPanel();
        const bar = document.getElementById('detectEnvBar');
        if (bar) bar.hidden = false;
    }

    function hideDetectEnvironmentBar() {
        detectEnvFinished = false;
        setDetectEnvDetailsOpen(false);
        const bar = document.getElementById('detectEnvBar');
        if (bar) bar.hidden = true;
    }

    function setDetectEnvironmentCompact(brief, status) {
        setDetectEnvIcon(document.getElementById('detectEnvCompactIcon'), status);
        const textEl = document.getElementById('detectEnvCompactText');
        if (textEl) {
            textEl.textContent = brief || '';
            textEl.title = brief || '';
        }
    }

    function updateDetectEnvironmentStep(msg) {
        ensureDetectEnvironmentPanel();
        updateDetectStepsList(
            msg,
            'detectStep-',
            document.getElementById('detectEnvCompactIcon'),
            document.getElementById('detectEnvCompactText'),
        );
    }

    function initDetectEnvironmentStart(mode) {
        detectEnvFinished = false;
        showDetectEnvironmentBar();
        setDetectEnvDetailsOpen(false);
        setDetectEnvDetailsTitle();
        const toggle = document.getElementById('detectEnvToggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
            toggle.title = locale.detectEnvironmentViewDetails || '';
        }
        DETECT_STEP_IDS.forEach(function(stepId) {
            const row = document.getElementById('detectStep-' + stepId);
            if (!row) return;
            row.style.display = 'none';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = '';
        });
        setDetectEnvironmentCompact(
            formatDetectProgressDisplay('0%'),
            'running',
        );
    }

    function finishDetectEnvironmentPanel(msg) {
        detectEnvFinished = true;
        setDetectEnvDetailsTitle();
        const summaryMsg = {
            step: 'summary',
            status: msg.summaryStatus || (msg.status === 'ready' ? 'ok' : 'fail'),
            reportStatus: msg.status,
            brief: msg.brief,
        };
        updateDetectEnvironmentStep(summaryMsg);
        setDetectEnvironmentCompact(formatDetectProgressDisplay(msg.brief || '100%'), summaryMsg.status);
    }

    const configureEnvModal = document.getElementById('configureEnvModal');
    const configureEnvPathInput = document.getElementById('configureEnvPathInput');
    const configureEnvPathClearBtn = document.getElementById('configureEnvPathClearBtn');
    const configureEnvBrowseBtn = document.getElementById('configureEnvBrowseBtn');
    const configureEnvDetectBtn = document.getElementById('configureEnvDetectBtn');
    const configureEnvDetectSection = document.getElementById('configureEnvDetectSection');
    const configureEnvDetectCompactIcon = document.getElementById('configureEnvDetectCompactIcon');
    const configureEnvDetectCompactText = document.getElementById('configureEnvDetectCompactText');
    const configureEnvDetectCompactHint = document.getElementById('configureEnvDetectCompactHint');
    const configureEnvDetectToggle = document.getElementById('configureEnvDetectToggle');
    const configureEnvDetectClose = document.getElementById('configureEnvDetectClose');
    const configureEnvDetectDetails = document.getElementById('configureEnvDetectDetails');
    const configureEnvDetectDetailsTitle = document.getElementById('configureEnvDetectDetailsTitle');
    const configureEnvDetectSteps = document.getElementById('configureEnvDetectSteps');
    const configureEnvCandidatesSection = document.getElementById('configureEnvCandidatesSection');
    const configureEnvCandidatesList = document.getElementById('configureEnvCandidatesList');
    const configureEnvCandidatesEmpty = document.getElementById('configureEnvCandidatesEmpty');
    const configureEnvSaveBtn = document.getElementById('configureEnvSaveBtn');
    const configureEnvCancelBtn = document.getElementById('configureEnvCancelBtn');
    const configureEnvSystemBtn = document.getElementById('configureEnvSystemBtn');
    const configureEnvSystemHint = document.getElementById('configureEnvSystemHint');
    const configureEnvCloseBtn = document.getElementById('configureEnvCloseBtn');
    let configureEnvSelectedPath = '';
    let configureEnvDetectFinished = false;
    let configureEnvDetectDetailsOpen = false;
    let configureEnvDetectPanelVisible = false;
    let configureEnvSystemVar = 'PATH';
    let configureEnvSystemTarget = '';

    function showConfigureEnvDetectPanel() {
        configureEnvDetectPanelVisible = true;
        if (configureEnvDetectSection) configureEnvDetectSection.hidden = false;
    }

    function updateConfigureEnvPathClearVisibility() {
        if (!configureEnvPathClearBtn || !configureEnvPathInput) return;
        const hasValue = !!configureEnvPathInput.value.trim();
        configureEnvPathClearBtn.hidden = !hasValue;
    }

    function clearConfigureEnvPath() {
        if (!configureEnvPathInput) return;
        configureEnvPathInput.value = '';
        configureEnvSelectedPath = '';
        updateConfigureEnvPathClearVisibility();
        if (configureEnvCandidatesList) {
            configureEnvCandidatesList.querySelectorAll('.configure-env-candidate-row').forEach(function(el) {
                el.classList.remove('is-selected');
            });
        }
        configureEnvPathInput.focus();
    }

    function hideConfigureEnvDetectProgress() {
        configureEnvDetectPanelVisible = false;
        configureEnvDetectFinished = false;
        configureEnvDetectDetailsOpen = false;
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
        const wasVisible = configureEnvDetectPanelVisible;
        hideConfigureEnvDetectProgress();
        if (wasVisible) {
            setConfigureEnvDetecting(false);
            vscode.postMessage({ type: 'configureEnvironmentDetectClose' });
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

    function setConfigureEnvDetectDetailsOpen(open) {
        configureEnvDetectDetailsOpen = !!open;
        if (configureEnvDetectDetails) configureEnvDetectDetails.hidden = !configureEnvDetectDetailsOpen;
        if (configureEnvDetectCompactHint) {
            configureEnvDetectCompactHint.classList.toggle('is-open', configureEnvDetectDetailsOpen);
        }
        if (configureEnvDetectToggle) {
            configureEnvDetectToggle.setAttribute('aria-expanded', configureEnvDetectDetailsOpen ? 'true' : 'false');
            configureEnvDetectToggle.title = configureEnvDetectDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
    }

    function setConfigureEnvDetectDetailsTitle() {
        if (!configureEnvDetectDetailsTitle) return;
        configureEnvDetectDetailsTitle.textContent = configureEnvDetectFinished
            ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
            : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
    }

    function updateConfigureEnvSystemHint() {
        if (!configureEnvSystemHint) return;
        const hint = localeText(
            'configureEnvironmentSystemVarHint',
            configureEnvSystemVar || 'PATH',
            configureEnvSystemTarget || '',
        );
        configureEnvSystemHint.innerHTML = hint.replace(
            configureEnvSystemVar,
            '<code>' + escapeHtml(configureEnvSystemVar) + '</code>',
        );
        if (configureEnvSystemBtn) {
            configureEnvSystemBtn.title = localeText(
                'detectEnvironmentConfigureSystemDesc',
                configureEnvSystemVar || 'PATH',
                configureEnvSystemTarget || '',
            );
        }
    }

    function setConfigureEnvDetecting(detecting) {
        if (configureEnvBrowseBtn) configureEnvBrowseBtn.disabled = !!detecting;
        if (configureEnvDetectBtn) configureEnvDetectBtn.disabled = !!detecting;
        if (configureEnvSaveBtn) configureEnvSaveBtn.disabled = !!detecting;
        if (configureEnvSystemBtn) configureEnvSystemBtn.disabled = !!detecting;
    }

    function resetConfigureEnvDetectPanel() {
        hideConfigureEnvDetectPanel();
        configureEnvSelectedPath = '';
    }

    function openConfigureEnvModal(currentPath, systemEnvVar, systemEnvTarget) {
        if (!configureEnvModal) return;
        configureEnvSystemVar = systemEnvVar || 'PATH';
        configureEnvSystemTarget = systemEnvTarget || '';
        updateConfigureEnvSystemHint();
        resetConfigureEnvDetectPanel();
        if (configureEnvPathInput) configureEnvPathInput.value = currentPath || '';
        updateConfigureEnvPathClearVisibility();
        configureEnvModal.classList.add('is-open');
        if (configureEnvPathInput) configureEnvPathInput.focus();
    }

    function closeConfigureEnvModal() {
        if (!configureEnvModal) return;
        configureEnvModal.classList.remove('is-open');
        resetConfigureEnvDetectPanel();
    }

    function initConfigureEnvDetectStart() {
        configureEnvDetectFinished = false;
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

    function updateConfigureEnvDetectProgress(msg) {
        if (!configureEnvDetectSection || !configureEnvDetectPanelVisible) return;
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
        configureEnvSelectedPath = path || '';
        if (configureEnvPathInput) {
            configureEnvPathInput.value = configureEnvSelectedPath;
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
            if (item.path === configureEnvSelectedPath) {
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
                vscode.postMessage({
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

    function finishConfigureEnvDetect(msg) {
        setConfigureEnvDetecting(false);
        if (msg.status === 'cancelled' || !configureEnvDetectPanelVisible) {
            hideConfigureEnvDetectProgress();
            return;
        }
        configureEnvDetectFinished = true;
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
        configureEnvSelectedPath = configureEnvPathInput ? configureEnvPathInput.value.trim() : '';
        setConfigureEnvDetecting(true);
        initConfigureEnvDetectStart();
        vscode.postMessage({
            type: 'configureEnvironmentDetect',
            currentPath: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function saveConfigureEnvPath() {
        if (!configureEnvSaveBtn || configureEnvSaveBtn.disabled) return;
        vscode.postMessage({
            type: 'configureEnvironmentSave',
            path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function browseConfigureEnvPath() {
        if (!configureEnvBrowseBtn || configureEnvBrowseBtn.disabled) return;
        vscode.postMessage({ type: 'configureEnvironmentBrowse' });
    }

    function requestConfigureEnvSystemPath() {
        if (!configureEnvSystemBtn || configureEnvSystemBtn.disabled) return;
        vscode.postMessage({
            type: 'configureEnvironmentSystem',
            path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function buildFaqAccordion(container) {
        if (!container || container.querySelector('.faq-list')) {
            return;
        }
        const nodes = Array.from(container.childNodes);
        const wrapper = document.createElement('div');
        wrapper.className = 'faq-list';
        let i = 0;
        while (i < nodes.length) {
            const node = nodes[i];
            if (node.nodeType === 1 && node.tagName === 'H3') {
                const details = document.createElement('details');
                details.className = 'faq-item';
                if (wrapper.childElementCount === 0) {
                    details.open = true;
                }
                const summary = document.createElement('summary');
                summary.className = 'faq-summary';
                summary.textContent = node.textContent;
                const body = document.createElement('div');
                body.className = 'faq-body';
                i += 1;
                while (i < nodes.length && !(nodes[i].nodeType === 1 && nodes[i].tagName === 'H3')) {
                    body.appendChild(nodes[i]);
                    i += 1;
                }
                details.appendChild(summary);
                details.appendChild(body);
                wrapper.appendChild(details);
            } else if (node.nodeType === 3 && !node.textContent.trim()) {
                i += 1;
            } else {
                i += 1;
            }
        }
        if (wrapper.childElementCount > 0) {
            container.textContent = '';
            container.appendChild(wrapper);
        }
    }

    function applyLocale() {
        const toolbarStatus = document.getElementById('toolbarStatus');
        const retryBtnEl = document.getElementById('retryBtn');
        const profileBtnEl = document.getElementById('profileBtn');
        const modelBtnEl = document.getElementById('modelBtn');
        const cancelBtnEl = document.getElementById('cancelBtn');
        const filePickerElLocal = document.getElementById('filePicker');

        if (toolbarStatus) toolbarStatus.title = locale.connectionStatus;
        if (retryBtnEl) retryBtnEl.title = locale.retry;
        const detectEnvBtnEl = document.getElementById('detectEnvBtn');
        if (detectEnvBtnEl) {
            detectEnvBtnEl.textContent = locale.detectEnvironment || '';
            detectEnvBtnEl.title = locale.detectEnvironment || '';
        }
        const profileLabelText = document.getElementById('profileLabelText');
        if (profileLabelText) profileLabelText.textContent = locale.profile;
        if (profileBtnEl) profileBtnEl.title = locale.switchProfile;
        const profilesHeader = document.getElementById('profilesHeader');
        if (profilesHeader) profilesHeader.textContent = locale.profiles;
        if (modelBtnEl) modelBtnEl.title = locale.switchModel;
        const modelsHeader = document.getElementById('modelsHeader');
        if (modelsHeader) modelsHeader.textContent = locale.models;
        updateModelButtonDisplay(lastModelPayload);
        if (contextAttachHeaderLead) contextAttachHeaderLead.textContent = locale.contextAttachHeaderLead || '';
        if (contextAttachHeaderRest) contextAttachHeaderRest.textContent = locale.contextAttachHeaderRest || '';
        if (contextAttachHelp) {
            const tip = locale.contextAttachTooltip || '';
            contextAttachHelp.title = tip;
            contextAttachHelp.setAttribute('aria-label', tip);
        }
        if (contextAttachTooltipEl) {
            contextAttachTooltipEl.textContent = locale.contextAttachTooltip || '';
        }
        const contextAttachSendTitle = document.getElementById('contextAttachSendModalTitle');
        const contextAttachSendBody = document.getElementById('contextAttachSendModalBody');
        const contextAttachSendYesBtn = document.getElementById('contextAttachSendYesBtn');
        const contextAttachSendNoBtn = document.getElementById('contextAttachSendNoBtn');
        if (contextAttachSendTitle) contextAttachSendTitle.textContent = locale.contextAttachCustom || '';
        if (contextAttachSendBody) contextAttachSendBody.textContent = locale.contextAttachSendPrompt || '';
        if (contextAttachSendYesBtn) contextAttachSendYesBtn.textContent = locale.contextAttachSendYes || '';
        if (contextAttachSendNoBtn) contextAttachSendNoBtn.textContent = locale.contextAttachSendNo || '';
        if (multiSelectAttachConfirmBtn) multiSelectAttachConfirmBtn.textContent = locale.contextAttachConfirm || '';
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
        const openTabLabelFull = document.getElementById('openTabLabelFull');
        if (openTabLabelFull) openTabLabelFull.textContent = locale.openTab;
        if (openTabBtn) openTabBtn.title = locale.openTab;
        if (closedPickerBtn) closedPickerBtn.title = locale.chooseChat;
        const closedPickerLabelEl = document.getElementById('closedPickerLabel');
        if (closedPickerLabelEl && !pendingOpenSessionId) {
            closedPickerLabelEl.textContent = locale.chooseChat;
        }
        const detectEnvClose = document.getElementById('detectEnvClose');
        if (detectEnvClose) {
            detectEnvClose.title = locale.detectEnvironmentClose || '';
            detectEnvClose.setAttribute('aria-label', locale.detectEnvironmentClose || 'Close');
        }
        if (detectEnvPanelReady) {
            setDetectEnvDetailsTitle();
            const toggle = document.getElementById('detectEnvToggle');
            if (toggle) {
                toggle.title = detectEnvDetailsOpen
                    ? (locale.detectEnvironmentHideDetails || '')
                    : (locale.detectEnvironmentViewDetails || '');
            }
            const hint = document.getElementById('detectEnvCompactHint');
            if (hint) hint.classList.toggle('is-open', detectEnvDetailsOpen);
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
        const stopBtnLabel = document.getElementById('stopBtnLabel');
        if (stopBtnLabel) stopBtnLabel.textContent = locale.stop;
        if (cancelBtnEl) {
            cancelBtnEl.title = locale.cancelResponse;
            cancelBtnEl.setAttribute('aria-label', locale.cancelResponse);
        }
        const logModalTitle = document.getElementById('logModalTitle');
        if (logModalTitle) logModalTitle.textContent = locale.hermesLogs;
        const renderBannerText = document.querySelector('#' + SESSION_RENDER_BANNER_ID + ' .session-render-text');
        if (renderBannerText) renderBannerText.textContent = locale.sessionRendering || '';
        const copyLogBtn = document.getElementById('copyLogBtn');
        if (copyLogBtn) copyLogBtn.textContent = locale.copy;
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) clearLogBtn.textContent = locale.clear;
        const aboutModalTitle = document.getElementById('aboutModalTitle');
        if (aboutModalTitle) aboutModalTitle.textContent = locale.aboutTitle;
        const helpModalTitle = document.getElementById('helpModalTitle');
        if (helpModalTitle) helpModalTitle.textContent = locale.helpTitle;
        const helpModalBody = document.getElementById('helpModalBody');
        if (helpModalBody) helpModalBody.innerHTML = locale.helpHtml;
        const faqModalTitle = document.getElementById('faqModalTitle');
        if (faqModalTitle) faqModalTitle.textContent = locale.faqTitle;
        const faqModalBody = document.getElementById('faqModalBody');
        if (faqModalBody) {
            faqModalBody.innerHTML = locale.faqHtml || '';
            buildFaqAccordion(faqModalBody);
        }
        const configureEnvModalTitle = document.getElementById('configureEnvModalTitle');
        if (configureEnvModalTitle) configureEnvModalTitle.textContent = locale.configureEnvironmentTitle || '';
        const configureEnvPathLabel = document.getElementById('configureEnvPathLabel');
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
        const configureEnvCandidatesTitle = document.getElementById('configureEnvCandidatesTitle');
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
            configureEnvDetectToggle.title = configureEnvDetectDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
        if (statusText) statusText.textContent = locale.statusDisconnected;
        pendingPermissions.forEach(function(group) {
            const labelEl = group.querySelector('.permission-label');
            if (labelEl) labelEl.textContent = locale.permissionTitle || 'Permission required';
            refreshPermissionOptionLabels(group);
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

    const INPUT_HEIGHT_STORAGE_KEY = 'hermes-chat-input-max-height';
    const INPUT_HEIGHT_MIN = 36;
    const INPUT_HEIGHT_DEFAULT = 120;

    function getChatRegionHeight() {
        const chatH = chatBodyEl ? chatBodyEl.clientHeight : 0;
        const inputH = inputAreaEl ? inputAreaEl.clientHeight : 0;
        const region = chatH + inputH;
        if (region > 0) {
            return region;
        }
        return Math.max(window.innerHeight - 120, INPUT_HEIGHT_MIN);
    }

    function getInputHeightCeiling() {
        return Math.max(INPUT_HEIGHT_MIN, Math.floor(getChatRegionHeight() * 0.6));
    }

    function getInputMaxHeight() {
        const raw = getComputedStyle(inputAreaEl).getPropertyValue('--input-max-height').trim();
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v >= INPUT_HEIGHT_MIN) {
            return v;
        }
        return INPUT_HEIGHT_DEFAULT;
    }

    function getEffectiveInputMaxHeight() {
        return Math.min(getInputMaxHeight(), getInputHeightCeiling());
    }

    function syncInputHeightFromContent() {
        const max = getEffectiveInputMaxHeight();
        inputEl.style.height = 'auto';
        const next = Math.min(inputEl.scrollHeight, max);
        inputEl.style.height = next + 'px';
        inputEl.style.overflowY = inputEl.scrollHeight > max ? 'auto' : 'hidden';
    }

    function setInputMaxHeight(px, options) {
        const opts = options || {};
        const clamped = Math.max(INPUT_HEIGHT_MIN, Math.min(px, getInputHeightCeiling()));
        inputAreaEl.style.setProperty('--input-max-height', clamped + 'px');
        if (opts.explicit) {
            inputEl.style.height = clamped + 'px';
        } else {
            syncInputHeightFromContent();
        }
        if (opts.persist !== false) {
            try { localStorage.setItem(INPUT_HEIGHT_STORAGE_KEY, String(clamped)); } catch (_) {}
        }
        return clamped;
    }

    (function initInputHeight() {
        let saved = INPUT_HEIGHT_DEFAULT;
        try {
            const raw = localStorage.getItem(INPUT_HEIGHT_STORAGE_KEY);
            if (raw) saved = parseInt(raw, 10);
        } catch (_) {}
        if (isNaN(saved)) saved = INPUT_HEIGHT_DEFAULT;
        setInputMaxHeight(saved, { persist: false, explicit: false });
    })();

    (function setupInputResize() {
        if (!inputResizeHandle) return;
        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            inputResizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try { inputResizeHandle.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        inputResizeHandle.addEventListener('pointerdown', function(e) {
            if (e.button !== 0) return;
            dragging = true;
            startY = e.clientY;
            startHeight = inputEl.offsetHeight;
            inputResizeHandle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            inputResizeHandle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        inputResizeHandle.addEventListener('pointermove', function(e) {
            if (!dragging) return;
            setInputMaxHeight(startHeight + (startY - e.clientY), { explicit: true });
        });
        inputResizeHandle.addEventListener('pointerup', endDrag);
        inputResizeHandle.addEventListener('pointercancel', endDrag);
    })();

    window.addEventListener('resize', syncInputHeightFromContent);
    window.addEventListener('scroll', function(e) {
        hideContextAttachTooltip();
        if (contextAttachPreviewOpen && isInsideContextAttachPreview(e.target)) {
            return;
        }
        hideContextAttachPreview();
    }, true);

    let streamingMessageId = null;
    let thoughtMsgId = null;
    let canSend = false;
    let isPrompting = false;
    let pendingSwitchSessionId = null;
    let contextAttachVisible = false;
    let contextAttachMode = 'none';
    let contextAttachCustomIndices = [];
    let contextAttachCustomPending = false;
    let contextAttachCustomConfirmed = false;
    let contextAttachUnconfirmedIndices = [];
    let contextAttachPreviewOpen = false;
    let contextAttachPickerHiding = false;
    let contextAttachHasChoice = false;
    let pendingSendText = '';
    function maybeFocusInputAfterResponse() {
        if (!canSend || inputEl.disabled) {
            return;
        }
        if (!document.hasFocus()) {
            return;
        }
        requestAnimationFrame(function() {
            if (canSend && !inputEl.disabled && document.hasFocus()) {
                inputEl.focus();
            }
        });
    }

    function resetContextAttachPickerElement() {
        if (contextAttachPicker) {
            contextAttachPicker.hidden = true;
            contextAttachPicker.classList.remove('is-hiding', 'is-entering', 'is-attention');
        }
        contextAttachPickerHiding = false;
    }

    function forceHideContextAttachPicker() {
        contextAttachVisible = false;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        pendingSendText = '';
        if (multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        resetContextAttachPickerElement();
        closeAllDropdowns();
    }

    function finishHideContextAttachPicker() {
        contextAttachVisible = false;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        pendingSendText = '';
        if (multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        resetContextAttachPickerElement();
        closeAllDropdowns();
    }

    function hideContextAttachPicker() {
        if (!contextAttachVisible && !contextAttachPickerHiding) {
            return;
        }
        if (contextAttachPickerHiding) {
            return;
        }
        if (!contextAttachPicker || contextAttachPicker.hidden) {
            finishHideContextAttachPicker();
            return;
        }
        contextAttachPickerHiding = true;
        contextAttachPicker.classList.remove('is-entering', 'is-attention');
        contextAttachPicker.classList.add('is-hiding');
        hideContextAttachPreview();
        const onExitEnd = function(e) {
            if (e.target !== contextAttachPicker || e.animationName !== 'context-attach-exit') {
                return;
            }
            contextAttachPicker.removeEventListener('animationend', onExitEnd);
            finishHideContextAttachPicker();
        };
        contextAttachPicker.addEventListener('animationend', onExitEnd);
    }

    function positionContextAttachTooltip() {
        if (!contextAttachHelp || !contextAttachTooltipEl || contextAttachTooltipEl.hidden) {
            return;
        }
        const rect = contextAttachHelp.getBoundingClientRect();
        const tipRect = contextAttachTooltipEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.top - tipRect.height - 10;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        if (top < 8) {
            top = rect.bottom + 10;
        }
        contextAttachTooltipEl.style.left = left + 'px';
        contextAttachTooltipEl.style.top = top + 'px';
    }

    function showContextAttachTooltip() {
        if (!contextAttachHelp || !contextAttachTooltipEl) {
            return;
        }
        contextAttachTooltipEl.textContent = locale.contextAttachTooltip || contextAttachHelp.getAttribute('aria-label') || '';
        contextAttachTooltipEl.hidden = false;
        contextAttachTooltipEl.style.left = '-9999px';
        contextAttachTooltipEl.style.top = '0';
        requestAnimationFrame(function() {
            positionContextAttachTooltip();
        });
    }

    function hideContextAttachTooltip() {
        if (contextAttachTooltipEl) {
            contextAttachTooltipEl.hidden = true;
        }
    }

    function bindContextAttachTooltip() {
        if (!contextAttachHelp) {
            return;
        }
        contextAttachHelp.addEventListener('mouseenter', showContextAttachTooltip);
        contextAttachHelp.addEventListener('mouseleave', hideContextAttachTooltip);
        contextAttachHelp.addEventListener('focus', showContextAttachTooltip);
        contextAttachHelp.addEventListener('blur', hideContextAttachTooltip);
    }

    function getContextAttachRegionGroups() {
        // The prior-session divider is gone from the markup, so every group is attachable.
        return Array.from(messagesEl.querySelectorAll('.message-group'));
    }

    function ensureGroupSelectableForContextAttach(group) {
        if (!isAttachableMemoryGroup(group)) {
            return;
        }
        if (group.classList.contains('selectable')) {
            return;
        }
        group.classList.add('selectable', 'context-attach-extra-selectable');
        const selectWrap = document.createElement('label');
        selectWrap.className = 'msg-select-wrap';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        checkbox.addEventListener('change', function() {
            setGroupSelected(group, checkbox.checked);
        });
        selectWrap.appendChild(checkbox);
        group.insertBefore(selectWrap, group.firstChild);
        wireSelectableGroup(group);
    }

    function ensureContextAttachSelectableTargets() {
        getContextAttachRegionGroups().forEach(ensureGroupSelectableForContextAttach);
    }

    function clearContextAttachSelectableTargets() {
        messagesEl.querySelectorAll('.message-group.context-attach-extra-selectable').forEach(function(group) {
            group.classList.remove('selectable', 'context-attach-extra-selectable', 'is-selected');
            const wrap = group.querySelector('.msg-select-wrap');
            if (wrap) {
                wrap.remove();
            }
            if (group.dataset.contextAttachReveal === '1') {
                group.style.display = 'none';
                delete group.dataset.contextAttachReveal;
            }
        });
    }

    function getExistingCustomAttachIndices() {
        if (contextAttachCustomIndices.length > 0) {
            return contextAttachCustomIndices.slice();
        }
        if (contextAttachUnconfirmedIndices.length > 0) {
            return contextAttachUnconfirmedIndices.slice();
        }
        return [];
    }

    function applyContextAttachIndicesToSelection(indices) {
        if (!indices.length) {
            return;
        }
        const indexSet = new Set(indices);
        const updates = [];
        getContextAttachRegionGroups().forEach(function(group) {
            const idx = parseInt(group.dataset.sessionIndex || '', 10);
            updates.push({
                group: group,
                selected: Number.isInteger(idx) && indexSet.has(idx),
            });
        });
        setGroupsSelected(updates);
    }

    function getCustomContextAttachSelectionCount() {
        if (contextAttachCustomConfirmed) {
            return contextAttachCustomIndices.length;
        }
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            return getSelectedMessageIndices().length;
        }
        if (contextAttachCustomPending || contextAttachUnconfirmedIndices.length > 0) {
            return getUnconfirmedCustomSelectionIndices().length;
        }
        return 0;
    }

    function getContextAttachCountLabel(count) {
        return (locale.contextAttachSelected || '附带上轮已选{0}条记忆').replace('{0}', String(count));
    }

    function getContextAttachOptionLabel(mode) {
        switch (mode) {
            case 'last2':
                return locale.contextAttachLast2;
            case 'last10':
                return locale.contextAttachLast10;
            case 'all':
                return locale.contextAttachAll;
            case 'custom': {
                const count = getCustomContextAttachSelectionCount();
                if (count > 0) {
                    return getContextAttachCountLabel(count);
                }
                if (contextAttachCustomPending || contextAttachCustomConfirmed || contextAttachHasChoice) {
                    return locale.contextAttachCustomNone || '您没有选择任何记忆';
                }
                return locale.contextAttachCustom;
            }
            case 'none':
            default:
                if (contextAttachHasChoice) {
                    return locale.contextAttachNone;
                }
                return locale.contextAttachPlaceholder || locale.contextAttachNone;
        }
    }

    function updateContextAttachButtonLabel() {
        if (!contextAttachLabel || !contextAttachBtn) {
            return;
        }
        const isPlaceholder = contextAttachMode === 'none' && !contextAttachHasChoice;
        contextAttachLabel.textContent = getContextAttachOptionLabel(contextAttachMode);
        contextAttachBtn.classList.toggle('is-placeholder', isPlaceholder);
        contextAttachBtn.title = isPlaceholder
            ? (locale.contextAttachPlaceholder || '')
            : getContextAttachOptionLabel(contextAttachMode);
        if (contextAttachPreviewOpen) {
            if (hasContextAttachSelection()) {
                renderContextAttachPreviewContent();
                requestAnimationFrame(function() {
                    positionContextAttachPreview();
                });
            } else {
                hideContextAttachPreview();
            }
        }
    }

    function getGroupPreviewRoleLabel(group) {
        if (group.classList.contains('permission')) {
            return locale.permissionTitle || 'Permission';
        }
        if (group.classList.contains('thought')) {
            return auxiliaryRoleLabel('thought');
        }
        if (group.classList.contains('tool')) {
            return auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText);
        }
        return getGroupRoleLabel(group);
    }

    function getGroupPreviewText(group) {
        if (group.classList.contains('permission') && group._permissionState && group._permissionState.text) {
            return group._permissionState.text.trim();
        }
        if (group._auxState && group._auxState.rawText) {
            return group._auxState.rawText.trim();
        }
        return getMessagePlainText(group).trim();
    }

    function isAttachableMemoryGroup(group) {
        return group.classList.contains('user')
            || group.classList.contains('assistant')
            || group.classList.contains('permission');
    }

    function getAttachableMemoryGroups() {
        return getContextAttachRegionGroups().filter(isAttachableMemoryGroup);
    }

    function resolveAttachPreviewGroups() {
        if (!contextAttachVisible || contextAttachMode === 'none') {
            return [];
        }
        const attachable = getAttachableMemoryGroups();
        if (contextAttachMode === 'last2') {
            return attachable.slice(-2);
        }
        if (contextAttachMode === 'last10') {
            return attachable.slice(-10);
        }
        if (contextAttachMode === 'all') {
            return attachable.slice();
        }
        if (contextAttachMode === 'custom') {
            let indices = [];
            if (contextAttachCustomConfirmed) {
                indices = contextAttachCustomIndices;
            } else if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
                indices = getSelectedMessageIndices();
            } else {
                indices = contextAttachUnconfirmedIndices;
            }
            if (!indices.length) {
                return [];
            }
            const byIndex = new Map();
            messagesEl.querySelectorAll('.message-group').forEach(function(group) {
                const idx = parseInt(group.dataset.sessionIndex || '', 10);
                if (Number.isInteger(idx)) {
                    byIndex.set(idx, group);
                }
            });
            const picked = [];
            indices.forEach(function(index) {
                const group = byIndex.get(index);
                if (group && isAttachableMemoryGroup(group) && picked.indexOf(group) === -1) {
                    picked.push(group);
                }
            });
            return picked;
        }
        return [];
    }

    function hasContextAttachSelection() {
        return resolveAttachPreviewGroups().length > 0;
    }

    function isInsideContextAttachPreview(node) {
        if (!node || !contextAttachPreviewEl) {
            return false;
        }
        return contextAttachPreviewEl === node || contextAttachPreviewEl.contains(node);
    }

    function estimateContextAttachInputTokens(groups) {
        const parts = [(locale.contextAttachPrefixHeader || ''), '---'];
        groups.forEach(function(group) {
            parts.push(getGroupPreviewRoleLabel(group));
            parts.push(getGroupPreviewText(group));
        });
        const text = parts.join('\n');
        let weight = 0;
        for (let i = 0; i < text.length; i++) {
            weight += text.charCodeAt(i) > 0x2E7F ? 0.55 : 0.25;
        }
        return Math.max(1, Math.ceil(weight));
    }

    function updateContextAttachPreviewTitle(count, tokens) {
        const titleEl = document.getElementById('contextAttachPreviewTitle');
        if (!titleEl) {
            return;
        }
        const template = locale.contextAttachPreviewTitle || '({0} / ~{1})';
        titleEl.textContent = template
            .replace('{0}', String(count))
            .replace('{1}', String(tokens));
    }

    function renderContextAttachPreviewContent() {
        if (!contextAttachPreviewList) {
            return;
        }
        const groups = resolveAttachPreviewGroups();
        if (!groups.length) {
            contextAttachPreviewList.innerHTML = '';
            updateContextAttachPreviewTitle(0, 0);
            return;
        }
        updateContextAttachPreviewTitle(groups.length, estimateContextAttachInputTokens(groups));
        contextAttachPreviewList.innerHTML = groups.map(function(group) {
            const role = escapeHtml(getGroupPreviewRoleLabel(group));
            const text = escapeHtml(getGroupPreviewText(group) || '—');
            return '<li class="context-attach-preview-item">' +
                '<span class="context-attach-preview-role">' + role + '</span>' +
                '<span class="context-attach-preview-text">' + text + '</span>' +
                '</li>';
        }).join('');
    }

    function positionContextAttachPreview() {
        if (!contextAttachBtn || !contextAttachPreviewEl || contextAttachPreviewEl.hidden) {
            return;
        }
        const rect = contextAttachBtn.getBoundingClientRect();
        const tipRect = contextAttachPreviewEl.getBoundingClientRect();
        let left = rect.left;
        let top = rect.top - tipRect.height - 10;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        if (top < 8) {
            top = rect.bottom + 10;
        }
        contextAttachPreviewEl.style.left = left + 'px';
        contextAttachPreviewEl.style.top = top + 'px';
    }

    function showContextAttachPreview() {
        if (!contextAttachVisible || !contextAttachBtn || !contextAttachPreviewEl) {
            return;
        }
        if (contextAttachPicker && contextAttachPicker.classList.contains('is-open')) {
            return;
        }
        if (!hasContextAttachSelection()) {
            return;
        }
        renderContextAttachPreviewContent();
        contextAttachPreviewOpen = true;
        contextAttachPreviewEl.hidden = false;
        contextAttachPreviewEl.style.left = '-9999px';
        contextAttachPreviewEl.style.top = '0';
        requestAnimationFrame(function() {
            positionContextAttachPreview();
        });
    }

    function hideContextAttachPreview() {
        contextAttachPreviewOpen = false;
        if (contextAttachPreviewEl) {
            contextAttachPreviewEl.hidden = true;
        }
    }

    function bindContextAttachPreview() {
        if (!contextAttachBtn || !contextAttachPreviewEl) {
            return;
        }
        contextAttachBtn.addEventListener('mouseenter', function() {
            showContextAttachPreview();
        });
        contextAttachBtn.addEventListener('mousedown', function() {
            hideContextAttachPreview();
        });
        const contextAttachPreviewClose = document.getElementById('contextAttachPreviewClose');
        if (contextAttachPreviewClose) {
            contextAttachPreviewClose.addEventListener('click', function(e) {
                e.stopPropagation();
                hideContextAttachPreview();
            });
        }
        document.addEventListener('pointerdown', function(e) {
            if (!contextAttachPreviewOpen) {
                return;
            }
            if (isInsideContextAttachPreview(e.target)) {
                return;
            }
            hideContextAttachPreview();
        }, true);
    }

    function renderContextAttachOptions() {
        if (!contextAttachList) {
            return;
        }
        const options = [
            { mode: 'none', label: locale.contextAttachNone },
            { mode: 'last2', label: locale.contextAttachLast2 },
            { mode: 'last10', label: locale.contextAttachLast10 },
            { mode: 'all', label: locale.contextAttachAll },
            { mode: 'custom', label: locale.contextAttachCustom },
        ];
        contextAttachList.innerHTML = options.map(function(opt) {
            const isActive = opt.mode === contextAttachMode
                && (opt.mode !== 'none' || contextAttachHasChoice);
            const active = isActive ? ' active' : '';
            return '<div class="dropdown-item' + active + '" data-attach-mode="' + escapeHtml(opt.mode) + '">' +
                escapeHtml(opt.label) + (isActive ? ' ✓' : '') + '</div>';
        }).join('');
        contextAttachList.querySelectorAll('.dropdown-item[data-attach-mode]').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const mode = this.dataset.attachMode;
                if (mode === 'custom') {
                    contextAttachHasChoice = true;
                    enterContextAttachSelectMode();
                    return;
                }
                if (multiSelectPurpose === 'contextAttach') {
                    exitMultiSelectMode();
                }
                contextAttachCustomPending = false;
                contextAttachCustomConfirmed = false;
                contextAttachUnconfirmedIndices = [];
                contextAttachHasChoice = true;
                contextAttachMode = mode;
                contextAttachCustomIndices = [];
                updateContextAttachButtonLabel();
                renderContextAttachOptions();
                hideContextAttachPreview();
                closeAllDropdowns();
            });
        });
    }

    function showContextAttachPicker() {
        contextAttachVisible = true;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        hideContextAttachPreview();
        if (contextAttachPicker) {
            contextAttachPicker.classList.remove('is-hiding', 'is-entering', 'is-attention');
            contextAttachPicker.hidden = false;
            contextAttachPicker.classList.add('is-entering', 'is-attention');
            const onPickerAnimEnd = function(e) {
                if (e.target !== contextAttachPicker || e.animationName !== 'context-attach-enter') {
                    return;
                }
                contextAttachPicker.classList.remove('is-entering');
                contextAttachPicker.removeEventListener('animationend', onPickerAnimEnd);
            };
            contextAttachPicker.addEventListener('animationend', onPickerAnimEnd);
            if (contextAttachBtn) {
                const onAttentionEnd = function(e) {
                    if (e.target !== contextAttachBtn || e.animationName !== 'context-attach-attention-pulse') {
                        return;
                    }
                    contextAttachPicker.classList.remove('is-attention');
                    contextAttachBtn.removeEventListener('animationend', onAttentionEnd);
                };
                contextAttachBtn.addEventListener('animationend', onAttentionEnd);
            }
        }
        contextAttachPickerHiding = false;
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
    }

    function enterContextAttachSelectMode() {
        const previousIndices = getExistingCustomAttachIndices();
        contextAttachCustomPending = true;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = previousIndices.slice();
        contextAttachMode = 'custom';
        closeAllDropdowns();
        ensureContextAttachSelectableTargets();
        enterMultiSelectMode(null, 'contextAttach');
        applyContextAttachIndicesToSelection(previousIndices);
        updateContextAttachButtonLabel();
    }

    function confirmContextAttachSelection() {
        const indices = getSelectedMessageIndices();
        if (!indices.length) {
            return;
        }
        contextAttachCustomIndices = indices.slice();
        contextAttachUnconfirmedIndices = [];
        contextAttachMode = 'custom';
        contextAttachCustomConfirmed = true;
        contextAttachCustomPending = false;
        contextAttachHasChoice = true;
        exitMultiSelectMode();
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
    }

    function getUnconfirmedCustomSelectionIndices() {
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            return getSelectedMessageIndices();
        }
        return contextAttachUnconfirmedIndices.slice();
    }

    function hasUnconfirmedCustomMemorySelection() {
        if (!contextAttachVisible || contextAttachCustomConfirmed) {
            return false;
        }
        if (contextAttachMode !== 'custom' && !contextAttachCustomPending) {
            return false;
        }
        return getUnconfirmedCustomSelectionIndices().length > 0;
    }

    function buildContextAttachPayload(forceNoAttach) {
        if (!contextAttachVisible) {
            return undefined;
        }
        if (forceNoAttach) {
            return { mode: 'none' };
        }
        if (contextAttachCustomConfirmed && contextAttachMode === 'custom') {
            return {
                mode: 'custom',
                indices: contextAttachCustomIndices.slice(),
            };
        }
        if (contextAttachMode === 'none') {
            return { mode: 'none' };
        }
        if (contextAttachMode === 'custom' && !contextAttachCustomConfirmed) {
            return { mode: 'none' };
        }
        return {
            mode: contextAttachMode,
            indices: undefined,
        };
    }

    function finalizeContextAttachSelectionFromPending() {
        const indices = getUnconfirmedCustomSelectionIndices();
        if (!indices.length) {
            return false;
        }
        contextAttachCustomIndices = indices.slice();
        contextAttachUnconfirmedIndices = [];
        contextAttachMode = 'custom';
        contextAttachCustomConfirmed = true;
        contextAttachCustomPending = false;
        contextAttachHasChoice = true;
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
        return true;
    }

    function openContextAttachSendModal(text) {
        pendingSendText = text;
        showModal(contextAttachSendModal);
    }

    function closeContextAttachSendModal() {
        pendingSendText = '';
        hideModal(contextAttachSendModal);
    }

    // Image-paste staging (webview clipboard → base64) — see paste listener below.
    const pendingImages = [];
    let __imgPasteBound = false;

    function renderPendingImagesBar() {
        // Mount by reference: a message in the transcript can define an element with this
        // id (tool cards render their body as HTML), and getElementById then returns that
        // copy — which sits thousands of pixels up the scrolled transcript.
        const composite = inputEl.closest('.input-composite') || inputEl.parentElement;
        if (!composite) { hostLog('[paste-bar] no composite to mount into'); return; }
        let bar = document.getElementById('imagePasteBar');
        if (pendingImages.length === 0) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'imagePasteBar';
            bar.className = 'image-paste-bar';
            composite.insertBefore(bar, composite.firstChild);
        }
        hostLog('[paste-bar] rendering ' + pendingImages.length + ' thumbnail(s) in #' + composite.id);
        bar.innerHTML = '';
        pendingImages.forEach((img, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'image-paste-thumb';
            const el = document.createElement('img');
            el.src = 'data:' + img.mimeType + ';base64,' + img.data;
            const kb = Math.round((img.data.length * 0.75) / 1024);
            el.title = img.mimeType + ' — ' + kb + ' KB';
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'image-paste-remove';
            rm.setAttribute('aria-label', 'Remove image');
            rm.textContent = '×';
            rm.addEventListener('click', () => {
                pendingImages.splice(i, 1);
                renderPendingImagesBar();
            });
            wrap.appendChild(el);
            wrap.appendChild(rm);
            bar.appendChild(wrap);
        });
        const rect = bar.getBoundingClientRect();
        const first = bar.querySelector('img');
        const cs = getComputedStyle(bar);
        const r2 = (el) => { if (!el) return 'none'; const b = el.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) + '@' + Math.round(b.top); };
        const area = document.getElementById('input-area');
        const chatBody = document.getElementById('chat-body');
        const scroller = document.scrollingElement || document.body;
        hostLog('[paste-bar] mount parent=' + (bar.parentElement && bar.parentElement.id)
            + ' dupIds=' + document.querySelectorAll('#inputComposite').length
            + ' inInputArea=' + !!(area && area.contains(bar))
            + ' area=' + r2(area) + ' areaDisplay=' + (area ? getComputedStyle(area).display : 'none')
            + ' chatBody=' + r2(chatBody) + ' msgs=' + r2(document.getElementById('messages'))
            + ' scrollTop=' + Math.round(scroller.scrollTop) + ' scrollHeight=' + Math.round(scroller.scrollHeight));
        hostLog('[paste-bar] box=' + Math.round(rect.width) + 'x' + Math.round(rect.height)
            + ' top=' + Math.round(rect.top) + ' display=' + cs.display + ' vis=' + cs.visibility
            + ' opacity=' + cs.opacity
            + ' imgDecoded=' + (first ? first.complete + '/' + first.naturalWidth + 'x' + first.naturalHeight : 'none')
            + ' dataLen=' + (pendingImages[0] ? pendingImages[0].data.length : 0));
    }

    function bindImagePasteOnce() {
        if (__imgPasteBound || !inputEl) return;
        __imgPasteBound = true;
        inputEl.addEventListener('paste', async (e) => {
            const active = document.activeElement;
            hostLog('[paste] fired on #input, active=' + (active && (active.id || active.tagName)));
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) { hostLog('[paste] no clipboardData.items'); return; }
            const files = [];
            for (const it of items) {
                if (it.kind === 'file' && it.type.startsWith('image/')) {
                    const f = it.getAsFile();
                    if (f) files.push(f);
                }
            }
            const kinds = [];
            for (const it of items) kinds.push(it.kind + ':' + it.type);
            hostLog('[paste] items=' + items.length + ' [' + kinds.join(', ') + '] images=' + files.length);
            if (files.length === 0) return; // plain-text paste proceeds normally
            e.preventDefault();
            for (const f of files) {
                try {
                    const buf = await f.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let bin = '';
                    const CHUNK = 0x8000;
                    for (let i = 0; i < bytes.length; i += CHUNK) {
                        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                    }
                    pendingImages.push({ mimeType: f.type || 'image/png', data: btoa(bin) });
                } catch (err) {
                    hostLog('[paste] stage failed: ' + (err && err.message));
                    console.error('[image-paste] stage failed', err);
                }
            }
            hostLog('[paste] staged, pending=' + pendingImages.length);
            renderPendingImagesBar();
        });
    }
    bindImagePasteOnce();
    hostLog('[paste] listener bound on #input');

    function executeSendMessage(text, attachOverride) {
        hideFilePicker();
        resetAutoScrollFollow();
        const outgoing = withReplyQuote(text);
        const imagesForBubble = pendingImages.slice();
        appendMessage('user', outgoing, imagesForBubble.length ? { images: imagesForBubble } : undefined);
        inputEl.value = '';
        syncInputHeightFromContent();
        updateQuickActionBtns();
        // The composer stays enabled for the whole turn, so the caret never leaves it
        // and the next message can be typed while Hermes works. Sending is blocked by
        // canSend (see sendMessage), and the Send button by setInputMode('waiting');
        // disabling the textarea was what blurred the composer on every send.
        awaitingFirstChunk = true;
        setInputMode('waiting');
        // Sending by clicking the button leaves focus on the button, which made the box
        // look dead until the turn ended. The next thing typed belongs in the composer.
        inputEl.focus();

        const payload = attachOverride !== undefined
            ? attachOverride
            : buildContextAttachPayload(false);
        vscode.postMessage({
            type: 'sendMessage',
            text: outgoing,
            contextAttach: payload,
            images: imagesForBubble.length ? imagesForBubble : undefined,
        });
        pendingImages.length = 0;
        renderPendingImagesBar();
        clearReplyQuote();
    }

    function openSwitchSessionModal(sessionId) {
        pendingSwitchSessionId = sessionId;
        const titleEl = document.getElementById('switchSessionModalTitle');
        const bodyEl = document.getElementById('switchSessionModalBody');
        const stayBtn = document.getElementById('switchSessionStayBtn');
        const confirmBtn = document.getElementById('switchSessionConfirmBtn');
        if (titleEl) titleEl.textContent = locale.switchSessionPromptTitle || '';
        if (bodyEl) bodyEl.textContent = locale.switchSessionPromptBody || '';
        if (stayBtn) stayBtn.textContent = locale.switchSessionStay || '';
        if (confirmBtn) confirmBtn.textContent = locale.switchSessionConfirm || '';
        showModal(switchSessionModal);
    }

    function closeSwitchSessionModal() {
        pendingSwitchSessionId = null;
        hideModal(switchSessionModal);
    }

    /**
     * A switch pressed during a run is queued behind it, so the pane has to say so. The stop
     * button is the way out: it ends the run, and the queued switch then happens at once.
     */
    let switchQueuedFor = null;
    function markSwitchQueued(sessionId) {
        switchQueuedFor = sessionId;
        const titleEl = document.getElementById('switchSessionModalTitle');
        const bodyEl = document.getElementById('switchSessionModalBody');
        const stayBtn = document.getElementById('switchSessionStayBtn');
        const confirmBtn = document.getElementById('switchSessionConfirmBtn');
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

    function clearSwitchQueued() {
        if (!switchQueuedFor) return;
        switchQueuedFor = null;
        const stayBtn = document.getElementById('switchSessionStayBtn');
        const confirmBtn = document.getElementById('switchSessionConfirmBtn');
        if (stayBtn) stayBtn.hidden = false;
        if (confirmBtn) {
            confirmBtn.textContent = locale.switchSessionConfirm || '';
            confirmBtn.className = 'toolbar-btn primary';
            delete confirmBtn.dataset.queued;
        }
        document.querySelectorAll('.session-tab.switch-pending').forEach(t => t.classList.remove('switch-pending'));
        hideModal(switchSessionModal);
        pendingSwitchSessionId = null;
    }

    function requestSwitchSession(sessionId) {
        if (!sessionId || sessionId === activeSessionId) {
            return;
        }
        if (isPrompting) {
            openSwitchSessionModal(sessionId);
            return;
        }
        vscode.postMessage({ type: 'switchSession', sessionId: sessionId });
    }
    /** True after send until first agent output; stop stays hidden to avoid early cancel. */
    let awaitingFirstChunk = false;
    window._showThoughts = true;
    window._showToolCalls = true;

    const SCROLL_BOTTOM_THRESHOLD = 24;
    const SCROLL_IDLE_MS = 5000;
    let scrollPinnedByUser = false;
    let scrollIdleTimer = null;

    function isMessagesAtBottom() {
        if (!messagesEl) {
            return true;
        }
        return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
    }

    function isActivelyStreaming() {
        return !!(streamingMessageId || isPrompting);
    }

    function maybeScrollToBottom(force) {
        if (!messagesEl) {
            return;
        }
        if (force || !scrollPinnedByUser) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    function scheduleScrollReenable() {
        if (scrollIdleTimer) {
            clearTimeout(scrollIdleTimer);
        }
        scrollIdleTimer = setTimeout(function() {
            scrollIdleTimer = null;
            if (isActivelyStreaming()) {
                scrollPinnedByUser = false;
                maybeScrollToBottom(true);
            }
        }, SCROLL_IDLE_MS);
    }

    function onMessagesScroll() {
        if (!isActivelyStreaming()) {
            return;
        }
        if (!isMessagesAtBottom()) {
            scrollPinnedByUser = true;
        }
        scheduleScrollReenable();
    }

    if (messagesEl) {
        messagesEl.addEventListener('scroll', onMessagesScroll, { passive: true });
    }

    function resetAutoScrollFollow() {
        scrollPinnedByUser = false;
        if (scrollIdleTimer) {
            clearTimeout(scrollIdleTimer);
            scrollIdleTimer = null;
        }
    }

    function formatTokenCount(n) {
        const value = Number(n) || 0;
        if (value >= 1_000_000) {
            return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (value >= 10_000) {
            return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        if (value >= 1_000) {
            return (value / 1_000).toFixed(1) + 'k';
        }
        return String(value);
    }

    function updateTokenUsage(used, size) {
        if (!tokenUsageRing || !tokenUsageArc) return;
        const usedTokens = Math.max(0, Number(used) || 0);
        const totalTokens = Math.max(0, Number(size) || 0);
        if (totalTokens <= 0) {
            tokenUsageRing.hidden = true;
            return;
        }
        const pct = Math.min(100, Math.round((usedTokens / totalTokens) * 100));
        const filled = (pct / 100) * TOKEN_RING_CIRCUMFERENCE;
        tokenUsageArc.style.strokeDasharray = filled + ' ' + TOKEN_RING_CIRCUMFERENCE;
        const level = pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';
        tokenUsageRing.dataset.level = level;
        if (tokenUsagePct) {
            tokenUsagePct.textContent = pct + '%';
            tokenUsagePct.style.fontSize = pct >= 100 ? '7px' : '8px';
        }
        const label = localeText('tokenUsageLabel', formatTokenCount(usedTokens), formatTokenCount(totalTokens), pct);
        tokenUsageRing.title = label;
        tokenUsageRing.setAttribute('aria-label', label);
        tokenUsageRing.hidden = false;
    }
    let toolCallMap = {};
    let toolAggregateGroupId = null;
    const TOOL_SHORT_MAX_LINES = 3;
    const TOOL_AGGREGATE_MAX_LINES = 12;
    const TOOL_AGGREGATE_SEPARATOR = '\n\n---\n\n';
    const pendingPermissions = new Map();
    const PERM_COLLAPSED_LINES = 3;
    const PERM_LINE_HEIGHT_EM = 1.45;
    const THOUGHT_COLLAPSED_LINES = 5;
    const TOOL_COLLAPSED_LINES = 3;
    const AUX_LINE_HEIGHT_EM = 1.35;

    function getAuxCollapsedLines(role) {
        return role === 'thought' ? THOUGHT_COLLAPSED_LINES : TOOL_COLLAPSED_LINES;
    }

    function getAuxCollapsedMaxHeight(role) {
        return (AUX_LINE_HEIGHT_EM * getAuxCollapsedLines(role)) + 'em';
    }

    function auxDetailOverflows(scrollEl, text, maxLines) {
        if (!scrollEl) return false;
        if (text && text.split('\n').length > maxLines) return true;
        return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
    }

    function syncAuxiliaryDetailView(group) {
        const state = group._auxState;
        if (!state || !state.scrollEl) return;
        const maxLines = getAuxCollapsedLines(state.role);
        state.scrollEl.classList.toggle('is-collapsed', !state.detailExpanded);
        state.scrollEl.classList.toggle('is-expanded', state.detailExpanded);
        if (!state.detailExpanded) {
            state.scrollEl.style.maxHeight = getAuxCollapsedMaxHeight(state.role);
            state.scrollEl.scrollTop = state.scrollEl.scrollHeight;
        } else {
            state.scrollEl.style.maxHeight = '';
        }
        const overflow = auxDetailOverflows(state.scrollEl, state.rawText, maxLines);
        state.moreBtn.hidden = state.detailExpanded || !overflow;
        state.lessBtn.hidden = !state.detailExpanded || !overflow;
    }

    function countNonemptyLines(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return 0;
        return trimmed.split('\n').filter(function(line) { return line.trim().length > 0; }).length;
    }

    function isShortToolText(text) {
        return countNonemptyLines(text) <= TOOL_SHORT_MAX_LINES;
    }

    function isAggregatedToolText(text) {
        return (text || '').indexOf('---') >= 0;
    }

    function mergeToolTexts(existing, incoming) {
        return existing.trim() + TOOL_AGGREGATE_SEPARATOR + incoming.trim();
    }

    function canAggregateToolTexts(existing, incoming) {
        if (!isShortToolText(incoming)) return false;
        const existingLines = countNonemptyLines(existing);
        if (existingLines > TOOL_SHORT_MAX_LINES && !isAggregatedToolText(existing)) return false;
        return countNonemptyLines(mergeToolTexts(existing, incoming)) <= TOOL_AGGREGATE_MAX_LINES;
    }

    function rebuildAggregateToolContent(group) {
        const state = group._auxState;
        if (!state || !state.aggregatedTools || !state.aggregatedTools.length) return;
        const merged = state.aggregatedTools
            .map(function(entry) { return entry.text.trim(); })
            .filter(Boolean)
            .join(TOOL_AGGREGATE_SEPARATOR);
        setAuxiliaryContent(group, merged);
    }

    function resetToolAggregation() {
        toolAggregateGroupId = null;
    }

    function ensureAggregateEntries(group) {
        const state = group._auxState;
        if (!state) return;
        if (state.aggregatedTools && state.aggregatedTools.length) return;
        let firstId = null;
        let firstText = state.rawText || '';
        Object.keys(toolCallMap).forEach(function(id) {
            if (toolCallMap[id] === group.id && !firstId) {
                firstId = id;
            }
        });
        state.aggregatedTools = [{
            toolCallId: firstId || ('tool_' + group.id),
            text: firstText,
        }];
    }

    function handleToolMessage(text, toolCallId) {
        if (toolCallMap[toolCallId]) {
            const group = document.getElementById(toolCallMap[toolCallId]);
            if (group && group._auxState) {
                if (group._auxState.aggregatedTools && group._auxState.aggregatedTools.length) {
                    const entry = group._auxState.aggregatedTools.find(function(t) {
                        return t.toolCallId === toolCallId;
                    });
                    if (entry) {
                        entry.text = text;
                    }
                    rebuildAggregateToolContent(group);
                } else {
                    setAuxiliaryContent(group, text);
                }
                setAuxMessageLive(group, true);
                maybeScrollToBottom();
            }
            return;
        }

        finalizeAssistantBubble();

        if (toolAggregateGroupId) {
            const group = document.getElementById(toolAggregateGroupId);
            if (group && group._auxState && canAggregateToolTexts(group._auxState.rawText || '', text)) {
                ensureAggregateEntries(group);
                group._auxState.aggregatedTools.push({ toolCallId: toolCallId, text: text });
                rebuildAggregateToolContent(group);
                toolCallMap[toolCallId] = toolAggregateGroupId;
                setAuxMessageLive(group, true);
                enableStopAfterAgentOutput();
                maybeScrollToBottom();
                return;
            }
        }

        const id = appendMessage('tool', text);
        toolCallMap[toolCallId] = id;
        toolAggregateGroupId = id;
    }

    function setAuxiliaryContent(group, text) {
        const state = group._auxState;
        if (!state) return;
        state.rawText = text || '';
        const labelEl = group.querySelector('.aux-label');
        if (labelEl) {
            labelEl.textContent = auxiliaryRoleLabel(state.role, state.rawText);
        }
        state.contentEl.innerHTML = renderMarkdown(state.rawText);
        setupContentBlocks(state.contentEl);
        processFileRefs(state.contentEl);
        syncAuxiliaryDetailView(group);
    }

    function buildAuxiliaryMessage(role, text) {
        const div = document.createElement('div');
        div.className = 'message ' + role;

        const header = document.createElement('div');
        header.className = 'aux-header';
        const label = document.createElement('div');
        label.className = 'label aux-label';
        label.textContent = auxiliaryRoleLabel(role, text);
        header.appendChild(label);
        div.appendChild(header);

        const wrap = document.createElement('div');
        wrap.className = 'aux-body-wrap';

        const scrollEl = document.createElement('div');
        scrollEl.className = 'aux-body-scroll is-collapsed';
        const contentEl = document.createElement('div');
        contentEl.className = 'aux-body-content';
        scrollEl.appendChild(contentEl);
        wrap.appendChild(scrollEl);

        const controls = document.createElement('div');
        controls.className = 'aux-body-controls';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'aux-body-toggle';
        moreBtn.textContent = locale.permissionShowMore || 'Show more';
        const lessBtn = document.createElement('button');
        lessBtn.type = 'button';
        lessBtn.className = 'aux-body-toggle';
        lessBtn.textContent = locale.permissionCollapse || 'Collapse';
        lessBtn.hidden = true;
        controls.appendChild(moreBtn);
        controls.appendChild(lessBtn);
        wrap.appendChild(controls);
        div.appendChild(wrap);

        return { div: div, scrollEl: scrollEl, contentEl: contentEl, moreBtn: moreBtn, lessBtn: lessBtn, role: role, rawText: text || '' };
    }

    function wireAuxiliaryMessage(group, parts, deferMarkdown) {
        const state = {
            role: parts.role,
            rawText: parts.rawText,
            detailExpanded: false,
            scrollEl: parts.scrollEl,
            contentEl: parts.contentEl,
            moreBtn: parts.moreBtn,
            lessBtn: parts.lessBtn,
        };
        group._auxState = state;
        parts.moreBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            state.detailExpanded = true;
            syncAuxiliaryDetailView(group);
        });
        parts.lessBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            state.detailExpanded = false;
            syncAuxiliaryDetailView(group);
        });
        if (deferMarkdown) {
            state.contentEl.textContent = parts.rawText || '';
            syncAuxiliaryDetailView(group);
        } else {
            setAuxiliaryContent(group, parts.rawText);
        }
    }

    function finalizeAuxiliaryBubble(group) {
        if (!group || !group._auxState) return;
        setAuxiliaryContent(group, group._auxState.rawText);
    }

    function permissionBodyText(title, detail) {
        const parts = [];
        if (title) parts.push(String(title));
        if (detail && String(detail).trim()) parts.push(String(detail).trim());
        return parts.join('\n\n');
    }

    function permissionOptionLabel(opt) {
        const kind = String(opt.kind || '').toLowerCase().replace(/-/g, '_');
        const id = String(opt.optionId || '').toLowerCase().replace(/-/g, '_');
        const map = {
            allow_once: 'permissionAllowOnce',
            allow_always: 'permissionAllowAlways',
            allow_session: 'permissionAllowSession',
            reject_once: 'permissionRejectOnce',
            reject_always: 'permissionRejectAlways',
            deny_once: 'permissionRejectOnce',
            deny_always: 'permissionRejectAlways',
            deny: 'permissionDeny',
        };
        let key = map[id] || map[kind];
        const tokens = [id, kind].filter(Boolean);
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('session') >= 0) {
                    key = 'permissionAllowSession';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('always') >= 0) {
                    key = 'permissionAllowAlways';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0) {
                    key = 'permissionAllowOnce';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if ((tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0)
                    && tokens[i].indexOf('always') >= 0) {
                    key = 'permissionRejectAlways';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0) {
                    key = tokens[i].indexOf('once') >= 0 ? 'permissionRejectOnce' : 'permissionDeny';
                    break;
                }
            }
        }
        if (key && locale[key]) return locale[key];
        return opt.name || opt.optionId;
    }

    function getPermissionCollapsedMaxHeight() {
        return (PERM_LINE_HEIGHT_EM * PERM_COLLAPSED_LINES) + 'em';
    }

    function permissionDetailOverflows(scrollEl, text) {
        if (!scrollEl) return false;
        if (text && text.split('\n').length > PERM_COLLAPSED_LINES) return true;
        return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
    }

    function syncPermissionDetailView(group) {
        const state = group._permissionState;
        if (!state || !state.scrollEl) return;
        state.textEl.textContent = state.text || '';
        state.wrapEl.style.display = state.cardCollapsed ? 'none' : '';
        state.scrollEl.classList.toggle('is-collapsed', !state.detailExpanded);
        state.scrollEl.classList.toggle('is-expanded', state.detailExpanded);
        if (!state.detailExpanded) {
            state.scrollEl.style.maxHeight = getPermissionCollapsedMaxHeight();
            state.scrollEl.scrollTop = state.scrollEl.scrollHeight;
        } else {
            state.scrollEl.style.maxHeight = '';
        }
        const overflow = permissionDetailOverflows(state.scrollEl, state.text);
        state.moreBtn.hidden = state.detailExpanded || !overflow;
        state.lessBtn.hidden = !state.detailExpanded || !overflow;
        state.cardToggle.title = state.cardCollapsed
            ? (locale.permissionCardExpand || 'Expand details')
            : (locale.permissionCardCollapse || 'Collapse details');
        state.cardToggle.setAttribute('aria-expanded', state.cardCollapsed ? 'false' : 'true');
    }

    function updatePermissionContent(group, title, detail) {
        if (!group._permissionState) return;
        group._permissionState.text = permissionBodyText(title, detail);
        syncPermissionDetailView(group);
    }

    function refreshPermissionOptionLabels(group) {
        if (!group._permissionState) return;
        group._permissionState.options.forEach(function(opt) {
            const btn = group.querySelector('.permission-btn[data-option-id="' + opt.optionId.replace(/"/g, '\\"') + '"]');
            if (btn) btn.textContent = permissionOptionLabel(opt);
        });
    }

    function buildPermissionActions(id, options, readOnly) {
        const actions = document.createElement('div');
        actions.className = 'permission-actions';
        if (readOnly) {
            actions.style.display = 'none';
            return actions;
        }
        (options || []).forEach(function(opt) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'permission-btn button';
            btn.dataset.optionId = opt.optionId;
            const kind = String(opt.kind || '').toLowerCase();
            const idLower = String(opt.optionId || '').toLowerCase();
            if (kind.indexOf('allow') === 0 || idLower.indexOf('allow') === 0) {
                btn.classList.add('allow', 'button--primary');
            } else if (kind.indexOf('reject') === 0 || kind.indexOf('deny') === 0
                || idLower.indexOf('reject') >= 0 || idLower.indexOf('deny') >= 0) {
                btn.classList.add('reject', 'button--reject');
            }
            btn.textContent = permissionOptionLabel(opt);
            btn.addEventListener('click', function() {
                resolvePermission(id, opt.optionId, permissionOptionLabel(opt));
            });
            actions.appendChild(btn);
        });
        return actions;
    }

    function applyPermissionResolvedUI(group, statusText) {
        const div = group.querySelector('.message');
        if (!div) {
            return;
        }
        div.classList.remove('pending');
        div.classList.add('resolved');
        group.querySelectorAll('.permission-btn').forEach(function(btn) {
            btn.disabled = true;
        });
        const actions = group.querySelector('.permission-actions');
        if (actions) {
            actions.style.display = 'none';
        }
        let status = div.querySelector('.permission-status');
        if (!status) {
            status = document.createElement('div');
            status.className = 'permission-status';
            div.appendChild(status);
        }
        status.textContent = statusText;
    }

    /** The permission card: header, detail area and actions. No wrapper, no mount. */
    function buildPermissionCard(id, msg, cardOptions) {
        const readOnly = !!(cardOptions && cardOptions.readOnly);

        const div = document.createElement('div');
        div.className = 'message permission' + (readOnly || msg.resolved ? ' resolved' : ' pending');

        const header = document.createElement('div');
        header.className = 'permission-header';

        const label = document.createElement('div');
        label.className = 'label permission-label';
        label.textContent = locale.permissionTitle || 'Permission required';
        header.appendChild(label);

        const cardToggle = document.createElement('button');
        cardToggle.type = 'button';
        cardToggle.className = 'permission-card-toggle';
        cardToggle.innerHTML = '<span class="permission-card-arrow">▼</span>';
        header.appendChild(cardToggle);
        div.appendChild(header);

        const wrap = document.createElement('div');
        wrap.className = 'permission-detail-wrap';

        const scrollEl = document.createElement('div');
        scrollEl.className = 'permission-detail-scroll is-collapsed';
        const textEl = document.createElement('div');
        textEl.className = 'permission-detail-text';
        scrollEl.appendChild(textEl);
        wrap.appendChild(scrollEl);

        const controls = document.createElement('div');
        controls.className = 'permission-detail-controls';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'permission-detail-toggle';
        moreBtn.textContent = locale.permissionShowMore || 'Show more';
        const lessBtn = document.createElement('button');
        lessBtn.type = 'button';
        lessBtn.className = 'permission-detail-toggle';
        lessBtn.textContent = locale.permissionCollapse || 'Collapse';
        lessBtn.hidden = true;
        controls.appendChild(moreBtn);
        controls.appendChild(lessBtn);
        wrap.appendChild(controls);
        div.appendChild(wrap);

        const options = msg.options || [];
        div.appendChild(buildPermissionActions(id, options, readOnly));

        const state = {
            text: permissionBodyText(msg.title, msg.detail),
            detailExpanded: !!(readOnly || msg.resolved),
            cardCollapsed: false,
            options: options,
            wrapEl: wrap,
            scrollEl: scrollEl,
            textEl: textEl,
            moreBtn: moreBtn,
            lessBtn: lessBtn,
            cardToggle: cardToggle,
            readOnly: readOnly,
        };

        return { card: div, state: state };
    }

    /** Identity from the request's own id, then the card, then the handlers. */
    function mountPermissionCard(id, msg, cardOptions) {
        const group = createGroup('permission', 'perm-' + id);
        group.dataset.permissionId = id;
        const built = buildPermissionCard(id, msg, cardOptions);
        const card = built.card;
        group._permissionState = built.state;
        const readOnly = built.state.readOnly;

        built.state.cardToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.cardCollapsed = !group._permissionState.cardCollapsed;
            card.classList.toggle('is-card-collapsed', group._permissionState.cardCollapsed);
            syncPermissionDetailView(group);
        });
        built.state.moreBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.detailExpanded = true;
            syncPermissionDetailView(group);
        });
        built.state.lessBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.detailExpanded = false;
            syncPermissionDetailView(group);
        });

        // Same shape as every other message: container, stack, card.
        const container = document.createElement('div');
        container.className = 'message-container';
        const stack = document.createElement('div');
        stack.className = 'message-stack';
        stack.appendChild(card);
        container.appendChild(stack);
        group.appendChild(container);
        updatePermissionContent(group, msg.title, msg.detail);
        if (readOnly || msg.resolved) {
            let statusText = locale.permissionCancelled || 'Cancelled';
            if (msg.outcome === 'selected' && (msg.selectedLabel || msg.selectedOptionId)) {
                statusText = localeText('permissionSelected', msg.selectedLabel || msg.selectedOptionId);
            } else if (msg.selectedLabel) {
                statusText = localeText('permissionSelected', msg.selectedLabel);
            }
            applyPermissionResolvedUI(group, statusText);
        }
        return group;
    }

    function restorePermissionMessage(m) {
        const id = m.permissionId || ('perm_hist_' + (m.timestamp || Date.now()));
        const group = mountPermissionCard(id, {
            title: m.title || m.text || '',
            detail: m.detail || '',
            options: m.options || [],
            resolved: true,
            outcome: m.outcome,
            selectedLabel: m.selectedLabel,
            selectedOptionId: m.selectedOptionId,
        }, { readOnly: true });
        messagesEl.appendChild(group);
    }

    let connectionAttempted = false;
    const cancelBtn = document.getElementById('cancelBtn');
    const retryBtn = document.getElementById('retryBtn');
    const detectEnvBtn = document.getElementById('detectEnvBtn');
    let activeSessionId = '';

    const filePickerEl = document.getElementById('filePicker');
    let mentionStart = -1;
    let filePickerVisible = false;
    let filePickerItems = [];
    let filePickerIndex = 0;
    let fileListRequestId = 0;
    let fileListDebounce = null;

    let previewTooltip = null;
    let previewHideTimer = null;
    let previewRequestId = 0;
    const previewRequests = new Map();

    function setInputMode(mode) {
        const waiting = mode === 'stop' || mode === 'waiting';
        if (inputCompositeEl) {
            inputCompositeEl.classList.toggle('waiting', waiting);
        }
        if (inputCompositeShellEl) {
            inputCompositeShellEl.classList.toggle('waiting', waiting);
        }
        if (mode === 'stop') {
            sendBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        } else if (mode === 'waiting') {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        } else if (mode === 'send') {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = !canSend;
        } else {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        }
    }

    function setQuickPanelOpen(open) {
        if (!inputQuickPanel || !quickToggleBtn) return;
        inputQuickPanel.classList.toggle('open', open);
        inputQuickPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        quickToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        quickToggleBtn.title = open ? locale.quickActionsCollapse : locale.quickActionsExpand;
        if (open && chatSearchInput && !chatSearchInput.disabled) {
            setTimeout(function() { chatSearchInput.focus(); }, 280);
        }
    }

    function toggleQuickPanel() {
        setQuickPanelOpen(!inputQuickPanel.classList.contains('open'));
    }

    function updateConnectionActionVisibility(status) {
        const showActions = status === 'error' || (status === 'idle' && connectionAttempted);
        if (retryBtn) {
            retryBtn.hidden = !showActions;
            retryBtn.disabled = status === 'connecting';
        }
        if (detectEnvBtn) {
            detectEnvBtn.hidden = !showActions;
            detectEnvBtn.disabled = status === 'connecting';
        }
    }

    function bindConnectionErrorActions() {
        const phRetry = document.getElementById('placeholderRetryBtn');
        if (phRetry) phRetry.addEventListener('click', doRetry);
        const phDetect = document.getElementById('placeholderDetectEnvBtn');
        if (phDetect) phDetect.addEventListener('click', doDetectEnvironment);
    }

    function buildConnectionErrorPlaceholder(errText) {
        if (placeholder) placeholder.className = 'placeholder';
        return escapeHtml(errText) +
            '<div class="connection-error-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
            '<button type="button" class="retry-btn" id="placeholderRetryBtn">' + escapeHtml(locale.retryConnect) + '</button>' +
            '<button type="button" class="retry-btn" id="placeholderDetectEnvBtn">' + escapeHtml(locale.detectEnvironment) + '</button>' +
            '</div>';
    }

    function updateRetryVisibility(status) {
        updateConnectionActionVisibility(status);
    }

    function doRetry() {
        if (retryBtn && retryBtn.disabled) return;
        connectionAttempted = true;
        vscode.postMessage({ type: 'retry' });
    }

    function doDetectEnvironment() {
        if (detectEnvBtn && detectEnvBtn.disabled) return;
        vscode.postMessage({ type: 'detectEnvironment' });
    }

    /* Vendor spellings that naive capitalisation gets wrong. Only used when Hermes sends
       no display name (the session-model path sends names as "DeepSeek · deepseek-flash"). */
    const VENDOR_NAMES = {
        deepseek: 'DeepSeek',
        openai: 'OpenAI',
        xai: 'xAI',
        zai: 'Z.ai',
        'z-ai': 'Z.ai',
        huggingface: 'HuggingFace'
    };

    function vendorLabel(slug) {
        const raw = String(slug || '').trim().replace(/^custom:/i, '');
        if (!raw) return '';
        const known = VENDOR_NAMES[raw.toLowerCase()];
        if (known) return known;
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    /** Vendor label of the active model, or '' when it cannot be resolved honestly.
     *  1) provider group that lists the model, 2) Hermes' "Vendor · model" display name,
     *  3) the provider prefix of the "vendor:model" id. No other guessing.
     */
    function currentProviderVendor() {
        const payload = lastModelPayload;
        if (!payload) return '';
        const current = String(payload.currentValueId || '');
        if (!current) return '';
        const groups = Array.isArray(payload.groups) ? payload.groups : [];
        const usable = function(g) {
            const name = String((g && (g.name || g.slug)) || '').trim();
            return name && name.toLowerCase() !== 'other' ? name : '';
        };
        for (let i = 0; i < groups.length; i++) {
            const gModels = Array.isArray(groups[i].models) ? groups[i].models : [];
            for (let j = 0; j < gModels.length; j++) {
                if (gModels[j] && gModels[j].valueId === current) {
                    const label = usable(groups[i]);
                    if (label) return label;
                }
            }
        }
        const models = Array.isArray(payload.models) ? payload.models : [];
        for (let k = 0; k < models.length; k++) {
            if (!models[k] || models[k].valueId !== current) continue;
            const display = String(models[k].name || '');
            const cut = display.indexOf(' · ');
            if (cut > 0) return display.slice(0, cut).trim();
            break;
        }
        const prefix = current.split(':')[0];
        return prefix && prefix !== current ? vendorLabel(prefix) : '';
    }

    let currentStatus = 'ready';
    let currentStatusMessage = '';
    /** Set when the host says there is no tab at all, cleared once one is shown again. */
    let paneHintText = '';

    /** The empty pane must not claim "Ready" while the profile/session is still loading. */
    function emptyStateText() {
        if (paneHintText) return paneHintText;
        if (currentStatus === 'connecting') return currentStatusMessage || locale.statusConnecting;
        if (currentStatus === 'idle') return locale.statusDisconnected;
        if (currentStatus === 'error') return currentStatusMessage || locale.statusError;
        return locale.readyPlaceholder;
    }

    function syncEmptyState() {
        const el = document.getElementById('placeholder');
        if (el) el.textContent = emptyStateText();
    }

    function updateStatus(status, message) {
        statusDot.className = 'dot ' + status;
        const labels = {
            idle: locale.statusDisconnected,
            connecting: locale.statusConnecting,
            ready: locale.statusReady,
            prompting: locale.statusThinking,
            error: locale.statusError
        };
        let text = message || labels[status] || status;
        if (text.startsWith('Session:')) {
            text = labels[status] || status;
        }
        let vendorOverride = false;
        if (status === 'prompting') {
            // AcpClient's "Hermes is thinking..." is a placeholder, not information: it is
            // the vendor's model that thinks. A real message (initializing, failure) stays.
            const placeholder = !message || message === locale.statusThinking
                || message === locale.statusHermesThinking;
            const vendor = placeholder ? currentProviderVendor() : '';
            const template = locale.statusThinkingProvider;
            if (vendor && template && template.indexOf('{provider}') >= 0) {
                text = template.split('{provider}').join(vendor);
                vendorOverride = true;
            }
        }
        statusText.textContent = text;
        statusText.title = message && !vendorOverride ? message : text;
        currentStatus = status;
        currentStatusMessage = message || '';
        syncEmptyState();
        updateRetryVisibility(status);
    }

    // ---- Log viewer ----
    let logs = [];
    const logFilterError = document.getElementById('logFilterError');
    const logFilterWarning = document.getElementById('logFilterWarning');
    const logModal = document.getElementById('logModal');
    const logContent = document.getElementById('logContent');
    const copyLogBtn = document.getElementById('copyLogBtn');
    const LOG_SCROLL_BOTTOM_THRESHOLD = 24;
    const LOG_SCROLL_IDLE_MS = 5000;
    let logScrollPinnedByUser = false;
    let logScrollIdleTimer = null;
    let copyLogResetTimer = null;

    function isLogModalOpen() {
        return !!(logModal && logModal.classList.contains('is-open'));
    }

    function isLogAtBottom() {
        if (!logContent) {
            return true;
        }
        return logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight <= LOG_SCROLL_BOTTOM_THRESHOLD;
    }

    function maybeScrollLogToBottom(force) {
        if (!logContent) {
            return;
        }
        if (force || !logScrollPinnedByUser) {
            logContent.scrollTop = logContent.scrollHeight;
        }
    }

    function scheduleLogScrollReenable() {
        if (logScrollIdleTimer) {
            clearTimeout(logScrollIdleTimer);
        }
        logScrollIdleTimer = setTimeout(function() {
            logScrollIdleTimer = null;
            logScrollPinnedByUser = false;
            maybeScrollLogToBottom(true);
        }, LOG_SCROLL_IDLE_MS);
    }

    function onLogContentScroll() {
        if (!isLogModalOpen()) {
            return;
        }
        if (isLogAtBottom()) {
            logScrollPinnedByUser = false;
            if (logScrollIdleTimer) {
                clearTimeout(logScrollIdleTimer);
                logScrollIdleTimer = null;
            }
            return;
        }
        logScrollPinnedByUser = true;
        scheduleLogScrollReenable();
    }

    function resetLogAutoScrollFollow() {
        logScrollPinnedByUser = false;
        if (logScrollIdleTimer) {
            clearTimeout(logScrollIdleTimer);
            logScrollIdleTimer = null;
        }
    }

    function getVisibleLogText() {
        const showError = !logFilterError || logFilterError.checked;
        const showWarning = !logFilterWarning || logFilterWarning.checked;
        return logs
            .filter(function(entry) {
                if (entry.level === 'error') return showError;
                if (entry.level === 'warning') return showWarning;
                return false;
            })
            .map(function(entry) { return entry.line; })
            .join('\n');
    }

    function renderLogContent() {
        const showError = !logFilterError || logFilterError.checked;
        const showWarning = !logFilterWarning || logFilterWarning.checked;
        const visible = logs.filter(function(entry) {
            if (entry.level === 'error') return showError;
            if (entry.level === 'warning') return showWarning;
            return false;
        });
        if (!visible.length) {
            logContent.textContent = locale.noLogs;
            return;
        }
        logContent.textContent = '';
        for (const entry of visible) {
            const lineEl = document.createElement('div');
            lineEl.className = entry.level === 'error' ? 'log-line-error' : 'log-line-warning';
            lineEl.textContent = entry.line;
            logContent.appendChild(lineEl);
        }
        maybeScrollLogToBottom();
    }

    function showModal(el) {
        if (el) el.classList.add('is-open');
    }
    function hideModal(el) {
        if (el) el.classList.remove('is-open');
    }

    function openLogModal() {
        resetLogAutoScrollFollow();
        renderLogContent();
        showModal(logModal);
        maybeScrollLogToBottom(true);
    }
    document.getElementById('closeLogBtn').addEventListener('click', function() {
        hideModal(logModal);
    });
    if (copyLogBtn) {
        copyLogBtn.addEventListener('click', function() {
            const text = getVisibleLogText();
            if (!text) return;
            copyToClipboard(text).then(function() {
                copyLogBtn.classList.add('copied');
                const prevText = copyLogBtn.textContent;
                copyLogBtn.textContent = locale.copied;
                if (copyLogResetTimer) clearTimeout(copyLogResetTimer);
                copyLogResetTimer = setTimeout(function() {
                    copyLogResetTimer = null;
                    copyLogBtn.classList.remove('copied');
                    copyLogBtn.textContent = prevText || locale.copy;
                }, 1500);
            });
        });
    }
    document.getElementById('clearLogBtn').addEventListener('click', function() {
        logs = [];
        renderLogContent();
    });
    if (logFilterError) logFilterError.addEventListener('change', renderLogContent);
    if (logFilterWarning) logFilterWarning.addEventListener('change', renderLogContent);
    if (logContent) {
        logContent.addEventListener('scroll', onLogContentScroll, { passive: true });
    }

    const COPY_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 2h8a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h0zm1 2v8h8V5H5zm-2 2h1v6h6v1H4a1 1 0 0 1-1-1V6h0z"/></svg>';
    const TAB_PIN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 1.3 11.5 3.6V6l2.2 2.1v1.2H10v4.2L9 14H7L6 13.5V9.3H2.3V8.1L4.5 6V3.6L6.8 1.3h2.4zm-.9 1.4H7.7L5.9 4.5V6.4L4.3 8h7.4L10.1 6.4V4.5L8.3 2.7z"/></svg>';
    const SELECT_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5V7zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2z"/><path d="M3.15 4.85l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M3.15 9.35l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M7.5 3h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1z"/></svg>';
    const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6 8 9.5 11.5 6l.7.7L8 10.9l-4.2-4.2.7-.7z"/></svg>';

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function() {
                fallbackCopyToClipboard(text);
            });
        }
        fallbackCopyToClipboard(text);
        return Promise.resolve();
    }

    function fallbackCopyToClipboard(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    function updateQuickActionBtns() {
        const hasMessages = messagesEl.querySelectorAll('.message-group').length > 0;
        const hasInput = !!inputEl.value.trim();
        if (copySessionBtn) copySessionBtn.disabled = !hasMessages;
        if (clearInputBtn) clearInputBtn.disabled = !hasInput;
        if (chatSearchInput) chatSearchInput.disabled = !hasMessages;
        if (!hasMessages) clearChatSearch();
        else if (chatSearchInput && chatSearchInput.value.trim()) scheduleChatSearch();
    }

    const chatSearchState = {
        query: '',
        matches: [],
        current: -1,
        timer: null,
    };

    function getMessageContentEl(group) {
        const bubble = group.querySelector('.message') || group;
        return bubble.querySelector('.content') || bubble.querySelector('.aux-body-content');
    }

    function clearSearchMarks() {
        document.querySelectorAll('mark.search-mark').forEach(function(mark) {
            const text = document.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(text, mark);
        });
        document.querySelectorAll('.message-group').forEach(function(group) {
            group.classList.remove('search-hit', 'search-hit-active');
        });
    }

    function wrapTextRange(root, start, end, active) {
        if (!root || start >= end) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            const nodeStart = offset;
            const nodeEnd = offset + text.length;
            if (nodeEnd <= start) {
                offset = nodeEnd;
                continue;
            }
            if (nodeStart >= end) break;

            const localStart = Math.max(0, start - nodeStart);
            const localEnd = Math.min(text.length, end - nodeStart);
            const before = text.slice(0, localStart);
            const middle = text.slice(localStart, localEnd);
            const after = text.slice(localEnd);
            const frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            const mark = document.createElement('mark');
            mark.className = active ? 'search-mark search-mark-active' : 'search-mark';
            mark.textContent = middle;
            frag.appendChild(mark);
            if (after) frag.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(frag, node);
            break;
        }
    }

    function updateChatSearchUI() {
        const total = chatSearchState.matches.length;
        const hasQuery = !!chatSearchState.query;
        if (chatSearchCount) {
            if (!hasQuery) {
                chatSearchCount.textContent = '';
                chatSearchCount.classList.remove('no-match');
            } else if (total === 0) {
                chatSearchCount.textContent = '0/0';
                chatSearchCount.classList.add('no-match');
            } else {
                chatSearchCount.textContent = (chatSearchState.current + 1) + '/' + total;
                chatSearchCount.classList.remove('no-match');
            }
        }
        const canNav = total > 0;
        if (chatSearchPrev) chatSearchPrev.disabled = !canNav;
        if (chatSearchNext) chatSearchNext.disabled = !canNav;
    }

    function applyChatSearchHighlight() {
        clearSearchMarks();
        if (chatSearchState.current < 0 || !chatSearchState.matches.length) {
            updateChatSearchUI();
            return;
        }
        chatSearchState.matches.forEach(function(match) {
            match.group.classList.add('search-hit');
        });
        const active = chatSearchState.matches[chatSearchState.current];
        active.group.classList.add('search-hit-active');

        const byRoot = new Map();
        chatSearchState.matches.forEach(function(match, idx) {
            const contentEl = getMessageContentEl(match.group);
            if (!contentEl) return;
            if (!byRoot.has(contentEl)) byRoot.set(contentEl, []);
            byRoot.get(contentEl).push({
                start: match.start,
                end: match.end,
                active: idx === chatSearchState.current,
            });
        });
        byRoot.forEach(function(ranges, root) {
            ranges.sort(function(a, b) { return b.start - a.start; });
            ranges.forEach(function(range) {
                wrapTextRange(root, range.start, range.end, range.active);
            });
        });

        active.group.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateChatSearchUI();
    }

    function runChatSearch() {
        if (!chatSearchInput) return;
        const query = chatSearchInput.value.trim();
        chatSearchState.query = query;
        chatSearchState.matches = [];
        chatSearchState.current = -1;
        clearSearchMarks();
        if (!query) {
            updateChatSearchUI();
            return;
        }
        const needle = query.toLowerCase();
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            const text = getMessagePlainText(group);
            const haystack = text.toLowerCase();
            let idx = 0;
            while ((idx = haystack.indexOf(needle, idx)) !== -1) {
                chatSearchState.matches.push({
                    group: group,
                    start: idx,
                    end: idx + query.length,
                });
                idx += needle.length || 1;
            }
        });
        if (chatSearchState.matches.length > 0) {
            chatSearchState.current = 0;
            applyChatSearchHighlight();
        } else {
            updateChatSearchUI();
        }
    }

    function scheduleChatSearch() {
        if (chatSearchState.timer) clearTimeout(chatSearchState.timer);
        chatSearchState.timer = setTimeout(function() {
            chatSearchState.timer = null;
            runChatSearch();
        }, 150);
    }

    function clearChatSearch() {
        if (chatSearchState.timer) {
            clearTimeout(chatSearchState.timer);
            chatSearchState.timer = null;
        }
        if (chatSearchInput) chatSearchInput.value = '';
        chatSearchState.query = '';
        chatSearchState.matches = [];
        chatSearchState.current = -1;
        clearSearchMarks();
        updateChatSearchUI();
    }

    function gotoChatSearchMatch(delta) {
        const total = chatSearchState.matches.length;
        if (!total) return;
        chatSearchState.current = (chatSearchState.current + delta + total) % total;
        applyChatSearchHighlight();
    }

    function getSessionPlainText() {
        const groups = messagesEl.querySelectorAll('.message-group');
        const lines = [];
        groups.forEach(function(group) {
            const role = group.classList.contains('user') ? locale.roleYou
                : group.classList.contains('assistant') ? assistantRoleLabel()
                : group.classList.contains('thought') ? auxiliaryRoleLabel('thought')
                : group.classList.contains('tool') ? auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText)
                : locale.roleMessage;
            const text = getGroupMarkdownText(group).trim();
            if (!text) return;
            lines.push(role + ':\n' + text);
        });
        return lines.join('\n\n');
    }

    function flashQuickActionBtn(btn, className, duration) {
        if (!btn) return;
        btn.classList.add(className || 'copied');
        setTimeout(function() {
            btn.classList.remove(className || 'copied');
        }, duration || 1500);
    }

    function isSelectableRole(role) {
        return role === 'user' || role === 'assistant' || role === 'thought' || role === 'tool';
    }

    function isGroupInContextAttachRegion(group) {
        // No divider: nothing sits outside the attachable region.
        void group;
        return true;
    }

    function getSelectableGroups() {
        return Array.from(messagesEl.querySelectorAll('.message-group.selectable')).filter(function(group) {
            if (group.style.display === 'none') {
                return false;
            }
            if (multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
                return false;
            }
            if (multiSelectPurpose === 'contextAttach' && !isAttachableMemoryGroup(group)) {
                return false;
            }
            return true;
        });
    }

    function getSelectedGroups() {
        return getSelectableGroups().filter(function(group) {
            return group.classList.contains('is-selected');
        });
    }

    function getGroupCheckbox(group) {
        return group.querySelector('.msg-select-wrap input[type="checkbox"]');
    }

    function setGroupSelected(group, selected) {
        group.classList.toggle('is-selected', selected);
        const checkbox = getGroupCheckbox(group);
        if (checkbox) checkbox.checked = selected;
        updateMultiSelectToolbar();
    }

    function setGroupsSelected(updates) {
        updates.forEach(function(entry) {
            entry.group.classList.toggle('is-selected', entry.selected);
            const checkbox = getGroupCheckbox(entry.group);
            if (checkbox) checkbox.checked = entry.selected;
        });
        updateMultiSelectToolbar();
    }

    function areAllSelectableGroupsSelected(groups) {
        return groups.length > 0 && groups.every(function(group) {
            return group.classList.contains('is-selected');
        });
    }

    function toggleGroupSelection(group) {
        setGroupSelected(group, !group.classList.contains('is-selected'));
    }

    function updateMultiSelectToolbar() {
        const selected = getSelectedGroups();
        const count = selected.length;
        const isAttachMode = multiSelectPurpose === 'contextAttach';
        if (multiSelectCount) {
            multiSelectCount.textContent = count > 0
                ? (locale.multiSelectCount || '{0} selected').replace('{0}', String(count))
                : (locale.selectMessages || 'Select');
        }
        const hasSelection = count > 0;
        if (multiSelectDeleteBtn) multiSelectDeleteBtn.disabled = !hasSelection;
        if (multiSelectCopyBtn) multiSelectCopyBtn.disabled = !hasSelection;
        if (multiSelectExportBtn) multiSelectExportBtn.disabled = !hasSelection;
        if (multiSelectAttachConfirmBtn) {
            multiSelectAttachConfirmBtn.hidden = !isAttachMode;
            multiSelectAttachConfirmBtn.disabled = !hasSelection;
        }
        const selectableGroups = getSelectableGroups();
        if (multiSelectAllBtn) {
            multiSelectAllBtn.textContent = areAllSelectableGroupsSelected(selectableGroups)
                ? (locale.multiSelectDeselectAll || '取消全选')
                : (locale.multiSelectAll || '全选');
        }
        if (isAttachMode) {
            updateContextAttachButtonLabel();
        }
        hideContextAttachPreview();
    }

    function enterMultiSelectMode(initialGroup, purpose) {
        multiSelectPurpose = purpose || 'normal';
        if (multiSelectMode) {
            if (initialGroup) {
                setGroupSelected(initialGroup, true);
            }
            updateMultiSelectToolbar();
            return;
        }
        multiSelectMode = true;
        messagesEl.classList.add('multi-select-active');
        if (multiSelectToolbar) {
            multiSelectToolbar.hidden = false;
            multiSelectToolbar.classList.add('visible');
        }
        if (initialGroup) {
            setGroupSelected(initialGroup, true);
        } else {
            updateMultiSelectToolbar();
        }
    }

    function exitMultiSelectMode() {
        if (!multiSelectMode) {
            return;
        }
        const wasAttachMode = multiSelectPurpose === 'contextAttach';
        if (wasAttachMode && contextAttachCustomPending && !contextAttachCustomConfirmed) {
            const indices = getSelectedMessageIndices();
            if (indices.length > 0) {
                contextAttachUnconfirmedIndices = indices.slice();
                contextAttachMode = 'custom';
            } else {
                contextAttachMode = 'none';
                contextAttachCustomPending = false;
                contextAttachUnconfirmedIndices = [];
            }
        }
        multiSelectMode = false;
        multiSelectPurpose = 'normal';
        messagesEl.classList.remove('multi-select-active');
        getSelectableGroups().forEach(function(group) {
            setGroupSelected(group, false);
        });
        clearContextAttachSelectableTargets();
        if (multiSelectToolbar) {
            multiSelectToolbar.hidden = true;
            multiSelectToolbar.classList.remove('visible');
        }
        updateMultiSelectToolbar();
        updateContextAttachButtonLabel();
    }

    function wireSelectableGroup(group) {
        if (group.dataset.selectWired) return;
        group.dataset.selectWired = '1';
        group.addEventListener('click', function(e) {
            if (!multiSelectMode) return;
            if (multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
                return;
            }
            if (e.target.closest('.message-actions, .block-actions, .insert-dropdown, .insert-dropdown-menu, .msg-select-wrap')) {
                return;
            }
            e.preventDefault();
            toggleGroupSelection(group);
        });
    }

    function assignSessionIndex(group) {
        group.dataset.sessionIndex = String(sessionMsgCounter++);
    }

    function reindexSessionIndices() {
        sessionMsgCounter = 0;
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            assignSessionIndex(group);
        });
    }

    let activeProfileName = '';
    function profileDisplayName() {
        if (activeProfileName) return activeProfileName;
        const el = document.getElementById('profileLabel');
        const text = el && el.textContent ? el.textContent.trim() : '';
        return text || 'hermes';
    }
    /** The composer says who you are talking to, which is the profile, not the product. */
    function applyInputPlaceholder() {
        if (!inputEl) return;
        const template = locale.inputPlaceholder || 'Chat with {profile}';
        inputEl.placeholder = String(template).replace('{profile}', profileDisplayName());
    }
    function assistantRoleLabel() {
        return profileDisplayName() + '@HermesHomeBase';
    }
    function toolNameFromAuxText(text) {
        const lines = String(text || '').split('\n');
        let first = '';
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim()) { first = lines[i].trim(); break; }
        }
        if (!first) return '';
        // tool cards start with "<status icon> <tool_name>: <preview>"
        first = first.replace(/^[^\w`$\/]+/, '').trim();
        const name = first.split(':')[0].trim();
        return name || '';
    }
    function auxiliaryRoleLabel(role, text) {
        const profile = profileDisplayName();
        if (role === 'thought') return profile + ' thinking';
        // older cards (and updates that carry no title) fall back to the literal 'Tool'
        const raw = toolNameFromAuxText(text);
        const name = raw === 'Tool' ? '' : raw;
        return profile + ' using Hermes' + (name ? ' ' + name : '');
    }
    function refreshRoleLabels() {
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

    function getGroupRoleLabel(group) {
        if (group.classList.contains('user')) return locale.roleYou;
        if (group.classList.contains('assistant')) return assistantRoleLabel();
        if (group.classList.contains('thought')) return auxiliaryRoleLabel('thought');
        if (group.classList.contains('tool')) return auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText);
        return locale.roleMessage;
    }

    /**
     * The card's own source text. Copying a message must not read the rendered DOM: the
     * per-block chrome (copy button, Insert menu and its labels) lives inside .content, so
     * DOM text carries button labels into the clipboard. The source text is what the card
     * is presenting; the DOM is one rendering of it.
     */
    function getGroupMarkdownText(group) {
        if (group._auxState && group._auxState.rawText) {
            return group._auxState.rawText;
        }
        if (group._rawText) {
            return group._rawText;
        }
        return getMessagePlainText(group);
    }

    /** Selection capture: how much quoted context one reply may carry. */
    const QUOTE_MAX_CHARS = 6000;
    /** Last non-empty selection, split per card. A click clears the selection before it
     *  reaches a handler, so this has to be computed on selectionchange, not on click. */
    let lastSelectionQuote = null;
    let selectionQuoteTimer = null;

    function groupsInOrder() {
        return Array.from(messagesEl.querySelectorAll('.message-group'));
    }

    /** The quoted text for one card, or null when the selection misses it. */
    function quoteSegmentForGroup(group, range) {
        // Clip against the card's body, never the record: the record also holds the role
        // label and the action chrome, and a quote must not carry either.
        const bubble = group.querySelector('.message') || group;
        const body = bubble.querySelector('.content') || bubble.querySelector('.aux-body-content') || bubble;
        const groupRange = document.createRange();
        groupRange.selectNodeContents(body);
        if (range.compareBoundaryPoints(Range.END_TO_START, groupRange) >= 0) return null;
        if (range.compareBoundaryPoints(Range.START_TO_END, groupRange) <= 0) return null;
        const clipped = range.cloneRange();
        if (clipped.compareBoundaryPoints(Range.START_TO_START, groupRange) < 0) {
            clipped.setStart(groupRange.startContainer, groupRange.startOffset);
        }
        if (clipped.compareBoundaryPoints(Range.END_TO_END, groupRange) > 0) {
            clipped.setEnd(groupRange.endContainer, groupRange.endOffset);
        }
        const text = (clipped.toString() || '').trim();
        if (!text) return null;
        return { role: getGroupRoleLabel(group), text: text, group: group };
    }

    /**
     * Turns the current selection into a structured quote: one segment per card it touches,
     * capped at QUOTE_MAX_CHARS. Returns { blocked } instead of failing silently when the
     * selection touches the bubble currently being streamed — that bubble is rebuilt on every
     * chunk, so the selection cannot survive it.
     */
    function captureSelectionQuote() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        const anchorEl = range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        if (!anchorEl || !messagesEl.contains(anchorEl)) return null;
        if (streamingMessageId) {
            const streaming = document.getElementById(streamingMessageId);
            if (streaming) {
                const sr = document.createRange();
                sr.selectNodeContents(streaming);
                const touches = !(range.compareBoundaryPoints(Range.END_TO_START, sr) >= 0
                    || range.compareBoundaryPoints(Range.START_TO_END, sr) <= 0);
                if (touches) return { blocked: 'streaming' };
            }
        }
        const segments = [];
        let chars = 0;
        let truncated = false;
        for (const group of groupsInOrder()) {
            const seg = quoteSegmentForGroup(group, range);
            if (!seg) continue;
            const room = QUOTE_MAX_CHARS - chars;
            if (room <= 0) { truncated = true; break; }
            if (seg.text.length > room) {
                seg.text = seg.text.slice(0, room);
                truncated = true;
            }
            chars += seg.text.length;
            segments.push(seg);
            if (truncated) break;
        }
        if (!segments.length) return null;
        return { segments: segments, chars: chars, truncated: truncated };
    }

    document.addEventListener('selectionchange', function() {
        if (selectionQuoteTimer) clearTimeout(selectionQuoteTimer);
        selectionQuoteTimer = setTimeout(function() {
            selectionQuoteTimer = null;
            lastSelectionQuote = captureSelectionQuote();
            updateQuoteAction(lastSelectionQuote);
        }, 120);
    });

    /** Read-only hook so the harness (and CDP) can assert the capture without a UI. */
    window.__tommysQuote = function() { return lastSelectionQuote; };

    function showComposerHint(message, seconds) {
        if (!composerHint) return;
        composerHint.textContent = message;
        composerHint.hidden = false;
        if (composerHintTimer) clearTimeout(composerHintTimer);
        composerHintTimer = setTimeout(function() {
            composerHint.hidden = true;
            composerHintTimer = null;
        }, (seconds || 10) * 1000);
    }

    function ensureQuoteAction() {
        if (quoteActionEl) return quoteActionEl;
        quoteActionEl = document.createElement('button');
        quoteActionEl.type = 'button';
        quoteActionEl.className = 'quote-action';
        quoteActionEl.hidden = true;
        quoteActionEl.addEventListener('click', function() {
            const stash = lastSelectionQuote;
            quoteActionEl.hidden = true;
            if (!stash) {
                showComposerHint(locale.replySelectionLost);
                return;
            }
            if (stash.blocked === 'streaming') {
                showComposerHint(locale.replyStreamingBlocked);
                return;
            }
            replyQuote = { segments: stash.segments.map(function(seg) { return { role: seg.role, text: seg.text }; }),
                           chars: stash.chars, truncated: stash.truncated };
            renderReplyQuote();
            inputEl.focus();
        });
        document.body.appendChild(quoteActionEl);
        return quoteActionEl;
    }

    function updateQuoteAction(stash) {
        const el = ensureQuoteAction();
        const sel = window.getSelection();
        if (!stash || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
            el.hidden = true;
            return;
        }
        if (!stash.segments && stash.blocked !== 'streaming') {
            el.hidden = true;
            return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        el.textContent = stash.blocked === 'streaming' ? locale.replyActionBlocked : locale.replyAction;
        el.hidden = false;
        const top = Math.min(window.innerHeight - 34, Math.max(8, rect.bottom + 6));
        const left = Math.min(window.innerWidth - 90, Math.max(8, rect.left));
        el.style.top = Math.round(top) + 'px';
        el.style.left = Math.round(left) + 'px';
    }

    function renderReplyQuote() {
        if (!replyQuoteEl) return;
        if (!replyQuote || !replyQuote.segments.length) {
            replyQuoteEl.hidden = true;
            return;
        }
        const count = replyQuote.segments.length;
        replyQuoteTitle.textContent = String(locale.replyTitle || '{count}').replace('{count}', count)
            + (replyQuote.truncated ? ' · ' + locale.replyTruncated : '');
        replyQuoteBody.innerHTML = '';
        replyQuote.segments.forEach(function(seg) {
            const row = document.createElement('div');
            row.className = 'reply-quote-segment';
            const role = document.createElement('span');
            role.className = 'reply-quote-role';
            role.textContent = seg.role + ': ';
            row.appendChild(role);
            row.appendChild(document.createTextNode(seg.text));
            replyQuoteBody.appendChild(row);
        });
        replyQuoteEl.classList.remove('is-collapsed');
        replyQuoteToggle.setAttribute('aria-expanded', 'true');
        replyQuoteToggle.textContent = '▾';
        replyQuoteEl.hidden = false;
        updateQuickActionBtns();
    }

    /**
     * Hermes has no record of the last message. Offer it back rather than leave the user to
     * retype it — never auto-send, and never overwrite a draft that is already there.
     */
    function offerUndeliveredMessage(text) {
        const value = (text || '').trim();
        if (!value || !undeliveredNotice) return;
        undeliveredText = text;
        undeliveredFilledComposer = inputEl.value.trim() === '';
        if (undeliveredFilledComposer) {
            inputEl.value = text;
            syncInputHeightFromContent();
            updateQuickActionBtns();
        }
        undeliveredNoticeText.textContent = locale.undeliveredNotice;
        const canSendIt = undeliveredFilledComposer && canSend;
        undeliveredPrimaryBtn.textContent = canSendIt ? locale.send : locale.undeliveredRestore;
        undeliveredDiscardBtn.textContent = locale.undeliveredDiscard;
        undeliveredNotice.hidden = false;
        undeliveredPrimaryBtn.focus();
    }

    function closeUndeliveredNotice(clearComposer) {
        if (clearComposer && undeliveredFilledComposer) {
            inputEl.value = '';
            syncInputHeightFromContent();
            updateQuickActionBtns();
        }
        if (undeliveredNotice) undeliveredNotice.hidden = true;
        undeliveredText = '';
        undeliveredFilledComposer = false;
    }

    if (undeliveredPrimaryBtn) {
        undeliveredPrimaryBtn.addEventListener('click', function() {
            const text = undeliveredText;
            const wasFilled = undeliveredFilledComposer;
            closeUndeliveredNotice(false);
            if (!text) return;
            if (wasFilled && canSend) {
                sendMessage();
                return;
            }
            // A draft was in the way, so restoring is all the user asked for.
            inputEl.value = text;
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        });
    }
    if (undeliveredDiscardBtn) {
        undeliveredDiscardBtn.addEventListener('click', function() { closeUndeliveredNotice(true); });
    }

    function clearReplyQuote() {
        replyQuote = null;
        if (replyQuoteEl) replyQuoteEl.hidden = true;
    }

    if (replyQuoteToggle) {
        replyQuoteToggle.addEventListener('click', function() {
            const collapsed = replyQuoteEl.classList.toggle('is-collapsed');
            replyQuoteToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            replyQuoteToggle.textContent = collapsed ? '▸' : '▾';
        });
    }
    if (replyQuoteClear) {
        replyQuoteClear.addEventListener('click', function() { clearReplyQuote(); });
    }

    /** The structured block a profile reads: delimiters, a role line per card, the text. */
    function withReplyQuote(text) {
        if (!replyQuote || !replyQuote.segments.length) return text;
        const lines = ['[replying-to]'];
        replyQuote.segments.forEach(function(seg) {
            lines.push('--- ' + seg.role + ' ---');
            lines.push(seg.text);
        });
        lines.push('[/replying-to]');
        const quoted = lines.join('\n');
        return text ? quoted + '\n\n' + text : quoted;
    }

    function getGroupsPlainText(groups) {
        const lines = [];
        groups.forEach(function(group) {
            const role = getGroupRoleLabel(group);
            const text = getGroupMarkdownText(group).trim();
            if (!text) return;
            lines.push(role + ':\n' + text);
        });
        return lines.join('\n\n');
    }

    function showSessionRenderBanner() {
        if (!chatBodyEl) return;
        let banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner) {
            banner = document.createElement('div');
            banner.id = SESSION_RENDER_BANNER_ID;
            banner.className = 'session-render-banner';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            banner.innerHTML = '<span class="session-render-spinner" aria-hidden="true"></span><span class="session-render-text"></span>';
            chatBodyEl.appendChild(banner);
        }
        banner.classList.remove('is-hiding');
        const textEl = banner.querySelector('.session-render-text');
        if (textEl) textEl.textContent = locale.sessionRendering || '';
        banner.hidden = false;
    }

    function forceHideSessionRenderBanner() {
        const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner) return;
        banner.classList.remove('is-hiding');
        banner.hidden = true;
    }

    function hideSessionRenderBanner() {
        const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner || banner.hidden || banner.classList.contains('is-hiding')) return;
        banner.classList.add('is-hiding');
        const onExitEnd = function(e) {
            if (e.target !== banner || e.animationName !== 'session-render-exit') return;
            banner.removeEventListener('animationend', onExitEnd);
            banner.hidden = true;
            banner.classList.remove('is-hiding');
        };
        banner.addEventListener('animationend', onExitEnd);
    }

    function cancelSessionMarkdownRender() {
        sessionRenderJobId++;
        // The cancelled job leaves raw text behind, so the work is still owed: remember it
        // instead of letting a newer restore silently inherit a half-converted transcript.
        sessionMarkdownPending = true;
        forceHideSessionRenderBanner();
    }

    function collectMarkdownRenderTargets() {
        const targets = [];
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            const assistantContent = group.querySelector('.message.assistant .content');
            if (assistantContent) {
                const text = group._rawText || assistantContent.textContent || '';
                if (text.trim()) {
                    targets.push({ kind: 'assistant', el: assistantContent, text: text, group: group });
                }
            }
            if (group._auxState && group._auxState.contentEl) {
                const text = group._auxState.rawText || group._auxState.contentEl.textContent || '';
                if (text.trim()) {
                    targets.push({ kind: 'aux', group: group, text: text });
                }
            }
        });
        return targets;
    }

    function renderMarkdownTarget(target) {
        if (target.kind === 'assistant') {
            target.group._rawText = target.text;
            target.el.innerHTML = renderMarkdown(target.text);
            setupContentBlocks(target.el);
            processFileRefs(target.el);
            const card = target.el.closest('.message');
            markMissingImages(target.el, !!(card && card._hasImages));
            return;
        }
        if (target.kind === 'aux') {
            setAuxiliaryContent(target.group, target.text);
        }
    }

    function scheduleSessionMarkdownRender() {
        // requestAnimationFrame does not fire while the webview is off screen, so a pane
        // restored in the background would keep its raw text forever. Record the debt and
        // let the visibility handler below resume it.
        if (document.visibilityState === 'hidden') {
            sessionMarkdownPending = true;
            return;
        }
        const jobId = ++sessionRenderJobId;
        const targets = collectMarkdownRenderTargets();
        if (!targets.length) {
            sessionMarkdownPending = false;
            hideSessionRenderBanner();
            window._hermesRendered = true;
            if (chatSearchState.query) scheduleChatSearch();
            return;
        }
        sessionMarkdownPending = true;
        showSessionRenderBanner();
        let index = 0;
        function runBatch() {
            if (jobId !== sessionRenderJobId) return;
            const end = Math.min(index + MARKDOWN_RENDER_BATCH_SIZE, targets.length);
            for (; index < end; index++) {
                renderMarkdownTarget(targets[index]);
            }
            if (index < targets.length) {
                requestAnimationFrame(runBatch);
            } else {
                sessionMarkdownPending = false;
                hideSessionRenderBanner();
                window._hermesRendered = true;
                // The sweep replaced raw text with formatted blocks, so the transcript is
                // taller than it was when the batches scrolled: land on the new bottom.
                maybeScrollToBottom(true);
                if (chatSearchState.query) scheduleChatSearch();
            }
        }
        requestAnimationFrame(runBatch);
    }

    // The sweep only runs while the page can animate; resume it the moment the pane is
    // shown again, instead of leaving the transcript as raw text until the next reload.
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState !== 'visible') {
            return;
        }
        if (sessionMarkdownPending || !window._hermesRendered) {
            scheduleSessionMarkdownRender();
        }
    });

    function getSelectedMessageIndices(groups) {
        return (groups || getSelectedGroups()).map(function(group) {
            return parseInt(group.dataset.sessionIndex || '', 10);
        }).filter(function(index) {
            return Number.isInteger(index) && index >= 0;
        });
    }

    function requestSessionExport(action, indices, sessionId) {
        const sid = sessionId || lastActiveSessionId;
        if (!sid) return;
        vscode.postMessage({
            type: 'sessionExport',
            sessionId: sid,
            action: action,
            indices: indices && indices.length ? indices : undefined,
        });
    }

    function getGroupsMarkdown(groups) {
        const parts = [];
        groups.forEach(function(group) {
            const role = getGroupRoleLabel(group);
            const text = getGroupMarkdownText(group).trim();
            if (!text) return;
            parts.push('## ' + role + '\n\n' + text);
        });
        return parts.join('\n\n');
    }

    function deleteSelectedGroups() {
        const selected = getSelectedGroups();
        if (!selected.length) return;
        const indices = selected.map(function(group) {
            return parseInt(group.dataset.sessionIndex || '', 10);
        }).filter(function(index) {
            return Number.isInteger(index) && index >= 0;
        });
        vscode.postMessage({ type: 'deleteMessages', indices: indices });
        selected.forEach(function(group) {
            group.remove();
        });
        reindexSessionIndices();
        exitMultiSelectMode();
        updateQuickActionBtns();
        if (!messagesEl.querySelector('.message-group')) {
            placeholder.style.display = 'block';
        }
    }

    function exportSelectedGroups() {
        const indices = getSelectedMessageIndices();
        if (!indices.length) return;
        requestSessionExport('export', indices);
    }

    function getMessagePlainText(group) {
        const bubble = group.querySelector('.message') || group;
        const content = bubble.querySelector('.content');
        if (content) return content.textContent || '';
        const aux = bubble.querySelector('.aux-body-content');
        if (aux) return aux.textContent || '';
        return '';
    }

    function attachMessageActions(group, inner) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        actions.addEventListener('click', function(e) { e.stopPropagation(); });

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-btn action-btn';
        copyBtn.title = locale.copy;
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const text = getGroupMarkdownText(group).trim();
            if (!text) return;
            copyToClipboard(text).then(function() {
                copyBtn.classList.add('copied');
                copyBtn.title = locale.copied;
                setTimeout(function() {
                    copyBtn.classList.remove('copied');
                    copyBtn.title = locale.copy;
                }, 1500);
            });
        });
        actions.appendChild(copyBtn);

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'select-btn action-btn';
        selectBtn.title = locale.selectMessages;
        selectBtn.innerHTML = SELECT_ICON_SVG;
        selectBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            enterMultiSelectMode(group);
        });
        actions.appendChild(selectBtn);

        inner.appendChild(actions);
    }

    function attachCopyButton(group) {
        const stack = group.querySelector('.message-stack');
        if (stack) attachMessageActions(group, stack);
    }

    /** Every card carries an element id; search, selection and streaming use it. */
    function newMessageId() {
        return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    }

    /**
     * The wrapper a message lives in: identity, selection and order.
     *
     * The id is minted here unless the caller brings its own, which a permission
     * request does. Nothing about the card lives here.
     */
    function createGroup(role, id) {
        const group = document.createElement('div');
        group.className = 'message-group ' + role;
        group.id = id || newMessageId();
        if (isSelectableRole(role)) {
            group.classList.add('selectable');
            const selectWrap = document.createElement('label');
            selectWrap.className = 'msg-select-wrap';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.addEventListener('click', function(e) {
                e.stopPropagation();
            });
            checkbox.addEventListener('change', function() {
                setGroupSelected(group, checkbox.checked);
            });
            selectWrap.appendChild(checkbox);
            group.appendChild(selectWrap);
            wireSelectableGroup(group);
        }
        assignSessionIndex(group);
        return group;
    }

    /**
     * The card itself: structure and class names only. Colour, radius, spacing and
     * font all come from chat.css reading those classes.
     */
    function buildMessage(role, text, options) {
        const card = document.createElement('div');
        card.className = 'message ' + role;
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = role === 'user' ? locale.roleYou : assistantRoleLabel();
        card.appendChild(label);
        const content = document.createElement('div');
        content.className = 'content';
        content.textContent = text;
        card.appendChild(content);
        // Render staged/pasted images inline in the sent user bubble.
        const images = options && options.images;
        if (role === 'user' && Array.isArray(images) && images.length > 0) {
            const gallery = document.createElement('div');
            gallery.className = 'message-image-gallery';
            for (const img of images) {
                if (!img || !img.data) continue;
                const el = document.createElement('img');
                el.className = 'message-image';
                el.src = 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.data;
                el.alt = 'pasted image';
                gallery.appendChild(el);
            }
            if (gallery.childNodes.length > 0) card.appendChild(gallery);
        }
        card._hasImages = !!(role === 'user' && Array.isArray(images) && images.length > 0);
        if (role === 'user' || role === 'assistant') {
            markMissingImages(content, card._hasImages);
        }
        if (role === 'user') {
            processFileRefs(content);
        }
        return card;
    }

    /** The card plus the pieces the caller has to wire. */
    function buildCard(role, text, options) {
        if (role === 'tool' || role === 'thought') {
            const auxParts = buildAuxiliaryMessage(role, text);
            if (!(options && options.restore)) {
                auxParts.div.classList.add('is-live');
            }
            return { card: auxParts.div, auxParts: auxParts };
        }
        return { card: buildMessage(role, text, options), auxParts: null };
    }

    /** Put one card in the transcript: identity first, then the card, then mount. */
    function mountMessage(group, built, options) {
        const restoring = options && options.restore;
        const role = group.classList[1];
        const container = document.createElement('div');
        container.className = 'message-container';
        // The checkbox is created with the record but has to live in the row that
        // places it, so the container adopts it before the stack goes in.
        const selectWrap = group.querySelector('.msg-select-wrap');
        if (selectWrap) {
            container.appendChild(selectWrap);
        }
        const stack = document.createElement('div');
        stack.className = 'message-stack';
        stack.appendChild(built.card);
        if (built.auxParts) {
            wireAuxiliaryMessage(group, built.auxParts, !!(restoring && options && options.deferMarkdown));
        }
        attachMessageActions(group, stack);
        container.appendChild(stack);
        group.appendChild(container);
        messagesEl.appendChild(group);
        // Apply visibility filter for thought/tool messages
        if (role === 'thought' && !window._showThoughts) group.style.display = 'none';
        if (role === 'tool' && !window._showToolCalls) group.style.display = 'none';
        return group.id;
    }

    /** Add one message of any role to the transcript. */
    function appendMessage(role, text, options) {
        const restoring = options && options.restore;
        placeholder.style.display = 'none';

        // For streaming assistant messages, update the last one (not when restoring history)
        if (!restoring && role === 'assistant' && streamingMessageId) {
            const last = document.getElementById(streamingMessageId);
            if (last) {
                last.querySelector('.content').textContent = text;
                last._rawText = text;
                if (chatSearchState.query) scheduleChatSearch();
                maybeScrollToBottom();
                return streamingMessageId;
            }
        }

        const group = createGroup(role);
        const built = buildCard(role, text, options);
        if (built.auxParts === null) {
            group._rawText = text;
        }

        // Mark as streaming if assistant message (live stream only)
        if (role === 'assistant' && !restoring) {
            resetToolAggregation();
            built.card.classList.add('streaming');
            streamingMessageId = group.id;
            clearAllToolLive();
            enableStopAfterAgentOutput();
        }
        if (role === 'assistant') {
            group._rawText = text;
        }
        if (!restoring && role === 'thought') {
            resetToolAggregation();
        }
        if (!restoring && (role === 'thought' || role === 'tool')) {
            enableStopAfterAgentOutput();
        }

        const id = mountMessage(group, built, options);
        updateQuickActionBtns();
        if (chatSearchState.query) scheduleChatSearch();
        maybeScrollToBottom();
        return id;
    }

    /** A "[screenshot]" with no attachment behind it: say so in red instead of leaving the token. */
    function markMissingImages(root, hasImages) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const hits = [];
        let node;
        while ((node = walker.nextNode())) {
            if (/\[(screenshot|image)\]/i.test(node.textContent)) hits.push(node);
        }
        hits.forEach(function(textNode) {
            const parts = textNode.textContent.split(/(\[(?:screenshot|image)\])/i);
            const frag = document.createDocumentFragment();
            let lastNode = null;
            const appendText = function(value) {
                if (!value) return;
                let text = value;
                // Only fold the space when the previous sibling is text: a red statement in
                // between keeps the two words apart.
                if (lastNode && lastNode.nodeType === 3 && /\s$/.test(lastNode.textContent) && /^\s/.test(text)) {
                    text = text.replace(/^\s+/, '');
                }
                if (!text) return;
                const node = document.createTextNode(text);
                frag.appendChild(node);
                lastNode = node;
            };
            parts.forEach(function(part) {
                if (/^\[(screenshot|image)\]$/i.test(part)) {
                    // With the attachment present the token is noise; without it the user has to
                    // know the picture exists and is not here.
                    if (hasImages) return;
                    const span = document.createElement('span');
                    span.className = 'image-missing';
                    span.textContent = locale.imageMissing;
                    frag.appendChild(span);
                    lastNode = span;
                } else if (part) {
                    appendText(part);
                }
            });
            if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
        });
    }

    function escapeHtmlEntities(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function renderMarkdown(text) {
        // A message is data, not markup. Raw HTML in it is turned into characters before
        // rendering, so nothing typed or echoed into the transcript — a tool result printing
        // the pane's own HTML included — can create elements the pane later looks up by id.
        // Markdown still formats; fenced code still shows its tags literally.
        let html;
        if (typeof marked.lexer === 'function' && typeof marked.parser === 'function') {
            const tokens = marked.lexer(String(text == null ? '' : text));
            const scrubRawHtml = function(list) {
                for (const token of list) {
                    if (!token) continue;
                    if (token.type === 'html') {
                        const raw = token.text != null ? token.text : token.raw;
                        token.text = escapeHtmlEntities(raw);
                        token.raw = token.text;
                    }
                    if (Array.isArray(token.tokens)) scrubRawHtml(token.tokens);
                    if (Array.isArray(token.items)) scrubRawHtml(token.items);
                }
            };
            scrubRawHtml(tokens);
            html = marked.parser(tokens);
        } else {
            html = marked.parse(String(text == null ? '' : text).replace(/</g, '&lt;'));
        }
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, {
                USE_PROFILES: { html: true },
                ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            });
        }
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('*').forEach(function(n) {
            if (!n.attributes) return;
            for (let i = n.attributes.length - 1; i >= 0; i--) {
                const attr = n.attributes[i];
                if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:'))) {
                    n.removeAttribute(attr.name);
                }
            }
        });
        return div.innerHTML;
    }

    function clearAllToolLive() {
        Object.keys(toolCallMap).forEach(function(key) {
            const group = document.getElementById(toolCallMap[key]);
            const msg = group && group.querySelector('.message.tool');
            if (msg) msg.classList.remove('is-live');
        });
    }

    function setAuxMessageLive(group, live) {
        if (!group) return;
        const msg = group.querySelector('.message.thought, .message.tool');
        if (msg) msg.classList.toggle('is-live', live);
    }

    function finalizeAssistantBubble() {
        if (thoughtMsgId) {
            const thoughtGroup = document.getElementById(thoughtMsgId);
            setAuxMessageLive(thoughtGroup, false);
            finalizeAuxiliaryBubble(thoughtGroup);
            thoughtMsgId = null;
        }
        clearAllToolLive();
        if (streamingMessageId) {
            const group = document.getElementById(streamingMessageId);
            const el = group ? group.querySelector('.message') : null;
            if (el) {
                el.classList.remove('streaming');
                const text = el.querySelector('.content').textContent;
                if (group) group._rawText = text;
                el.querySelector('.content').innerHTML = renderMarkdown(text);
                setupContentBlocks(el.querySelector('.content'));
                processFileRefs(el.querySelector('.content'));
            }
            streamingMessageId = null;
        }
        if (chatSearchState.query) scheduleChatSearch();
    }

    function enableStopAfterAgentOutput() {
        if (!awaitingFirstChunk) {
            return;
        }
        awaitingFirstChunk = false;
        if (isPrompting) {
            setInputMode('stop');
        }
    }

    function finishStreaming() {
        finalizeAssistantBubble();
        if (isPrompting && awaitingFirstChunk) {
            setInputMode('waiting');
        } else {
            setInputMode(isPrompting ? 'stop' : (canSend ? 'send' : 'disabled'));
        }
    }

    function appendToInput(text) {
        if (!text) return;
        hideFilePicker();
        const val = inputEl.value;
        const needsSep = val.length > 0 && !/\n$/.test(val);
        inputEl.value = val + (needsSep ? '\n' : '') + text;
        if (!inputEl.disabled) {
            const pos = inputEl.value.length;
            inputEl.setSelectionRange(pos, pos);
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        }
    }

    function insertIntoInput(text) {
        if (!text) return;
        hideFilePicker();
        const val = inputEl.value;
        const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : val.length;
        const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : start;
        inputEl.value = val.slice(0, start) + text + val.slice(end);
        if (!inputEl.disabled) {
            const pos = start + text.length;
            inputEl.setSelectionRange(pos, pos);
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        }
    }

    function insertToEditor(text) {
        if (!text) return;
        vscode.postMessage({ type: 'insertEditor', text: text });
    }

    function closeInsertDropdowns(except) {
        document.querySelectorAll('.insert-dropdown.is-open').forEach(function(dropdown) {
            if (except && dropdown === except) return;
            dropdown.classList.remove('is-open');
        });
    }

    function createInsertDropdown(getText) {
        const dropdown = document.createElement('div');
        dropdown.className = 'insert-dropdown';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'block-btn insert-toggle';
        toggle.innerHTML = escapeHtml(locale.insertMenu || locale.insert) + CHEVRON_DOWN_SVG;
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = dropdown.classList.contains('is-open');
            closeInsertDropdowns();
            dropdown.classList.toggle('is-open', !open);
        });

        const menu = document.createElement('div');
        menu.className = 'insert-dropdown-menu';

        const inputBtn = document.createElement('button');
        inputBtn.type = 'button';
        inputBtn.textContent = locale.insertToInput;
        inputBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeInsertDropdowns();
            if (inputEl.disabled) return;
            appendToInput(getText());
        });

        const editorBtn = document.createElement('button');
        editorBtn.type = 'button';
        editorBtn.textContent = locale.insertToEditor;
        editorBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeInsertDropdowns();
            insertToEditor(getText());
        });

        menu.appendChild(inputBtn);
        menu.appendChild(editorBtn);
        dropdown.appendChild(toggle);
        dropdown.appendChild(menu);
        return dropdown;
    }

    /** copyPayload is what the clipboard gets; getText stays the Insert menu's payload. */
    function addBlockActions(container, getText, copyPayload, copyTitle) {
        if (container.querySelector('.block-actions')) return;
        const actions = document.createElement('div');
        actions.className = 'block-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'block-btn';
        const copyLabel = copyTitle || locale.copy;
        copyBtn.title = copyLabel;
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            copyToClipboard((copyPayload || getText)()).then(function() {
                copyBtn.classList.add('copied');
                copyBtn.title = locale.copied;
                setTimeout(function() {
                    copyBtn.classList.remove('copied');
                    copyBtn.title = copyLabel;
                }, 1500);
            });
        });

        actions.appendChild(copyBtn);
        actions.appendChild(createInsertDropdown(getText));
        container.appendChild(actions);
    }

    function tableToMarkdown(table) {
        const rows = [];
        table.querySelectorAll('tr').forEach(function(tr) {
            const cells = [];
            tr.querySelectorAll('th, td').forEach(function(cell) {
                cells.push((cell.textContent || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim());
            });
            if (cells.length) rows.push(cells);
        });
        if (!rows.length) return '';
        const widths = rows[0].map(function(_, index) {
            return Math.max.apply(null, rows.map(function(row) {
                return (row[index] || '').length;
            }));
        });
        const formatRow = function(row) {
            return '| ' + row.map(function(cell, index) {
                return (cell || '').padEnd(widths[index], ' ');
            }).join(' | ') + ' |';
        };
        const header = formatRow(rows[0]);
        const divider = '| ' + widths.map(function(width) {
            return '-'.repeat(Math.max(3, width));
        }).join(' | ') + ' |';
        const body = rows.slice(1).map(formatRow);
        return [header, divider].concat(body).join('\n');
    }

    function setupTableBlock(table) {
        if (!table || table.dataset.blockReady) return;
        table.dataset.blockReady = '1';
        const wrap = document.createElement('div');
        wrap.className = 'block-actions-wrap';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
        addBlockActions(wrap, function() {
            return tableToMarkdown(table);
        });
    }

    function setupCodeBlock(codeBlock) {
        const pre = codeBlock.closest('pre');
        if (!pre || pre.dataset.blockReady) return;
        pre.dataset.blockReady = '1';
        hljs.highlightElement(codeBlock);
        const lang = (codeBlock.className.match(/language-(\w+)/) || [])[1] || '';
        const wrap = document.createElement('div');
        wrap.className = 'block-actions-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        // Copy hands over the code itself: a shell command with a fence around it is not
        // a command. The Insert menu keeps the fenced form, which is the portable one for
        // pasting into a document.
        addBlockActions(wrap, function() {
            const code = codeBlock.textContent || '';
            if (!lang) return code;
            return '```' + lang + '\n' + code + '\n```';
        }, function() {
            // No trailing newline: pasting into a terminal would run it. Whether a command
            // executes is the developer's decision, not the clipboard's.
            return (codeBlock.textContent || '').replace(/[\r\n]+$/, '');
        }, locale.copyCode);
    }

    function setupContentBlocks(container) {
        if (!container) return;
        container.querySelectorAll('pre code').forEach(function(block) {
            setupCodeBlock(block);
        });
        container.querySelectorAll('table').forEach(function(table) {
            setupTableBlock(table);
        });
    }

    function hideFilePreview() {
        if (previewHideTimer) {
            clearTimeout(previewHideTimer);
            previewHideTimer = null;
        }
        if (previewTooltip) {
            previewTooltip.remove();
            previewTooltip = null;
        }
    }

    function showFilePreview(path, content, error) {
        hideFilePreview();
        previewTooltip = document.createElement('div');
        previewTooltip.className = 'file-preview-tooltip';
        const header = document.createElement('div');
        header.className = 'fp-header';
        header.textContent = path;
        previewTooltip.appendChild(header);
        if (error) {
            const err = document.createElement('div');
            err.className = 'fp-error';
            err.textContent = error;
            previewTooltip.appendChild(err);
        } else {
            const pre = document.createElement('pre');
            pre.textContent = content || locale.emptyFile;
            previewTooltip.appendChild(pre);
        }
        document.body.appendChild(previewTooltip);
    }

    function positionFilePreview(anchor) {
        if (!previewTooltip || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const tip = previewTooltip.getBoundingClientRect();
        let top = rect.bottom + 6;
        let left = rect.left;
        if (top + tip.height > window.innerHeight - 8) {
            top = rect.top - tip.height - 6;
        }
        if (left + tip.width > window.innerWidth - 8) {
            left = window.innerWidth - tip.width - 8;
        }
        previewTooltip.style.top = Math.max(8, top) + 'px';
        previewTooltip.style.left = Math.max(8, left) + 'px';
    }

    function attachFileRefPreview(link) {
        if (link.dataset.previewReady) return;
        link.dataset.previewReady = '1';
        let enterTimer = null;
        link.addEventListener('mouseenter', function () {
            enterTimer = setTimeout(function () {
                const filePath = link.dataset.path || link.textContent.replace(/^@/, '');
                const reqId = String(++previewRequestId);
                previewRequests.set(reqId, link);
                vscode.postMessage({ type: 'previewFile', path: filePath, requestId: reqId });
            }, 250);
        });
        link.addEventListener('mouseleave', function () {
            if (enterTimer) clearTimeout(enterTimer);
            previewHideTimer = setTimeout(hideFilePreview, 150);
        });
    }

    function processFileRefs(container) {
        if (!container) return;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.parentElement && node.parentElement.closest('pre, code, a.file-ref')) continue;
            const text = node.textContent || '';
            const refRegex = /@([\w./\\\-]+(?:\.[a-zA-Z0-9]+)?)/g;
            let match;
            let lastIdx = 0;
            const parts = [];
            while ((match = refRegex.exec(text)) !== null) {
                const before = text.slice(lastIdx, match.index);
                if (before) parts.push(document.createTextNode(before));
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'file-ref';
                link.textContent = match[0];
                link.title = locale.fileLinkTitle;
                link.dataset.path = match[1];
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    vscode.postMessage({ type: 'openFile', path: match[1] });
                });
                attachFileRefPreview(link);
                parts.push(link);
                lastIdx = match.index + match[0].length;
            }
            if (parts.length > 0) {
                const remaining = text.slice(lastIdx);
                if (remaining) parts.push(document.createTextNode(remaining));
                nodesToReplace.push({ node, parts });
            }
        }
        for (const { node, parts } of nodesToReplace) {
            const parent = node.parentNode;
            if (!parent) continue;
            const fragment = document.createDocumentFragment();
            parts.forEach(p => fragment.appendChild(p));
            parent.replaceChild(fragment, node);
        }
    }

    function hideFilePicker() {
        filePickerVisible = false;
        mentionStart = -1;
        filePickerItems = [];
        filePickerIndex = 0;
        filePickerEl.classList.remove('visible');
        filePickerEl.innerHTML = '';
    }

    function renderFilePickerItems(files) {
        filePickerItems = files || [];
        filePickerIndex = 0;
        filePickerEl.innerHTML = '';
        if (filePickerItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-picker-empty';
            empty.textContent = locale.noMatchingFiles;
            filePickerEl.appendChild(empty);
        } else {
            filePickerItems.forEach(function (filePath, idx) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'file-picker-item' + (idx === 0 ? ' active' : '');
                btn.textContent = '@' + filePath;
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    selectFileMention(filePath);
                });
                filePickerEl.appendChild(btn);
            });
        }
        filePickerEl.classList.add('visible');
        filePickerVisible = true;
    }

    function updateFilePickerHighlight() {
        filePickerEl.querySelectorAll('.file-picker-item').forEach(function (el, idx) {
            el.classList.toggle('active', idx === filePickerIndex);
            if (idx === filePickerIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function selectFileMention(filePath) {
        if (mentionStart < 0) return;
        const val = inputEl.value;
        const before = val.slice(0, mentionStart);
        const after = val.slice(inputEl.selectionStart);
        const insertion = '@' + filePath + ' ';
        inputEl.value = before + insertion + after;
        const cursor = before.length + insertion.length;
        inputEl.setSelectionRange(cursor, cursor);
        syncInputHeightFromContent();
        hideFilePicker();
        inputEl.focus();
    }

    function detectFileMention() {
        const val = inputEl.value;
        const pos = inputEl.selectionStart;
        const before = val.slice(0, pos);
        const match = before.match(/@([\w./\\\-]*)$/);
        if (!match) {
            hideFilePicker();
            return;
        }
        mentionStart = pos - match[0].length;
        const query = match[1] || '';
        if (fileListDebounce) clearTimeout(fileListDebounce);
        fileListDebounce = setTimeout(function () {
            const reqId = String(++fileListRequestId);
            filePickerEl.dataset.requestId = reqId;
            filePickerEl.innerHTML = '<div class="file-picker-empty">' + escapeHtml(locale.searchingFiles) + '</div>';
            filePickerEl.classList.add('visible');
            filePickerVisible = true;
            vscode.postMessage({ type: 'listFiles', query: query, requestId: reqId });
        }, 120);
    }

    /** Publish the picker row's real width so the composer bar stops reserving a fixed
     *  350px: at narrow widths that guess left the token ring on top of the Send button.
     */
    function pickerRowReserve() {
        const shell = document.querySelector('.input-composite-shell');
        const row = document.querySelector('.input-picker-row');
        if (!shell || !row) return;
        const shellW = shell.clientWidth;
        if (!shellW) return;
        const left = row.getBoundingClientRect().left;
        let used = 0;
        Array.prototype.forEach.call(row.children, function(el) {
            if (el.hidden || el.style.display === 'none') return;
            const r = el.getBoundingClientRect();
            if (r.width > 0) used = Math.max(used, r.right - left);
        });
        const cap = Math.max(shellW - 104, 0);
        const reserve = Math.round(Math.min(Math.max(used, 0), cap));
        if (shell.dataset.pickerReserve === String(reserve)) return;
        shell.dataset.pickerReserve = String(reserve);
        shell.style.setProperty('--picker-reserve', reserve + 'px');
    }

    function wirePickerRowReserve() {
        const shell = document.querySelector('.input-composite-shell');
        const row = document.querySelector('.input-picker-row');
        if (!shell || !row) return;
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(function() { pickerRowReserve(); });
            ro.observe(shell);
            Array.prototype.forEach.call(row.children, function(el) { ro.observe(el); });
        }
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function() { pickerRowReserve(); })
                .observe(row, { childList: true, subtree: false });
        }
        window.addEventListener('resize', pickerRowReserve);
        pickerRowReserve();
    }

    function resetChatView() {
        cancelSessionMarkdownRender();
        clearChatSearch();
        exitMultiSelectMode();
        forceHideContextAttachPicker();
        messagesEl.innerHTML = '<div class="placeholder" id="placeholder">' + escapeHtml(emptyStateText()) + '</div>';
        placeholder = document.getElementById('placeholder');
        streamingMessageId = null;
        thoughtMsgId = null;
        toolCallMap = {};
        sessionMsgCounter = 0;
        resetToolAggregation();
        pendingPermissions.clear();
        window._hermesRendered = false;
        updateQuickActionBtns();
        updateTokenUsage(0, 0);
        setInputMode(canSend ? 'send' : 'disabled');
    }

    function newChat() {
        resetChatView();
    }

    function restoreHistory(messages, localHistoryOnly) {
        cancelSessionMarkdownRender();
        // A freshly restored transcript opens at its end; a pin left over from the previous
        // page would otherwise keep the pane wherever it happened to be.
        scrollPinnedByUser = false;
        streamingMessageId = null;
        thoughtMsgId = null;
        toolCallMap = {};
        sessionMsgCounter = 0;
        resetToolAggregation();
        pendingPermissions.clear();
        window._hermesRendered = false;
        exitMultiSelectMode();
        if (!messages || messages.length === 0) {
                return;
        }
        placeholder.style.display = 'none';
        let cursor = 0;
        function appendRestoreBatch() {
            const end = Math.min(cursor + RESTORE_BATCH_SIZE, messages.length);
            for (; cursor < end; cursor++) {
                const m = messages[cursor];
                if (m.role === 'permission') {
                    restorePermissionMessage(m);
                } else {
                    appendMessage(m.role, m.text, { restore: true, deferMarkdown: true, images: m.images });
                }
            }
            if (cursor < messages.length) {
                requestAnimationFrame(appendRestoreBatch);
                return;
            }
            updateQuickActionBtns();
            scheduleSessionMarkdownRender();
            maybeScrollToBottom(true);
        }
        requestAnimationFrame(appendRestoreBatch);
    }

        function sendMessage() {
        const text = inputEl.value.trim();
        const hasImages = pendingImages.length > 0;
        // Allow sending with either text OR staged images.
        if ((!text && !hasImages) || !canSend) return;

        if (hasUnconfirmedCustomMemorySelection()) {
            openContextAttachSendModal(text);
            return;
        }

        executeSendMessage(text);
    }

    // Auto-resize + @file mention
    inputEl.addEventListener('input', function() {
        syncInputHeightFromContent();
        detectFileMention();
        updateQuickActionBtns();
    });

    // Enter to send, Shift+Enter for newline; file picker navigation
    inputEl.addEventListener('keydown', function(e) {
        if (filePickerVisible && filePickerItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                filePickerIndex = (filePickerIndex + 1) % filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                filePickerIndex = (filePickerIndex - 1 + filePickerItems.length) % filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectFileMention(filePickerItems[filePickerIndex]);
                return;
            }
        }
        if (e.key === 'Escape' && filePickerVisible) {
            e.preventDefault();
            hideFilePicker();
            return;
        }
        if (e.key === 'Escape' && multiSelectMode) {
            e.preventDefault();
            exitMultiSelectMode();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    if (quickToggleBtn) {
        quickToggleBtn.addEventListener('click', toggleQuickPanel);
    }

    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', scheduleChatSearch);
        chatSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                gotoChatSearchMatch(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                gotoChatSearchMatch(1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) gotoChatSearchMatch(-1);
                else gotoChatSearchMatch(1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                clearChatSearch();
            }
        });
    }
    if (chatSearchPrev) {
        chatSearchPrev.addEventListener('click', function() { gotoChatSearchMatch(-1); });
    }
    if (chatSearchNext) {
        chatSearchNext.addEventListener('click', function() { gotoChatSearchMatch(1); });
    }

    if (multiSelectAllBtn) {
        multiSelectAllBtn.addEventListener('click', function() {
            if (!multiSelectMode) {
                enterMultiSelectMode(null, multiSelectPurpose);
            }
            const groups = getSelectableGroups();
            const selectAll = !areAllSelectableGroupsSelected(groups);
            setGroupsSelected(groups.map(function(group) {
                return { group: group, selected: selectAll };
            }));
        });
    }
    if (multiSelectDeleteBtn) {
        multiSelectDeleteBtn.addEventListener('click', function() {
            if (multiSelectDeleteBtn.disabled) return;
            deleteSelectedGroups();
        });
    }
    if (multiSelectCopyBtn) {
        multiSelectCopyBtn.addEventListener('click', function() {
            if (multiSelectCopyBtn.disabled) return;
            const indices = getSelectedMessageIndices();
            if (!indices.length) return;
            requestSessionExport('copy', indices);
        });
    }
    if (multiSelectExportBtn) {
        multiSelectExportBtn.addEventListener('click', function() {
            if (multiSelectExportBtn.disabled) return;
            exportSelectedGroups();
        });
    }
    if (multiSelectExitBtn) {
        multiSelectExitBtn.addEventListener('click', exitMultiSelectMode);
    }
    if (multiSelectAttachConfirmBtn) {
        multiSelectAttachConfirmBtn.addEventListener('click', function() {
            if (multiSelectAttachConfirmBtn.disabled) {
                return;
            }
            confirmContextAttachSelection();
        });
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.insert-dropdown')) {
            closeInsertDropdowns();
        }
        if (tabContextMenu && !e.target.closest('.tab-context-menu')) {
            hideTabContextMenu();
        }
        if (detectEnvDetailsOpen && !e.target.closest('.detect-env-bar')) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = document.getElementById('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && tabContextMenu && !tabContextMenu.hidden) {
            hideTabContextMenu();
        }
        if (e.key === 'Escape' && detectEnvDetailsOpen) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = document.getElementById('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
        if (e.key === 'Escape' && configureEnvDetectDetailsOpen) {
            setConfigureEnvDetectDetailsOpen(false);
        }
        if (e.key === 'Escape' && configureEnvModal && configureEnvModal.classList.contains('is-open')) {
            closeConfigureEnvModal();
        }
    });

    const detectEnvToggle = document.getElementById('detectEnvToggle');
    if (detectEnvToggle) {
        detectEnvToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setDetectEnvDetailsOpen(!detectEnvDetailsOpen);
            detectEnvToggle.setAttribute('aria-expanded', detectEnvDetailsOpen ? 'true' : 'false');
        });
    }
    const detectEnvCloseBtn = document.getElementById('detectEnvClose');
    if (detectEnvCloseBtn) {
        detectEnvCloseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            hideDetectEnvironmentBar();
            vscode.postMessage({ type: 'detectEnvironmentDismiss' });
        });
    }

    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', function() {
            if (clearInputBtn.disabled) return;
            inputEl.value = '';
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        });
    }

    if (copySessionBtn) {
        copySessionBtn.addEventListener('click', function() {
            if (copySessionBtn.disabled) return;
            requestSessionExport('copy');
            flashQuickActionBtn(copySessionBtn);
        });
    }

    cancelBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'cancel' });
    });

    if (retryBtn) {
        retryBtn.addEventListener('click', doRetry);
    }
    if (detectEnvBtn) {
        detectEnvBtn.addEventListener('click', doDetectEnvironment);
    }
    if (configureEnvBrowseBtn) {
        configureEnvBrowseBtn.addEventListener('click', browseConfigureEnvPath);
    }
    if (configureEnvDetectBtn) {
        configureEnvDetectBtn.addEventListener('click', startConfigureEnvDetect);
    }
    if (configureEnvDetectClose) {
        configureEnvDetectClose.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeConfigureEnvDetectPanel();
        });
    }
    if (configureEnvPathClearBtn) {
        configureEnvPathClearBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            clearConfigureEnvPath();
        });
    }
    if (configureEnvPathInput) {
        configureEnvPathInput.addEventListener('input', function() {
            configureEnvSelectedPath = configureEnvPathInput.value.trim();
            updateConfigureEnvPathClearVisibility();
        });
    }
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setConfigureEnvDetectDetailsOpen(!configureEnvDetectDetailsOpen);
        });
    }
    if (configureEnvSaveBtn) {
        configureEnvSaveBtn.addEventListener('click', saveConfigureEnvPath);
    }
    if (configureEnvCancelBtn) {
        configureEnvCancelBtn.addEventListener('click', closeConfigureEnvModal);
    }
    if (configureEnvCloseBtn) {
        configureEnvCloseBtn.addEventListener('click', closeConfigureEnvModal);
    }
    if (configureEnvSystemBtn) {
        configureEnvSystemBtn.addEventListener('click', requestConfigureEnvSystemPath);
    }
    if (configureEnvModal) {
        configureEnvModal.addEventListener('click', function(e) {
            if (e.target === configureEnvModal) {
                closeConfigureEnvModal();
            }
        });
    }

    openTabBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'openTab', sessionId: pendingOpenSessionId || undefined });
        pendingOpenSessionId = null;
        renderClosedList();
    });

    closedPickerBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = closedPicker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(closedPicker, true);
            vscode.postMessage({ type: 'getHiddenSessions' });
            renderClosedList();
        }
    });
    closedDropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    let closedSessions = [];

    function renderClosedList() {
        if (!closedList) return;
        // Picking a session closes this menu, so the toolbar has to carry the choice or
        // nothing on screen changes until Open Tab is pressed.
        const picked = pendingOpenSessionId !== null;
        if (closedPicker) closedPicker.classList.toggle('is-empty', !picked);
        if (closedPickerLabel) {
            closedPickerLabel.textContent = picked
                ? pendingOpenTitle + (pendingOpenCount ? ' · ' + pendingOpenCount : '')
                : locale.chooseChat;
        }
        if (closedPickerBtn) {
            closedPickerBtn.title = picked && pendingOpenTitle
                ? locale.openTab + ': ' + pendingOpenTitle
                : locale.chooseChat;
        }
        const rows = [
            '<div class="dropdown-item' + (pendingOpenSessionId === null ? ' active' : '') + '" data-closed="new">' +
                escapeHtml(locale.newChat) + (pendingOpenSessionId === null ? ' ✓' : '') + '</div>'
        ];
        if (!closedSessions.length) {
            rows.push('<div class="dropdown-divider"></div>');
            rows.push('<div class="dropdown-item disabled">' + escapeHtml(locale.noClosedSessions) + '</div>');
        } else {
            rows.push('<div class="dropdown-group-label">' + escapeHtml(locale.closedSessionsHeader) + '</div>');
            for (const session of closedSessions) {
                const active = pendingOpenSessionId === session.sessionId;
                const title = String(session.title || session.sessionId.slice(0, 8));
                const meta = session.messageCount ? ' · ' + session.messageCount : '';
                rows.push('<div class="dropdown-item' + (active ? ' active' : '') + '" data-closed="' + escapeHtml(session.sessionId) + '">' +
                    escapeHtml(title) + '<span class="meta">' + escapeHtml(meta) + '</span>' +
                    (active ? ' ✓' : '') + '</div>');
            }
        }
        closedList.innerHTML = rows.join('');
        closedList.querySelectorAll('.dropdown-item[data-closed]').forEach(function(item) {
            item.addEventListener('click', function() {
                const pickedId = this.dataset.closed === 'new' ? null : this.dataset.closed;
                const picked = pickedId
                    ? closedSessions.find(function(s) { return s.sessionId === pickedId; })
                    : null;
                pendingOpenSessionId = pickedId;
                pendingOpenTitle = picked ? String(picked.title || picked.sessionId.slice(0, 8)) : '';
                pendingOpenCount = picked && picked.messageCount ? picked.messageCount : 0;
                setMenuOpen(closedPicker, false);
                renderClosedList();
            });
        });
    }

    // About / Help / FAQ modals (opened from view title bar commands)
    const aboutModal = document.getElementById('aboutModal');
    const helpModal = document.getElementById('helpModal');
    const faqModal = document.getElementById('faqModal');
    const faqModalBody = document.getElementById('faqModalBody');
    const aboutContent = document.getElementById('aboutContent');
    let pluginInfo = {};

    function renderAboutContent() {
        const name = pluginInfo.displayName || 'Tommys Hermes ACP';
        const version = pluginInfo.version || '—';
        const publisher = pluginInfo.publisher || '';
        const repo = pluginInfo.repository || '';
        const iconUri = pluginInfo.iconUri || '';
        const logoHtml = iconUri
            ? '<div class="about-brand"><img src="' + escapeHtml(iconUri) + '" alt="' + escapeHtml(name) + '" /></div>'
            : '';
        aboutContent.innerHTML =
            logoHtml +
            '<h3>' + escapeHtml(name) + '</h3>' +
            '<p>' + locale.aboutVersion + ' <code>' + escapeHtml(version) + '</code>' +
            (publisher ? ' · ' + escapeHtml(publisher) : '') + '</p>' +
            '<p>' + locale.aboutDescription + '</p>' +
            '<ul>' +
            '<li>' + escapeHtml(locale.aboutFeatureTabs) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeaturePickers) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeatureInsert) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeatureTools) + '</li>' +
            '</ul>' +
            (repo ? '<p class="dim">' + escapeHtml(locale.repository) + '：<a href="#" data-url="' + escapeHtml(repo) + '">' + escapeHtml(repo) + '</a></p>' : '');
        aboutContent.querySelectorAll('a[data-url]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                vscode.postMessage({ type: 'openExternal', url: link.dataset.url });
            });
        });
    }

    function closeInfoModals() {
        hideModal(aboutModal);
        hideModal(helpModal);
        hideModal(faqModal);
    }

    document.querySelectorAll('.close-info-modal').forEach(function(btn) {
        btn.addEventListener('click', closeInfoModals);
    });
    aboutModal.addEventListener('click', function(e) {
        if (e.target === aboutModal) closeInfoModals();
    });
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) closeInfoModals();
    });
    faqModal.addEventListener('click', function(e) {
        if (e.target === faqModal) closeInfoModals();
    });
    if (faqModalBody) {
        faqModalBody.addEventListener('toggle', function(e) {
            const item = e.target;
            if (!item.classList || !item.classList.contains('faq-item') || !item.open) {
                return;
            }
            const list = item.closest('.faq-list');
            if (!list) {
                return;
            }
            list.querySelectorAll('.faq-item[open]').forEach(function(other) {
                if (other !== item) {
                    other.open = false;
                }
            });
        }, true);
        faqModalBody.addEventListener('click', function(e) {
            const link = e.target.closest('a[data-url]');
            if (!link) return;
            e.preventDefault();
            vscode.postMessage({ type: 'openExternal', url: link.dataset.url });
        });
    }

    // Pickers
    const tabBar = document.getElementById('tab-bar');
    const tabContextMenu = document.getElementById('tabContextMenu');
    let tabContextSessionId = null;
    const profilePicker = document.getElementById('profilePicker');
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const modelPicker = document.getElementById('modelPicker');
    const modelBtn = document.getElementById('modelBtn');
    const modelLabelEl = document.getElementById('modelLabel');
    const modelDropdown = document.getElementById('modelDropdown');
    const contextAttachPicker = document.getElementById('contextAttachPicker');
    const contextAttachBtn = document.getElementById('contextAttachBtn');
    const contextAttachLabel = document.getElementById('contextAttachLabel');
    const contextAttachDropdown = document.getElementById('contextAttachDropdown');
    const contextAttachList = document.getElementById('contextAttachList');
    const contextAttachHelp = document.getElementById('contextAttachHelp');
    const contextAttachHeaderLead = document.getElementById('contextAttachHeaderLead');
    const contextAttachHeaderRest = document.getElementById('contextAttachHeaderRest');
    const contextAttachTooltipEl = document.getElementById('contextAttachTooltip');
    const contextAttachPreviewEl = document.getElementById('contextAttachPreview');
    const contextAttachPreviewList = document.getElementById('contextAttachPreviewList');
    const contextAttachSendModal = document.getElementById('contextAttachSendModal');
    const switchSessionModal = document.getElementById('switchSessionModal');


    /** Open state lives on the wrapper: data-open drives the panel, is-open the trigger. */
    function setMenuOpen(picker, open) {
        if (!picker) {
            return;
        }
        picker.dataset.open = open ? 'true' : 'false';
        picker.classList.toggle('is-open', open);
    }

    function closeAllDropdowns() {
        setMenuOpen(closedPicker, false);
        setMenuOpen(profilePicker, false);
        setMenuOpen(modelPicker, false);
        setMenuOpen(contextAttachPicker, false);
        hideContextAttachTooltip();
        hideContextAttachPreview();
    }

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

    profileBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = profilePicker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(profilePicker, true);
            vscode.postMessage({ type: 'getProfiles' });
        }
    });
    profileDropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    modelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = modelPicker.dataset.open !== 'true';
        closeAllDropdowns();
        if (open) {
            setMenuOpen(modelPicker, true);
            vscode.postMessage({ type: 'getModels' });
        }
    });
    modelDropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    if (contextAttachBtn && contextAttachDropdown) {
        contextAttachBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = contextAttachPicker.dataset.open !== 'true';
            closeAllDropdowns();
            if (open) {
                setMenuOpen(contextAttachPicker, true);
                renderContextAttachOptions();
            }
        });
        contextAttachDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
    }
    const switchSessionStayBtn = document.getElementById('switchSessionStayBtn');
    const switchSessionConfirmBtn = document.getElementById('switchSessionConfirmBtn');
    if (switchSessionStayBtn) {
        switchSessionStayBtn.addEventListener('click', closeSwitchSessionModal);
    }
    if (switchSessionConfirmBtn) {
        switchSessionConfirmBtn.addEventListener('click', function() {
            const confirmBtn = document.getElementById('switchSessionConfirmBtn');
            if (confirmBtn && confirmBtn.dataset.queued === 'true') {
                // Stop the run; the switch is already queued and lands the moment it ends.
                vscode.postMessage({ type: 'cancel' });
                return;
            }
            if (!pendingSwitchSessionId) {
                closeSwitchSessionModal();
                return;
            }
            const sessionId = pendingSwitchSessionId;
            vscode.postMessage({ type: 'switchSession', sessionId, interrupt: true });
            markSwitchQueued(sessionId);
        });
    }
    if (switchSessionModal) {
        switchSessionModal.addEventListener('click', function(e) {
            // While a switch is queued the dialog is the only thing explaining the wait, so
            // a click outside must not dismiss it.
            if (e.target === switchSessionModal && !switchQueuedFor) {
                closeSwitchSessionModal();
            }
        });
    }
    bindContextAttachTooltip();
    bindContextAttachPreview();
    const contextAttachSendYesBtn = document.getElementById('contextAttachSendYesBtn');
    const contextAttachSendNoBtn = document.getElementById('contextAttachSendNoBtn');
    if (contextAttachSendYesBtn) {
        contextAttachSendYesBtn.addEventListener('click', function() {
            const text = pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            finalizeContextAttachSelectionFromPending();
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(false));
        });
    }
    if (contextAttachSendNoBtn) {
        contextAttachSendNoBtn.addEventListener('click', function() {
            const text = pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            contextAttachUnconfirmedIndices = [];
            contextAttachCustomPending = false;
            if (contextAttachMode === 'custom' && !contextAttachCustomConfirmed) {
                contextAttachMode = 'none';
            }
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(true));
        });
    }
    if (contextAttachSendModal) {
        contextAttachSendModal.addEventListener('click', function(e) {
            if (e.target === contextAttachSendModal) {
                closeContextAttachSendModal();
            }
        });
    }

    function renderProfileList(profiles) {
        const list = document.getElementById('profileList');
        const current = document.getElementById('profileLabel').textContent;
        const entries = (profiles || []).map(function(item) {
            if (item && typeof item === 'object' && item.id) {
                return { id: String(item.id), label: String(item.label || item.id) };
            }
            const name = String(item || '');
            return { id: name, label: name };
        });
        if (!entries.length) {
            list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.configureAgents) + '</div>';
            return;
        }
        list.innerHTML = entries.map(function(entry) {
            const active = entry.label === current ? ' active' : '';
            return '<div class="dropdown-item' + active + '" data-profile="' + escapeHtml(entry.id) + '">' +
                escapeHtml(entry.label) + (active ? ' ✓' : '') + '</div>';
        }).join('');
        list.querySelectorAll('.dropdown-item[data-profile]').forEach(function(item) {
            item.addEventListener('click', function() {
                vscode.postMessage({ type: 'switchAgent', agentName: this.dataset.profile });
                closeAllDropdowns();
            });
        });
    }

    let modelConfigId = '';
    let lastModelPayload = null;

    function shouldShowModelPlaceholder(payload) {
        if (!payload) {
            return true;
        }
        const models = payload.models || [];
        if (!models.length) {
            return true;
        }
        if (!payload.currentValueId) {
            return true;
        }
        return !models.some(function(m) {
            return m.valueId === payload.currentValueId;
        });
    }

    function updateModelButtonDisplay(payload) {
        if (!modelLabelEl || !modelBtn) {
            return;
        }
        if (shouldShowModelPlaceholder(payload)) {
            modelLabelEl.textContent = locale.modelPlaceholder || '';
            modelBtn.classList.add('is-placeholder');
            modelBtn.title = locale.modelPlaceholder || locale.switchModel || '';
            return;
        }
        modelLabelEl.textContent = payload.currentLabel || payload.currentValueId || '';
        modelBtn.classList.remove('is-placeholder');
        modelBtn.title = payload.fromAgent
            ? locale.modelFromAgent
            : locale.modelLocalPreference;
        pickerRowReserve();
    }

    function renderModelList(payload) {
        const list = document.getElementById('modelList');
        lastModelPayload = payload;
        modelConfigId = payload.configId || '';
        updateModelButtonDisplay(payload);

        const groups = Array.isArray(payload.groups) ? payload.groups.filter(function(g) {
            return g && Array.isArray(g.models) && g.models.length > 0;
        }) : [];
        const models = payload.models || [];

        if (!models.length) {
            list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.noModels) + '</div>';
            return;
        }

        if (groups.length > 1) {
            list.innerHTML = groups.map(function(group) {
                const header = '<div class="dropdown-group-label">' + escapeHtml(group.name || group.slug || '') + '</div>';
                const items = group.models.map(function(m) {
                    const active = m.valueId === payload.currentValueId;
                    return '<div class="dropdown-item' + (active ? ' active' : '') + '" data-value="' + escapeHtml(m.valueId) + '">' +
                        escapeHtml(m.name) + (active ? ' ✓' : '') + '</div>';
                }).join('');
                return header + items;
            }).join('');
        } else {
            list.innerHTML = models.map(function(m) {
                const active = m.valueId === payload.currentValueId;
                return '<div class="dropdown-item' + (active ? ' active' : '') + '" data-value="' + escapeHtml(m.valueId) + '">' +
                    escapeHtml(m.name) + (active ? ' ✓' : '') + '</div>';
            }).join('');
        }
        list.querySelectorAll('.dropdown-item[data-value]').forEach(function(item) {
            item.addEventListener('click', function() {
                vscode.postMessage({
                    type: 'switchModel',
                    configId: modelConfigId,
                    valueId: this.dataset.value
                });
                closeAllDropdowns();
            });
        });
    }

    function escapeHtml(s) {
        return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function reorderSessionTabs(fromId, toId) {
        if (!fromId || !toId || fromId === toId || !lastSessions.length) {
            return;
        }
        const fromSession = lastSessions.find(function(s) { return s.id === fromId; });
        const toSession = lastSessions.find(function(s) { return s.id === toId; });
        if (!fromSession || !toSession) {
            return;
        }
        if (!!fromSession.pinned !== !!toSession.pinned) {
            return;
        }
        const ids = lastSessions.map(function(s) { return s.id; });
        const fromIdx = ids.indexOf(fromId);
        const toIdx = ids.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) {
            return;
        }
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, fromId);
        const byId = {};
        lastSessions.forEach(function(s) { byId[s.id] = s; });
        lastSessions = ids.map(function(id) { return byId[id]; }).filter(Boolean);
        renderSessionTabs(lastSessions, lastActiveSessionId);
        vscode.postMessage({ type: 'reorderSessions', sessionIds: ids });
    }

    function hideTabContextMenu() {
        tabContextSessionId = null;
        if (tabContextMenu) {
            tabContextMenu.hidden = true;
            tabContextMenu.innerHTML = '';
        }
    }

    function positionTabContextMenu(x, y) {
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

    function downloadSessionMarkdown(markdown, filename) {
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'chat-export.md';
        link.click();
        URL.revokeObjectURL(url);
    }

    function showTabContextMenu(sessionId, clientX, clientY) {
        const session = lastSessions.find(function(s) { return s.id === sessionId; });
        if (!session || !tabContextMenu) {
            return;
        }
        tabContextSessionId = sessionId;
        const idx = lastSessions.findIndex(function(s) { return s.id === sessionId; });
        const canCloseLeft = idx > 0;
        const canCloseRight = idx >= 0 && idx < lastSessions.length - 1;
        const canCloseOthers = lastSessions.length > 1;
        const pinLabel = session.pinned ? locale.tabContextUnpin : locale.tabContextPin;

        tabContextMenu.innerHTML =
            '<div class="tab-ctx-sid">' +
                '<span class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextSid) + ':</span>' +
                '<span class="tab-ctx-sid-value" title="' + escapeHtml(sessionId) + '">' + escapeHtml(sessionId) + '</span>' +
                '<button type="button" class="tab-ctx-sid-copy" data-action="copySid" title="' + escapeHtml(locale.copySid) + '">' + COPY_ICON_SVG + '</button>' +
            '</div>' +
            '<button type="button" class="tab-ctx-item" data-action="export">' + escapeHtml(locale.tabContextExport) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="copy">' + escapeHtml(locale.tabContextCopy) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="rename">' + escapeHtml(locale.tabContextRename) + '</button>' +
            '<div class="tab-ctx-divider"></div>' +
            '<button type="button" class="tab-ctx-item" data-action="close">' + escapeHtml(locale.tabContextClose) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeOthers"' + (canCloseOthers ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseOthers) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeLeft"' + (canCloseLeft ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseLeft) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeRight"' + (canCloseRight ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseRight) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeAll">' + escapeHtml(locale.tabContextCloseAll) + '</button>' +
            '<div class="tab-ctx-divider"></div>' +
            '<button type="button" class="tab-ctx-item" data-action="togglePin">' + escapeHtml(pinLabel) + '</button>';

        tabContextMenu.querySelector('[data-action="copySid"]').addEventListener('click', function(e) {
            e.stopPropagation();
            copyToClipboard(sessionId);
        });
        tabContextMenu.querySelectorAll('.tab-ctx-item[data-action]').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                if (item.disabled || !tabContextSessionId) return;
                const action = item.dataset.action;
                const targetId = tabContextSessionId;
                hideTabContextMenu();
                if (action === 'export') {
                    requestSessionExport('export', undefined, targetId);
                } else if (action === 'copy') {
                    requestSessionExport('copy', undefined, targetId);
                } else if (action === 'rename') {
                    startTabRename(targetId);
                } else if (action === 'togglePin') {
                    vscode.postMessage({ type: 'togglePinSession', sessionId: targetId });
                } else if (action === 'close' || action === 'closeOthers' || action === 'closeLeft' || action === 'closeRight' || action === 'closeAll') {
                    const mode = action === 'close' ? 'self'
                        : action === 'closeOthers' ? 'others'
                        : action === 'closeLeft' ? 'left'
                        : action === 'closeRight' ? 'right'
                        : 'all';
                    vscode.postMessage({ type: 'closeSessions', sessionId: targetId, mode: mode });
                }
            });
        });

        positionTabContextMenu(clientX, clientY);
    }

    /* A tab being renamed keeps its input until the edit ends; a catalog post that arrives
       meanwhile is kept and replayed, so the field is never wiped mid-edit. */
    let pendingTabsRender = null;

    /**
     * Inline editor for one tab's name. Nothing is written locally: the committed value goes to
     * Hermes, and the strip redraws from the catalog once the rename lands.
     */
    function startTabRename(sessionId) {
        if (!sessionId) {
            return;
        }
        const tabs = tabBar.querySelectorAll('.session-tab');
        let tab = null;
        for (let i = 0; i < tabs.length; i++) {
            if (tabs[i].dataset.id === sessionId) {
                tab = tabs[i];
                break;
            }
        }
        const titleEl = tab ? tab.querySelector('.tab-title') : null;
        if (!tab || !titleEl || tab.classList.contains('editing')) {
            return;
        }
        const record = lastSessions.find(function(s) { return s.id === sessionId; });
        const current = (record && record.title) || titleEl.textContent || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = current;
        input.maxLength = 100;
        input.spellcheck = false;
        input.setAttribute('aria-label', locale.tabContextRename);
        let finished = false;
        function finish(commit) {
            if (finished) {
                return;
            }
            finished = true;
            tab.classList.remove('editing');
            if (input.parentNode) {
                input.parentNode.replaceChild(titleEl, input);
            }
            const value = input.value.replace(/\s+/g, ' ').trim();
            if (commit && value && value !== current) {
                vscode.postMessage({ type: 'renameSession', sessionId: sessionId, title: value });
            }
            if (pendingTabsRender) {
                const next = pendingTabsRender;
                pendingTabsRender = null;
                renderSessionTabs(next.sessions, next.activeId);
            }
        }
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', function() { finish(true); });
        input.addEventListener('click', function(e) { e.stopPropagation(); });
        input.addEventListener('dblclick', function(e) { e.stopPropagation(); });
        tab.classList.add('editing');
        titleEl.parentNode.replaceChild(input, titleEl);
        input.focus();
        input.select();
    }

    function wireTabDragDrop(tab) {
        tab.draggable = true;
        tab.addEventListener('dragstart', function(e) {
            if (tab.classList.contains('editing')) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.dataset.id || '');
            tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', function() {
            tab.classList.remove('dragging');
            tabBar.querySelectorAll('.session-tab').forEach(function(t) {
                t.classList.remove('drag-over');
            });
        });
        tab.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tab.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', function() {
            tab.classList.remove('drag-over');
        });
        tab.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            tab.classList.remove('drag-over');
            const fromId = e.dataTransfer.getData('text/plain');
            reorderSessionTabs(fromId, tab.dataset.id);
        });
        tab.addEventListener('mousedown', function(e) {
            tab.draggable = !(e.target && e.target.closest && e.target.closest('.tab-close'));
        });
    }

    function renderSessionTabs(sessions, activeId) {
        activeSessionId = activeId || activeSessionId;
        lastSessions = sessions || [];
        lastActiveSessionId = activeSessionId;
        if (!sessions || sessions.length === 0) {
            tabBar.innerHTML = '';
            return;
        }
        if (tabBar.querySelector('.session-tab.editing')) {
            pendingTabsRender = { sessions: sessions, activeId: activeId };
            return;
        }
        const parts = [];
        sessions.forEach(function(s, index) {
            const active = s.id === activeSessionId ? ' active' : '';
            const pinnedClass = s.pinned ? ' pinned' : '';
            const title = escapeHtml(s.title || locale.newChat);
            const pinIcon = s.pinned
                ? '<span class="tab-pin-icon" title="' + escapeHtml(locale.tabContextPin) + '">' + TAB_PIN_SVG + '</span>'
                : '';
            parts.push('<div class="session-tab' + active + pinnedClass + '" data-id="' + escapeHtml(s.id) + '" title="' + title + '">' +
                pinIcon +
                '<span class="tab-title">' + title + '</span>' +
                '<span class="tab-close" data-id="' + escapeHtml(s.id) + '" title="' + escapeHtml(locale.tabClose) + '">×</span>' +
                '</div>');
            if (s.pinned && index < sessions.length - 1 && !sessions[index + 1].pinned) {
                parts.push('<span class="tab-pin-separator" aria-hidden="true"></span>');
            }
        });
        tabBar.innerHTML = parts.join('');

        tabBar.querySelectorAll('.session-tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                if (e.target && e.target.closest && e.target.closest('.tab-close')) {
                    return;
                }
                if (tab.classList.contains('editing')) {
                    return;
                }
                if (tab.dataset.id !== activeSessionId) {
                    requestSwitchSession(tab.dataset.id);
                }
            });
            tab.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                showTabContextMenu(tab.dataset.id, e.clientX, e.clientY);
            });
            wireTabDragDrop(tab);
        });
        tabBar.querySelectorAll('.tab-close').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                // Closing a tab hides its session; the transcript stays in Hermes and
                // comes back from the closed-session picker. 'deleteSession' is a real
                // delete and must not be reachable from the X.
                vscode.postMessage({ type: 'closeSessions', sessionId: btn.dataset.id, mode: 'self' });
            });
        });

        const activeTab = tabBar.querySelector('.session-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function showPermissionRequest(msg) {
        finalizeAssistantBubble();
        placeholder.style.display = 'none';
        enableStopAfterAgentOutput();
        const id = msg.id;
        if (!id) {
            return;
        }
        if (pendingPermissions.has(id)) {
            updatePermissionContent(pendingPermissions.get(id), msg.title, msg.detail);
            return;
        }
        const group = mountPermissionCard(id, msg);
        messagesEl.appendChild(group);
        pendingPermissions.set(id, group);
        maybeScrollToBottom();
    }

    function resolvePermission(id, optionId, selectedLabel) {
        const group = pendingPermissions.get(id);
        if (!group) {
            return;
        }
        pendingPermissions.delete(id);
        applyPermissionResolvedUI(group, localeText('permissionSelected', selectedLabel || optionId));
        vscode.postMessage({ type: 'permissionResponse', id: id, optionId: optionId });
    }

    function dismissPermissionRequest(id, statusText) {
        const group = pendingPermissions.get(id);
        if (!group) {
            return;
        }
        pendingPermissions.delete(id);
        applyPermissionResolvedUI(group, statusText || locale.permissionCancelled || 'Cancelled');
    }

    // Messages from extension
    function isMessageForActiveSession(msg) {
        return !msg.sessionId || msg.sessionId === lastActiveSessionId;
    }

    window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'addMessage':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.role === 'assistant') {
                    appendMessage('assistant', msg.text);
                } else if (msg.role === 'tool' && msg.toolCallId) {
                    handleToolMessage(msg.text, msg.toolCallId);
                } else if (msg.role === 'thought') {
                    // Update the current thought bubble while streaming the same segment
                    if (thoughtMsgId) {
                        const el = document.getElementById(thoughtMsgId);
                        if (el) {
                            setAuxiliaryContent(el, msg.text);
                            setAuxMessageLive(el, true);
                            maybeScrollToBottom();
                            break;
                        }
                    }
                    const id = appendMessage('thought', msg.text);
                    thoughtMsgId = id;
                } else {
                    appendMessage(msg.role, msg.text);
                }
                break;

            case 'status':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.status === 'connecting') {
                    connectionAttempted = true;
                }
                updateStatus(msg.status, msg.message);
                if (msg.status === 'ready') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    resetToolAggregation();
                    finishStreaming();
                    canSend = true;
                    inputEl.disabled = false;
                    setInputMode('send');
                    placeholder.style.display = 'none';
                    if (!window._hermesRendered) {
                        scheduleSessionMarkdownRender();
                    }
                    maybeFocusInputAfterResponse();
                } else if (msg.status === 'prompting') {
                    isPrompting = true;
                    resetAutoScrollFollow();
                    canSend = false;
                    // Deliberately not disabling the textarea: the busy look comes from
                    // .input-composite-shell.waiting and the Send/Stop swap, not from a
                    // blurred input.
                    if (!awaitingFirstChunk) {
                        setInputMode('stop');
                    }
                } else if (msg.status === 'error') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                    const errText = msg.message || locale.connectionError;
                    placeholder.innerHTML = buildConnectionErrorPlaceholder(errText);
                    bindConnectionErrorActions();
                    placeholder.style.display = 'block';
                } else if (msg.status === 'idle') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                }
                break;

            case 'tokenUsage':
                updateTokenUsage(msg.used, msg.size);
                break;

            case 'newChat':
                paneHintText = '';
                newChat();
                break;

            case 'surfaceRole':
                document.body.classList.toggle('surface-rail', msg.role === 'rail');
                document.body.classList.toggle('surface-notabs', !!msg.hideTabs);
                break;

            case 'noActiveTab':
                paneHintText = locale.noActiveTabHint;
                newChat();
                break;

            case 'insertInput':
                insertIntoInput(msg.text || '');
                break;

            case 'restoreHistory':
                restoreHistory(msg.messages, msg.localHistoryOnly);
                break;

            case 'detectEnvironmentStart':
                initDetectEnvironmentStart(msg.mode || 'manual');
                if (placeholder) placeholder.style.display = 'none';
                break;

            case 'detectEnvironmentProgress':
                updateDetectEnvironmentStep(msg);
                break;

            case 'detectEnvironmentEnd':
                finishDetectEnvironmentPanel(msg);
                break;

            case 'configureEnvironmentOpen':
                openConfigureEnvModal(msg.currentPath || '', msg.systemEnvVar, msg.systemEnvTarget);
                break;

            case 'configureEnvironmentDetectStart':
                setConfigureEnvDetecting(true);
                break;

            case 'configureEnvironmentDetectProgress':
                updateConfigureEnvDetectProgress(msg);
                break;

            case 'configureEnvironmentDetectEnd':
                finishConfigureEnvDetect(msg);
                break;

            case 'configureEnvironmentDetectClosed':
                hideConfigureEnvDetectProgress();
                setConfigureEnvDetecting(false);
                break;

            case 'configureEnvironmentBrowseResult':
                if (msg.path && configureEnvPathInput) {
                    configureEnvPathInput.value = msg.path;
                    configureEnvSelectedPath = msg.path;
                    updateConfigureEnvPathClearVisibility();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'configureEnvironmentSaveResult':
                if (msg.ok) {
                    closeConfigureEnvModal();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'setLocale':
                if (msg.locale) {
                    locale = msg.locale;
                    applyLocale();
                    if (lastSessions.length > 0) {
                        renderSessionTabs(lastSessions, lastActiveSessionId);
                    }
                }
                break;

            case 'undeliveredMessage':
                offerUndeliveredMessage(msg.text);
                break;

            case 'sessionList':
                if ((msg.sessions || []).length) paneHintText = '';
                renderSessionTabs(msg.sessions, msg.activeSessionId);
                if (switchQueuedFor && msg.activeSessionId === switchQueuedFor) {
                    clearSwitchQueued();
                }
                break;

            case 'sessionExport':
                if (msg.action === 'copy' && msg.markdown) {
                    copyToClipboard(msg.markdown);
                } else if (msg.action === 'export' && msg.markdown) {
                    downloadSessionMarkdown(msg.markdown, msg.filename);
                }
                break;

            case 'agentList':
            case 'profileList':
                renderProfileList(msg.agents || msg.profiles);
                break;

            case 'hiddenSessions':
                closedSessions = Array.isArray(msg.sessions) ? msg.sessions : [];
                if (pendingOpenSessionId !== null && !closedSessions.some(function(s) { return s.sessionId === pendingOpenSessionId; })) {
                    // It was opened or deleted elsewhere; drop the stale pick.
                    pendingOpenSessionId = null;
                    pendingOpenTitle = '';
                    pendingOpenCount = 0;
                }
                renderClosedList();
                break;

            case 'modelList':
                renderModelList(msg);
                break;

            case 'log':
                if (msg.level === 'error' || msg.level === 'warning') {
                    logs.push({ line: msg.line, level: msg.level });
                    if (logs.length > 500) logs = logs.slice(-500);
                    if (isLogModalOpen()) {
                        renderLogContent();
                    }
                }
                break;

            case 'openLogs':
                openLogModal();
                break;

            case 'openAbout':
                renderAboutContent();
                showModal(aboutModal);
                break;

            case 'openHelp':
                showModal(helpModal);
                break;

            case 'openFaq':
                showModal(faqModal);
                break;

            case 'config':
                window._showThoughts = msg.showThoughts;
                window._showToolCalls = msg.showToolCalls;
                // Apply to existing messages
                document.querySelectorAll('.message-group.thought').forEach(function(el) {
                    el.style.display = msg.showThoughts ? '' : 'none';
                });
                document.querySelectorAll('.message-group.tool').forEach(function(el) {
                    el.style.display = msg.showToolCalls ? '' : 'none';
                });
                break;

            case 'activeAgent':
            case 'activeProfile':
                if (msg.name) {
                    activeProfileName = msg.name;
                    document.getElementById('profileLabel').textContent = msg.name;
                    refreshRoleLabels();
                    applyInputPlaceholder();
                }
                break;

            case 'pluginInfo':
                pluginInfo = msg;
                renderAboutContent();
                break;

            case 'fileList':
                if (filePickerEl.dataset.requestId === msg.requestId) {
                    renderFilePickerItems(msg.files || []);
                }
                break;

            case 'filePreview':
                if (previewRequests.has(msg.requestId)) {
                    const anchor = previewRequests.get(msg.requestId);
                    previewRequests.delete(msg.requestId);
                    showFilePreview(msg.path || '', msg.content, msg.error);
                    positionFilePreview(anchor);
                }
                break;

            case 'finishAssistantBubble':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                finalizeAssistantBubble();
                if (isPrompting && !awaitingFirstChunk) {
                    setInputMode('stop');
                }
                break;

            case 'permissionRequest':
                showPermissionRequest(msg);
                break;

            case 'permissionUpdate':
                if (msg.id && pendingPermissions.has(msg.id)) {
                    updatePermissionContent(
                        pendingPermissions.get(msg.id),
                        msg.title,
                        msg.detail
                    );
                }
                break;

            case 'permissionDismiss':
                dismissPermissionRequest(msg.id, msg.status || locale.permissionCancelled);
                break;

            case 'showContextAttach':
                showContextAttachPicker();
                break;

            case 'hideContextAttach':
                hideContextAttachPicker();
                break;

        }
    });

    // Signal ready
        applyLocale();
        wirePickerRowReserve();
        vscode.postMessage({ type: 'ready' });
    // Live font-size control — injected into the input footer next to the
    // token usage ring; hidden first when the input composite narrows.
    (function() {
        const KEY = 'tommys.chatFontSize';
        const MIN = 10, MAX = 28, DEFAULT = 16;
        let size = parseInt(localStorage.getItem(KEY) || '', 10);
        if (!size || size < MIN || size > MAX) size = DEFAULT;

        // Sit in the picker row alongside model + session-memory chips so
        // the existing container-query rules for that row apply here too.
        const target = document.querySelector('.input-picker-row')
            || document.querySelector('.input-action');
        if (!target) return;

        const pill = document.createElement('div');
        pill.className = 'fs-ctl';
        pill.style.cssText = [
            'display:inline-flex', 'align-items:center', 'gap:2px',
            'padding:1px 4px', 'border-radius:10px',
            'border:1px solid var(--border)',
            'background:transparent',
            'font-size:11px', 'color:var(--dim)',
            'min-width:0', 'overflow:hidden'
        ].join(';');
        pill.title = 'Chat font size';

        function mkBtn(txt, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = txt;
            b.style.cssText = 'background:transparent;border:0;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 3px;';
            b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
            return b;
        }

        const minusBtn = mkBtn('−', () => apply(size - 1));
        minusBtn.classList.add('fs-ctl-control');
        const icon = document.createElement('span');
        icon.textContent = 'Aa';
        icon.setAttribute('aria-hidden', 'true');
        icon.style.cssText = 'font-family:serif;font-size:12px;line-height:1;padding-right:2px;opacity:0.8;';
        const label = document.createElement('span');
        label.className = 'fs-ctl-control';
        label.style.cssText = 'min-width:22px;text-align:center;font-variant-numeric:tabular-nums;';
        const plusBtn = mkBtn('+', () => apply(size + 1));
        plusBtn.classList.add('fs-ctl-control');
        // Double-click the number to reset.
        label.title = 'Double-click to reset';
        label.style.cursor = 'pointer';
        label.addEventListener('dblclick', () => apply(DEFAULT));

        pill.appendChild(icon);
        pill.appendChild(minusBtn);
        pill.appendChild(label);
        pill.appendChild(plusBtn);
        target.appendChild(pill);

        function apply(px) {
            size = Math.max(MIN, Math.min(MAX, px));
            document.documentElement.style.setProperty('--chat-fs', size + 'px');
            localStorage.setItem(KEY, String(size));
            label.textContent = size;
            pickerRowReserve();
        }
        apply(size);
    })();
    })();
    