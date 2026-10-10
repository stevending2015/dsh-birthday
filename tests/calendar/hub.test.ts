import { describe, it, expect } from 'vitest';
import { createCalendarEngine } from '../../src/calendar/index.js';

const engine = createCalendarEngine({
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
});

describe('GregorianHub', () => {
  it('lists all configured calendars', () => {
    const list = engine.hub.listCalendars();
    expect(list.map((c) => c.id).sort()).toEqual(['gregorian', 'hebrew', 'islamic', 'lunar']);
  });

  it('round-trips gregorian', () => {
    const g = engine.hub.toGregorian('gregorian', { year: 2026, month: 10, day: 19 }, 'Asia/Shanghai');
    const back = engine.hub.fromGregorian('gregorian', g.localDate, 'Asia/Shanghai');
    expect(back).toEqual({ year: 2026, month: 10, day: 19 });
  });

  it('rejects invalid date', () => {
    expect(() => engine.hub.toGregorian('gregorian', { year: 2026, month: 13, day: 1 }, 'UTC'))
      .toThrow();
  });

  it('rejects unknown adapter', () => {
    expect(() => engine.hub.toGregorian('tibetan', { year: 1, month: 1, day: 1 }, 'UTC'))
      .toThrow();
  });

  it('userActionInstant lands at the user-local hour', () => {
    const startUtc = engine.hub.toGregorian('gregorian', { year: 2026, month: 10, day: 19 }, 'Asia/Shanghai').startUtc;
    // 19 Oct 00:00 Asia/Shanghai = 18 Oct 16:00 UTC.
    expect(startUtc).toBe('2026-10-18T16:00:00.000Z');
    // In Phoenix (UTC-7) that same instant is 18 Oct 09:00 — already at the
    // user-local 09:00 mark, so the action instant is identical.
    const user = engine.hub.userActionInstant(startUtc, 'America/Phoenix', 9);
    expect(user).toBe(startUtc);
  });
});
