import * as fs from 'fs';
import { profileStatePathFor } from '../store/paths';

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
