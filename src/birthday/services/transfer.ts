/**
 * Export and import of the birthday library.
 *
 * JSON is the single transfer format, in both directions. The envelope carries
 * the *source of truth* (which calendar, the fields in that calendar, the birth
 * timezone) and marks the derived values as reference-only. Import therefore
 * RECOMPUTES the derived values instead of trusting them, so a file written by
 * an older version — or a hand-edited one — still lands correctly.
 *
 * One format means an export can always be imported back, with no lossy or
 * ambiguous intermediate.
 */

import type { CalendarFields } from '../../calendar/types.js';
import type { GregorianHub } from '../../calendar/hub.js';
import type { BirthdayRecord } from '../models/birthday.js';
import type { BirthdayService } from './birthday-service.js';

/** Marker identifying our own export files. */
export const EXPORT_FORMAT = 'dsh-birthday-export';
/** Envelope schema version; bump when the shape changes incompatibly. */
export const EXPORT_VERSION = 1;

/** One birthday as it travels: editable facts plus read-only references. */
export interface ExportedBirthday {
  name: string;
  gender?: string;
  relation?: string;
  note?: string;
  calendarSystem: string;
  fields: CalendarFields;
  birthTimezone: string;
  /** Reference only; recomputed on import. */
  derived?: {
    gregorianLocalDate?: string;
    zodiacSign?: string;
    shengxiao?: string;
    shichen?: string;
  };
}

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  count: number;
  birthdays: ExportedBirthday[];
}

export interface ImportOptions {
  /** `merge` skips records already present; `append` always inserts. */
  mode?: 'merge' | 'append';
  /** Validate and report without writing anything. */
  dryRun?: boolean;
}

export interface ImportOutcome {
  dryRun: boolean;
  mode: 'merge' | 'append';
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  /** Per-record detail, in input order. */
  results: Array<{
    index: number;
    name: string;
    status: 'imported' | 'skipped' | 'failed';
    reason?: string;
  }>;
}

/** Turn one stored record into its transferable form. */
export function toExported(record: BirthdayRecord): ExportedBirthday {
  return {
    name: record.name,
    gender: record.gender,
    relation: record.relation,
    note: record.note,
    calendarSystem: record.calendarSystem,
    fields: record.fields,
    birthTimezone: record.birthTimezone,
    derived: {
      gregorianLocalDate: record.gregorianLocalDate,
      zodiacSign: record.zodiacSign,
      shengxiao: record.shengxiao,
      shichen: record.shichen,
    },
  };
}

/**
 * Build the export envelope.
 * @param records - stored records.
 * @param now - export instant, for reproducibility in tests.
 * @returns The envelope.
 */
export function buildExport(records: BirthdayRecord[], now: Date = new Date()): ExportEnvelope {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    count: records.length,
    birthdays: records.map(toExported),
  };
}

/** A stable identity for duplicate detection: same person, same calendar date. */
export function recordKey(entry: {
  name?: unknown;
  calendarSystem?: unknown;
  fields?: unknown;
  birthTimezone?: unknown;
}): string {
  const fields = (entry.fields ?? {}) as Record<string, unknown>;
  return [
    String(entry.name ?? '').trim(),
    String(entry.calendarSystem ?? '').trim(),
    String(fields.year ?? ''),
    String(fields.month ?? ''),
    String(fields.day ?? ''),
    fields.isLeapMonth === true ? 'leap' : '',
    String(entry.birthTimezone ?? '').trim(),
  ].join('|');
}

/**
 * Accept whatever an import source hands us: our envelope, a bare array, or a
 * single record object. Being liberal here avoids a confusing failure when a
 * user pastes an array of records by hand.
 * @param input - parsed JSON.
 * @returns The list of entries.
 * @throws When the shape is not recognizable.
 */
export function normalizeImportInput(input: unknown): ExportedBirthday[] {
  if (Array.isArray(input)) return input as ExportedBirthday[];
  if (input !== null && typeof input === 'object') {
    const container = input as Record<string, unknown>;
    if (Array.isArray(container.birthdays)) return container.birthdays as ExportedBirthday[];
    if (container.format !== undefined && container.format !== EXPORT_FORMAT && !Array.isArray(container.birthdays)) {
      throw new Error(`不认识的数据格式：${String(container.format)}`);
    }
    if (typeof container.name === 'string') return [container as unknown as ExportedBirthday];
  }
  throw new Error('导入数据格式不正确：应为导出文件、记录数组或单条记录');
}

