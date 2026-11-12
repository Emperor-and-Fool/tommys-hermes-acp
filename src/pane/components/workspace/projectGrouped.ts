import { tabBar, tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import type { Project, SessionInfo } from '../../../shared/chat';

/**
 * The project group in the pane: the popup shell, the projects drawn as parents, and their own menu.
 *
 * The tree needs a tab's markup and does not own it: `projectTreeHtml` takes the renderer the tab
 * file supplies, so the two files depend in one direction only.
 */

/** Place the one popup where it was asked for, kept inside the pane. */
export function placePopup(x: number, y: number): void {
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

/** Empty the popup. Whoever owns the state behind it clears that itself. */
export function clearPopup(): void {
    if (!tabContextMenu) return;
    tabContextMenu.hidden = true;
    tabContextMenu.innerHTML = '';
}

/**
 * Draw the projects the way the user left them: a closed project shows only its header.
 *
 * The latch is in `state.collapsedProjects`, keyed by project id, so a re-render — a new tab, a
 * rename — does not pop every project open again.
 */
export function applyProjectCollapsed(group: HTMLElement): void {
    const id = group.dataset.project || '';
    const collapsed = !!id && state.collapsedProjects.has(id);
    group.classList.toggle('is-collapsed', collapsed);
    const caret = group.querySelector('.tab-group-caret');
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
}

/**
 * Projects are parents: their tabs are drawn inside them. A tab in no project — or in one that no
 * longer exists — sorts below all of them, unindented, which is what tells the two apart.
 */
export function projectTreeHtml(sessions: SessionInfo[], tabsHtml: (list: SessionInfo[]) => string): string {
    const groups: Array<{ project: Project; sessions: SessionInfo[] }> = [];
    state.lastProjects.forEach(function(project) {
        groups.push({ project: project, sessions: [] });
    });
    const plane: SessionInfo[] = [];
    sessions.forEach(function(s) {
        const group = s.project ? groups.find(function(g) { return g.project.id === s.project; }) : undefined;
        (group ? group.sessions : plane).push(s);
    });

    const parts: string[] = [];
    groups.forEach(function(group, index) {
        parts.push('<div class="tab-group" data-project="' + escapeHtml(group.project.id) + '"' +
            ' style="--project-accent:' + projectAccent(index, groups.length) + '">' +
            '<div class="tab-group-header" title="' + escapeHtml(workspacePathOf(group.project.workspaceId)) + '">' +
                '<span class="tab-group-caret"></span>' +
                '<span class="tab-group-name">' + escapeHtml(group.project.name) + '</span>' +
            '</div>' +
            '<div class="tab-group-tabs">' + tabsHtml(group.sessions) + '</div>' +
            '</div>');
    });
    if (plane.length) {
        parts.push('<div class="tab-group tab-group--plane"><div class="tab-group-tabs">' + tabsHtml(plane) + '</div></div>');
    }
    return parts.join('');
}

/**
 * The colour of the project at `index` of `total`: the rainbow from red at the top to deep purple
 * at the bottom, spread over the projects that are drawn.
 *
 * It spans the list rather than stepping by a fixed amount, so with two projects the second is
 * purple and not amber. The colour means *where* a project sits, so a new one re-spaces the ones
 * around it — which is the same statement, told again.
 */
function projectAccent(index: number, total: number): string {
    const RED = 5;
    const DEEP_PURPLE = 280;
    const hue = total > 1 ? Math.round(RED + (DEEP_PURPLE - RED) * (index / (total - 1))) : RED;
    return `hsl(${hue} 62% 42%)`;
}

/** The path behind a workspace id, for a tooltip. The list the host sent is the whole truth. */
function workspacePathOf(workspaceId: string): string {
    const entry = state.lastWorkspaces.find(function(workspace) { return workspace.id === workspaceId; });
    return entry ? entry.path : '';
}

/**
 * Leave the folder you are working in open, and one more to fetch context from.
 *
 * A start shows every folder, because that is how the workspace reads at a glance. From the first
 * switch onwards, the open set is the active session's project plus the most recently *opened*
 * other one — so a session can be opened just to read it, the working one returned to, and both
 * still be there. The rule is applied only when the active session changes, so dragging, renaming
 * and manual folding in between are left alone.
 */
export function applyProjectFocus(): void {
    const activeId = state.lastActiveSessionId;
    if (!activeId || state.focusAppliedFor === activeId) {
        return;
    }
    const firstApplication = state.focusAppliedFor === '';
    state.focusAppliedFor = activeId;
    const activeProject = state.lastSessions.find(tab => tab.id === activeId)?.project || '';
    // Recency is the pane's own: a session that was opened *is* the evidence, and the tab list it
    // came from is already here — no round trip, and no dependence on which list the host posts.
    if (activeProject) {
        state.recentProjects = [activeProject, ...state.recentProjects.filter(id => id !== activeProject)].slice(0, 8);
    }
    if (firstApplication) {
        // A fresh window: every folder open.
        state.collapsedProjects = new Set<string>();
        return;
    }
    const open: string[] = [];
    if (activeProject) {
        open.push(activeProject);
    }
    for (const id of state.recentProjects) {
        if (id !== activeProject) {
            open.push(id);
            break;
        }
    }
    if (!activeProject) {
        for (const id of state.recentProjects.slice(0, 2)) {
            if (open.indexOf(id) < 0) open.push(id);
        }
    }
    state.collapsedProjects = new Set(
        state.lastProjects.filter(project => open.indexOf(project.id) < 0).map(project => project.id)
    );
}

/** The header element of one project, as the strip drew it. */
function projectHeader(projectId: string): HTMLElement | null {
    const groups = tabBar.querySelectorAll<HTMLElement>('.tab-group[data-project]');
    for (let i = 0; i < groups.length; i++) {
        if (groups[i].dataset.project === projectId) {
            return groups[i].querySelector<HTMLElement>('.tab-group-header');
        }
    }
    return null;
}

/** Rename a project where its name is: the same inline input a tab rename uses. */
function startProjectRename(projectId: string): void {
    const project = state.lastProjects.find(function(p) { return p.id === projectId; });
    const header = projectHeader(projectId);
    const nameEl = header ? header.querySelector('.tab-group-name') : null;
    if (!project || !header || !nameEl) {
        return;
    }
    // Bound for the nested finish(): narrowing does not survive into a closure.
    const nameNode = nameEl;
    const currentName = project.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = project.name;
    input.maxLength = 100;
    input.spellcheck = false;
    input.setAttribute('aria-label', locale.tabContextRenameProject);
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
            post({ type: 'renameProject', projectId: projectId, name: value });
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
 * A project's own menu: rename it, or delete it and let its tabs fall back to the plane.
 *
 * It reuses the tab menu's element and styling: a second popup would be a second place for
 * outside-click and Escape to be handled differently.
 */
export function showProjectContextMenu(projectId: string, clientX: number, clientY: number): void {
    if (!tabContextMenu) {
        return;
    }
    tabContextMenu.innerHTML =
        '<button type="button" class="tab-ctx-item" data-project-action="rename">' + escapeHtml(locale.tabContextRenameProject) + '</button>' +
        '<button type="button" class="tab-ctx-item" data-project-action="delete">' + escapeHtml(locale.tabContextDeleteProject) + '</button>';
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-project-action]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = item.dataset.projectAction;
            clearPopup();
            if (action === 'rename') {
                startProjectRename(projectId);
            } else if (action === 'delete') {
                post({ type: 'deleteProject', projectId: projectId });
            }
        });
    });
    placePopup(clientX, clientY);
}

