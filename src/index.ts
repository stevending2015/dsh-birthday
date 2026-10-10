/**
 * dsh-birthday main entry.
 *
 * Exports the cordis plugin factory that DSH loads, plus a small helper for
 * programmatic use (e.g. inside other plugins or scripts).
 */

import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCalendarEngine,
  type CalendarEnginePublic,
} from './calendar/index.js';
import { createBirthdayStore } from './birthday/db.js';
import { BirthdayService } from './birthday/services/birthday-service.js';
import { UpcomingService } from './birthday/services/upcoming.js';
import { ReminderService } from './birthday/services/reminder.js';
import { migrateLegacyStores } from './birthday/services/legacy-migration.js';
import { registerBirthdayTools } from './birthday/tools/index.js';
import { mountBirthdayRoutes } from './birthday/routes/api.js';

export const name = 'dsh-birthday';
/**
 * `tools` is a core DSH service, so declaring it here is what makes
 * `ctx.tools.register(...)` available. Everything else the plugin can use
 * (the host web server) is bound opportunistically at runtime via
 * `ctx.inject([...])`, so a host without it still activates the plugin.
 */
export const inject = ['tools'];

export const Config = Schema.object({
  timezoneEngine: Schema.string().default('system')
    .description('时区引擎: system 或 embedded-tzdb'),
  enabledCalendars: Schema.array(Schema.string())
    .default(['gregorian', 'lunar', 'islamic', 'hebrew'])
    .description('启用的历法。内置: gregorian/lunar/islamic/hebrew。'),
  allowThirdPartyAdapters: Schema.boolean().default(true)
    .description('是否允许第三方插件注册历法适配器'),
  dbPath: Schema.string().default(''),
  defaultTimezone: Schema.string().default('Asia/Shanghai'),
  reminderDaysBefore: Schema.array(Schema.number()).default([3, 1]),
  leapMonthStrategy: Schema.string().default('normal')
    .description('闰月生日在无闰月年份的策略: normal/postpone/skip'),
});

/**
 * Find the DSH home from this plugin's own location.
 *
 * The plugin is installed under `<home>/profiles/<profile>/node_modules/...`,
 * so walking up to the `profiles` directory finds the home regardless of the
 * directory `dsh` happened to be launched from — the one fact that makes the
 * store path deterministic.
 * @param from - a file URL inside the installed package.
 * @returns The home path, or undefined when the layout is not a DSH profile.
 */
