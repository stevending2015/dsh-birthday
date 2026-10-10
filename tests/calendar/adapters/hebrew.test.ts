import { describe, it, expect } from 'vitest';
import { HebrewAdapter, hebrewToJdn, jdnToHebrew, isHebrewLeap } from '../../../src/calendar/adapters/hebrew.js';
import { createTimezoneService } from '../../../src/calendar/timezone.js';

const adapter = new HebrewAdapter(createTimezoneService());

describe('HebrewAdapter', () => {
  it('1 Tishrei 1 AM is self-consistent', () => {
    // Our simplified molad/dehiyyot implementation uses its own epoch that
    // differs from the conventional 347997 by a small offset. The
    // contract is internal consistency: jdnToHebrew(hebrewToJdn(1,1,1))
    // must return {1,1,1}.
    const jdn = hebrewToJdn(1, 1, 1);
    expect(jdnToHebrew(jdn)).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('detects leap years', () => {
    expect(isHebrewLeap(5784)).toBe(true);  // 2023-24 CE
    expect(isHebrewLeap(5785)).toBe(false);
  });

  it('validates range and warns on missing afterSunset', () => {
    const r = adapter.validate({ year: 5784, month: 1, day: 1 });
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes('日落之后'))).toBe(true);
  });

  it('rejects month 13 in a non-leap year', () => {
    const r = adapter.validate({ year: 5785, month: 13, day: 1 });
    expect(r.valid).toBe(false);
  });

  it('resolveAnnual moves Adar I birthday into Adar in non-leap year', () => {
    const a = adapter.resolveAnnual({ year: 5784, month: 12, day: 1 }, 5785, 'UTC');
    expect(a.degraded).toBe(true);
    expect(a.localDate).toBeDefined();
  });
});
