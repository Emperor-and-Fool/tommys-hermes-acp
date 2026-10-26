import { MAX_HISTORY_MESSAGES } from '../../shared/chat';
import { byId, inputEl, messagesEl, multiSelectAllBtn, multiSelectAttachConfirmBtn, multiSelectCopyBtn, multiSelectDeleteBtn, multiSelectExitBtn, multiSelectExportBtn } from '../dom';
import { assistantRoleLabel } from '../i18n';
import { post } from '../post';
import { state } from '../state';
import { sendMessage, updateQuickActionBtns } from './composer/composer';
import { clearContextAttachSelectableTargets, confirmContextAttachSelection, hideContextAttachPreview, isAttachableMemoryGroup, isGroupInContextAttachRegion, updateContextAttachButtonLabel } from './composer/contextAttach';
import { hideFilePicker, selectFileMention, updateFilePickerHighlight } from './composer/fileMention';
import { getGroupMarkdownText } from './messages/markdown';
import { reindexSessionIndices } from './messages/messageList';
import { auxiliaryRoleLabel } from './messages/toolCards';


const multiSelectToolbar = byId('multiSelectToolbar');

const multiSelectCount = byId('multiSelectCount');

function getSessionPlainText() {
    const groups = messagesEl.querySelectorAll('.message-group');
    const lines = [];
    groups.forEach(function(group) {
        const role = group.classList.contains('user') ? locale.roleYou
            : group.classList.contains('assistant') ? assistantRoleLabel()
            : group.classList.contains('thought') ? auxiliaryRoleLabel('thought')
            : group.classList.contains('tool') ? auxiliaryRoleLabel('tool', group._auxState && group._auxState.rawText)
            : locale.roleMessage;
        const text = getGroupMarkdownText(group).trim();
        if (!text) return;
        lines.push(role + ':\n' + text);
    });
    return lines.join('\n\n');
}

export function isSelectableRole(role) {
    return role === 'user' || role === 'assistant' || role === 'thought' || role === 'tool';
}

/**
 * The roles a history attach may carry. Which roles to allow is SKDJ's open decision, so it is
 * one list here and nothing else names a role for this purpose.
 */
export const HISTORY_PICK_ROLES: string[] = ['user', 'assistant'];

function isHistoryPick(): boolean {
    return state.multiSelectPurpose === 'historyPick';
}

/** Whether the transcript offers this role a tick box as it stands. */
export function shouldOfferSelection(role: string): boolean {
    if (!isSelectableRole(role)) {
        return false;
    }
    if (document.body.classList.contains('is-viewer')) {
        return HISTORY_PICK_ROLES.indexOf(role) >= 0;
    }
    return true;
}

/** Past the cap: the next tick is refused rather than counted. */
function atHistoryPickLimit(): boolean {
    return isHistoryPick() && getSelectedGroups().length >= MAX_HISTORY_MESSAGES;
}

function selectableForPurpose(group) {
    if (!isHistoryPick()) {
        return true;
    }
    return HISTORY_PICK_ROLES.some(function(role) {
        return group.classList.contains(role);
    });
}

function getSelectableGroups() {
    const found: NodeListOf<HTMLElement> = messagesEl.querySelectorAll('.message-group.selectable');
    return Array.from(found).filter(function(group) {
        if (group.style.display === 'none') {
            return false;
        }
        if (!selectableForPurpose(group)) {
            return false;
        }
        if (state.multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
            return false;
        }
        if (state.multiSelectPurpose === 'contextAttach' && !isAttachableMemoryGroup(group)) {
            return false;
        }
        return true;
    });
}

function getSelectedGroups() {
    return getSelectableGroups().filter(function(group) {
        return group.classList.contains('is-selected');
    });
}

function getGroupCheckbox(group) {
    return group.querySelector('.msg-select-wrap input[type="checkbox"]');
}

export function setGroupSelected(group, selected) {
    if (!group.classList.contains('selectable')) {
        return;
    }
    // A tick past the cap, or on a role a history attach cannot carry, is refused here: every
    // path (the checkbox, a row click, select-all) ends in this function.
    if (selected && atHistoryPickLimit() && !group.classList.contains('is-selected')) {
        // The browser has already flipped a clicked box: put it back, the tick is refused.
        const refused = getGroupCheckbox(group);
        if (refused) refused.checked = false;
        return;
    }
    group.classList.toggle('is-selected', selected);
    const checkbox = getGroupCheckbox(group);
    if (checkbox) checkbox.checked = selected;
    updateMultiSelectToolbar();
}

