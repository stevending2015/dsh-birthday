/**
 * One-time recovery of stores written to a different path.
 *
 * The default store path used to depend on the launch directory, so the same
 * library could end up split across several files — each launch reading only
 * one of them, which looks exactly like "my birthdays disappeared".
 *
 * This module merges every legacy file into the stable store. It never
 * deletes or overwrites the originals, and it is idempotent: a second run finds
 * nothing new to add.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { BirthdayRow, BirthdayStore } from '../db.js';

/** Merge into a stable key: same person, same calendar date, same timezone. */
export function rowKeyOf(row: BirthdayRow): string {
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(row.input_date_json) as Record<string, unknown>;
  } catch {
    fields = {};
  }
  return [
    String(row.name ?? '').trim(),
    String(row.calendar_system ?? '').trim(),
    String(fields.year ?? ''),
    String(fields.month ?? ''),
    String(fields.day ?? ''),
    fields.isLeapMonth === true ? 'leap' : '',
    String(row.birth_timezone ?? '').trim(),
  ].join('|');
}

/** Timestamp used to decide which copy of a record is newer. */
function stampOf(row: BirthdayRow): number {
  const raw = row.updated_at ?? row.created_at ?? '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Data columns copied when a legacy row supersedes the stored one. */
const DATA_COLUMNS: Array<keyof BirthdayRow> = [
  'name',
  'gender',
  'shengxiao',
  'calendar_system',
  'input_date_json',
  'birth_timezone',
  'gregorian_local_date',
  'birthday_start_utc',
  'shichen',
  'zodiac_sign',
  'wuxing_summary',
  'annual_degradation',
  'relation',
  'note',
];

/**
 * Read rows from a JSON store file.
 * @param path - candidate file.
 * @returns Its rows, or null when the file is absent, unreadable, or not a JSON store.
 */
export function readJsonStoreRows(path: string): BirthdayRow[] | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(parsed)) return parsed as BirthdayRow[];
    const rows = (parsed as { rows?: unknown })?.rows;
    return Array.isArray(rows) ? (rows as BirthdayRow[]) : null;
  } catch {
    return null;
  }
}

/** What to do with the rows of one legacy file. */
export interface MergePlan {
  toInsert: BirthdayRow[];
  toUpdate: Array<{ id: number; row: BirthdayRow }>;
  skipped: number;
}

/**
 * Decide, without touching storage, what a legacy file contributes.
 *
 * A row already present is kept unless the legacy copy carries a newer
 * timestamp — so recovering a file never silently reverts later edits.
 * @param existing - rows already in the stable store.
 * @param incoming - rows read from a legacy file.
 * @returns The insert/update plan.
 */
export function planMerge(existing: BirthdayRow[], incoming: BirthdayRow[]): MergePlan {
  const byKey = new Map<string, BirthdayRow>();
  for (const row of existing) byKey.set(rowKeyOf(row), row);

  const plan: MergePlan = { toInsert: [], toUpdate: [], skipped: 0 };
  const seen = new Set<string>();

  for (const row of incoming) {
    const key = rowKeyOf(row);
    // A file may contain duplicates of its own; only the first counts.
    if (seen.has(key)) {
      plan.skipped += 1;
      continue;
    }
    seen.add(key);

    const current = byKey.get(key);
    if (current === undefined) {
      plan.toInsert.push(row);
      continue;
    }
    if (stampOf(row) > stampOf(current) && current.id !== undefined) {
      plan.toUpdate.push({ id: current.id, row });
      continue;
    }
    plan.skipped += 1;
  }
  return plan;
}

/** Outcome of merging one legacy file. */
export interface MigrationResult {
  from: string;
  read: number;
  added: number;
  updated: number;
  skipped: number;
  /** Set when the file could not be used (absent, unreadable, wrong format). */
  error?: string;
}

/**
 * Merge every legacy JSON store into the live store.
 * @param store - the stable store to fill.
 * @param targetPath - its file path; a candidate equal to this is ignored.
 * @param candidates - legacy paths to consider.
 * @returns One result per candidate, in order.
 */
export function migrateLegacyStores(
  store: BirthdayStore,
  targetPath: string,
  candidates: string[],
): MigrationResult[] {
  const results: MigrationResult[] = [];
  const normalizedTarget = targetPath.toLowerCase();

  for (const candidate of candidates) {
    if (candidate.toLowerCase() === normalizedTarget) continue;

    const rows = readJsonStoreRows(candidate);
    if (rows === null) {
      if (existsSync(candidate)) {
        results.push({
          from: candidate,
          read: 0,
          added: 0,
          updated: 0,
          skipped: 0,
          error: '不是可读取的 JSON 存储（可能是 SQLite 或加密文件），未迁移',
        });
      }
      continue;
    }
    if (rows.length === 0) continue;

    const plan = planMerge(store.list(), rows);
    for (const row of plan.toInsert) {
      const { id: _ignored, created_at: _created, updated_at: _updated, ...data } = row;
      store.insert({ ...(data as BirthdayRow), created_at: row.created_at });
    }
    for (const { id, row } of plan.toUpdate) {
      const patch: Partial<BirthdayRow> = {};
      for (const column of DATA_COLUMNS) {
        if (row[column] !== undefined) (patch as Record<string, unknown>)[column] = row[column];
      }
      store.update(id, patch);
    }

    results.push({
      from: candidate,
      read: rows.length,
      added: plan.toInsert.length,
      updated: plan.toUpdate.length,
      skipped: plan.skipped,
    });
  }

  return results;
}
