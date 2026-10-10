/**
 * "Upcoming birthdays" service.
 *
 * For each stored record we:
 *   1. ask the hub to resolve the next occurrence (this year or next year);
 *   2. compute whether the user and birth timezone share the same UTC offset
 *      at the birthday moment;
 *   3. derive a user-action instant (default 09:00 local in the user zone).
 */

import type { BirthdayRecord } from '../models/birthday.js';
import type { AnnualResult, CalendarFields } from '../../calendar/types.js';
import type { GregorianHub, UpcomingEntry } from '../../calendar/hub.js';

export interface UpcomingQuery {
  /** The "now" anchor. Defaults to Date.now(). */
  now?: Date;
  /** User's IANA timezone. */
  userTimezone: string;
  /** Hour-of-day the user wants to be reminded (default 9). */
  userReminderHour?: number;
  /** How far ahead to look. */
  horizonDays?: number;
}

export class UpcomingService {
  constructor(private readonly hub: GregorianHub) {}

  resolve(
    record: BirthdayRecord,
    query: UpcomingQuery,
  ): UpcomingEntry {
    const now = query.now ?? new Date();
    const userTz = query.userTimezone;
    const userHour = query.userReminderHour ?? 9;

    /**
     * Pick the earliest occurrence that has not already passed in the birth
     * timezone.
     *
     * Two things this gets right that resolving a single year does not:
     *
     *  - The target year is NOT the Gregorian year for every calendar. 农历 N 年
     *    腊月 falls in January or February of N+1, so resolving only the current
     *    year skips the imminent occurrence and reports one a year late
     *    (measured: on 2027-01-10 the 腊月 birthday of 2027-01-25 was reported
     *    as 2028-01-14).
     *  - The comparison is by LOCAL DATE, not by instant. Comparing `startUtc`
     *    with `now` treats the birthday itself as already past, because its
     *    00:00 has gone by, so the card showed next year's date on the day.
     */
    const today = this.hub.timezone.formatLocalDate(now, record.birthTimezone);
    const targetYear = Number(today.slice(0, 4));

    let annual: AnnualResult | undefined;
    for (const target of [targetYear - 1, targetYear, targetYear + 1]) {
      try {
        const candidate = this.hub.resolveAnnual(
          record.calendarSystem,
          record.fields,
          target,
          record.birthTimezone,
        );
        const earlier = annual === undefined || candidate.localDate < annual.localDate;
        if (candidate.localDate >= today && earlier) annual = candidate;
      } catch {
        // Out-of-range target, or a record this calendar cannot resolve.
      }
    }
    // Unreachable in practice (targetYear + 1 is always ahead), but a card must
    // always render, so fall back rather than throw.
    annual ??= this.hub.resolveAnnual(
      record.calendarSystem,
      record.fields,
      targetYear + 1,
      record.birthTimezone,
    );

    const sameOffset = this.hub.timezone.sameOffset(annual.startUtc, userTz, record.birthTimezone);
    const userActionUtc = this.hub.userActionInstant(annual.startUtc, userTz, userHour);

    return {
      id: record.id,
      name: record.name,
      relation: record.relation,
      gender: record.gender,
      note: record.note,
      calendarSystem: record.calendarSystem,
      fields: record.fields,
      fieldsDescription: this.hub
        .listCalendars()
        .find((c) => c.id === record.calendarSystem)?.fields ?? [],
      nextLocalDate: annual.localDate,
      gregorianLocalDate: record.gregorianLocalDate,
      nextStartUtc: annual.startUtc,
      userActionUtc,
      sameOffset,
      birthTimezone: record.birthTimezone,
      zodiacSign: record.zodiacSign,
      shengxiao: record.shengxiao,
      shichen: record.shichen,
      wuxingSummary: record.wuxingSummary,
      degraded: annual.degraded,
      degradationReason: annual.degradationReason,
    };
  }

  resolveAll(records: BirthdayRecord[], query: UpcomingQuery): UpcomingEntry[] {
    const entries = records.map((r) => this.resolve(r, query));
    return entries.sort(
      (a, b) => new Date(a.nextStartUtc).getTime() - new Date(b.nextStartUtc).getTime(),
    );
  }
}

export type { CalendarFields, UpcomingEntry };
