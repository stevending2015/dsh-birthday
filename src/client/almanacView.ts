/**
 * Almanac view model: the types the window renders, and the pure decisions it
 * makes. Kept out of the .tsx so both can be tested without JSX.
 */

/** A birthday landing on one day of the grid. */
export interface AlmanacBirthday {
  id?: number;
  name: string;
  relation?: string;
  gender?: string;
  calendarSystem: string;
  fields: Record<string, unknown>;
  /** Age they turn on this occurrence. */
  turningAge?: number;
  degraded: boolean;
  degradationReason?: string;
}

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
  /** Birthdays falling on this day. */
  birthdays: AlmanacBirthday[];
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
 * A birthday outranks everything: it is the plugin's own data and the reason the
 * window exists, so on a day that has one the cell says so instead of showing a
 * lunar day the user can read from any calendar.
 * @param day - the day to label.
 * @returns The text and which kind it is, for styling.
 */
export function cellLabel(day: AlmanacDay): {
  text: string;
  kind: 'birthday' | 'jieqi' | 'festival' | 'lunar' | 'none';
} {
  if (day.birthdays.length > 0) {
    // One name fits; more than one becomes a count so the cell stays readable.
    const first = day.birthdays[0];
    return {
      text: day.birthdays.length === 1 ? first.name : `${first.name} +${day.birthdays.length - 1}`,
      kind: 'birthday',
    };
  }
  if (day.jieQi !== '') return { text: day.jieQi, kind: 'jieqi' };
  if (day.festivals.length > 0) return { text: day.festivals[0], kind: 'festival' };
  if (day.lunarDayName !== '') return { text: day.lunarDayName, kind: 'lunar' };
  return { text: '', kind: 'none' };
}

/**
 * Render a birthday's date as entered, for the detail panel.
 *
 * Mirrors the wording the cards use, so the same record reads identically in
 * both places.
 * @param birthday - the marker from the grid.
 * @param calendarName - resolved display name of its calendar.
 * @returns e.g. `公历 3月12日`, `中国农历 八月十五`, `中国农历 闰四月十五`.
 */
export function birthdayDateText(birthday: AlmanacBirthday, calendarName: string): string {
  const fields = birthday.fields ?? {};
  const month = Number(fields.month);
  const day = Number(fields.day);
  const parts: string[] = [calendarName];
  if (Number.isFinite(month) && Number.isFinite(day)) {
    parts.push(`${fields.isLeapMonth === true ? '闰' : ''}${month}月${day}日`);
  } else {
    parts.push('日期未知');
  }
  if (typeof fields.shichen === 'string' && fields.shichen !== '') {
    parts.push(`${fields.shichen}时`);
  }
  return parts.join(' ');
}
