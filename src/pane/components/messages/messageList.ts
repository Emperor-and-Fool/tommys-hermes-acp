import { byId, messagesEl } from '../../dom';
import { assistantRoleLabel } from '../../i18n';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { setInputMode, updateQuickActionBtns } from '../composer/composer';
import { processFileRefs } from '../composer/fileMention';
import { exitMultiSelectMode, setGroupSelected, shouldOfferSelection, wireSelectableGroup } from '../multiSelect';

import { clearChatSearch, scheduleChatSearch } from '../search';
import { emptyStateText } from '../status/statusBar';
import { updateTokenUsage } from '../status/tokenMeter';
import { cancelSessionMarkdownRender, chatSearchState, getGroupMarkdownText, scheduleSessionMarkdownRender } from './markdown';
import { attachMessageActions } from './messageActions';
import { pendingPermissions, restorePermissionMessage } from './permissionCard';
import { enableStopAfterAgentOutput, isActivelyStreaming } from './streaming';
import { auxiliaryRoleLabel, buildAuxiliaryMessage, clearAllToolLive, resetToolAggregation, wireAuxiliaryMessage } from './toolCards';
import { buildHistoryCard } from './historyCard';
import { playHistoryPickerIntro } from '../composer/historyAttach';


const RESTORE_BATCH_SIZE = 30;

const SCROLL_BOTTOM_THRESHOLD = 24;

const SCROLL_IDLE_MS = 5000;

function isMessagesAtBottom() {
    if (!messagesEl) {
        return true;
    }
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
}

export function maybeScrollToBottom(force?) {
    if (!messagesEl) {
        return;
    }
    if (force || !state.scrollPinnedByUser) {
        // This scroll is ours; the event it fires is not the user leaving the bottom.
        state.suppressScrollPinUntil = Date.now() + 200;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

function scheduleScrollReenable() {
    if (state.scrollIdleTimer) {
        clearTimeout(state.scrollIdleTimer);
    }
    state.scrollIdleTimer = setTimeout(function() {
        state.scrollIdleTimer = null;
        if (isActivelyStreaming()) {
            state.scrollPinnedByUser = false;
            maybeScrollToBottom(true);
        }
    }, SCROLL_IDLE_MS);
}

function onMessagesScroll() {
    if (!isActivelyStreaming()) {
        return;
    }
    if (Date.now() < state.suppressScrollPinUntil) {
        return;
    }
    if (!isMessagesAtBottom()) {
        state.scrollPinnedByUser = true;
    }
    scheduleScrollReenable();
}

export function initMessagesElScroll(): void {
    if (messagesEl) {
        messagesEl.addEventListener('scroll', onMessagesScroll, { passive: true });
    }
}

export function resetAutoScrollFollow() {
    state.scrollPinnedByUser = false;
    if (state.scrollIdleTimer) {
        clearTimeout(state.scrollIdleTimer);
        state.scrollIdleTimer = null;
    }
}

export function getMessageContentEl(group) {
    const bubble = group.querySelector('.message') || group;
    return bubble.querySelector('.content') || bubble.querySelector('.aux-body-content');
}

function assignSessionIndex(group) {
    group.dataset.sessionIndex = String(state.sessionMsgCounter++);
}

export function reindexSessionIndices() {
    state.sessionMsgCounter = 0;
    messagesEl.querySelectorAll('.message-group').forEach(function(group) {
        assignSessionIndex(group);
    });
}

export function getGroupRoleLabel(group) {
    if (group.classList.contains('user')) return locale.roleYou;
    if (group.classList.contains('assistant')) return assistantRoleLabel();
    if (group.classList.contains('thought')) return auxiliaryRoleLabel('thought');
    if (group.classList.contains('tool')) return auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText);
    return locale.roleMessage;
}

export function groupsInOrder() {
    return Array.from(messagesEl.querySelectorAll('.message-group'));
}

export function quoteSegmentForGroup(group, range) {
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

export function initDocumentVisibilitychange(): void {
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState !== 'visible') {
            return;
        }
        if (state.sessionMarkdownPending || !window._hermesRendered) {
            scheduleSessionMarkdownRender();
        }
    });
}

export function getMessagePlainText(group) {
    const bubble = group.querySelector('.message') || group;
    const content = bubble.querySelector('.content');
    if (content) return content.textContent || '';
    const aux = bubble.querySelector('.aux-body-content');
    if (aux) return aux.textContent || '';
    return '';
}

function newMessageId() {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function buildSelectWrap(group) {
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
    return selectWrap;
}

export function createGroup(role, id?) {
    const group = document.createElement('div');
    group.className = 'message-group ' + role;
    group.id = id || newMessageId();
    if (shouldOfferSelection(role)) {
        group.classList.add('selectable');
        group.appendChild(buildSelectWrap(group));
        wireSelectableGroup(group);
    }
    assignSessionIndex(group);
    return group;
}

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
    if (options && options.steer) {
        // A steer went into a run that was already going: say so where it lands.
        card.classList.add('steer');
        const tag = document.createElement('span');
        tag.className = 'steer-tag';
        tag.textContent = locale.steer || 'Steer';
        label.appendChild(tag);
    }
    return card;
}

