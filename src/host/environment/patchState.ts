/**
 * The state of the ACP patch set in a Hermes checkout — read, and only on request, changed.
 *
 * Two answers to `hermes update`'s "Restore local changes?" both end in no sessions when the version
 * jumps a minor: keep brings the old set back on the new code, decline leaves no catalog methods at
 * all. What the checkout needs is a known set, and the extension can say which one it finds — it knows
 * exactly what the patches add, so it can also reverse the wrong set and apply the right one.
 *
 * Nothing here writes outside `acp_adapter/`, and nothing writes at all unless `fixPatchState` is
 * called by a click. Every command is git's own `apply --check` / `apply --reverse --check`, which
 * touch nothing.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_PATCHES, HermesPatch, requiredPatches } from './hermesPatches';

export interface GitResult {
    code: number | null;
    output: string;
}

/** Runs one git command in a directory. Injected, so the rules are testable without a checkout. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

/**
 * The git to use.
 *
 * On Windows a PATH `git` can be the 46 KB trampoline that fails to re-exec itself, which is why
 * Hermes keeps `_locate_real_git` and prefers a real `git-core/git.exe`. The same candidates, the
 * same first-that-works rule; `git` itself when nothing better is found.
 */
export function gitCandidates(platform: NodeJS.Platform = process.platform): string[] {
    if (platform !== 'win32') {
        return ['git'];
    }
    return [
        'git',
        ...(['C:\\Program Files', 'C:\\Program Files (x86)'].flatMap(base =>
            ['clangarm64', 'mingw64', 'mingw32'].map(arch =>
                path.join(base, 'Git', arch, 'libexec', 'git-core', 'git.exe')))),
    ];
}

