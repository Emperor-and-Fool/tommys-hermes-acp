import { state } from '../../state';
import { processFileRefs } from '../composer/fileMention';
import { profileDisplayName } from '../pickers/profilePicker';
import { renderMarkdown, setupContentBlocks } from './markdown';
import { appendMessage, maybeScrollToBottom } from './messageList';
import { enableStopAfterAgentOutput, finalizeAssistantBubble } from './streaming';


export function initShowThoughtsFlag(): void {
    window._showThoughts = true;
}

export function initShowToolCallsFlag(): void {
    window._showToolCalls = true;
}

const TOOL_SHORT_MAX_LINES = 3;

const TOOL_AGGREGATE_MAX_LINES = 12;

const TOOL_AGGREGATE_SEPARATOR = '\n\n---\n\n';

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

export function syncAuxiliaryDetailView(group) {
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

export function resetToolAggregation() {
    state.toolAggregateGroupId = null;
}

function ensureAggregateEntries(group) {
    const state = group._auxState;
    if (!state) return;
    if (state.aggregatedTools && state.aggregatedTools.length) return;
    let firstId = null;
    let firstText = state.rawText || '';
    Object.keys(state.toolCallMap).forEach(function(id) {
        if (state.toolCallMap[id] === group.id && !firstId) {
            firstId = id;
        }
    });
    state.aggregatedTools = [{
        toolCallId: firstId || ('tool_' + group.id),
        text: firstText,
    }];
}

export function handleToolMessage(text, toolCallId) {
    if (state.toolCallMap[toolCallId]) {
        const group = document.getElementById(state.toolCallMap[toolCallId]);
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

    if (state.toolAggregateGroupId) {
        const group = document.getElementById(state.toolAggregateGroupId);
        if (group && group._auxState && canAggregateToolTexts(group._auxState.rawText || '', text)) {
            ensureAggregateEntries(group);
            group._auxState.aggregatedTools.push({ toolCallId: toolCallId, text: text });
            rebuildAggregateToolContent(group);
            state.toolCallMap[toolCallId] = state.toolAggregateGroupId;
            setAuxMessageLive(group, true);
            enableStopAfterAgentOutput();
            maybeScrollToBottom();
            return;
        }
    }

    const id = appendMessage('tool', text);
    state.toolCallMap[toolCallId] = id;
    state.toolAggregateGroupId = id;
}

export function setAuxiliaryContent(group, text) {
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

export function buildAuxiliaryMessage(role, text) {
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

export function wireAuxiliaryMessage(group, parts, deferMarkdown) {
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

export function finalizeAuxiliaryBubble(group) {
    if (!group || !group._auxState) return;
    setAuxiliaryContent(group, group._auxState.rawText);
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

export function auxiliaryRoleLabel(role, text?) {
    const profile = profileDisplayName();
    if (role === 'thought') return profile + ' thinking';
    // older cards (and updates that carry no title) fall back to the literal 'Tool'
    const raw = toolNameFromAuxText(text);
    const name = raw === 'Tool' ? '' : raw;
    return profile + ' using Hermes' + (name ? ' ' + name : '');
}

export function clearAllToolLive() {
    Object.keys(state.toolCallMap).forEach(function(key) {
        const group = document.getElementById(state.toolCallMap[key]);
        const msg = group && group.querySelector('.message.tool');
        if (msg) msg.classList.remove('is-live');
    });
}

export function setAuxMessageLive(group, live) {
    if (!group) return;
    const msg = group.querySelector('.message.thought, .message.tool');
    if (msg) msg.classList.toggle('is-live', live);
}
