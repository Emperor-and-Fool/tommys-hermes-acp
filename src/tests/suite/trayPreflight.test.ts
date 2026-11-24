/**
 * The pre-flight: what is decided before the installer window is even started.
 *
 * The installer imports PyQt6 at import time, so it cannot install PyQt6 — on a machine without it
 * the user sees nothing at all. These tests pin the decisions without running apt, pkexec, uv or pip:
 * every command goes through an injected runner that records what would have been asked.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'mocha';
import assert from 'assert';
import {
    APT_PACKAGES,
    PYQT6_VERSION,
    PYQT6_WEBENGINE_VERSION,
    buildWindowsVenv,
    ensureLinuxPyQt,
    installerPython,
    installedCopy,
    planWindowsVenv,
    venvPython,
    wheelArgs,
    type RunResult,
} from '../../host/environment/trayPreflight';

interface Asked {
    command: string;
    args: string[];
}

/** A runner that answers by rule and records every question. */
function scripted(answers: Array<{ match: (command: string, args: string[]) => boolean; result: RunResult }>): {
    run: (command: string, args: string[]) => Promise<RunResult>;
    asked: Asked[];
} {
    const asked: Asked[] = [];
    return {
        asked,
        run: async (command, args) => {
            asked.push({ command, args });
            const hit = answers.find(answer => answer.match(command, args));
            return hit ? hit.result : { code: 1, output: `unexpected: ${command} ${args.join(' ')}` };
        },
    };
}

const probe = (ok: boolean) => (_command: string, args: string[]) =>
    args.some(arg => String(arg).includes('PyQt6.QtWebEngineWidgets')) || (ok && args.includes('import sys'));

const quiet = { running: (): void => undefined, log: (): void => undefined };

describe('the pre-flight on Linux', () => {
    it('does nothing when the system Python already imports QtWebEngine', async () => {
        const { run, asked } = scripted([{ match: probe(true), result: { code: 0, output: '' } }]);
        const answer = await ensureLinuxPyQt(run, quiet);
        assert.strictEqual(answer.ok, true);
        assert.strictEqual(answer.installed, false);
        assert.deepStrictEqual(asked.map(entry => entry.command), ['/usr/bin/python3'], 'no pkexec, no apt');
    });

    it('installs the two apt packages through pkexec when the import fails', async () => {
        const asked: Asked[] = [];
        let probes = 0;
        const run = async (command: string, args: string[]): Promise<RunResult> => {
            asked.push({ command, args });
            if (command === 'pkexec') {
                return { code: 0, output: 'Setting up…' };
            }
            probes += 1;
            // The first probe is the one that decides; after apt it must succeed.
            return probes === 1
                ? { code: 1, output: "ModuleNotFoundError: No module named 'PyQt6'" }
                : { code: 0, output: '' };
        };
        const answer = await ensureLinuxPyQt(run, quiet);
        assert.strictEqual(answer.ok, true);
        assert.strictEqual(answer.installed, true);
        const pkexec = asked.find(entry => entry.command === 'pkexec');
        assert.deepStrictEqual(pkexec?.args, ['apt-get', 'install', '-y', ...APT_PACKAGES]);
        assert.deepStrictEqual(APT_PACKAGES, ['python3-pyqt6', 'python3-pyqt6.qtwebengine']);
    });

    it('says so when apt fails, with the last line of its output', async () => {
        const { run } = scripted([
            { match: probe(false), result: { code: 1, output: "ModuleNotFoundError: No module named 'PyQt6'" } },
            { match: (_command, args) => args.includes('import PyQt6.QtWebEngineWidgets'), result: { code: 1, output: '' } },
            { match: (command) => command === 'pkexec', result: { code: 1, output: 'E: Unable to locate package python3-pyqt6\nE: Sub-process error' } },
        ]);
        const answer = await ensureLinuxPyQt(run, quiet);
        assert.strictEqual(answer.ok, false);
        assert.ok(answer.message.includes('E: Sub-process error'), answer.message);
    });
});

