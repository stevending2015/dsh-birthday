/**
 * Almanac (万年历) data.
 *
 * Every expected value here was read off the library first and then asserted —
 * the leap-month naming in particular is a real regression: `getMonthInChinese`
 * already includes its own 闰 prefix, so adding one produced 闰闰四月.
 */

import { describe, it, expect } from 'vitest';
import { createCalendarEngine } from '../../src/calendar/index.js';
import { createTimezoneService } from '../../src/calendar/timezone.js';
import {
  ALMANAC_MAX_YEAR,
  ALMANAC_MIN_YEAR,
  buildAlmanacMonth,
  buildBirthdayIndex,
  daysInMonth,
  hasAlmanacLibrary,
} from '../../src/birthday/services/almanac.js';
import type { BirthdayRecord } from '../../src/birthday/models/birthday.js';

const tz = createTimezoneService();
const engine = createCalendarEngine({
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
});
const hub = engine.hub;

const month = (year: number, m: number, now = new Date('2024-02-04T12:00:00Z')) =>
  buildAlmanacMonth(year, m, 'Asia/Shanghai', tz, now);

const dayOf = (year: number, m: number, d: number, now?: Date) =>
  month(year, m, now).days.find((x) => x.day === d)!;

let nextId = 1;
function record(over: Partial<BirthdayRecord> = {}): BirthdayRecord {
  return {
    id: nextId++,
    name: '张三',
    calendarSystem: 'gregorian',
    fields: { year: 1990, month: 3, day: 12 },
    birthTimezone: 'Asia/Shanghai',
    gregorianLocalDate: '1990-03-12',
    ...over,
  } as BirthdayRecord;
}

describe('daysInMonth', () => {
  it('knows leap Februaries', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(31);
    expect(daysInMonth(2024, 4)).toBe(30);
  });
});

