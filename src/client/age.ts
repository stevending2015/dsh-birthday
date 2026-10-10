/**
 * Age calculation.
 *
 * Age is "completed years", so it depends on whether this year's birthday has
 * happened yet in the relevant timezone — a naive `now.year - birth.year`
 * overstates by one for most of the year.
 */

/** Calendar date parts in some timezone. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Read the calendar date at one instant, in a zone.
 * @param at - the instant.
 * @param timeZone - IANA zone; defaults to the runtime zone.
 * @returns The local calendar date.
 */
export function datePartsIn(at: Date, timeZone?: string): DateParts {
  if (timeZone === undefined || timeZone === '') {
    return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 'NaN');
    const result = { year: read('year'), month: read('month'), day: read('day') };
    if (Number.isNaN(result.year) || Number.isNaN(result.month) || Number.isNaN(result.day)) {
      return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() };
    }
    return result;
  } catch {
    return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() };
  }
}

/**
 * Completed years between a birth date and a reference date.
 *
 * A 29 Feb birthday is treated as having its birthday on 1 Mar in non-leap
 * years, which is the common civil convention.
 * @param birthLocalDate - `YYYY-MM-DD` of birth.
 * @param now - the reference date parts (today, in the same zone as the birth date).
 * @returns Completed years, or undefined when the birth date is unreadable or in the future.
 */
export function computeAge(birthLocalDate: string, now: DateParts): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthLocalDate ?? '');
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;

  let age = now.year - year;
  // Has this year's birthday already happened?
  const beforeBirthday =
    now.month < month || (now.month === month && now.day < day);
  if (beforeBirthday) age -= 1;

  return age < 0 ? undefined : age;
}

/**
 * Render an age for display.
 * @param age - completed years, or undefined when unknown.
 * @returns e.g. `28 岁`, or '' when unknown.
 */
export function formatAge(age: number | undefined): string {
  if (age === undefined) return '';
  return `${age} 岁`;
}
