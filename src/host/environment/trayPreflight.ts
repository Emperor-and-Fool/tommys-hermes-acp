import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * What the desktop app needs before its installer can even open, checked on both platforms.
 *
 * Both platforms run the SAME sources (`extras/KDEdesktopGui`); what differs is the interpreter and
 * where the Qt bindings come from. Linux: `/usr/bin/python3` plus two apt packages. Windows: a venv
 * we own, at `%LOCALAPPDATA%\hermesdesktopgui\venv`, built from Hermes' own Python with Hermes' own
 * uv — several Python versions sit side by side under `~/.hermes/tools`, so a stale one can vanish in
 * an update, and a venv built on it dies with it.
 *
 * The installer itself imports PyQt6 at import time, so it cannot install PyQt6: nothing would
 * appear. That is why every check here runs before it is started, and why every failure is shown.
 */

/** The one place the versions are named. The wheels are pinned: WebEngine's API moves. */
export const PYQT6_VERSION = '6.12.1';
export const PYQT6_WEBENGINE_VERSION = '6.140.1';

/** Linux: the apt packages that provide exactly that (the distro's own builds). */
export const APT_PACKAGES = ['python3-pyqt6', 'python3-pyqt6.qtwebengine'];

/** One command's answer, as much of it as a decision needs. */
export interface RunResult {
    code: number | null;
    output: string;
}

/** Runs a command and collects its output. Injected, so the decisions are testable. */
export type Runner = (command: string, args: string[], timeoutMs?: number) => Promise<RunResult>;

/** The real runner: no shell, both streams, a timeout long enough for pip but not forever. */
export const runOnce: Runner = (command, args, timeoutMs = 900_000) => new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
        proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
        resolve({ code: null, output: error instanceof Error ? error.message : String(error) });
        return;
    }
    let output = '';
    let settled = false;
    const finish = (code: number | null): void => {
        if (!settled) {
            settled = true;
            resolve({ code, output });
        }
    };
    const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* already gone */ }
        finish(null);
    }, timeoutMs);
    proc.stdout?.on('data', chunk => { output += String(chunk); });
    proc.stderr?.on('data', chunk => { output += String(chunk); });
    proc.on('error', error => {
        clearTimeout(timer);
        output += ` ${error instanceof Error ? error.message : String(error)}`;
        finish(null);
    });
    proc.on('close', code => {
        clearTimeout(timer);
        finish(code);
    });
});

/** `import PyQt6.QtWebEngineWidgets` — the one import the app cannot start without. */
const PYQT_PROBE = ['-c', 'import PyQt6.QtWebEngineWidgets'];
/** The cheapest question that tells a working interpreter from a dead venv. */
const ALIVE_PROBE = ['-c', 'import sys'];

/**
 * Where the app and its venv live.
 *
 * Windows: `%LOCALAPPDATA%\hermesdesktopgui` — outside our data home on purpose (that home was
 * renamed to `.backup-<date>` on the test machine, and a login entry into a renamed folder is dead).
 * Linux: the installer's own `~/.local/share/hermes-desktopgui`, as its .deb layout has always been.
 * installer_gui.py computes the same two paths; keep them in step.
 */
export function appDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    if (platform === 'win32') {
        const local = (env.LOCALAPPDATA || '').trim() || path.join(env.USERPROFILE || '', 'AppData', 'Local');
        return path.join(local, 'hermesdesktopgui');
    }
    return path.join(env.HOME || os.homedir(), '.local', 'share', 'hermes-desktopgui');
}

/** The app's own copy, as the installer writes it. */
export function installedCopy(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    return path.join(appDir(platform, env), 'hermes_desktop_gui.py');
}

export function venvPython(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    return path.join(appDir(platform, env), 'venv', 'Scripts', 'python.exe');
}

/** The interpreter the installer window itself is started with, per platform. */
export function installerPython(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
    if (platform === 'win32') {
        return venvPython(platform, env);
    }
    return env.HERMES_DESKTOPGUI_PYTHON || '/usr/bin/python3';
}

