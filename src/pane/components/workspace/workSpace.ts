import { byId, tabBar, tabContextMenu } from '../../dom';
import { post } from '../../post';
import { state } from '../../state';
import { escapeHtml } from '../../util/html';
import { clearPopup, placePopup } from '../../util/popup';
import { applyProjectFocus, showProjectNotice, showProjectPicker, wireProjectGroups } from './projectGrouped';
import { chatProjectOf, isRootSpaceTarget, projectTreeHtml, workspacePathOf } from './projectTree';
import type { FoldOverrides } from './projectTree';
import { tabEntriesHtml, wireTabs, withBlankChat } from './sessionTab';
import type { Project, SessionInfo, Workspace } from '../../../shared/chat';
import type { HostToPane } from '../../../shared/webview';

/**
 * The workspace in the pane, as the parent of the feature (F7): the lists the host last reported,
 * the three messages that replace them, and the one render that draws the whole tree.
 *
 * A child draws tabs or a project group and wires what it drew. The redraw, the two pickers and
 * the lists reach the children as arguments, so this is the only file in the folder that imports
 * another one.
 */

/** The workspaces and the projects the host last reported: this feature's own state (S1). */
let workspaces: Workspace[] = [];
let projects: Project[] = [];
/**
 * The folder the pane is working in, or '' for the plane.
 *
 * The host owns it (the workspace feature, `host/workspace/projectGrouped.ts`) and sends it with
 * the project list; this file holds the copy the tree is drawn from and sends a click back.
 */
let activeProjectId = '';
/** The second folder the tree keeps open: the one that was active before this one. */
let otherOpenProjectId = '';
/**
 * Folds the user made by hand — ctrl-clicks, and a click on the working folder.
 *
 * The pair says what the host keeps open; this says what the user added to it: open a few folders'
 * tabs at once to find a chat, and they all close again at the next normal click. Cleared as a
 * whole by that click, by a click on the root space, and by any change of the active project, so
 * it cannot outlive the tree it was made in.
 */
let foldOverrides: FoldOverrides | null = null;

/** The last path segment without the workspace extension: what a picker row can show. */
export function workspaceLabel(workspacePath: string): string {
    const base = workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath;
    return base.replace(/\.code-workspace$/i, '');
}

/** The workspace path under a picker row: the list the host sent is the whole truth. */
function pathOf(workspaceId: string): string {
    return workspacePathOf(workspaces, workspaceId);
}

/**
 * The root space, once: a click on the background of the rail — the tree's own empty space and
 * the area below the projects — means "the pane works in no folder".
 *
 * One handler on the wrapper in `chat.html`, because the background is a layout fact and not a
 * tab: every element drawn on it (a tab, a header, the folder button, its input) handles its own
 * click first, and the filter keeps their clicks out of ours.
 */
export function initRootSpace(): void {
    const root = byId<HTMLElement>('railTree');
    if (!root) {
        return;
    }
    root.addEventListener('click', function(e) {
        if (!isRootSpaceTarget(e.target as HTMLElement | null)) {
            return;
        }
        foldOverrides = null;
        if (activeProjectId === '') {
            // The root already is the working folder: nothing to post, but a manual fold has to go.
            applyProjectFocus(projects, activeProjectId, otherOpenProjectId, foldOverrides);
            renderTree(state.lastSessions, state.lastActiveSessionId);
            return;
        }
        setActiveProject('');
    });
}

/**
 * The workspaces this editor has opened, as the tab menu's second level.
 *
 * A workspace has no name of ours — it is a file or a folder — so a row shows the path's own name
 * and keeps the full path in its tooltip.
 */
export function showWorkspacePicker(sessionId: string): void {
    if (!tabContextMenu) {
        return;
    }
    let html = '<div class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextMoveWorkspace) + '</div>';
    workspaces.forEach(function(entry) {
        html += '<button type="button" class="tab-ctx-item" data-workspace="' + escapeHtml(entry.id) + '" title="' + escapeHtml(entry.path) + '">' + escapeHtml(workspaceLabel(entry.path)) + '</button>';
    });
    tabContextMenu.innerHTML = html;
    tabContextMenu.querySelectorAll<HTMLElement>('.tab-ctx-item[data-workspace]').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const workspaceId = item.dataset.workspace || '';
            clearPopup();
            post({ type: 'moveToWorkspace', sessionId: sessionId, workspace: workspaceId });
        });
    });
    placePopup(0, 0);
}

