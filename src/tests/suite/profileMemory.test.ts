/**
 * Hermes' own MEMORY.md, read for one question: has the agent kept the protected section that
 * names its notes folder?
 *
 * Everything here runs on a temp Hermes home — never `~/.hermes`. Nothing is written: the file
 * belongs to the agent (H2), and this module only answers yes or no for the one-time notice.
 */
import { describe, it } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasNotesProtectedSection, memoryPathFor } from '../../host/environment/profileMemory';

const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-memory-'));

/** A Hermes home with one profile's MEMORY.md, as the agent would have written it. */
const homeWith = (profileName: string, memory: string): { hermes: string; notes: string } => {
    const hermes = dir();
    const file = memoryPathFor(profileName, hermes);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, memory);
    return { hermes, notes: '/home/me/data/profiles/id-dev/notes' };
};

describe('where a profile keeps its memory', () => {
    it('is under the profile for a named one, and at the root for the default profile', () => {
        assert.strictEqual(
            memoryPathFor('kitt', '/h'),
            path.join('/h', 'profiles', 'kitt', 'memories', 'MEMORY.md')
        );
        assert.strictEqual(
            memoryPathFor('default', '/h'),
            path.join('/h', 'memories', 'MEMORY.md'),
            'the default profile has no folder of its own'
        );
    });
});

describe('the protected section: present only with the Notes line we asked for', () => {
    const section = (notesDir: string): string => [
        '== Protected section — change only on the user\'s explicit instruction ==',
        `Notes: ${notesDir} (index: 00 Index.md)`,
        '== End of protected section ==',
        '',
        'the rest of my memory',
    ].join('\n');

    it('is true when the marker and this folder are both there', () => {
        const { hermes, notes } = homeWith('kitt', section('/home/me/data/profiles/id-dev/notes'));
        try {
            assert.strictEqual(hasNotesProtectedSection('kitt', notes, hermes), true);
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('is false when the section names another folder', () => {
        const { hermes, notes } = homeWith('kitt', section('/somewhere/else/notes'));
        try {
            assert.strictEqual(hasNotesProtectedSection('kitt', notes, hermes), false);
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('is false when the markers are there without the Notes line', () => {
        const { hermes, notes } = homeWith('kitt', '== Protected section ==\n== End of protected section ==\n');
        try {
            assert.strictEqual(hasNotesProtectedSection('kitt', notes, hermes), false);
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('is false when the agent has not written the section yet, or has no file', () => {
        const { hermes, notes } = homeWith('kitt', '# my memory\n\nsomething small.\n');
        try {
            assert.strictEqual(hasNotesProtectedSection('kitt', notes, hermes), false);
            assert.strictEqual(hasNotesProtectedSection('iris', notes, hermes), false, 'no file at all');
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });

    it('reads the default profile at its own path', () => {
        const { hermes } = homeWith('default', section('/home/me/data/profiles/id-dev/notes'));
        try {
            assert.strictEqual(
                hasNotesProtectedSection('default', '/home/me/data/profiles/id-dev/notes', hermes),
                true,
                'the memory at the root of the home is the default profile\'s'
            );
        } finally {
            fs.rmSync(hermes, { recursive: true, force: true });
        }
    });
});
