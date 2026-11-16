import { tabBar, tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { copyToClipboard } from '../../util/clipboard';
import { escapeHtml } from '../../util/html';
import { clearPopup, placePopup } from '../../util/popup';
import { COPY_ICON_SVG } from '../messages/markdown';
import { requestSessionExport } from '../multiSelect';
import { requestSwitchSession } from '../modals/switchSession';
import type { SessionInfo } from '../../../shared/chat';

/**
 * A tab in the pane: its markup, its drag, and its own menu.
 *
 * This file is a child of the workspace file (F7). It draws tabs and wires what a tab does; the
 * whole tree, the redraw after a change, and the two pickers a tab's menu opens come from the
 * parent as arguments. It imports neither the parent nor its sibling.
 */

/**
 * What the parent hands this file: a way to redraw the tree, and the two pickers the tab menu opens.
 *
 * The two flags travel with them because the menu is built when the user asks for it, not when the
 * tree was drawn — and every change to either list redraws, so what is captured here stays true.
 */
export interface TabWiring {
    /** Redraw the whole tree: the parent's job, and the only redraw there is. */
    rerender(sessions: SessionInfo[], activeId: string): void;
    /** Open the workspace level of the tab menu for this tab. */
    showWorkspacePicker(sessionId: string): void;
    /** Open the project level of the tab menu for this tab. */
    showProjectPicker(sessionId: string): void;
    /** There is a workspace to move to. */
    hasWorkspaces: boolean;
    /** There is a project to move to. */
    hasProjects: boolean;
}

const TAB_STICKY_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 1.3 11.5 3.6V6l2.2 2.1v1.2H10v4.2L9 14H7L6 13.5V9.3H2.3V8.1L4.5 6V3.6L6.8 1.3h2.4zm-.9 1.4H7.7L5.9 4.5V6.4L4.3 8h7.4L10.1 6.4V4.5L8.3 2.7z"/></svg>';

function reorderSessionTabs(fromId: string, toId: string, wiring: TabWiring) {
    if (!fromId || !toId || fromId === toId || !state.lastSessions.length) {
        return;
    }
    const fromSession = state.lastSessions.find(function(s) { return s.id === fromId; });
    const toSession = state.lastSessions.find(function(s) { return s.id === toId; });
    if (!fromSession || !toSession) {
        return;
    }
    if (!!fromSession.sticky !== !!toSession.sticky) {
        return;
    }
    // A drag may reorder inside a group; it cannot move a tab between projects, which is the menu's job.
    if ((fromSession.project || '') !== (toSession.project || '')) {
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
    wiring.rerender(state.lastSessions, state.lastActiveSessionId);
    post({ type: 'reorderSessions', sessionIds: ids });
}

/** One tab's markup, and the separator that ends the sticky run inside its own list. */
export function tabEntriesHtml(list: SessionInfo[]): string {
    const parts: string[] = [];
    list.forEach(function(s, index) {
        const active = s.id === state.activeSessionId ? ' active' : '';
        const stickyClass = s.sticky ? ' sticky' : '';
        const title = escapeHtml(s.title || locale.newChat);
        const stickyIcon = s.sticky
            ? '<span class="tab-sticky-icon" title="' + escapeHtml(locale.tabContextSticky) + '">' + TAB_STICKY_SVG + '</span>'
            : '';
        parts.push('<div class="session-tab' + active + stickyClass + '" data-id="' + escapeHtml(s.id) + '" title="' + title + '">' +
            stickyIcon +
            '<span class="tab-title">' + title + '</span>' +
            '<span class="tab-close" data-id="' + escapeHtml(s.id) + '" title="' + escapeHtml(locale.tabClose) + '">×</span>' +
            '</div>');
        if (s.sticky && index < list.length - 1 && !list[index + 1].sticky) {
            parts.push('<span class="tab-sticky-separator" aria-hidden="true"></span>');
        }
    });
    return parts.join('');
}

function wireTabDragDrop(tab: HTMLElement, container: HTMLElement, wiring: TabWiring) {
    tab.draggable = true;
    tab.addEventListener('dragstart', function(e) {
        if (tab.classList.contains('editing')) {
            e.preventDefault();
            return;
        }
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.dataset.id || '');
        tab.classList.add('dragging');
    });
    tab.addEventListener('dragend', function() {
        tab.classList.remove('dragging');
        container.querySelectorAll('.session-tab').forEach(function(t) {
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
        if (fromId && toId) reorderSessionTabs(fromId, toId, wiring);
    });
    tab.addEventListener('mousedown', function(e) {
        tab.draggable = !(e.target && e.target.closest && e.target.closest('.tab-close'));
    });
}

/**
 * A blank chat has no record, so no list from the host can contain it: it is drawn from the
 * `newChat` message while it is the active one, in the project it was opened in, and it stops
 * being drawn the moment it is left or its own first turn gives it a record.
 */
export function withBlankChat(sessions: SessionInfo[]): SessionInfo[] {
    const blank = state.blankChat;
    if (!blank) {
        return sessions;
    }
    if (sessions.some(tab => tab.id === blank.id)) {
        state.blankChat = null;
        return sessions;
    }
    if (blank.id !== state.activeSessionId) {
        state.blankChat = null;
        return sessions;
    }
    return [
        {
            id: blank.id,
            title: locale.newChat,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...(blank.project ? { project: blank.project } : {}),
        },
        ...sessions,
    ];
}

/**
 * Wire every tab the parent just drew: the click that switches, the menu, the drag, the close.
 *
 * The container is the parent's: this file knows what a tab is, not where the tree put it.
 */
export function wireTabs(container: HTMLElement, wiring: TabWiring): void {
    container.querySelectorAll<HTMLElement>('.session-tab').forEach(function(tab) {
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
            if (id) showTabContextMenu(id, e.clientX, e.clientY, wiring);
        });
        wireTabDragDrop(tab, container, wiring);
    });
    container.querySelectorAll('.tab-close').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Closing a tab hides its session; the transcript stays in Hermes and
            // comes back from the closed-session picker. 'deleteSession' is a real
            // delete and must not be reachable from the X.
            post({ type: 'closeSessions', sessionId: btn.dataset.id, mode: 'self' });
        });
    });
}

