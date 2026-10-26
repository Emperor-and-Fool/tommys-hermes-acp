import { byId, inputEl, messagesEl } from '../../dom';
import { state } from '../../state';
import { groupsInOrder, quoteSegmentForGroup } from '../messages/messageList';
import { sendMessage, showComposerHint, syncInputHeightFromContent, updateQuickActionBtns } from './composer';


const replyQuoteEl = byId('replyQuote');

const replyQuoteTitle = byId('replyQuoteTitle');

const replyQuoteToggle = byId('replyQuoteToggle');

const replyQuoteClear = byId('replyQuoteClear');

const replyQuoteBody = byId('replyQuoteBody');

const undeliveredNotice = byId('undeliveredNotice');

const undeliveredNoticeText = byId('undeliveredNoticeText');

const undeliveredPrimaryBtn = byId('undeliveredPrimaryBtn');

const undeliveredDiscardBtn = byId('undeliveredDiscardBtn');

export function wrapTextRange(root, start, end, active) {
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

const QUOTE_MAX_CHARS = 6000;

function captureSelectionQuote() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const anchorEl = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!anchorEl || !messagesEl.contains(anchorEl)) return null;
    if (state.streamingMessageId) {
        const streaming = document.getElementById(state.streamingMessageId);
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

export function initDocumentSelectionchange(): void {
    document.addEventListener('selectionchange', function() {
        if (state.selectionQuoteTimer) clearTimeout(state.selectionQuoteTimer);
        state.selectionQuoteTimer = setTimeout(function() {
            state.selectionQuoteTimer = null;
            state.lastSelectionQuote = captureSelectionQuote();
            updateQuoteAction(state.lastSelectionQuote);
        }, 120);
    });
}

export function initFunctionWiring3(): void {
    window.__tommysQuote = function() { return state.lastSelectionQuote; };
}

function ensureQuoteAction() {
    if (state.quoteActionEl) return state.quoteActionEl;
    state.quoteActionEl = document.createElement('button');
    state.quoteActionEl.type = 'button';
    state.quoteActionEl.className = 'quote-action';
    state.quoteActionEl.hidden = true;
    state.quoteActionEl.addEventListener('click', function() {
        const stash = state.lastSelectionQuote;
        state.quoteActionEl.hidden = true;
        if (!stash) {
            showComposerHint(locale.replySelectionLost);
            return;
        }
        if (stash.blocked === 'streaming') {
            showComposerHint(locale.replyStreamingBlocked);
            return;
        }
        state.replyQuote = { segments: stash.segments.map(function(seg) { return { role: seg.role, text: seg.text }; }),
                       chars: stash.chars, truncated: stash.truncated };
        renderReplyQuote();
        inputEl.focus();
    });
    document.body.appendChild(state.quoteActionEl);
    return state.quoteActionEl;
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
    if (!state.replyQuote || !state.replyQuote.segments.length) {
        replyQuoteEl.hidden = true;
        return;
    }
    const count = state.replyQuote.segments.length;
    replyQuoteTitle.textContent = String(locale.replyTitle || '{count}').replace('{count}', count)
        + (state.replyQuote.truncated ? ' · ' + locale.replyTruncated : '');
    replyQuoteBody.innerHTML = '';
    state.replyQuote.segments.forEach(function(seg) {
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

export function offerUndeliveredMessage(text) {
    const value = (text || '').trim();
    if (!value || !undeliveredNotice) return;
    state.undeliveredText = text;
    state.undeliveredFilledComposer = inputEl.value.trim() === '';
    if (state.undeliveredFilledComposer) {
        inputEl.value = text;
        syncInputHeightFromContent();
        updateQuickActionBtns();
    }
    undeliveredNoticeText.textContent = locale.undeliveredNotice;
    const canSendIt = state.undeliveredFilledComposer && state.canSend;
    undeliveredPrimaryBtn.textContent = canSendIt ? locale.send : locale.undeliveredRestore;
    undeliveredDiscardBtn.textContent = locale.undeliveredDiscard;
    undeliveredNotice.hidden = false;
    undeliveredPrimaryBtn.focus();
}

function closeUndeliveredNotice(clearComposer) {
    if (clearComposer && state.undeliveredFilledComposer) {
        inputEl.value = '';
        syncInputHeightFromContent();
        updateQuickActionBtns();
    }
    if (undeliveredNotice) undeliveredNotice.hidden = true;
    state.undeliveredText = '';
    state.undeliveredFilledComposer = false;
}

export function initUndeliveredPrimaryBtnClick(): void {
    if (undeliveredPrimaryBtn) {
        undeliveredPrimaryBtn.addEventListener('click', function() {
            const text = state.undeliveredText;
            const wasFilled = state.undeliveredFilledComposer;
            closeUndeliveredNotice(false);
            if (!text) return;
            if (wasFilled && state.canSend) {
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
}

export function initUndeliveredDiscardBtnClick(): void {
    if (undeliveredDiscardBtn) {
        undeliveredDiscardBtn.addEventListener('click', function() { closeUndeliveredNotice(true); });
    }
}

export function clearReplyQuote() {
    state.replyQuote = null;
    if (replyQuoteEl) replyQuoteEl.hidden = true;
}

export function initReplyQuoteToggleClick(): void {
    if (replyQuoteToggle) {
        replyQuoteToggle.addEventListener('click', function() {
            const collapsed = replyQuoteEl.classList.toggle('is-collapsed');
            replyQuoteToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            replyQuoteToggle.textContent = collapsed ? '▸' : '▾';
        });
    }
}

export function initReplyQuoteClearClick(): void {
    if (replyQuoteClear) {
        replyQuoteClear.addEventListener('click', function() { clearReplyQuote(); });
    }
}

export function withReplyQuote(text) {
    if (!state.replyQuote || !state.replyQuote.segments.length) return text;
    const lines = ['[replying-to]'];
    state.replyQuote.segments.forEach(function(seg) {
        lines.push('--- ' + seg.role + ' ---');
        lines.push(seg.text);
    });
    lines.push('[/replying-to]');
    const quoted = lines.join('\n');
    return text ? quoted + '\n\n' + text : quoted;
}
