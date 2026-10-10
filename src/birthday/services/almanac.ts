/**
 * Almanac (万年历) data for the calendar window.
 *
 * Two libraries are in play, deliberately:
 *
 *   - `lunar` (v2) powers the calendar adapters. It is deliberately minimal —
 *     conversion only — and has no solar terms, festivals or 宜忌.
 *   - `lunar-javascript` supplies exactly those extras. Reimplementing the 24
 *     solar terms and the almanac tables by hand would be far more code and far
 *     less accurate.
 *
 * The second is optional: without it the grid still renders with Gregorian
 * dates only, and `note` explains what is missing.
 */

import { createRequire } from 'node:module';
import type { TimezoneService } from '../../calendar/timezone.js';

const nodeRequire = createRequire(import.meta.url);

/** The slice of `lunar-javascript` this module uses. */
interface SolarLike {
  getWeek(): number;
  getWeekInChinese(): string;
  getFestivals(): string[];
  toYmd(): string;
  getLunar(): LunarLike;
}
interface LunarLike {
  getYear(): number;
  getMonth(): number;
  getDay(): number;
  getDayInChinese(): string;
  getMonthInChinese(): string;
  getYearInGanZhi(): string;
  getMonthInGanZhi(): string;
  getDayInGanZhi(): string;
  getYearShengXiao(): string;
  getJieQi(): string;
  getFestivals(): string[];
  getDayYi(): string[];
  getDayJi(): string[];
  toString(): string;
}
interface AlmanacModule {
  Solar: { fromYmd(year: number, month: number, day: number): SolarLike };
}

let almanacMod: AlmanacModule | null = null;
try {
  // Loaded lazily and optionally, exactly like the calendar adapters, so a host
  // without the package still activates.
  almanacMod = nodeRequire('lunar-javascript') as AlmanacModule;
} catch {
  almanacMod = null;
}

/** Whether the almanac extras (农历/节气/宜忌) are available on this host. */
export function hasAlmanacLibrary(): boolean {
  return almanacMod !== null;
}

/** Supported year range, matching the bundled lunar data. */
export const ALMANAC_MIN_YEAR = 1900;
export const ALMANAC_MAX_YEAR = 2100;

/** One day in the month grid. */
export interface AlmanacDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Gregorian day of month. */
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  /** 日 / 一 / … / 六. */
  weekdayName: string;
  isToday: boolean;
  isWeekend: boolean;
  /** 初一…三十, empty when the almanac library is unavailable. */
  lunarDayName: string;
  /** 正 / 二 / … / 腊, with 闰 prefixed for a leap month. */
  lunarMonthName: string;
  /** Full 农历 text, e.g. 二〇二三年腊月廿五. */
  lunarText: string;
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  yearGanZhi: string;
  monthGanZhi: string;
  dayGanZhi: string;
  zodiac: string;
  /** Solar term falling on this day, or ''. */
  jieQi: string;
  /** Gregorian and lunar festivals, merged. */
  festivals: string[];
  /** Almanac advice. */
  yi: string[];
  /** Almanac warnings. */
  ji: string[];
}

/** A whole month, ready to render as a grid. */
export interface AlmanacMonth {
  year: number;
  month: number;
  timezone: string;
  /** Today's date in `timezone`. */
  today: string;
  /** Weekday of the 1st (0 = Sunday), for the leading blanks. */
  firstWeekday: number;
  days: AlmanacDay[];
  /** Solar terms in this month, in date order. */
  jieQi: Array<{ name: string; date: string; day: number }>;
  /** Festivals in this month, in date order. */
  festivals: Array<{ name: string; date: string; day: number }>;
  /** True when 农历/节气/宜忌 are included. */
  almanacAvailable: boolean;
  note?: string;
}

/** Days in a Gregorian month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Validate a requested month, loudly. */
function assertRange(year: number, month: number): void {
  if (!Number.isInteger(year) || year < ALMANAC_MIN_YEAR || year > ALMANAC_MAX_YEAR) {
    throw new Error(`年份需在 ${ALMANAC_MIN_YEAR}–${ALMANAC_MAX_YEAR} 之间，收到 ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`月份需在 1–12 之间，收到 ${month}`);
  }
}

/** `YYYY-MM-DD` with zero padding. */
function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * Build one month of almanac data.
 * @param year - Gregorian year.
 * @param month - Gregorian month, 1-12.
 * @param tz - IANA zone used to decide which day is "today".
 * @param timezone - the timezone service, for the local date.
 * @param now - reference instant, injectable for tests.
 * @returns The month, with the leading blank count needed for the grid.
 */
export function buildAlmanacMonth(
  year: number,
  month: number,
  tz: string,
  timezone: TimezoneService,
  now: Date = new Date(),
): AlmanacMonth {
  assertRange(year, month);

  const today = timezone.formatLocalDate(now, tz);
  const total = daysInMonth(year, month);
  const days: AlmanacDay[] = [];
  const jieQi: AlmanacMonth['jieQi'] = [];
  const festivals: AlmanacMonth['festivals'] = [];

  for (let day = 1; day <= total; day += 1) {
    const date = ymd(year, month, day);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const base: AlmanacDay = {
      date,
      day,
      weekday,
      weekdayName: WEEKDAY_NAMES[weekday],
      isToday: date === today,
      isWeekend: weekday === 0 || weekday === 6,
      lunarDayName: '',
      lunarMonthName: '',
      lunarText: '',
      lunarYear: 0,
      lunarMonth: 0,
      lunarDay: 0,
      isLeapMonth: false,
      yearGanZhi: '',
      monthGanZhi: '',
      dayGanZhi: '',
      zodiac: '',
      jieQi: '',
      festivals: [],
      yi: [],
      ji: [],
    };

    if (almanacMod !== null) {
      try {
        const solar = almanacMod.Solar.fromYmd(year, month, day);
        const lunar = solar.getLunar();
        base.lunarDayName = lunar.getDayInChinese();
        // A leap month is a NEGATIVE month number, and `getMonthInChinese`
        // already carries its own 闰 prefix (闰四, not 四). Adding one here too
        // produced 闰闰四月, so the prefix is left to the library.
        const leap = lunar.getMonth() < 0;
        base.lunarMonthName = `${lunar.getMonthInChinese()}月`;
        base.lunarText = lunar.toString();
        base.lunarYear = Math.abs(lunar.getYear());
        base.lunarMonth = Math.abs(lunar.getMonth());
        base.lunarDay = lunar.getDay();
        base.isLeapMonth = leap;
        base.yearGanZhi = lunar.getYearInGanZhi();
        base.monthGanZhi = lunar.getMonthInGanZhi();
        base.dayGanZhi = lunar.getDayInGanZhi();
        base.zodiac = lunar.getYearShengXiao();
        base.jieQi = lunar.getJieQi() ?? '';
        base.festivals = [...new Set([...solar.getFestivals(), ...lunar.getFestivals()])];
        base.yi = lunar.getDayYi();
        base.ji = lunar.getDayJi();

        if (base.jieQi !== '') jieQi.push({ name: base.jieQi, date, day });
        for (const name of base.festivals) festivals.push({ name, date, day });
      } catch {
        // A single unconvertible day must not blank the whole month.
      }
    }

    days.push(base);
  }

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return {
    year,
    month,
    timezone: tz,
    today,
    firstWeekday,
    days,
    jieQi,
    festivals,
    almanacAvailable: almanacMod !== null,
    ...(almanacMod === null
      ? { note: '未安装 lunar-javascript：仅显示公历，农历/节气/宜忌不可用。' }
      : {}),
  };
}
