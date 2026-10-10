/**
 * Display switches.
 *
 * These are deliberately data-independent: the values are still computed and
 * stored, so flipping a flag back to `true` restores the row without touching
 * the database, the API, or the tools.
 */

/** Show the five-element (五行) histogram row on a card. */
export const SHOW_WUXING = false;

/**
 * Show the leap-month degradation notice (e.g. "闰4月生日在 2027 年无闰月").
 * The *date* is still resolved through the same fallback; only the notice is
 * hidden, and the card loses its degraded accent stripe with it.
 */
export const SHOW_DEGRADATION_NOTICE = false;
