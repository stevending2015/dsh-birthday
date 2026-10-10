/**
 * Almanac view model: the types the window renders, and the two pure decisions
 * it makes. Kept out of the .tsx so both can be tested without JSX.
 */

/** One day, as returned by `GET /api/birthday/almanac`. */
export interface AlmanacDay {
  date: string;
  day: number;
  weekday: number;
  weekdayName: string;
  isToday: boolean;
  isWeekend: boolean;
  lunarDayName: string;
  lunarMonthName: string;
  lunarText: string;
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  yearGanZhi: string;
  monthGanZhi: string;
  dayGanZhi: string;
  zodiac: string;
  jieQi: string;
  festivals: string[];
  yi: string[];
  ji: string[];
}

/** A whole month, ready to render as a grid. */
export interface AlmanacMonth {
  year: number;
  month: number;
  timezone: string;
  today: string;
  firstWeekday: number;
  days: AlmanacDay[];
  jieQi: Array<{ name: string; date: string; day: number }>;
  festivals: Array<{ name: string; date: string; day: number }>;
  almanacAvailable: boolean;
  note?: string;
}

/** Supported year range, mirroring the server. */
export const ALMANAC_MIN_YEAR = 1900;
export const ALMANAC_MAX_YEAR = 2100;

/** Column headers, Sunday first. */
export const WEEKDAY_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * Shift a year/month pair by whole months.
 *
 * Done in month numbers rather than with `Date`, because `setMonth` rolls
 * overflow forward (31 Jan minus one month becomes 31 Dec, but 31 Mar minus one
 * month becomes 3 Mar) and would silently skip months in the UI.
 * @param year - current year.
 * @param month - current month, 1-12.
 * @param delta - months to add, negative to go back.
 * @returns The shifted pair.
 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: ((zeroBased % 12) + 12) % 12 + 1 };
}

/**
 * The small label under a day number.
 *
 * A solar term outranks a festival, which outranks the lunar day — the
 * convention every Chinese 万年历 uses, because the rarer item is the one worth
 * reading at a glance.
 * @param day - the day to label.
 * @returns The text and which kind it is, for styling.
 */
export function cellLabel(day: AlmanacDay): {
  text: string;
  kind: 'jieqi' | 'festival' | 'lunar' | 'none';
} {
  if (day.jieQi !== '') return { text: day.jieQi, kind: 'jieqi' };
  if (day.festivals.length > 0) return { text: day.festivals[0], kind: 'festival' };
  if (day.lunarDayName !== '') return { text: day.lunarDayName, kind: 'lunar' };
  return { text: '', kind: 'none' };
}
