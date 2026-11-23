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