export function hideTabContextMenu() {
    state.tabContextSessionId = null;
    clearPopup();
}

/** A tab's own menu. Which pickers it may open is the parent's answer, not this file's. */
function showTabContextMenu(sessionId: string, clientX: number, clientY: number, wiring: TabWiring) {
    const session = state.lastSessions.find(function(s) { return s.id === sessionId; });
    if (!session || !tabContextMenu) {
        return;
    }
    state.tabContextSessionId = sessionId;
    const idx = state.lastSessions.findIndex(function(s) { return s.id === sessionId; });
    const canCloseLeft = idx > 0;
    const canCloseRight = idx >= 0 && idx < state.lastSessions.length - 1;
    const canCloseOthers = state.lastSessions.length > 1;
    const stickyLabel = session.sticky ? locale.tabContextUnstick : locale.tabContextSticky;

    tabContextMenu.innerHTML =
        '<div class="tab-ctx-sid">' +
            '<span class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextSid) + ':</span>' +
            '<span class="tab-ctx-sid-value" title="' + escapeHtml(sessionId) + '">' + escapeHtml(sessionId) + '</span>' +
            '<button type="button" class="tab-ctx-sid-copy" data-action="copySid" title="' + escapeHtml(locale.copySid) + '">' + COPY_ICON_SVG + '</button>' +
        '</div>' +
        '<button type="button" class="tab-ctx-item" data-action="export">' + escapeHtml(locale.tabContextExport) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="copy">' + escapeHtml(locale.tabContextCopy) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="rename">' + escapeHtml(locale.tabContextRename) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="moveTo"' + (wiring.hasWorkspaces ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextMoveWorkspace) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="moveProject"' + (wiring.hasProjects ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextMoveProject) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="close">' + escapeHtml(locale.tabContextClose) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeOthers"' + (canCloseOthers ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseOthers) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeLeft"' + (canCloseLeft ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseLeft) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeRight"' + (canCloseRight ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseRight) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeAll">' + escapeHtml(locale.tabContextCloseAll) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="toggleSticky">' + escapeHtml(stickyLabel) + '</button>';

    tabContextMenu.querySelector('[data-action="copySid"]')?.addEventListener('click', function(e) {
        e.stopPropagation();
        copyToClipboard(sessionId);
    });
    tabContextMenu.querySelectorAll('.tab-ctx-item[data-action]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            if (item.disabled || !state.tabContextSessionId) return;
            const action = item.dataset.action;
            const targetId = state.tabContextSessionId;
            // The pickers replace this menu in place, so it stays where it opened.
            if (action === 'moveTo') {
                wiring.showWorkspacePicker(targetId);
                return;
            }
            if (action === 'moveProject') {
                wiring.showProjectPicker(targetId);
                return;
            }
            hideTabContextMenu();
            if (action === 'export') {
                requestSessionExport('export', undefined, targetId);
            } else if (action === 'copy') {
                requestSessionExport('copy', undefined, targetId);
            } else if (action === 'rename') {
                startTabRename(targetId, wiring);
            } else if (action === 'toggleSticky') {
                post({ type: 'toggleStickySession', sessionId: targetId });
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

    placePopup(clientX, clientY);
}

function startTabRename(sessionId: string, wiring: TabWiring) {
    if (!sessionId) {
        return;
    }
    const tabs = tabBar.querySelectorAll('.session-tab');
    let tab: Element | null = null;
    for (let i = 0; i < tabs.length; i++) {
        if ((tabs[i] as HTMLElement).dataset.id === sessionId) {
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
    function finish(commit: boolean) {
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
            wiring.rerender(next.sessions, next.activeId);
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
