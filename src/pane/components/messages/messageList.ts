import { byId, chatBodyEl, messagesEl, required } from '../../dom';
import { post } from '../../post';
import { assistantRoleLabel } from '../../i18n';
import { state } from '../../state';
import { isAtBottom, isPointerNearFabs, jumpControlMode } from '../../../shared/scrollLogic';
import { escapeHtml } from '../../util/html';
import { setInputMode, updateQuickActionBtns } from '../composer/composer';
import { processFileRefs } from '../composer/fileMention';
import { exitMultiSelectMode, setGroupSelected, shouldOfferSelection, wireSelectableGroup } from '../multiSelect';

import type { ChatMessage, HistoryRef, PeerRef, PeerState } from '../../../shared/chat';
import type { HostToPane } from '../../../shared/webview';

/** What a caller can pass when adding a message; mirrors the addMessage payload's extras. */
export interface MessageOptions {
    /** Inline bytes when the pane has them; restored messages carry refs, which the loop skips. */
    images?: ReadonlyArray<unknown>;
    history?: HistoryRef;
    peer?: PeerRef;
    peerState?: PeerState;
    restore?: boolean;
    steer?: boolean;
    deferMarkdown?: boolean;
}

/** The pieces buildCard/buildMessage hand to mountMessage. */
export interface BuiltMessage {
    card: HTMLElement;
    auxParts?: {
        div: HTMLElement; scrollEl: HTMLElement; contentEl: HTMLElement;
        moreBtn: HTMLElement; lessBtn: HTMLElement; role: string; rawText: string;
    } | null;
    historyParts?: { div: HTMLElement; scrollEl: HTMLElement; moreBtn: HTMLElement | null } | null;
}

import { clearChatSearch, scheduleChatSearch } from '../search';
import { emptyStateText } from '../status/statusBar';
import { updateTokenUsage } from '../status/tokenMeter';
import { cancelSessionMarkdownRender, chatSearchState, renderMarkdown, scheduleSessionMarkdownRender } from './markdown';
import { attachMessageActions } from './messageActions';
import { pendingPermissions, restorePermissionMessage } from './permissionCard';
import { enableStopAfterAgentOutput, isActivelyStreaming } from './streaming';
import { auxiliaryRoleLabel, buildAuxiliaryMessage, clearAllToolLive, resetToolAggregation, wireAuxiliaryMessage } from './toolCards';
import { buildHistoryCard } from './historyCard';
import { playHistoryPickerIntro } from '../composer/historyAttach';


const RESTORE_BATCH_SIZE = 30;


/** Past this much travel the control offers "back to the start". */

function isMessagesAtBottom() {
    if (!messagesEl) {
        return true;
    }
    return isAtBottom(messagesEl.scrollTop, messagesEl.scrollHeight, messagesEl.clientHeight);
}

