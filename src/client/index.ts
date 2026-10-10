/**
 * Client entry — a DSH browser-side cordis plugin.
 *
 * Registration contract (mirrors the shipped UI packages):
 *   - `sidebar.panellist` (list slot): the sidebar button; its `id` selects
 *     the matching `main` cell, and `label` is the visible label.
 *   - `main` (keyed slot): the central panel body addressed by that same id.
 *
 * `ctx.slots.inject(key, cb)` defers registration until the owning package has
 * declared the slot, so a host without the sidebar/panel slots skips this
 * rather than throwing.
 */

import * as React from 'react';
import { BirthdayPanel } from './BirthdayPanel.js';
import { SidebarEntry } from './SidebarEntry.js';
import { injectStyles } from './styles.js';

export const name = 'dsh-birthday';
export const inject = ['slots'];

/** Sidebar cell id; also the `main` key that the button selects. */
const PANEL_ID = 'dsh-birthday';

export function apply(ctx: any): void {
  // The client ships as one classic script, so there is no CSS asset to
  // register; the sheet is injected once into the document head.
  try {
    injectStyles();
  } catch (e) {
    ctx?.logger?.warn?.(`[dsh-birthday] stylesheet not injected: ${(e as Error).message}`);
  }

  const slots = ctx?.slots;
  if (slots === undefined || typeof slots.inject !== 'function') return;

  try {
    slots.inject('sidebar.panellist', () =>
      slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 100, label: '生日' },
        () => React.createElement(SidebarEntry, null),
      ),
    );
  } catch (e) {
    ctx?.logger?.warn?.(`[dsh-birthday] sidebar entry not registered: ${(e as Error).message}`);
  }

  try {
    slots.inject('main', () =>
      slots.register(
        { name: 'main', key: PANEL_ID },
        () => React.createElement(BirthdayPanel, null),
      ),
    );
  } catch (e) {
    ctx?.logger?.warn?.(`[dsh-birthday] main panel not registered: ${(e as Error).message}`);
  }
}

export { BirthdayPanel, SidebarEntry };
