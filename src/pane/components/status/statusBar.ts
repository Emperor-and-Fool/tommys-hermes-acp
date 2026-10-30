import { byId, detectEnvBtn, inputEl, retryBtn, statusText, required } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { currentProviderVendor } from '../pickers/modelPicker';
import { profileDisplayName } from '../pickers/profilePicker';


export const TOKEN_RING_RADIUS = 11;

const statusDot = required('statusDot');
const loadingBlock = required('loadingBlock');
const loadingTitle = required('loadingTitle');
const loadingCount = required('loadingCount');

/**
 * The loading state: the identity's icon, a heading, and (in the conversation) a chunk counter.
 * A count to show, never a gate on a load — and no denominator, because Hermes' `message_count`
 * counts rows the pane never renders.
 *
 * `counter: false` is the history viewer's case: an export is one call, not a stream.
 */
export function showLoadingBlock(options?: { title?: string; counter?: boolean }) {
    if (!loadingBlock) return;
    const wasHidden = loadingBlock.hidden;
    const withCounter = options?.counter !== false;
    loadingBlock.hidden = false;
    const title = options?.title || state.currentStatusMessage || locale.statusConnecting;
    if (loadingTitle) loadingTitle.textContent = title;
    if (loadingCount) {
        loadingCount.hidden = !withCounter;
        if (withCounter && wasHidden) {
            // A fresh load starts at zero; a later status message must not wipe a count mid-replay.
            loadingCount.textContent = localeText('loadingMessageChunks', '0');
        }
    }
    // The block replaces the italic placeholder for as long as the wait lasts.
    if (state.placeholder) state.placeholder.style.display = 'none';
}

/** One chunk arrived: the count is the only thing that changes. */
export function updateLoadProgress(received) {
    if (state.currentStatus !== 'connecting') return;
    showLoadingBlock();
    if (loadingCount) loadingCount.textContent = localeText('loadingMessageChunks', String(received));
}

/** Put the pane back on its placeholder: the block belongs to a wait, not to a state. */
export function hideLoadingBlock() {
    if (!loadingBlock || loadingBlock.hidden) return;
    loadingBlock.hidden = true;
    if (state.placeholder) state.placeholder.style.display = '';
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
    const el = required('placeholder');
    if (el) el.textContent = emptyStateText();
}

/** The status line, the dot, and the pane's empty state — one entry point for all three. */
export function updateStatus(status, message) {
    statusDot.className = 'dot ' + status;
    const labels: Record<string, string> = {
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
    // Every state but connecting belongs to the placeholder, not the loading block.
    if (status === 'connecting') {
        showLoadingBlock();
    } else {
        hideLoadingBlock();
    }
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
