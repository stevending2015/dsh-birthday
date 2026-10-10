# dsh-birthday

A multi-calendar birthday library for the DSH plugin ecosystem. Records
birthdays in any of four built-in calendars — 公历 (Gregorian), 中国农历
(Chinese lunar), 伊斯兰历 (Islamic Hijri), 希伯来历 (Hebrew) — and shows them in
a sidebar panel with cross-timezone-aware reminders.

All data stays on your machine; the plugin makes no network calls.

## Features

- **Four calendars**, with a pluggable adapter API for more (Tibetan, Mayan, …).
- **Gregorian hub**: every record is anchored to a concrete Gregorian date, so
  reminders and sorting work uniformly across calendars.
- **Leap-month aware**: the Chinese form offers the 闰月 tick only when the
  selected month really is doubled that year, and tells you which one it is.
- **时辰 (Chinese double-hour)** select for lunar birthdays, defaulting to 辰.
- **Age** (completed years, correct across the date line) on each card.
- **生肖 from the lunar year**, so a Gregorian birthday gets one too.
- **Smart cross-timezone reminders**: when the birth timezone and yours differ,
  the reminder is pinned to a wall-clock time you can act on.
- **Degradation, not failure**: a record whose date has no equivalent in the
  current year (a leap-month birthday in a year without that month) is flagged
  and still resolvable, instead of throwing.
- **Export / import** as a versioned JSON envelope; derived values are
  recomputed on import rather than trusted.

## Install

Requires DSH `0.2.0-rc.2` or a compatible release.

### From the registry (once published)

```bash
dsh plugin --profile web add dsh-birthday
```

### From a local tarball

```bash
npm pack                                     # produces dsh-birthday-0.1.0.tgz
dsh plugin --profile web add ./dsh-birthday-0.1.0.tgz
```

### From a git repository

```bash
dsh plugin --profile web add github:stevending2015/dsh-birthday
```

The build output is not committed, so this path builds the package on install
(`prepare`). It therefore needs a working Node/TypeScript toolchain — prefer the
registry or tarball route if you just want to use the plugin.

### Then register the bundle — required

> `dsh plugin` forwards its arguments **verbatim to pnpm** in the profile
> directory. It installs the package but does **not** touch the profile's bundle
> list, so the plugin will not load until you add it.

Edit `<DSH_HOME>/profiles/web/package.json` and append the package name to the
end of `dsh.profile.bundles`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-birthday"
      ]
    }
  }
}
```

Order matters: bundles are applied as patch layers in list order, so a plugin
that layers on the base belongs **after** it. Then restart DSH:

```bash
dsh web
```

Installing through the in-app plugin manager (Settings → Plugins) does both
steps for you, because it reconciles the bundle list itself.

### Uninstall

```bash
dsh plugin --profile web remove dsh-birthday
```

Then drop `"dsh-birthday"` from `dsh.profile.bundles`. Your database file is
left alone; delete `<DSH_HOME>/dsh-birthday/` to remove the records too.

## What it adds to DSH

- **Sidebar panel** 「生日」 (slot `sidebar.panellist` + `main`) with a
  4-column card grid. Cards show the age, the calendar date, 时辰, 星座 and 生肖,
  tinted light blue for male and pink for female. Each card has 查看 / 编辑 /
  删除 buttons.
- **8 agent tools**:
  `birthday_add`, `birthday_query`, `birthday_update`, `birthday_delete`,
  `birthday_upcoming`, `birthday_db_info`, `birthday_export`,
  `birthday_import`.
- **HTTP API** under `/api/birthday/*`: `list`, `calendars`, `year-info`,
  `db-info`, `export`, `upcoming`, `add`, `update`, `delete`, `import`.
  See [docs/birthday-api.md](docs/birthday-api.md).

## Configuration

Defaults ship in `cordis.patch.yml`. Override them in your profile's own
`cordis.patch.yml` (the user layer), targeting the entry by id:

```yaml
- id: dsh-birthday
  config:
    enabledCalendars: [gregorian, lunar]
    defaultTimezone: Asia/Shanghai
    reminderDaysBefore: [3, 1]
```

| key | default | meaning |
|---|---|---|
| `timezoneEngine` | `system` | `system` uses the platform's `Intl` zone data |
| `enabledCalendars` | all four | which adapters to register |
| `allowThirdPartyAdapters` | `true` | permit runtime adapter registration |
| `dbPath` | `''` → derived | explicit database path; empty means derive one (see below) |
| `defaultTimezone` | `Asia/Shanghai` | fallback birth timezone |
| `reminderDaysBefore` | `[3, 1]` | how many days ahead to remind |
| `leapMonthStrategy` | `normal` | handling for leap-month birthdays |

## Where your data lives

With `dbPath` empty the path is derived, and **every source is independent of the
directory `dsh` was launched from** — otherwise the same library would split
across files and look like data loss after a restart. Resolution order:

1. `config.dbPath` (explicit)
2. `$DSH_HOME`
3. the host's `dshHomePath` service
4. this package's own install location
   (`<home>/profiles/<profile>/node_modules/...` → walk up to `profiles`)
5. `~/.dsh`, when it contains `profiles`
6. `<cwd>/data/dsh-birthday.db` (only outside DSH)

The engine is chosen by **what the file actually is**, not by which modules
happen to load: a JSON store stays JSON even if the native SQLite driver becomes
available later. That matters because handing a JSON file to SQLite would start
an empty database over your records.

- **SQLite** via `better-sqlite3` when it is genuinely usable (optional
  dependency; needs a successful native build).
- **JSON** otherwise. Writes are atomic (temp file → `fsync` → rename), so an
  interrupted write cannot truncate the store, and an unparseable file is moved
  aside as `<name>.corrupt-<timestamp>` rather than silently reset.

Check the live state at any time with the `birthday_db_info` tool or
`GET /api/birthday/db-info`; it reports the path, engine, byte-level format and
whether the store is encrypted.

## Development

```bash
npm install
npm run build:all   # tsc → lib/, esbuild → client/client.js
npm run lint        # type-check sources and tests, no emit
npm test            # vitest
npm run verify      # integration harness (real HTTP + real defineTool)
npm run verify:client
npm run check       # all of the above
```

`npm pack` runs `prepack`, so the tarball always contains a fresh build.

## Documentation

- [docs/dsh-integration.md](docs/dsh-integration.md) — how the plugin binds to
  DSH: profile/bundle/patch composition, the client bundle contract, storage
  determinism.
- [docs/calendar-adapter-guide.md](docs/calendar-adapter-guide.md) — writing a
  third-party calendar adapter.
- [docs/birthday-api.md](docs/birthday-api.md) — the HTTP surface.

## License

MIT — see [LICENSE](LICENSE).
