/**
 * A birthday late in the lunar year lands in the NEXT Gregorian year.
 *
 * 农历 N 年腊月 happens in January or February of N+1, so "the occurrence in
 * year Y" is not the same as `resolveAnnual(..., Y, ...)`. Treating the two as
 * one hid a 腊月 birthday from the calendar entirely and made the countdown
 * report it a year late. Both are covered here with the same shape of record.
 */

import { describe, it, expect } from 'vitest';
import { createCalendarEngine } from '../../src/calendar/index.js';
import { UpcomingService } from '../../src/birthday/services/upcoming.js';
import { buildBirthdayIndex } from '../../src/birthday/services/almanac.js';
import type { BirthdayRecord } from '../../src/birthday/models/birthday.js';

const engine = createCalendarEngine({
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
});
const hub = engine.hub;
const upcoming = new UpcomingService(hub);

/** 农历 1995 腊月十八 → 公历 1996-02-06. */
const lateLunar: BirthdayRecord = {
  id: 1,
  name: '腊月生',
  calendarSystem: 'lunar',
  fields: { year: 1995, month: 12, day: 18 },
  birthTimezone: 'Asia/Shanghai',
  gregorianLocalDate: '1996-02-06',
} as BirthdayRecord;

/** 农历 1985 四月初三 → 公历 1985-05-22, i.e. a mid-year lunar date. */
const midLunar: BirthdayRecord = {
  id: 2,
  name: '四月生',
  calendarSystem: 'lunar',
  fields: { year: 1985, month: 4, day: 3 },
  birthTimezone: 'Asia/Shanghai',
  gregorianLocalDate: '1985-05-22',
} as BirthdayRecord;

const gregorian: BirthdayRecord = {
  id: 3,
  name: '公历生',
  calendarSystem: 'gregorian',
  fields: { year: 2010, month: 7, day: 22 },
  birthTimezone: 'Asia/Shanghai',
  gregorianLocalDate: '2010-07-22',
} as BirthdayRecord;

describe('a 腊月 birthday is placed in the right Gregorian year', () => {
  it('marks it in the January/February of the viewed year, not the next', () => {
    // 农历 2025 腊月十八 = 2026-02-05; 农历 2026 腊月十八 = 2027-01-25.
    expect([...buildBirthdayIndex([lateLunar], 2026, hub).keys()]).toEqual(['2026-02-05']);
    expect([...buildBirthdayIndex([lateLunar], 2027, hub).keys()]).toEqual(['2027-01-25']);
    expect([...buildBirthdayIndex([lateLunar], 2028, hub).keys()]).toEqual(['2028-01-14']);
  });

  it('gives exactly one day per year, never zero and never two', () => {
    for (let year = 2020; year <= 2030; year += 1) {
      const index = buildBirthdayIndex([lateLunar], year, hub);
      expect(index.size).toBe(1);
      const [date] = [...index.keys()];
      expect(Number(date.slice(0, 4))).toBe(year);
    }
  });

  it('still places mid-year lunar and Gregorian dates correctly', () => {
    expect([...buildBirthdayIndex([midLunar], 2026, hub).keys()]).toEqual(['2026-05-19']);
    expect([...buildBirthdayIndex([gregorian], 2026, hub).keys()]).toEqual(['2026-07-22']);
  });

  it('keeps every record when several are viewed together', () => {
    const index = buildBirthdayIndex([lateLunar, midLunar, gregorian], 2026, hub);
    expect([...index.keys()].sort()).toEqual(['2026-02-05', '2026-05-19', '2026-07-22']);
  });
});

describe('the countdown does not skip an imminent 腊月 birthday', () => {
  it('reports the January occurrence while it is still ahead', () => {
    // The regression: on 2027-01-10 the next birthday is 2027-01-25, only two
    // weeks away, but resolving only the current year returned 2028-01-14.
    const entry = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2027-01-10T04:00:00Z'),
    });
    expect(entry.nextLocalDate).toBe('2027-01-25');
  });

  it('moves to the following year once it has passed', () => {
    const entry = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2027-02-20T04:00:00Z'),
    });
    expect(entry.nextLocalDate).toBe('2028-01-14');
  });

  it('treats the birthday itself as today, not as next year', () => {
    // Comparing instants made 00:00 look like "past", so on the day the card
    // jumped a year and could never say 就是今天.
    const onTheDay = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2027-01-25T04:00:00Z'), // 12:00 in Shanghai
    });
    expect(onTheDay.nextLocalDate).toBe('2027-01-25');

    const lateOnTheDay = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2027-01-25T15:00:00Z'), // 23:00 in Shanghai
    });
    expect(lateOnTheDay.nextLocalDate).toBe('2027-01-25');
  });

  it('rolls over the day after', () => {
    const nextDay = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2027-01-26T04:00:00Z'),
    });
    expect(nextDay.nextLocalDate).toBe('2028-01-14');
  });

  it('leaves ordinary dates behaving as before', () => {
    // On the day itself.
    expect(
      upcoming.resolve(gregorian, { userTimezone: 'Asia/Shanghai', now: new Date('2026-07-22T04:00:00Z') })
        .nextLocalDate,
    ).toBe('2026-07-22');
    // The day after it has passed, so the next one is a year out.
    expect(
      upcoming.resolve(gregorian, { userTimezone: 'Asia/Shanghai', now: new Date('2026-07-23T04:00:00Z') })
        .nextLocalDate,
    ).toBe('2027-07-22');
    expect(
      upcoming.resolve(midLunar, { userTimezone: 'Asia/Shanghai', now: new Date('2026-05-19T04:00:00Z') })
        .nextLocalDate,
    ).toBe('2026-05-19');
  });

  it('agrees with the almanac for the year it lands in', () => {
    for (const now of ['2026-06-01T04:00:00Z', '2027-01-10T04:00:00Z', '2027-06-01T04:00:00Z']) {
      const entry = upcoming.resolve(lateLunar, { userTimezone: 'Asia/Shanghai', now: new Date(now) });
      const year = Number(entry.nextLocalDate.slice(0, 4));
      expect([...buildBirthdayIndex([lateLunar], year, hub).keys()]).toEqual([entry.nextLocalDate]);
    }
  });

  it('still resolves a distant future year without throwing', () => {
    const entry = upcoming.resolve(lateLunar, {
      userTimezone: 'Asia/Shanghai',
      now: new Date('2100-06-01T04:00:00Z'),
    });
    expect(entry.nextLocalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
