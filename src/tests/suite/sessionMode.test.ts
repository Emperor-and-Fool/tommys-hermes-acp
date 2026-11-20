import { describe, it } from 'mocha';
import assert from 'assert';
import { sessionModeFrom } from '../../host/acp/sessionMode';

/** Hermes reports the edit mode in the session response and again when it changes. */
describe('the session mode Hermes reports', () => {
    it('reads the modes block of a session response, either spelling', () => {
        assert.strictEqual(sessionModeFrom({ modes: { currentModeId: 'accept_edits' } }), 'accept_edits');
        assert.strictEqual(sessionModeFrom({ modes: { current_mode_id: 'dont_ask' } }), 'dont_ask');
    });

    it('reads a current_mode_update, which carries the id at the top', () => {
        assert.strictEqual(sessionModeFrom({ currentModeId: 'default' }), 'default');
        assert.strictEqual(sessionModeFrom({ current_mode_id: 'session' }), 'session');
    });

    it('says nothing when the agent says nothing, rather than guessing a mode', () => {
        assert.strictEqual(sessionModeFrom({}), '');
        assert.strictEqual(sessionModeFrom(null), '');
        assert.strictEqual(sessionModeFrom({ modes: {} }), '');
        assert.strictEqual(sessionModeFrom({ modes: { currentModeId: 42 } }), '');
    });
});