describe('month grid', () => {
  it('covers every day of the month with a correct weekday', () => {
    const feb = month(2024, 2);
    expect(feb.days).toHaveLength(29);
    // 2024-02-01 was a Thursday.
    expect(feb.firstWeekday).toBe(4);
    expect(feb.days[0].date).toBe('2024-02-01');
    expect(feb.days[0].weekday).toBe(4);
    expect(feb.days[0].weekdayName).toBe('四');
    expect(feb.days[28].date).toBe('2024-02-29');
  });

  it('marks weekends', () => {
    const feb = month(2024, 2);
    // 2024-02-03 was a Saturday, 02-04 a Sunday, 02-05 a Monday.
    expect(feb.days.find((d) => d.day === 3)?.isWeekend).toBe(true);
    expect(feb.days.find((d) => d.day === 4)?.isWeekend).toBe(true);
    expect(feb.days.find((d) => d.day === 5)?.isWeekend).toBe(false);
  });

  it('marks exactly one day as today, in the requested zone', () => {
    const feb = month(2024, 2, new Date('2024-02-04T12:00:00Z'));
    expect(feb.today).toBe('2024-02-04');
    expect(feb.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2024-02-04']);

    // 2024-02-04T20:00Z is already 02-05 in Shanghai but still 02-04 in UTC.
    const shanghai = buildAlmanacMonth(2024, 2, 'Asia/Shanghai', tz, new Date('2024-02-04T20:00:00Z'));
    const utc = buildAlmanacMonth(2024, 2, 'UTC', tz, new Date('2024-02-04T20:00:00Z'));
    expect(shanghai.today).toBe('2024-02-05');
    expect(utc.today).toBe('2024-02-04');
  });

  it('reports the almanac library as present in this environment', () => {
    expect(hasAlmanacLibrary()).toBe(true);
    expect(month(2024, 2).almanacAvailable).toBe(true);
    expect(month(2024, 2).note).toBeUndefined();
  });
});

describe('lunar fields', () => {
  it('converts a day to its 农历 name', () => {
    const d = dayOf(2024, 2, 4);
    expect(d.lunarText).toBe('二〇二三年腊月廿五');
    expect(d.lunarMonthName).toBe('腊月');
    expect(d.lunarDayName).toBe('廿五');
    expect(d.lunarYear).toBe(2023);
    expect(d.lunarMonth).toBe(12);
    expect(d.lunarDay).toBe(25);
    expect(d.isLeapMonth).toBe(false);
  });

  it('names the 11th month 冬月, not 十一月', () => {
    expect(dayOf(2024, 12, 21).lunarMonthName).toBe('冬月');
  });

  it('names the 1st month 正月 and reports the Spring Festival', () => {
    const d = dayOf(2024, 2, 10);
    expect(d.lunarMonthName).toBe('正月');
    expect(d.lunarDayName).toBe('初一');
    expect(d.festivals).toContain('春节');
  });

  it('names a leap month once, not twice', () => {
    // Regression: `getMonthInChinese()` already returns 闰四, so prefixing 闰
    // again produced 闰闰四月.
    const d = dayOf(2020, 6, 6);
    expect(d.isLeapMonth).toBe(true);
    expect(d.lunarMonth).toBe(4);
    expect(d.lunarMonthName).toBe('闰四月');
    expect(d.lunarMonthName).not.toContain('闰闰');
    expect(d.lunarText).toBe('二〇二〇年闰四月十五');
    expect(d.lunarDayName).toBe('十五');
  });

  it('carries the 干支 and the zodiac', () => {
    const lichun = dayOf(2024, 2, 4);
    expect(lichun.yearGanZhi).toBe('癸卯');
    expect(lichun.monthGanZhi).toBe('丙寅');
    expect(lichun.dayGanZhi).toBe('戊戌');
    expect(lichun.zodiac).toBe('兔');

    // The lunar year rolls over at the Spring Festival, not on 1 January.
    const newYear = dayOf(2024, 2, 10);
    expect(newYear.yearGanZhi).toBe('甲辰');
    expect(newYear.zodiac).toBe('龙');
  });
});

describe('solar terms', () => {
  it('puts 立春 on 2024-02-04', () => {
    expect(dayOf(2024, 2, 4).jieQi).toBe('立春');
  });

  it('lists the terms of the month in date order', () => {
    const feb = month(2024, 2);
    expect(feb.jieQi.map((j) => j.name)).toEqual(['立春', '雨水']);
    expect(feb.jieQi.map((j) => j.date)).toEqual(['2024-02-04', '2024-02-19']);
    // Every listed term really falls on a day in the grid.
    for (const term of feb.jieQi) {
      expect(feb.days.some((d) => d.date === term.date)).toBe(true);
    }
  });

  it('finds the other well-known terms of 2024', () => {
    expect(dayOf(2024, 3, 20).jieQi).toBe('春分');
    expect(dayOf(2024, 6, 21).jieQi).toBe('夏至');
    expect(dayOf(2024, 12, 21).jieQi).toBe('冬至');
  });

  it('leaves 节气 empty on ordinary days', () => {
    expect(dayOf(2024, 2, 5).jieQi).toBe('');
  });
});

describe('festivals', () => {
  it('collects the month’s festivals with their dates', () => {
    const feb = month(2024, 2);
    const names = feb.festivals.map((f) => f.name);
    expect(names).toContain('春节');
    expect(feb.festivals.find((f) => f.name === '春节')?.date).toBe('2024-02-10');
  });

  it('includes Gregorian holidays', () => {
    const oct = month(2024, 10);
    expect(oct.festivals.find((f) => f.name === '国庆节')?.date).toBe('2024-10-01');
  });

  it('reports 中秋节 on the 15th of the 8th lunar month', () => {
    const d = dayOf(2024, 9, 17);
    expect(d.lunarMonthName).toBe('八月');
    expect(d.lunarDayName).toBe('十五');
    expect(d.festivals).toContain('中秋节');
  });
});

describe('almanac advice', () => {
  it('carries 宜 and 忌 for a day', () => {
    const d = dayOf(2024, 2, 10);
    expect(d.yi).toContain('嫁娶');
    expect(Array.isArray(d.ji)).toBe(true);
    expect(d.ji.length).toBeGreaterThan(0);
  });
});

describe('birthdays on the grid', () => {
  it('places a Gregorian birthday on its day', () => {
    const index = buildBirthdayIndex([record()], 2024, hub);
    const march = buildAlmanacMonth(2024, 3, 'Asia/Shanghai', tz, new Date('2024-03-01T00:00:00Z'), index);
    const day = march.days.find((d) => d.day === 12)!;
    expect(day.birthdays.map((b) => b.name)).toEqual(['张三']);
    expect(day.birthdays[0].turningAge).toBe(34);
    // And nowhere else.
    expect(march.days.filter((d) => d.birthdays.length > 0)).toHaveLength(1);
  });

  it('resolves a lunar birthday to this year’s Gregorian day', () => {
    // 农历八月十五 in 2024 falls on 2024-09-17.
    const index = buildBirthdayIndex(
      [record({ calendarSystem: 'lunar', fields: { year: 1990, month: 8, day: 15 } })],
      2024,
      hub,
    );
    expect([...index.keys()]).toEqual(['2024-09-17']);
  });

  it('agrees with the upcoming service for the same record', () => {
    // The grid must not disagree with the cards about when a birthday is.
    const rec = record({ calendarSystem: 'lunar', fields: { year: 1990, month: 8, day: 15 } });
    const index = buildBirthdayIndex([rec], 2024, hub);
    const annual = hub.resolveAnnual(rec.calendarSystem, rec.fields, 2024, rec.birthTimezone);
    expect([...index.keys()]).toEqual([annual.localDate]);
  });

  it('keeps a leap-month birthday visible in a year without that month', () => {
    // 闰四月 exists in 2020 but not 2021; the record must degrade, not vanish.
    const rec = record({
      calendarSystem: 'lunar',
      fields: { year: 1990, month: 4, day: 15, isLeapMonth: true },
      gregorianLocalDate: '1990-06-07',
    });
    const index = buildBirthdayIndex([rec], 2021, hub);
    expect(index.size).toBe(1);
    const marker = [...index.values()][0][0];
    expect(marker.name).toBe('张三');
    expect(marker.degraded).toBe(true);
  });

  it('lists every birthday in the month in date order', () => {
    const people = [
      record({ name: '三月生', fields: { year: 1990, month: 3, day: 20 } }),
      record({ name: '三月初', fields: { year: 1988, month: 3, day: 5 } }),
    ];
    const index = buildBirthdayIndex(people, 2024, hub);
    const march = buildAlmanacMonth(2024, 3, 'Asia/Shanghai', tz, new Date('2024-03-01T00:00:00Z'), index);
    expect(march.birthdays.map((b) => b.name)).toEqual(['三月初', '三月生']);
    expect(march.birthdays.map((b) => b.day)).toEqual([5, 20]);
  });

  it('is empty when there are no records', () => {
    const index = buildBirthdayIndex([], 2024, hub);
    const march = buildAlmanacMonth(2024, 3, 'Asia/Shanghai', tz, new Date('2024-03-01T00:00:00Z'), index);
    expect(march.birthdays).toEqual([]);
    expect(march.days.every((d) => d.birthdays.length === 0)).toBe(true);
  });

  it('leaves months without a birthday untouched', () => {
    const index = buildBirthdayIndex([record()], 2024, hub);
    const april = buildAlmanacMonth(2024, 4, 'Asia/Shanghai', tz, new Date('2024-04-01T00:00:00Z'), index);
    expect(april.birthdays).toEqual([]);
  });

  it('survives a record the calendar cannot resolve', () => {
    const broken = record({ calendarSystem: 'mayan' as never });
    const good = record({ name: '好的' });
    const index = buildBirthdayIndex([broken, good], 2024, hub);
    expect([...index.values()].flat().map((b) => b.name)).toEqual(['好的']);
  });

  it('carries the entered date so the client can render it', () => {
    const index = buildBirthdayIndex(
      [record({ calendarSystem: 'lunar', fields: { year: 1990, month: 8, day: 15, shichen: '辰' } })],
      2024,
      hub,
    );
    const marker = [...index.values()][0][0];
    expect(marker.calendarSystem).toBe('lunar');
    expect(marker.fields).toMatchObject({ month: 8, day: 15, shichen: '辰' });
  });

  it('works without an index at all', () => {
    const march = month(2024, 3);
    expect(march.birthdays).toEqual([]);
    expect(march.days.every((d) => d.birthdays.length === 0)).toBe(true);
  });
});

describe('validation', () => {
  it('rejects years outside the supported range', () => {
    expect(() => month(ALMANAC_MIN_YEAR - 1, 1)).toThrow(/年份/);
    expect(() => month(ALMANAC_MAX_YEAR + 1, 1)).toThrow(/年份/);
    expect(() => month(1900.5, 1)).toThrow(/年份/);
  });

  it('rejects invalid months', () => {
    expect(() => month(2024, 0)).toThrow(/月份/);
    expect(() => month(2024, 13)).toThrow(/月份/);
  });

  it('accepts the boundary years', () => {
    expect(month(ALMANAC_MIN_YEAR, 1).days.length).toBe(31);
    expect(month(ALMANAC_MAX_YEAR, 12).days.length).toBe(31);
  });
});

describe('invariants across many months', () => {
  it('always returns one entry per day with a valid date and weekday', () => {
    for (let y = 2023; y <= 2025; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const built = month(y, m);
        expect(built.days).toHaveLength(daysInMonth(y, m));
        for (const d of built.days) {
          expect(d.date).toBe(
            `${y}-${String(m).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
          );
          expect(d.weekday).toBe(new Date(Date.UTC(y, m - 1, d.day)).getUTCDay());
          expect(d.weekdayName).toBe(['日', '一', '二', '三', '四', '五', '六'][d.weekday]);
          // A real lunar conversion always produced a day name here.
          expect(d.lunarDayName.length).toBeGreaterThan(0);
        }
        expect(built.firstWeekday).toBe(new Date(Date.UTC(y, m - 1, 1)).getUTCDay());
      }
    }
  });
});
