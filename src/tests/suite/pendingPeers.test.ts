import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PENDING_PEER_LIMIT, PendingPeerStore } from '../../host/cache/pendingPeers';

const entry = (id: string) => ({
    envelopeId: id,
    text: `draft ${id}`,
    peer: { envelopeId: id, fromProfile: 'pa', fromHost: 'host' },
    savedAt: 1,
});

describe('pending peer store', () => {
    let dir: string;
    let store: PendingPeerStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-peers-'));
        store = new PendingPeerStore(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips a card per tab and keeps tabs apart', () => {
        store.append('tab-a', entry('one'));
        store.append('tab-b', entry('two'));
        assert.deepStrictEqual(store.read('tab-a').map(item => item.envelopeId), ['one']);
        assert.deepStrictEqual(store.read('tab-b').map(item => item.envelopeId), ['two']);
        assert.deepStrictEqual(store.read('tab-missing'), []);
    });

    it('does not store one envelope twice', () => {
        store.append('tab-a', entry('one'));
        store.append('tab-a', entry('one'));
        assert.strictEqual(store.read('tab-a').length, 1);
    });

    it('a decision removes the entry, and the file with the last one', () => {
        store.append('tab-a', entry('one'));
        store.append('tab-a', entry('two'));
        store.remove('tab-a', 'one');
        assert.deepStrictEqual(store.read('tab-a').map(item => item.envelopeId), ['two']);
        store.remove('tab-a', 'two');
        assert.deepStrictEqual(store.read('tab-a'), []);
        assert.strictEqual(fs.existsSync(store.pathFor('tab-a')), false);
    });

    it('caps the stack and keeps the newest', () => {
        for (let i = 0; i < PENDING_PEER_LIMIT + 3; i++) {
            store.append('tab-a', entry(`p${i}`));
        }
        const kept = store.read('tab-a');
        assert.strictEqual(kept.length, PENDING_PEER_LIMIT);
        assert.strictEqual(kept[kept.length - 1].envelopeId, `p${PENDING_PEER_LIMIT + 2}`);
    });

    it('a corrupt file reads as empty rather than throwing', () => {
        fs.writeFileSync(store.pathFor('tab-a'), 'not json');
        assert.deepStrictEqual(store.read('tab-a'), []);
    });
});
