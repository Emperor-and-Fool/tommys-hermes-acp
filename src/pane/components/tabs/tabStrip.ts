import { byId, tabBar } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import type { SessionInfo } from '../../../shared/chat';
import { newChat } from '../messages/messageList';
import { requestSwitchSession } from '../modals/switchSession';
import { showTabContextMenu } from './tabMenu';


const TAB_PIN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 1.3 11.5 3.6V6l2.2 2.1v1.2H10v4.2L9 14H7L6 13.5V9.3H2.3V8.1L4.5 6V3.6L6.8 1.3h2.4zm-.9 1.4H7.7L5.9 4.5V6.4L4.3 8h7.4L10.1 6.4V4.5L8.3 2.7z"/></svg>';

function reorderSessionTabs(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId || !state.lastSessions.length) {
        return;
    }
    const fromSession = state.lastSessions.find(function(s) { return s.id === fromId; });
    const toSession = state.lastSessions.find(function(s) { return s.id === toId; });
    if (!fromSession || !toSession) {
        return;
    }
    if (!!fromSession.pinned !== !!toSession.pinned) {
        return;
    }
    const ids = state.lastSessions.map(function(s) { return s.id; });
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) {
        return;
    }
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    const byId: Record<string, SessionInfo> = {};
    state.lastSessions.forEach(function(s) { byId[s.id] = s; });
    state.lastSessions = ids.map(function(id) { return byId[id]; }).filter(Boolean);
    renderSessionTabs(state.lastSessions, state.lastActiveSessionId);
    post({ type: 'reorderSessions', sessionIds: ids });
}

function wireTabDragDrop(tab: HTMLElement) {
    tab.draggable = true;
    tab.addEventListener('dragstart', function(e) {
        if (tab.classList.contains('editing')) {
            e.preventDefault();
            return;
        }
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'move';
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', tab.dataset.id || '');
        tab.classList.add('dragging');
    });
    tab.addEventListener('dragend', function() {
        tab.classList.remove('dragging');
        tabBar.querySelectorAll('.session-tab').forEach(function(t) {
            t.classList.remove('drag-over');
        });
    });
    tab.addEventListener('dragover', function(e) {
        e.preventDefault();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        tab.classList.add('drag-over');
    });
    tab.addEventListener('dragleave', function() {
        tab.classList.remove('drag-over');
    });
    tab.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        tab.classList.remove('drag-over');
        if (!e.dataTransfer) return;
        const fromId = e.dataTransfer.getData('text/plain');
        const toId = tab.dataset.id;
        if (fromId && toId) reorderSessionTabs(fromId, toId);
    });
    tab.addEventListener('mousedown', function(e) {
        tab.draggable = !(e.target && e.target.closest && e.target.closest('.tab-close'));
    });
}

export function renderSessionTabs(sessions: SessionInfo[], activeId: string) {
    state.activeSessionId = activeId || state.activeSessionId;
    state.lastSessions = sessions || [];
    state.lastActiveSessionId = state.activeSessionId;
    if (!sessions || sessions.length === 0) {
        tabBar.innerHTML = '';
        return;
    }
    if (tabBar.querySelector('.session-tab.editing')) {
        state.pendingTabsRender = { sessions: sessions, activeId: activeId };
        return;
    }
    const parts: string[] = [];
    sessions.forEach(function(s, index) {
        const active = s.id === state.activeSessionId ? ' active' : '';
        const pinnedClass = s.pinned ? ' pinned' : '';
        const title = escapeHtml(s.title || locale.newChat);
        const pinIcon = s.pinned
            ? '<span class="tab-pin-icon" title="' + escapeHtml(locale.tabContextPin) + '">' + TAB_PIN_SVG + '</span>'
            : '';
        parts.push('<div class="session-tab' + active + pinnedClass + '" data-id="' + escapeHtml(s.id) + '" title="' + title + '">' +
            pinIcon +
            '<span class="tab-title">' + title + '</span>' +
            '<span class="tab-close" data-id="' + escapeHtml(s.id) + '" title="' + escapeHtml(locale.tabClose) + '">×</span>' +
            '</div>');
        if (s.pinned && index < sessions.length - 1 && !sessions[index + 1].pinned) {
            parts.push('<span class="tab-pin-separator" aria-hidden="true"></span>');
        }
    });
    tabBar.innerHTML = parts.join('');

    tabBar.querySelectorAll<HTMLElement>('.session-tab').forEach(function(tab) {
        tab.addEventListener('click', function(e) {
            if (e.target && e.target.closest && e.target.closest('.tab-close')) {
                return;
            }
            if (tab.classList.contains('editing')) {
                return;
            }
            const id = tab.dataset.id;
            if (id && id !== state.activeSessionId) {
                requestSwitchSession(id);
            }
        });
        tab.addEventListener('contextmenu', function(e: MouseEvent) {
            e.preventDefault();
            e.stopPropagation();
            const id = tab.dataset.id;
            if (id) showTabContextMenu(id, e.clientX, e.clientY);
        });
        wireTabDragDrop(tab);
    });
    tabBar.querySelectorAll('.tab-close').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Closing a tab hides its session; the transcript stays in Hermes and
            // comes back from the closed-session picker. 'deleteSession' is a real
            // delete and must not be reachable from the X.
            post({ type: 'closeSessions', sessionId: btn.dataset.id, mode: 'self' });
        });
    });

    const activeTab = tabBar.querySelector('.session-tab.active');
    if (activeTab) {
        activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}
