/**
 * AlmanacDialog — the 万年历 window.
 *
 * Layout follows the conventional Chinese 万年历: a Gregorian month grid with
 * each cell carrying its 农历 day (or the 节气 / festival when the day has one),
 * and a detail panel for the selected day with 干支, 生肖, 节气, 节日 and 宜忌.
 *
 * The component is HTTP-free: the panel supplies `loadMonth`, so this stays
 * testable and the fetch logic stays in one place.
 */

import * as React from 'react';
import {
  ALMANAC_MAX_YEAR,
  ALMANAC_MIN_YEAR,
  WEEKDAY_HEADERS,
  cellLabel,
  shiftMonth,
  type AlmanacMonth,
} from './almanacView.js';

export type { AlmanacDay, AlmanacMonth } from './almanacView.js';

export interface AlmanacDialogProps {
  open: boolean;
  /** Today in the user's zone, used for the initial view and the 今天 button. */
  today: string;
  loadMonth: (year: number, month: number) => Promise<AlmanacMonth | undefined>;
  onClose: () => void;
}

function monthTitle(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

export function AlmanacDialog(props: AlmanacDialogProps): React.ReactElement | null {
  const initial = React.useMemo(() => {
    const parts = (props.today ?? '').split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return { year: parts[0], month: parts[1] };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }, [props.today]);

  const [view, setView] = React.useState(initial);
  const [data, setData] = React.useState<AlmanacMonth | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reopening starts from today again, so the window never opens on a stale month.
  React.useEffect(() => {
    if (props.open) setView(initial);
  }, [props.open, initial]);

  // Escape closes, matching the birthday dialog.
  React.useEffect(() => {
    if (!props.open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    const target = typeof document === 'undefined' ? undefined : document;
    target?.addEventListener('keydown', onKey);
    return () => target?.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  React.useEffect(() => {
    if (!props.open) return undefined;
    let alive = true;
    setLoading(true);
    setError(null);
    props
      .loadMonth(view.year, view.month)
      .then((result) => {
        if (!alive) return;
        if (result === undefined) {
          setError('无法加载万年历数据。');
          setData(null);
          return;
        }
        setData(result);
        // Keep the selection when it is still in view; otherwise pick today.
        setSelected((prev) => {
          if (prev !== null && result.days.some((d) => d.date === prev)) return prev;
          const todayHere = result.days.find((d) => d.isToday);
          return (todayHere ?? result.days[0])?.date ?? null;
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, view.year, view.month]);

  if (!props.open) return null;

  const selectedDay = data?.days.find((d) => d.date === selected) ?? null;
  const goToday = () => {
    const parts = (data?.today ?? props.today ?? '').split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      setView({ year: parts[0], month: parts[1] });
      setSelected(data?.today ?? props.today);
    }
  };

  const leading = data?.firstWeekday ?? 0;

  return (
    <div className="dsh-overlay" role="presentation" onMouseDown={props.onClose}>
      <div
        className="dsh-modal dsh-modal--almanac"
        role="dialog"
        aria-modal="true"
        aria-label="万年历"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dsh-modal__header">
          <h3>万年历</h3>
          <button type="button" className="dsh-icon-btn" onClick={props.onClose} aria-label="关闭">✕</button>
        </header>

        <div className="dsh-modal__body dsh-almanac">
          <div className="dsh-almanac__toolbar">
            <button type="button" className="dsh-btn dsh-btn--sm" onClick={() => setView((v) => shiftMonth(v.year, v.month, -12))} title="上一年">«</button>
            <button type="button" className="dsh-btn dsh-btn--sm" onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))} title="上一月">‹</button>
            <strong className="dsh-almanac__title">{monthTitle(view.year, view.month)}</strong>
            <button type="button" className="dsh-btn dsh-btn--sm" onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))} title="下一月">›</button>
            <button type="button" className="dsh-btn dsh-btn--sm" onClick={() => setView((v) => shiftMonth(v.year, v.month, 12))} title="下一年">»</button>
            <button type="button" className="dsh-btn dsh-btn--sm" onClick={goToday}>今天</button>

            <span className="dsh-almanac__jump">
              <select
                aria-label="选择年"
                value={view.year}
                onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
              >
                {Array.from({ length: ALMANAC_MAX_YEAR - ALMANAC_MIN_YEAR + 1 }, (_, i) => ALMANAC_MIN_YEAR + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select
                aria-label="选择月"
                value={view.month}
                onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </span>

            <input
              type="date"
              aria-label="跳转到日期"
              className="dsh-almanac__date"
              value={selected ?? ''}
              min={`${ALMANAC_MIN_YEAR}-01-01`}
              max={`${ALMANAC_MAX_YEAR}-12-31`}
              onChange={(e) => {
                const value = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
                setView({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) });
                setSelected(value);
              }}
            />
          </div>

          {error !== null && <div className="dsh-birthday-form__error">⚠ {error}</div>}
          {data?.note !== undefined && <div className="dsh-birthday-page__notice">ℹ {data.note}</div>}

          <div className="dsh-almanac__grid" role="grid" aria-busy={loading}>
            {WEEKDAY_HEADERS.map((w, i) => (
              <div
                key={w}
                className={`dsh-almanac__weekday${i === 0 || i === 6 ? ' dsh-almanac__weekday--end' : ''}`}
                role="columnheader"
              >
                {w}
              </div>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <div key={`blank-${i}`} className="dsh-almanac__cell dsh-almanac__cell--blank" />
            ))}
            {(data?.days ?? []).map((day) => {
              const label = cellLabel(day);
              const classes = [
                'dsh-almanac__cell',
                day.isWeekend ? 'dsh-almanac__cell--end' : '',
                day.isToday ? 'dsh-almanac__cell--today' : '',
                day.date === selected ? 'dsh-almanac__cell--selected' : '',
                label.kind === 'jieqi' ? 'dsh-almanac__cell--jieqi' : '',
                label.kind === 'festival' ? 'dsh-almanac__cell--festival' : '',
              ]
                .filter((c) => c !== '')
                .join(' ');
              return (
                <button
                  key={day.date}
                  type="button"
                  role="gridcell"
                  className={classes}
                  onClick={() => setSelected(day.date)}
                  title={`${day.date} 农历${day.lunarMonthName}${day.lunarDayName}${day.festivals.length > 0 ? ` ${day.festivals.join('/')}` : ''}`}
                >
                  <span className="dsh-almanac__num">{day.day}</span>
                  {label.text !== '' && (
                    <span className={`dsh-almanac__label dsh-almanac__label--${label.kind}`}>{label.text}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="dsh-almanac__detail">
            {selectedDay === null ? (
              <div className="dsh-almanac__hint">点击日期查看详情</div>
            ) : (
              <>
                <div className="dsh-almanac__detail-head">
                  <strong>{selectedDay.date}</strong>
                  <span>星期{selectedDay.weekdayName}</span>
                  {selectedDay.isToday && <span className="dsh-almanac__badge">今天</span>}
                </div>
                <dl className="dsh-birthday-view dsh-almanac__facts">
                  <dt>农历</dt>
                  <dd>{selectedDay.lunarText !== '' ? selectedDay.lunarText : '—'}</dd>
                  <dt>干支</dt>
                  <dd>
                    {selectedDay.yearGanZhi !== ''
                      ? `${selectedDay.yearGanZhi}年 ${selectedDay.monthGanZhi}月 ${selectedDay.dayGanZhi}日`
                      : '—'}
                  </dd>
                  <dt>生肖</dt>
                  <dd>{selectedDay.zodiac !== '' ? `${selectedDay.zodiac}年` : '—'}</dd>
                  <dt>节气</dt>
                  <dd>{selectedDay.jieQi !== '' ? selectedDay.jieQi : '—'}</dd>
                  <dt>节日</dt>
                  <dd>{selectedDay.festivals.length > 0 ? selectedDay.festivals.join(' · ') : '—'}</dd>
                  <dt>宜</dt>
                  <dd className="dsh-almanac__yi">{selectedDay.yi.length > 0 ? selectedDay.yi.join(' ') : '—'}</dd>
                  <dt>忌</dt>
                  <dd className="dsh-almanac__ji">{selectedDay.ji.length > 0 ? selectedDay.ji.join(' ') : '—'}</dd>
                </dl>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
