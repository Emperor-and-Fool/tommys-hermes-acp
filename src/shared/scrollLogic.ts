/*
 * The transcript's scroll decisions, as pure functions.
 *
 * These used to live inside DOM handlers in messageList.ts, where the only way to check them was to
 * run the pane by hand. Measured input in, answer out: no element, no event, no state.
 */

/** Below this many pixels from the top, "back to the start" is not worth a control. */
export const JUMP_TOP_AFTER_PX = 300;

/** How close the pointer must come to the corner before the dim controls show themselves. */
export const FAB_REVEAL_ZONE = { right: 150, bottom: 70 };

/** A sub-pixel or rounding gap at the bottom still counts as the bottom. */
export const SCROLL_BOTTOM_THRESHOLD = 24;

/** Following the newest message, allowing for the browser's fractional scroll positions. */
export function isAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
    return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
}

/**
 * Which way the single floating control points.
 *
 * Reading higher up means the reader chose to leave the bottom: offer "jump to now". Still following
 * means they are at the bottom already, so the only useful direction is back to the start.
 */
export function jumpControlMode(pinned: boolean, scrollTop: number): 'now' | 'top' | null {
    if (pinned) return 'now';
    return scrollTop > JUMP_TOP_AFTER_PX ? 'top' : null;
}

/** Pointer within the corner zone the floating stack occupies (measured from the transcript's box). */
export function isPointerNearFabs(
    box: { right: number; bottom: number },
    point: { x: number; y: number }
): boolean {
    return box.right - point.x <= FAB_REVEAL_ZONE.right && box.bottom - point.y <= FAB_REVEAL_ZONE.bottom;
}
