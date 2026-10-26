/**
 * Renaming a session through Hermes' own CLI.
 *
 * Stock Hermes has `hermes sessions rename <id> <title>`, which writes the same title row the
 * local patch's ACP method did — and stores it as a *user* title, so the auto-titler cannot
 * overwrite it later. Nothing here touches Hermes' files: the CLI is the whole interface, which
 * is also why none of this depends on a live ACP connection.
 */
import { runHermesCommand } from './profileDiscovery';
import { normalizeHermesCliProfile } from './hermesProfile';

/**
 * The argv for one rename. `--` ends the options, so a title that starts with `-` is still read
 * as the title; the title itself is always a single argument, spaces and all.
 */
export function renameSessionArgs(profile: string, sessionId: string, title: string): string[] {
    return ['--profile', normalizeHermesCliProfile(profile), 'sessions', 'rename', '--', sessionId, title];
}

/** Hermes prints a refusal as `Error: …` on stdout; the tab shows the reason, not the prefix. */
export function stripCliError(text: string): string {
    return (text || '').trim().replace(/^Error:\s*/i, '').trim();
}

/**
 * Rename one session through the CLI.
 *
 * Resolves `true` when Hermes took the title. A refusal — a name another session already holds,
 * one past the agent's length limit — comes back as a throw carrying Hermes' own words, because
 * `renameSession` reports whatever it is given and that sentence is the only explanation the
 * user gets.
 */
export async function renameSessionViaCli(
    executable: string,
    profile: string,
    sessionId: string,
    title: string
): Promise<boolean> {
    try {
        await runHermesCommand(executable, renameSessionArgs(profile, sessionId, title));
        return true;
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        throw new Error(stripCliError(raw));
    }
}
