/**
 * Pure form-state helpers.
 *
 * These two functions encode the invariants that were broken in practice, so
 * they can be tested without a DOM:
 *
 *   1. `seedKeyFor` — the form re-seeds only when the RECORD IDENTITY changes,
 *      never when its content changes. A content-derived key re-ran the seed
 *      effect on unrelated re-renders and silently discarded typed input, which
 *      is why "edit → save" could appear to do nothing for every field.
 *
 *   2. `buildPayload` — every editable field travels verbatim, including empty
 *      strings, because `undefined` is dropped by `JSON.stringify` and would
 *      turn "clear this value" into "leave it alone".
 */

import type { BirthdayDraft, FormMode } from './BirthdayForm.js';

/**
 * Identity of the record currently loaded into the form.
 * @param mode - current form mode.
 * @param recordId - stored record id, or undefined for a new record.
 * @returns A key that changes only when the form should be re-seeded.
 */
export function seedKeyFor(mode: FormMode, recordId?: number): string {
  return `${mode}|${recordId === undefined ? 'new' : String(recordId)}`;
}

/**
 * Whether the 闰月 tick applies to the current month selection.
 *
 * The tick only means something for the month that the year doubles, so it is
 * shown for exactly that month. `infoReady` must be true before this can say
 * "no": while the year's facts are still being fetched, the answer is unknown
 * and a stored leap tick must not be treated as invalid.
 * @param infoReady - whether the year's facts have arrived.
 * @param leapMonth - the doubled month of that year, or null/undefined.
 * @param month - the currently selected month value.
 * @returns True when the tick should be offered.
 */
export function monthIsDoubled(
  infoReady: boolean,
  leapMonth: number | null | undefined,
  month: unknown,
): boolean {
  if (!infoReady) return false;
  if (leapMonth === null || leapMonth === undefined) return false;
  const selected = Number(month);
  return Number.isFinite(selected) && selected === leapMonth;
}

/** The wire payload for add/update. */
export interface BirthdayPayload {
  name: string;
  gender: string;
  relation: string;
  note: string;
  calendarSystem: string;
  fields: Record<string, unknown>;
  birthTimezone: string;
}

/**
 * Build the request payload from the form draft.
 * @param draft - the form's current values.
 * @returns The payload, with no field dropped for being empty.
 */
export function buildPayload(draft: BirthdayDraft): BirthdayPayload {
  return {
    name: draft.name,
    gender: draft.gender,
    relation: draft.relation,
    note: draft.note,
    calendarSystem: draft.calendarSystem,
    fields: draft.fields,
    birthTimezone: draft.birthTimezone,
  };
}

/** The fields compared after a save. */
export const COMPARED_FIELDS = [
  'name',
  'gender',
  'relation',
  'note',
  'calendarSystem',
  'birthTimezone',
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

/**
 * Normalize a value the way the server stores it, so a comparison is about
 * substance rather than formatting: absent and empty are the same, and
 * surrounding whitespace is not significant.
 * @param value - the raw value from either side.
 * @returns A comparable string ('' for absent).
 */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * Compare what was sent against what the server now reports.
 *
 * A silent revert — the failure this guards against — shows up here as a
 * non-empty result, which the caller surfaces instead of closing the dialog as
 * if the save had worked.
 * @param payload - the values that were submitted.
 * @param stored - the record re-read from the server afterwards.
 * @returns The fields whose stored value differs from the submitted one.
 */
export function diffAfterSave(
  payload: BirthdayPayload,
  stored: Record<string, unknown> | undefined,
): ComparedField[] {
  if (stored === undefined) return [...COMPARED_FIELDS];
  const mismatched: ComparedField[] = [];
  for (const field of COMPARED_FIELDS) {
    if (canonical(payload[field]) !== canonical(stored[field])) mismatched.push(field);
  }
  // A 'unspecified' gender is stored as null by some paths; treat them alike.
  return mismatched.filter((field) => {
    if (field !== 'gender') return true;
    const sent = canonical(payload.gender);
    const got = canonical(stored.gender);
    return !((sent === 'unspecified' && got === '') || sent === got);
  });
}
