/**
 * DeepSeek's billing clock, as one date in and one word out.
 *
 * DeepSeek charges its peak rate from 09:00 to 12:00 and 14:00 to 18:00 on UTC+8 weekdays, and the
 * off-peak (half) rate at every other moment — including all weekend. Nothing here reads a clock of
 * its own: the instant is the argument, so an evening can be tested at noon.
 */
export type PricingPeriod = 'peak' | 'off-peak';

/** The offset the published hours are written in. */
const OFFSET_MINUTES = 8 * 60;

/** Peak hours, in minutes after midnight, local to that offset. */
const PEAK_WINDOWS: Array<[number, number]> = [[9, 12], [14, 18]];

/** The hour, the minute and the weekday at DeepSeek's offset, from any instant. */
export function pricingClock(at: Date): { hour: number; minute: number; weekend: boolean } {
    const shifted = new Date(at.getTime() + OFFSET_MINUTES * 60_000);
    const day = shifted.getUTCDay();
    return {
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        weekend: day === 0 || day === 6,
    };
}

/** What the account is billed at, at that instant. */
export function pricingPeriod(at: Date): PricingPeriod {
    const clock = pricingClock(at);
    if (clock.weekend) {
        return 'off-peak';
    }
    const minutes = clock.hour * 60 + clock.minute;
    const peak = PEAK_WINDOWS.some(([from, to]) => minutes >= from * 60 && minutes < to * 60);
    return peak ? 'peak' : 'off-peak';
}

/** The icon the item carries for the period: a flame while it is dear, a moon while it is not. */
export function pricingBadge(period: PricingPeriod): string {
    return period === 'peak' ? '$(flame)' : '$(moon)';
}
