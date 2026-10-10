/**
 * Chinese lunar month names, for display in the form.
 *
 * Deliberately a client-local copy: the server's adapter module imports
 * `node:module` for the optional calendar library, and bundling that into the
 * browser bundle would break it outright.
 */

/** Month names in lunar order, 正月 first. */
export const LUNAR_MONTH_NAMES = [
  '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊',
] as const;

/**
 * Name of a lunar month number.
 * @param month - 1..12.
 * @returns The traditional name, falling back to the number when out of range.
 */
export function chineseMonthName(month: number): string {
  return LUNAR_MONTH_NAMES[month - 1] ?? String(month);
}
