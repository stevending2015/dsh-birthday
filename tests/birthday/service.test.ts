import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { createCalendarEngine } from '../../src/calendar/index.js';
import { createBirthdayStore } from '../../src/birthday/db.js';
import { BirthdayService } from '../../src/birthday/services/birthday-service.js';
import { UpcomingService } from '../../src/birthday/services/upcoming.js';
import { ReminderService } from '../../src/birthday/services/reminder.js';

let service: BirthdayService;
let upcoming: UpcomingService;
let reminders: ReminderService;

beforeAll(() => {
  const engine = createCalendarEngine({
    enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
  });
  const tmp = path.join(os.tmpdir(), `dsh-birthday-test-${Date.now()}.json`);
  const store = createBirthdayStore(tmp);
  reminders = new ReminderService({ reminderDaysBefore: [3, 1] });
  service = new BirthdayService(engine.hub, store, reminders);
  upcoming = new UpcomingService(engine.hub);
});

describe('BirthdayService', () => {
  it('adds a gregorian birthday and lists it', async () => {
    const r = await service.add({
      name: '张三',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 3, day: 4 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(r.id).toBeGreaterThan(0);
    expect(r.gregorianLocalDate).toBe('1990-03-04');
    expect(r.zodiacSign).toBe('双鱼座');
    expect(reminders.pending().length).toBe(2);
  });

  it('rejects an invalid date', async () => {
    await expect(
      service.add({
        name: 'bad',
        calendarSystem: 'gregorian',
        fields: { year: 2026, month: 13, day: 1 },
        birthTimezone: 'UTC',
      }),
    ).rejects.toThrow();
  });

  it('derives the zodiac from the month AND day, not just the month', async () => {
    // 24 Oct is Scorpio; a month-only lookup would wrongly say Libra.
    const scorpio = await service.add({
      name: '天蝎',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 10, day: 24 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(scorpio.zodiacSign).toBe('天蝎座');

    // One day earlier still belongs to the previous sign.
    const libra = await service.add({
      name: '天秤',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 10, day: 23 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(libra.zodiacSign).toBe('天秤座');

    // 2 Jan is Capricorn, not Aquarius.
    const capricorn = await service.add({
      name: '摩羯',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 1, day: 2 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(capricorn.zodiacSign).toBe('摩羯座');
  });

  it('persists and updates gender', async () => {
    const r = await service.add({
      name: '爸爸',
      gender: 'male',
      relation: '爸爸',
      calendarSystem: 'gregorian',
      fields: { year: 1962, month: 5, day: 8 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(r.gender).toBe('male');
    expect(r.relation).toBe('爸爸');

    const updated = await service.update(r.id, { gender: 'female', relation: '妈妈' });
    expect(updated?.gender).toBe('female');
    expect(updated?.relation).toBe('妈妈');
  });

  it('recomputes the zodiac when the date changes', async () => {
    const r = await service.add({
      name: '改期',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 10, day: 23 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(r.zodiacSign).toBe('天秤座');
    const moved = await service.update(r.id, {
      fields: { year: 1990, month: 10, day: 24 },
    });
    expect(moved?.zodiacSign).toBe('天蝎座');
  });

  it('changes an existing note, and distinguishes clearing from omitting', async () => {
    const r = await service.add({
      name: '备注',
      calendarSystem: 'gregorian',
      fields: { year: 1995, month: 7, day: 1 },
      birthTimezone: 'Asia/Shanghai',
      note: '原始备注',
    });
    expect(r.note).toBe('原始备注');

    // A new value replaces it.
    expect((await service.update(r.id, { note: '改过的备注' }))?.note).toBe('改过的备注');

    // Omitting the field preserves the stored value.
    expect((await service.update(r.id, { relation: '同事' }))?.note).toBe('改过的备注');

    // An empty string clears it.
    expect((await service.update(r.id, { note: '' }))?.note).toBeUndefined();
  });

  it('clears a relation with an empty string but keeps it when omitted', async () => {
    const r = await service.add({
      name: '关系',
      calendarSystem: 'gregorian',
      fields: { year: 1995, month: 7, day: 1 },
      birthTimezone: 'Asia/Shanghai',
      relation: '朋友',
    });
    expect(r.relation).toBe('朋友');

    expect((await service.update(r.id, { note: '无关的改动' }))?.relation).toBe('朋友');
    expect((await service.update(r.id, { relation: '' }))?.relation).toBeUndefined();
  });

  it('trims surrounding whitespace in free-text fields', async () => {
    const r = await service.add({
      name: '空白',
      calendarSystem: 'gregorian',
      fields: { year: 1995, month: 7, day: 1 },
      birthTimezone: 'Asia/Shanghai',
      note: '  有空格  ',
    });
    expect(r.note).toBe('有空格');
    // Whitespace-only is treated as a clear.
    expect((await service.update(r.id, { note: '   ' }))?.note).toBeUndefined();
  });

  it('records a 生肖 for a Gregorian birthday, using the lunar year', async () => {
    const r = await service.add({
      name: '属相',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 10, day: 3 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(r.shengxiao).toBe('马');
  });

  it('uses the previous lunar year before Chinese New Year', async () => {
    const r = await service.add({
      name: '春节前',
      calendarSystem: 'gregorian',
      // 20 Jan 1990 precedes Chinese New Year → 己巳 (snake), not 庚午 (horse).
      fields: { year: 1990, month: 1, day: 20 },
      birthTimezone: 'Asia/Shanghai',
    });
    expect(r.shengxiao).toBe('蛇');
  });

  it('updates a record and keeps reminders in sync', async () => {
    const r = await service.add({
      name: '李四',
      calendarSystem: 'gregorian',
      fields: { year: 1995, month: 7, day: 1 },
      birthTimezone: 'Asia/Shanghai',
    });
    const updated = await service.update(r.id, { note: 'university friend' });
    expect(updated?.note).toBe('university friend');
  });

  it('removes a record', async () => {
    const r = await service.add({
      name: 'to-delete',
      calendarSystem: 'gregorian',
      fields: { year: 2000, month: 1, day: 1 },
      birthTimezone: 'UTC',
    });
    expect(await service.remove(r.id)).toBe(true);
    expect(service.get(r.id)).toBeUndefined();
  });
});

describe('UpcomingService', () => {
  it('returns entries sorted by next occurrence', async () => {
    await service.add({
      name: 'A',
      calendarSystem: 'gregorian',
      fields: { year: 1990, month: 1, day: 1 },
      birthTimezone: 'Asia/Shanghai',
    });
    await service.add({
      name: 'B',
      calendarSystem: 'gregorian',
      fields: { year: 1991, month: 6, day: 15 },
      birthTimezone: 'Asia/Shanghai',
    });
    const all = upcoming.resolveAll(service.list(), { userTimezone: 'Asia/Shanghai' });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ts = all.map((e) => new Date(e.nextStartUtc).getTime());
    const sorted = [...ts].sort((a, b) => a - b);
    expect(ts).toEqual(sorted);
  });

  it('detects same-offset when user tz = birth tz', () => {
    const r = service.list()[0];
    if (!r) return;
    const e = upcoming.resolve(r, { userTimezone: r.birthTimezone });
    expect(e.sameOffset).toBe(true);
  });
});
