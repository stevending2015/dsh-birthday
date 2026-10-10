/**
 * BirthdayCard — one birthday, as a compact card in a 4-up grid.
 *
 * Same-timezone mode leads with the birthday date; cross-timezone mode leads
 * with the moment the user should act, because that is the only instant the
 * user can act on. Pure presentational: everything arrives as props.
 *
 * The card is tinted by gender (light blue for male, pink for female) so a
 * grid can be scanned by colour. 五行 and the leap-month notice are hidden per
 * `display.ts`; their data still arrives, so re-enabling is a flag flip.
 */

import * as React from 'react';
import { zodiacElementLabel, zodiacSymbol, genderLabel, shengxiaoEmoji } from './relations.js';
import { SHOW_WUXING, SHOW_DEGRADATION_NOTICE } from './display.js';

export interface BirthdayCardProps {
  name: string;
  /** Relationship to the user, e.g. 朋友 / 爸爸. */
  relation?: string;
  gender?: string;
  note?: string;
  /** Human-readable calendar name, e.g. 中国农历. */
  calendarName: string;
  /** The stored birth date in that calendar, e.g. 1990年8月15日. */
  birthDateText: string;
  /** Next occurrence, as a date in the birth timezone. */
  nextLocalDate: string;
  /** UTC instant of the next occurrence; drives the countdown. */
  targetUtc: string;
  /** User-local reminder moment, e.g. 2027-09-15 09:00. */
  userActionLocal: string;
  sameOffset: boolean;
  birthTimezone: string;
  zodiacSign?: string;
  /** Chinese zodiac animal (生肖), derived from the lunar year. */
  shengxiao?: string;
  /** 时辰 of birth, when the calendar defines one. */
  shichen?: string;
  /** Completed years, computed from the original birth date. */
  age?: number;
  wuxingSummary?: string;
  degraded?: boolean;
  degradationReason?: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Render the remaining time as a coarse, human phrase. */
function countdown(targetUtc: string): string {
  const ms = new Date(targetUtc).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '就是今天';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days === 0) return `${hours} 小时后`;
  if (days === 1) return '明天';
  if (days < 30) return `${days} 天后`;
  return `${Math.round(days / 30)} 个月后`;
}

/** Gender tint class; `unspecified`/`other` keep the neutral surface. */
function genderClass(gender?: string): string {
  if (gender === 'male') return ' dsh-birthday-card--male';
  if (gender === 'female') return ' dsh-birthday-card--female';
  return '';
}

export function BirthdayCard(props: BirthdayCardProps): React.ReactElement {
  const relation = props.relation !== undefined && props.relation !== '' ? props.relation : undefined;
  const element = zodiacElementLabel(props.zodiacSign);
  const hasZodiac = props.zodiacSign !== undefined && props.zodiacSign !== '';
  const animal = props.shengxiao !== undefined && props.shengxiao !== '' ? props.shengxiao : undefined;
  const countdownText = countdown(props.targetUtc);
  const showDegraded = SHOW_DEGRADATION_NOTICE && props.degraded === true;
  const showWuxing = SHOW_WUXING && props.wuxingSummary !== undefined && props.wuxingSummary !== '';

  return (
    <article
      className={`dsh-birthday-card${genderClass(props.gender)}${showDegraded ? ' dsh-birthday-card--degraded' : ''}`}
    >
      <div className="dsh-birthday-card__head">
        <span className="dsh-birthday-card__name" title={props.name}>{props.name}</span>
        {relation !== undefined && <span className="dsh-birthday-card__relation">{relation}</span>}
      </div>

      <div className="dsh-birthday-card__sub">
        {/* Age leads the calendar line, so the grid reads "who / how old / born when". */}
        {props.age !== undefined && (
          <span className="dsh-birthday-card__age">{props.age} 岁</span>
        )}
        <span>{props.calendarName} · {props.birthDateText}</span>
        {props.shichen !== undefined && props.shichen !== '' && (
          <span className="dsh-birthday-card__shichen">{props.shichen}时</span>
        )}
        {props.gender !== undefined && props.gender !== '' && props.gender !== 'unspecified' && (
          <span className="dsh-birthday-card__gender">{genderLabel(props.gender)}</span>
        )}
      </div>

      <div className="dsh-birthday-card__main">
        <span className="dsh-birthday-card__label">{props.sameOffset ? '下次' : '提醒'}</span>
        <span className="dsh-birthday-card__value">
          {props.sameOffset ? props.nextLocalDate : props.userActionLocal}
        </span>
      </div>

      {countdownText !== '' && (
        <div className="dsh-birthday-card__countdown">⏳ {countdownText}</div>
      )}

      <div className="dsh-birthday-card__zodiac">
        <span className="dsh-birthday-card__zodiac-sign">
          {zodiacSymbol(props.zodiacSign)} {hasZodiac ? props.zodiacSign : '星座未知'}
        </span>
        {element !== '' && <span className="dsh-birthday-card__zodiac-element">{element}</span>}
      </div>

      <div className="dsh-birthday-card__shengxiao">
        {animal !== undefined ? `${shengxiaoEmoji(animal)} 生肖 ${animal}` : '生肖 —'}
      </div>

      {!props.sameOffset && (
        <div className="dsh-birthday-card__tz">📍 {props.birthTimezone}</div>
      )}

      {showWuxing && (
        <div className="dsh-birthday-card__wuxing" title="五行分布">{props.wuxingSummary}</div>
      )}

      {props.note !== undefined && props.note !== '' && (
        <div className="dsh-birthday-card__note" title={props.note}>{props.note}</div>
      )}

      {showDegraded && (
        <div className="dsh-birthday-card__degraded" title={props.degradationReason}>
          ⚠ {props.degradationReason ?? '该日期在目标年份已降级处理'}
        </div>
      )}

      <div className="dsh-birthday-card__actions">
        <button type="button" className="dsh-btn dsh-btn--sm" onClick={props.onView}>查看</button>
        <button type="button" className="dsh-btn dsh-btn--sm" onClick={props.onEdit}>编辑</button>
        <button type="button" className="dsh-btn dsh-btn--sm dsh-btn--danger" onClick={props.onDelete}>删除</button>
      </div>
    </article>
  );
}
