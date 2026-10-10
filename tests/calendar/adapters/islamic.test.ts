import { describe, it, expect } from 'vitest';
import { IslamicAdapter, toJdnIslamic, fromJdnIslamic, fromJdnGregorian, toJdnGregorian } from '../../../src/calendar/adapters/islamic.js';
import { createTimezoneService } from '../../../src/calendar/timezone.js';

const adapter = new IslamicAdapter(createTimezoneService());

describe('IslamicAdapter', () => {
  it('JDN helpers round-trip a known date', () => {
    // 1 Muharram 1 AH = JDN 1948440.
    expect(toJdnIslamic(1, 1, 1)).toBe(1948440);
    const back = fromJdnIslamic(1948440);
    expect(back).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('Gregorian <-> JDN round-trips', () => {
    const jdn = toJdnGregorian(2026, 10, 19);
    const back = fromJdnGregorian(jdn);
    expect(back).toEqual({ year: 2026, month: 10, day: 19 });
  });

  it('rejects day > month length', () => {
    // 30 in month 2 (29 days) is invalid.
    const r = adapter.validate({ year: 1447, month: 2, day: 30 });
    expect(r.valid).toBe(false);
  });

  it('resolveAnnual does not degrade for a normal Hijri year', () => {
    const a = adapter.resolveAnnual({ year: 1400, month: 1, day: 1 }, 1447, 'UTC');
    expect(a.degraded).toBe(false);
    // Hijri year is shorter than Gregorian — month/day lands earlier in the year.
    expect(a.localDate.startsWith('2025') || a.localDate.startsWith('2026')).toBe(true);
  });

  it('resolveAnnual reports degradation when target year has fewer days', () => {
    // Month 12 is 29 days in a non-leap year. If birth was 30 (leap), this
    // collapses to 29.
    const a = adapter.resolveAnnual({ year: 1447, month: 12, day: 30 }, 1448, 'UTC');
    expect(a.degraded).toBe(true);
    expect(a.degradationReason).toContain('29');
  });
});
