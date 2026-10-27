import { describe, it } from 'mocha';
import assert from 'assert';
import { APPROVAL_MODES, isSettableApprovalMode, parseApprovalMode } from '../../host/environment/approvalMode';

describe('approval mode', () => {
    it('parses the CLI output trimmed and case-insensitively', () => {
        assert.strictEqual(parseApprovalMode('smart'), 'smart');
        assert.strictEqual(parseApprovalMode('  Smart\n'), 'smart');
        assert.strictEqual(parseApprovalMode('MANUAL\r\n'), 'manual');
        assert.strictEqual(parseApprovalMode(' off '), 'off');
    });

    it('reads anything else as unknown', () => {
        assert.strictEqual(parseApprovalMode(''), 'unknown');
        assert.strictEqual(parseApprovalMode('   '), 'unknown');
        assert.strictEqual(parseApprovalMode('auto'), 'unknown');
        assert.strictEqual(parseApprovalMode('smartt'), 'unknown');
        assert.strictEqual(parseApprovalMode(undefined), 'unknown');
        assert.strictEqual(parseApprovalMode(null), 'unknown');
        assert.strictEqual(parseApprovalMode(42), 'unknown');
    });

    it('accepts only the three settable values', () => {
        for (const mode of APPROVAL_MODES) {
            assert.strictEqual(isSettableApprovalMode(mode), true);
        }
        assert.strictEqual(isSettableApprovalMode('unknown'), false);
        assert.strictEqual(isSettableApprovalMode(''), false);
        assert.strictEqual(isSettableApprovalMode(undefined), false);
        assert.strictEqual(isSettableApprovalMode(3), false);
    });
});
