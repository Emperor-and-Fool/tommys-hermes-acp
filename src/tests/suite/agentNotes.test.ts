/**
 * An agent's own notes: a folder beside its tabs, an index that names the agent, and the notice
 * that tells it where both are.
 *
 * Everything here runs on a temp folder — never `~/.hermes` and never the real data home. The
 * description is Hermes' own file, so the reader is tested against a temp Hermes home too (H2:
 * read, never written).
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentNotes, indexText } from '../../host/notes/notes';
import { INDEX_FILE, NotesStore } from '../../host/notes/store';
import { notesDirFor } from '../../host/store/paths';
import { parseDescription, profileDescription } from '../../host/environment/profileFallback';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notes-'));

/** The notes feature over a temp data home, with the agent's name and description as its port. */
const notesOn = (historyDir: string, info: { name: string; description: string } = { name: 'dev-vsc', description: 'Reads the vault.' }) => {
    const logs: string[] = [];
    const notes = new AgentNotes(new NotesStore(historyDir), {
        log: (line: string) => logs.push(line),
        profileInfo: () => info,
        protectedSection: () => false,
    });
    return { notes, logs, store: new NotesStore(historyDir), dir: historyDir };
};

const readIndex = (historyDir: string, sessionProfileId: string): string =>
    fs.readFileSync(path.join(notesDirFor(historyDir, sessionProfileId), INDEX_FILE), 'utf-8');

