/**
 * Almanac view helpers.
 *
 * `shiftMonth` is arithmetic on month numbers, and the edge cases are exactly
 * where a `Date`-based implementation goes wrong: `setMonth` rolls overflow
 * forward, so "31 March minus one month" silently becomes 3 March and the user
 * skips February.
 */

import { describe, it, expect } from 'vitest';
import {
  ALMANAC_MAX_YEAR,
  ALMANAC_MIN_YEAR,
  WEEKDAY_HEADERS,
  birthdayDateText,
  cellLabel,
  shiftMonth,
  type AlmanacBirthday,
  type AlmanacDay,
} from '../../src/client/almanacView.js';

function birthday(over: Partial<AlmanacBirthday> = {}): AlmanacBirthday {
  return {
    id: 1,
    name: '张三',
    relation: '朋友',
    gender: 'male',
    calendarSystem: 'gregorian',
    fields: { year: 1990, month: 3, day: 12 },
    turningAge: 36,
    degraded: false,
    ...over,
  };
}

function day(over: Partial<AlmanacDay> = {}): AlmanacDay {
  return {
    date: '2024-02-04',
    day: 4,
    weekday: 0,
    weekdayName: '日',
    isToday: false,
    isWeekend: true,
    lunarDayName: '廿五',
    lunarMonthName: '腊月',
    lunarText: '二〇二三年腊月廿五',
    lunarYear: 2023,
    lunarMonth: 12,
    lunarDay: 25,
    isLeapMonth: false,
    yearGanZhi: '癸卯',
    monthGanZhi: '丙寅',
    dayGanZhi: '戊戌',
    zodiac: '兔',
    jieQi: '',
    festivals: [],
    yi: [],
    ji: [],
    birthdays: [],
    ...over,
  };
}

describe('shiftMonth', () => {
  it('steps forward and back within a year', () => {
    expect(shiftMonth(2024, 2, 1)).toEqual({ year: 2024, month: 3 });
    expect(shiftMonth(2024, 2, -1)).toEqual({ year: 2024, month: 1 });
  });

  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth(2024, 12, 1)).toEqual({ year: 2025, month: 1 });
    expect(shiftMonth(2024, 1, -1)).toEqual({ year: 2023, month: 12 });
  });

  it('jumps whole years', () => {
    expect(shiftMonth(2024, 6, 12)).toEqual({ year: 2025, month: 6 });
    expect(shiftMonth(2024, 6, -12)).toEqual({ year: 2023, month: 6 });
  });

  it('never skips a month regardless of the day of month', () => {
    // The Date-based version of this is the bug this guards against.
    let cursor = { year: 2024, month: 3 };
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      cursor = shiftMonth(cursor.year, cursor.month, -1);
      seen.push(`${cursor.year}-${cursor.month}`);
    }
    expect(seen).toEqual(['2024-2', '2024-1', '2023-12', '2023-11', '2023-10']);
  });

  it('handles multi-year jumps and the range edges', () => {
    expect(shiftMonth(2024, 1, -25)).toEqual({ year: 2021, month: 12 });
    expect(shiftMonth(ALMANAC_MIN_YEAR, 1, 1)).toEqual({ year: 1900, month: 2 });
    expect(shiftMonth(ALMANAC_MAX_YEAR, 12, -1)).toEqual({ year: 2100, month: 11 });
  });

  it('always returns a month in 1-12', () => {
    for (let m = 1; m <= 12; m += 1) {
      for (const delta of [-13, -12, -1, 1, 12, 13]) {
        const r = shiftMonth(2024, m, delta);
        expect(r.month).toBeGreaterThanOrEqual(1);
        expect(r.month).toBeLessThanOrEqual(12);
        expect(Number.isInteger(r.year)).toBe(true);
      }
    }
  });
});

describe('cellLabel', () => {
  it('prefers a birthday above everything else', () => {
    // The plugin's own data is the reason the window exists, so it wins over
    // the almanac trivia a user can read in any calendar.
    expect(
      cellLabel(day({ birthdays: [birthday({ name: '李四' })], jieQi: '立春', festivals: ['春节'] })),
    ).toEqual({ text: '李四', kind: 'birthday' });
  });

  it('shows a count when several birthdays share a day', () => {
    expect(
      cellLabel(
        day({ birthdays: [birthday({ name: '张三' }), birthday({ id: 2, name: '李四' })] }),
      ),
    ).toEqual({ text: '张三 +1', kind: 'birthday' });
  });

  it('prefers a solar term', () => {
    expect(cellLabel(day({ jieQi: '立春', festivals: ['春节'] }))).toEqual({
      text: '立春',
      kind: 'jieqi',
    });
  });

  it('prefers a festival over the lunar day', () => {
    expect(cellLabel(day({ festivals: ['春节'] }))).toEqual({ text: '春节', kind: 'festival' });
  });

  it('falls back to the lunar day', () => {
    expect(cellLabel(day())).toEqual({ text: '廿五', kind: 'lunar' });
  });

  it('returns nothing when there is nothing to show', () => {
    expect(cellLabel(day({ lunarDayName: '' }))).toEqual({ text: '', kind: 'none' });
  });
});

describe('birthdayDateText', () => {
  it('renders a Gregorian birthday as entered', () => {
    expect(birthdayDateText(birthday(), '公历')).toBe('公历 3月12日');
  });

  it('marks a leap month', () => {
    expect(
      birthdayDateText(birthday({ calendarSystem: 'lunar', fields: { month: 4, day: 15, isLeapMonth: true } }), '中国农历'),
    ).toBe('中国农历 闰4月15日');
  });

  it('appends 时辰 when the record has one', () => {
    expect(
      birthdayDateText(birthday({ calendarSystem: 'lunar', fields: { month: 8, day: 15, shichen: '辰' } }), '中国农历'),
    ).toBe('中国农历 8月15日 辰时');
  });

  it('says so when the date fields are unusable', () => {
    expect(birthdayDateText(birthday({ fields: {} }), '公历')).toBe('公历 日期未知');
  });
});

describe('constants', () => {
  it('exposes the weekday headers Sunday-first', () => {
    expect(WEEKDAY_HEADERS).toEqual(['日', '一', '二', '三', '四', '五', '六']);
  });

  it('matches the server range', () => {
    expect(ALMANAC_MIN_YEAR).toBe(1900);
    expect(ALMANAC_MAX_YEAR).toBe(2100);
  });
});
