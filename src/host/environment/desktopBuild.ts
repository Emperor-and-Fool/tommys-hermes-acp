import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { resolveHermesRoot } from './hermesPaths';

/**
 * Hermes Desktop on this machine: whether one exists, and the one command that makes one.
 *
 * A CLI install has no Desktop until someone runs `hermes desktop`; the build lands in the checkout,
 * under `apps/desktop/release/`. `--build-only` is the same build `hermes update` runs and it does
 * not launch anything, which is exactly what an unattended first run wants (H2a's named setup step,
 * decided by SKDJ on 2026-11-23).
 *
 * Read-only apart from that command: nothing here writes a Hermes file, and the artifact is the
 * test — Hermes' own build ends by verifying the executable exists ("a silent 'built nothing' can't
 * slip past", `hermes_cli/main_desktop.py`), and so does this.
 */

/** What this machine has: the checkout, whether it is a source install, and the build it holds. */
export interface DesktopPresence {
    /** The Hermes checkout holding the Desktop sources; null when Hermes is not installed from one. */
    checkout: string | null;
    /** True when that checkout carries `.git`: the only install a build can be made in. */
    source: boolean;
    /** The packaged Desktop executable, when one is there. */
    build: string | null;
    /**
     * Whether Hermes' documented build stamp is there. Evidence only, never the test: no Hermes
     * version this extension ships patches for writes `desktop-build-stamp.json` (the name appears
     * in `gui_uninstall.py`, two tests and the docs, nowhere that writes it), so requiring it would
     * mean "no build" on every start — a build loop.
     */
    stamp: boolean;
}

/** How long one build may run before it is killed. A first build installs Node deps and Electron. */
export const DESKTOP_BUILD_TIMEOUT_MS = 45 * 60 * 1000;

/** The arguments of the build, in one place, so a test can read the argv without spawning. */
export function desktopBuildArgs(): string[] {
    return ['desktop', '--build-only'];
}

/**
 * The checkout Hermes runs from, when it is a source install.
 *
 * `resolveHermesRoot()` is the home (`~/.hermes`, `%LOCALAPPDATA%\hermes`), and a source checkout
 * sits in it as `hermes-agent` — the blessed root Hermes' own update path uses. The home itself is
 * tried second, for an install that is one.
 */
export function findHermesSourceCheckout(root: string = resolveHermesRoot()): string | null {
    for (const candidate of [path.join(root, 'hermes-agent'), root]) {
        if (fs.existsSync(path.join(candidate, 'apps', 'desktop', 'package.json'))
            && fs.existsSync(path.join(candidate, '.git'))) {
            return candidate;
        }
    }
    return null;
}

/**
 * Where the packaged app sits, per Hermes' own platform table.
 *
 * Mirrors `_desktop_packaged_executable_in` (`hermes_cli/main_desktop.py`: win-unpacked, then the
 * ia32/arm64 variants; linux-unpacked and linux-arm64-unpacked, `hermes` or `Hermes`; the mac
 * bundle under any `mac*` folder). One table, so this and `hermes desktop` can never disagree about
 * whether an app is there.
 */
export function desktopExecutableCandidates(releaseDir: string, platform: NodeJS.Platform = process.platform): string[] {
    if (platform === 'win32') {
        return ['win-unpacked', 'win-ia32-unpacked', 'win-arm64-unpacked']
            .map(dir => path.join(releaseDir, dir, 'Hermes.exe'));
    }
    if (platform === 'darwin') {
        try {
            return fs.readdirSync(releaseDir)
                .filter(name => name.startsWith('mac'))
                .map(name => path.join(releaseDir, name, 'Hermes.app', 'Contents', 'MacOS', 'Hermes'));
        } catch {
            return [];
        }
    }
    return ['linux-unpacked', 'linux-arm64-unpacked']
        .flatMap(dir => ['hermes', 'Hermes'].map(name => path.join(releaseDir, dir, name)));
}

/** The newest packaged app in a checkout, or null. Hermes picks by mtime; so does this. */
export function findDesktopBuild(checkout: string, platform: NodeJS.Platform = process.platform): string | null {
    const release = path.join(checkout, 'apps', 'desktop', 'release');
    const existing = desktopExecutableCandidates(release, platform).filter(candidate => {
        try {
            return fs.statSync(candidate).isFile();
        } catch {
            return false;
        }
    });
    if (existing.length === 0) {
        return null;
    }
    return existing.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
}

