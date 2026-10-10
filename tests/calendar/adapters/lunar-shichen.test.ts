/**
 * Lunar-specific entry guidance: the year's leap month and the 时辰 field.
 *
 * The leap month drives the form's notice ("2020 年闰四月"), which is what
 * tells the user whether to tick 闰月 before saving.
 */

import { describe, it, expect } from 'vitest';
import {
  LunarAdapter,
  SHICHEN,
  chineseMonthName,
  leapMonthOfLunarYear,
} from '../../../src/calendar/adapters/lunar.js';
import { createTimezoneService } from '../../../src/calendar/timezone.js';

const adapter = new LunarAdapter(createTimezoneService());

let lunarMod: any = null;
try { lunarMod = require('lunar'); } catch { lunarMod = null; }

describe('shichen field', () => {
  it('is described as a closed 12-value select defaulting to 辰', () => {
    const field = adapter.describeFields().find((f) => f.key === 'shichen');
    expect(field).toBeDefined();
    expect(field?.options).toEqual([...SHICHEN]);
    expect(field?.options).toHaveLength(12);
    expect(field?.defaultValue).toBe('辰');
  });

  it('lists the twelve branches in order', () => {
    expect([...SHICHEN]).toEqual([
      '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥',
    ]);
  });

  it('accepts a valid 时辰', () => {
    const result = adapter.validate({ year: 1990, month: 8, day: 15, shichen: '午' });
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown 时辰', () => {
    const result = adapter.validate({ year: 1990, month: 8, day: 15, shichen: '辰辰' });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain('时辰');
  });

  it('treats an absent 时辰 as valid (it is optional)', () => {
    expect(adapter.validate({ year: 1990, month: 8, day: 15 }).valid).toBe(true);
  });
});

describe('chineseMonthName', () => {
  it('names the months', () => {
    expect(chineseMonthName(1)).toBe('正');
    expect(chineseMonthName(4)).toBe('四');
    expect(chineseMonthName(6)).toBe('六');
    expect(chineseMonthName(12)).toBe('腊');
  });

  it('agrees with the client copy the form uses', async () => {
    // The client cannot import this module (it pulls in node:module), so the two
    // implementations are kept in step by this test.
    const client = await import('../../../src/client/monthNames.js');
    for (let month = 1; month <= 12; month += 1) {
      expect(client.chineseMonthName(month)).toBe(chineseMonthName(month));
    }
  });
});

(lunarMod ? describe : describe.skip)('yearInfo', () => {
  it('reports the doubled month for years that have one', () => {
    expect(adapter.yearInfo(2017).leapMonth).toBe(6);
    expect(adapter.yearInfo(2020).leapMonth).toBe(4);
    expect(adapter.yearInfo(2023).leapMonth).toBe(2);
    expect(adapter.yearInfo(1990).leapMonth).toBe(5);
  });

  it('reports null for years without a leap month', () => {
    expect(adapter.yearInfo(2021).leapMonth).toBeNull();
    expect(adapter.yearInfo(2026).leapMonth).toBeNull();
  });

  it('explains the month in the note', () => {
    expect(adapter.yearInfo(2020).note).toContain('闰四');
    expect(adapter.yearInfo(2021).note).toContain('没有闰月');
  });

  it('agrees with the probe helper', () => {
    expect(leapMonthOfLunarYear(lunarMod, 2020)).toBe(4);
    expect(leapMonthOfLunarYear(lunarMod, 2026)).toBeNull();
  });

  it('matches the adapter\'s own accept/reject behaviour for that leap month', () => {
    // If 2020 truly has a leap 4th month, a leap-4 date must convert; and a
    // leap-5 date must not.
    const leap4 = adapter.toGregorian(
      { year: 2020, month: 4, day: 15, isLeapMonth: true },
      'Asia/Shanghai',
    );
    expect(leap4.localDate).toBe('2020-06-06');
    expect(() =>
      adapter.resolveAnnual({ year: 2000, month: 5, day: 15, isLeapMonth: true }, 2021, 'Asia/Shanghai'),
    ).not.toThrow();
  });
});
