import { describe, it, expect } from 'vitest';
import { computeWuxing, shichenFromHour } from '../../src/birthday/services/wuxing.js';

describe('wuxing + shichen', () => {
  it('returns a five-element histogram for each month', () => {
    for (let m = 1; m <= 12; m += 1) {
      const wx = computeWuxing(m);
      expect(wx.bars).toMatch(/[木火土金水]/);
    }
  });

  it('shichen mapping covers all 12 branches', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h += 1) seen.add(shichenFromHour(h).name);
    expect(seen.size).toBe(12);
  });

  it('子时 starts at 23:00', () => {
    expect(shichenFromHour(23).name).toBe('子');
    expect(shichenFromHour(0).name).toBe('子');
  });
});
