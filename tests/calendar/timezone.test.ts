import { describe, it, expect } from 'vitest';
import { TimezoneService, TimezoneError } from '../../src/calendar/timezone.js';

describe('TimezoneService', () => {
  const tz = new TimezoneService('system');

  it('builds start of local day in Shanghai', () => {
    const { startUtc, startUtcMs } = tz.buildStartUtc('2026-10-19', 'Asia/Shanghai');
    expect(new Date(startUtcMs).toISOString()).toBe(startUtc);
    // Shanghai is UTC+8 → 00:00 local = 16:00 UTC previous day.
    expect(startUtc).toBe('2026-10-18T16:00:00.000Z');
  });

  it('builds start of local day in Phoenix (UTC-7)', () => {
    const { startUtc } = tz.buildStartUtc('2026-10-19', 'America/Phoenix');
    expect(startUtc).toBe('2026-10-19T07:00:00.000Z');
  });

  it('cross-DST: America/New_York 2026-03-08 is still EST', () => {
    const { startUtc } = tz.buildStartUtc('2026-03-08', 'America/New_York');
    // EST = UTC-5
    expect(startUtc).toBe('2026-03-08T05:00:00.000Z');
  });

  it('reports the same offset for two zones that match', () => {
    expect(tz.sameOffset('2026-10-19T00:00:00.000Z', 'Asia/Shanghai', 'Asia/Singapore')).toBe(true);
  });

  it('reports different offset for Shanghai vs New York', () => {
    expect(tz.sameOffset('2026-10-19T00:00:00.000Z', 'Asia/Shanghai', 'America/New_York')).toBe(false);
  });

  it('throws on bad timezone', () => {
    expect(() => tz.getOffset('2026-10-19T00:00:00.000Z', 'Mars/Olympus')).toThrow(TimezoneError);
  });

  it('addDays crosses month and year boundaries', () => {
    expect(tz.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(tz.addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
});
