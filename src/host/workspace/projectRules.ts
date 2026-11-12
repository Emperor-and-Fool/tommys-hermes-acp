import type { Project, SessionInfo } from '../../shared/chat';

/**
 * The project rules: what a move rewrites, and which tabs and projects belong to a workspace.
 *
 * Array in, array out — no file, no editor, no message. That is what lets the pane's filters, the
 * component's commands and the tests share one definition of a move instead of three.
 */

/**
 * Move a tab to another workspace.
 *
 * `workspace` is where the tab was opened; ours to rewrite, where `cwd` is Hermes' to report and is
 * overwritten on every catalog read.
 */
export function moveTabToWorkspace(tabs: SessionInfo[], tabId: string, workspaceId: string): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0 || !workspaceId || tabs[index].workspaceId === workspaceId) {
        return tabs;
    }
    const next = tabs.slice();
    next[index] = { ...tabs[index], workspaceId };
    return next;
}

/**
 * Put a tab in a project, or back on the plane when `projectId` is empty.
 *
 * The value is a project id, not a name: a rename must not move the tabs that belong to it.
 */
export function moveTabToProject(tabs: SessionInfo[], tabId: string, projectId: string): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0 || (tabs[index].project || '') === projectId) {
        return tabs;
    }
    const next = tabs.slice();
    const record: SessionInfo = { ...tabs[index] };
    if (projectId) {
        record.project = projectId;
    } else {
        delete record.project;
    }
    next[index] = record;
    return next;
}

/**
 * A tab in a project belongs to that project's workspace: the project wins in every evaluation but
 * the explicit "move this tab to a workspace", so the two cannot disagree.
 */
export function moveTabIntoProject(tabs: SessionInfo[], tabId: string, project: Project): SessionInfo[] {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0) {
        return tabs;
    }
    const moved = moveTabToProject(tabs, tabId, project.id);
    const next = moved === tabs ? tabs.slice() : moved;
    const record: SessionInfo = { ...next[index] };
    if (project.workspaceId) {
        record.workspaceId = project.workspaceId;
    }
    if (!project.id) {
        delete record.project;
    }
    next[index] = record;
    return next;
}

/**
 * This window's slice of the tab index.
 *
 * Ownership is a filter, not a second store: one record set, and a window draws the records whose
 * workspace is its own. A tab with no workspace belongs to a window that has none — a window with
 * no folder and no workspace file — so an empty string matches an untagged tab and nothing else.
 */
export function tabsInWorkspace(tabs: SessionInfo[], workspaceId: string): SessionInfo[] {
    return tabs.filter(tab => (tab.workspaceId || '') === (workspaceId || ''));
}

/**
 * The projects of one window: a project belongs to a workspace *and* an agent, so this window is
 * handed only the projects named against its own workspace.
 *
 * A project made in a window with no folder or workspace file has no workspace either, and belongs
 * to that window — the empty string matches the empty string, exactly as `tabsInWorkspace` does.
 */
export function projectsInWorkspace(projects: Project[], workspaceId: string): Project[] {
    return projects.filter(project => (project.workspaceId || '') === (workspaceId || ''));
}

/**
 * Whether a window may claim a tab written before the tag existed.
 *
 * The tab's `cwd` is where Hermes ran the session, and a workspace is either that folder or the
 * directory holding its `.code-workspace`. Without this check the first window to reload would
 * adopt every untagged tab in the index, including the other window's.
 */
export function workspaceOwnsCwd(workspace: string, cwd: string | undefined): boolean {
    if (!workspace || !cwd) {
        return false;
    }
    const root = workspace.toLowerCase().endsWith('.code-workspace')
        ? workspace.slice(0, workspace.lastIndexOf(workspace.includes('\\') ? '\\' : '/'))
        : workspace;
    const trimmed = cwd.replace(/[\\/]+$/, '');
    return trimmed === root || trimmed.startsWith(root + '/') || trimmed.startsWith(root + '\\');
}

/** Every tab a project holds, back on the plane: a group is a view, not an owner. */
export function dropProjectFromTabs(tabs: SessionInfo[], projectId: string): SessionInfo[] {
    return tabs.map(tab => {
        if (tab.project !== projectId) {
            return tab;
        }
        const record: SessionInfo = { ...tab };
        delete record.project;
        return record;
    });
}
