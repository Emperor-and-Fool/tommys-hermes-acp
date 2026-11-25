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
    | { kind: 'ok'; version: string; label: string; present: string[]; others: string[] }
    | { kind: 'missing'; version: string; label: string; applicable: string[]; reason: string; others: string[] }
    | { kind: 'wrong'; version: string; label: string; present: string[]; extra: string[]; missing: string[]; others: string[] }
    | { kind: 'unknown'; version: string; reason: string; present: string[]; others: string[] };

/**
 * The files one patch touches, read from the patch file's own headers.
 *
 * `git diff` writes `+++ b/<path>` per file, so the patch file is the authority on what it changes —
 * and the clean check has to be scoped to exactly those paths. An edit elsewhere in `acp_adapter/` is
 * somebody's business, not a reason to refuse.
 */
export function touchedFiles(patchDir: string, patches: readonly HermesPatch[]): string[] {
    const paths = new Set<string>();
    for (const patch of patches) {
        let text = '';
        try {
            text = fs.readFileSync(path.join(patchDir, patch.file), 'utf8');
        } catch {
            continue;
        }
        for (const match of text.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
            paths.add(match[1].trim());
        }
    }
    return [...paths].sort();
}

/** The paths `git status --porcelain` lists under acp_adapter, as the paths git would name. */
async function dirtyPaths(checkout: string, run: GitRunner): Promise<string[]> {
    const answer = await run(['status', '--porcelain', '--', 'acp_adapter'], checkout);
    if (answer.code !== 0) {
        return [];
    }
    return answer.output
        .split(/\r?\n/)
        .map(line => line.slice(3).trim())
        .filter(Boolean);
}

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
            others: [],
        };
    }
    if (!fs.existsSync(path.join(checkout, 'acp_adapter'))) {
        return { kind: 'unknown', version, reason: `no acp_adapter in ${checkout}`, present: [], others: [] };
    }
    const absent = required.filter(patch => !fs.existsSync(patchPath(patchDir, patch)));
    if (absent.length) {
        return {
            kind: 'unknown',
            version,
            reason: `the patch folder has no ${absent.map(patch => patch.id).join(', ')}`,
            present: [],
            others: [],
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

    const dirtyAll = await dirtyPaths(checkout, run);
    const othersAll = dirtyAll.filter(path => !touchedFiles(patchDir, ALL_PATCHES).includes(path));

    if (!extra.length && !missing.length) {
        return { kind: 'ok', version, label, present, others: othersAll };
    }
    if (extra.length) {
        return { kind: 'wrong', version, label, present, extra, missing, others: othersAll };
    }

    const ours = touchedFiles(patchDir, required);
    const clean = await run(['diff', '--quiet', '--', ...ours], checkout);
    const dirty = await dirtyPaths(checkout, run);
    const others = dirty.filter(path => !ours.includes(path));
    if (clean.code !== 0) {
        return {
            kind: 'unknown',
            version,
            reason: `our own files carry changes that are not the patch set: ${ours.join(', ')}`,
            present,
            others,
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
                others,
            };
        }
    }
    return {
        kind: 'missing',
        version,
        label,
        applicable: missing,
        reason: `${label} is not applied and applies cleanly`,
        others,
    };
}

/**
 * Bring the checkout to the required set. Only ever called from the user's click.
 *
 * The state it acts on is read here, not handed in: two windows can both hold a dialog opened before
 * the other one ran, and a stale picture would reverse a set that is already gone. The caller holds
 * the lock; this function only decides and acts on what the checkout says *now*.
 *
 * wrong   — reverse the extra patches, newest first (`0002` before `0001`), then apply what is missing
 * missing — apply the required patches in order
 * ok      — nothing, and it says so
 * unknown — nothing; the caller shows what was found and the manual steps
 *
 * `git apply` without `--3way` on purpose: `--3way` implies `--index`, which stages the result in
 * Hermes' index — a tree that reads `M ` in the status column afterwards.
 */
export async function fixPatchState(options: {
    checkout: string;
    patchDir: string;
    version: string;
    run: GitRunner;
}): Promise<{ changed: boolean; state: PatchState; log: string[] }> {
    const { checkout, patchDir, version, run } = options;
    const log: string[] = [];
    const before = await readPatchState({ checkout, patchDir, version, run });
    if (before.kind === 'unknown') {
        return { changed: false, state: before, log: [`nothing done: the state is unknown — ${before.reason}`] };
    }
    if (before.kind === 'ok') {
        return { changed: false, state: before, log: [`nothing done: ${before.label} is already in place`] };
    }

    const byId = (id: string): HermesPatch | undefined => ALL_PATCHES.find(patch => patch.id === id);

    if (before.kind === 'wrong') {
        // Reverse newest first: 0002 depends on 0001 having been applied before it.
        for (const id of [...before.extra].reverse()) {
            const patch = byId(id);
            if (!patch) {
                continue;
            }
            const args = ['apply', '--reverse', patchPath(patchDir, patch)];
            log.push(`$ git ${args.join(' ')}`);
            const answer = await run(args, checkout);
            log.push(answer.output.trim() || `exit ${answer.code}`);
            if (answer.code !== 0) {
                return { changed: false, state: await readPatchState({ checkout, patchDir, version, run }),
                    log: [...log, `stopped: ${id} could not be reversed`] };
            }
        }
    }

    for (const id of before.kind === 'wrong' ? before.missing : before.applicable) {
        const patch = byId(id);
        if (!patch) {
            continue;
        }
        const args = ['apply', patchPath(patchDir, patch)];
        log.push(`$ git ${args.join(' ')}`);
        const answer = await run(args, checkout);
        log.push(answer.output.trim() || `exit ${answer.code}`);
        if (answer.code !== 0) {
            return { changed: false, state: await readPatchState({ checkout, patchDir, version, run }),
                log: [...log, `stopped: ${id} did not apply`] };
        }
    }
    return { changed: true, state: await readPatchState({ checkout, patchDir, version, run }), log };
}
