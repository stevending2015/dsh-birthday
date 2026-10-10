import { describe, it, expect } from 'vitest';
import { LunarAdapter } from '../../../src/calendar/adapters/lunar.js';
import { createTimezoneService } from '../../../src/calendar/timezone.js';

const adapter = new LunarAdapter(createTimezoneService());

describe('LunarAdapter (without lunar package installed)', () => {
  it('does structural validation even without the package', () => {
    const ok = adapter.validate({ year: 2000, month: 1, day: 1 });
    expect(ok.valid).toBe(true);
  });

  it('rejects out-of-range fields', () => {
    const bad = adapter.validate({ year: 1000, month: 1, day: 1 });
    expect(bad.valid).toBe(false);
  });

  it('describeFields includes isLeapMonth', () => {
    const desc = adapter.describeFields();
    expect(desc.find((f) => f.key === 'isLeapMonth')).toBeDefined();
  });
});

// If the `lunar` package happens to be installed we run richer tests too.
let lunarMod: any = null;
try { lunarMod = require('lunar'); } catch { lunarMod = null; }

(lunarMod ? describe : describe.skip)('LunarAdapter (with lunar package)', () => {
  it('round-trips a known lunar date', () => {
    const g = adapter.toGregorian({ year: 2000, month: 1, day: 1 }, 'Asia/Shanghai');
    expect(g.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const back = adapter.fromGregorian(g.localDate, 'Asia/Shanghai');
    expect(back.month).toBeGreaterThan(0);
    expect(back.day).toBeGreaterThan(0);
  });

  it('degrades a leap-month birthday in a year without that leap month', () => {
    // 2017 is a leap year with leap month 6; 2018 is not. The fix is to
    // request a leap-month birthday and then resolveAnnual into a non-leap
    // year to force the degraded path.
    let degradedSeen = false;
    for (let y = 1890; y <= 2100; y += 1) {
      const a = adapter.resolveAnnual({ year: 2000, month: 5, day: 15, isLeapMonth: true }, y, 'Asia/Shanghai');
      if (a.degraded) {
        degradedSeen = true;
        expect(a.degradationReason).toContain('闰');
        break;
      }
    }
    expect(degradedSeen).toBe(true);
  });
});
