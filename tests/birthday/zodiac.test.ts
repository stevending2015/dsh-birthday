import { describe, it, expect } from 'vitest';
import { computeZodiac } from '../../src/birthday/services/zodiac.js';

describe('computeZodiac', () => {
  it('boundary: Capricorn start', () => {
    expect(computeZodiac(12, 22).sign).toBe('摩羯座');
  });
  it('boundary: Capricorn end (Aquarius start)', () => {
    expect(computeZodiac(1, 19).sign).toBe('摩羯座');
    expect(computeZodiac(1, 20).sign).toBe('水瓶座');
  });
  it('mid-sign', () => {
    expect(computeZodiac(7, 4).sign).toBe('巨蟹座');
    expect(computeZodiac(10, 19).sign).toBe('天秤座');
  });
});