function homeFromModuleLocation(from: string): string | undefined {
  let url: URL;
  try {
    url = new URL(from);
  } catch {
    return undefined;
  }
  let dir = fileURLToPath(new URL('.', url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (basename(dir) === 'profiles') return dirname(dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Choose where the birthday store lives when the config leaves it empty.
 *
 * Determinism is the whole point: a path derived from the launch directory
 * splits the same library across files, which presents as "my birthdays
 * disappeared after a restart". Every source below is independent of cwd.
 *
 * Order: explicit config, `DSH_HOME`, the host's `dshHomePath` service, this
 * module's own install location, then a conventional `~/.dsh`. Only when none
 * of those resolve — a host outside DSH — does it fall back to the cwd.
 * @param ctx - activating context, for the optional home service.
 * @param configured - the `dbPath` config value, if any.
 * @returns The store path (SQLite file, or its JSON fallback twin).
 */
function resolveDefaultDbPath(ctx: Context, configured?: string): string {
  if (typeof configured === 'string' && configured.trim() !== '') return configured;

  const candidates: Array<string | undefined> = [];
  candidates.push(process.env.DSH_HOME);
  try {
    const home = ctx.get?.('dshHomePath');
    if (typeof home === 'string') candidates.push(home);
  } catch {
    // Not injected on this host; the other sources still apply.
  }
  candidates.push(homeFromModuleLocation(import.meta.url));
  const conventional = join(homedir(), '.dsh');
  if (existsSync(join(conventional, 'profiles'))) candidates.push(conventional);

  for (const home of candidates) {
    if (typeof home === 'string' && home.trim() !== '') {
      return join(home, 'dsh-birthday', 'birthdays.db');
    }
  }
  return join(process.cwd(), 'data', 'dsh-birthday.db');
}

/**
 * Legacy store locations that earlier versions could have written to, because
 * the default path used to follow `process.cwd()`.
 * @returns Candidate paths, most likely first.
 */
function legacyStoreCandidates(): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const push = (p: string) => {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      list.push(p);
    }
  };
  push(join(process.cwd(), 'data', 'dsh-birthday.db'));
  push(join(homedir(), 'data', 'dsh-birthday.db'));
  push(join(homedir(), '.dsh', 'dsh-birthday', 'birthdays.db'));
  return list;
}

export function apply(ctx: Context, config: any) {
  const engine: CalendarEnginePublic = createCalendarEngine({
    enabledCalendars: config.enabledCalendars,
    timezoneEngine: config.timezoneEngine,
    defaultTimezone: config.defaultTimezone,
  });

  ctx.provide('calendar', engine);

  const dbPath = resolveDefaultDbPath(ctx, config.dbPath);
  // A degraded or recovered store must be visible in the log, never silent.
  const store = createBirthdayStore(dbPath, (message) => ctx.logger?.warn?.(message));
  const reminders = new ReminderService({ reminderDaysBefore: config.reminderDaysBefore });
  const service = new BirthdayService(engine.hub, store, reminders);
  const upcoming = new UpcomingService(engine.hub);

  ctx.logger?.info?.(`[dsh-birthday] store: ${store.path} (${store.engine})`);

  // Recover anything an earlier version wrote to a launch-directory-dependent
  // path. Idempotent, non-destructive, and it never overwrites a newer row —
  // this is what stops a restart from looking like data loss.
  //
  // Only when we derived the path ourselves: an explicit `dbPath` means the
  // operator knows where their data lives, and scanning the home directory on
  // top of that would be surprising.
  const pathWasConfigured = typeof config.dbPath === 'string' && config.dbPath.trim() !== '';
  if (pathWasConfigured) {
    ctx.logger?.info?.('[dsh-birthday] dbPath configured explicitly; legacy recovery skipped');
  } else {
    try {
      const migrations = migrateLegacyStores(store, store.path, legacyStoreCandidates());
      for (const migration of migrations) {
        if (migration.error !== undefined) {
          ctx.logger?.warn?.(
            `[dsh-birthday] legacy store not migrated (${migration.from}): ${migration.error}`,
          );
        } else if (migration.added > 0 || migration.updated > 0) {
          ctx.logger?.info?.(
            `[dsh-birthday] recovered ${migration.added} record(s) (+${migration.updated} newer) from ${migration.from}`,
          );
        }
      }
    } catch (e) {
      ctx.logger?.warn?.(`[dsh-birthday] legacy migration skipped: ${(e as Error).message}`);
    }
  }

  ctx.provide('birthday', { service, upcoming, store, reminders });

  // Rows written before the 生肖 column existed (or with the old month-only
  // zodiac) are repaired once here, so existing data shows up correctly
  // without the user re-entering anything.
  try {
    const repaired = service.backfillEnrichment();
    if (repaired > 0) ctx.logger?.info?.(`[dsh-birthday] backfilled ${repaired} record(s)`);
  } catch (e) {
    ctx.logger?.warn?.(`[dsh-birthday] backfill skipped: ${(e as Error).message}`);
  }

  // Storage facts for the self-check and the transfer tools. Passed as a getter
  // so a report always reflects the live engine rather than a boot-time copy.
  const storage = () => ({ path: store.path, engine: store.engine });

  registerBirthdayTools(ctx, service, upcoming, { hub: engine.hub, storage });

  // Mount the HTTP API once the host web server service becomes available.
  ctx.inject(['webServer'], (host: any) => {
    const webServer = host?.webServer ?? host;
    if (typeof webServer?.register !== 'function') {
      ctx.logger?.warn?.(
        '[dsh-birthday] webServer present but exposes no register(); HTTP API not mounted',
      );
      return;
    }
    try {
      mountBirthdayRoutes(webServer, { hub: engine.hub, service, upcoming, storage });
      ctx.logger?.info?.('[dsh-birthday] HTTP API mounted at /api/birthday');
    } catch (e) {
      ctx.logger?.error?.(`[dsh-birthday] failed to mount HTTP API: ${(e as Error).message}`);
    }
  });

  ctx.on('dispose', () => {
    store.close();
  });
}

// Programmatic helpers (no cordis required):

export { createCalendarEngine } from './calendar/index.js';
export { AdapterRegistry, GregorianHub, TimezoneService, createTimezoneService } from './calendar/index.js';
export {
  GregorianAdapter,
  LunarAdapter,
  IslamicAdapter,
  HebrewAdapter,
} from './calendar/index.js';
export { createBirthdayStore } from './birthday/db.js';
export { BirthdayService } from './birthday/services/birthday-service.js';
export { UpcomingService } from './birthday/services/upcoming.js';
export { ReminderService } from './birthday/services/reminder.js';
export { registerBirthdayTools } from './birthday/tools/index.js';
export { createBirthdayRouter } from './birthday/routes/api.js';
export type { CalendarAdapter, CalendarFields, FieldDescriptor, AdapterCapabilities } from './calendar/types.js';
export type { BirthdayInput, BirthdayRecord } from './birthday/models/birthday.js';
export type { UpcomingEntry } from './calendar/hub.js';
