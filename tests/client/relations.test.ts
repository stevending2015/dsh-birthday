/**
 * Relationship filtering is a correctness rule, not decoration: offering
 * 妈妈 for a male relative is wrong. This locks the rule down.
 */

import { describe, it, expect } from 'vitest';
import {
  relationOptions,
  relationAllowed,
  genderLabel,
  zodiacElementLabel,
  zodiacSymbol,
} from '../../src/client/relations.js';

const FEMALE_ONLY = ['妈妈', '女儿', '姐妹', '奶奶', '外婆'];
const MALE_ONLY = ['爸爸', '儿子', '兄弟', '爷爷', '外公'];

describe('relationOptions', () => {
  it('never offers female-only words for a male person', () => {
    const options = relationOptions('male');
    for (const word of FEMALE_ONLY) {
      expect(options).not.toContain(word);
    }
  });

  it('never offers male-only words for a female person', () => {
    const options = relationOptions('female');
    for (const word of MALE_ONLY) {
      expect(options).not.toContain(word);
    }
  });

  it('offers the matching gendered words', () => {
    expect(relationOptions('male')).toContain('爸爸');
    expect(relationOptions('male')).toContain('儿子');
    expect(relationOptions('female')).toContain('妈妈');
    expect(relationOptions('female')).toContain('女儿');
  });

  it('always offers the neutral words', () => {
    for (const gender of ['male', 'female', 'other', 'unspecified', undefined]) {
      const options = relationOptions(gender);
      expect(options).toContain('朋友');
      expect(options).toContain('同事');
      expect(options).toContain('本人');
    }
  });

  it('offers every word when the gender is unspecified', () => {
    const options = relationOptions('unspecified');
    for (const word of [...MALE_ONLY, ...FEMALE_ONLY]) {
      expect(options).toContain(word);
    }
  });

  it('offers every word for an unknown gender value', () => {
    const options = relationOptions('who-knows');
    expect(options).toContain('妈妈');
    expect(options).toContain('爸爸');
  });

  it('returns no duplicates', () => {
    for (const gender of ['male', 'female', 'unspecified']) {
      const options = relationOptions(gender);
      expect(new Set(options).size).toBe(options.length);
    }
  });
});

describe('relationAllowed', () => {
  it('rejects 妈妈 for a male person', () => {
    expect(relationAllowed('妈妈', 'male')).toBe(false);
  });

  it('rejects 爸爸 for a female person', () => {
    expect(relationAllowed('爸爸', 'female')).toBe(false);
  });

  it('accepts 朋友 for everyone', () => {
    expect(relationAllowed('朋友', 'male')).toBe(true);
    expect(relationAllowed('朋友', 'female')).toBe(true);
    expect(relationAllowed('朋友', undefined)).toBe(true);
  });

  it('treats an empty relationship as allowed', () => {
    expect(relationAllowed('', 'male')).toBe(true);
  });
});

describe('display helpers', () => {
  it('labels genders', () => {
    expect(genderLabel('male')).toBe('男');
    expect(genderLabel('female')).toBe('女');
    expect(genderLabel(undefined)).toBe('未指定');
  });

  it('maps zodiac signs to elements', () => {
    expect(zodiacElementLabel('天秤座')).toBe('风象');
    expect(zodiacElementLabel('天蝎座')).toBe('水象');
    expect(zodiacElementLabel('摩羯座')).toBe('土象');
    expect(zodiacElementLabel('白羊座')).toBe('火象');
    expect(zodiacElementLabel('不存在座')).toBe('');
    expect(zodiacElementLabel(undefined)).toBe('');
  });

  it('maps zodiac signs to symbols', () => {
    expect(zodiacSymbol('天秤座')).toBe('♎');
    expect(zodiacSymbol('双鱼座')).toBe('♓');
    expect(zodiacSymbol(undefined)).toBe('✦');
  });
});
