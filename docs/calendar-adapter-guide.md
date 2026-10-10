# Calendar Adapter Authoring Guide

This document describes how to add a new calendar to `dsh-birthday` without
modifying the core package. A third-party adapter is just a TypeScript module
that implements the `CalendarAdapter` interface and calls
`registry.register(adapter)` on the engine instance.

## The contract

```ts
import type { CalendarAdapter } from 'dsh-birthday';

const myAdapter: CalendarAdapter = {
  id: 'tibetan',
  name: '藏历',
  minYear: 1900,
  maxYear: 2100,
  dayBoundary: 'midnight',
  capabilities: {
    hasLeapMonth: true,
    hasSkippedDays: true,
    sunsetBoundary: false,
    needsMoonSighting: false,
    solarAligned: false,
  },
  validate(fields) { /* ... */ },
  toGregorian(fields, tz) { /* ... */ },
  fromGregorian(localDate, tz) { /* ... */ },
  resolveAnnual(birthday, targetYear, tz) { /* ... */ },
  describeFields() { /* ... */ },
};
```

### `capabilities` matters

`capabilities` is declarative. The UI uses it to:

- render warnings (`needsMoonSighting` → "可能与观月相差 1–2 天");
- decide whether to ask for `afterSunset`;
- decide whether `isLeapMonth` checkbox is relevant.

You don't need to "implement" these capabilities — you only need to declare
them honestly. The adapter's behavior should match.

### `toGregorian`

Must return:

```ts
{
  localDate: 'YYYY-MM-DD',   // date in the requested timezone
  startUtc:   '2025-01-29T00:00:00.000Z',
  timezone:   'Asia/Shanghai',
}
```

If your calendar has a `sunsetBoundary` and `afterSunset: true` was set,
shift the local date by one whole day before computing `startUtc`.

### `fromGregorian`

Receives a YYYY-MM-DD in the user's timezone and must return a
`CalendarFields` value for the *current* day in the requested calendar. Used
when the user browses "what day of my calendar is today?".

### `resolveAnnual`

Given a birthday `{ year, month, day, isLeapMonth? }` and a target year,
return the UTC instant of the next occurrence. If the target year has no
corresponding leap month, you can either:

- return `{ degraded: true, degradationReason: '...', ... }` with the
  fallback date, **or**
- throw `InvalidDateError` and let the service layer handle the `leapMonthStrategy` config.

The first option gives the UI more context, which is why the built-in
adapters prefer it.

### `describeFields`

Return an array of `FieldDescriptor` so the form renderer knows what to draw.
Order them in the natural input order (year, month, day, then optional
fields). The renderer sorts by `order` if present, else by array order.

## Registration

Inside your plugin's `apply(ctx)`:

```ts
export function apply(ctx: Context) {
  const calendar = ctx.get('calendar');
  calendar.hub.adapterRegistry.register(myAdapter);
  ctx.logger.info('[my-plugin] registered tibetan calendar');
}
```

That's it — the next call to `GET /api/birthday/calendars` will include your
adapter, and the dynamic form will pick it up automatically.

## Tests

Place a verification fixture under `tests/third-party.test.ts` that mounts a
fake adapter through `createCalendarEngine({ thirdPartyFactories: { ... } })`
and round-trips a known date. See `tests/third-party.test.ts` in this
package for a working example.

## Pulling in a 3rd-party algorithm

For complex calendars (Tibetan, Mayan) you'll want a dedicated npm package
such as `@your-org/calendar-tibetan`. The adapter file is then a thin wrapper:

```ts
import { tibetanToGregorian } from '@your-org/calendar-tibetan';
// ...implement CalendarAdapter using the wrapper...
```

## What you should NOT do

- Don't import from `dsh-birthday/src/...`; import from the package entry.
- Don't add new dependencies to `dsh-birthday`. Keep them in your plugin.
- Don't bypass `validate`; users of your adapter depend on the warnings you
  emit (e.g. "the day you entered was a skipped day; we used the next
  legal day").
