import { describe, it } from 'mocha';
import assert from 'assert';
import { isEditCard } from '../../pane/components/permissions/cardKind';

/** Only an edit card carries the hint: its answers are Hermes' own two, and its name says so. */
describe('which cards are edit cards', () => {
    it('recognises Hermes\' edit card by the answer it offers', () => {
        assert.strictEqual(isEditCard([
            { optionId: 'allow_once', name: 'Allow edit' },
            { optionId: 'deny', name: 'Deny' },
        ]), true);
    });

    it('a command card is not one, whatever it offers', () => {
        assert.strictEqual(isEditCard([
            { optionId: 'allow_once', name: 'Allow once' },
            { optionId: 'allow_session', name: 'Allow for session' },
            { optionId: 'deny', name: 'Deny' },
        ]), false);
        assert.strictEqual(isEditCard([]), false);
        assert.strictEqual(isEditCard(undefined), false);
    });
});
