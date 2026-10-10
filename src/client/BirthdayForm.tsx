/**
 * BirthdayForm — the dialog body.
 *
 * The calendar field set is driven by the server's
 * `GET /api/birthday/calendars` response, so a third-party adapter's fields
 * appear automatically. Gender drives the relationship candidates.
 *
 * Three modes share one component so "view" and "edit" can never drift apart:
 * `view` renders the same structure read-only.
 */

import * as React from 'react';
import {
  GENDER_OPTIONS,
  genderLabel,
  relationOptions,
  zodiacElementLabel,
} from './relations.js';
import { DEFAULT_BIRTH_TIMEZONE, timezoneGroups, timezoneLabel } from './timezones.js';
import { seedKeyFor, monthIsDoubled } from './formState.js';
import { chineseMonthName } from './monthNames.js';

export interface FieldDescriptor {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'string';
  required: boolean;
  min?: number;
  max?: number;
  description?: string;
  order?: number;
  /** Closed value set; the form renders a select instead of a text input. */
  options?: string[];
  /** Value the form pre-selects when the record has none. */
  defaultValue?: unknown;
}

export interface CalendarDescriptor {
  id: string;
  name: string;
  fields: FieldDescriptor[];
}

/** Values the form edits. Mirrors the server's add/update payload. */
export interface BirthdayDraft {
  name: string;
  gender: string;
  relation: string;
  note: string;
  calendarSystem: string;
  fields: Record<string, unknown>;
  birthTimezone: string;
}

export type FormMode = 'create' | 'edit' | 'view';

export interface BirthdayFormProps {
  calendars: CalendarDescriptor[];
  mode: FormMode;
  /**
   * Identity of the record being edited. The form re-seeds only when this (or
   * `mode`) changes, so parent re-renders never discard in-progress input.
   * Omitted for a new record.
   */
  recordId?: number;
  /** Starting values; omitted fields fall back to sensible defaults. */
  initial?: Partial<BirthdayDraft>;
  /** Read-only extras shown in view mode. */
  zodiacSign?: string;
  gregorianLocalDate?: string;
  /** Human-readable birth date, e.g. `1990年闰四月15日`. */
  birthDateText?: string;
  onSubmit: (draft: BirthdayDraft) => Promise<void> | void;
  onCancel: () => void;
  /** Switch view mode into edit mode. */
  onRequestEdit?: () => void;
  /**
   * Fetch calendar-specific year facts (e.g. the Chinese leap month). Supplied
   * by the panel so this component stays free of HTTP details.
   */
  loadYearInfo?: (calendarSystem: string, year: number) => Promise<YearInfo | undefined>;
  /** Completed years, shown read-only in view mode. */
  age?: number;
}

/** Calendar-specific facts about a year, as returned by the API. */
export interface YearInfo {
  leapMonth?: number | null;
  note?: string;
}

/** Value a field should start at when the record has none. */
function withFieldDefaults(
  calendar: CalendarDescriptor | undefined,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...fields };
  for (const field of calendar?.fields ?? []) {
    if (next[field.key] === undefined && field.defaultValue !== undefined) {
      next[field.key] = field.defaultValue;
    }
  }
  return next;
}

/** Default birth timezone: 东八区 (Asia/Shanghai). */
function defaultTimezone(): string {
  return DEFAULT_BIRTH_TIMEZONE;
}

function emptyDraft(
  calendars: CalendarDescriptor[],
  initial?: Partial<BirthdayDraft>,
): BirthdayDraft {
  const calendarSystem = initial?.calendarSystem ?? calendars[0]?.id ?? 'gregorian';
  const calendar = calendars.find((c) => c.id === calendarSystem);
  return {
    name: initial?.name ?? '',
    gender: initial?.gender ?? 'unspecified',
    relation: initial?.relation ?? '',
    note: initial?.note ?? '',
    calendarSystem,
    // Seed each calendar's declared defaults (e.g. 时辰 = 辰) so a new record
    // is complete without the user touching every optional field.
    fields: withFieldDefaults(calendar, initial?.fields ?? {}),
    birthTimezone: initial?.birthTimezone ?? defaultTimezone(),
  };
}

/** Read-only rendering of one stored calendar field. */
function formatFieldValue(value: unknown, field: FieldDescriptor): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'boolean') return value === true ? '是' : '否';
  return String(value);
}

