import * as assert from 'assert';
import { REPLAY_PROGRESS_EVERY, shouldReportReplay } from '../../host/acp/replayProgress';

/** The loading count is a display throttle over the chunks a replay sends, and nothing more. */
describe('replay progress counting', () => {
    it('reports on a throttle, starting with the first row so the count moves at once', () => {
        const marks: number[] = [];
        for (let received = 1; received <= REPLAY_PROGRESS_EVERY * 3; received++) {
            if (shouldReportReplay(received)) {
                marks.push(received);
            }
        }
        assert.deepStrictEqual(marks, [1, REPLAY_PROGRESS_EVERY, REPLAY_PROGRESS_EVERY * 2, REPLAY_PROGRESS_EVERY * 3]);
        assert.strictEqual(shouldReportReplay(0), false, 'nothing to report before the first row');
    });
});
