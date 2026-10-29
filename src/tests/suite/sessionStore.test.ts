import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CATALOG_LIMIT, SessionStore } from '../../host/cache/sessionStore';
import type { SessionInfo } from '../../shared/chat';

const row = (id: string): SessionInfo => ({
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
});

describe('session store: the catalog', () => {
    let dir: string;
    let store: SessionStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
        store = new SessionStore(dir, 'scope');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips the catalog', () => {
        assert.ok(store.writeCatalog([row('a'), row('b')]));
        assert.deepStrictEqual(store.readCatalog().map(entry => entry.id), ['a', 'b']);
    });

    it('caps the catalog', () => {
        store.writeCatalog(Array.from({ length: CATALOG_LIMIT + 10 }, (_, index) => row(`s${index}`)));
        assert.strictEqual(store.readCatalog().length, CATALOG_LIMIT);
    });

    it('round-trips the active id', () => {
        store.writeActiveId('abc');
        assert.strictEqual(store.readActiveId(), 'abc');
    });

    it('returns an empty catalog when the file is missing', () => {
        assert.deepStrictEqual(store.readCatalog(), []);
    });
});
