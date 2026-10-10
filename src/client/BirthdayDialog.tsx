/**
 * BirthdayDialog — the modal chrome around BirthdayForm.
 *
 * The overlay is rendered inside the panel's own tree (see the panel's
 * positioning context) rather than through a portal, because the panel may be
 * mounted inside a shadow root where `document.body` is the wrong parent.
 * Escape and backdrop clicks close it.
 */

import * as React from 'react';
import { BirthdayForm, type BirthdayDraft, type CalendarDescriptor, type FormMode } from './BirthdayForm.js';

export interface BirthdayDialogProps {
  open: boolean;
  mode: FormMode;
  title: string;
  calendars: CalendarDescriptor[];
  /** Identity of the record being edited; drives the form's re-seed trigger. */
  recordId?: number;
  initial?: Partial<BirthdayDraft>;
  zodiacSign?: string;
  gregorianLocalDate?: string;
  birthDateText?: string;
  /** Completed years, for the read-only view. */
  age?: number;
  /** Calendar year facts for the form (e.g. the Chinese leap month). */
  loadYearInfo?: (
    calendarSystem: string,
    year: number,
  ) => Promise<{ leapMonth?: number | null; note?: string } | undefined>;
  /** Server-side error from the last submit; shown above the form. */
  submitError?: string | null;
  onSubmit: (draft: BirthdayDraft) => Promise<void> | void;
  onClose: () => void;
  onRequestEdit?: () => void;
}

export function BirthdayDialog(props: BirthdayDialogProps): React.ReactElement | null {
  React.useEffect(() => {
    if (!props.open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    const target = typeof document === 'undefined' ? undefined : document;
    target?.addEventListener('keydown', onKey);
    return () => target?.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div className="dsh-overlay" role="presentation" onMouseDown={props.onClose}>
      <div
        className="dsh-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dsh-modal__header">
          <h3>{props.title}</h3>
          <button type="button" className="dsh-icon-btn" onClick={props.onClose} aria-label="关闭">✕</button>
        </header>
        <div className="dsh-modal__body">
          {/* Always rendered: a conditionally-omitted sibling would shift the
              form's child index and make React remount it, discarding input. */}
          <div
            className="dsh-birthday-form__error"
            style={{ marginBottom: 12, display: props.submitError ? 'block' : 'none' }}
          >
            {props.submitError ? `⚠ ${props.submitError}` : ''}
          </div>
          <BirthdayForm
            calendars={props.calendars}
            mode={props.mode}
            recordId={props.recordId}
            initial={props.initial}
            zodiacSign={props.zodiacSign}
            gregorianLocalDate={props.gregorianLocalDate}
            birthDateText={props.birthDateText}
            age={props.age}
            loadYearInfo={props.loadYearInfo}
            onSubmit={props.onSubmit}
            onCancel={props.onClose}
            onRequestEdit={props.onRequestEdit}
          />
        </div>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null {
  if (!props.open) return null;
  return (
    <div className="dsh-overlay" role="presentation" onMouseDown={props.onCancel}>
      <div
        className="dsh-modal dsh-modal--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dsh-modal__header">
          <h3>{props.title}</h3>
        </header>
        <div className="dsh-modal__body">
          <p className="dsh-confirm__message">{props.message}</p>
          {props.errorMessage !== undefined && props.errorMessage !== null && (
            <div className="dsh-birthday-form__error" style={{ marginBottom: 12 }}>
              ⚠ {props.errorMessage}
            </div>
          )}
          <div className="dsh-birthday-form__actions">
            <button type="button" className="dsh-btn dsh-btn--danger" onClick={props.onConfirm}>
              {props.confirmLabel ?? '删除'}
            </button>
            <button type="button" className="dsh-btn" onClick={props.onCancel}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}
