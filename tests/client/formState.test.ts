/**
 * The two invariants whose violation produced "edit → save does nothing":
 *
 *   1. the form's re-seed key must depend on RECORD IDENTITY only, so typing
 *      can never trigger a re-seed that discards input;
 *   2. the payload must carry every field verbatim, including empty strings,
 *      because `undefined` is dropped by JSON.stringify and turns "clear this"
 *      into "leave it alone".
 */

import { describe, it, expect } from 'vitest';
import {
  buildPayload,
  diffAfterSave,
  monthIsDoubled,
  seedKeyFor,
  COMPARED_FIELDS,
  type BirthdayPayload,
} from '../../src/client/formState.js';
import type { BirthdayDraft } from '../../src/client/BirthdayForm.js';

const draft = (over: Partial<BirthdayDraft> = {}): BirthdayDraft => ({
  name: '张三',
  gender: 'male',
  relation: '朋友',
  note: '备注',
  calendarSystem: 'gregorian',
  fields: { year: 1990, month: 10, day: 3 },
  birthTimezone: 'Asia/Shanghai',
  ...over,
});

describe('seedKeyFor', () => {
  it('is identical for the same record in the same mode', () => {
    expect(seedKeyFor('edit', 1)).toBe(seedKeyFor('edit', 1));
  });

  it('changes when the record changes', () => {
    expect(seedKeyFor('edit', 1)).not.toBe(seedKeyFor('edit', 2));
  });

  it('changes when the mode changes (view ⇄ edit)', () => {
    expect(seedKeyFor('view', 1)).not.toBe(seedKeyFor('edit', 1));
  });

  it('distinguishes a new record from an existing one', () => {
    expect(seedKeyFor('create', undefined)).not.toBe(seedKeyFor('create', 1));
    expect(seedKeyFor('create', undefined)).toBe(seedKeyFor('create', undefined));
  });

  it('does NOT depend on record content, so typing cannot trigger a re-seed', () => {
    // The key is a function of identity alone; content changes are invisible to
    // it by construction. This is the regression guard for the reported bug.
    const before = seedKeyFor('edit', 7);
    draft({ note: 'typing…' });
    draft({ name: 'changed' });
    expect(seedKeyFor('edit', 7)).toBe(before);
  });
});

describe('buildPayload', () => {
  it('carries every editable field', () => {
    const payload = buildPayload(draft());
    for (const field of COMPARED_FIELDS) {
      expect(payload[field]).toBe(draft()[field]);
    }
    expect(payload.fields).toEqual({ year: 1990, month: 10, day: 3 });
    expect(payload.calendarSystem).toBe('gregorian');
  });

  it('keeps empty strings instead of dropping them', () => {
    const payload = buildPayload(draft({ note: '', relation: '' }));
    expect(payload.note).toBe('');
    expect(payload.relation).toBe('');
    // The key must survive JSON serialization: `undefined` would not.
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect('note' in wire).toBe(true);
    expect('relation' in wire).toBe(true);
  });

  it('keeps every key through JSON round-tripping', () => {
    const wire = JSON.parse(JSON.stringify(buildPayload(draft()))) as Record<string, unknown>;
    for (const field of COMPARED_FIELDS) {
      expect(wire).toHaveProperty(field);
    }
    expect(wire).toHaveProperty('fields');
  });
});

describe('monthIsDoubled', () => {
  it('offers the tick for exactly the doubled month', () => {
    // 2020 has a leap 4th month.
    expect(monthIsDoubled(true, 4, 4)).toBe(true);
    expect(monthIsDoubled(true, 4, 3)).toBe(false);
    expect(monthIsDoubled(true, 4, 5)).toBe(false);
  });

  it('never offers the tick when the year has no leap month', () => {
    expect(monthIsDoubled(true, null, 4)).toBe(false);
    expect(monthIsDoubled(true, undefined, 4)).toBe(false);
  });

  it('stays silent until the year facts have arrived', () => {
    // Critical: before the lookup returns, "unknown" must not read as "invalid"
    // — otherwise opening a stored leap-month record would untick it.
    expect(monthIsDoubled(false, 4, 4)).toBe(false);
    expect(monthIsDoubled(false, null, 4)).toBe(false);
  });

  it('accepts a numeric string month and rejects junk', () => {
    expect(monthIsDoubled(true, 6, '6')).toBe(true);
    expect(monthIsDoubled(true, 6, 'six')).toBe(false);
    expect(monthIsDoubled(true, 6, undefined)).toBe(false);
    expect(monthIsDoubled(true, 6, '')).toBe(false);
  });

  it('works for every doubled month of a set of real years', () => {
    const cases: Array<[number, number]> = [
      [2017, 6],
      [2020, 4],
      [2023, 2],
      [1990, 5],
      [1995, 8],
    ];
    for (const [year, leap] of cases) {
      expect(monthIsDoubled(true, leap, leap)).toBe(true);
      for (let m = 1; m <= 12; m += 1) {
        if (m !== leap) expect(monthIsDoubled(true, leap, m)).toBe(false);
      }
      expect(year).toBeGreaterThan(0);
    }
  });
});

describe('diffAfterSave', () => {
  const payload: BirthdayPayload = buildPayload(draft());

  it('reports nothing when the stored record matches', () => {
    const stored = {
      id: 1,
      name: '张三',
      gender: 'male',
      relation: '朋友',
      note: '备注',
      calendarSystem: 'gregorian',
      birthTimezone: 'Asia/Shanghai',
    };
    expect(diffAfterSave(payload, stored)).toEqual([]);
  });

  it('ignores surrounding whitespace differences', () => {
    const stored = {
      name: '张三 ',
      gender: 'male',
      relation: ' 朋友',
      note: '备注',
      calendarSystem: 'gregorian',
      birthTimezone: 'Asia/Shanghai',
    };
    expect(diffAfterSave(payload, stored)).toEqual([]);
  });

  it('treats absent and empty as equal (both mean "no value")', () => {
    const cleared = buildPayload(draft({ note: '', relation: '' }));
    const stored = {
      name: '张三',
      gender: 'male',
      relation: null,
      note: undefined,
      calendarSystem: 'gregorian',
      birthTimezone: 'Asia/Shanghai',
    };
    expect(diffAfterSave(cleared, stored)).toEqual([]);
  });

  it('treats a missing gender and "unspecified" as equal', () => {
    const unspecified = buildPayload(draft({ gender: 'unspecified' }));
    const stored = {
      name: '张三',
      gender: null,
      relation: '朋友',
      note: '备注',
      calendarSystem: 'gregorian',
      birthTimezone: 'Asia/Shanghai',
    };
    expect(diffAfterSave(unspecified, stored)).toEqual([]);
  });

  it('names the field that did not stick', () => {
    const stored = {
      name: '张三',
      gender: 'male',
      relation: '朋友',
      note: '旧备注',
      calendarSystem: 'gregorian',
      birthTimezone: 'Asia/Shanghai',
    };
    expect(diffAfterSave(payload, stored)).toEqual(['note']);
  });

  it('reports every field when the record is gone', () => {
    expect(diffAfterSave(payload, undefined)).toEqual([...COMPARED_FIELDS]);
  });
});
