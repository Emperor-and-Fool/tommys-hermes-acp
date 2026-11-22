import { describe, it } from 'mocha';
import assert from 'assert';
import { chatProjectOf, isRootSpaceTarget, projectMarks, projectTreeHtml, ROOT_SPACE_OWNERS } from '../../pane/components/workspace/projectTree';
import type { Project, SessionInfo, Workspace } from '../../shared/chat';

/**
 * The two marks on the tree, and the one click the background owns.
 *
 * `is-active` is the folder the pane works in; `holds-chat` is the folder the chat on screen lives
 * in. One outline each, never two on one project — and a click that landed on a tab, a header, a
 * button or an input is that element's click, not "no folder".
 */

const project = (id: string): Project => ({ id, name: id.toUpperCase(), workspaceId: 'w1' });

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...over,
});

const workspaces: Workspace[] = [{ id: 'w1', path: '/work/one', lastSeen: 1 }];
const tabsHtml = (): string => '';

/** The class attribute of one project's group, as the tree wrote it. */
const classesOf = (html: string, projectId: string): string => {
    const match = html.match(new RegExp('class="(tab-group[^"]*)" data-project="' + projectId + '"'));
    return match ? match[1] : '(group not drawn)';
};

describe('the project tree: which folder carries which outline', () => {
    it('marks the chat\'s folder while another folder is the one being worked in', () => {
        const html = projectTreeHtml(
            [session('t1', { project: 'p1' })],
            tabsHtml,
            [project('p1'), project('p2')],
            workspaces,
            'p2',
            'p1',
        );
        assert.strictEqual(classesOf(html, 'p2'), 'tab-group is-active', 'the working folder');
        assert.strictEqual(classesOf(html, 'p1'), 'tab-group holds-chat', 'the chat\'s folder keeps its outline');
    });

    it('gives one project both when it is both: one mark, one outline', () => {
        const html = projectTreeHtml(
            [session('t1', { project: 'p1' })],
            tabsHtml,
            [project('p1'), project('p2')],
            workspaces,
            'p1',
            'p1',
        );
        assert.strictEqual(classesOf(html, 'p1'), 'tab-group is-active', 'no second outline on the same folder');
        assert.strictEqual(classesOf(html, 'p2'), 'tab-group', 'and nothing on the others');
        assert.strictEqual(projectMarks('p1', 'p1', 'p1'), ' is-active');
    });

    it('the root marker is not on the plane any more, it is the space around the tree', () => {
        const html = projectTreeHtml([session('t1')], tabsHtml, [project('p1')], workspaces, '', '');
        assert.ok(html.includes('class="tab-group tab-group--plane"'), 'the plane is only the tabs in no folder');
        assert.ok(!html.includes('tab-group--plane is-active'), 'the root is marked on the wrapper, not here');
    });

    it('reads the chat\'s folder from the tab on screen, and gives the plane for a session in none', () => {
        const tabs = [session('a', { project: 'p1' }), session('b')];
        assert.strictEqual(chatProjectOf(tabs, 'a'), 'p1');
        assert.strictEqual(chatProjectOf(tabs, 'b'), '', 'a tab on the plane is no folder');
        assert.strictEqual(chatProjectOf(tabs, 'gone'), '', 'a tab that is not there names no folder');
    });
});

describe('the root space: one click, and only on the background', () => {
    /** The smallest thing that answers `closest`, the way an Element does. */
    const target = (inside: string[]): { closest(selector: string): unknown } => ({
        closest(selector: string) {
            const found = inside.filter(owner => selector.includes(owner));
            return found.length ? {} : null;
        },
    });

    it('a click that started in a tab, a header, a button or an input is not the background\'s', () => {
        for (const owner of ['.session-tab', '.tab-group-header', 'button', 'input']) {
            assert.strictEqual(isRootSpaceTarget(target([owner])), false, owner + ' handles its own click');
        }
    });

    it('a click on the wrapper itself is the root space', () => {
        assert.strictEqual(isRootSpaceTarget(target([])), true);
        assert.strictEqual(isRootSpaceTarget(null), false, 'no target is no evidence of the background');
    });

    it('the filter names those four owners and nothing else', () => {
        assert.strictEqual(ROOT_SPACE_OWNERS, '.session-tab, .tab-group-header, button, input');
    });
});
