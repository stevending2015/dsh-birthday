/**
 * Timezone picker rules: the default must be 东八区, the list must be usable as
 * an `<optgroup>` tree, and labels must carry the actual UTC offset.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BIRTH_TIMEZONE,
  formatOffset,
  isKnownTimezone,
  listTimezoneOptions,
  offsetMinutesFor,
  timezoneGroups,
  timezoneLabel,
} from '../../src/client/timezones.js';

describe('offset helpers', () => {
  it('formats positive and negative offsets', () => {
    expect(formatOffset(480)).toBe('UTC+08:00');
    expect(formatOffset(-420)).toBe('UTC-07:00');
    expect(formatOffset(0)).toBe('UTC+00:00');
    expect(formatOffset(330)).toBe('UTC+05:30');
  });

  it('reads the offset of 东八区 as +480 minutes', () => {
    expect(offsetMinutesFor('Asia/Shanghai', new Date('2026-10-09T00:00:00Z'))).toBe(480);
  });

  it('reads a negative offset', () => {
    expect(offsetMinutesFor('America/Phoenix', new Date('2026-10-09T00:00:00Z'))).toBe(-420);
  });

  it('returns null for an unknown zone', () => {
    expect(offsetMinutesFor('Mars/Olympus')).toBeNull();
    expect(isKnownTimezone('Mars/Olympus')).toBe(false);
    expect(isKnownTimezone('Asia/Shanghai')).toBe(true);
  });
});

describe('default', () => {
  it('is 东八区', () => {
    expect(DEFAULT_BIRTH_TIMEZONE).toBe('Asia/Shanghai');
    expect(offsetMinutesFor(DEFAULT_BIRTH_TIMEZONE)).toBe(480);
  });
});

describe('listTimezoneOptions', () => {
  it('contains the default zone', () => {
    const values = listTimezoneOptions().map((o) => o.value);
    expect(values).toContain('Asia/Shanghai');
  });

  it('has no duplicate zones', () => {
    const values = listTimezoneOptions().map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('labels every entry with a UTC offset', () => {
    for (const option of listTimezoneOptions()) {
      expect(option.label).toMatch(/^UTC[+-]\d{2}:\d{2}/);
      expect(Number.isFinite(option.offsetMinutes)).toBe(true);
    }
  });

  it('is memoised', () => {
    expect(listTimezoneOptions()).toBe(listTimezoneOptions());
  });
});

describe('timezoneGroups', () => {
  it('pins a 常用 group first, containing 东八区', () => {
    const groups = timezoneGroups();
    expect(groups[0].label).toBe('常用');
    const values = groups[0].options.map((o) => o.value);
    expect(values).toContain('Asia/Shanghai');
    expect(values[0]).toBe('Asia/Shanghai');
  });

  it('does not repeat a pinned zone in a region group', () => {
    const groups = timezoneGroups();
    const pinned = new Set(groups[0].options.map((o) => o.value));
    for (const group of groups.slice(1)) {
      for (const option of group.options) {
        expect(pinned.has(option.value)).toBe(false);
      }
    }
  });

  it('covers every zone exactly once across all groups', () => {
    const groups = timezoneGroups();
    const total = groups.reduce((n, g) => n + g.options.length, 0);
    expect(total).toBe(listTimezoneOptions().length);
  });
});

describe('timezoneLabel', () => {
  it('renders an offset and a Chinese name for common zones', () => {
    expect(timezoneLabel('Asia/Shanghai')).toBe('UTC+08:00 · 北京/上海');
  });

  it('falls back to the raw name for unknown zones', () => {
    expect(timezoneLabel('Mars/Olympus')).toBe('Mars/Olympus');
  });
});