export function setGroupsSelected(updates) {
    updates.forEach(function(entry) {
        if (entry.selected && atHistoryPickLimit() && !entry.group.classList.contains('is-selected')) {
            return;
        }
        entry.group.classList.toggle('is-selected', entry.selected);
        const checkbox = getGroupCheckbox(entry.group);
        if (checkbox) checkbox.checked = entry.selected;
    });
    updateMultiSelectToolbar();
}

function areAllSelectableGroupsSelected(groups) {
    return groups.length > 0 && groups.every(function(group) {
        return group.classList.contains('is-selected');
    });
}

function toggleGroupSelection(group) {
    setGroupSelected(group, !group.classList.contains('is-selected'));
}

export function updateMultiSelectToolbar() {
    const selected = getSelectedGroups();
    const count = selected.length;
    const isAttachMode = state.multiSelectPurpose === 'contextAttach';
    const isHistoryPickMode = isHistoryPick();
    if (multiSelectCount) {
        // The history picker carries its count in the Attach button instead.
        multiSelectCount.textContent = isHistoryPickMode
            ? ''
            : count > 0
                ? (locale.multiSelectCount || '{0} selected').replace('{0}', String(count))
                : (locale.selectMessages || 'Select');
    }
    const hasSelection = count > 0;
    if (multiSelectDeleteBtn) multiSelectDeleteBtn.disabled = !hasSelection;
    if (multiSelectCopyBtn) multiSelectCopyBtn.disabled = !hasSelection;
    if (multiSelectExportBtn) multiSelectExportBtn.disabled = !hasSelection;
    // Only the ticks, Attach and Cancel exist in the history viewer.
    if (multiSelectAllBtn) multiSelectAllBtn.hidden = isHistoryPickMode;
    if (multiSelectDeleteBtn) multiSelectDeleteBtn.hidden = isHistoryPickMode;
    if (multiSelectCopyBtn) multiSelectCopyBtn.hidden = isHistoryPickMode;
    if (multiSelectExportBtn) multiSelectExportBtn.hidden = isHistoryPickMode;
    if (multiSelectAttachConfirmBtn) {
        multiSelectAttachConfirmBtn.hidden = !isAttachMode && !isHistoryPickMode;
        multiSelectAttachConfirmBtn.disabled = !hasSelection;
        if (isHistoryPickMode) {
            multiSelectAttachConfirmBtn.textContent = (locale.historyAttachCount || 'Attach ({0}/{1})')
                .replace('{0}', String(count))
                .replace('{1}', String(MAX_HISTORY_MESSAGES));
        }
    }
    if (multiSelectExitBtn && isHistoryPickMode) {
        multiSelectExitBtn.textContent = locale.historyViewerCancel || 'Cancel';
    }
    const selectableGroups = getSelectableGroups();
    if (multiSelectAllBtn) {
        multiSelectAllBtn.textContent = areAllSelectableGroupsSelected(selectableGroups)
            ? (locale.multiSelectDeselectAll || '取消全选')
            : (locale.multiSelectAll || '全选');
    }
    if (isAttachMode) {
        updateContextAttachButtonLabel();
    }
    hideContextAttachPreview();
}

export function enterMultiSelectMode(initialGroup, purpose?) {
    state.multiSelectPurpose = purpose || 'normal';
    if (state.multiSelectMode) {
        if (initialGroup) {
            setGroupSelected(initialGroup, true);
        }
        updateMultiSelectToolbar();
        return;
    }
    state.multiSelectMode = true;
    messagesEl.classList.add('multi-select-active');
    if (multiSelectToolbar) {
        multiSelectToolbar.hidden = false;
        multiSelectToolbar.classList.add('visible');
    }
    if (initialGroup) {
        setGroupSelected(initialGroup, true);
    } else {
        updateMultiSelectToolbar();
    }
}

export function exitMultiSelectMode() {
    if (!state.multiSelectMode) {
        return;
    }
    const wasAttachMode = state.multiSelectPurpose === 'contextAttach';
    if (wasAttachMode && state.contextAttachCustomPending && !state.contextAttachCustomConfirmed) {
        const indices = getSelectedMessageIndices();
        if (indices.length > 0) {
            state.contextAttachUnconfirmedIndices = indices.slice();
            state.contextAttachMode = 'custom';
        } else {
            state.contextAttachMode = 'none';
            state.contextAttachCustomPending = false;
            state.contextAttachUnconfirmedIndices = [];
        }
    }
    state.multiSelectMode = false;
    state.multiSelectPurpose = 'normal';
    messagesEl.classList.remove('multi-select-active');
    getSelectableGroups().forEach(function(group) {
        setGroupSelected(group, false);
    });
    clearContextAttachSelectableTargets();
    if (multiSelectToolbar) {
        multiSelectToolbar.hidden = true;
        multiSelectToolbar.classList.remove('visible');
    }
    updateMultiSelectToolbar();
    updateContextAttachButtonLabel();
}

