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
import { t } from '../../host/i18n';
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
const windowOn = (
    agents: AgentRow[],
    location: string,
    answer?: string,
    otherWindow = false,
    home = dir(),
) => {
    const logs: string[] = [];
    const infos: string[] = [];
    const flags: boolean[] = [];
    const shown: string[] = [];
    const asks: Array<{ message: string; actions: string[] }> = [];
    const picks: Array<{ title: string; items: Array<{ id: string; label: string; detail?: string }> }> = [];
    const folderDialogs: string[] = [];
    // What the user does next: a queue per question, with the harness's answers as the default.
    const user = {
        pick: location as string | undefined,
        picks: [] as Array<string | undefined>,
        folder: location as string | undefined,
        answers: [] as Array<string | undefined>,
    };
    const choices = {
        pick: async (title: string, items: Array<{ id: string; label: string; detail?: string }>) => {
            picks.push({ title, items });
            return user.picks.length > 0 ? user.picks.shift() : user.pick;
        },
        pickFolder: async (title: string) => {
            folderDialogs.push(title);
            return user.folder;
        },
        showInFileManager: async (folderPath: string) => { shown.push(folderPath); },
        ask: async (message: string, actions: string[]) => {
            asks.push({ message, actions });
            return user.answers.length > 0 ? user.answers.shift() : answer;
        },
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
        otherWindowLive: () => otherWindow,
        currentAgentId: () => agents[0]?.sessionProfileId || '',
    }, 'linux', {});

    return { home, location, store, notes, mirror, logs, infos, flags, shown, asks, picks, folderDialogs, user, agents };
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
            assert.deepStrictEqual(w.flags, [true], 'the menu now offers repair and change');
            const done = w.asks[w.asks.length - 1];
            assert.ok(done.message.includes(path.join(w.location, MIRROR_FOLDER)), 'the done notice names the folder in full');
            assert.deepStrictEqual(done.actions, [t('notesMirrorOpenFolder')], 'with a button that opens it');
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

/**
 * The first-run question: asked once, and its answer decides the next start.
 *
 * The file is the whole state: no record asks, `never` stops, `later` waits for its date, and a
 * close writes nothing so the next start asks again. A second window does not ask at all.
 */
