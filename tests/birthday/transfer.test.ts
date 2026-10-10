/**
 * Export/import is a data-integrity feature: a round trip must not lose or
 * silently alter a record, and a bad record must fail loudly with a reason.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCalendarEngine } from '../../src/calendar/index.js';
import { createBirthdayStore } from '../../src/birthday/db.js';
import { BirthdayService } from '../../src/birthday/services/birthday-service.js';
import { ReminderService } from '../../src/birthday/services/reminder.js';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExport,
  importBirthdays,
  normalizeImportInput,
  parseImportText,
  recordKey,
  toExported,
} from '../../src/birthday/services/transfer.js';

const engine = createCalendarEngine({
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
});

function freshService(): BirthdayService {
  const store = createBirthdayStore(
    path.join(os.tmpdir(), `dsh-transfer-${Date.now()}-${Math.random()}.json`),
  );
  return new BirthdayService(engine.hub, store, new ReminderService({ reminderDaysBefore: [3] }));
}

let service: BirthdayService;
beforeAll(() => {
  service = freshService();
});

async function seed(target: BirthdayService) {
  await target.add({
    name: '张三',
    gender: 'male',
    relation: '家人',
    note: '含,逗号与"引号"',
    calendarSystem: 'lunar',
    fields: { year: 1990, month: 8, day: 15, isLeapMonth: false, shichen: '辰' },
    birthTimezone: 'Asia/Shanghai',
  });
  await target.add({
    name: '李四',
    gender: 'female',
    relation: '同事',
    calendarSystem: 'hebrew',
    fields: { year: 5784, month: 1, day: 1, afterSunset: true },
    birthTimezone: 'Asia/Jerusalem',
  });
}

describe('export envelope', () => {
  it('is self-describing and versioned', async () => {
    const target = freshService();
    await seed(target);
    const envelope = buildExport(target.list(), new Date('2026-10-09T00:00:00Z'));
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.version).toBe(EXPORT_VERSION);
    expect(envelope.count).toBe(2);
    expect(envelope.exportedAt).toBe('2026-10-09T00:00:00.000Z');
  });

  it('carries the source of truth and marks derived values as reference', async () => {
    const target = freshService();
    await seed(target);
    const first = buildExport(target.list()).birthdays.find((b) => b.name === '张三');
    expect(first?.calendarSystem).toBe('lunar');
    expect(first?.fields).toMatchObject({ year: 1990, month: 8, day: 15, shichen: '辰' });
    expect(first?.birthTimezone).toBe('Asia/Shanghai');
    // Derived values travel too, but under `derived`.
    expect(first?.derived?.gregorianLocalDate).toBe('1990-10-03');
    expect(first?.derived?.shengxiao).toBe('马');
  });

  it('normalizes to a JSON-safe shape', async () => {
    const target = freshService();
    await seed(target);
    const text = JSON.stringify(buildExport(target.list()));
    expect(JSON.parse(text).birthdays).toHaveLength(2);
  });
});

describe('import', () => {
  it('round-trips every record through JSON', async () => {
    const source = freshService();
    await seed(source);
    const envelope = JSON.parse(JSON.stringify(buildExport(source.list())));

    const destination = freshService();
    const outcome = await importBirthdays(engine.hub, destination, envelope);
    expect(outcome.imported).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(outcome.skipped).toBe(0);

    const byName = new Map(destination.list().map((r) => [r.name, r]));
    expect(byName.get('张三')?.calendarSystem).toBe('lunar');
    expect(byName.get('张三')?.fields).toMatchObject({ year: 1990, month: 8, day: 15, shichen: '辰' });
    expect(byName.get('张三')?.relation).toBe('家人');
    expect(byName.get('张三')?.note).toBe('含,逗号与"引号"');
    expect(byName.get('张三')?.gregorianLocalDate).toBe('1990-10-03');
    expect(byName.get('李四')?.birthTimezone).toBe('Asia/Jerusalem');
    expect(byName.get('李四')?.fields).toMatchObject({ afterSunset: true });
  });

  it('recomputes derived values instead of trusting the file', async () => {
    const destination = freshService();
    await importBirthdays(engine.hub, destination, [
      {
        name: '伪造派生值',
        calendarSystem: 'gregorian',
        fields: { year: 1990, month: 10, day: 24 },
        birthTimezone: 'Asia/Shanghai',
        // Deliberately wrong, and a month-only lookup would have agreed with it.
        derived: { gregorianLocalDate: '1900-01-01', zodiacSign: '天秤座', shengxiao: '鼠' },
      },
    ]);
    const record = destination.list()[0];
    expect(record.gregorianLocalDate).toBe('1990-10-24');
    expect(record.zodiacSign).toBe('天蝎座');
    expect(record.shengxiao).toBe('马');
  });

  it('skips duplicates in merge mode and reports them', async () => {
    const destination = freshService();
    await seed(destination);
    const envelope = JSON.parse(JSON.stringify(buildExport(destination.list())));
    const outcome = await importBirthdays(engine.hub, destination, envelope, { mode: 'merge' });
    expect(outcome.skipped).toBe(2);
    expect(outcome.imported).toBe(0);
    expect(destination.list()).toHaveLength(2);
  });

  it('appends duplicates in append mode', async () => {
    const destination = freshService();
    await seed(destination);
    const envelope = JSON.parse(JSON.stringify(buildExport(destination.list())));
    const outcome = await importBirthdays(engine.hub, destination, envelope, { mode: 'append' });
    expect(outcome.imported).toBe(2);
    expect(destination.list()).toHaveLength(4);
  });

  it('dry run validates without writing', async () => {
    const destination = freshService();
    const outcome = await importBirthdays(
      engine.hub,
      destination,
      [
        { name: 'A', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' },
        { name: 'B', calendarSystem: 'gregorian', fields: { year: 1990, month: 13, day: 1 }, birthTimezone: 'UTC' },
      ],
      { dryRun: true },
    );
    expect(outcome.dryRun).toBe(true);
    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(destination.list()).toHaveLength(0);
  });

  it('reports an invalid record with its index and reason instead of aborting', async () => {
    const destination = freshService();
    const outcome = await importBirthdays(engine.hub, destination, [
      { name: '好记录', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' },
      { name: '坏日期', calendarSystem: 'gregorian', fields: { year: 1990, month: 13, day: 1 }, birthTimezone: 'UTC' },
      { name: '', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 2 }, birthTimezone: 'UTC' },
      { name: '坏历法', calendarSystem: 'mayan', fields: { year: 1, month: 1, day: 1 }, birthTimezone: 'UTC' },
    ]);
    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toBe(3);
    const failures = outcome.results.filter((r) => r.status === 'failed');
    expect(failures.map((f) => f.index)).toEqual([1, 2, 3]);
    expect(failures.every((f) => (f.reason ?? '').length > 0)).toBe(true);
    // The good record still landed.
    expect(destination.list().map((r) => r.name)).toEqual(['好记录']);
  });

  it('accepts a bare array and a single record', async () => {
    const destination = freshService();
    const one = { name: '单条', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' };
    expect(normalizeImportInput([one])).toHaveLength(1);
    expect(normalizeImportInput(one)).toHaveLength(1);
    expect(normalizeImportInput({ format: EXPORT_FORMAT, version: 1, birthdays: [one] })).toHaveLength(1);
  });

  it('rejects an unrecognizable payload', () => {
    expect(() => normalizeImportInput(42)).toThrow();
    expect(() => normalizeImportInput('nope')).toThrow();
    expect(() => normalizeImportInput({ format: 'something-else' })).toThrow();
  });
});

describe('recordKey', () => {
  it('is stable across irrelevant differences', () => {
    const a = { name: '张三', calendarSystem: 'lunar', fields: { year: 1990, month: 8, day: 15 }, birthTimezone: 'Asia/Shanghai' };
    const b = { ...a, name: '张三 ' };
    expect(recordKey(a)).toBe(recordKey(b));
  });

  it('distinguishes a leap month from a normal month', () => {
    const normal = { name: '张三', calendarSystem: 'lunar', fields: { year: 2020, month: 4, day: 15 }, birthTimezone: 'Asia/Shanghai' };
    const leap = { ...normal, fields: { year: 2020, month: 4, day: 15, isLeapMonth: true } };
    expect(recordKey(normal)).not.toBe(recordKey(leap));
  });

  it('distinguishes different people and dates', () => {
    const base = { name: 'A', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' };
    expect(recordKey(base)).not.toBe(recordKey({ ...base, name: 'B' }));
    expect(recordKey(base)).not.toBe(recordKey({ ...base, fields: { year: 1990, month: 1, day: 2 } }));
  });
});

describe('parseImportText', () => {
  it('accepts the exported envelope', async () => {
    const source = freshService();
    await seed(source);
    const entries = parseImportText(JSON.stringify(buildExport(source.list())));
    expect(entries).toHaveLength(2);
  });

  it('accepts a bare array and a single record', () => {
    const one = { name: 'A', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' };
    expect(parseImportText(JSON.stringify([one]))).toHaveLength(1);
    expect(parseImportText(JSON.stringify(one))).toHaveLength(1);
  });

  it('tolerates a UTF-8 BOM', () => {
    const one = { name: 'A', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' };
    expect(parseImportText(`\uFEFF${JSON.stringify([one])}`)).toHaveLength(1);
  });

  it('rejects non-JSON text with a readable message', () => {
    expect(() => parseImportText('name,calendarSystem\n张三,lunar')).toThrow(/JSON/);
  });
});

describe('toExported', () => {
  it('omits nothing important and keeps fields verbatim', async () => {
    const target = freshService();
    await seed(target);
    const record = target.list().find((r) => r.name === '李四')!;
    const exported = toExported(record);
    expect(exported.fields).toEqual(record.fields);
    expect(exported.birthTimezone).toBe('Asia/Jerusalem');
    expect(exported.derived?.gregorianLocalDate).toBe(record.gregorianLocalDate);
  });
});