export function maybeScrollToBottom(force?: boolean) {
    if (!messagesEl) {
        return;
    }
    if (force || !state.scrollPinnedByUser) {
        // This scroll is ours; the event it fires is not the user leaving the bottom.
        state.suppressScrollPinUntil = Date.now() + 200;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

/**
 * The follow state is the user's, not a timer's.
 *
 * This used to re-enable following 5 s after the last scroll, so a reader part-way up a long answer
 * was yanked to the bottom mid-sentence. Now the pane follows the conversation only while it is at
 * the bottom; leaving is a decision, and it holds until the reader comes back or asks for "now".
 */
function onMessagesScroll() {
    // The control follows the scroll position even when the *pin* must not: this scroll may be the
    // pane's own (a restore, a send), and the reader still needs to see where the view now is.
    const suppressed = Date.now() < state.suppressScrollPinUntil;
    if (!suppressed) {
        state.scrollPinnedByUser = !isMessagesAtBottom();
    }
    updateJumpControl();
}

/** Which way the one control points: "now" while reading higher up, "top" while following. */
function updateJumpControl() {
    const button = byId<HTMLButtonElement>('jumpCtl');
    if (!button || !messagesEl) {
        return;
    }
    const mode = jumpControlMode(state.scrollPinnedByUser, messagesEl.scrollTop);
    button.hidden = mode === null;
    if (mode === null) {
        return;
    }
    // A glyph, not a sentence: a wide pill covers the last line of the answer, which is where the
    // reader is looking. The words live in the tooltip and in the accessible name.
    const label = mode === 'now' ? localeText('jumpToNow') : localeText('jumpToTop');
    button.dataset.mode = mode;
    // "Jump to now" is downward (towards the newest message); "back to the start" is upward.
    button.innerHTML = mode === 'now'
        ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5 3.5 8h3V2.5h3V8h3L8 13.5z"/></svg>'
        : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 12.5 8h-3v5.5h-3V8h-3L8 2.5z"/></svg>';
    button.title = mode === 'now' ? localeText('jumpToNowHint') : localeText('jumpToTopHint');
    button.setAttribute('aria-label', label);
    // "Jump to now" answers a question the screen no longer answers (where the conversation went);
    // "back to the start" is a convenience, so it stays out of the way until the pointer asks.
    button.classList.toggle('is-dim', mode === 'top');
}

/** How close the pointer has to come to the corner before "back to the start" shows itself. */
/** Reveal every dim control in the stack when the pointer comes near the corner it occupies. */
function revealFabsNear(ev: PointerEvent): void {
    const stack = byId<HTMLElement>('paneFabs');
    const area = chatBodyEl;
    if (!stack || !area) {
        return;
    }
    const box = area.getBoundingClientRect();
    const near = isPointerNearFabs(box, { x: ev.clientX, y: ev.clientY });
    stack.querySelectorAll('.pane-fab.is-dim').forEach(function(fab) {
        fab.classList.toggle('is-revealed', near);
    });
}

function hideFabs(): void {
    byId<HTMLElement>('paneFabs')?.querySelectorAll('.pane-fab').forEach(function(fab) {
        fab.classList.remove('is-revealed');
    });
}

function jumpControlAction(): void {
    if (!messagesEl) {
        return;
    }
    if (state.scrollPinnedByUser) {
        resetAutoScrollFollow();
        maybeScrollToBottom(true);
    } else {
        // A jump, not a scroll: this distance is thousands of pixels, and a smooth animation over it
        // lasts longer than the pane's quiet window, so its own scroll events would read as the
        // reader leaving the bottom and flip the control underneath the click.
        messagesEl.scrollTop = 0;
    }
    updateJumpControl();
}

export function initJumpControl(): void {
    const button = byId<HTMLButtonElement>('jumpCtl');
    if (!button) {
        return;
    }
    button.addEventListener('click', function(e) {
        e.preventDefault();
        jumpControlAction();
    });
    // `.chat-body` rather than `#messages`: the corner strip below the scroller is part of the same
    // area, and a pointer resting there should reveal the controls too.
    chatBodyEl.addEventListener('pointermove', revealFabsNear, { passive: true });
    chatBodyEl.addEventListener('pointerleave', hideFabs, { passive: true });
    updateJumpControl();
}

export function initMessagesElScroll(): void {
    if (messagesEl) {
        messagesEl.addEventListener('scroll', onMessagesScroll, { passive: true });
    }
}

export function resetAutoScrollFollow() {
    state.scrollPinnedByUser = false;
    updateJumpControl();
}

export function getMessageContentEl(group: Element) {
    const bubble = group.querySelector('.message') || group;
    return bubble.querySelector('.content') || bubble.querySelector('.aux-body-content');
}

function assignSessionIndex(group: Element) {
    group.dataset.sessionIndex = String(state.sessionMsgCounter++);
}

export function reindexSessionIndices() {
    state.sessionMsgCounter = 0;
    messagesEl.querySelectorAll('.message-group').forEach(function(group) {
        assignSessionIndex(group);
    });
}

export function getGroupRoleLabel(group: Element) {
    if (group.classList.contains('user')) return locale.roleYou;
    if (group.classList.contains('assistant')) return assistantRoleLabel();
    if (group.classList.contains('thought')) return auxiliaryRoleLabel('thought');
    if (group.classList.contains('tool')) return auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText);
    return locale.roleMessage;
}

export function groupsInOrder() {
    return Array.from(messagesEl.querySelectorAll('.message-group'));
}

export function quoteSegmentForGroup(group: Element, range: Range) {
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

export function getMessagePlainText(group: Element) {
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

function buildSelectWrap(group: Element) {
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

export function createGroup(role: string, id?: string) {
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

function buildMessage(role: string, text: string, options?: MessageOptions) {
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
        for (const entry of images) {
            const img = entry as { mimeType?: string; data?: string } | null;
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

function buildCard(role: string, text: string, options?: MessageOptions) {
    if (role === 'peer') {
        return { card: buildPeerCard(text, options), auxParts: null };
    }
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

/**
 * A forwarded draft: not a turn, not the user's words. It arrives with its sender as a pill, the
 * body rendered the same way an assistant reply is — markdown, sanitised, with the same policy —
 * and two decisions. Neither decision is a default: the card sits there until one is made.
 *
 * A forwarded session-memory pick also carries its ref, which draws as the attach flow's envelope
 * card (title, session handle, span, count) above the body. The body is that peer's text either way.
 */
function buildPeerCard(text: string, options?: MessageOptions) {
    const peer = (options && options.peer) || null;
    const state = (options && options.peerState) || 'pending';
    const card = document.createElement('div');
    card.className = 'message peer' + (state === 'pending' ? '' : ' is-' + state);

    const label = document.createElement('div');
    label.className = 'label peer-pill';
    if (peer && peer.senderRole) label.classList.add('is-' + peer.senderRole);
    label.textContent = peer
        ? (locale.peerCardHeader || '{0}@{1}').replace('{0}', peer.fromProfile).replace('{1}', peer.fromHost)
        : '';
    card.appendChild(label);

    const ref = options && options.history;
    if (ref) {
        const envelope = buildHistoryCard('', ref, false);
        envelope.div.classList.add('peer-envelope');
        card.appendChild(envelope.div);
    }

    const content = document.createElement('div');
    content.className = 'content';
    // Built here, not left to the session sweep: a peer card arrives live, and the sweep only runs
    // after a restore — which is why forwarded markdown used to sit there as literal characters.
    content.innerHTML = renderMarkdown(text);
    card.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'peer-actions';
    const deliverBtn = document.createElement('button');
    deliverBtn.type = 'button';
    deliverBtn.className = 'button button--primary deliver-btn';
    deliverBtn.textContent = locale.peerCardDeliver || 'Deliver';
    deliverBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!peer) return;
        // One button answers the queue it sits in. A queue of one is a single card, and takes the
        // single-card path — the same transitions, one envelope instead of a set.
        post(pendingInStack(card).length > 1
            ? { type: 'deliverAllPeers' }
            : { type: 'deliverPeer', envelopeId: peer.envelopeId });
    });
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'button dismiss-btn';
    dismissBtn.textContent = locale.peerCardDismiss || 'Dismiss';
    dismissBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!peer) return;
        post(pendingInStack(card).length > 1
            ? { type: 'dismissAllPeers' }
            : { type: 'dismissPeer', envelopeId: peer.envelopeId });
    });
    actions.appendChild(deliverBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(actions);

    const settled = document.createElement('div');
    settled.className = 'peer-status';
    settled.textContent = state === 'delivered'
        ? (locale.peerCardDelivered || 'Delivered to agent')
        : (locale.peerCardDismissed || 'Dismissed');
    card.appendChild(settled);

    return card;
}

/** Deliver or Dismiss came back: settle the card, no re-render. */
export function applyPeerState(envelopeId: string, state: PeerState) {
    const group = document.querySelector('.message-group.peer[data-envelope-id="' + envelopeId + '"]');
    if (!group) return;
    group.dataset.peerState = state;
    const card = group.querySelector('.message.peer');
    if (!card) return;
    card.classList.remove('is-delivered', 'is-dismissed');
    card.classList.add('is-' + state);
    const status = card.querySelector('.peer-status');
    if (status) {
        status.textContent = state === 'delivered'
            ? (locale.peerCardDelivered || 'Delivered to agent')
            : (locale.peerCardDismissed || 'Dismissed');
    }
}

/**
 * Pending peer cards queue into one stack: one rail, one pill per card, one set of decisions on
 * the last card. A new pending card after a settled one starts a fresh stack, so a delivered
 * conversation never grows a rail over what came before it.
 */
function pendingInStack(card: Element): Element[] {
    const stack = card.closest('.peer-stack');
    if (!stack) {
        return [];
    }
    return Array.prototype.slice.call(
        stack.querySelectorAll('.message-group.peer[data-peer-state="pending"]')
    );
}

function appendPeerToStack(group: Element) {
    const last = messagesEl.lastElementChild;
    // Only a stack that still has a pending card takes another one: a queue that has been
    // answered is closed, and a new card after it starts its own rail.
    const stack = last && last.classList.contains('peer-stack')
        && last.querySelector('.message-group.peer[data-peer-state="pending"]')
        ? last
        : null;
    let target = stack;
    if (!target) {
        target = document.createElement('div');
        target.className = 'peer-stack';
        // The rail takes the stack's first sender; each card's pill carries its own identity.
        target.dataset.senderRole = group.dataset.senderRole || 'secondant';
        messagesEl.appendChild(target);
    }
    target.appendChild(group);
    syncPeerStackDecisions(target);
}

/** Only the last pending card in a stack offers Deliver/Dismiss. */
function syncPeerStackDecisions(stack: Element) {
    const items = Array.prototype.slice.call(stack.querySelectorAll(':scope > .message-group.peer'));
    items.forEach(function(item, index) {
        const last = index === items.length - 1;
        item.classList.toggle('peer-stack-last', last);
        item.classList.toggle('peer-stack-early', !last);
    });
}

function mountMessage(group: Element, built: BuiltMessage, options?: MessageOptions) {
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
    if (role === 'peer' && group.dataset.peerState === 'pending') {
        appendPeerToStack(group);
    } else {
        messagesEl.appendChild(group);
    }
    if (built.historyParts && built.historyParts.moreBtn) {
        // Only now does the card have a height to measure: a slice that fits shows no toggle.
        const scrollEl = built.historyParts.scrollEl;
        built.historyParts.moreBtn.hidden = scrollEl.scrollHeight <= scrollEl.clientHeight + 1;
    }
    // Apply visibility filter for thought/tool messages
    if (role === 'thought' && !window._showThoughts) group.style.display = 'none';
    if (role === 'tool' && !window._showToolCalls) group.style.display = 'none';
    return group.id;
}

export function appendMessage(role: string, text: string, options?: MessageOptions) {
    const restoring = options && options.restore;
    state.placeholder.style.display = 'none';

    // For streaming assistant messages, update the last one (not when restoring history)
    if (!restoring && role === 'assistant' && state.streamingMessageId) {
        const last = document.getElementById(state.streamingMessageId);
        if (last) {
            const content = last.querySelector('.content');
            if (content) content.textContent = text;
            last._rawText = text;
            if (chatSearchState.query) scheduleChatSearch();
            maybeScrollToBottom();
            updateJumpControl();
            return state.streamingMessageId;
        }
    }

    const group = createGroup(role);
    if (role === 'peer' && options && options.peer) {
        group.dataset.envelopeId = options.peer.envelopeId;
        group.dataset.senderRole = options.peer.senderRole || 'secondant';
        group.dataset.peerState = options.peerState || 'pending';
    }
    // Forwarding a history card should hand the other pane the ref, not a paragraph that
    // describes it: the group keeps it so the forward button can send the structured payload.
    if (role === 'history' && options && options.history) {
        group._historyRef = options.history;
    }
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

export function markMissingImages(root: Element, hasImages: boolean) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
        if (/\[(screenshot|image)\]/i.test(node.textContent || '')) hits.push(node);
    }
    hits.forEach(function(textNode) {
        const parts = (textNode.textContent || '').split(/(\[(?:screenshot|image)\])/i);
        const frag = document.createDocumentFragment();
        let lastNode: Node | null = null;
        const appendText = function(value: string) {
            if (!value) return;
            let text = value;
            // Only fold the space when the previous sibling is text: a red statement in
            // between keeps the two words apart.
            if (lastNode && lastNode.nodeType === 3 && /\s$/.test(lastNode.textContent || '') && /^\s/.test(text)) {
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
    state.placeholder = required('placeholder') as HTMLElement;
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

export function restoreHistory(messages: ChatMessage[], localHistoryOnly: boolean) {
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
                    history: m.history,
                    steer: m.steer === true,
                    peer: m.peer,
                    peerState: m.peerState,
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

export function isMessageForActiveSession(msg: { sessionId?: string }) {
    return !msg.sessionId || msg.sessionId === state.lastActiveSessionId;
}

/**
 * A card that belongs above the question it was attached to.
 *
 * The stored transcript keeps a history slice before the user message it went with, so a reload
 * reads that way; appending it live would put it below. Indices are then reassigned in DOM order,
 * which is the same order the stored messages have.
 */
export function insertBeforeLastUser(role: string, text: string, options?: MessageOptions) {
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