describe('the first-run question', () => {
    const due = async (answer: string | undefined, otherWindow = false) => {
        const location = dir();
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], location, answer, otherWindow);
        await w.mirror.askIfDue();
        return w;
    };

    it('asks once when there is no record, with the three answers', async () => {
        const w = await due(undefined);
        try {
            assert.strictEqual(w.asks.length, 1);
            assert.deepStrictEqual(w.asks[0].actions, [
                t('notesAskDoIt'), t('notesAskLater'), t('notesAskNever'),
            ]);
            assert.strictEqual(w.store.readAnswer(), undefined, 'a closed notice writes nothing');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('"Remind me in 2 weeks" records the date, and the next start stays quiet', async () => {
        const w = await due(t('notesAskLater'));
        try {
            const stored = w.store.readAnswer();
            assert.strictEqual(stored?.answer, 'later');
            const days = (stored!.askAfter - Date.now()) / (24 * 60 * 60 * 1000);
            assert.ok(days > 13 && days < 15, `two weeks ahead, got ${days}`);

            // A second start over the same data home, as a reload or another window would be.
            const again = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], w.location, undefined, false, w.home);
            await again.mirror.askIfDue();
            assert.deepStrictEqual(again.asks, [], 'the date has not passed');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('a postpone whose date has passed is asked again', async () => {
        const w = await due(undefined);
        try {
            w.store.writeAnswer('later', Date.now() - 1000);
            const before = w.asks.length;
            await w.mirror.askIfDue();
            assert.strictEqual(w.asks.length, before + 1, 'due again');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('"Don\'t ask again" is final', async () => {
        const w = await due(t('notesAskNever'));
        try {
            assert.strictEqual(w.store.readAnswer()?.answer, 'never');
            await w.mirror.askIfDue();
            assert.strictEqual(w.asks.length, 1, 'asked once, then never again');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('"Let\'s do it" runs the set-up, and the question is not asked again', async () => {
        const w = await due(t('notesAskDoIt'));
        try {
            assert.strictEqual(w.store.readMirror()?.location, w.location, 'the picker ran');
            const asked = (): number => w.asks.filter(entry => entry.message === t('notesAskMirror')).length;
            assert.strictEqual(asked(), 1);
            await w.mirror.askIfDue();
            assert.strictEqual(asked(), 1, 'a mirror is set: nothing to ask');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('a window that is not the first does not ask', async () => {
        const w = await due(undefined, true);
        try {
            assert.deepStrictEqual(w.asks, [], 'another window is running');
            assert.strictEqual(w.store.readAnswer(), undefined);
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });
});

/**
 * What the picker promises: every row is the folder that will exist afterwards, and a folder from
 * the OS dialog is confirmed with that same path before anything is created.
 */
describe('the picker says what it will create', () => {
    it('names the folder in its title, and shows the result path for every row', async () => {
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], dir());
        try {
            await w.mirror.setUp();
            assert.strictEqual(w.picks[0].title, t('notesMirrorTitle'));
            assert.ok(w.picks[0].title.includes(MIRROR_FOLDER), 'the title names the folder itself');

            const rows = w.picks[0].items;
            assert.deepStrictEqual(rows.map(row => row.label), [t('notesMirrorDocuments'), t('notesMirrorChoose')]);
            assert.strictEqual(rows[0].detail, path.join(w.home, 'Documents', MIRROR_FOLDER),
                'the row says the folder that will be created, not the parent it starts from');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('confirms a folder from the dialog with the result path, before creating anything', async () => {
        const chosen = dir();
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], chosen);
        try {
            w.user.pick = 'choose';
            w.user.folder = chosen;
            w.user.answers = [t('notesMirrorCreateHere')];
            await w.mirror.setUp();

            const confirm = w.asks.find(entry => entry.actions.includes(t('notesMirrorCreateHere')));
            assert.ok(confirm, 'a confirm with Create here and Back');
            assert.deepStrictEqual(confirm.actions, [t('notesMirrorCreateHere'), t('notesMirrorBack')]);
            assert.strictEqual(confirm.message, t('notesMirrorConfirm', path.join(chosen, MIRROR_FOLDER)));
            assert.ok(fs.existsSync(path.join(chosen, MIRROR_FOLDER)), 'and only then is it created');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(chosen, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });

    it('"Back" returns to the list and creates nothing in the folder it was asked about', async () => {
        const asked = dir();
        const w = windowOn([{ sessionProfileId: 'id-a', agentName: 'kitt' }], asked);
        try {
            w.user.pick = 'documents';
            w.user.picks = ['choose'];
            w.user.folder = asked;
            w.user.answers = [t('notesMirrorBack')];
            await w.mirror.setUp();

            assert.ok(!fs.existsSync(path.join(asked, MIRROR_FOLDER)), 'nothing where Back was pressed');
            assert.strictEqual(w.store.readMirror()?.location, path.join(w.home, 'Documents'), 'the row chosen next won');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(asked, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
        }
    });
});

/**
 * Changing the location later: the new mirror is built first, and the folder left behind goes only
 * when everything in it is a link of ours.
 */
describe('changing the mirror\'s location', () => {
    const withMirror = async (agents: AgentRow[]) => {
        const location = dir();
        const w = windowOn(agents, location);
        await w.mirror.setUp();
        return w;
    };

    it('builds the new mirror, then removes the old folder and its links', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        const next = dir();
        try {
            w.user.pick = next;
            await w.mirror.changeLocation();

            assert.strictEqual(w.store.readMirror()?.location, next);
            assert.strictEqual(kindOf(path.join(mirrorDir(next), 'kitt')).kind, 'link', 'the new mirror is there');
            assert.ok(!fs.existsSync(mirrorDir(w.location)), 'and the folder we left is gone with its links');
            assert.ok(w.asks[w.asks.length - 1].message.includes(mirrorDir(next)), 'the notice names the new folder');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
            fs.rmSync(next, { recursive: true, force: true });
        }
    });

    it('a real file in the old folder keeps the old folder, links and all', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        const next = dir();
        try {
            const mine = path.join(mirrorDir(w.location), 'my own note.md');
            fs.writeFileSync(mine, 'the user wrote this');
            w.user.pick = next;
            await w.mirror.changeLocation();

            assert.ok(fs.existsSync(mine), 'the user\'s file is untouched');
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'kitt')).kind, 'link', 'and the old link was not removed');
            assert.ok(w.logs.some(line => line.includes(mirrorDir(w.location))), 'the folder is reported, not silently kept');
            assert.strictEqual(w.store.readMirror()?.location, next, 'while the record points at the new mirror');
        } finally {
            fs.rmSync(w.home, { recursive: true, force: true });
            fs.rmSync(w.location, { recursive: true, force: true });
            fs.rmSync(next, { recursive: true, force: true });
        }
    });

    it('a dismissed picker changes nothing', async () => {
        const w = await withMirror([{ sessionProfileId: 'id-a', agentName: 'kitt' }]);
        try {
            w.user.pick = undefined;
            await w.mirror.changeLocation();
            assert.strictEqual(w.store.readMirror()?.location, w.location);
            assert.strictEqual(kindOf(path.join(mirrorDir(w.location), 'kitt')).kind, 'link');
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
