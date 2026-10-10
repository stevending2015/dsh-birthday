/**
 * 生肖 correctness.
 *
 * The rule that matters: 生肖 follows the **lunar** year, so a January date
 * before Chinese New Year belongs to the previous animal. A naive
 * `(gregorianYear - 4) % 12` gets these wrong, which is why the implementation
 * asks the calendar library for the year branch instead.
 */

import { describe, it, expect } from 'vitest';
import {
  BRANCH_TO_ANIMAL,
  shengxiaoFromBranch,
  shengxiaoFromGregorian,
} from '../../src/birthday/services/shengxiao.js';
import { createTimezoneService } from '../../src/calendar/timezone.js';

const tz = createTimezoneService();

const LUNAR = (iso: string, timezone = 'Asia/Shanghai') =>
  shengxiaoFromGregorian(iso, timezone, tz);

describe('branch table', () => {
  it('covers all twelve branches', () => {
    expect(Object.keys(BRANCH_TO_ANIMAL)).toHaveLength(12);
    expect(new Set(Object.values(BRANCH_TO_ANIMAL)).size).toBe(12);
  });

  it('maps the standard animals', () => {
    expect(shengxiaoFromBranch('子')).toBe('鼠');
    expect(shengxiaoFromBranch('午')).toBe('马');
    expect(shengxiaoFromBranch('亥')).toBe('猪');
    expect(shengxiaoFromBranch('？')).toBeUndefined();
  });
});

describe('shengxiaoFromGregorian', () => {
  it('resolves a Gregorian birthday through the lunar year', () => {
    // 1990-10-03 = 农历 1990 年八月十五, 庚午年 → 马.
    expect(LUNAR('1990-10-03')).toBe('马');
  });

  it('gives every calendar system an animal (Gregorian included)', () => {
    for (const iso of ['1995-03-12', '2000-01-01', '2020-06-06', '1988-12-25']) {
      expect(typeof LUNAR(iso)).toBe('string');
    }
  });

  it('uses the lunar year BEFORE Chinese New Year, not the Gregorian year', () => {
    // 20 Jan 1990 is still 农历 1989 (己巳, snake); 1990-02-10 is 庚午 (horse).
    expect(LUNAR('1990-01-20')).toBe('蛇');
    expect(LUNAR('1990-02-10')).toBe('马');
  });

  it('handles another pre-New-Year boundary', () => {
    // 2000-01-01 is still 农历 1999 (己卯, rabbit); 2000-06-06 is 庚辰 (dragon).
    expect(LUNAR('2000-01-01')).toBe('兔');
    expect(LUNAR('2000-06-06')).toBe('龙');
  });

  it('is independent of the birth timezone for the same calendar day', () => {
    expect(LUNAR('1990-10-03', 'America/Phoenix')).toBe('马');
    expect(LUNAR('1990-10-03', 'UTC')).toBe('马');
  });

  it('returns undefined rather than throwing outside the supported range', () => {
    expect(LUNAR('1200-01-01')).toBeUndefined();
    expect(LUNAR('nonsense')).toBeUndefined();
  });
});
