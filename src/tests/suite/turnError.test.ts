import { describe, it } from 'mocha';
import assert from 'assert';
import { describeTurnError } from '../../host/acp/AcpClient';

/**
 * The reason a failed turn gives.
 *
 * Hermes answers an unhandled failure with JSON-RPC "Internal error" and puts the human reason in
 * the error's `data` — `acp/connection.py` builds `RequestError.internal_error({"details": str(exc)})`,
 * or the parsed JSON when the exception's text is one. The message alone is what made a missing API
 * key read as "Error: Internal error".
 */

/** An Error with the `data` a JSON-RPC error carries. */
const rpcError = (message: string, data?: unknown): Error => {
    const err = new Error(message) as Error & { data?: unknown };
    if (data !== undefined) {
        err.data = data;
    }
    return err;
};

describe('a failed turn: what the pane is told', () => {
    it('appends the details Hermes sent', () => {
        const err = rpcError('Internal error', { details: "No usable credentials found for provider 'deepseek'. Set DEEPSEEK_API_KEY." });
        assert.strictEqual(
            describeTurnError(err),
            "Error: Internal error — No usable credentials found for provider 'deepseek'. Set DEEPSEEK_API_KEY.",
        );
    });

    it('takes data that is a string', () => {
        assert.strictEqual(describeTurnError(rpcError('Internal error', 'the profile has no key')), 'Error: Internal error — the profile has no key');
    });

    it('stays as it was when there is no reason to add', () => {
        assert.strictEqual(describeTurnError(rpcError('Internal error')), 'Error: Internal error');
        assert.strictEqual(describeTurnError(rpcError('Internal error', {})), 'Error: Internal error');
        assert.strictEqual(describeTurnError(rpcError('Internal error', { errors: [] })), 'Error: Internal error', 'an object without details');
        assert.strictEqual(describeTurnError(rpcError('Internal error', { details: '   ' })), 'Error: Internal error', 'blank details');
    });

    it('reads anything thrown, not only an Error', () => {
        assert.strictEqual(describeTurnError('boom'), 'Error: boom');
        assert.strictEqual(describeTurnError({ data: { details: 'why' } }), 'Error: [object Object] — why', 'a plain object still yields its reason');
    });
});
