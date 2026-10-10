/**
 * Verification harness: a fake third-party adapter (think "tibetan-lite")
 * proves the runtime registration path works end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { createCalendarEngine, TimezoneService } from '../src/calendar/index.js';
import type { CalendarAdapter, CalendarFields, FieldDescriptor, ValidationResult, GregorianResult, AnnualResult } from '../src/calendar/types.js';

class FakeTibetanAdapter implements CalendarAdapter {
  readonly id = 'tibetan';
  readonly name = '藏历 (示例)';
  readonly minYear = 1900;
  readonly maxYear = 2100;
  readonly dayBoundary = 'midnight' as const;
  readonly capabilities = {
    hasLeapMonth: true,
    hasSkippedDays: true,
    sunsetBoundary: false,
    needsMoonSighting: false,
    solarAligned: false,
  };

  validate(fields: CalendarFields): ValidationResult {
    return { valid: true, errors: [], warnings: ['示例适配器，总是返回有效'] };
  }
  toGregorian(fields: CalendarFields, _tz: string): GregorianResult {
    return {
      localDate: `${fields.year}-${String(fields.month).padStart(2, '0')}-${String(fields.day).padStart(2, '0')}`,
      startUtc: '1970-01-01T00:00:00.000Z',
      timezone: _tz,
    };
  }
  fromGregorian(localDate: string, _tz: string): CalendarFields {
    const [y, m, d] = localDate.split('-').map(Number);
    return { year: y, month: m, day: d };
  }
  resolveAnnual(birthday: CalendarFields, targetYear: number, tz: string): AnnualResult {
    return {
      ...this.toGregorian({ ...birthday, year: targetYear }, tz),
      degraded: false,
    };
  }
  describeFields(): FieldDescriptor[] {
    return [
      { key: 'year', label: '年', type: 'number', required: true, min: 1900, max: 2100 },
      { key: 'month', label: '月', type: 'number', required: true, min: 1, max: 12 },
      { key: 'day', label: '日', type: 'number', required: true, min: 1, max: 30 },
    ];
  }
}

describe('third-party adapter registration', () => {
  it('plugs in a new calendar without touching dsh-birthday source', () => {
    const tz = new TimezoneService('system');
    const engine = createCalendarEngine({
      enabledCalendars: ['gregorian'],
      thirdPartyFactories: {
        tibetan: () => new FakeTibetanAdapter(),
      },
    });
    expect(engine.registry.has('tibetan')).toBe(true);
    const list = engine.hub.listCalendars();
    expect(list.map((c) => c.id)).toContain('tibetan');
    const fields = list.find((c) => c.id === 'tibetan')!.fields;
    expect(fields.find((f) => f.key === 'year')).toBeDefined();
  });

  it('rounds trips through the hub', () => {
    const engine = createCalendarEngine({
      enabledCalendars: ['gregorian'],
      thirdPartyFactories: { tibetan: () => new FakeTibetanAdapter() },
    });
    const g = engine.hub.toGregorian('tibetan', { year: 2026, month: 1, day: 15 }, 'UTC');
    expect(g.localDate).toBe('2026-01-15');
  });
});