/** A runner that tries each candidate until one answers at all. */
export const runGit: GitRunner = async (args, cwd) => {
    let last: GitResult = { code: null, output: 'git not found' };
    for (const candidate of gitCandidates()) {
        const answer = await new Promise<GitResult | null>((resolve) => {
            let child: ReturnType<typeof spawn>;
            try {
                child = spawn(candidate, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            } catch {
                resolve(null);
                return;
            }
            let output = '';
            child.stdout?.on('data', chunk => { output += String(chunk); });
            child.stderr?.on('data', chunk => { output += String(chunk); });
            child.on('error', () => resolve(null));
            child.on('close', code => resolve({ code, output }));
        });
        if (answer) {
            if (answer.code === 0) {
                return answer;
            }
            last = answer;
            if (!/ENOENT|not recognized|not found/i.test(answer.output)) {
                return answer;
            }
        }
    }
    return last;
};

/** What one checkout holds, as far as the patch set is concerned. */
export type PatchState =
    | { kind: 'ok'; version: string; label: string; present: string[] }
    | { kind: 'missing'; version: string; label: string; applicable: string[]; reason: string }
    | { kind: 'wrong'; version: string; label: string; present: string[]; extra: string[]; missing: string[] }
    | { kind: 'unknown'; version: string; reason: string; present: string[] };

/** The path of one patch file inside this extension's patch folder. */
export function patchPath(patchDir: string, patch: HermesPatch): string {
    return path.join(patchDir, patch.file);
}

/**
 * Read the state. Read-only: `--check` and `--quiet` are decisions, not edits.
 *
 * ok       — exactly the required set is in the tree, nothing else is
 * missing  — the tree is clean and the required set applies
 * wrong    — a set other than the required one is in the tree (each of its patches reverses cleanly)
 * unknown  — anything else: other edits, a patch that neither applies nor reverses, no set for the
 *            version, a patch file that is not there, no git
 */
export async function readPatchState(options: {
    checkout: string;
    patchDir: string;
    version: string;
    run: GitRunner;
}): Promise<PatchState> {
    const { checkout, patchDir, version, run } = options;
    const required = requiredPatches(version);
    if (!required.length) {
        return {
            kind: 'unknown',
            version,
            reason: `no patch set is known for Hermes ${version || '(version not reported)'}`,
            present: [],
        };
    }
    if (!fs.existsSync(path.join(checkout, 'acp_adapter'))) {
        return { kind: 'unknown', version, reason: `no acp_adapter in ${checkout}`, present: [] };
    }
    const absent = required.filter(patch => !fs.existsSync(patchPath(patchDir, patch)));
    if (absent.length) {
        return {
            kind: 'unknown',
            version,
            reason: `the patch folder has no ${absent.map(patch => patch.id).join(', ')}`,
            present: [],
        };
    }

    const present: string[] = [];
    for (const patch of ALL_PATCHES) {
        const file = patchPath(patchDir, patch);
        if (!fs.existsSync(file)) {
            continue;
        }
        const answer = await run(['apply', '--reverse', '--check', file], checkout);
        if (answer.code === 0) {
            present.push(patch.id);
        }
    }

    const requiredIds = required.map(patch => patch.id);
    const extra = present.filter(id => !requiredIds.includes(id));
    const missing = requiredIds.filter(id => !present.includes(id));
    const label = requiredIds.join(' + ');

    if (!extra.length && !missing.length) {
        return { kind: 'ok', version, label, present };
    }
    if (extra.length) {
        return { kind: 'wrong', version, label, present, extra, missing };
    }

    const diff = await run(['diff', '--quiet', '--', 'acp_adapter'], checkout);
    if (diff.code !== 0) {
        return {
            kind: 'unknown',
            version,
            reason: 'acp_adapter has changes that are not one of our sets',
            present,
        };
    }
    for (const patch of required) {
        if (present.includes(patch.id)) {
            continue;
        }
        const check = await run(['apply', '--check', patchPath(patchDir, patch)], checkout);
        if (check.code !== 0) {
            return {
                kind: 'unknown',
                version,
                reason: `${patch.id} does not apply to this checkout: ${(check.output.trim().split(/\r?\n/).pop() ?? 'no output')}`,
                present,
            };
        }
    }
    return {
        kind: 'missing',
        version,
        label,
        applicable: missing,
        reason: `${label} is not applied and applies cleanly`,
    };
}

/**
 * Bring the checkout to the required set. Only ever called from the user's click.
 *
 * wrong   — reverse the extra patches, newest first (`0002` before `0001`), then apply what is missing
 * missing — apply the required patches in order
 * ok      — nothing
 * unknown — nothing; the caller shows what was found and the manual steps
 *
 * Returns the commands it ran and their output, so the output channel can carry the whole story.
 */
export async function fixPatchState(options: {
    checkout: string;
    patchDir: string;
    state: PatchState;
    run: GitRunner;
}): Promise<{ changed: boolean; log: string[] }> {
    const { checkout, patchDir, state, run } = options;
    const log: string[] = [];
    if (state.kind === 'unknown' || state.kind === 'ok') {
        return { changed: false, log: [`nothing done: ${state.kind}`] };
    }

    const byId = (id: string): HermesPatch | undefined => ALL_PATCHES.find(patch => patch.id === id);

    if (state.kind === 'wrong') {
        // Reverse newest first: 0002 depends on 0001 having been applied before it.
        const extras = [...state.extra].reverse();
        for (const id of extras) {
            const patch = byId(id);
            if (!patch) {
                continue;
            }
            const args = ['apply', '--reverse', patchPath(patchDir, patch)];
            log.push(`$ git ${args.join(' ')}`);
            const answer = await run(args, checkout);
            log.push(answer.output.trim() || `exit ${answer.code}`);
            if (answer.code !== 0) {
                return { changed: false, log: [...log, `stopped: ${id} could not be reversed`] };
            }
        }
    }

    for (const id of state.kind === 'wrong' ? state.missing : state.applicable) {
        const patch = byId(id);
        if (!patch) {
            continue;
        }
        const args = ['apply', '--3way', patchPath(patchDir, patch)];
        log.push(`$ git ${args.join(' ')}`);
        const answer = await run(args, checkout);
        log.push(answer.output.trim() || `exit ${answer.code}`);
        if (answer.code !== 0) {
            return { changed: false, log: [...log, `stopped: ${id} did not apply`] };
        }
    }
    return { changed: true, log };
}