/** Validate one entry's required shape before touching the store. */
function validateEntryShape(entry: ExportedBirthday, index: number): string | undefined {
  if (entry === null || typeof entry !== 'object') return `第 ${index + 1} 条不是对象`;
  if (typeof entry.name !== 'string' || entry.name.trim() === '') return `第 ${index + 1} 条缺少姓名`;
  if (typeof entry.calendarSystem !== 'string' || entry.calendarSystem === '') {
    return `第 ${index + 1} 条缺少历法`;
  }
  if (entry.fields === null || typeof entry.fields !== 'object') return `第 ${index + 1} 条缺少日期字段`;
  if (typeof entry.birthTimezone !== 'string' || entry.birthTimezone === '') {
    return `第 ${index + 1} 条缺少出生时区`;
  }
  return undefined;
}

/**
 * Import entries through the same service path that the UI uses, so validation,
 * enrichment and reminders all behave identically.
 * @param hub - calendar hub, for a friendlier validation message.
 * @param service - the birthday service.
 * @param input - parsed import payload.
 * @param options - mode and dry-run.
 * @returns A per-record outcome report.
 */
export async function importBirthdays(
  hub: GregorianHub,
  service: BirthdayService,
  input: unknown,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const mode = options.mode ?? 'merge';
  const dryRun = options.dryRun === true;
  const entries = normalizeImportInput(input);

  const existing = new Set(service.list().map((r) => recordKey(r)));
  const outcome: ImportOutcome = {
    dryRun,
    mode,
    total: entries.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const shapeError = validateEntryShape(entry, index);
    if (shapeError !== undefined) {
      outcome.failed += 1;
      outcome.results.push({ index, name: String(entry?.name ?? ''), status: 'failed', reason: shapeError });
      continue;
    }

    if (mode === 'merge' && existing.has(recordKey(entry))) {
      outcome.skipped += 1;
      outcome.results.push({ index, name: entry.name, status: 'skipped', reason: '已存在同名同历法同日期记录' });
      continue;
    }

    // Validate before writing so the error points at the offending record.
    // An unknown calendar makes the hub throw rather than return a verdict, so
    // that is caught here too: one bad record must never abort the whole import.
    let validation: { valid: boolean; errors: string[] };
    try {
      validation = hub.validate(entry.calendarSystem, entry.fields);
    } catch (e) {
      outcome.failed += 1;
      outcome.results.push({
        index,
        name: entry.name,
        status: 'failed',
        reason: (e as Error).message,
      });
      continue;
    }
    if (!validation.valid) {
      outcome.failed += 1;
      outcome.results.push({
        index,
        name: entry.name,
        status: 'failed',
        reason: validation.errors.join('; '),
      });
      continue;
    }

    if (dryRun) {
      outcome.imported += 1;
      outcome.results.push({ index, name: entry.name, status: 'imported', reason: '试运行：未写入' });
      existing.add(recordKey(entry));
      continue;
    }

    try {
      const record = await service.add({
        name: entry.name,
        gender: entry.gender as never,
        relation: entry.relation,
        note: entry.note,
        calendarSystem: entry.calendarSystem,
        fields: entry.fields,
        birthTimezone: entry.birthTimezone,
      });
      outcome.imported += 1;
      outcome.results.push({ index, name: record.name, status: 'imported' });
      existing.add(recordKey(entry));
    } catch (e) {
      outcome.failed += 1;
      outcome.results.push({
        index,
        name: entry.name,
        status: 'failed',
        reason: (e as Error).message,
      });
    }
  }

  return outcome;
}

/**
 * Parse an uploaded payload into import entries.
 *
 * JSON only, by design: a single round-trip format means an export can always
 * be imported back without a lossy or ambiguous intermediate. The envelope, a
 * bare array, and a single record are all accepted.
 * @param text - raw file contents.
 * @returns Entries ready for `importBirthdays`.
 * @throws When the text is not valid JSON, or not a recognizable shape.
 */
export function parseImportText(text: string): ExportedBirthday[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`导入文件不是有效的 JSON：${(e as Error).message}`);
  }
  return normalizeImportInput(parsed);
}
