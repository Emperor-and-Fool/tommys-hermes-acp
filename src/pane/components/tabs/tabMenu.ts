import { byId, tabBar, tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { copyToClipboard } from '../../util/clipboard';
import { escapeHtml } from '../../util/html';
import { COPY_ICON_SVG } from '../messages/markdown';
import { requestSessionExport } from '../multiSelect';
import { renderSessionTabs } from './tabStrip';


export function hideTabContextMenu() {
    state.tabContextSessionId = null;
    if (tabContextMenu) {
        tabContextMenu.hidden = true;
        tabContextMenu.innerHTML = '';
    }
}

function positionTabContextMenu(x, y) {
    if (!tabContextMenu) return;
    tabContextMenu.hidden = false;
    tabContextMenu.style.left = '0px';
    tabContextMenu.style.top = '0px';
    const rect = tabContextMenu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    tabContextMenu.style.left = Math.min(x, maxLeft) + 'px';
    tabContextMenu.style.top = Math.min(y, maxTop) + 'px';
}

export function showTabContextMenu(sessionId, clientX, clientY) {
    const session = state.lastSessions.find(function(s) { return s.id === sessionId; });
    if (!session || !tabContextMenu) {
        return;
    }
    state.tabContextSessionId = sessionId;
    const idx = state.lastSessions.findIndex(function(s) { return s.id === sessionId; });
    const canCloseLeft = idx > 0;
    const canCloseRight = idx >= 0 && idx < state.lastSessions.length - 1;
    const canCloseOthers = state.lastSessions.length > 1;
    const pinLabel = session.pinned ? locale.tabContextUnpin : locale.tabContextPin;

    tabContextMenu.innerHTML =
        '<div class="tab-ctx-sid">' +
            '<span class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextSid) + ':</span>' +
            '<span class="tab-ctx-sid-value" title="' + escapeHtml(sessionId) + '">' + escapeHtml(sessionId) + '</span>' +
            '<button type="button" class="tab-ctx-sid-copy" data-action="copySid" title="' + escapeHtml(locale.copySid) + '">' + COPY_ICON_SVG + '</button>' +
        '</div>' +
        '<button type="button" class="tab-ctx-item" data-action="export">' + escapeHtml(locale.tabContextExport) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="copy">' + escapeHtml(locale.tabContextCopy) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="rename">' + escapeHtml(locale.tabContextRename) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="close">' + escapeHtml(locale.tabContextClose) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeOthers"' + (canCloseOthers ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseOthers) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeLeft"' + (canCloseLeft ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseLeft) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeRight"' + (canCloseRight ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseRight) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeAll">' + escapeHtml(locale.tabContextCloseAll) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="togglePin">' + escapeHtml(pinLabel) + '</button>';

    tabContextMenu.querySelector('[data-action="copySid"]').addEventListener('click', function(e) {
        e.stopPropagation();
        copyToClipboard(sessionId);
    });
    tabContextMenu.querySelectorAll('.tab-ctx-item[data-action]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            if (item.disabled || !state.tabContextSessionId) return;
            const action = item.dataset.action;
            const targetId = state.tabContextSessionId;
            hideTabContextMenu();
            if (action === 'export') {
                requestSessionExport('export', undefined, targetId);
            } else if (action === 'copy') {
                requestSessionExport('copy', undefined, targetId);
            } else if (action === 'rename') {
                startTabRename(targetId);
            } else if (action === 'togglePin') {
                post({ type: 'togglePinSession', sessionId: targetId });
            } else if (action === 'close' || action === 'closeOthers' || action === 'closeLeft' || action === 'closeRight' || action === 'closeAll') {
                const mode = action === 'close' ? 'self'
                    : action === 'closeOthers' ? 'others'
                    : action === 'closeLeft' ? 'left'
                    : action === 'closeRight' ? 'right'
                    : 'all';
                post({ type: 'closeSessions', sessionId: targetId, mode: mode });
            }
        });
    });

    positionTabContextMenu(clientX, clientY);
}

function startTabRename(sessionId) {
    if (!sessionId) {
        return;
    }
    const tabs = tabBar.querySelectorAll('.session-tab');
    let tab: Element | null = null;
    for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].dataset.id === sessionId) {
            tab = tabs[i];
            break;
        }
    }
    const titleEl = tab ? tab.querySelector('.tab-title') : null;
    if (!tab || !titleEl || tab.classList.contains('editing')) {
        return;
    }
    // Bound for the nested finish(): narrowing does not survive into a closure.
    const tabEl = tab;
    const titleNode = titleEl;
    const record = state.lastSessions.find(function(s) { return s.id === sessionId; });
    const current = (record && record.title) || titleEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = current;
    input.maxLength = 100;
    input.spellcheck = false;
    input.setAttribute('aria-label', locale.tabContextRename);
    let finished = false;
    function finish(commit) {
        if (finished) {
            return;
        }
        finished = true;
        tabEl.classList.remove('editing');
        if (input.parentNode) {
            input.parentNode.replaceChild(titleNode, input);
        }
        const value = input.value.replace(/\s+/g, ' ').trim();
        if (commit && value && value !== current) {
            post({ type: 'renameSession', sessionId: sessionId, title: value });
        }
        if (state.pendingTabsRender) {
            const next = state.pendingTabsRender;
            state.pendingTabsRender = null;
            renderSessionTabs(next.sessions, next.activeId);
        }
    }
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('blur', function() { finish(true); });
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function(e) { e.stopPropagation(); });
    tab.classList.add('editing');
    titleNode.parentNode?.replaceChild(input, titleNode);
    input.focus();
    input.select();
}
