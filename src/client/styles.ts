/**
 * Stylesheet for the birthday UI.
 *
 * The client ships as one classic script (see `scripts/bundle-client.mjs`), so
 * there is no separate CSS asset to register. The string below is injected once
 * per styling root, guarded by a stable element id so HMR reloads do not stack
 * duplicate sheets.
 *
 * All selectors are namespaced under `dsh-` so nothing leaks into the shell.
 * Colours come from the shell's CSS variables where available; the modal
 * surface falls back to the CSS system colours `Canvas`/`CanvasText`, which
 * stay readable on both light and dark themes when the host sets `color-scheme`.
 */

export const STYLE_ELEMENT_ID = 'dsh-birthday-styles';

export const stylesheet = `
/* --- design tokens ------------------------------------------------------- */

.dsh-birthday-page {
  --bd-radius: 12px;
  --bd-gap: 12px;
  --bd-border: var(--dsh-border-color, rgba(127, 127, 127, 0.28));
  --bd-surface: var(--dsh-surface-color, rgba(127, 127, 127, 0.06));
  --bd-surface-strong: var(--dsh-surface-color, rgba(127, 127, 127, 0.12));
  --bd-muted: var(--dsh-text-secondary, rgba(127, 127, 127, 0.95));
  --bd-accent: var(--dsh-accent-color, #d97706);
  --bd-danger: #dc2626;
  --bd-modal: var(--dsh-modal-background, Canvas);
  --bd-modal-text: var(--dsh-modal-color, CanvasText);
  display: flex;
  flex-direction: column;
  gap: var(--bd-gap);
  padding: 16px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}

/* --- header -------------------------------------------------------------- */

.dsh-birthday-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bd-gap);
}

.dsh-birthday-page__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.dsh-birthday-page__actions {
  display: flex;
  gap: 8px;
}

.dsh-birthday-page__zone {
  font-size: 12px;
  color: var(--bd-muted);
}

.dsh-birthday-page__error {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.4);
  background: rgba(220, 38, 38, 0.08);
  font-size: 13px;
}

.dsh-birthday-page__notice {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--bd-border);
  background: var(--bd-surface);
  font-size: 12px;
}

.dsh-birthday-page__empty {
  padding: 32px;
  text-align: center;
  color: var(--bd-muted);
  border: 1px dashed var(--bd-border);
  border-radius: var(--bd-radius);
}

/* --- card grid: 4 per row, degrading gracefully -------------------------- */

.dsh-birthday-page__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--bd-gap);
  align-items: stretch;
}

@media (max-width: 1400px) {
  .dsh-birthday-page__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 1040px) {
  .dsh-birthday-page__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 680px) {
  .dsh-birthday-page__grid { grid-template-columns: minmax(0, 1fr); }
}

/* --- card ---------------------------------------------------------------- */

.dsh-birthday-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--bd-border);
  border-radius: var(--bd-radius);
  background: var(--bd-surface);
  min-width: 0;
  transition: border-color 120ms ease, background 120ms ease;
}

.dsh-birthday-card:hover {
  border-color: var(--bd-accent);
  background: var(--bd-surface-strong);
}

.dsh-birthday-card--degraded {
  border-left: 3px solid var(--bd-accent);
}

/* Gender tint. Translucent so text keeps the host theme's contrast in both
   light and dark shells; the border carries the same hue for a clear signal. */
.dsh-birthday-card--male {
  background: rgba(96, 165, 250, 0.20);
  border-color: rgba(96, 165, 250, 0.45);
}

.dsh-birthday-card--male:hover {
  background: rgba(96, 165, 250, 0.28);
  border-color: rgba(96, 165, 250, 0.75);
}

.dsh-birthday-card--female {
  background: rgba(244, 114, 182, 0.20);
  border-color: rgba(244, 114, 182, 0.45);
}

.dsh-birthday-card--female:hover {
  background: rgba(244, 114, 182, 0.28);
  border-color: rgba(244, 114, 182, 0.75);
}

.dsh-birthday-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dsh-birthday-card__name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.dsh-birthday-card__relation {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  border: 1px solid var(--bd-accent);
  color: var(--bd-accent);
}

.dsh-birthday-card__sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--bd-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-birthday-card__gender {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--bd-border);
  font-size: 11px;
}

/* Age leads the calendar line so a grid reads "who / how old / born when". */
.dsh-birthday-card__age {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--bd-accent);
  font-variant-numeric: tabular-nums;
}

.dsh-birthday-card__shichen {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--bd-border);
  font-size: 11px;
  color: var(--bd-muted);
}

.dsh-birthday-card__main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.dsh-birthday-card__label {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--bd-muted);
}

.dsh-birthday-card__value {
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-birthday-card__countdown {
  font-size: 13px;
  font-weight: 600;
  color: var(--bd-accent);
}

.dsh-birthday-card__zodiac {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.dsh-birthday-card__zodiac-sign {
  font-weight: 500;
}

.dsh-birthday-card__zodiac-element {
  padding: 0 6px;
  border-radius: 6px;
  font-size: 11px;
  border: 1px solid var(--bd-border);
  color: var(--bd-muted);
}

.dsh-birthday-card__shengxiao {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsh-birthday-card__tz {
  font-size: 11px;
  color: var(--bd-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-birthday-card__wuxing {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--bd-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-birthday-card__note {
  font-size: 11px;
  color: var(--bd-muted);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-birthday-card__degraded {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(217, 119, 6, 0.1);
  border: 1px solid rgba(217, 119, 6, 0.35);
}

/* Actions sit at the card's bottom-right regardless of card height. */
.dsh-birthday-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px;
}

/* --- buttons ------------------------------------------------------------- */

.dsh-btn {
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid var(--bd-border);
  background: var(--bd-surface);
  color: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.dsh-btn:hover {
  background: var(--bd-surface-strong);
}

.dsh-btn--sm {
  padding: 2px 10px;
  font-size: 12px;
}

.dsh-btn--primary {
  border-color: var(--bd-accent);
  color: var(--bd-accent);
}

.dsh-btn--primary:hover {
  background: rgba(217, 119, 6, 0.12);
}

.dsh-btn--danger {
  border-color: rgba(220, 38, 38, 0.5);
  color: var(--bd-danger);
}

.dsh-btn--danger:hover {
  background: rgba(220, 38, 38, 0.12);
}

.dsh-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.dsh-icon-btn {
  border: none;
  background: transparent;
  color: var(--bd-muted);
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.dsh-icon-btn:hover {
  background: var(--bd-surface-strong);
}

/* --- modal --------------------------------------------------------------- */

.dsh-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.dsh-modal {
  width: min(760px, 100%);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--bd-border);
  border-radius: var(--bd-radius);
  background: var(--bd-modal);
  color: var(--bd-modal-text);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
}

.dsh-modal--narrow {
  width: min(380px, 100%);
}

/* The almanac needs room for seven columns plus the day-detail panel. */
.dsh-modal--almanac {
  width: min(920px, 100%);
}

.dsh-almanac {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-almanac__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dsh-almanac__title {
  min-width: 108px;
  text-align: center;
  font-size: 14px;
}

.dsh-almanac__jump,
.dsh-almanac__date {
  display: inline-flex;
  gap: 4px;
}

.dsh-almanac__jump {
  margin-left: auto;
}

.dsh-almanac__jump select,
.dsh-almanac__date {
  padding: 3px 6px;
  border: 1px solid var(--bd-border);
  border-radius: 6px;
  background: var(--bd-surface);
  color: inherit;
  font-size: 12px;
}

.dsh-almanac__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.dsh-almanac__weekday {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--bd-muted);
  padding: 2px 0;
}

.dsh-almanac__weekday--end {
  color: var(--bd-danger);
}

.dsh-almanac__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-height: 52px;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bd-surface);
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.dsh-almanac__cell:hover {
  border-color: var(--bd-accent);
}

.dsh-almanac__cell--blank {
  background: transparent;
  cursor: default;
}

.dsh-almanac__cell--blank:hover {
  border-color: transparent;
}

.dsh-almanac__num {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dsh-almanac__cell--end .dsh-almanac__num {
  color: var(--bd-danger);
}

.dsh-almanac__label {
  font-size: 10px;
  line-height: 1.2;
  color: var(--bd-muted);
  white-space: nowrap;
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
}

.dsh-almanac__label--jieqi {
  color: var(--bd-accent);
  font-weight: 600;
}

.dsh-almanac__label--festival {
  color: var(--bd-danger);
}

.dsh-almanac__cell--today {
  border-color: var(--bd-accent);
}

.dsh-almanac__cell--selected {
  background: var(--bd-surface-strong);
  border-color: var(--bd-accent);
}

.dsh-almanac__detail {
  border-top: 1px solid var(--bd-border);
  padding-top: 10px;
}

.dsh-almanac__detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 14px;
}

.dsh-almanac__badge {
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--bd-accent);
  color: var(--bd-accent);
  font-size: 11px;
}

.dsh-almanac__facts {
  margin: 0;
}

.dsh-almanac__facts dd {
  line-height: 1.5;
}

.dsh-almanac__yi {
  color: #16a34a;
}

.dsh-almanac__ji {
  color: var(--bd-danger);
}

.dsh-almanac__hint {
  padding: 12px 0;
  text-align: center;
  color: var(--bd-muted);
  font-size: 13px;
}

.dsh-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bd-border);
}

.dsh-modal__header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.dsh-modal__body {
  padding: 16px;
  overflow-y: auto;
}

.dsh-confirm__message {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
}

/* --- form ---------------------------------------------------------------- */

.dsh-birthday-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-birthday-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--bd-muted);
  min-width: 0;
}

.dsh-birthday-form input,
.dsh-birthday-form select {
  padding: 6px 8px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid var(--bd-border);
  background: transparent;
  color: inherit;
}

.dsh-birthday-form input[type='checkbox'] {
  align-self: flex-start;
  width: 16px;
  height: 16px;
}

.dsh-birthday-form small {
  font-size: 11px;
  color: var(--bd-muted);
}

/* Leap-month notice: guidance next to the year input, visually distinct from
   the static field description. */
.dsh-birthday-form__hint {
  font-size: 11px;
  color: var(--bd-accent);
}

/* Field label row: the field name, plus the inline 闰月 tick shown when the
   chosen month is the one that year doubles. */
.dsh-birthday-form__label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dsh-birthday-form__leap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--bd-accent);
  color: var(--bd-accent);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}

.dsh-birthday-form__leap input[type='checkbox'] {
  width: 12px;
  height: 12px;
  margin: 0;
  align-self: center;
}

.dsh-birthday-form__leap-note {
  font-size: 11px;
  color: var(--bd-muted);
}

/* 时辰 reads as a short dropdown, not a full-width text box. */
.dsh-birthday-form__field--shichen {
  flex: 0 1 120px;
}

.dsh-birthday-form__row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.dsh-birthday-form__row > label {
  flex: 1 1 140px;
}

.dsh-birthday-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.dsh-birthday-form__error {
  font-size: 12px;
  color: var(--bd-danger);
}

/* --- read-only view ------------------------------------------------------ */

.dsh-birthday-view {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr);
  gap: 8px 12px;
  margin: 0 0 16px;
  font-size: 13px;
}

.dsh-birthday-view dt {
  color: var(--bd-muted);
}

.dsh-birthday-view dd {
  margin: 0;
  word-break: break-word;
}

/* --- sidebar entry ------------------------------------------------------- */

.dsh-birthday-sidebar-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}
`;