/**
 * The projects, as the tab menu's second level, with the plane as a row of its own: a tab that was
 * moved in has to have a way back out.
 */
export function showProjectPicker(sessionId: string): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveProject) + '</div>';
    html += '<button type="button" class="tab-ctx-item" data-project="">' + escapeHtml(locale.tabContextNoProject) + '</button>';
    state.lastProjects.forEach(function(project) {
        html += '<button type="button" class="tab-ctx-item" data-project="' + escapeHtml(project.id) + '" title="' + escapeHtml(workspacePathOf(project.workspaceId)) + '">' + escapeHtml(project.name) + '</button>';
    });
    tabContextMenu.innerHTML = html;
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-project]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const projectId = item.dataset.project || '';
            clearPopup();
            post({ type: 'setTabProject', sessionId: sessionId, projectId: projectId });
        });
    });
}

/**
 * The rail's own action: name a project in this window's workspace.
 *
 * The rail's empty space below the tabs is where a project can be made before any tab belongs to
 * it. The label doubles as the placeholder; Enter commits, Escape or a blur puts the button back.
 */
/**
 * Put the host's answer about a project create under the button that asked for it.
 *
 * An empty message clears it. This is the only place a refused create is visible: the pane
 * cannot tell a written record from one that was never made, so the host says which.
 */
export function showProjectNotice(message: string): void {
    const notice = document.getElementById('projectNotice');
    if (!notice) {
        return;
    }
    notice.textContent = message || '';
    notice.hidden = !message;
}

export function initCreateProjectButton(): void {
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
        input.placeholder = locale.createProject;
        input.spellcheck = false;
        input.setAttribute('aria-label', locale.createProject);
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
                post({ type: 'createProject', name: name });
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
