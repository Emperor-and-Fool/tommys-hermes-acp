import * as fs from 'fs';
import { profileStatePathFor } from '../store/paths';

export interface ProfileState {
    modelId?: string;
    modelLabel?: string;
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
