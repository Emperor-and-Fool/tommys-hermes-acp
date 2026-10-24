import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CATALOG_LIMIT, SessionStore, TRANSCRIPT_LIMIT } from '../../chat/session/store';
import type { ChatMessage, SessionInfo } from '../../chat/HermesChatProvider';

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
}

function record(i: number): SessionInfo {
    return { id: `s${i}`, title: `t${i}`, createdAt: i, updatedAt: i } as SessionInfo;
}

function message(i: number): ChatMessage {
    return { role: i % 2 ? 'assistant' : 'user', text: `m${i}`, timestamp: i };
}

describe('SessionStore', () => {
    it('round-trips a catalog, keeping the cap', () => {
        const dir = tempDir();
        const store = new SessionStore(dir, 'dev');
        const many = Array.from({ length: CATALOG_LIMIT + 5 }, (_, i) => record(i));
        assert.strictEqual(store.writeCatalog(many), true);
        const read = store.readCatalog();
        assert.strictEqual(read.length, CATALOG_LIMIT);
        assert.strictEqual(read[0].id, 's0');
    });

    it('keeps the last 100 messages on a live write, and everything on a replay write', () => {
        const dir = tempDir();
        const store = new SessionStore(dir, 'dev');
        const many = Array.from({ length: TRANSCRIPT_LIMIT + 20 }, (_, i) => message(i));

        store.writeMessages('abc', many);
        const live = store.readMessages('abc');
        assert.strictEqual(live.length, TRANSCRIPT_LIMIT);
        assert.strictEqual(live[live.length - 1].text, `m${TRANSCRIPT_LIMIT + 19}`);

        store.writeReplayedMessages('abc', many);
        assert.strictEqual(store.readMessages('abc').length, TRANSCRIPT_LIMIT + 20);
    });

    it('answers with an empty list where nothing was written, and never throws', () => {
        const store = new SessionStore(path.join(tempDir(), 'missing'), 'nobody');
        assert.deepStrictEqual(store.readCatalog(), []);
        assert.deepStrictEqual(store.readMessages('nope'), []);
        assert.strictEqual(store.readActiveId(), null);
    });

    it('remembers the active id per scope', () => {
        const dir = tempDir();
        const store = new SessionStore(dir, 'dev');
        store.writeActiveId('xyz');
        assert.strictEqual(store.readActiveId(), 'xyz');
        store.setScope('other');
        assert.strictEqual(store.readActiveId(), null);
        assert.notStrictEqual(store.catalogPath, path.join(dir, 'sessions.json'));
    });
});
