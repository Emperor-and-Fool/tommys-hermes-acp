import { tabBar, tabContextMenu } from '../../dom';
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

function positionTabContextMenu(x: number, y: number) {
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

export function showTabContextMenu(sessionId: string, clientX: number, clientY: number) {
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
        '<button type="button" class="tab-ctx-item" data-action="moveTo"' + (state.lastWorkspaces.length ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextMoveWorkspace) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="moveFolder"' + (state.lastFolders.length ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextMoveFolder) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="close">' + escapeHtml(locale.tabContextClose) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeOthers"' + (canCloseOthers ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseOthers) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeLeft"' + (canCloseLeft ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseLeft) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeRight"' + (canCloseRight ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseRight) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-action="closeAll">' + escapeHtml(locale.tabContextCloseAll) + '</button>' +
        '<div class="tab-ctx-divider"></div>' +
        '<button type="button" class="tab-ctx-item" data-action="togglePin">' + escapeHtml(stickyLabel) + '</button>';

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
            if (action === 'moveTo') {
                // The picker replaces this menu in place, so it stays where it opened.
                showWorkspacePicker(targetId);
                return;
            }
            if (action === 'moveFolder') {
                showFolderPicker(targetId);
                return;
            }
            hideTabContextMenu();
            if (action === 'export') {
                requestSessionExport('export', undefined, targetId);
            } else if (action === 'copy') {
                requestSessionExport('copy', undefined, targetId);
            } else if (action === 'rename') {
                startTabRename(targetId);
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

    positionTabContextMenu(clientX, clientY);
}

/** The last path segment without the workspace extension: what a picker row can show. */
function workspaceLabel(path: string): string {
    const base = path.split(/[\\/]/).filter(Boolean).pop() || path;
    return base.replace(/\.code-workspace$/i, '');
}

/**
 * The workspaces this editor has opened, as the menu's second level.
 *
 * The row is the path's own name until names exist: a project name is a later step, and a label
 * guessed from a folder here would be a second naming rule to undo.
 */
function showWorkspacePicker(sessionId: string): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveWorkspace) + '</div>';
    state.lastWorkspaces.forEach(function(entry) {
        html += '<button type="button" class="tab-ctx-item" data-workspace="' + escapeHtml(entry.path) + '" title="' + escapeHtml(entry.path) + '">' + escapeHtml(workspaceLabel(entry.path)) + '</button>';
    });
    tabContextMenu.innerHTML = html;
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-workspace]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            hideTabContextMenu();
            post({ type: 'moveToWorkspace', sessionId: sessionId, workspace: item.dataset.workspace || '' });
        });
    });
}

/**
 * The project folders, as the menu's second level, with the plane as a row of its own: a tab that
 * was moved in has to have a way back out.
 */
/** The header element of one folder, as the strip drew it. */
function folderHeader(folderId: string): HTMLElement | null {
    const groups = tabBar.querySelectorAll<HTMLElement>('.tab-group[data-folder]');
    for (let i = 0; i < groups.length; i++) {
        if (groups[i].dataset.folder === folderId) {
            return groups[i].querySelector<HTMLElement>('.tab-group-header');
        }
    }
    return null;
}

/** Rename a folder where its name is: the same inline input a tab rename uses. */
function startFolderRename(folderId: string): void {
    const folder = state.lastFolders.find(function(f) { return f.id === folderId; });
    const header = folderHeader(folderId);
    const nameEl = header ? header.querySelector('.tab-group-name') : null;
    if (!folder || !header || !nameEl) {
        return;
    }
    // Bound for the nested finish(): narrowing does not survive into a closure.
    const nameNode = nameEl;
    const currentName = folder.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = folder.name;
    input.maxLength = 100;
    input.spellcheck = false;
    input.setAttribute('aria-label', locale.tabContextRenameFolder);
    let finished = false;
    function finish(commit: boolean): void {
        if (finished) {
            return;
        }
        finished = true;
        const value = input.value.replace(/\s+/g, ' ').trim();
        if (input.parentNode) {
            input.parentNode.replaceChild(nameNode, input);
        }
        nameNode.textContent = currentName;
        if (commit && value && value !== currentName) {
            post({ type: 'renameProjectFolder', folderId: folderId, name: value });
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
    // A click outside is not a decision: the same rule the create field follows.
    input.addEventListener('blur', function() { finish(false); });
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    nameNode.parentNode?.replaceChild(input, nameNode);
    input.focus();
    input.select();
}

/**
 * The folder's own menu: rename it, or delete it and let its tabs fall back to the plane.
 *
 * It reuses the tab context menu's element and styling: a second popup would be a second place for
 * outside-click and Escape to be handled differently.
 */
export function showFolderContextMenu(folderId: string, clientX: number, clientY: number): void {
    if (!tabContextMenu) {
        return;
    }
    state.tabContextSessionId = null;
    tabContextMenu.innerHTML =
        '<button type="button" class="tab-ctx-item" data-folder-action="rename">' + escapeHtml(locale.tabContextRenameFolder) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-folder-action="delete">' + escapeHtml(locale.tabContextDeleteFolder) + '</button>';
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-folder-action]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = item.dataset.folderAction;
            hideTabContextMenu();
            if (action === 'rename') {
                startFolderRename(folderId);
            } else if (action === 'delete') {
                post({ type: 'deleteProjectFolder', folderId: folderId });
            }
        });
    });
    positionTabContextMenu(clientX, clientY);
}

function showFolderPicker(sessionId: string): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveFolder) + '</div>';
    html += '<button type="button" class="tab-ctx-item" data-folder="">' + escapeHtml(locale.tabContextNoFolder) + '</button>';
    state.lastFolders.forEach(function(folder) {
        html += '<button type="button" class="tab-ctx-item" data-folder="' + escapeHtml(folder.id) + '" title="' + escapeHtml(folder.workspace || '') + '">' + escapeHtml(folder.name) + '</button>';
    });
    tabContextMenu.innerHTML = html;
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-folder]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const folderId = item.dataset.folder || '';
            hideTabContextMenu();
            post({ type: 'setSessionFolder', sessionId: sessionId, folderId: folderId });
        });
    });
}

function startTabRename(sessionId: string) {
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
