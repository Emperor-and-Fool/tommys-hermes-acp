import * as fs from 'fs';
import { profileStatePathFor } from '../store/paths';

export interface ProfileState {
    modelId?: string;
    modelLabel?: string;
}

/** A filesystem key for a name that is not a Hermes profile (a configured agent's display name). */
export function sanitizeProfileScopeKey(name: string, fallback = '__default__'): string {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        return fallback;
    }
    return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || fallback;
}

export function loadProfileState(historyDir: string, sessionProfileId: string): ProfileState {
    try {
        const p = profileStatePathFor(historyDir, sessionProfileId);
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProfileState;
        }
    } catch { /* ignore */ }
    return {};
}

export function saveProfileState(historyDir: string, sessionProfileId: string, state: ProfileState): void {
    try {
        fs.writeFileSync(profileStatePathFor(historyDir, sessionProfileId), JSON.stringify(state, null, 2));
    } catch { /* ignore */ }
}
