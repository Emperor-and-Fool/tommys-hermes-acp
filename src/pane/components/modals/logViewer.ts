import { byId, copyLogBtn, logModal, required } from '../../dom';
import { state } from '../../state';
import { copyToClipboard } from '../../util/clipboard';
import { hideModal, isLogModalOpen } from './modal';


const logFilterError = required('logFilterError');

const logFilterWarning = required('logFilterWarning');

const logContent = required('logContent');

const LOG_SCROLL_BOTTOM_THRESHOLD = 24;

const LOG_SCROLL_IDLE_MS = 5000;

function isLogAtBottom() {
    if (!logContent) {
        return true;
    }
    return logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight <= LOG_SCROLL_BOTTOM_THRESHOLD;
}

export function maybeScrollLogToBottom(force?: boolean) {
    if (!logContent) {
        return;
    }
    if (force || !state.logScrollPinnedByUser) {
        logContent.scrollTop = logContent.scrollHeight;
    }
}

function scheduleLogScrollReenable() {
    if (state.logScrollIdleTimer) {
        clearTimeout(state.logScrollIdleTimer);
    }
    state.logScrollIdleTimer = setTimeout(function() {
        state.logScrollIdleTimer = null;
        state.logScrollPinnedByUser = false;
        maybeScrollLogToBottom(true);
    }, LOG_SCROLL_IDLE_MS);
}

function onLogContentScroll() {
    if (!isLogModalOpen()) {
        return;
    }
    if (isLogAtBottom()) {
        state.logScrollPinnedByUser = false;
        if (state.logScrollIdleTimer) {
            clearTimeout(state.logScrollIdleTimer);
            state.logScrollIdleTimer = null;
        }
        return;
    }
    state.logScrollPinnedByUser = true;
    scheduleLogScrollReenable();
}

export function resetLogAutoScrollFollow() {
    state.logScrollPinnedByUser = false;
    if (state.logScrollIdleTimer) {
        clearTimeout(state.logScrollIdleTimer);
        state.logScrollIdleTimer = null;
    }
}

function getVisibleLogText() {
    const showError = !logFilterError || logFilterError.checked;
    const showWarning = !logFilterWarning || logFilterWarning.checked;
    return state.logs
        .filter(function(entry) {
            if (entry.level === 'error') return showError;
            if (entry.level === 'warning') return showWarning;
            return false;
        })
        .map(function(entry) { return entry.line; })
        .join('\n');
}

export function renderLogContent() {
    const showError = !logFilterError || logFilterError.checked;
    const showWarning = !logFilterWarning || logFilterWarning.checked;
    const visible = state.logs.filter(function(entry) {
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

export function initLogCloseButton(): void {
    required('closeLogBtn').addEventListener('click', function() {
        hideModal(logModal);
    });
}

export function initCopyLogBtnClick(): void {
    if (copyLogBtn) {
        copyLogBtn.addEventListener('click', function() {
            const text = getVisibleLogText();
            if (!text) return;
            copyToClipboard(text).then(function() {
                copyLogBtn.classList.add('copied');
                const prevText = copyLogBtn.textContent;
                copyLogBtn.textContent = locale.copied;
                if (state.copyLogResetTimer) clearTimeout(state.copyLogResetTimer);
                state.copyLogResetTimer = setTimeout(function() {
                    state.copyLogResetTimer = null;
                    copyLogBtn.classList.remove('copied');
                    copyLogBtn.textContent = prevText || locale.copy;
                }, 1500);
            });
        });
    }
}

export function initLogClearButton(): void {
    required('clearLogBtn').addEventListener('click', function() {
        state.logs = [];
        renderLogContent();
    });
}

export function initLogFilterErrorChange(): void {
    if (logFilterError) logFilterError.addEventListener('change', renderLogContent);
}

export function initLogFilterWarningChange(): void {
    if (logFilterWarning) logFilterWarning.addEventListener('change', renderLogContent);
}

export function initLogContentScroll(): void {
    if (logContent) {
        logContent.addEventListener('scroll', onLogContentScroll, { passive: true });
    }
}
