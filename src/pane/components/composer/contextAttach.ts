import { byId, contextAttachHelp, contextAttachPicker, contextAttachSendNoBtn, contextAttachSendYesBtn, contextAttachTooltipEl, messagesEl } from '../../dom';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { getGroupRoleLabel, getMessagePlainText } from '../messages/messageList';
import { auxiliaryRoleLabel } from '../messages/toolCards';
import { closeAllDropdowns, hideModal, setMenuOpen, showModal } from '../modals/modal';
import { enterMultiSelectMode, exitMultiSelectMode, getSelectedMessageIndices, setGroupSelected, setGroupsSelected, wireSelectableGroup } from '../multiSelect';
import { executeSendMessage } from './composer';


function resetContextAttachPickerElement() {
    if (contextAttachPicker) {
        contextAttachPicker.hidden = true;
        contextAttachPicker.classList.remove('is-hiding', 'is-entering', 'is-attention');
    }
    state.contextAttachPickerHiding = false;
}

export function forceHideContextAttachPicker() {
    state.contextAttachVisible = false;
    state.contextAttachMode = 'none';
    state.contextAttachCustomIndices = [];
    state.contextAttachCustomPending = false;
    state.contextAttachCustomConfirmed = false;
    state.contextAttachUnconfirmedIndices = [];
    state.contextAttachHasChoice = false;
    state.pendingSendText = '';
    if (state.multiSelectPurpose === 'contextAttach') {
        exitMultiSelectMode();
    }
    resetContextAttachPickerElement();
    closeAllDropdowns();
}

function finishHideContextAttachPicker() {
    state.contextAttachVisible = false;
    state.contextAttachMode = 'none';
    state.contextAttachCustomIndices = [];
    state.contextAttachCustomPending = false;
    state.contextAttachCustomConfirmed = false;
    state.contextAttachUnconfirmedIndices = [];
    state.contextAttachHasChoice = false;
    state.pendingSendText = '';
    if (state.multiSelectPurpose === 'contextAttach') {
        exitMultiSelectMode();
    }
    resetContextAttachPickerElement();
    closeAllDropdowns();
}

