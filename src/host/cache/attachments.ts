/**
 * Attachments the pane keeps for itself: the bytes Hermes never stores.
 *
 * Content-addressed files beside the transcript, hashes recorded on the message, and a sidecar
 * index that maps a message's text back to the images it carried. A text key is only unique
 * inside one conversation, so every entry names the session and profile it belongs to.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type { ChatMessage, StoredImageRef } from '../../shared/chat';

export function attachmentKey(text: string): string {
    return String(text || '')
        .replace(/\[(?:screenshot|image)\]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function markerCount(text: string): number {
    return (String(text || '').match(/\[(?:screenshot|image)\]/gi) || []).length;
}

/** The conversation an attachment belongs to: one Hermes session, in one profile. */
export interface AttachmentScope {
    sessionId: string;
    profile: string;
}

interface IndexEntry {
    hash: string;
    mimeType: string;
    key: string;
    markers: number;
    added: number;
    /** Absent on entries written before the index was scoped: they match no conversation now. */
    sessionId?: string;
    profile?: string;
}

export class AttachmentStore {
    constructor(private _historyDir: string) {}

    storeImages(images: Array<{ mimeType?: string; data?: string }>): StoredImageRef[] {
        const dir = path.join(this._historyDir, 'attachments');
        const refs: StoredImageRef[] = [];
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            return refs;
        }
        for (const img of images) {
            if (!img || !img.data) continue;
            const hash = createHash('sha256').update(img.data).digest('hex').slice(0, 32);
            const mimeType = img.mimeType || 'image/png';
            const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
            try {
                const file = path.join(dir, `${hash}.${ext}`);
                if (!fs.existsSync(file)) {
                    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
                }
                refs.push({ hash, mimeType });
            } catch { /* the message still sends without the local copy */ }
        }
        return refs;
    }

    hydrateImages(scope: AttachmentScope, messages: ChatMessage[]): ChatMessage[] {
        const dir = path.join(this._historyDir, 'attachments');
        const used = new Set<string>();
        return messages.map(msg => {
            let refs = msg.imageRefs;
            if ((!refs || !refs.length) && msg.role === 'user') {
                refs = this.refsFromIndex(scope, msg.text, used);
            }
            if (!refs || !refs.length) return msg;
            const images = refs.map(ref => {
                const ext = ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType === 'image/webp' ? 'webp' : 'png';
                try {
                    const buf = fs.readFileSync(path.join(dir, `${ref.hash}.${ext}`));
                    return { mimeType: ref.mimeType, data: buf.toString('base64') };
                } catch {
                    return null;
                }
            }).filter(Boolean) as Array<{ mimeType: string; data: string }>;
            return { ...msg, images } as ChatMessage;
        });
    }

    private _indexPath(): string {
        return path.join(this._historyDir, 'attachments', 'index.json');
    }

    private _loadIndex(): IndexEntry[] {
        try {
            const parsed = JSON.parse(fs.readFileSync(this._indexPath(), 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    indexAttachments(scope: AttachmentScope, refs: StoredImageRef[], text: string): void {
        if (!refs.length) return;
        try {
            fs.mkdirSync(path.dirname(this._indexPath()), { recursive: true });
            const entries = this._loadIndex();
            const key = attachmentKey(text);
            const markers = markerCount(text) || refs.length;
            for (const ref of refs) {
                const known = entries.some(e =>
                    e.hash === ref.hash && e.key === key &&
                    e.sessionId === scope.sessionId && e.profile === scope.profile
                );
                if (known) continue;
                entries.push({
                    hash: ref.hash,
                    mimeType: ref.mimeType,
                    key,
                    markers,
                    added: Date.now(),
                    sessionId: scope.sessionId,
                    profile: scope.profile,
                });
            }
            fs.writeFileSync(this._indexPath(), JSON.stringify(entries.slice(-400), null, 2));
        } catch { /* the message still sends */ }
    }

    refsFromIndex(scope: AttachmentScope, text: string, used: Set<string>, allowLoose = false): StoredImageRef[] {
        const entries = this._loadIndex();
        if (!entries.length) return [];
        const inScope = (entry: IndexEntry): boolean =>
            entry.sessionId === scope.sessionId && entry.profile === scope.profile;
        const key = attachmentKey(text);
        const wanted = Math.max(1, markerCount(text));
        const taken: StoredImageRef[] = [];
        for (const entry of entries) {
            if (taken.length >= wanted) break;
            if (used.has(entry.hash) || entry.key !== key || !inScope(entry)) continue;
            used.add(entry.hash);
            taken.push({ hash: entry.hash, mimeType: entry.mimeType });
        }
        if (taken.length) return taken;
        // Text drifted between send and replay: fall back to the oldest unused attachment in this
        // conversation. Only a replay may do that — a restore shows history and must not guess.
        if (!allowLoose || !markerCount(text)) return [];
        const loose = entries.find(entry => !used.has(entry.hash) && inScope(entry));
        if (loose) {
            used.add(loose.hash);
            return [{ hash: loose.hash, mimeType: loose.mimeType }];
        }
        return [];
    }
}
