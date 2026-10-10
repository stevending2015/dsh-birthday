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
import type { CalendarFields } from '../../calendar/types.js';
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

    const targetYear = now.getUTCFullYear();
    let annual = this.hub.resolveAnnual(
      record.calendarSystem,
      record.fields,
      targetYear,
      record.birthTimezone,
    );

    // If the next occurrence is already in the past, try next year.
    if (new Date(annual.startUtc).getTime() < now.getTime()) {
      annual = this.hub.resolveAnnual(
        record.calendarSystem,
        record.fields,
        targetYear + 1,
        record.birthTimezone,
      );
    }

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