describe('the notes folder: made on connect, beside the agent\'s tabs', () => {
    it('creates profiles/<id>/notes/ and says it was new', () => {
        const home = dir();
        try {
            const { notes } = notesOn(home);
            assert.strictEqual(notes.ensure('id-dev'), true, 'the folder is new');
            assert.ok(fs.existsSync(path.join(home, 'profiles', 'id-dev', 'notes')), 'exactly where the paths say');
            assert.strictEqual(notes.ensure('id-dev'), false, 'and a second connect creates nothing');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('leaves the index alone when nothing it says has changed', () => {
        const home = dir();
        try {
            const { notes } = notesOn(home);
            notes.ensure('id-dev');
            const index = path.join(home, 'profiles', 'id-dev', 'notes', INDEX_FILE);
            const before = fs.statSync(index).mtimeMs;
            notes.ensure('id-dev');
            assert.strictEqual(fs.statSync(index).mtimeMs, before, 'a reconnect is not a write');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('rewrites the index when the agent it describes has changed its name', () => {
        const home = dir();
        try {
            const first = notesOn(home);
            first.notes.ensure('id-dev');
            assert.ok(readIndex(home, 'id-dev').includes('- Agent: dev-vsc'));

            const renamed = notesOn(home, { name: 'dev-vsc-two', description: 'Reads the vault.' });
            renamed.notes.ensure('id-dev');
            assert.ok(readIndex(home, 'id-dev').includes('- Agent: dev-vsc-two'), 'the name follows Hermes');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('the index: who the agent is, and which notes exist', () => {
    it('names the agent, its id and its description, and says the other files are the agent\'s own', () => {
        const home = dir();
        try {
            const { notes } = notesOn(home);
            notes.ensure('id-dev');
            const text = readIndex(home, 'id-dev');
            assert.ok(text.includes('# dev-vsc — notes'));
            assert.ok(text.includes('- Session profile id: id-dev'));
            assert.ok(text.includes('- Description: Reads the vault.'));
            assert.ok(text.includes('**Generated.**'), 'the file says it is generated');
            assert.ok(text.includes('the other files in this folder are your'), 'and whose the others are');
            assert.ok(text.includes('- (no notes yet)'), 'an empty folder says so');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('lists the .md files by name, size and last change — never their content', () => {
        const home = dir();
        try {
            const { notes } = notesOn(home);
            const folder = path.join(home, 'profiles', 'id-dev', 'notes');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, '01 Vault.md'), 'a secret note');
            fs.writeFileSync(path.join(folder, 'shopping.txt'), 'not markdown');

            notes.ensure('id-dev');
            const text = readIndex(home, 'id-dev');
            assert.ok(text.includes('`01 Vault.md` — 13 bytes'), 'name and size');
            assert.ok(text.includes('changed 20'), 'and when it changed (an ISO stamp)');
            assert.ok(!text.includes('a secret note'), 'the content is the agent\'s business');
            assert.ok(!text.includes('shopping.txt'), 'only .md: the index lists notes, not the folder');
            assert.ok(!text.includes(`\`${INDEX_FILE}\``), 'and never itself');
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('says (none) when Hermes has no description for the agent', () => {
        const home = dir();
        try {
            const { notes } = notesOn(home, { name: 'kitt', description: '' });
            notes.ensure('id-kitt');
            assert.ok(readIndex(home, 'id-kitt').includes('- Description: (none)'));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('is a pure function of its four facts', () => {
        const text = indexText({
            name: 'iris',
            description: 'Keeps the archive.',
            sessionProfileId: 'id-iris',
            files: [{ name: '02 Archive.md', size: 42, changedAt: 0 }],
        });
        assert.ok(text.startsWith('# iris — notes\n'));
        assert.ok(text.includes('- `02 Archive.md` — 42 bytes, changed 1970-01-01T00:00:00.000Z'));
        assert.ok(text.endsWith('\n'), 'one trailing newline, so a rewrite is a byte-for-byte compare');
    });
});

describe('the notice: where the notes are, and the one rule about using them', () => {
    const withNotes = (historyDir: string, protectedSection: boolean) =>
        new AgentNotes(new NotesStore(historyDir), {
            log: () => undefined,
            profileInfo: () => ({ name: 'dev-vsc', description: '' }),
            protectedSection: () => protectedSection,
        });

    it('is exactly these words, while the protected section is not there yet', () => {
        const home = dir();
        try {
            const notes = withNotes(home, false);
            notes.ensure('id-dev');
            const folder = path.join(home, 'profiles', 'id-dev', 'notes');
            assert.strictEqual(notes.notice('id-dev'), [
                '<agent-notes>',
                `Your notes folder: ${folder} (index: 00 Index.md)`,
                'Keep notes per project here, so your memory stays small.',
                '</agent-notes>',
                '',
                '<agent-notes-setup>',
                'One-time setup. At the very start of your MEMORY.md, keep a protected section:',
                "== Protected section — change only on the user's explicit instruction ==",
                `Notes: ${folder} (index: 00 Index.md)`,
                '== End of protected section ==',
                'The Notes line comes first in it. Create the section if missing; if one exists, rename its markers',
                'to these and add the Notes line. Replace entries that point to older note locations.',
                'Write memory and notes in English, whatever language the user speaks.',
                '</agent-notes-setup>',
            ].join('\n'));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('drops the one-time block once the protected section names this folder', () => {
        const home = dir();
        try {
            const notes = withNotes(home, true);
            notes.ensure('id-dev');
            const block = notes.notice('id-dev');
            assert.ok(!block.includes('<agent-notes-setup>'), 'no second ask');
            assert.ok(block.endsWith('</agent-notes>'));
            assert.ok(block.includes(`Your notes folder: ${path.join(home, 'profiles', 'id-dev', 'notes')} (index: 00 Index.md)`));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('answers "not yet" for an agent that has not been read in this window', () => {
        const home = dir();
        try {
            const notes = withNotes(home, true);
            // No ensure(): nothing was read, so the block is asked for.
            assert.ok(notes.notice('id-dev').includes('<agent-notes-setup>'));
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('the description: read from Hermes\' own profile.yaml, never written', () => {
    it('reads a plain line, strips a comment and quotes, and refuses a block scalar', () => {
        assert.strictEqual(parseDescription('description: Reads the vault.\n'), 'Reads the vault.');
        assert.strictEqual(parseDescription('description: "Quoted name"\n'), 'Quoted name');
        assert.strictEqual(parseDescription('description: Reads  # a note\n'), 'Reads');
        assert.strictEqual(parseDescription('description: |\n  two\n  lines\n'), '', 'half-read is worse than empty');
        assert.strictEqual(parseDescription('previous_names:\n  - pa\n'), '');
    });

    it('finds the file in a named profile\'s folder and at the root for the default profile', () => {
        const hermes = dir();
        try {
            fs.mkdirSync(path.join(hermes, 'profiles', 'kitt'), { recursive: true });
            fs.writeFileSync(path.join(hermes, 'profiles', 'kitt', 'profile.yaml'), 'description: Keeps the pantry.\n');
            fs.writeFileSync(path.join(hermes, 'profile.yaml'), 'description: The house agent.\n');

            assert.strictEqual(profileDescription('kitt', hermes), 'Keeps the pantry.');
            assert.strictEqual(profileDescription('default', hermes), 'The house agent.');
            assert.strictEqual(profileDescription('iris', hermes), '', 'no folder, no description');
            assert.strictEqual(profileDescription('', hermes), '');
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });
});
