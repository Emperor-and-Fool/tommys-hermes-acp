import { describe, it, beforeEach, afterEach } from 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TabStore } from '../../host/workspace/store';
import type { SessionInfo } from '../../shared/chat';

const row = (id: string): SessionInfo => ({
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
});

describe('session store: the catalog', () => {
    let dir: string;
    let store: TabStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
        store = new TabStore(dir, 'scope');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips the catalog', () => {
        assert.ok(store.writeCatalog([row('a'), row('b')]));
        assert.deepStrictEqual(store.readCatalog().map(entry => entry.id), ['a', 'b']);
    });

    it('keeps every tab, with no cap', () => {
        const many = Array.from({ length: 500 }, (_, index) => row(`s${index}`));
        store.writeCatalog(many);
        assert.deepStrictEqual(store.readCatalog().map(entry => entry.id), many.map(entry => entry.id),
            'nothing is dropped: the catalog is as long as the list it was given');
    });

    it('round-trips the active id per workspace, and keeps the workspaces apart', () => {
        store.writeActiveId('w-1', 'abc');
        store.writeActiveId('w-2', 'def');
        assert.strictEqual(store.readActiveId('w-1'), 'abc');
        assert.strictEqual(store.readActiveId('w-2'), 'def');
        assert.strictEqual(store.readActiveId('w-3'), null);
    });

    it('returns an empty catalog when the file is missing', () => {
        assert.deepStrictEqual(store.readCatalog(), []);
    });
});
