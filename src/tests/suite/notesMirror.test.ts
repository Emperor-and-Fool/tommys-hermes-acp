/**
 * The agent notes mirror: one readable link per agent, in a folder the user chose.
 *
 * Everything runs on temp folders — never `~/.hermes` and never the real data home. The rules the
 * tests hold to are the ones that protect the user's own files: a real file is never touched, a
 * link of ours is renamed rather than re-made, and nothing is deleted to tidy up.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentNotes } from '../../host/notes/notes';
import { MIRROR_FOLDER, NotesMirror, linkNameFor } from '../../host/notes/mirror';
import { NotesStore } from '../../host/notes/store';
import { notesDirFor } from '../../host/store/paths';
import { obsidianConfigPaths, parseObsidianVaults } from '../../host/notes/obsidian';
import type { EditorChoices } from '../../shared/editor';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-mirror-'));

interface AgentRow {
    sessionProfileId: string;
    agentName: string;
}

/** A window's notes features over temp folders, with every port answer recorded. */
const windowOn = (agents: AgentRow[], location: string) => {
    const home = dir();
    const logs: string[] = [];
    const infos: string[] = [];
    const flags: boolean[] = [];
    const shown: string[] = [];
    const choices = {
        pick: async () => location,
        pickFolder: async () => location,
        showInFileManager: async (folderPath: string) => { shown.push(folderPath); },
        home: () => home,
    } as unknown as EditorChoices;
    const store = new NotesStore(home);
    const notes = new AgentNotes(store, {
        log: () => undefined,
        profileInfo: (sessionProfileId: string) => ({
            name: agents.find(agent => agent.sessionProfileId === sessionProfileId)?.agentName || 'unknown',
            description: '',
        }),
    });
    const mirror = new NotesMirror(store, notes, {
        log: line => logs.push(line),
        info: message => infos.push(message),
        choices,
        agents: () => agents,
        mirrorSet: value => flags.push(value),
    }, 'linux', {});

    return { home, location, store, notes, mirror, logs, infos, flags, shown, agents };
};

/** The mirror folder inside the location the user picked. */
const mirrorDir = (location: string): string => path.join(location, MIRROR_FOLDER);

/** What a path in the mirror is: a link to what, or something real. */
const kindOf = (entryPath: string): { kind: 'missing' } | { kind: 'real' } | { kind: 'link'; target: string } => {
    let entry: fs.Stats;
    try {
        entry = fs.lstatSync(entryPath);
    } catch {
        return { kind: 'missing' };
    }
    if (!entry.isSymbolicLink()) {
        return { kind: 'real' };
    }
    return { kind: 'link', target: path.resolve(path.dirname(entryPath), fs.readlinkSync(entryPath)) };
};

describe('a link name: what Windows allows, and nothing more', () => {
    it('replaces the forbidden characters and strips a trailing dot or space', () => {
        assert.strictEqual(linkNameFor('a/b:c', 'id-a'), 'a-b-c');
        assert.strictEqual(linkNameFor('dev*?<>|"', 'id-a'), 'dev------');
        assert.strictEqual(linkNameFor('kitt. ', 'id-a'), 'kitt');
        assert.strictEqual(linkNameFor('dev-vsc', 'id-a'), 'dev-vsc', 'a plain name is left alone');
    });

    it('falls back to the id when nothing is left to name the link', () => {
        assert.strictEqual(linkNameFor('', 'id-dev'), 'id-dev');
        assert.strictEqual(linkNameFor('...', 'id-dev'), 'id-dev');
    });
});

describe('setting the mirror up', () => {
    it('makes the folder, one link per agent, and stores where it is', async () => {
        const location = dir();
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], location);
        try {
            await w.mirror.setUp();

            const link = path.join(mirrorDir(location), 'kitt');
            const state = kindOf(link);
            assert.strictEqual(state.kind, 'link', 'a link, not a copy');
            assert.strictEqual(state.target, path.resolve(notesDirFor(w.home, 'id-a')), 'pointing at that agent\'s notes');
            assert.ok(fs.existsSync(notesDirFor(w.home, 'id-a')), 'and the notes exist, so the link is never to nothing');

            const stored = w.store.readMirror();
            assert.strictEqual(stored?.location, location, 'the choice lives in the data home, not a setting');
            assert.deepStrictEqual(w.flags, [true], 'the menu now offers "repair"');
            assert.ok(w.infos.length === 1 && w.infos[0].includes(MIRROR_FOLDER), 'one short line, naming the folder');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(location, { recursive: true, force: true });
        }
    });

    it('a dismissed picker creates nothing and stores nothing', async () => {
        const location = dir();
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], '');
        try {
            await w.mirror.setUp();
            assert.strictEqual(w.store.readMirror(), undefined);
            assert.deepStrictEqual(w.flags, []);
            assert.ok(!fs.existsSync(mirrorDir(location)));
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(location, { recursive: true, force: true });
        }
    });
});

