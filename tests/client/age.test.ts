/**
 * Age is "completed years", so it must account for whether this year's
 * birthday has already happened. `now.year - birth.year` overstates by one for
 * most of the year, and gets the birthday-day boundary wrong.
 */

import { describe, it, expect } from 'vitest';
import { computeAge, datePartsIn, formatAge, type DateParts } from '../../src/client/age.js';

const at = (year: number, month: number, day: number): DateParts => ({ year, month, day });

describe('computeAge', () => {
  it('counts completed years after the birthday', () => {
    expect(computeAge('1990-06-15', at(2026, 10, 9))).toBe(36);
  });

  it('does not count the year before the birthday arrives', () => {
    expect(computeAge('1990-12-25', at(2026, 10, 9))).toBe(35);
  });

  it('treats the birthday itself as completed', () => {
    expect(computeAge('1990-10-09', at(2026, 10, 9))).toBe(36);
  });

  it('is one day short on the day before the birthday', () => {
    expect(computeAge('1990-10-10', at(2026, 10, 9))).toBe(35);
  });

  it('handles a birthday later in the same month', () => {
    expect(computeAge('1990-10-31', at(2026, 10, 1))).toBe(35);
    expect(computeAge('1990-10-31', at(2026, 10, 31))).toBe(36);
  });

  it('returns 0 for a baby born this year', () => {
    expect(computeAge('2026-01-01', at(2026, 10, 9))).toBe(0);
    expect(computeAge('2026-12-31', at(2026, 10, 9))).toBeUndefined() === false;
  });

  it('returns undefined for a future birth date', () => {
    expect(computeAge('2030-01-01', at(2026, 10, 9))).toBeUndefined();
  });

  it('returns undefined for a malformed date', () => {
    expect(computeAge('', at(2026, 10, 9))).toBeUndefined();
    expect(computeAge('1990/06/15', at(2026, 10, 9))).toBeUndefined();
    expect(computeAge('nonsense', at(2026, 10, 9))).toBeUndefined();
  });

  it('treats a 29 Feb birthday as 1 Mar in non-leap years', () => {
    // The reference is 1 Mar 2026 (non-leap), so the birthday has passed.
    expect(computeAge('2000-02-29', at(2026, 3, 1))).toBe(26);
    // One day earlier it has not.
    expect(computeAge('2000-02-29', at(2026, 2, 28))).toBe(25);
  });
});

describe('datePartsIn', () => {
  it('reads the calendar date in a zone', () => {
    const instant = new Date('2026-10-09T16:30:00Z');
    // Shanghai is UTC+8, so this instant is already 10 Oct there.
    expect(datePartsIn(instant, 'Asia/Shanghai')).toEqual({ year: 2026, month: 10, day: 10 });
    // Phoenix is UTC-7, so it is still 9 Oct there.
    expect(datePartsIn(instant, 'America/Phoenix')).toEqual({ year: 2026, month: 10, day: 9 });
  });

  it('falls back to the runtime zone for an unknown zone', () => {
    const instant = new Date('2026-10-09T12:00:00Z');
    const parts = datePartsIn(instant, 'Mars/Olympus');
    expect(Number.isFinite(parts.year)).toBe(true);
  });

  it('uses an age that changes across the date line', () => {
    // One instant; in Shanghai it is already 10 Oct, in Phoenix it is still the
    // 9th. A birthday on 10 Oct is therefore completed in one zone, not the other.
    const instant = new Date('2026-10-09T16:30:00Z');
    expect(datePartsIn(instant, 'Asia/Shanghai')).toEqual({ year: 2026, month: 10, day: 10 });
    expect(datePartsIn(instant, 'America/Phoenix')).toEqual({ year: 2026, month: 10, day: 9 });
    expect(computeAge('1990-10-10', datePartsIn(instant, 'Asia/Shanghai'))).toBe(36);
    expect(computeAge('1990-10-10', datePartsIn(instant, 'America/Phoenix'))).toBe(35);
  });
});

describe('formatAge', () => {
  it('renders years, and nothing for an unknown age', () => {
    expect(formatAge(36)).toBe('36 岁');
    expect(formatAge(0)).toBe('0 岁');
    expect(formatAge(undefined)).toBe('');
  });
});
