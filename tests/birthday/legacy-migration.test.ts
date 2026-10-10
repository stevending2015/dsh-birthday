/**
 * Legacy-store recovery is the fix for "my birthdays disappeared after a
 * restart", so the merge rules matter more than the happy path:
 *
 *   - a missing record is added;
 *   - a record already present is NOT duplicated;
 *   - a newer legacy copy supersedes the stored one (recovery must not revert
 *     later edits);
 *   - an older legacy copy never overwrites;
 *   - the originals are never modified.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBirthdayStore, type BirthdayRow, type BirthdayStore } from '../../src/birthday/db.js';
import {
  migrateLegacyStores,
  planMerge,
  readJsonStoreRows,
  rowKeyOf,
} from '../../src/birthday/services/legacy-migration.js';

let dir: string;
const opened: BirthdayStore[] = [];

/**
 * `createBirthdayStore` already initialises the engine. Stores are tracked so
 * they can be closed before the temp directory is removed — on Windows an open
 * SQLite handle makes the delete fail with EPERM.
 */
function makeStore(path: string): BirthdayStore {
  const store = createBirthdayStore(path);
  opened.push(store);
  return store;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-legacy-'));
});
afterEach(() => {
  while (opened.length > 0) {
    try {
      opened.pop()?.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function row(over: Partial<BirthdayRow> = {}): BirthdayRow {
  return {
    name: '张三',
    calendar_system: 'lunar',
    input_date_json: JSON.stringify({ year: 1990, month: 8, day: 15, isLeapMonth: false }),
    birth_timezone: 'Asia/Shanghai',
    gregorian_local_date: '1990-10-03',
    birthday_start_utc: '1990-10-02T16:00:00.000Z',
    updated_at: '2026-10-09T01:00:00.000Z',
    ...over,
  };
}

function writeStore(path: string, rows: BirthdayRow[]): void {
  writeFileSync(path, JSON.stringify({ rows, nextId: rows.length + 1 }, null, 2), 'utf-8');
}

describe('rowKeyOf', () => {
  it('is the same for the same person, date and zone', () => {
    expect(rowKeyOf(row())).toBe(rowKeyOf(row({ updated_at: '2030-01-01T00:00:00.000Z' })));
  });

  it('separates different people, dates, calendars and a leap month', () => {
    const base = row();
    expect(rowKeyOf(base)).not.toBe(rowKeyOf(row({ name: '李四' })));
    expect(rowKeyOf(base)).not.toBe(rowKeyOf(row({ birth_timezone: 'UTC' })));
    expect(rowKeyOf(base)).not.toBe(
      rowKeyOf(row({ input_date_json: JSON.stringify({ year: 1990, month: 8, day: 16 }) })),
    );
    expect(rowKeyOf(base)).not.toBe(
      rowKeyOf(
        row({ input_date_json: JSON.stringify({ year: 1990, month: 8, day: 15, isLeapMonth: true }) }),
      ),
    );
  });

  it('survives unparseable date json', () => {
    expect(rowKeyOf(row({ input_date_json: 'not json' }))).toContain('张三');
  });
});

describe('planMerge', () => {
  it('adds what is missing and skips what is present', () => {
    const existing = [row({ id: 1 })];
    const incoming = [row(), row({ id: 99, name: '赵六', input_date_json: JSON.stringify({ year: 1995, month: 3, day: 12 }) })];
    const plan = planMerge(existing, incoming);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].name).toBe('赵六');
    expect(plan.skipped).toBe(1);
  });

  it('lets a newer legacy copy supersede the stored row', () => {
    const existing = [row({ id: 7, note: '旧', updated_at: '2026-10-09T01:00:00.000Z' })];
    const incoming = [row({ note: '新', updated_at: '2026-10-09T05:00:00.000Z' })];
    const plan = planMerge(existing, incoming);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe(7);
    expect(plan.toUpdate[0].row.note).toBe('新');
  });

  it('never overwrites with an older copy', () => {
    const existing = [row({ id: 7, note: '较新', updated_at: '2026-10-09T05:00:00.000Z' })];
    const incoming = [row({ note: '较旧', updated_at: '2026-10-09T01:00:00.000Z' })];
    const plan = planMerge(existing, incoming);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it('falls back to created_at when updated_at is absent', () => {
    const existing = [row({ id: 7, updated_at: undefined, created_at: '2026-10-01T00:00:00.000Z' })];
    const incoming = [row({ updated_at: undefined, created_at: '2026-10-05T00:00:00.000Z' })];
    expect(planMerge(existing, incoming).toUpdate).toHaveLength(1);
  });

  it('counts duplicates inside one file only once', () => {
    const plan = planMerge([], [row(), row()]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });
});

describe('readJsonStoreRows', () => {
  it('reads the store envelope', () => {
    const path = join(dir, 'a.db');
    writeStore(path, [row()]);
    expect(readJsonStoreRows(path)).toHaveLength(1);
  });

  it('accepts a bare array', () => {
    const path = join(dir, 'bare.json');
    writeFileSync(path, JSON.stringify([row()]), 'utf-8');
    expect(readJsonStoreRows(path)).toHaveLength(1);
  });

  it('returns null for a missing, malformed or non-store file', () => {
    expect(readJsonStoreRows(join(dir, 'missing.db'))).toBeNull();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'not json at all', 'utf-8');
    expect(readJsonStoreRows(bad)).toBeNull();
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify({ unrelated: true }), 'utf-8');
    expect(readJsonStoreRows(other)).toBeNull();
  });
});

describe('migrateLegacyStores', () => {
  it('recovers records from a legacy file into the live store', () => {
    const target = join(dir, 'stable', 'birthdays.db');
    const store = makeStore(target);
    store.insert(row({ created_at: '2026-10-09T00:00:00.000Z' }));

    const legacy = join(dir, 'legacy.db');
    writeStore(legacy, [
      row(), // already present → skipped
      row({ name: '赵六', input_date_json: JSON.stringify({ year: 1995, month: 3, day: 12 }), gregorian_local_date: '1995-03-12' }),
    ]);

    const results = migrateLegacyStores(store, target, [legacy]);
    expect(results).toHaveLength(1);
    expect(results[0].added).toBe(1);
    expect(results[0].skipped).toBe(1);
    expect(store.list().map((r) => r.name).sort()).toEqual(['张三', '赵六']);
  });

  it('is idempotent: a second run adds nothing', () => {
    const target = join(dir, 'stable2', 'birthdays.db');
    const store = makeStore(target);
    const legacy = join(dir, 'legacy2.db');
    writeStore(legacy, [row()]);

    expect(migrateLegacyStores(store, target, [legacy])[0].added).toBe(1);
    const second = migrateLegacyStores(store, target, [legacy]);
    expect(second[0].added).toBe(0);
    expect(second[0].updated).toBe(0);
    expect(store.list()).toHaveLength(1);
  });

  it('skips the target path itself', () => {
    const target = join(dir, 'self.db');
    const store = makeStore(target);
    store.insert(row());
    expect(migrateLegacyStores(store, target, [target])).toHaveLength(0);
  });

  it('reports a non-JSON file instead of failing the activation', () => {
    const target = join(dir, 'stable3', 'birthdays.db');
    const store = makeStore(target);
    const sqlite = join(dir, 'encrypted.db');
    writeFileSync(sqlite, Buffer.from([0x8f, 0x01, 0x02, 0x03, 0x04, 0x05]));

    const results = migrateLegacyStores(store, target, [sqlite]);
    expect(results).toHaveLength(1);
    expect(results[0].error).toContain('未迁移');
    expect(store.list()).toHaveLength(0);
  });

  it('leaves the legacy file untouched', () => {
    const target = join(dir, 'stable4', 'birthdays.db');
    const store = makeStore(target);
    const legacy = join(dir, 'legacy4.db');
    writeStore(legacy, [row()]);
    const before = readFileSync(legacy, 'utf-8');

    migrateLegacyStores(store, target, [legacy]);
    expect(readFileSync(legacy, 'utf-8')).toBe(before);
  });

  it('does not let an older legacy copy overwrite the stored row', () => {
    const target = join(dir, 'stable5', 'birthdays.db');
    const store = makeStore(target);
    store.insert(row({ relation: '较新关系' }));

    // The stored row was just written, so its timestamp is "now"; this legacy
    // copy predates it and must lose. (The supersede rule itself is covered by
    // the planMerge cases above, which do not depend on engine timestamp
    // handling: SQLite rewrites updated_at on every write.)
    const legacy = join(dir, 'legacy5.db');
    writeStore(legacy, [row({ relation: '较旧关系', updated_at: '2000-01-01T00:00:00.000Z' })]);

    const results = migrateLegacyStores(store, target, [legacy]);
    expect(results[0].updated).toBe(0);
    expect(results[0].skipped).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].relation).toBe('较新关系');
  });
});
