import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Where the extension keeps its data.
 *
 * Deliberately not `context.globalStorageUri`: that folder lives inside the editor's user-data
 * directory, so uninstalling the extension, resetting a profile or starting a fresh editor version
 * can take the sessions, projects and attachments with it. Each platform gets the user's own
 * location for application data, and the extension id keeps the primary and the secondant apart:
 *
 *   Windows  %LOCALAPPDATA% (not Roaming: this state belongs to the machine)
 *   macOS    ~/Library/Application Support
 *   Linux    $XDG_DATA_HOME when it is absolute, else ~/.local/share
 */
export function dataHomeFor(extensionId: string): string {
    const home = os.homedir();
    const xdg = (process.env.XDG_DATA_HOME || '').trim();
    let base: string;
    if (process.platform === 'win32') {
        base = (process.env.LOCALAPPDATA || '').trim() || path.join(home, 'AppData', 'Local');
    } else if (process.platform === 'darwin') {
        base = path.join(home, 'Library', 'Application Support');
    } else {
        base = path.isAbsolute(xdg) ? xdg : path.join(home, '.local', 'share');
    }
    return path.join(base, extensionId.toLowerCase());
}

export interface ProfileState {
    modelId?: string;
    modelLabel?: string;
}

/** Stable filesystem key for a profile / agent display name. */
export function sanitizeProfileScopeKey(name: string, fallback = '__default__'): string {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        return fallback;
    }
    return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || fallback;
}

export function profileDir(historyDir: string, scopeKey: string): string {
    const dir = path.join(historyDir, 'profiles', scopeKey);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function sessionsPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'sessions.json');
}

export function activeSessionPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'active-session.txt');
}

/**
 * The workspace registry, above the profiles.
 *
 * The one path helper that takes no scope key: a workspace is the same fact for every profile
 * that runs in that window, and the primary and the secondant do not share one.
 */
export function workspacesPathFor(historyDir: string): string {
    return path.join(historyDir, 'workspaces.json');
}

export function profileStatePathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'profile-state.json');
}

export function loadProfileState(historyDir: string, scopeKey: string): ProfileState {
    try {
        const p = profileStatePathFor(historyDir, scopeKey);
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProfileState;
        }
    } catch { /* ignore */ }
    return {};
}

export function saveProfileState(historyDir: string, scopeKey: string, state: ProfileState): void {
    try {
        fs.writeFileSync(profileStatePathFor(historyDir, scopeKey), JSON.stringify(state, null, 2));
    } catch { /* ignore */ }
}

/** Move legacy global session files into the default profile scope once. */
export function migrateLegacySessionStorage(historyDir: string, defaultScopeKey: string): void {
    const legacySessions = path.join(historyDir, 'sessions.json');
    if (!fs.existsSync(legacySessions)) {
        return;
    }
    const targetSessions = sessionsPathFor(historyDir, defaultScopeKey);
    if (fs.existsSync(targetSessions)) {
        return;
    }
    profileDir(historyDir, defaultScopeKey);
    fs.renameSync(legacySessions, targetSessions);
    const legacyActive = path.join(historyDir, 'active-session.txt');
    if (fs.existsSync(legacyActive)) {
        fs.renameSync(legacyActive, activeSessionPathFor(historyDir, defaultScopeKey));
    }
}