export function wireSelectableGroup(group) {
    if (group.dataset.selectWired) return;
    group.dataset.selectWired = '1';
    group.addEventListener('click', function(e) {
        if (!state.multiSelectMode) return;
        if (state.multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
            return;
        }
        if (isHistoryPick() && !selectableForPurpose(group)) {
            return;
        }
        if (e.target.closest('.message-actions, .block-actions, .insert-dropdown, .insert-dropdown-menu, .msg-select-wrap')) {
            return;
        }
        e.preventDefault();
        toggleGroupSelection(group);
    });
}

export function getSelectedMessageIndices(groups?) {
    return (groups || getSelectedGroups()).map(function(group) {
        return parseInt(group.dataset.sessionIndex || '', 10);
    }).filter(function(index) {
        return Number.isInteger(index) && index >= 0;
    });
}

export function requestSessionExport(action, indices?, sessionId?) {
    const sid = sessionId || state.lastActiveSessionId;
    if (!sid) return;
    post({
        type: 'sessionExport',
        sessionId: sid,
        action: action,
        indices: indices && indices.length ? indices : undefined,
    });
}

function deleteSelectedGroups() {
    const selected = getSelectedGroups();
    if (!selected.length) return;
    const indices = selected.map(function(group) {
        return parseInt(group.dataset.sessionIndex || '', 10);
    }).filter(function(index) {
        return Number.isInteger(index) && index >= 0;
    });
    post({ type: 'deleteMessages', indices: indices });
    selected.forEach(function(group) {
        group.remove();
    });
    reindexSessionIndices();
    exitMultiSelectMode();
    updateQuickActionBtns();
    if (!messagesEl.querySelector('.message-group')) {
        state.placeholder.style.display = 'block';
    }
}

function exportSelectedGroups() {
    const indices = getSelectedMessageIndices();
    if (!indices.length) return;
    requestSessionExport('export', indices);
}

export function initInputElKeydown(): void {
    inputEl.addEventListener('keydown', function(e) {
        if (state.filePickerVisible && state.filePickerItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.filePickerIndex = (state.filePickerIndex + 1) % state.filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.filePickerIndex = (state.filePickerIndex - 1 + state.filePickerItems.length) % state.filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectFileMention(state.filePickerItems[state.filePickerIndex]);
                return;
            }
        }
        if (e.key === 'Escape' && state.filePickerVisible) {
            e.preventDefault();
            hideFilePicker();
            return;
        }
        if (e.key === 'Escape' && state.multiSelectMode) {
            e.preventDefault();
            exitMultiSelectMode();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

export function initMultiSelectAllBtnClick(): void {
    if (multiSelectAllBtn) {
        multiSelectAllBtn.addEventListener('click', function() {
            if (isHistoryPick()) {
                return;
            }
            if (!state.multiSelectMode) {
                enterMultiSelectMode(null, state.multiSelectPurpose);
            }
            const groups = getSelectableGroups();
            const selectAll = !areAllSelectableGroupsSelected(groups);
            setGroupsSelected(groups.map(function(group) {
                return { group: group, selected: selectAll };
            }));
        });
    }
}

export function initMultiSelectDeleteBtnClick(): void {
    if (multiSelectDeleteBtn) {
        multiSelectDeleteBtn.addEventListener('click', function() {
            if (multiSelectDeleteBtn.disabled || isHistoryPick()) return;
            deleteSelectedGroups();
        });
    }
}

export function initMultiSelectCopyBtnClick(): void {
    if (multiSelectCopyBtn) {
        multiSelectCopyBtn.addEventListener('click', function() {
            if (multiSelectCopyBtn.disabled || isHistoryPick()) return;
            const indices = getSelectedMessageIndices();
            if (!indices.length) return;
            requestSessionExport('copy', indices);
        });
    }
}

export function initMultiSelectExportBtnClick(): void {
    if (multiSelectExportBtn) {
        multiSelectExportBtn.addEventListener('click', function() {
            if (multiSelectExportBtn.disabled || isHistoryPick()) return;
            exportSelectedGroups();
        });
    }
}

export function initMultiSelectExitBtnClick(): void {
    if (multiSelectExitBtn) {
        multiSelectExitBtn.addEventListener('click', exitMultiSelectMode);
    }
}

export function initMultiSelectAttachConfirmBtnClick(): void {
    if (multiSelectAttachConfirmBtn) {
        multiSelectAttachConfirmBtn.addEventListener('click', function() {
            if (multiSelectAttachConfirmBtn.disabled) {
                return;
            }
            // In the history viewer the same button carries the pick; the viewer owns that post.
            if (state.multiSelectPurpose !== 'contextAttach') {
                return;
            }
            confirmContextAttachSelection();
        });
    }
}