/**
 * Draw the tree: the strip the tabs and the project groups are assembled into.
 *
 * An empty list empties the strip. A tab being renamed holds the drawing back — a caller that
 * changes the list meanwhile leaves its arguments here, and the rename's own finish redraws with
 * them. Otherwise the tree is the projects' shape around the tabs' markup, and each child is then
 * asked to wire what it drew.
 */
export function renderTree(sessions: SessionInfo[], activeId: string): void {
    state.activeSessionId = activeId || state.activeSessionId;
    const list = withBlankChat(sessions || []);
    state.lastSessions = list;
    state.lastActiveSessionId = state.activeSessionId;
    // The root space is the background around the tree, and it says "no project" — marked even
    // when there is no tree to draw, because the pane can be working in it either way.
    const root = byId<HTMLElement>('railTree');
    if (root) {
        root.classList.toggle('is-active', activeProjectId === '');
    }
    if (list.length === 0) {
        tabBar.innerHTML = '';
        return;
    }
    if (tabBar.querySelector('.session-tab.editing')) {
        state.pendingTabsRender = { sessions: sessions, activeId: activeId };
        return;
    }
    const chatProjectId = chatProjectOf(list, state.activeSessionId);
    tabBar.innerHTML = projectTreeHtml(list, tabEntriesHtml, projects, workspaces, activeProjectId, chatProjectId);

    wireTabs(tabBar, {
        rerender: renderTree,
        showWorkspacePicker: showWorkspacePicker,
        // The project picker is the other child's: this is where the two are joined, so the tab
        // menu can open it without either child knowing the other.
        showProjectPicker: (sessionId: string) => showProjectPicker(sessionId, projects, pathOf),
        hasWorkspaces: workspaces.length > 0,
        hasProjects: projects.length > 0,
    });
    wireProjectGroups(tabBar, projects, workspaces, activeProjectId, setActiveProject, setFoldOverride);

    const activeTab = tabBar.querySelector('.session-tab.active');
    if (activeTab) {
        activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

/**
 * The folder the pane is working in, as a click: a project header, or '' for the plane.
 *
 * The host is the owner, so this only says what was picked; the marker and the fold come back in
 * the project list the host answers with.
 */
function setActiveProject(projectId: string): void {
    post({ type: 'setActiveProject', projectId: projectId });
}

/**
 * One project's fold in the set the pane keeps — or the whole set, when `collapsed` is null.
 *
 * A ctrl-click adds one; a plain click on the working folder says "forget the set, and fold this".
 */
function setFoldOverride(projectId: string, collapsed: boolean | null): void {
    if (collapsed === null) {
        foldOverrides = null;
        return;
    }
    if (!foldOverrides) {
        foldOverrides = new Map<string, boolean>();
    }
    foldOverrides.set(projectId, collapsed);
}

/**
 * The host's session list: which tab is on screen, the list the tree draws from, and the redraw.
 * The rest of that message belongs to other features — the hint in the status bar, the history
 * list, the switch modal — and the router hands it to each of them in turn (R1a).
 *
 * The fold is not applied here any more: it follows the active *project*, which arrives with the
 * project list, and a tab that lands in the folder already open changes nothing.
 */
export function onSessionList(msg: Extract<HostToPane, { type: 'sessionList' }>): void {
    state.activeSessionId = msg.activeSessionId || state.activeSessionId;
    state.lastSessions = msg.sessions || [];
    state.lastActiveSessionId = state.activeSessionId;
    renderTree(msg.sessions, msg.activeSessionId);
}

/**
 * The host's project list: both lists replace, the pair comes with them, the fold follows it, and
 * the tree redraws from what it now holds. The notice clears — a list that arrived is itself the
 * answer to whatever was refused.
 *
 * A change of the active project ends any manual fold: the pair is the new truth, and a fold made
 * against the old one would fight it.
 */
export function onProjectList(msg: Extract<HostToPane, { type: 'projectList' }>): void {
    workspaces = msg.workspaces || [];
    projects = msg.projects || [];
    const nextActive = msg.activeProjectId || '';
    if (nextActive !== activeProjectId) {
        foldOverrides = null;
    }
    activeProjectId = nextActive;
    otherOpenProjectId = msg.otherOpenProjectId || '';
    applyProjectFocus(projects, activeProjectId, otherOpenProjectId, foldOverrides);
    renderTree(state.lastSessions, state.lastActiveSessionId);
    showProjectNotice('');
}

/** Something the host wants the user to read: a refused create, and nothing else today. */
export function onProjectNotice(msg: Extract<HostToPane, { type: 'projectNotice' }>): void {
    showProjectNotice(msg.message);
}