/** Hermes' own tools, newest first: the python-<version> and uv-<version> folders under tools. */
export function hermesToolCandidates(
    kind: 'python' | 'uv',
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    const home = platform === 'win32'
        ? ((env.LOCALAPPDATA || '').trim() || path.join(env.USERPROFILE || '', 'AppData', 'Local'))
        : (env.HOME || os.homedir());
    const tools = platform === 'win32' ? path.join(home, 'hermes', 'tools') : path.join(home, '.hermes', 'tools');
    let entries: string[] = [];
    try {
        entries = fs.readdirSync(tools);
    } catch {
        return [];
    }
    const matching = entries
        .filter(name => name.startsWith(kind === 'python' ? 'python-' : 'uv-'))
        .map(name => path.join(tools, name))
        // Newest first by mtime: an update adds a newer one and may remove an older.
        .sort((left, right) => {
            try {
                return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
            } catch {
                return 0;
            }
        });
    return matching.map(dir => {
        if (kind === 'uv') {
            return platform === 'win32' ? path.join(dir, 'uv.exe') : path.join(dir, 'uv');
        }
        return platform === 'win32'
            ? path.join(dir, 'python.exe')
            : path.join(dir, 'bin', 'python3');
    });
}

/** What the Windows pre-flight decided to do, and why — the reason is what the log says. */
export interface VenvPlan {
    action: 'ready' | 'create' | 'recreate' | 'install';
    reason: string;
}

/**
 * Three questions, in order: does the interpreter start, does it import PyQt6, and if not — is the
 * venv missing, dead, or merely short of the wheels?
 */
export async function planWindowsVenv(
    run: Runner,
    python: string = venvPython(),
    basePython: string = hermesToolCandidates('python', 'win32')[0] ?? '',
): Promise<VenvPlan> {
    if (!fs.existsSync(python)) {
        return basePython
            ? { action: 'create', reason: `no venv at ${python}; it will be built from ${basePython}` }
            : { action: 'create', reason: `no venv at ${python}, and Hermes' Python was not found` };
    }
    const alive = await run(python, ALIVE_PROBE, 30_000);
    if (alive.code !== 0) {
        return basePython
            ? { action: 'recreate', reason: `the venv's interpreter does not start (${alive.output.trim().split(/\r?\n/).pop() ?? 'no output'}); it will be rebuilt` }
            : { action: 'recreate', reason: `the venv's interpreter does not start, and Hermes' Python was not found` };
    }
    const probe = await run(python, PYQT_PROBE, 120_000);
    if (probe.code !== 0) {
        return { action: 'install', reason: `PyQt6 is missing from ${python}; the wheels will be installed` };
    }
    return { action: 'ready', reason: `${python} starts and imports QtWebEngine` };
}

/** What one pre-flight step reported: the phase for the notification, and the full output for the log. */
export interface StepReport {
    running: (phase: string) => void;
    log: (line: string) => void;
}

/** The wheels, as one argv list, in the one place that names their versions. */
export function wheelArgs(python: string): string[] {
    return ['pip', 'install', '--python', python, `PyQt6==${PYQT6_VERSION}`, `PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`];
}

