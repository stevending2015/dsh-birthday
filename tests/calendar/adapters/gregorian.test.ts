import { describe, it, expect } from 'vitest';
import { GregorianAdapter } from '../../../src/calendar/adapters/gregorian.js';
import { createTimezoneService } from '../../../src/calendar/timezone.js';

const adapter = new GregorianAdapter(createTimezoneService());

describe('GregorianAdapter', () => {
  it('validates a normal date', () => {
    expect(adapter.validate({ year: 2024, month: 2, day: 29 }).valid).toBe(true);
  });

  it('rejects out-of-range day', () => {
    expect(adapter.validate({ year: 2026, month: 2, day: 30 }).valid).toBe(false);
    expect(adapter.validate({ year: 2026, month: 2, day: 29 }).valid).toBe(false);
  });

  it('round-trips via hub', () => {
    const g = adapter.toGregorian({ year: 2026, month: 10, day: 19 }, 'UTC');
    const back = adapter.fromGregorian(g.localDate, 'UTC');
    expect(back).toEqual({ year: 2026, month: 10, day: 19 });
  });

  it('resolveAnnual picks the target year', () => {
    const a = adapter.resolveAnnual({ year: 1990, month: 3, day: 4 }, 2030, 'UTC');
    expect(a.localDate).toBe('2030-03-04');
    expect(a.degraded).toBe(false);
  });
});