function buildCard(role, text, options) {
    if (role === 'history') {
        const history = buildHistoryCard(text, options && options.history);
        return { card: history.div, auxParts: null, historyParts: history };
    }
    if (role === 'tool' || role === 'thought') {
        const auxParts = buildAuxiliaryMessage(role, text);
        if (!(options && options.restore)) {
            auxParts.div.classList.add('is-live');
        }
        return { card: auxParts.div, auxParts: auxParts };
    }
    return { card: buildMessage(role, text, options), auxParts: null };
}

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
    if (built.historyParts) {
        // Only now does the card have a height to measure: a slice that fits shows no toggle.
        const scrollEl = built.historyParts.scrollEl;
        built.historyParts.moreBtn.hidden = scrollEl.scrollHeight <= scrollEl.clientHeight + 1;
    }
    // Apply visibility filter for thought/tool messages
    if (role === 'thought' && !window._showThoughts) group.style.display = 'none';
    if (role === 'tool' && !window._showToolCalls) group.style.display = 'none';
    return group.id;
}

export function appendMessage(role, text, options?) {
    const restoring = options && options.restore;
    state.placeholder.style.display = 'none';

    // For streaming assistant messages, update the last one (not when restoring history)
    if (!restoring && role === 'assistant' && state.streamingMessageId) {
        const last = document.getElementById(state.streamingMessageId);
        if (last) {
            last.querySelector('.content').textContent = text;
            last._rawText = text;
            if (chatSearchState.query) scheduleChatSearch();
            maybeScrollToBottom();
            return state.streamingMessageId;
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
        state.streamingMessageId = group.id;
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

export function markMissingImages(root, hasImages) {
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

function resetChatView() {
    cancelSessionMarkdownRender();
    clearChatSearch();
    exitMultiSelectMode();
    messagesEl.innerHTML = '<div class="placeholder" id="placeholder">' + escapeHtml(emptyStateText()) + '</div>';
    state.placeholder = byId('placeholder');
    state.streamingMessageId = null;
    state.thoughtMsgId = null;
    state.toolCallMap = {};
    state.sessionMsgCounter = 0;
    resetToolAggregation();
    pendingPermissions.clear();
    window._hermesRendered = false;
    updateQuickActionBtns();
    updateTokenUsage(0, 0);
    setInputMode(state.canSend ? 'send' : 'disabled');
}

export function newChat() {
    resetChatView();
}

export function restoreHistory(messages, localHistoryOnly) {
    cancelSessionMarkdownRender();
    // A freshly restored transcript opens at its end; a pin left over from the previous
    // page would otherwise keep the pane wherever it happened to be.
    state.scrollPinnedByUser = false;
    state.streamingMessageId = null;
    state.thoughtMsgId = null;
    state.toolCallMap = {};
    state.sessionMsgCounter = 0;
    resetToolAggregation();
    pendingPermissions.clear();
    window._hermesRendered = false;
    exitMultiSelectMode();
    if (!messages || messages.length === 0) {
        // An empty session on screen: the picker moves in and glows, so it is found.
        playHistoryPickerIntro();
        return;
    }
    state.placeholder.style.display = 'none';
    let cursor = 0;
    function appendRestoreBatch() {
        const end = Math.min(cursor + RESTORE_BATCH_SIZE, messages.length);
        for (; cursor < end; cursor++) {
            const m = messages[cursor];
            if (m.role === 'permission') {
                restorePermissionMessage(m);
            } else {
                appendMessage(m.role, m.text, {
                    restore: true,
                    deferMarkdown: true,
                    images: m.images,
                    history: m.history,
                    steer: m.steer === true,
                });
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

export function isMessageForActiveSession(msg) {
    return !msg.sessionId || msg.sessionId === state.lastActiveSessionId;
}

/**
 * A card that belongs above the question it was attached to.
 *
 * The stored transcript keeps a history slice before the user message it went with, so a reload
 * reads that way; appending it live would put it below. Indices are then reassigned in DOM order,
 * which is the same order the stored messages have.
 */
export function insertBeforeLastUser(role, text, options?) {
    const users = messagesEl.querySelectorAll('.message-group.user');
    const lastUser = users.length ? users[users.length - 1] : null;
    if (!lastUser || !lastUser.parentNode) {
        return appendMessage(role, text, options);
    }
    const id = appendMessage(role, text, options);
    const group = document.getElementById(id);
    if (group && group !== lastUser) {
        lastUser.parentNode.insertBefore(group, lastUser);
        reindexSessionIndices();
        maybeScrollToBottom();
    }
    return id;
}