/** Build (or rebuild) the venv and install the wheels. uv when Hermes has it, pip otherwise. */
export async function buildWindowsVenv(
    run: Runner,
    report: StepReport,
    python: string = venvPython(),
    basePython: string = hermesToolCandidates('python', 'win32')[0] ?? '',
    uvPath: string = hermesToolCandidates('uv', 'win32')[0] ?? '',
): Promise<{ ok: boolean; message: string }> {
    if (!basePython) {
        return { ok: false, message: "Hermes' own Python was not found under %LOCALAPPDATA%\\hermes\\tools" };
    }
    report.running('creating the venv');
    const created = uvPath
        ? await run(uvPath, ['venv', python.replace(/[\\/]Scripts[\\/]python\.exe$/i, ''), '--python', basePython])
        : await run(basePython, ['-m', 'venv', python.replace(/[\\/]Scripts[\\/]python\.exe$/i, '')]);
    report.log(created.output.trim());
    if (created.code !== 0) {
        return { ok: false, message: `the venv could not be created: ${lastLine(created.output)}` };
    }
    report.running(`installing PyQt6 ${PYQT6_VERSION} and QtWebEngine`);
    const wheels = uvPath
        ? await run(uvPath, ['pip', 'install', '--python', python,
            `PyQt6==${PYQT6_VERSION}`, `PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`])
        : await pipInstallWheels(run, report, python);
    report.log(wheels.output.trim());
    if (wheels.code !== 0) {
        return { ok: false, message: `the wheels could not be installed: ${lastLine(wheels.output)}` };
    }
    const probe = await run(python, PYQT_PROBE, 120_000);
    return probe.code === 0
        ? { ok: true, message: `PyQt6 ${PYQT6_VERSION} is ready in ${python}` }
        : { ok: false, message: `PyQt6 still does not import: ${lastLine(probe.output)}` };
}

/**
 * pip, without uv. A Python 3.10 install ships pip 22.0.4, whose warnings and metadata handling are
 * older than the wheels; upgrading it first costs a second and removes a whole class of failure.
 */
async function pipInstallWheels(run: Runner, report: StepReport, python: string): Promise<RunResult> {
    const upgraded = await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], 300_000);
    report.log(`pip --upgrade: ${lastLine(upgraded.output)}`);
    return run(python, ['-m', 'pip', 'install',
        `PyQt6==${PYQT6_VERSION}`, `PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`]);
}

/** Install the wheels into a venv that already starts (its base Python is fine). */
export async function installWheels(
    run: Runner,
    report: StepReport,
    python: string = venvPython(),
    uvPath: string = hermesToolCandidates('uv', 'win32')[0] ?? '',
): Promise<{ ok: boolean; message: string }> {
    report.running(`installing PyQt6 ${PYQT6_VERSION} and QtWebEngine`);
    const wheels = uvPath
        ? await run(uvPath, ['pip', 'install', '--python', python,
            `PyQt6==${PYQT6_VERSION}`, `PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`])
        : await pipInstallWheels(run, report, python);
    report.log(wheels.output.trim());
    if (wheels.code !== 0) {
        return { ok: false, message: `the wheels could not be installed: ${lastLine(wheels.output)}` };
    }
    const probe = await run(python, PYQT_PROBE, 120_000);
    return probe.code === 0
        ? { ok: true, message: `PyQt6 ${PYQT6_VERSION} is ready in ${python}` }
        : { ok: false, message: `PyQt6 still does not import: ${lastLine(probe.output)}` };
}

/**
 * Linux: does `/usr/bin/python3` import QtWebEngine, and if not, install the two apt packages.
 *
 * All the user sees is the pkexec password prompt: apt's own progress is captured into the log.
 */
export async function ensureLinuxPyQt(
    run: Runner,
    report: StepReport,
    python: string = installerPython('linux'),
): Promise<{ ok: boolean; message: string; installed: boolean }> {
    const probe = await run(python, PYQT_PROBE, 120_000);
    if (probe.code === 0) {
        return { ok: true, message: 'PyQt6 and QtWebEngine are present', installed: false };
    }
    report.running('installing python3-pyqt6 and its WebEngine package (asks for your password)');
    const install = await run('pkexec', ['apt-get', 'install', '-y', ...APT_PACKAGES]);
    report.log(install.output.trim());
    if (install.code !== 0) {
        return { ok: false, message: `apt could not install the packages: ${lastLine(install.output)}`, installed: false };
    }
    const again = await run(python, PYQT_PROBE, 120_000);
    return again.code === 0
        ? { ok: true, message: 'PyQt6 and QtWebEngine were installed', installed: true }
        : { ok: false, message: `PyQt6 still does not import: ${lastLine(again.output)}`, installed: true };
}

function lastLine(output: string): string {
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    return lines[lines.length - 1] ?? 'no output';
}
