import { describe, it, beforeEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workspaceIdFor, WorkspaceStore } from '../../host/workspace/workSpace';
import { ProjectStore, projectsPathFor } from '../../host/workspace/projectStore';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'workspaces-'));

describe('workspace store: the shared list', () => {
    let dir: string;
    let store: WorkspaceStore;

    beforeEach(() => {
        dir = tmp();
        store = new WorkspaceStore(dir);
    });

    it('records a workspace once and stamps the one it has seen again', () => {
        store.register('/proj/a.code-workspace');
        store.register('/proj/a.code-workspace');
        const entries = store.read();
        assert.strictEqual(entries.length, 1, 'one entry per path');
        assert.strictEqual(entries[0].path, '/proj/a.code-workspace');
    });

    it('reads the file it used to be: a bare array of workspaces', () => {
        fs.writeFileSync(store.path, JSON.stringify([{ path: '/proj/old', lastSeen: 1 }]));
        assert.deepStrictEqual(store.read().map(entry => entry.path), ['/proj/old']);
    });

    it('holds workspaces only, and writes no temp file behind it', () => {
        store.register('/proj/a');
        assert.ok(!fs.existsSync(store.path + '.tmp'), 'the temp is renamed away, not left');
        const written = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.deepStrictEqual(Object.keys(written), ['workspaces'], 'projects are not this file\'s business');
    });

    it('hands over the projects it still carries, and drops them from the file', () => {
        fs.writeFileSync(store.path, JSON.stringify({
            workspaces: [{ path: '/proj/a', lastSeen: 1 }],
            projects: [{ id: 'p1', name: 'One', workspace: '/proj/a' }],
        }));
        assert.deepStrictEqual(store.takeProjects().map(project => project.name), ['One']);
        assert.deepStrictEqual(store.read().map(entry => entry.path), ['/proj/a'], 'the workspaces stay');
        assert.deepStrictEqual(store.takeProjects(), [], 'a second take finds nothing');
        assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(store.path, 'utf-8'))), ['workspaces']);
    });
});

describe('project store: one agent\'s projects', () => {
    let dir: string;
    let store: ProjectStore;

    beforeEach(() => {
        dir = tmp();
        store = new ProjectStore(dir, 'dev-vsc', new WorkspaceStore(dir));
    });

    it('names a project against the workspace it belongs to', () => {
        const project = store.create('  Timeless   admin ', '/proj/a.code-workspace');
        assert.ok(project);
        assert.strictEqual(project.name, 'Timeless admin', 'whitespace collapses, ends trim');
        assert.strictEqual(project.workspaceId, '/proj/a.code-workspace');
        assert.deepStrictEqual(store.projects().map(entry => entry.name), ['Timeless admin']);
    });

    it('creates nothing from a blank name', () => {
        assert.strictEqual(store.create('   ', '/proj/a'), undefined);
        assert.deepStrictEqual(store.projects(), []);
    });

    it('renames in place and keeps the id the tabs point at', () => {
        const project = store.create('One', '/proj/a');
        assert.ok(project);
        assert.strictEqual(store.rename(project.id, '  Two   words ')?.name, 'Two words');
        assert.strictEqual(store.projects()[0].id, project.id);
        assert.strictEqual(store.rename(project.id, '   '), undefined, 'a blank name changes nothing');
    });

    it('deletes one and leaves the others alone', () => {
        const first = store.create('One', '/proj/a');
        const second = store.create('Two', '/proj/a');
        assert.ok(first && second);
        assert.strictEqual(store.delete(first.id), true);
        assert.deepStrictEqual(store.projects().map(entry => entry.name), ['Two']);
        assert.strictEqual(store.delete('no-such-project'), false);
    });

    it('keeps one file per agent, beside that profile', () => {
        store.create('One', '/proj/a');
        const other = new ProjectStore(dir, 'des-dev', new WorkspaceStore(dir));
        assert.deepStrictEqual(other.projects(), [], 'another agent has its own list');
        assert.ok(projectsPathFor(dir, 'dev-vsc').includes(path.join('profiles', 'dev-vsc')));
    });

    it('adopts the shared file\'s projects once, so nothing has to be made again', () => {
        const shared = new WorkspaceStore(dir);
        fs.writeFileSync(shared.path, JSON.stringify({
            workspaces: [{ path: '/proj/a', lastSeen: 1 }],
            projects: [
                { id: 'p1', name: 'Features', workspace: '/proj/a' },
                { id: 'p2', name: 'Incidents', workspace: '/proj/a' },
            ],
        }));
        assert.deepStrictEqual(store.projects().map(entry => entry.name), ['Features', 'Incidents']);
        assert.deepStrictEqual(shared.read().map(entry => entry.path), ['/proj/a'], 'the shared file keeps its workspaces');
        const another = new ProjectStore(dir, 'des-dev', new WorkspaceStore(dir));
        assert.deepStrictEqual(another.projects(), [], 'the adoption happens once, not for every agent');
    });
});

