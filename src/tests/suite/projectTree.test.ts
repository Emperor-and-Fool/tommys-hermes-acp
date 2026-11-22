import { describe, it } from 'mocha';
import assert from 'assert';
import { chatProjectOf, collapsedFromPair, isRootSpaceTarget, projectClickAction, projectMarks, projectTreeHtml, ROOT_SPACE_OWNERS } from '../../pane/components/workspace/projectTree';
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

describe('a header click: select first, fold only what you are working in', () => {
    it('a click on a folder that is not the working one selects it and never folds it', () => {
        assert.deepStrictEqual(projectClickAction('p2', 'p1', false), { post: true, fold: false, clearOverride: true });
    });

    it('a click on the working folder folds it and posts nothing', () => {
        assert.deepStrictEqual(projectClickAction('p1', 'p1', false), { post: false, fold: true, clearOverride: true });
    });

    it('a ctrl-click (or meta-click) folds this one project, selects nothing and keeps itself', () => {
        assert.deepStrictEqual(projectClickAction('p1', 'p1', true), { post: false, fold: true, clearOverride: false });
        assert.deepStrictEqual(projectClickAction('p2', 'p1', true), { post: false, fold: true, clearOverride: false });
    });
});

describe('the open set: the pair, and a manual fold on top of it', () => {
    const projects = [project('p1'), project('p2'), project('p3')];
    const folded = (set: Set<string>): string[] => projects.filter(p => set.has(p.id)).map(p => p.id).sort();

    it('two folders are open at most: the active one and the one before it', () => {
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', null)), ['p3']);
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p3', 'p2', null)), ['p1']);
    });

    it('the root counts as one of the two: it opens nothing on its side', () => {
        assert.deepStrictEqual(folded(collapsedFromPair(projects, '', 'p2', null)), ['p1', 'p3'], 'root + X: only X');
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', '', null)), ['p1', 'p3'], 'X + root: only X');
        assert.deepStrictEqual(folded(collapsedFromPair(projects, '', '', null)), ['p1', 'p2', 'p3'], 'root alone');
    });

    it('a manual fold survives a redraw, and is gone once it is cleared', () => {
        const folds = new Map([['p1', true]]);
        const withFolds = collapsedFromPair(projects, 'p2', 'p1', folds);
        assert.ok(withFolds.has('p1'), 'the user folded it by hand');
        assert.deepStrictEqual(folded(withFolds), ['p1', 'p3']);
        // The same computation again — a re-render — lands on the same thing: it survives.
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', folds)), ['p1', 'p3']);
        // A normal click clears the set, and the pair has the last word.
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', null)), ['p3']);
    });

    it('two ctrl-clicks hold two projects open at once, and one normal click ends both', () => {
        // p2 is active, p1 is the other open one; the user opens p1's neighbour and p3's by hand.
        const folds = new Map([['p2', true], ['p3', false]]);
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', folds)), ['p2'], 'p1 and p3 open, the working folder folded by hand');
        // A third ctrl-click adds to the same set rather than replacing it.
        folds.set('p1', true);
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', folds)), ['p1', 'p2']);
        // The next normal click clears them all and the pair decides again.
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', null)), ['p3']);
    });

    it('an override that opens a folder wins over the pair, and names nothing that is gone', () => {
        assert.deepStrictEqual(folded(collapsedFromPair(projects, 'p2', 'p1', new Map([['p3', false]]))), []);
        assert.deepStrictEqual(
            collapsedFromPair(projects, 'p2', 'p1', new Map([['gone', true]])),
            collapsedFromPair(projects, 'p2', 'p1', null),
            'a deleted project cannot be folded',
        );
    });
});
