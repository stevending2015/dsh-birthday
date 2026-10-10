# Birthday HTTP API

All routes are mounted under `/api/birthday/*`. They return JSON.

## `GET /api/birthday/list`

List all birthdays.

```json
[
  {
    "id": 1,
    "name": "张三",
    "calendarSystem": "gregorian",
    "fields": { "year": 1990, "month": 3, "day": 4 },
    "birthTimezone": "Asia/Shanghai",
    "gregorianLocalDate": "1990-03-04",
    "birthdayStartUtc": "1990-03-03T16:00:00.000Z",
    "zodiacSign": "双鱼座",
    "wuxingSummary": "木 ████ 火 ██ 土 ██ 金 █ 水 ██"
  }
]
```

## `GET /api/birthday/calendars`

Returns the descriptor for every registered adapter.

```json
[
  { "id": "gregorian", "name": "公历", "minYear": 1, "maxYear": 9999, "dayBoundary": "midnight",
    "fields": [...], "capabilities": { "solarAligned": true, ... } },
  { "id": "lunar", "name": "中国农历", "hasLeapMonth": true, ... }
]
```

## `GET /api/birthday/upcoming?tz=Asia/Shanghai&hour=9`

Returns the next occurrence of every birthday, plus the user-local action
instant.

```json
[
  {
    "id": 1,
    "name": "张三",
    "nextLocalDate": "2026-03-04",
    "userActionUtc": "2026-03-04T01:00:00.000Z",
    "sameOffset": true,
    "degraded": false
  }
]
```

When the user is in a different timezone from the birth location,
`sameOffset: false` and `userActionUtc` reflects the moment the user is in
their own daytime (default 09:00 local).

## `POST /api/birthday/add`

```json
{
  "name": "李四",
  "calendarSystem": "lunar",
  "fields": { "year": 1995, "month": 8, "day": 15, "isLeapMonth": false },
  "birthTimezone": "Asia/Shanghai",
  "relation": "同事",
  "note": "生日蛋糕偏好榴莲"
}
```

Returns the saved `BirthdayRecord`.

## `POST /api/birthday/update`

```json
{ "id": 1, "note": "改主意了" }
```

Any subset of fields is patch-merged.

## `POST /api/birthday/delete`

```json
{ "id": 1 }
```

Returns `{ "ok": true }`. The associated reminder tasks are cancelled.

## `GET /api/birthday/year-info?calendar=lunar&year=2020`

Calendar-specific facts about one year, used to guide data entry. For the
Chinese calendar this is the doubled month, so the form can tell the user which
month is a leap month before they decide whether to tick 闰月.

```json
{ "calendar": "lunar", "year": 2020, "leapMonth": 4, "note": "2020 年闰四月，若出生在该闰月请勾选「闰月」" }
```

`leapMonth` is `null` for a year with no leap month (e.g. 2021). Calendars
without the concept omit the key entirely. A missing `calendar` or `year` is a
400.

## `GET /api/birthday/db-info`

Storage self-check: where the database is, what it is, and whether it is
encrypted.

```json
{
  "path": "<DSH_HOME>/dsh-birthday/birthdays.db",
  "exists": true,
  "engine": "json",
  "format": "json",
  "encryption": "none",
  "sizeBytes": 1954,
  "readable": true,
  "writable": true,
  "records": 3,
  "consistent": true,
  "summary": "JSON 明文存储，未加密（内容可直接读取）。"
}
```

`format` is what the bytes on disk actually are — `sqlite` (starts with the
16-byte `SQLite format 3\0` magic), `json`, `unrecognized`, or `missing`.
`encryption` is `none` for the first two, `suspected` for anything else (an
encrypted container has no plaintext magic), and `unknown` when the file is
absent or unreadable. `consistent` is false when the live engine is not reading
what the path holds.

## `GET /api/birthday/export`

Exports every record as the standard JSON envelope. JSON is the only format, in
both directions, so an export always imports back.

```json
{
  "format": "json",
  "filename": "dsh-birthday.json",
  "text": "{ ... }",
  "envelope": {
    "format": "dsh-birthday-export",
    "version": 1,
    "exportedAt": "2026-10-09T18:00:00.000Z",
    "count": 3,
    "birthdays": [
      {
        "name": "张三",
        "gender": "male",
        "relation": "家人",
        "note": "农历八月十五",
        "calendarSystem": "lunar",
        "fields": { "year": 1990, "month": 8, "day": 15, "isLeapMonth": false, "shichen": "辰" },
        "birthTimezone": "Asia/Shanghai",
        "derived": { "gregorianLocalDate": "1990-10-03", "zodiacSign": "天秤座", "shengxiao": "马" }
      }
    ]
  }
}
```

`fields` plus `birthTimezone` is the source of truth. `derived` is reference
only: import RECOMPUTES it, so a file from an older version — or a hand-edited
one — still lands correctly.

## `POST /api/birthday/import`

```json
{ "text": "<the exported JSON>", "mode": "merge", "dryRun": false }
```

`text` may be the envelope, a bare array of records, or a single record; a
pre-parsed `data` payload is accepted instead. `mode` is `merge` (default,
skips records already present) or `append`. `dryRun` validates without writing.

```json
{
  "dryRun": false, "mode": "merge", "total": 3,
  "imported": 2, "skipped": 1, "failed": 0,
  "results": [ { "index": 0, "name": "张三", "status": "skipped", "reason": "已存在同名同历法同日期记录" } ]
}
```

One bad record never aborts the batch: it is reported with its index and reason
while the rest are imported. Non-JSON input is rejected.

## Error format

Any failure returns `{ "error": "<message>" }`. The HTTP status code is
always 200 — clients should look at the presence of `error` to detect
failures (this keeps the router framework-agnostic).
