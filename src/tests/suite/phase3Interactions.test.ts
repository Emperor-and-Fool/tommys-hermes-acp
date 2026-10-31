import { describe, it } from 'mocha';
import assert from 'assert';
import { sliceTextByLines } from '../../host/acp/fsRead';

describe('fsRead', () => {
    it('sliceTextByLines returns full content when no range', () => {
        assert.strictEqual(sliceTextByLines('a\nb\nc'), 'a\nb\nc');
    });

    it('sliceTextByLines reads from line with limit', () => {
        assert.strictEqual(sliceTextByLines('a\nb\nc\nd', 2, 2), 'b\nc');
    });
});
