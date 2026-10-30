import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentStore } from '../../host/cache/attachments';

const image = (seed: string) => ({
    mimeType: 'image/png',
    data: Buffer.from(seed).toString('base64'),
});

const scope = (sessionId: string, profile = 'work') => ({ sessionId, profile });

describe('attachments belong to one conversation', () => {
    let dir: string;
    let store: AttachmentStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-'));
        store = new AttachmentStore(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('gives a text-identical message in another session its own picture', () => {
        const [first] = store.storeImages([image('one')]);
        const [second] = store.storeImages([image('two')]);
        store.indexAttachments(scope('s1'), [first], 'look [image]');
        store.indexAttachments(scope('s2'), [second], 'look [image]');

        assert.deepStrictEqual(
            store.refsFromIndex(scope('s1'), 'look [image]', new Set()),
            [{ hash: first.hash, mimeType: 'image/png' }],
        );
        assert.deepStrictEqual(
            store.refsFromIndex(scope('s2'), 'look [image]', new Set()),
            [{ hash: second.hash, mimeType: 'image/png' }],
        );
    });

    it('keeps the loose replay fallback inside its own session', () => {
        const [first] = store.storeImages([image('one')]);
        store.indexAttachments(scope('s1'), [first], 'look [image]');

        assert.deepStrictEqual(store.refsFromIndex(scope('s2'), 'different [image]', new Set(), true), []);
    });

    it('keeps profiles apart as well as sessions', () => {
        const [first] = store.storeImages([image('one')]);
        store.indexAttachments(scope('s1', 'work'), [first], 'look [image]');

        assert.deepStrictEqual(store.refsFromIndex(scope('s1', 'personal'), 'look [image]', new Set()), []);
    });
});
