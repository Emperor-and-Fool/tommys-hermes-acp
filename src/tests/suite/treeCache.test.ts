/**
 * The tree cache: one object that says where we are, and one that says where we were.
 *
 * The shape is pure (`buildTreeSnapshot`) and the rotation is a two-file rule, so both are tested
 * without an editor: a workspace id is all the cache needs to decide that the window moved.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Project, SessionInfo } from '../../shared/chat';
import { buildTreeSnapshot, TreeCache, treePathsFor } from '../../host/workspace/treeCache';

function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'treecache-'));
}

function tab(id: string, over: Partial<SessionInfo> = {}): SessionInfo {
    return { id, title: `Title ${id}`, createdAt: 1, updatedAt: 2, ...over } as SessionInfo;
}

function project(id: string, name: string): Project {
    return { id, name, workspaceId: 'w1' };
}

function input(workspaceId: string, over: Record<string, unknown> = {}) {
    return {
        profile: 'dev-vsc',
        workspacePath: `/proj/${workspaceId}.code-workspace`,
        workspaceId,
        activeSessionId: 'a',
        projects: [project('p1', 'Features')],
        tabs: [tab('a', { project: 'p1', hermesSessionId: 'h-a', sticky: true }), tab('b')],
        ...over,
    };
}

/** A cache whose inputs are whatever the test last set: the same shape App wires. */
function cacheOn(dir: string, log: (line: string) => void = () => undefined) {
    const holder: { current: any } = { current: input('w1') };
    const cache = new TreeCache(dir, log, () => holder.current);
    return { cache, holder };
}

describe('the tree file: what it says', () => {
    it('puts each tab under its project, and everything else on the plane', () => {
        const snapshot = buildTreeSnapshot(input('w1', {
            tabs: [
                tab('a', { project: 'p1', hermesSessionId: 'h-a', sticky: true, cwd: '/x' }),
                tab('b'),
                tab('c', { project: 'gone' }),
            ],
        }));
        assert.strictEqual(snapshot.workspace.id, 'w1');
        assert.strictEqual(snapshot.activeSessionId, 'a');
        assert.deepStrictEqual(snapshot.projects.map(entry => entry.name), ['Features']);
        assert.deepStrictEqual(snapshot.projects[0].tabs.map(entry => entry.id), ['a']);
        assert.deepStrictEqual(snapshot.projects[0].tabs[0], {
            id: 'a', title: 'Title a', hermesSessionId: 'h-a', sticky: true, cwd: '/x', updatedAt: 2,
        });
        // 'b' belongs to no project; 'c' names one this workspace does not have.
        assert.deepStrictEqual(snapshot.plane.map(entry => entry.id), ['b', 'c']);
    });

    it('leaves out what is absent instead of writing empty fields', () => {
        const snapshot = buildTreeSnapshot(input('w1', { tabs: [tab('b')] }));
        assert.deepStrictEqual(Object.keys(snapshot.plane[0]).sort(), ['id', 'sticky', 'title', 'updatedAt']);
        assert.strictEqual(snapshot.plane[0].sticky, false);
    });
});

describe('the tree file: two of them, and the window moving between workspaces', () => {
    it('writes current, and keeps the workspace it left as passive', () => {
        const dir = tmp();
        const { cache, holder } = cacheOn(dir);
        const paths = treePathsFor(dir, 'dev-vsc');

        holder.current = input('w1');
        cache.refresh();
        const first = JSON.parse(fs.readFileSync(paths.current, 'utf-8'));
        assert.strictEqual(first.workspace.id, 'w1');
        assert.ok(!fs.existsSync(paths.passive), 'nothing to keep until the window moves');

        holder.current = input('w2', { workspacePath: '/proj/w2.code-workspace' });
        cache.refresh();
        const passive = JSON.parse(fs.readFileSync(paths.passive, 'utf-8'));
        assert.strictEqual(passive.workspace.id, 'w1', 'passive is the workspace we left');
        assert.strictEqual(JSON.parse(fs.readFileSync(paths.current, 'utf-8')).workspace.id, 'w2');

        // Staying in w2 leaves the passive file alone: it is a reference, not a log.
        holder.current = input('w2', { tabs: [tab('b')] });
        cache.refresh();
        assert.strictEqual(JSON.parse(fs.readFileSync(paths.passive, 'utf-8')).workspace.id, 'w1');
    });

    it('does not rewrite a tree that has not changed', () => {
        const dir = tmp();
        const { cache } = cacheOn(dir);
        const paths = treePathsFor(dir, 'dev-vsc');
        cache.refresh();
        const before = fs.statSync(paths.current).mtimeMs;
        cache.refresh();
        assert.strictEqual(fs.statSync(paths.current).mtimeMs, before);
    });

    it('writes nothing when there is no profile or no workspace to name', () => {
        const dir = tmp();
        const lines: string[] = [];
        const { cache, holder } = cacheOn(dir, line => lines.push(line));
        const paths = treePathsFor(dir, 'dev-vsc');

        holder.current = input('w1', { profile: '' });
        cache.refresh();
        holder.current = input('', { workspaceId: '' });
        cache.refresh();
        assert.ok(!fs.existsSync(paths.current));
        assert.strictEqual(lines.length, 2);
    });
});

describe('the tree file: an agent is told it exists', () => {
    it('names both files once per session and workspace, then stays quiet', () => {
        const dir = tmp();
        const { cache } = cacheOn(dir);
        const paths = treePathsFor(dir, 'dev-vsc');

        const first = cache.noticeBlock('dev-vsc', 'w1', 'tab-a');
        assert.ok(first.includes(paths.current), 'current is named');
        assert.ok(first.includes(paths.passive), 'previous is named');
        assert.strictEqual(cache.noticeBlock('dev-vsc', 'w1', 'tab-a'), '', 'the same turn is not repeated');

        // A different session, or the same session in another workspace, is a fresh introduction.
        assert.ok(cache.noticeBlock('dev-vsc', 'w1', 'tab-b').includes(paths.current));
        assert.ok(cache.noticeBlock('dev-vsc', 'w2', 'tab-a').includes(paths.current));

        // Nothing to point at yet: no block, and it does not burn the introduction.
        assert.strictEqual(cache.noticeBlock('', 'w1', 'tab-c'), '');
        assert.strictEqual(cache.noticeBlock('dev-vsc', '', 'tab-c'), '');
        assert.ok(cache.noticeBlock('dev-vsc', 'w1', 'tab-c').includes(paths.current));
    });
});