describe('the pre-flight on Windows', () => {
    const dir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'venv-plan-'));
    const pythonIn = (root: string): string => path.join(root, 'venv', 'Scripts', 'python.exe');

    it('creates the venv when there is none, from Hermes\' Python with uv', async () => {
        const root = dir();
        const python = pythonIn(root);
        const asked: string[][] = [];
        const run = async (command: string, args: string[]): Promise<RunResult> => {
            asked.push([command, ...args]);
            if (command === 'C:\\tools\\uv.exe' && args[0] === 'venv') {
                return { code: 0, output: 'Using CPython 3.14.9' };
            }
            if (args.some(arg => arg.includes('PyQt6.QtWebEngineWidgets'))) {
                return { code: 0, output: '' };
            }
            return { code: 0, output: '' };
        };
        const plan = await planWindowsVenv(run, python, 'C:\\hermes\\python.exe');
        assert.strictEqual(plan.action, 'create');
        assert.ok(plan.reason.includes('no venv'), plan.reason);

        const built = await buildWindowsVenv(run, quiet, python, 'C:\\hermes\\python.exe', 'C:\\tools\\uv.exe');
        assert.strictEqual(built.ok, true, built.message);
        const venv = asked.find(call => call.includes('venv'));
        assert.deepStrictEqual(venv, ['C:\\tools\\uv.exe', 'venv', path.join(root, 'venv'), '--python', 'C:\\hermes\\python.exe']);
        const wheels = asked.find(call => call.includes(`PyQt6==${PYQT6_VERSION}`));
        assert.ok(wheels, 'the wheels are asked for');
        assert.ok(wheels?.includes(`PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`), String(wheels));
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('upgrades pip before the wheels when Hermes has no uv', async () => {
        const root = dir();
        const python = pythonIn(root);
        const asked: string[][] = [];
        const run = async (command: string, args: string[]): Promise<RunResult> => {
            asked.push([command, ...args]);
            return { code: 0, output: '' };
        };
        const built = await buildWindowsVenv(run, quiet, python, 'C:\\hermes\\python.exe', '');
        assert.strictEqual(built.ok, true, built.message);
        const venv = asked.find(call => call.includes('venv'));
        assert.deepStrictEqual(venv, ['C:\\hermes\\python.exe', '-m', 'venv', path.join(root, 'venv')]);
        const upgrade = asked.findIndex(call => call.includes('--upgrade'));
        const wheels = asked.findIndex(call => call.includes(`PyQt6==${PYQT6_VERSION}`));
        assert.ok(upgrade >= 0, 'pip is upgraded first');
        assert.ok(wheels > upgrade, `upgrade (${upgrade}) comes before the wheels (${wheels})`);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('rebuilds a venv whose interpreter no longer starts', async () => {
        const root = dir();
        const python = pythonIn(root);
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, '');
        const { run } = scripted([{ match: () => true, result: { code: 1, output: 'Fatal Python error: init_import_site' } }]);
        const plan = await planWindowsVenv(run, python, 'C:\\hermes\\python.exe');
        assert.strictEqual(plan.action, 'recreate');
        assert.ok(plan.reason.includes('does not start'), plan.reason);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('installs only the wheels into a venv that starts but has no PyQt6', async () => {
        const root = dir();
        const python = pythonIn(root);
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, '');
        const { run } = scripted([
            { match: (_command, args) => args.length === 2 && args[0] === '-c' && args[1].includes('import sys'), result: { code: 0, output: '' } },
            { match: (_command, args) => args.some(arg => arg.includes('PyQt6.QtWebEngineWidgets')), result: { code: 1, output: "No module named 'PyQt6'" } },
        ]);
        const plan = await planWindowsVenv(run, python, 'C:\\hermes\\python.exe');
        assert.strictEqual(plan.action, 'install');
        assert.ok(plan.reason.includes('PyQt6 is missing'), plan.reason);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('does nothing when the venv is ready', async () => {
        const root = dir();
        const python = pythonIn(root);
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, '');
        const { run, asked } = scripted([{ match: () => true, result: { code: 0, output: '' } }]);
        const plan = await planWindowsVenv(run, python, 'C:\\hermes\\python.exe');
        assert.strictEqual(plan.action, 'ready');
        assert.deepStrictEqual(asked.map(entry => entry.command), [python, python], 'two probes, nothing installed');
        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe('where the app lives', () => {
    it('is outside our data home, and the same two paths the installer computes', () => {
        assert.strictEqual(venvPython('win32', { LOCALAPPDATA: 'C:\\Users\\SKDJ\\AppData\\Local' }),
            path.join('C:\\Users\\SKDJ\\AppData\\Local', 'hermesdesktopgui', 'venv', 'Scripts', 'python.exe'));
        assert.strictEqual(installedCopy('win32', { LOCALAPPDATA: 'C:\\Users\\SKDJ\\AppData\\Local' }),
            path.join('C:\\Users\\SKDJ\\AppData\\Local', 'hermesdesktopgui', 'hermes_desktop_gui.py'));
        assert.strictEqual(installedCopy('linux', { HOME: '/home/skdj' }),
            path.join('/home/skdj', '.local', 'share', 'hermes-desktopgui', 'hermes_desktop_gui.py'));
    });

    it('starts the installer window with the interpreter that has PyQt6', () => {
        assert.strictEqual(installerPython('linux', {}), '/usr/bin/python3');
        assert.strictEqual(installerPython('win32', { LOCALAPPDATA: 'C:\\L' }),
            path.join('C:\\L', 'hermesdesktopgui', 'venv', 'Scripts', 'python.exe'));
    });

    it('names the pinned versions in one function only', () => {
        assert.deepStrictEqual(wheelArgs('p.exe'), ['pip', 'install', '--python', 'p.exe',
            `PyQt6==${PYQT6_VERSION}`, `PyQt6-WebEngine==${PYQT6_WEBENGINE_VERSION}`]);
        assert.strictEqual(PYQT6_VERSION, '6.12.1');
    });
});
