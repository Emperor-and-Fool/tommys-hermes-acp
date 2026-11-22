import { escapeHtml } from '../../util/html';
import type { Project, SessionInfo, Workspace } from '../../../shared/chat';

/**
 * The project tree as markup, and the two rules a click on it follows.
 *
 * Markup and rules only: this file imports no DOM, so the marking and the click filter can be
 * tested without a page. `projectGrouped.ts` draws what is here and wires what it drew; the
 * parent (`workSpace.ts`) hands both of them the state they need (F7).
 */

/**
 * Draw the projects the way the user left them: a closed project shows only its header.
 *
 * A project carries one of two marks. `is-active` is the folder the pane works in — the one a
 * new chat opens in. `holds-chat` is the folder the chat on screen lives in, so a session stays
 * findable after another folder was clicked, folded or open. When both are the same project it
 * carries `is-active` alone: one mark, one outline.
 */
export function projectTreeHtml(
    sessions: SessionInfo[],
    tabsHtml: (list: SessionInfo[]) => string,
    projects: Project[],
    workspaces: Workspace[],
    activeProjectId: string,
    chatProjectId: string,
): string {
    const groups: Array<{ project: Project; sessions: SessionInfo[] }> = [];
    projects.forEach(function(project) {
        groups.push({ project: project, sessions: [] });
    });
    const plane: SessionInfo[] = [];
    sessions.forEach(function(s) {
        const group = s.project ? groups.find(function(g) { return g.project.id === s.project; }) : undefined;
        (group ? group.sessions : plane).push(s);
    });

    const parts: string[] = [];
    groups.forEach(function(group, index) {
        parts.push('<div class="tab-group' + projectMarks(group.project.id, activeProjectId, chatProjectId) + '" data-project="' + escapeHtml(group.project.id) + '"' +
            ' style="--project-accent:' + projectAccent(index, groups.length) + '">' +
            '<div class="tab-group-header" title="' + escapeHtml(workspacePathOf(workspaces, group.project.workspaceId)) + '">' +
                '<span class="tab-group-caret"></span>' +
                '<span class="tab-group-name">' + escapeHtml(group.project.name) + '</span>' +
            '</div>' +
            '<div class="tab-group-tabs">' + tabsHtml(group.sessions) + '</div>' +
            '</div>');
    });
    // The root is marked on the space around the tree (the wrapper in chat.html), not here: the
    // plane is only the tabs that belong to no folder.
    parts.push('<div class="tab-group tab-group--plane"><div class="tab-group-tabs">' + tabsHtml(plane) + '</div></div>');
    return parts.join('');
}

/** The classes one project carries, as one rule: the working folder, the chat's folder, or both marks. */
export function projectMarks(projectId: string, activeProjectId: string, chatProjectId: string): string {
    const active = projectId === activeProjectId;
    const holdsChat = !active && projectId === chatProjectId;
    return (active ? ' is-active' : '') + (holdsChat ? ' holds-chat' : '');
}

/** The project of the tab on screen: '' when that tab is on the plane, or there is no such tab. */
export function chatProjectOf(sessions: SessionInfo[], activeSessionId: string): string {
    return sessions.find(tab => tab.id === activeSessionId)?.project || '';
}

/**
 * The elements whose click is their own: a tab, a project header, a button, an input.
 *
 * Every one of them sits inside the root space and handles its own click first; a click that
 * lands there must not also mean "the pane works in no folder". Markup, not behaviour — the rule
 * is checked by the selector alone, which is why it is one string and one predicate.
 */
export const ROOT_SPACE_OWNERS = '.session-tab, .tab-group-header, button, input';

/** Does this click belong to the root space — the background, rather than something on it? */
export function isRootSpaceTarget(target: { closest?(selector: string): unknown } | null | undefined): boolean {
    if (!target || typeof target.closest !== 'function') {
        return false;
    }
    return !target.closest(ROOT_SPACE_OWNERS);
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
export function workspacePathOf(workspaces: Workspace[], workspaceId: string): string {
    const entry = workspaces.find(function(workspace) { return workspace.id === workspaceId; });
    return entry ? entry.path : '';
}
