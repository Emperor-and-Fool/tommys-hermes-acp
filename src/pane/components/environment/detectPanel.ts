import type { HostToPane } from '../../../shared/webview';

/** The fields every detect-progress message carries, whichever flow sent it. */
interface DetectProgressFields {
    step: string;
    status: string;
    brief: string;
    detail?: string;
    paths?: string[];
    count?: number;
    verifiedCount?: number;
    totalCount?: number;
    reportStatus?: string;
}

type DetectProgressMsg = Extract<HostToPane, { type: 'detectEnvironmentProgress' }>;
type DetectEndMsg = Extract<HostToPane, { type: 'detectEnvironmentEnd' }>;

import { byId, detectEnvBtn, detectEnvToggle, required } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { doDetectEnvironment } from '../status/statusBar';


export const DETECT_STEP_IDS = [
    'config', 'path_lookup', 'known_path', 'pip', 'python_import', 'hermes_home', 'verify', 'acp_check', 'acp_install', 'summary',
];

const DETECT_STEP_LOCALE_KEYS: Record<string, string> = {
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

export function detectStepLabel(stepId: string): string {
    const key = DETECT_STEP_LOCALE_KEYS[stepId];
    return key ? (locale[key] || stepId) : stepId;
}

function formatDetectStepDetail(msg: DetectProgressFields): string {
    if (msg.status === 'running') return '…';
    if (msg.status === 'skip') return locale.detectEnvironmentStepSkipped || 'Skipped';
    if (msg.step === 'verify') {
        return localeText(
            'detectEnvironmentStepVerifyCount',
            String(msg.verifiedCount != null ? msg.verifiedCount : 0),
            String(msg.totalCount != null ? msg.totalCount : 0),
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
    if ((msg.count ?? 0) > 0) {
        const summary = localeText('detectEnvironmentStepFoundCount', String(msg.count));
        if (msg.detail) return summary + '\n' + msg.detail;
        return summary;
    }
    if (msg.status === 'fail' && msg.detail) return msg.detail;
    return locale.detectEnvironmentStepNotFound || 'Not found';
}

export function setDetectEnvIcon(el: Element | null, status: string) {
    if (!el) return;
    const keepStep = el.classList.contains('detect-env-step-icon');
    el.className = (keepStep ? 'detect-env-step-icon ' : '') + 'detect-env-icon ' + (status || 'running');
    el.textContent = '';
}

export function formatDetectProgressDisplay(brief: string) {
    if (!brief) return '';
    return localeText('detectEnvironmentProgressPrefix', brief);
}

export function setDetectEnvDetailsTitle() {
    const detailsTitle = required('detectEnvDetailsTitle');
    if (!detailsTitle) return;
    detailsTitle.textContent = state.detectEnvFinished
        ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
        : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
}

export function setDetectEnvDetailsOpen(open: boolean) {
    state.detectEnvDetailsOpen = !!open;
    const details = required('detectEnvDetails');
    const hint = required('detectEnvCompactHint');
    const toggle = required('detectEnvToggle');
    if (details) details.hidden = !state.detectEnvDetailsOpen;
    if (hint) hint.classList.toggle('is-open', state.detectEnvDetailsOpen);
    if (toggle) {
        toggle.setAttribute('aria-expanded', state.detectEnvDetailsOpen ? 'true' : 'false');
        toggle.title = state.detectEnvDetailsOpen
            ? (locale.detectEnvironmentHideDetails || '')
            : (locale.detectEnvironmentViewDetails || '');
    }
}

function buildDetectStepRow(stepId: string, rowId: string): HTMLElement {
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

export function ensureDetectStepsList(listEl: HTMLElement, stepIdPrefix: string) {
    if (!listEl || listEl.dataset.ready === '1') {
        return;
    }
    listEl.textContent = '';
    DETECT_STEP_IDS.forEach(function(stepId) {
        listEl.appendChild(buildDetectStepRow(stepId, stepIdPrefix + stepId));
    });
    listEl.dataset.ready = '1';
}

export function refreshDetectStepLabels(listEl: HTMLElement, stepIdPrefix: string) {
    if (!listEl) return;
    DETECT_STEP_IDS.forEach(function(stepId) {
        const label = listEl.querySelector('#' + stepIdPrefix + stepId + ' .detect-env-step-label');
        if (label) label.textContent = detectStepLabel(stepId);
    });
}

export function resetDetectStepsList(stepIdPrefix: string) {
    DETECT_STEP_IDS.forEach(function(stepId) {
        const row = document.getElementById(stepIdPrefix + stepId);
        if (!row) return;
        row.style.display = 'none';
        setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), 'running');
        const detailEl = row.querySelector('.detect-env-step-detail');
        if (detailEl) detailEl.textContent = '';
    });
}

export function updateDetectStepsList(msg: DetectProgressFields, stepIdPrefix: string, compactIconEl?: HTMLElement, compactTextEl?: HTMLElement) {
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
    const list = required('detectEnvSteps');
    ensureDetectStepsList(list, 'detectStep-');
    if (!state.detectEnvPanelReady && list) {
        state.detectEnvPanelReady = true;
    }
}

function showDetectEnvironmentBar() {
    ensureDetectEnvironmentPanel();
    const bar = required('detectEnvBar');
    if (bar) bar.hidden = false;
}

function hideDetectEnvironmentBar() {
    state.detectEnvFinished = false;
    setDetectEnvDetailsOpen(false);
    const bar = required('detectEnvBar');
    if (bar) bar.hidden = true;
}

function setDetectEnvironmentCompact(brief: string, status: string) {
    setDetectEnvIcon(required('detectEnvCompactIcon'), status);
    const textEl = required('detectEnvCompactText');
    if (textEl) {
        textEl.textContent = brief || '';
        textEl.title = brief || '';
    }
}

export function updateDetectEnvironmentStep(msg: DetectProgressMsg) {
    ensureDetectEnvironmentPanel();
    updateDetectStepsList(
        msg,
        'detectStep-',
        required('detectEnvCompactIcon'),
        required('detectEnvCompactText'),
    );
}

export function initDetectEnvironmentStart(mode: 'connect' | 'manual' | 'configure') {
    state.detectEnvFinished = false;
    showDetectEnvironmentBar();
    setDetectEnvDetailsOpen(false);
    setDetectEnvDetailsTitle();
    const toggle = required('detectEnvToggle');
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

export function finishDetectEnvironmentPanel(msg: DetectEndMsg) {
    state.detectEnvFinished = true;
    setDetectEnvDetailsTitle();
    const summaryMsg: DetectProgressMsg = {
        type: 'detectEnvironmentProgress',
        step: 'summary',
        status: msg.summaryStatus || (msg.status === 'ready' ? 'ok' : 'fail'),
        reportStatus: msg.status,
        brief: msg.brief,
    };
    updateDetectEnvironmentStep(summaryMsg);
    setDetectEnvironmentCompact(formatDetectProgressDisplay(msg.brief || '100%'), summaryMsg.status);
}

export function initDetectEnvToggleClick(): void {
    if (detectEnvToggle) {
        detectEnvToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setDetectEnvDetailsOpen(!state.detectEnvDetailsOpen);
            detectEnvToggle.setAttribute('aria-expanded', state.detectEnvDetailsOpen ? 'true' : 'false');
        });
    }
}

const detectEnvCloseBtn = required('detectEnvClose');

export function initDetectEnvCloseBtnClick(): void {
    if (detectEnvCloseBtn) {
        detectEnvCloseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            hideDetectEnvironmentBar();
            post({ type: 'detectEnvironmentDismiss' });
        });
    }
}

export function initDetectEnvBtnClick(): void {
    if (detectEnvBtn) {
        detectEnvBtn.addEventListener('click', doDetectEnvironment);
    }
}
