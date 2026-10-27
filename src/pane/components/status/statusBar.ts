import { byId, detectEnvBtn, inputEl, retryBtn, statusText } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { currentProviderVendor } from '../pickers/modelPicker';
import { profileDisplayName } from '../pickers/profilePicker';


export const TOKEN_RING_RADIUS = 11;

const statusDot = byId('statusDot');

function setConnectingPlaceholder() {
    if (!state.placeholder) return;
    state.placeholder.className = 'placeholder';
    state.placeholder.textContent = '';
    state.placeholder.appendChild(document.createTextNode(locale.connectingTitle || ''));
    state.placeholder.appendChild(document.createElement('br'));
    const hint = document.createElement('span');
    hint.style.fontSize = '11px';
    hint.style.opacity = '0.6';
    hint.textContent = locale.connectingHint || '';
    state.placeholder.appendChild(hint);
}

function updateConnectionActionVisibility(status) {
    const showActions = status === 'error' || (status === 'idle' && state.connectionAttempted);
    if (retryBtn) {
        retryBtn.hidden = !showActions;
        retryBtn.disabled = status === 'connecting';
    }
    if (detectEnvBtn) {
        detectEnvBtn.hidden = !showActions;
        detectEnvBtn.disabled = status === 'connecting';
    }
}

export function bindConnectionErrorActions() {
    const phRetry = byId('placeholderRetryBtn');
    if (phRetry) phRetry.addEventListener('click', doRetry);
    const phDetect = byId('placeholderDetectEnvBtn');
    if (phDetect) phDetect.addEventListener('click', doDetectEnvironment);
}

export function buildConnectionErrorPlaceholder(errText) {
    if (state.placeholder) state.placeholder.className = 'placeholder';
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
    state.connectionAttempted = true;
    post({ type: 'retry' });
}

export function doDetectEnvironment() {
    if (detectEnvBtn && detectEnvBtn.disabled) return;
    post({ type: 'detectEnvironment' });
}

export function emptyStateText() {
    if (state.paneHintText) return state.paneHintText;
    if (state.currentStatus === 'connecting') return state.currentStatusMessage || locale.statusConnecting;
    if (state.currentStatus === 'idle') return locale.statusDisconnected;
    if (state.currentStatus === 'error') return state.currentStatusMessage || locale.statusError;
    return locale.readyPlaceholder;
}

function syncEmptyState() {
    const el = byId('placeholder');
    if (el) el.textContent = emptyStateText();
}

export function updateStatus(status, message) {
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
    state.currentStatus = status;
    state.currentStatusMessage = message || '';
    syncEmptyState();
    updateRetryVisibility(status);
}

export function applyInputPlaceholder() {
    if (!inputEl) return;
    const template = locale.inputPlaceholder || 'Chat with {profile}';
    inputEl.placeholder = String(template).replace('{profile}', profileDisplayName());
}

export function initRetryBtnClick(): void {
    if (retryBtn) {
        retryBtn.addEventListener('click', doRetry);
    }
}
