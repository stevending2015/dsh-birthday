/**
 * BirthdayService — orchestrator that ties adapter validation, store CRUD,
 * zodiac/wuxing enrichment, and reminder scheduling together.
 */

import type { CalendarFields } from '../../calendar/types.js';
import type { GregorianHub } from '../../calendar/hub.js';
import { BirthdayInput, BirthdayRecord, Gender } from '../models/birthday.js';
import { BirthdayStore, BirthdayRow } from '../db.js';
import { computeZodiac } from './zodiac.js';
import { computeWuxing } from './wuxing.js';
import { shengxiaoFromGregorian } from './shengxiao.js';
import { ReminderService } from './reminder.js';
import { InvalidDateError } from '../../calendar/errors.js';

/**
 * Derive the enrichment fields from a resolved Gregorian local date.
 *
 * The month AND day both matter: reading only the month silently mislabels
 * every birthday that falls after a sign boundary (e.g. 24 Oct is Scorpio,
 * not Libra).
 * @param gregorianLocalDate - `YYYY-MM-DD` in the birth timezone.
 * @param timezone - the birth timezone; anchors the lunar day for 生肖.
 * @param hub - calendar hub, used for the Gregorian→lunar conversion.
 * @returns The stored zodiac sign, wuxing histogram, and zodiac animal.
 */
function enrichFromGregorian(
  gregorianLocalDate: string,
  timezone: string,
  hub: GregorianHub,
): {
  zodiacSign: string;
  wuxingSummary: string;
  shengxiao?: string;
} {
  const month = Number(gregorianLocalDate.slice(5, 7));
  const day = Number(gregorianLocalDate.slice(8, 10));
  return {
    zodiacSign: computeZodiac(month, day).sign,
    wuxingSummary: computeWuxing(month).bars,
    // 生肖 always comes from the lunar year, so a Gregorian birthday gets one
    // too. Undefined when the lunar library is unavailable or out of range.
    shengxiao: shengxiaoFromGregorian(gregorianLocalDate, timezone, hub.timezone),
  };
}

/**
 * Read the 时辰 out of a record's calendar fields.
 * 时辰 is optional and only some calendars (the Chinese one) define it, so it
 * lives inside `fields` and is mirrored into its own column for querying.
 * @param fields - the stored calendar fields.
 * @returns The 时辰, or null when unset.
 */
