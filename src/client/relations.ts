/**
 * Presentation-side option tables.
 *
 * Two rules drive the sets here:
 *   1. Relationship candidates are constrained by the recorded person's
 *      gender — a male relative cannot be 妈妈/女儿/姐妹/奶奶/外婆.
 *   2. Relationship words describe the recorded person's role *toward the
 *      user*, so the lists are role names, not kinship titles of the user.
 */

export const GENDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
  { value: 'unspecified', label: '未指定' },
];

/** Relationship words valid regardless of gender. */
const NEUTRAL = ['本人', '配偶', '朋友', '同事', '同学', '客户', '其他'];
/** Relationship words that only describe a male person. */
const MALE_ONLY = ['爸爸', '儿子', '兄弟', '爷爷', '外公'];
/** Relationship words that only describe a female person. */
const FEMALE_ONLY = ['妈妈', '女儿', '姐妹', '奶奶', '外婆'];

/**
 * Relationship candidates for a gender.
 *
 * An unknown or unspecified gender offers every word, because refusing to
 * suggest anything would be worse than offering a superset the user can
 * correct.
 * @param gender - the recorded person's gender.
 * @returns The ordered candidate list.
 */
export function relationOptions(gender?: string | null): string[] {
  if (gender === 'male') return [...MALE_ONLY, ...NEUTRAL];
  if (gender === 'female') return [...FEMALE_ONLY, ...NEUTRAL];
  return [...MALE_ONLY.slice(0, 2), ...FEMALE_ONLY.slice(0, 2), ...NEUTRAL,
    ...MALE_ONLY.slice(2), ...FEMALE_ONLY.slice(2)];
}

/**
 * Whether a relationship word is plausible for a gender.
 * @param relation - the stored relationship word.
 * @param gender - the recorded person's gender.
 * @returns True when the word is in the candidate set for that gender.
 */
export function relationAllowed(relation: string, gender?: string | null): boolean {
  if (relation === '') return true;
  return relationOptions(gender).includes(relation);
}

/** Human label for a stored gender value. */
export function genderLabel(gender?: string | null): string {
  return GENDER_OPTIONS.find((g) => g.value === gender)?.label ?? '未指定';
}

const ZODIAC_ELEMENT: Record<string, string> = {
  白羊座: '火', 狮子座: '火', 射手座: '火',
  金牛座: '土', 处女座: '土', 摩羯座: '土',
  双子座: '风', 天秤座: '风', 水瓶座: '风',
  巨蟹座: '水', 天蝎座: '水', 双鱼座: '水',
};

/**
 * Element of a zodiac sign, for the card's "天秤座 · 风象" label.
 * @param sign - the stored sign name, e.g. 天秤座.
 * @returns `风象`-style label, or '' when the sign is unknown.
 */
export function zodiacElementLabel(sign?: string | null): string {
  if (sign === undefined || sign === null || sign === '') return '';
  const element = ZODIAC_ELEMENT[sign];
  return element === undefined ? '' : `${element}象`;
}

/** Symbol for a zodiac sign, e.g. ♎. */
const ZODIAC_SYMBOL: Record<string, string> = {
  白羊座: '♈', 金牛座: '♉', 双子座: '♊', 巨蟹座: '♋',
  狮子座: '♌', 处女座: '♍', 天秤座: '♎', 天蝎座: '♏',
  射手座: '♐', 摩羯座: '♑', 水瓶座: '♒', 双鱼座: '♓',
};

/** Symbol for a zodiac sign, or a neutral glyph when unknown. */
export function zodiacSymbol(sign?: string | null): string {
  if (sign === undefined || sign === null) return '✦';
  return ZODIAC_SYMBOL[sign] ?? '✦';
}

/** Emoji for a Chinese zodiac animal (生肖), for the card's 生肖 row. */
const SHENGXIAO_EMOJI: Record<string, string> = {
  鼠: '🐭', 牛: '🐮', 虎: '🐯', 兔: '🐰', 龙: '🐲', 蛇: '🐍',
  马: '🐴', 羊: '🐑', 猴: '🐵', 鸡: '🐔', 狗: '🐶', 猪: '🐷',
};

/**
 * Emoji for a 生肖 animal.
 * @param animal - the stored animal, e.g. 马.
 * @returns The emoji, or '' when the animal is unknown.
 */
export function shengxiaoEmoji(animal?: string | null): string {
  if (animal === undefined || animal === null) return '';
  return SHENGXIAO_EMOJI[animal] ?? '';
}
