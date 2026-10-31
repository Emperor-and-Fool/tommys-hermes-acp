import { describe, it } from 'mocha';
import assert from 'assert';
import {
    FAB_REVEAL_ZONE,
    JUMP_TOP_AFTER_PX,
    SCROLL_BOTTOM_THRESHOLD,
    isAtBottom,
    isPointerNearFabs,
    jumpControlMode,
} from '../../shared/scrollLogic';

/**
 * The transcript's scroll decisions, tested as arithmetic rather than through a browser. These were
 * three expressions inside DOM handlers, reachable only by running the pane by hand.
 */
describe('scroll logic', () => {
    it('treats the last few pixels as the bottom', () => {
        assert.strictEqual(isAtBottom(900, 1000, 100), true, 'exactly at the bottom');
        assert.strictEqual(
            isAtBottom(900 - SCROLL_BOTTOM_THRESHOLD, 1000, 100),
            true,
            'within the rounding slack'
        );
        assert.strictEqual(isAtBottom(900 - SCROLL_BOTTOM_THRESHOLD - 1, 1000, 100), false, 'one pixel further');
    });

    it('offers "jump to now" when the reader left the bottom', () => {
        assert.strictEqual(jumpControlMode(true, 5000), 'now');
        assert.strictEqual(jumpControlMode(true, 0), 'now', 'pinned wins over the distance from the top');
    });

    it('offers "back to the start" only once there is somewhere to go back to', () => {
        assert.strictEqual(jumpControlMode(false, JUMP_TOP_AFTER_PX + 1), 'top');
        assert.strictEqual(jumpControlMode(false, JUMP_TOP_AFTER_PX), null, 'the threshold itself is still "near the top"');
        assert.strictEqual(jumpControlMode(false, 0), null);
    });

    it('reveals the corner controls by proximity, not by click', () => {
        const box = { right: 1000, bottom: 800 };
        assert.strictEqual(isPointerNearFabs(box, { x: 900, y: 760 }), true, 'inside the corner zone');
        assert.strictEqual(
            isPointerNearFabs(box, { x: 1000 - FAB_REVEAL_ZONE.right, y: 800 - FAB_REVEAL_ZONE.bottom }),
            true,
            'exactly on the zone edge'
        );
        assert.strictEqual(isPointerNearFabs(box, { x: 700, y: 760 }), false, 'too far left');
        assert.strictEqual(isPointerNearFabs(box, { x: 900, y: 400 }), false, 'too far up');
    });
});
