import { tabBar, tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { clearPopup, placePopup } from '../../util/popup';
import type { Project, Workspace } from '../../../shared/chat';

/**
 * A project group in the pane: its markup as a parent of tabs, the fold, the rename, its own menu,
 * the picker a tab is moved with, and the notice a refused create appears in.
 *
 * This file is a child of the workspace file (F7). It draws a group and wires what a group does;
 * the two lists it shows are handed to it on every call, so it holds no state of the feature and
 * imports neither the parent nor its sibling.
 */

/**
 * Draw the projects the way the user left them: a closed project shows only its header.
 *
 * The latch is in `state.collapsedProjects`, keyed by project id, so a re-render — a new tab, a
 * rename — does not pop every project open again.
 */
function applyProjectCollapsed(group: HTMLElement): void {
    const id = group.dataset.project || '';
    const collapsed = !!id && state.collapsedProjects.has(id);
    group.classList.toggle('is-collapsed', collapsed);
    const caret = group.querySelector('.tab-group-caret');
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
}

/**
 * A group, or the plane, as a drop target: dropping a tab here moves it.
 *
 * The tab's own drag carries its id, so the drop only has to name the project. An empty id is the
 * plane, which is how a tab gets back out of a project without the menu.
 */
function wireProjectDropTarget(group: HTMLElement, projectId: string): void {
    group.addEventListener('dragover', function(e) {
        e.preventDefault();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        group.classList.add('drag-over');
    });
    group.addEventListener('dragleave', function(e) {
        // Leaving for a child is not leaving the target: without this the highlight flickers.
        if (e.relatedTarget && group.contains(e.relatedTarget as Node)) return;
        group.classList.remove('drag-over');
    });
    group.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        group.classList.remove('drag-over');
        const tabId = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        if (tabId) {
            post({ type: 'setTabProject', sessionId: tabId, projectId: projectId });
        }
    });
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
function startProjectRename(projectId: string, projects: Project[]): void {
    const project = projects.find(function(p) { return p.id === projectId; });
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
function showProjectContextMenu(projectId: string, clientX: number, clientY: number, projects: Project[]): void {
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
                startProjectRename(projectId, projects);
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
 *
 * The workspace path under each row is handed in rather than looked up here: the parent owns the
 * workspace list, and this file only draws what it is given (F7).
 */
export function showProjectPicker(
    sessionId: string,
    projects: Project[],
    pathOf: (workspaceId: string) => string,
): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveProject) + '</div>';
    html += '<button type="button" class="tab-ctx-item" data-project="">' + escapeHtml(locale.tabContextNoProject) + '</button>';
    projects.forEach(function(project) {
        html += '<button type="button" class="tab-ctx-item" data-project="' + escapeHtml(project.id) + '" title="' + escapeHtml(pathOf(project.workspaceId)) + '">' + escapeHtml(project.name) + '</button>';
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
 * Leave the folder you are working in open, and one more to fetch context from.
 *
 * A start shows every folder, because that is how the workspace reads at a glance. From the first
 * switch onwards, the open set is the active *project* plus the most recently *opened* other one —
 * so a session can be opened just to read it, the working one returned to, and both still be
 * there. The rule is applied only when the active project changes, so dragging, renaming and
 * manual folding in between are left alone.
 */
export function applyProjectFocus(projects: Project[], activeProjectId: string): void {
    // The latch is keyed on the project, not the tab: a header click is a focus decision too, and
    // the prefix keeps "applied for the root" apart from "never applied".
    const key = 'p:' + activeProjectId;
    if (state.focusAppliedFor === key) {
        return;
    }
    const firstApplication = state.focusAppliedFor === '';
    state.focusAppliedFor = key;
    // Recency is the pane's own: a project that was working is the evidence, and no round trip
    // is needed to know it.
    if (activeProjectId) {
        state.recentProjects = [activeProjectId, ...state.recentProjects.filter(id => id !== activeProjectId)].slice(0, 8);
    }
    if (firstApplication) {
        // A fresh window: every folder open.
        state.collapsedProjects = new Set<string>();
        return;
    }
    const open: string[] = [];
    if (activeProjectId) {
        open.push(activeProjectId);
    }
    for (const id of state.recentProjects) {
        if (id !== activeProjectId) {
            open.push(id);
            break;
        }
    }
    if (!activeProjectId) {
        for (const id of state.recentProjects.slice(0, 2)) {
            if (open.indexOf(id) < 0) open.push(id);
        }
    }
    state.collapsedProjects = new Set(
        projects.filter(project => open.indexOf(project.id) < 0).map(project => project.id)
    );
}

/**
 * Wire the groups the parent just drew: the fold, the header's menu and its pick, the root space,
 * and the drop target that moves a tab into this project — plus the plane, which is the way back
 * out.
 *
 * A click on a header does two things: it folds the group, as it always has, and it makes that
 * project the one the pane works in. The root space is the same click with no project.
 */
export function wireProjectGroups(
    container: HTMLElement,
    projects: Project[],
    workspaces: Workspace[],
    setActiveProject: (projectId: string) => void,
): void {
    container.querySelectorAll<HTMLElement>('.tab-group[data-project]').forEach(function(group) {
        const header = group.querySelector<HTMLElement>('.tab-group-header');
        if (!header) return;
        applyProjectCollapsed(group);
        header.addEventListener('click', function(e) {
            // A rename input lives in the header; a click in it is not a fold.
            if (e.target && (e.target as HTMLElement).classList.contains('tab-rename-input')) return;
            const id = group.dataset.project || '';
            if (!id) return;
            setActiveProject(id);
            if (state.collapsedProjects.has(id)) {
                state.collapsedProjects.delete(id);
            } else {
                state.collapsedProjects.add(id);
            }
            applyProjectCollapsed(group);
        });
        header.addEventListener('contextmenu', function(e: MouseEvent) {
            e.preventDefault();
            e.stopPropagation();
            const id = group.dataset.project;
            if (id) showProjectContextMenu(id, e.clientX, e.clientY, projects);
        });
        wireProjectDropTarget(group, group.dataset.project || '');
    });
    const planeGroup = container.querySelector<HTMLElement>('.tab-group--plane');
    if (planeGroup) {
        // A drop target only: the root space is the background of the rail (the wrapper in
        // chat.html), and the parent owns that click.
        wireProjectDropTarget(planeGroup, '');
    }
}

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

/**
 * The rail's own action: name a project in this window's workspace.
 *
 * The rail's empty space below the tabs is where a project can be made before any tab belongs to
 * it. The label doubles as the placeholder; Enter commits, Escape or a blur puts the button back.
 */
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