export function desktopPresence(
    platform: NodeJS.Platform = process.platform,
    root: string = resolveHermesRoot(),
): DesktopPresence {
    const checkout = findHermesSourceCheckout(root);
    return {
        checkout,
        source: checkout !== null,
        build: checkout === null ? null : findDesktopBuild(checkout, platform),
        stamp: fs.existsSync(path.join(root, 'desktop-build-stamp.json')),
    };
}

/** How the one build ended. */
export interface DesktopBuildResult {
    /** Hermes exited 0 and the app is on disk. */
    ok: boolean;
    /** Its exit code; null when it never ran (no executable, spawn error, timeout). */
    code: number | null;
    /** The artifact read back from the checkout, so "ok" is never Hermes' word alone. */
    build: string | null;
    /** The last lines it printed, for the failure notice. */
    tail: string[];
    /** One line saying how it ended: Hermes' last word, or why it never ran. */
    message: string;
}

/** Lines kept for a failure notice: enough for the cause, not a log file. */
const TAIL_LINES = 40;

/**
 * Run the build and answer how it ended.
 *
 * stdin is closed, so nothing can wait for an answer that will never come; the window is hidden on
 * Windows for the same reason a CLI in a build step is; and nothing is inherited from our own stdio.
 * The output goes to the caller line by line (our log, and the notification's phase).
 */
export function runDesktopBuild(
    executable: string,
    checkout: string,
    onLine: (line: string) => void = () => {},
    platform: NodeJS.Platform = process.platform,
): Promise<DesktopBuildResult> {
    return new Promise((resolve) => {
        const tail: string[] = [];
        let settled = false;
        const finish = (result: DesktopBuildResult): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn(executable, desktopBuildArgs(), {
                cwd: checkout,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: platform === 'win32',
                windowsHide: true,
            });
        } catch (error) {
            finish({ ok: false, code: null, build: null, tail, message: messageOf(error) });
            return;
        }
        const take = (chunk: Buffer | string): void => {
            for (const raw of String(chunk).split(/\r?\n/)) {
                const line = raw.trim();
                if (!line) {
                    continue;
                }
                tail.push(line);
                if (tail.length > TAIL_LINES) {
                    tail.shift();
                }
                onLine(line);
            }
        };
        proc.stdout?.on('data', take);
        proc.stderr?.on('data', take);
        const timer = setTimeout(() => {
            finish({
                ok: false,
                code: null,
                build: findDesktopBuild(checkout, platform),
                tail,
                message: `the build did not finish within ${Math.round(DESKTOP_BUILD_TIMEOUT_MS / 60000)} minutes`,
            });
            try {
                proc.kill();
            } catch {
                // Already gone.
            }
        }, DESKTOP_BUILD_TIMEOUT_MS);
        proc.on('error', error => {
            clearTimeout(timer);
            finish({ ok: false, code: null, build: null, tail, message: messageOf(error) });
        });
        proc.on('close', code => {
            clearTimeout(timer);
            const build = findDesktopBuild(checkout, platform);
            // Exit 2 is Hermes' own build lock: another update or build holds it right now.
            const message = code === 0
                ? (build ?? 'Hermes exited 0 but no packaged app is on disk')
                : `exit ${code}${code === 2 ? ' (Hermes says another build is running)' : ''}`;
            finish({ ok: code === 0 && build !== null, code, build, tail, message });
        });
    });
}

/** Resolve what the build needs, then run it. One call for the caller that has only the executable. */
export function buildDesktop(
    executable: string | undefined,
    report: (line: string) => void,
    platform: NodeJS.Platform = process.platform,
): Promise<DesktopBuildResult> {
    if (!executable) {
        return Promise.resolve({
            ok: false, code: null, build: null, tail: [], message: 'no Hermes executable was found',
        });
    }
    const presence = desktopPresence(platform);
    if (!presence.checkout) {
        return Promise.resolve({
            ok: false, code: null, build: null, tail: [],
            message: 'Hermes is not installed from a source checkout, so it has no Desktop to build',
        });
    }
    return runDesktopBuild(executable, presence.checkout, report, platform);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
