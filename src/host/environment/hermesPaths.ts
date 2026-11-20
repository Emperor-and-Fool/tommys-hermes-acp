import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setting } from '../../shared/extensionId';

/**
 * What a Hermes home is resolved against: the platform, the environment and the user's home.
 *
 * All three are parameters, as Hermes' own `_platform_default_hermes_home(environ, user_home)` takes
 * them, because `%USERPROFILE%\.hermes` has to be testable on Linux.
 */
export interface HermesHomeOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    /** The user's home. Never a path from the environment: Hermes deliberately does not read `$HOME`. */
    home?: string;
}

/**
 * Expand a Hermes home the way Hermes does: `os.path.expanduser(os.path.expandvars(path))`
 * (hermes_constants.py:52-54).
 *
 * `~` is the user's home. `%VAR%` is expanded on Windows only, `$VAR` and `${VAR}` everywhere else,
 * because that is what `os.path.expandvars` does — and a variable it does not know is left as it was
 * written, not blanked.
 */
/** Windows paths are joined with Windows rules, whichever platform the test runs on. */
function joiner(platform: NodeJS.Platform): typeof path.posix {
    return platform === 'win32' ? path.win32 : path.posix;
}

export function expandHermesHome(raw: string, options: HermesHomeOptions = {}): string {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const home = options.home ?? os.homedir();
    const trimmed = (raw || '').trim();
    if (!trimmed) {
        return '';
    }
    const expanded = platform === 'win32'
        ? trimmed.replace(/%([^%]+)%/g, (match, name: string) => (name in env ? String(env[name]) : match))
        : trimmed.replace(/\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
            (match, braced: string | undefined, plain: string | undefined) => {
                const name = braced ?? plain ?? '';
                return name in env ? String(env[name]) : match;
            });
    if (expanded === '~') {
        return home;
    }
    if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
        return joiner(platform).join(home, expanded.slice(2));
    }
    return expanded;
}

/**
 * Hermes' home: `HERMES_HOME` when it names one, else the platform default with
 * `HERMES_DATA_DIR_SUFFIX` appended literally (`~/.hermes<suffix>`, `%LOCALAPPDATA%\hermes<suffix>`),
 * which is what `_platform_default_hermes_home` does (hermes_constants.py:57-64).
 */
export function resolveDefaultHermesHome(options: HermesHomeOptions = {}): string {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const home = options.home ?? os.homedir();
    const fromEnv = (env.HERMES_HOME?.trim() || '');
    if (fromEnv) {
        return expandHermesHome(fromEnv, { platform, env, home });
    }
    const suffix = env.HERMES_DATA_DIR_SUFFIX || '';
    if (platform === 'win32') {
        const localAppData = (env.LOCALAPPDATA?.trim() || '');
        const win = joiner('win32');
        const base = localAppData || win.join(home, 'AppData', 'Local');
        return win.join(base, `hermes${suffix}`);
    }
    return joiner(platform).join(home, `.hermes${suffix}`);
}

/**
 * The root of Hermes' data: the folder whose `profiles/` holds the profiles and whose own
 * `state.db` is the default profile's.
 *
 * Not simply `resolveDefaultHermesHome()`: Hermes points `HERMES_HOME` at the *profile's* own folder
 * for an agent it starts (this session runs with `HERMES_HOME=~/.hermes/profiles/dev-vsc`), and the
 * profile folders then sit beside it rather than inside it. The check is structural — a home inside
 * a `profiles/` folder is a profile, and its root is that folder's parent.
 */
export function resolveHermesRoot(): string {
    const home = resolveDefaultHermesHome();
    return path.basename(path.dirname(home)) === 'profiles' ? path.dirname(path.dirname(home)) : home;
}

/** The binaries inside `<home>/hermes-agent/venv`; on Windows each name also gets an extension. */
export function agentVenv(home: string, binary: string, windowsExtensions: string[] = ['exe', 'cmd']): string[] {
    const venv = path.join(home, 'hermes-agent', 'venv');
    if (process.platform === 'win32') {
        return windowsExtensions.map(ext => path.join(venv, 'Scripts', `${binary}.${ext}`));
    }
    return [path.join(venv, 'bin', binary)];
}

export function venvHermesCandidates(hermesHome: string): string[] {
    return agentVenv(hermesHome, 'hermes');
}

export function venvPythonCandidates(hermesHome: string): string[] {
    return agentVenv(hermesHome, 'python', ['exe']);
}

/** Ordered Hermes executable candidates for auto-detection. */
export function buildHermesExecutableCandidates(): string[] {
    const candidates = ['hermes'];
    const homes = new Set<string>([
        resolveDefaultHermesHome(),
        path.join(os.homedir(), '.hermes'),
    ]);
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
        homes.add(path.join(localAppData, 'hermes'));
    }
    for (const home of homes) {
        candidates.push(...venvHermesCandidates(home));
    }
    if (process.platform === 'win32') {
        candidates.push(path.join(os.homedir(), '.local', 'bin', 'hermes.exe'));
    } else {
        candidates.push(
            path.join(os.homedir(), '.local', 'bin', 'hermes'),
            '/usr/local/bin/hermes',
            '/opt/homebrew/bin/hermes',
        );
    }
    return [...new Set(candidates)];
}

export function collectHermesHomes(): string[] {
    const homes = new Set<string>([
        resolveDefaultHermesHome(),
        path.join(os.homedir(), '.hermes'),
    ]);
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
        homes.add(path.join(localAppData, 'hermes'));
    }
    const fromEnv = process.env.HERMES_HOME?.trim();
    if (fromEnv) {
        homes.add(expandHermesHome(fromEnv));
    }
    return [...homes];
}

export async function accessExecutable(filePath: string): Promise<boolean> {
    try {
        const mode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
        await fs.promises.access(filePath, mode);
        return true;
    } catch {
        return false;
    }
}

export function refreshWindowsPathFromRegistry(): string | undefined {
    if (process.platform !== 'win32') {
        return undefined;
    }
    try {
        const merged = execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                '[Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")',
            ],
            { encoding: 'utf8', timeout: 5000, windowsHide: true },
        ).trim();
        return merged || undefined;
    } catch {
        return undefined;
    }
}

export function normalizeExecutableKey(filePath: string): string {
    const normalized = path.normalize(filePath.trim());
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function hermesNotFoundMessage(): string {
    if (process.platform === 'win32') {
        const example = agentVenv(
            path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes'),
            'hermes',
        )[0];
        return (
            'Hermes not found. Install:\n' +
            '  iex (irm https://hermes-agent.nousresearch.com/install.ps1)\n\n' +
            `Or set ${setting('path')} in Settings (e.g. ${example})`
        );
    }
    return (
        'Hermes not found. Install:\n' +
        '  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
    );
}
