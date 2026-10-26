import { byId, cancelBtn, chatBodyEl, chatSearchInput, clearInputBtn, copySessionBtn, inputEl, inputResizeHandle, messagesEl, quickToggleBtn, sendBtn } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { appendMessage, resetAutoScrollFollow } from '../messages/messageList';
import { requestSessionExport } from '../multiSelect';
import { clearChatSearch, scheduleChatSearch } from '../search';
import { buildContextAttachPayload, hasUnconfirmedCustomMemorySelection, openContextAttachSendModal } from './contextAttach';
import { detectFileMention, hideFilePicker } from './fileMention';
import { renderPendingImagesBar } from './images';
import { clearReplyQuote, withReplyQuote } from './replyQuote';


const inputAreaEl = byId('input-area');

const inputCompositeEl = byId('inputComposite');
/* chat.js:16 — the wrapper above #inputComposite. A lookup, so top level is fine. */
const inputCompositeShellEl = inputCompositeEl ? inputCompositeEl.closest('.input-composite-shell') : null;

const inputQuickPanel = byId('inputQuickPanel');

const composerHint = byId('composerHint');

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

export function syncInputHeightFromContent() {
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

export function initInitInputHeight(): void {
    (function initInputHeight() {
        let saved = INPUT_HEIGHT_DEFAULT;
        try {
            const raw = localStorage.getItem(INPUT_HEIGHT_STORAGE_KEY);
            if (raw) saved = parseInt(raw, 10);
        } catch (_) {}
        if (isNaN(saved)) saved = INPUT_HEIGHT_DEFAULT;
        setInputMaxHeight(saved, { persist: false, explicit: false });
    })();
}

export function initInputResizeHandlePointerdown(): void {
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
}

export function initWindowResize(): void {
    window.addEventListener('resize', syncInputHeightFromContent);
}

export function maybeFocusInputAfterResponse() {
    if (!state.canSend || inputEl.disabled) {
        return;
    }
    if (!document.hasFocus()) {
        return;
    }
    requestAnimationFrame(function() {
        if (state.canSend && !inputEl.disabled && document.hasFocus()) {
            inputEl.focus();
        }
    });
}

export const pendingImages = [];

export function executeSendMessage(text, attachOverride?) {
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
    state.awaitingFirstChunk = true;
    setInputMode('waiting');
    // Sending by clicking the button leaves focus on the button, which made the box
    // look dead until the turn ended. The next thing typed belongs in the composer.
    inputEl.focus();

    const payload = attachOverride !== undefined
        ? attachOverride
        : buildContextAttachPayload(false);
    post({
        type: 'sendMessage',
        text: outgoing,
        contextAttach: payload,
        images: imagesForBubble.length ? imagesForBubble : undefined,
    });
    pendingImages.length = 0;
    renderPendingImagesBar();
    clearReplyQuote();
}

export function setInputMode(mode) {
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
        sendBtn.disabled = !state.canSend;
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

export function updateQuickActionBtns() {
    const hasMessages = messagesEl.querySelectorAll('.message-group').length > 0;
    const hasInput = !!inputEl.value.trim();
    if (copySessionBtn) copySessionBtn.disabled = !hasMessages;
    if (clearInputBtn) clearInputBtn.disabled = !hasInput;
    if (chatSearchInput) chatSearchInput.disabled = !hasMessages;
    if (!hasMessages) clearChatSearch();
    else if (chatSearchInput && chatSearchInput.value.trim()) scheduleChatSearch();
}

function flashQuickActionBtn(btn, className?, duration?) {
    if (!btn) return;
    btn.classList.add(className || 'copied');
    setTimeout(function() {
        btn.classList.remove(className || 'copied');
    }, duration || 1500);
}

export function showComposerHint(message, seconds?) {
    if (!composerHint) return;
    composerHint.textContent = message;
    composerHint.hidden = false;
    if (state.composerHintTimer) clearTimeout(state.composerHintTimer);
    state.composerHintTimer = setTimeout(function() {
        composerHint.hidden = true;
        state.composerHintTimer = null;
    }, (seconds || 10) * 1000);
}

export function pickerRowReserve() {
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

export function sendMessage() {
    const text = inputEl.value.trim();
    const hasImages = pendingImages.length > 0;
    // Allow sending with either text OR staged images.
    if ((!text && !hasImages) || !state.canSend) return;

    if (hasUnconfirmedCustomMemorySelection()) {
        openContextAttachSendModal(text);
        return;
    }

    executeSendMessage(text);
}

export function initInputElInput(): void {
    inputEl.addEventListener('input', function() {
        syncInputHeightFromContent();
        detectFileMention();
        updateQuickActionBtns();
    });
}

export function initSendBtnClick(): void {
    sendBtn.addEventListener('click', sendMessage);
}

export function initQuickToggleBtnClick(): void {
    if (quickToggleBtn) {
        quickToggleBtn.addEventListener('click', toggleQuickPanel);
    }
}

export function initClearInputBtnClick(): void {
    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', function() {
            if (clearInputBtn.disabled) return;
            inputEl.value = '';
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        });
    }
}

export function initCopySessionBtnClick(): void {
    if (copySessionBtn) {
        copySessionBtn.addEventListener('click', function() {
            if (copySessionBtn.disabled) return;
            requestSessionExport('copy');
            flashQuickActionBtn(copySessionBtn);
        });
    }
}

export function initCancelBtnClick(): void {
    cancelBtn.addEventListener('click', function() {
        post({ type: 'cancel' });
    });
}

export function initWirePickerRowReserve(): void {
    wirePickerRowReserve();
}

export function initFontSize(): void {
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
            label.textContent = String(size);
            pickerRowReserve();
        }
        apply(size);
    })();
}
