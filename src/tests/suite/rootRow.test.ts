import { describe, it } from 'mocha';
import assert from 'assert';
import { pressRootButton, shouldShowRow } from '../../pane/components/workspace/rootRow';

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

/** The row's own button is a switch: what it opens, it closes. */
describe('the permission-root button: one press toggles', () => {
    it('a press on a closed row opens it, and asks for the facts', () => {
        const sent: string[] = [];
        const after = pressRootButton(false, msg => sent.push(msg.type));

        assert.strictEqual(after, true, 'the row is open now');
        assert.deepStrictEqual(sent, ['openPermissionRoot']);
    });

    it('a second press closes it through the same path as the X', () => {
        const sent: string[] = [];
        const after = pressRootButton(true, msg => sent.push(msg.type));

        assert.strictEqual(after, false, 'the row is closed now');
        assert.deepStrictEqual(sent, ['permissionRootClose'], 'the host stops the countdown and keeps what is left');
    });
});
