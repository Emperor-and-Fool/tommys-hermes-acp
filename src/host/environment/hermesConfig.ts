import { spawn } from 'child_process';

/**
 * Hermes' own configuration, changed only through its CLI.
 *
 * H2a is the rule: our code never writes a Hermes file, and a setting changes through the CLI, for
 * a user's click, and only for a key named in that rule. `memory.memory_char_limit` is the one named
 * for the notes home; this file runs it and nothing else, and it is the only place a `config set`
 * leaves this extension (H1).
 */

/** What Hermes answered: the words to show, and whether the setting was written. */
export interface ConfigSetResult {
    ok: boolean;
    message: string;
}

/**
 * The arguments of the command, in one place.
 *
 * Exported so a test can read the exact argv without spawning anything: the spelling of the flag
 * (`-p`, not `--profile`) and the order of the words is the contract with the CLI.
 */
export function configSetArgs(profile: string, key: string, value: string): string[] {
    return ['-p', profile, 'config', 'set', key, value];
}

/** How long a config write may take before it is treated as failed. A CLI call, not a turn. */
const CONFIG_TIMEOUT_MS = 15_000;

/**
 * Run `hermes -p <profile> config set <key> <value>` and answer with what it said.
 *
 * Never throws: a refusal, a missing binary and a timeout are all answers the dialog shows. A
 * non-zero exit answers with Hermes' own stderr, which is the part the user can act on.
 */
export function setHermesConfig(
    executable: string,
    profile: string,
    key: string,
    value: string,
): Promise<ConfigSetResult> {
    return new Promise((resolve) => {
        const args = configSetArgs(profile, key, value);
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn(executable, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
            });
        } catch (error) {
            resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
            return;
        }
        let stdout = '';
        let stderr = '';
        const finish = (result: ConfigSetResult): void => {
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            try {
                proc.kill();
            } catch {
                // already gone
            }
            finish({ ok: false, message: `hermes config set timed out after ${CONFIG_TIMEOUT_MS / 1000}s` });
        }, CONFIG_TIMEOUT_MS);

        proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on('error', (error: Error) => finish({ ok: false, message: error.message }));
        proc.on('exit', (code: number | null) => {
            const said = (stdout.trim() || stderr.trim());
            finish(code === 0
                ? { ok: true, message: said }
                : { ok: false, message: said || `hermes exited with code ${code}` });
        });
    });
}
