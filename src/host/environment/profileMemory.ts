import * as fs from 'fs';
import * as path from 'path';
import { HERMES_DEFAULT_PROFILE } from './hermesProfile';
import { resolveHermesRoot } from './hermesPaths';
import { sameFolderPath } from '../store/paths';

/**
 * Hermes' own memory file, per profile — read, never written (H1, H2).
 *
 * The extension never opens `MEMORY.md` for writing: Hermes owns it, and H2a names the only two
 * exceptions (a setting through the CLI, a setup step). What this file answers is a yes/no
 * question about the agent's own work: has it kept the protected section the one-time notice asks
 * for, and does that section name the notes folder we gave it.
 *
 * The path: a named profile keeps everything under `profiles/<name>/`, and the default profile has
 * no folder of its own — its memory sits at the root of the home, beside `state.db`.
 */

/** Where a profile's MEMORY.md lives. */
export function memoryPathFor(profileName: string, hermesHome = resolveHermesRoot()): string {
    const name = (profileName || '').trim();
    return name === HERMES_DEFAULT_PROFILE
        ? path.join(hermesHome, 'memories', 'MEMORY.md')
        : path.join(hermesHome, 'profiles', name, 'memories', 'MEMORY.md');
}

/** Hermes' own default for `memory.memory_char_limit`, when a profile's config.yaml is silent. */
export const DEFAULT_MEMORY_LIMIT = 2200;

/** Where a profile's config.yaml lives: the same shape as its memory file. */
export function profileConfigPathFor(profileName: string, hermesHome = resolveHermesRoot()): string {
    const name = (profileName || '').trim();
    return name === HERMES_DEFAULT_PROFILE
        ? path.join(hermesHome, 'config.yaml')
        : path.join(hermesHome, 'profiles', name, 'config.yaml');
}

/**
 * The configured limit for a profile's MEMORY.md, in characters.
 *
 * A hand-written scan of the one key, not a YAML dependency: the file is Hermes' own, the key sits
 * in the `memory:` block as a plain integer, and a parser for that would be a dependency with
 * nothing behind it. Anything unreadable is the default — the number the user sees must be the one
 * Hermes will enforce, and Hermes falls back to 2200 too.
 */
export function memoryLimitFor(profileName: string, hermesHome = resolveHermesRoot()): number {
    let text: string;
    try {
        text = fs.readFileSync(profileConfigPathFor(profileName, hermesHome), 'utf-8');
    } catch {
        return DEFAULT_MEMORY_LIMIT;
    }
    let inMemoryBlock = false;
    for (const line of text.split(/\r?\n/)) {
        if (/^memory:\s*$/.test(line)) {
            inMemoryBlock = true;
            continue;
        }
        if (inMemoryBlock && /^\S/.test(line)) {
            // Another top-level key: the memory block is over.
            inMemoryBlock = false;
        }
        const inline = line.match(/^memory:\s*\{[^}]*memory_char_limit:\s*(\d+)/);
        if (inline) {
            return Number(inline[1]);
        }
        if (!inMemoryBlock) {
            continue;
        }
        const match = line.match(/^\s+memory_char_limit:\s*(\d+)\s*(?:#.*)?$/);
        if (match) {
            return Number(match[1]);
        }
    }
    return DEFAULT_MEMORY_LIMIT;
}

/**
 * How many characters a profile's MEMORY.md holds right now.
 *
 * Counted, not estimated: this is the number the dialog shows against the limit. A file that is not
 * there is zero — an agent that never wrote memory has nothing to grow.
 */
export function memoryFill(profileName: string, hermesHome = resolveHermesRoot()): number {
    try {
        return [...fs.readFileSync(memoryPathFor(profileName, hermesHome), 'utf-8')].length;
    } catch {
        return 0;
    }
}

/** The marker that opens the protected section. */
const SECTION_MARKER = '== Protected section';

/**
 * Does this profile's MEMORY.md carry the protected section, with a `Notes:` line naming that
 * folder?
 *
 * A missing file, a file without the marker, and a file whose Notes line names another folder are
 * all "not yet" — which is what makes the one-time notice say its piece again instead of assuming
 * the agent did as it was told.
 */
export function hasNotesProtectedSection(
    profileName: string,
    notesDir: string,
    hermesHome = resolveHermesRoot(),
): boolean {
    let text: string;
    try {
        text = fs.readFileSync(memoryPathFor(profileName, hermesHome), 'utf-8');
    } catch {
        return false;
    }
    if (!text.includes(SECTION_MARKER)) {
        return false;
    }
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*Notes:\s*(.+)$/);
        if (!match) {
            continue;
        }
        // The line we ask for is `Notes: <dir> (index: 00 Index.md)`; the trailing note is optional.
        const named = match[1].replace(/\s*\(index:[^)]*\)\s*$/, '').trim();
        if (named && sameFolderPath(named, notesDir)) {
            return true;
        }
    }
    return false;
}
