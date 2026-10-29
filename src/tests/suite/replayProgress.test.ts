import * as assert from 'assert';
import {
    REPLAY_PROGRESS_EVERY,
    countsTowardMessageCount,
    replayCountDiffers,
    shouldReportReplay,
} from '../../host/acp/replayProgress';

/** A replay as Hermes sends it: whole messages per update, reasoning included. */
const rows = (user: number, assistant: number, thought: number, tool: number): string[] => [
    ...Array<string>(user).fill('user'),
    ...Array<string>(assistant).fill('assistant'),
    ...Array<string>(thought).fill('thought'),
    ...Array<string>(tool).fill('tool'),
];

describe('replay progress counting', () => {
    it('keeps thoughts out of the count compared to Hermes\' message_count', () => {
        // 503 in the source session was 131 user + 250 assistant + 122 tool: no thoughts, because
        // Hermes keeps reasoning on the assistant row and `message_count` never sees it. The
        // loading state counts chunks (thoughts included); this comparison must not.
        const replay = rows(10, 10, 20, 10);
        assert.strictEqual(replay.length, 50);
        const countable = replay.filter(countsTowardMessageCount).length;
        assert.strictEqual(countable, 30, 'a comparison would overshoot by exactly the thought rows');
    });

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

    it('flags a replay that overshoots the catalog, but lets the pending turns explain the small gap', () => {
        assert.strictEqual(replayCountDiffers(503, 503, 0), false, 'a match is not a discrepancy');
        assert.strictEqual(replayCountDiffers(505, 503, 2), false, 'the sidecar accounts for the difference');
        assert.strictEqual(replayCountDiffers(505, 503, 0), true, 'unexplained rows are worth a line');
        assert.strictEqual(replayCountDiffers(9, 0, 0), false, 'no source count means nothing to compare against');
    });
});
