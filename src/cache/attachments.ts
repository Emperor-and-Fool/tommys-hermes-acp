/**
 * Attachments the pane keeps for itself: the bytes Hermes never stores.
 *
 * Content-addressed files beside the transcript, hashes recorded on the message, and a
 * sidecar index that maps a message's text back to the images it carried. Moved out of the
 * provider unchanged. The only thing it needs is the history directory, which is shared
 * across profiles and never changes after construction, so it is a constructor argument
 * rather than a host interface.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type { ChatMessage, StoredImageRef } from '../types/chat';

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

    hydrateImages(messages: ChatMessage[]): ChatMessage[] {
        const dir = path.join(this._historyDir, 'attachments');
        const used = new Set<string>();
        return messages.map(msg => {
            let refs = msg.imageRefs;
            if ((!refs || !refs.length) && msg.role === 'user') {
                refs = this.refsFromIndex(msg.text, used);
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

    private _loadIndex(): Array<{ hash: string; mimeType: string; key: string; markers: number; added: number }> {
        try {
            const parsed = JSON.parse(fs.readFileSync(this._indexPath(), 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    indexAttachments(refs: StoredImageRef[], text: string): void {
        if (!refs.length) return;
        try {
            fs.mkdirSync(path.dirname(this._indexPath()), { recursive: true });
            const entries = this._loadIndex();
            const key = attachmentKey(text);
            const markers = markerCount(text) || refs.length;
            for (const ref of refs) {
                if (entries.some(e => e.hash === ref.hash && e.key === key)) continue;
                entries.push({ hash: ref.hash, mimeType: ref.mimeType, key, markers, added: Date.now() });
            }
            fs.writeFileSync(this._indexPath(), JSON.stringify(entries.slice(-400), null, 2));
        } catch { /* the message still sends */ }
    }

    refsFromIndex(text: string, used: Set<string>, allowLoose = false): StoredImageRef[] {
        const entries = this._loadIndex();
        if (!entries.length) return [];
        const key = attachmentKey(text);
        const wanted = Math.max(1, markerCount(text));
        const taken: StoredImageRef[] = [];
        for (const entry of entries) {
            if (taken.length >= wanted) break;
            if (used.has(entry.hash) || entry.key !== key) continue;
            used.add(entry.hash);
            taken.push({ hash: entry.hash, mimeType: entry.mimeType });
        }
        if (taken.length) return taken;
        // Text drifted between send and replay: fall back to the oldest unused attachment. Only a
        // replay may do that — a restore shows history and must not guess.
        if (!allowLoose || !markerCount(text)) return [];
        const loose = entries.find(entry => !used.has(entry.hash));
        if (loose) {
            used.add(loose.hash);
            return [{ hash: loose.hash, mimeType: loose.mimeType }];
        }
        return [];
    }
}