export function hideContextAttachPicker() {
    if (!state.contextAttachVisible && !state.contextAttachPickerHiding) {
        return;
    }
    if (state.contextAttachPickerHiding) {
        return;
    }
    if (!contextAttachPicker || contextAttachPicker.hidden) {
        finishHideContextAttachPicker();
        return;
    }
    state.contextAttachPickerHiding = true;
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

export function hideContextAttachTooltip() {
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
    const found: NodeListOf<HTMLElement> = messagesEl.querySelectorAll('.message-group');
    return Array.from(found);
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

export function clearContextAttachSelectableTargets() {
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
    if (state.contextAttachCustomIndices.length > 0) {
        return state.contextAttachCustomIndices.slice();
    }
    if (state.contextAttachUnconfirmedIndices.length > 0) {
        return state.contextAttachUnconfirmedIndices.slice();
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
    if (state.contextAttachCustomConfirmed) {
        return state.contextAttachCustomIndices.length;
    }
    if (state.multiSelectMode && state.multiSelectPurpose === 'contextAttach') {
        return getSelectedMessageIndices().length;
    }
    if (state.contextAttachCustomPending || state.contextAttachUnconfirmedIndices.length > 0) {
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
            if (state.contextAttachCustomPending || state.contextAttachCustomConfirmed || state.contextAttachHasChoice) {
                return locale.contextAttachCustomNone || '您没有选择任何记忆';
            }
            return locale.contextAttachCustom;
        }
        case 'none':
        default:
            if (state.contextAttachHasChoice) {
                return locale.contextAttachNone;
            }
            return locale.contextAttachPlaceholder || locale.contextAttachNone;
    }
}

export function updateContextAttachButtonLabel() {
    if (!contextAttachLabel || !contextAttachBtn) {
        return;
    }
    const isPlaceholder = state.contextAttachMode === 'none' && !state.contextAttachHasChoice;
    contextAttachLabel.textContent = getContextAttachOptionLabel(state.contextAttachMode);
    contextAttachBtn.classList.toggle('is-placeholder', isPlaceholder);
    contextAttachBtn.title = isPlaceholder
        ? (locale.contextAttachPlaceholder || '')
        : getContextAttachOptionLabel(state.contextAttachMode);
    if (state.contextAttachPreviewOpen) {
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

export function isAttachableMemoryGroup(group) {
    return group.classList.contains('user')
        || group.classList.contains('assistant')
        || group.classList.contains('permission');
}

function getAttachableMemoryGroups() {
    return getContextAttachRegionGroups().filter(isAttachableMemoryGroup);
}

function resolveAttachPreviewGroups() {
    if (!state.contextAttachVisible || state.contextAttachMode === 'none') {
        return [];
    }
    const attachable = getAttachableMemoryGroups();
    if (state.contextAttachMode === 'last2') {
        return attachable.slice(-2);
    }
    if (state.contextAttachMode === 'last10') {
        return attachable.slice(-10);
    }
    if (state.contextAttachMode === 'all') {
        return attachable.slice();
    }
    if (state.contextAttachMode === 'custom') {
        let indices = [];
        if (state.contextAttachCustomConfirmed) {
            indices = state.contextAttachCustomIndices;
        } else if (state.multiSelectMode && state.multiSelectPurpose === 'contextAttach') {
            indices = getSelectedMessageIndices();
        } else {
            indices = state.contextAttachUnconfirmedIndices;
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

export function isInsideContextAttachPreview(node) {
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
    const titleEl = byId('contextAttachPreviewTitle');
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
    if (!state.contextAttachVisible || !contextAttachBtn || !contextAttachPreviewEl) {
        return;
    }
    if (contextAttachPicker && contextAttachPicker.classList.contains('is-open')) {
        return;
    }
    if (!hasContextAttachSelection()) {
        return;
    }
    renderContextAttachPreviewContent();
    state.contextAttachPreviewOpen = true;
    contextAttachPreviewEl.hidden = false;
    contextAttachPreviewEl.style.left = '-9999px';
    contextAttachPreviewEl.style.top = '0';
    requestAnimationFrame(function() {
        positionContextAttachPreview();
    });
}

export function hideContextAttachPreview() {
    state.contextAttachPreviewOpen = false;
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
    const contextAttachPreviewClose = byId('contextAttachPreviewClose');
    if (contextAttachPreviewClose) {
        contextAttachPreviewClose.addEventListener('click', function(e) {
            e.stopPropagation();
            hideContextAttachPreview();
        });
    }
    document.addEventListener('pointerdown', function(e) {
        if (!state.contextAttachPreviewOpen) {
            return;
        }
        if (isInsideContextAttachPreview(e.target)) {
            return;
        }
        hideContextAttachPreview();
    }, true);
}

export function renderContextAttachOptions() {
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
        const isActive = opt.mode === state.contextAttachMode
            && (opt.mode !== 'none' || state.contextAttachHasChoice);
        const active = isActive ? ' active' : '';
        return '<div class="dropdown-item' + active + '" data-attach-mode="' + escapeHtml(opt.mode) + '">' +
            escapeHtml(opt.label) + (isActive ? ' ✓' : '') + '</div>';
    }).join('');
    contextAttachList.querySelectorAll('.dropdown-item[data-attach-mode]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const mode = this.dataset.attachMode;
            if (mode === 'custom') {
                state.contextAttachHasChoice = true;
                enterContextAttachSelectMode();
                return;
            }
            if (state.multiSelectPurpose === 'contextAttach') {
                exitMultiSelectMode();
            }
            state.contextAttachCustomPending = false;
            state.contextAttachCustomConfirmed = false;
            state.contextAttachUnconfirmedIndices = [];
            state.contextAttachHasChoice = true;
            state.contextAttachMode = mode;
            state.contextAttachCustomIndices = [];
            updateContextAttachButtonLabel();
            renderContextAttachOptions();
            hideContextAttachPreview();
            closeAllDropdowns();
        });
    });
}

export function showContextAttachPicker() {
    state.contextAttachVisible = true;
    state.contextAttachMode = 'none';
    state.contextAttachCustomIndices = [];
    state.contextAttachCustomPending = false;
    state.contextAttachCustomConfirmed = false;
    state.contextAttachUnconfirmedIndices = [];
    state.contextAttachHasChoice = false;
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
    state.contextAttachPickerHiding = false;
    updateContextAttachButtonLabel();
    renderContextAttachOptions();
}

function enterContextAttachSelectMode() {
    const previousIndices = getExistingCustomAttachIndices();
    state.contextAttachCustomPending = true;
    state.contextAttachCustomConfirmed = false;
    state.contextAttachUnconfirmedIndices = previousIndices.slice();
    state.contextAttachMode = 'custom';
    closeAllDropdowns();
    ensureContextAttachSelectableTargets();
    enterMultiSelectMode(null, 'contextAttach');
    applyContextAttachIndicesToSelection(previousIndices);
    updateContextAttachButtonLabel();
}

export function confirmContextAttachSelection() {
    const indices = getSelectedMessageIndices();
    if (!indices.length) {
        return;
    }
    state.contextAttachCustomIndices = indices.slice();
    state.contextAttachUnconfirmedIndices = [];
    state.contextAttachMode = 'custom';
    state.contextAttachCustomConfirmed = true;
    state.contextAttachCustomPending = false;
    state.contextAttachHasChoice = true;
    exitMultiSelectMode();
    updateContextAttachButtonLabel();
    renderContextAttachOptions();
}

function getUnconfirmedCustomSelectionIndices() {
    if (state.multiSelectMode && state.multiSelectPurpose === 'contextAttach') {
        return getSelectedMessageIndices();
    }
    return state.contextAttachUnconfirmedIndices.slice();
}

export function hasUnconfirmedCustomMemorySelection() {
    if (!state.contextAttachVisible || state.contextAttachCustomConfirmed) {
        return false;
    }
    if (state.contextAttachMode !== 'custom' && !state.contextAttachCustomPending) {
        return false;
    }
    return getUnconfirmedCustomSelectionIndices().length > 0;
}

export function buildContextAttachPayload(forceNoAttach) {
    if (!state.contextAttachVisible) {
        return undefined;
    }
    if (forceNoAttach) {
        return { mode: 'none' };
    }
    if (state.contextAttachCustomConfirmed && state.contextAttachMode === 'custom') {
        return {
            mode: 'custom',
            indices: state.contextAttachCustomIndices.slice(),
        };
    }
    if (state.contextAttachMode === 'none') {
        return { mode: 'none' };
    }
    if (state.contextAttachMode === 'custom' && !state.contextAttachCustomConfirmed) {
        return { mode: 'none' };
    }
    return {
        mode: state.contextAttachMode,
        indices: undefined,
    };
}

function finalizeContextAttachSelectionFromPending() {
    const indices = getUnconfirmedCustomSelectionIndices();
    if (!indices.length) {
        return false;
    }
    state.contextAttachCustomIndices = indices.slice();
    state.contextAttachUnconfirmedIndices = [];
    state.contextAttachMode = 'custom';
    state.contextAttachCustomConfirmed = true;
    state.contextAttachCustomPending = false;
    state.contextAttachHasChoice = true;
    if (state.multiSelectMode && state.multiSelectPurpose === 'contextAttach') {
        exitMultiSelectMode();
    }
    updateContextAttachButtonLabel();
    renderContextAttachOptions();
    return true;
}

export function openContextAttachSendModal(text) {
    state.pendingSendText = text;
    showModal(contextAttachSendModal);
}

function closeContextAttachSendModal() {
    state.pendingSendText = '';
    hideModal(contextAttachSendModal);
}

export function isGroupInContextAttachRegion(group) {
    // No divider: nothing sits outside the attachable region.
    void group;
    return true;
}

const contextAttachBtn = byId('contextAttachBtn');

const contextAttachLabel = byId('contextAttachLabel');

const contextAttachDropdown = byId('contextAttachDropdown');

const contextAttachList = byId('contextAttachList');

const contextAttachPreviewEl = byId('contextAttachPreview');

const contextAttachPreviewList = byId('contextAttachPreviewList');

const contextAttachSendModal = byId('contextAttachSendModal');

export function initContextAttachBtnClick(): void {
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
}

export function initBindContextAttachTooltip(): void {
    bindContextAttachTooltip();
}

export function initBindContextAttachPreview(): void {
    bindContextAttachPreview();
}

export function initContextAttachSendYesBtnClick(): void {
    if (contextAttachSendYesBtn) {
        contextAttachSendYesBtn.addEventListener('click', function() {
            const text = state.pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            finalizeContextAttachSelectionFromPending();
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(false));
        });
    }
}

export function initContextAttachSendNoBtnClick(): void {
    if (contextAttachSendNoBtn) {
        contextAttachSendNoBtn.addEventListener('click', function() {
            const text = state.pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            state.contextAttachUnconfirmedIndices = [];
            state.contextAttachCustomPending = false;
            if (state.contextAttachMode === 'custom' && !state.contextAttachCustomConfirmed) {
                state.contextAttachMode = 'none';
            }
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(true));
        });
    }
}

export function initContextAttachSendModalClick(): void {
    if (contextAttachSendModal) {
        contextAttachSendModal.addEventListener('click', function(e) {
            if (e.target === contextAttachSendModal) {
                closeContextAttachSendModal();
            }
        });
    }
}