describe('repair: what it makes, renames, and leaves alone', () => {
    const withMirror = async (agents: AgentRow[]) => {
        const location = dir();
        const w = windowOn(agents, location);
        await w.mirror.setUp();
        return w;
    };

    it('a second sync finds everything in place and changes nothing', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        try {
            const report = w.mirror.sync(w.mirror.current()!);
            assert.deepStrictEqual(
                { created: report.created, renamed: report.renamed, intact: report.intact, findings: report.findings },
                { created: 0, renamed: 0, intact: 1, findings: [] }
            );
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('a renamed agent has its link renamed, not re-made', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        try {
            const before = fs.lstatSync(path.join(mirrorDir(w.location), 'kitt')).ino;
            w.agents[0].agentName = 'kitt-2';
            const report = w.mirror.sync(w.mirror.current()!);

            assert.strictEqual(report.renamed, 1);
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'kitt')).kind, 'missing', 'the old name is gone');
            const after = fs.lstatSync(path.join(mirrorDir(w.location), 'kitt-2'));
            assert.strictEqual(after.ino, before, 'the same link, under the new name');
            assert.strictEqual(w.store.readMirror()?.agents[0].link, 'kitt-2', 'and the record follows');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('a real folder with an agent\'s name is reported and left alone', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        try {
            const real = path.join(mirrorDir(w.location), 'kitt');
            fs.unlinkSync(real);
            fs.mkdirSync(real);
            fs.writeFileSync(path.join(real, 'the user\'s own note.md'), 'mine');

            const report = w.mirror.sync(w.mirror.current()!);
            assert.strictEqual(report.findings.length, 1, 'said, not overwritten');
            assert.strictEqual(kindOf(real).kind, 'real');
            assert.ok(fs.existsSync(path.join(real, 'the user\'s own note.md')), 'the file is still there');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('two agents differing only in case are reported, not merged', async () => {
        const w = await withMirror([
            { sessionProfileId: 'id-a', agentName: 'Kitt' },
            { sessionProfileId: 'id-b', agentName: 'kitt' },
        ]);
        try {
            const report = w.mirror.sync(w.mirror.current()!);
            assert.strictEqual(report.findings.length, 1, 'the second one is reported');
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'Kitt')).kind, 'link');
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'kitt')).kind, 'missing', 'nothing merged');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('a link whose folder went away gets the folder back, and says so', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        try {
            fs.rmSync(notesDirFor(w.home, 'id-a'), { recursive: true, force: true });
            const report = w.mirror.sync(w.mirror.current()!);

            assert.strictEqual(report.findings.length, 1, 'reported');
            assert.ok(fs.existsSync(notesDirFor(w.home, 'id-a')), 'the agent\'s folder is made again');
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'kitt')).kind, 'link', 'the link is not deleted');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });
});

describe('a start: the menu item, and a quiet repair', () => {
    it('says there is no mirror and does nothing else', () => {
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], dir());
        try {
            w.mirror.repairOnStart();
            assert.deepStrictEqual(w.flags, [false], 'set up, not repair');
            assert.deepStrictEqual(w.logs, []);
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });
});

describe('Obsidian\'s own vault list', () => {
    it('is looked for where each platform keeps it', () => {
        assert.deepStrictEqual(
            obsidianConfigPaths('win32', 'C:\\Users\\me', { APPDATA: 'C:\\AppData' }),
            [path.join('C:\\AppData', 'obsidian', 'obsidian.json')]
        );
        assert.deepStrictEqual(
            obsidianConfigPaths('darwin', '/Users/me'),
            [path.join('/Users/me', 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
        );
        // Linux: the XDG config first, then the flatpak install's own copy.
        assert.deepStrictEqual(obsidianConfigPaths('linux', '/home/me'), [
            path.join('/home/me', '.config', 'obsidian', 'obsidian.json'),
            path.join('/home/me', '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
        ]);
    });

    it('is read as names and paths, sorted, and nothing else', () => {
        const text = JSON.stringify({
            vaults: {
                a: { path: '/home/me/second', ts: 1, open: true },
                b: { path: '/home/me/first' },
                c: { notAPath: true },
            },
        });
        assert.deepStrictEqual(parseObsidianVaults(text), [
            { name: 'first', path: '/home/me/first' },
            { name: 'second', path: '/home/me/second' },
        ]);
        assert.deepStrictEqual(parseObsidianVaults('not json'), []);
        assert.deepStrictEqual(parseObsidianVaults('{}'), []);
    });
});