describe('workspace store: it may not eat what it does not own', () => {
    it('keeps a projects list that has not been taken yet when a workspace is registered', () => {
        const dir = tmp();
        const store = new WorkspaceStore(dir);
        fs.writeFileSync(store.path, JSON.stringify({
            workspaces: [{ path: '/proj/a', lastSeen: 1 }],
            projects: [{ id: 'p1', name: 'Features', workspace: '/proj/a' }],
        }));
        store.register('/proj/b');
        assert.deepStrictEqual(store.takeProjects().map(project => project.name), ['Features'],
            'the list survives the registration, and adoption can still find it');
    });
});

describe('the workspace reference', () => {
    it('gives an entry written without an id one, and keeps that id', () => {
        const dir = tmp();
        const store = new WorkspaceStore(dir);
        fs.writeFileSync(store.path, JSON.stringify([{ path: '/proj/a', lastSeen: 1 }]));
        const first = store.read()[0];
        assert.ok(first.id, 'a legacy entry gets an id');
        assert.strictEqual(store.read()[0].id, first.id, 'and keeps it: the reference must stay stable');
    });

    it('reads a project that named its workspace by path as a reference to the id', () => {
        const dir = tmp();
        const workspaces = new WorkspaceStore(dir);
        fs.writeFileSync(workspaces.path, JSON.stringify([{ path: '/proj/a', lastSeen: 1 }]));
        const projects = new ProjectStore(dir, 'dev-vsc', workspaces);
        fs.mkdirSync(path.dirname(projects.path), { recursive: true });
        fs.writeFileSync(projects.path, JSON.stringify([{ id: 'p1', name: 'One', workspace: '/proj/a' }]));
        const project = projects.projects()[0];
        assert.strictEqual(project.workspaceId, workspaces.entryFor('/proj/a')?.id);
        assert.ok(!('workspace' in project), 'the path does not survive in the record');
        assert.strictEqual(projects.projects()[0].workspaceId, project.workspaceId, 'and it is written once');
    });
});

describe('the workspace id is the path', () => {
    it('derives the same id every time, and a different one per path', () => {
        const a = workspaceIdFor('/proj/a.code-workspace');
        assert.strictEqual(a, workspaceIdFor('/proj/a.code-workspace'), 'a lost registry re-creates the same id');
        assert.notStrictEqual(a, workspaceIdFor('/proj/b.code-workspace'));
        assert.strictEqual(workspaceIdFor(''), '', 'no workspace has no id');
    });

    it('replaces a minted id in the file with the derived one, once', () => {
        const dir = tmp();
        const store = new WorkspaceStore(dir);
        fs.writeFileSync(store.path, JSON.stringify([{ id: 'minted-old', path: '/proj/a.code-workspace', lastSeen: 1 }]));
        const first = store.read()[0];
        assert.strictEqual(first.id, workspaceIdFor('/proj/a.code-workspace'));
        const onDisk = JSON.parse(fs.readFileSync(store.path, 'utf-8'));
        assert.strictEqual(onDisk.workspaces[0].id, first.id, 'the file carries the derived id too');
    });
});