/**
 * Inject the stylesheet exactly once into the given root.
 *
 * The target may be the document or a shadow root: a panel mounted inside a
 * shadow tree is NOT styled by a sheet in `document.head`, so the caller passes
 * the panel's own root and the sheet lands where its selectors actually apply.
 * @param target - document or shadow root; defaults to the global document.
 * @returns True when the sheet is present under that root after the call.
 */
export function injectStyles(target?: Document | ShadowRoot | null): boolean {
  const root = target ?? (typeof document === 'undefined' ? undefined : document);
  if (root === undefined || root === null) return false;
  if (root.getElementById(STYLE_ELEMENT_ID) !== null) return true;

  const ownerDocument = (root as ShadowRoot).ownerDocument ?? (root as Document);
  const element = ownerDocument.createElement('style');
  element.id = STYLE_ELEMENT_ID;
  element.textContent = stylesheet;

  const head = (root as Document).head;
  if (head !== undefined && head !== null) head.appendChild(element);
  else (root as ShadowRoot).appendChild(element);
  return true;
}

/**
 * Resolve the styling root for a mounted node and inject the sheet there.
 * Walks to the node's root so a shadow-DOM mount is styled in place.
 * @param node - any node of the rendered panel.
 * @returns True when a root was found and the sheet installed.
 */
export function injectStylesForNode(node: Element | null | undefined): boolean {
  if (node === null || node === undefined) return false;
  let root: Node;
  try {
    root = node.getRootNode();
  } catch {
    return false;
  }
  if (typeof (root as Document | ShadowRoot).getElementById === 'function') {
    return injectStyles(root as Document | ShadowRoot);
  }
  return injectStyles();
}
