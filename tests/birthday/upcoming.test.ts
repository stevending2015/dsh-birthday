import { describe, it, expect } from 'vitest';
import { createCalendarEngine } from '../../src/calendar/index.js';
import { UpcomingService } from '../../src/birthday/services/upcoming.js';
import type { BirthdayRecord } from '../../src/birthday/models/birthday.js';

const engine = createCalendarEngine({
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
});
const upcoming = new UpcomingService(engine.hub);

function rec(over: Partial<BirthdayRecord> = {}): BirthdayRecord {
  return {
    id: 1,
    name: 'Test',
    calendarSystem: 'gregorian',
    fields: { year: 1990, month: 6, day: 15 },
    birthTimezone: 'Asia/Shanghai',
    gregorianLocalDate: '1990-06-15',
    birthdayStartUtc: '1990-06-14T16:00:00.000Z',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('UpcomingService cross-timezone', () => {
  it('same offset for matching zones', () => {
    const e = upcoming.resolve(rec(), { userTimezone: 'Asia/Shanghai' });
    expect(e.sameOffset).toBe(true);
  });

  it('different offset when user is in a far zone', () => {
    const e = upcoming.resolve(rec(), { userTimezone: 'America/Phoenix' });
    expect(e.sameOffset).toBe(false);
    expect(e.userActionUtc).toBeDefined();
  });

  it('rolls over to next year when already past', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const e = upcoming.resolve(rec({ fields: { year: 1990, month: 1, day: 1 } }), {
      userTimezone: 'UTC',
      now,
    });
    expect(new Date(e.nextStartUtc).getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });
});
