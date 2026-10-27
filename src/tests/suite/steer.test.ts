import { describe, it } from 'mocha';
import assert from 'assert';
import { stopButtonIntent } from '../../shared/steer';
import { isSteerNotice } from '../../host/acp/steerNotice';

describe('steer', () => {
    it('keeps Stop when there is nothing to say', () => {
        assert.strictEqual(stopButtonIntent(''), 'cancel');
        assert.strictEqual(stopButtonIntent('   \n '), 'cancel');
    });

    it('offers Steer as soon as there is text', () => {
        assert.strictEqual(stopButtonIntent('go left'), 'steer');
        assert.strictEqual(stopButtonIntent('  padded  '), 'steer');
    });

    it('recognises the agent acknowledging a steer', () => {
        assert.strictEqual(isSteerNotice('⏩ Steer queued for the active turn: go left'), true);
        assert.strictEqual(isSteerNotice('  ⏩ Steer queued'), true);
    });

    it('recognises a failed steer', () => {
        assert.strictEqual(isSteerNotice('⚠️ Steer failed: nothing running'), true);
    });

    it('leaves ordinary reply text alone, warning signs included', () => {
        assert.strictEqual(isSteerNotice('Here is the answer'), false);
        assert.strictEqual(isSteerNotice(''), false);
        assert.strictEqual(isSteerNotice('⚠'), false);
        assert.strictEqual(isSteerNotice('⚠️ This deletes the folder'), false);
        assert.strictEqual(isSteerNotice('⏩ next step'), false);
    });
});
