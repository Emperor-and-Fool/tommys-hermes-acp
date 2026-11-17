import { describe, it } from 'mocha';
import assert from 'assert';
import { shouldShowRow } from '../../pane/components/permissions/rootRow';

/** The row shows because the reader opened it, or because the host has something to say. */
describe('the permission-root row: when it is on screen', () => {
    it('closed stays closed, whatever there is to pick', () => {
        assert.strictEqual(shouldShowRow({ offered: ['/w/a', '/w/b'] }, false), false);
    });

    it('open shows only when there is something to choose between', () => {
        assert.strictEqual(shouldShowRow({ offered: ['/w/a', '/w/b'] }, true), true);
        // A single-folder window is offered nothing at all (offeredRoots), so it has no row.
        assert.strictEqual(shouldShowRow({ offered: [] }, true), false);
    });

    it('a notice is shown even with nothing left to pick', () => {
        assert.strictEqual(shouldShowRow({ offered: [], notice: 'lastRootRemoved' }, false), true);
        assert.strictEqual(shouldShowRow({ offered: ['/w/a', '/w/b'], notice: 'appliesNextRun' }, false), true);
    });
});
