import { tabBar } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import type { ProjectFolder, SessionInfo } from '../../../shared/chat';
import { requestSwitchSession } from '../modals/switchSession';
import { showFolderContextMenu, showTabContextMenu } from './tabMenu';


const TAB_STICKY_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 1.3 11.5 3.6V6l2.2 2.1v1.2H10v4.2L9 14H7L6 13.5V9.3H2.3V8.1L4.5 6V3.6L6.8 1.3h2.4zm-.9 1.4H7.7L5.9 4.5V6.4L4.3 8h7.4L10.1 6.4V4.5L8.3 2.7z"/></svg>';

function reorderSessionTabs(fromId: string, toId: string) {
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
    // A drag may reorder inside a group; it cannot move a tab between folders, which is the menu's job.
    if ((fromSession.folder || '') !== (toSession.folder || '')) {
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

/** One tab's markup, and the separator that ends the sticky run inside its own list. */
function tabEntriesHtml(list: SessionInfo[]): string {
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

/**
 * Draw a folder the way the user left it: closed folders show only their header.
 *
 * The latch is in `state.collapsedFolders`, keyed by folder id, so a re-render — a new tab, a rename
 * — does not pop every folder open again.
 */
function applyFolderCollapsed(group: HTMLElement): void {
    const id = group.dataset.folder || '';
    const collapsed = !!id && state.collapsedFolders.has(id);
    group.classList.toggle('is-collapsed', collapsed);
    const caret = group.querySelector('.tab-group-caret');
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
}

/**
 * Folders are parents: their tabs are drawn inside them. A tab in no folder — or in one that no
 * longer exists — sorts below all of them, unindented, which is what tells the two apart.
 */
function groupsHtml(sessions: SessionInfo[]): string {
    const groups: Array<{ folder: ProjectFolder; sessions: SessionInfo[] }> = [];
    state.lastFolders.forEach(function(folder) {
        groups.push({ folder: folder, sessions: [] });
    });
    const plane: SessionInfo[] = [];
    sessions.forEach(function(s) {
        const group = s.folder ? groups.find(function(g) { return g.folder.id === s.folder; }) : undefined;
        (group ? group.sessions : plane).push(s);
    });

    const parts: string[] = [];
    groups.forEach(function(group) {
        parts.push('<div class="tab-group" data-folder="' + escapeHtml(group.folder.id) + '">' +
            '<div class="tab-group-header" title="' + escapeHtml(group.folder.workspace || '') + '">' +
                '<span class="tab-group-caret"></span>' +
                '<span class="tab-group-name">' + escapeHtml(group.folder.name) + '</span>' +
            '</div>' +
            '<div class="tab-group-tabs">' + tabEntriesHtml(group.sessions) + '</div>' +
            '</div>');
    });
    if (plane.length) {
        parts.push('<div class="tab-group tab-group--plane"><div class="tab-group-tabs">' + tabEntriesHtml(plane) + '</div></div>');
    }
    return parts.join('');
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
    tabBar.innerHTML = groupsHtml(sessions);

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
    tabBar.querySelectorAll<HTMLElement>('.tab-group[data-folder]').forEach(function(group) {
        const header = group.querySelector<HTMLElement>('.tab-group-header');
        if (!header) return;
        applyFolderCollapsed(group);
        header.addEventListener('click', function(e) {
            // A rename input lives in the header; a click in it is not a fold.
            if (e.target && (e.target as HTMLElement).classList.contains('tab-rename-input')) return;
            const id = group.dataset.folder || '';
            if (!id) return;
            if (state.collapsedFolders.has(id)) {
                state.collapsedFolders.delete(id);
            } else {
                state.collapsedFolders.add(id);
            }
            applyFolderCollapsed(group);
        });
        header.addEventListener('contextmenu', function(e: MouseEvent) {
            e.preventDefault();
            e.stopPropagation();
            const id = group.dataset.folder;
            if (id) showFolderContextMenu(id, e.clientX, e.clientY);
        });
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

/**
 * The rail's own action: name a project folder and connect it to this window's workspace.
 *
 * The rail's empty space below the tabs is where a folder can be made before any tab belongs to
 * it. The label doubles as the placeholder; Enter commits, Escape or a blur puts the button back.
 */
export function initCreateFolderButton(): void {
    const found = document.getElementById('createFolderBtn');
    if (!found) {
        return;
    }
    // Bound: narrowing does not survive into the closures below.
    const button: HTMLElement = found;
    button.addEventListener('click', function() {
        if (button.dataset.editing) {
            return;
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.placeholder = locale.createProjectFolder;
        input.spellcheck = false;
        input.setAttribute('aria-label', locale.createProjectFolder);
        const parent = button.parentNode;
        if (!parent) {
            return;
        }
        button.dataset.editing = '1';
        parent.replaceChild(input, button);
        let finished = false;
        function finish(commit: boolean): void {
            if (finished) {
                return;
            }
            finished = true;
            delete button.dataset.editing;
            if (input.parentNode) {
                input.parentNode.replaceChild(button, input);
            }
            const name = input.value.replace(/\s+/g, ' ').trim();
            if (commit && name) {
                post({ type: 'createProjectFolder', name: name });
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
        input.addEventListener('blur', function() { finish(false); });
        input.focus();
    });
}