export function BirthdayForm(props: BirthdayFormProps): React.ReactElement {
  const readOnly = props.mode === 'view';
  const [draft, setDraft] = React.useState<BirthdayDraft>(() =>
    emptyDraft(props.calendars, props.initial),
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed ONLY when the dialog is opened for a different record, or the mode
  // changes (view ⇄ edit). Seeding on record CONTENT instead would re-run the
  // effect on unrelated parent re-renders and silently discard whatever the
  // user had typed — which is how an edit could save the previous value.
  const seedKey = seedKeyFor(props.mode, props.recordId);
  React.useEffect(() => {
    setDraft(emptyDraft(props.calendars, props.initial));
    setError(null);
    // `props.initial`/`props.calendars` are intentionally not dependencies: the
    // seed must track record identity, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const calendar = props.calendars.find((c) => c.id === draft.calendarSystem);
  const relations = relationOptions(draft.gender);
  const year = Number(draft.fields.year);
  const month = Number(draft.fields.month);

  /**
   * Year facts plus the `calendar|year` they belong to.
   *
   * Tagging the key matters: the lookup is async, and until the answer for the
   * CURRENT year arrives we must not treat "no leap month known yet" as "no
   * leap month", or opening a stored leap-month record would silently untick it.
   */
  const infoKey = `${draft.calendarSystem}|${year}`;
  const [yearInfoState, setYearInfoState] = React.useState<{ key: string; info: YearInfo } | null>(null);
  const infoReady = yearInfoState?.key === infoKey;
  const yearInfo = infoReady ? yearInfoState?.info : undefined;

  // Look up the year's leap month (and any other calendar note) whenever the
  // calendar or year settles, so the user is told which month is doubled
  // BEFORE they decide whether to tick 闰月. Debounced to survive fast typing.
  React.useEffect(() => {
    if (props.loadYearInfo === undefined) return undefined;
    if (!Number.isFinite(year) || year <= 0) {
      setYearInfoState({ key: infoKey, info: {} });
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      props
        .loadYearInfo?.(draft.calendarSystem, year)
        .then((info) => {
          if (alive) setYearInfoState({ key: infoKey, info: info ?? {} });
        })
        .catch(() => {
          if (alive) setYearInfoState({ key: infoKey, info: {} });
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoKey]);

  /** The doubled month of the selected year, once known. */
  const leapMonth = yearInfo?.leapMonth ?? null;
  /** Whether the selected month is the one that is doubled that year. */
  const monthCanBeLeap = monthIsDoubled(infoReady, leapMonth, month);

  // A leap tick only makes sense for the doubled month. Clear a stale tick, but
  // only once the year's facts are known, so a stored value is never wiped
  // while the lookup is still in flight.
  React.useEffect(() => {
    if (!infoReady) return;
    if (draft.fields.isLeapMonth === true && !monthCanBeLeap) {
      setDraft((prev) => ({ ...prev, fields: { ...prev.fields, isLeapMonth: false } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoReady, monthCanBeLeap, draft.fields.isLeapMonth]);

  function patch(next: Partial<BirthdayDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function setField(key: string, value: unknown) {
    setDraft((prev) => {
      const fields = { ...prev.fields, [key]: value };
      // Moving off the doubled month cannot keep a leap tick.
      if ((key === 'month' || key === 'year') && fields.isLeapMonth === true) {
        const candidate = key === 'month' ? Number(value) : Number(fields.month);
        if (!infoReady || leapMonth === null || candidate !== leapMonth) {
          fields.isLeapMonth = false;
        }
      }
      return { ...prev, fields };
    });
  }

  /** Changing gender can invalidate the currently selected relationship. */
  function changeGender(gender: string) {
    setDraft((prev) => {
      const allowed = relationOptions(gender);
      const keep = prev.relation !== '' && allowed.includes(prev.relation);
      return { ...prev, gender, relation: keep ? prev.relation : '' };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setError(null);
    setBusy(true);
    try {
      await props.onSubmit(draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    const element = zodiacElementLabel(props.zodiacSign);
    return (
      <div className="dsh-birthday-form dsh-birthday-form--view">
        <dl className="dsh-birthday-view">
          <dt>姓名</dt>
          <dd>{draft.name !== '' ? draft.name : '—'}</dd>
          <dt>性别</dt>
          <dd>{genderLabel(draft.gender)}</dd>
          <dt>关系</dt>
          <dd>{draft.relation !== '' ? draft.relation : '—'}</dd>
          <dt>历法</dt>
          <dd>{calendar?.name ?? draft.calendarSystem}</dd>
          <dt>出生日期</dt>
          <dd>
            {props.birthDateText !== undefined && props.birthDateText !== ''
              ? props.birthDateText
              : formatFieldValue(draft.fields.year, calendar?.fields.find((f) => f.key === 'year') ?? { key: 'year', label: '年', type: 'number', required: false })
                + formatFieldValue(draft.fields.month, calendar?.fields.find((f) => f.key === 'month') ?? { key: 'month', label: '月', type: 'number', required: false })
                + formatFieldValue(draft.fields.day, calendar?.fields.find((f) => f.key === 'day') ?? { key: 'day', label: '日', type: 'number', required: false })}
          </dd>
          {draft.fields.shichen !== undefined && draft.fields.shichen !== '' && (
            <>
              <dt>时辰</dt>
              <dd>{String(draft.fields.shichen)}时</dd>
            </>
          )}
          {props.age !== undefined && (
            <>
              <dt>年龄</dt>
              <dd>{props.age} 岁</dd>
            </>
          )}
          <dt>出生时区</dt>
          <dd>{timezoneLabel(draft.birthTimezone)}</dd>
          {props.gregorianLocalDate !== undefined && props.gregorianLocalDate !== '' && (
            <>
              <dt>公历</dt>
              <dd>{props.gregorianLocalDate}</dd>
            </>
          )}
          <dt>星座</dt>
          <dd>
            {props.zodiacSign !== undefined && props.zodiacSign !== ''
              ? `${props.zodiacSign}${element !== '' ? ` · ${element}` : ''}`
              : '—'}
          </dd>
          <dt>备注</dt>
          <dd>{draft.note !== '' ? draft.note : '—'}</dd>
        </dl>
        <div className="dsh-birthday-form__actions">
          {props.onRequestEdit !== undefined && (
            <button type="button" className="dsh-btn dsh-btn--primary" onClick={props.onRequestEdit}>
              编辑
            </button>
          )}
          <button type="button" className="dsh-btn" onClick={props.onCancel}>关闭</button>
        </div>
      </div>
    );
  }

  return (
    <form className="dsh-birthday-form" onSubmit={handleSubmit}>
      <div className="dsh-birthday-form__row">
        <label>
          姓名
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} required />
        </label>
        <label>
          性别
          <select value={draft.gender} onChange={(e) => changeGender(e.target.value)}>
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </label>
        <label>
          关系
          <select value={draft.relation} onChange={(e) => patch({ relation: e.target.value })}>
            <option value="">未指定</option>
            {relations.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <small>
            {draft.gender === 'male'
              ? '男性：不提供 妈妈/女儿/姐妹/奶奶/外婆'
              : draft.gender === 'female'
                ? '女性：不提供 爸爸/儿子/兄弟/爷爷/外公'
                : '未指定性别：显示全部候选'}
          </small>
        </label>
      </div>

      <label>
        历法
        <select
          value={draft.calendarSystem}
          onChange={(e) => {
            const nextId = e.target.value;
            const nextCalendar = props.calendars.find((c) => c.id === nextId);
            // Re-seed the new calendar's defaults (e.g. 时辰 = 辰) rather than
            // carrying values that do not exist in the other calendar.
            patch({ calendarSystem: nextId, fields: withFieldDefaults(nextCalendar, {}) });
          }}
        >
          {props.calendars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <div className="dsh-birthday-form__row">
        {calendar?.fields.map((f) => {
          // 闰月 is not a field of its own any more: it belongs to the month it
          // doubles, so it is rendered inside the month's label row below.
          if (f.key === 'isLeapMonth') return null;
          const isMonth = f.key === 'month';
          const showLeap = isMonth && monthCanBeLeap;
          return (
            <label
              key={f.key}
              className={f.key === 'shichen' ? 'dsh-birthday-form__field--shichen' : undefined}
            >
              <span className="dsh-birthday-form__label-row">
                <span>{f.label}</span>
                {showLeap && (
                  <span className="dsh-birthday-form__leap">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.fields.isLeapMonth)}
                      onChange={(e) => setField('isLeapMonth', e.target.checked)}
                    />
                    闰月
                  </span>
                )}
                {isMonth && infoReady && leapMonth !== null && !monthCanBeLeap && (
                  <span className="dsh-birthday-form__leap-note">
                    （当年闰{chineseMonthName(leapMonth)}月）
                  </span>
                )}
              </span>
              {f.type === 'number' ? (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  required={f.required}
                  value={draft.fields[f.key] === undefined ? '' : String(draft.fields[f.key])}
                  onChange={(e) => setField(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
                />
              ) : f.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(draft.fields[f.key])}
                  onChange={(e) => setField(f.key, e.target.checked)}
                />
              ) : f.options !== undefined && f.options.length > 0 ? (
                <select
                  value={String(draft.fields[f.key] ?? f.defaultValue ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  {f.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required={f.required}
                  value={String(draft.fields[f.key] ?? '')}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              )}
              {/* Leap-month notice sits under the year so the user knows which
                  month is doubled before deciding whether to tick 闰月. */}
              {f.key === 'year' && yearInfo?.note !== undefined && yearInfo.note !== '' && (
                <small className="dsh-birthday-form__hint">{yearInfo.note}</small>
              )}
            </label>
          );
        })}
      </div>

      <div className="dsh-birthday-form__row">
        <label>
          出生时区
          <select
            value={draft.birthTimezone}
            onChange={(e) => patch({ birthTimezone: e.target.value })}
            required
          >
            {/* Keep a stored zone selectable even if the tzdb drops it. */}
            {!timezoneGroups().some((g) => g.options.some((o) => o.value === draft.birthTimezone)) && (
              <option value={draft.birthTimezone}>{draft.birthTimezone}</option>
            )}
            {timezoneGroups().map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <small>默认东八区（北京/上海）</small>
        </label>
      </div>

      <label>
        备注
        <input value={draft.note} onChange={(e) => patch({ note: e.target.value })} />
      </label>

      {error !== null && <div className="dsh-birthday-form__error">⚠ {error}</div>}

      <div className="dsh-birthday-form__actions">
        <button type="submit" className="dsh-btn dsh-btn--primary" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className="dsh-btn" onClick={props.onCancel} disabled={busy}>取消</button>
      </div>
    </form>
  );
}