function shichenOf(fields: CalendarFields): string | null {
  const value = fields.shichen;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Resolve an optional free-text patch field.
 *
 * Three cases must stay distinct:
 *   - the field is absent (`undefined`) → keep whatever is stored;
 *   - the field is empty (`''`)          → clear it;
 *   - the field has text                 → store the trimmed text.
 * @param incoming - the patch value, possibly absent.
 * @param current - the stored value.
 * @returns The value to store, or undefined when it should be cleared.
 */
function resolveOptional(
  incoming: string | undefined,
  current: string | undefined,
): string | undefined {
  if (incoming === undefined) return current;
  const trimmed = incoming.trim();
  return trimmed === '' ? undefined : trimmed;
}

function rowToRecord(row: BirthdayRow): BirthdayRecord {
  return {
    id: row.id!,
    name: row.name,
    gender: (row.gender as Gender | null | undefined) ?? undefined,
    calendarSystem: row.calendar_system,
    fields: JSON.parse(row.input_date_json) as CalendarFields,
    birthTimezone: row.birth_timezone,
    gregorianLocalDate: row.gregorian_local_date,
    birthdayStartUtc: row.birthday_start_utc,
    shichen: row.shichen ?? undefined,
    zodiacSign: row.zodiac_sign ?? undefined,
    shengxiao: row.shengxiao ?? undefined,
    wuxingSummary: row.wuxing_summary ?? undefined,
    annualDegradation: row.annual_degradation ?? undefined,
    relation: row.relation ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

export class BirthdayService {
  constructor(
    private readonly hub: GregorianHub,
    private readonly store: BirthdayStore,
    private readonly reminders: ReminderService,
  ) {}

  list(): BirthdayRecord[] {
    return this.store.list().map(rowToRecord);
  }

  get(id: number): BirthdayRecord | undefined {
    const row = this.store.get(id);
    return row ? rowToRecord(row) : undefined;
  }

  async add(input: BirthdayInput): Promise<BirthdayRecord> {
    const validation = this.hub.validate(input.calendarSystem, input.fields);
    if (!validation.valid) {
      throw new InvalidDateError(input.calendarSystem, validation.errors.join('; '));
    }
    const g = this.hub.toGregorian(
      input.calendarSystem,
      validation.adjustedFields ?? input.fields,
      input.birthTimezone,
    );
    const enrichment = enrichFromGregorian(g.localDate, input.birthTimezone, this.hub);

    const id = this.store.insert({
      name: input.name,
      gender: input.gender ?? null,
      shengxiao: enrichment.shengxiao ?? null,
      calendar_system: input.calendarSystem,
      input_date_json: JSON.stringify(validation.adjustedFields ?? input.fields),
      birth_timezone: input.birthTimezone,
      gregorian_local_date: g.localDate,
      birthday_start_utc: g.startUtc,
      zodiac_sign: enrichment.zodiacSign,
      wuxing_summary: enrichment.wuxingSummary,
      annual_degradation: validation.warnings.join('; ') || null,
      relation: resolveOptional(input.relation, undefined) ?? null,
      note: resolveOptional(input.note, undefined) ?? null,
      shichen: shichenOf(validation.adjustedFields ?? input.fields),
    });
    const record = this.get(id)!;
    await this.reminders.sync(record);
    return record;
  }

  async update(id: number, patch: Partial<BirthdayInput>): Promise<BirthdayRecord | undefined> {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged: BirthdayInput = {
      name: patch.name ?? existing.name,
      gender: patch.gender ?? existing.gender,
      calendarSystem: patch.calendarSystem ?? existing.calendarSystem,
      fields: patch.fields ?? existing.fields,
      birthTimezone: patch.birthTimezone ?? existing.birthTimezone,
      // Absent means "leave it alone"; an empty string means "remove it". Using
      // `??` alone makes those two indistinguishable, so a cleared note or
      // relation would keep its old value forever.
      relation: resolveOptional(patch.relation, existing.relation),
      note: resolveOptional(patch.note, existing.note),
    };
    const validation = this.hub.validate(merged.calendarSystem, merged.fields);
    if (!validation.valid) {
      throw new InvalidDateError(merged.calendarSystem, validation.errors.join('; '));
    }
    const g = this.hub.toGregorian(
      merged.calendarSystem,
      validation.adjustedFields ?? merged.fields,
      merged.birthTimezone,
    );
    const enrichment = enrichFromGregorian(g.localDate, merged.birthTimezone, this.hub);

    this.store.update(id, {
      name: merged.name,
      gender: merged.gender ?? null,
      shengxiao: enrichment.shengxiao ?? null,
      calendar_system: merged.calendarSystem,
      input_date_json: JSON.stringify(validation.adjustedFields ?? merged.fields),
      birth_timezone: merged.birthTimezone,
      gregorian_local_date: g.localDate,
      birthday_start_utc: g.startUtc,
      zodiac_sign: enrichment.zodiacSign,
      wuxing_summary: enrichment.wuxingSummary,
      annual_degradation: validation.warnings.join('; ') || null,
      relation: merged.relation ?? null,
      note: merged.note ?? null,
      shichen: shichenOf(validation.adjustedFields ?? merged.fields),
    });
    const updated = this.get(id)!;
    await this.reminders.sync(updated);
    return updated;
  }

  async remove(id: number): Promise<boolean> {
    const exists = this.store.get(id);
    if (!exists) return false;
    this.store.remove(id);
    await this.reminders.cancel(id);
    return true;
  }

  /**
   * Fill enrichment fields for rows stored before a column existed, and repair
   * a zodiac recorded by the old month-only lookup. Cheap: it only writes rows
   * that are actually missing something, and runs once at activation.
   * @returns How many rows were updated.
   */
  backfillEnrichment(): number {
    let updated = 0;
    for (const row of this.store.list()) {
      const gregorian = row.gregorian_local_date;
      if (typeof gregorian !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gregorian)) continue;

      const month = Number(gregorian.slice(5, 7));
      const day = Number(gregorian.slice(8, 10));
      const patch: Partial<BirthdayRow> = {};

      const hasShengxiao = row.shengxiao !== undefined && row.shengxiao !== null && row.shengxiao !== '';
      if (!hasShengxiao) {
        const animal = shengxiaoFromGregorian(gregorian, row.birth_timezone, this.hub.timezone);
        if (animal !== undefined) patch.shengxiao = animal;
      }
      const sign = computeZodiac(month, day).sign;
      if (row.zodiac_sign !== sign) patch.zodiac_sign = sign;
      if (row.wuxing_summary === undefined || row.wuxing_summary === null || row.wuxing_summary === '') {
        patch.wuxing_summary = computeWuxing(month).bars;
      }

      if (Object.keys(patch).length > 0) {
        this.store.update(row.id!, patch);
        updated += 1;
      }
    }
    return updated;
  }
}
