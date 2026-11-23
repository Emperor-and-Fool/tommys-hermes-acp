import * as assert from 'assert';
import { pricingBadge, pricingPeriod } from '../../host/budget/pricing';

/**
 * DeepSeek's clock, as the item reads it: the hours are UTC+8, and a weekend is off-peak all day.
 *
 * Every instant below is written in UTC, so the test says what it means: 01:30Z is 09:30 at UTC+8.
 */
describe('DeepSeek pricing periods', () => {
    it('is peak inside 09:00-12:00 and 14:00-18:00 on a weekday', () => {
        // Monday 2026-11-23, in UTC+8.
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T01:30:00Z')), 'peak', '09:30');
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T06:30:00Z')), 'peak', '14:30');
    });

    it('is off-peak at the boundaries, between the windows, and at night', () => {
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T00:30:00Z')), 'off-peak', '08:30');
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T04:00:00Z')), 'off-peak', '12:00');
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T05:30:00Z')), 'off-peak', '13:30');
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T10:00:00Z')), 'off-peak', '18:00');
        assert.strictEqual(pricingPeriod(new Date('2026-11-23T20:00:00Z')), 'off-peak', '04:00 next day');
    });

    it('is off-peak all weekend, even inside a peak window', () => {
        assert.strictEqual(pricingPeriod(new Date('2026-11-22T01:30:00Z')), 'off-peak', 'Sunday 09:30');
        assert.strictEqual(pricingPeriod(new Date('2026-11-21T02:00:00Z')), 'off-peak', 'Saturday 10:00');
    });

    it('carries the badge for the period', () => {
        assert.strictEqual(pricingBadge('peak'), '$(flame)');
        assert.strictEqual(pricingBadge('off-peak'), '$(moon)');
    });
});
