/**
 * HTTP API for the birthday plugin.
 *
 * Two layers:
 *  1. `dispatchBirthdayRequest` — a framework-free dispatcher over
 *     `{ method, url, body }`. Unit-testable without an HTTP server.
 *  2. `mountBirthdayRoutes` — binds that dispatcher onto DSH's `webServer`
 *     service via `webServer.register({ kind: 'exact', path, handler })`,
 *     the registration API the host web server exposes.
 *
 * Routes (all JSON):
 *   GET  /api/birthday/list
 *   GET  /api/birthday/calendars
 *   GET  /api/birthday/year-info?calendar=..&year=..
 *   GET  /api/birthday/db-info
 *   GET  /api/birthday/export
 *   GET  /api/birthday/upcoming?tz=..&hour=..
 *   POST /api/birthday/add
 *   POST /api/birthday/update
 *   POST /api/birthday/delete
 *   POST /api/birthday/import
 */

import type { GregorianHub } from '../../calendar/hub.js';
import type { BirthdayService } from '../services/birthday-service.js';
import type { UpcomingService } from '../services/upcoming.js';
import { inspectDatabase } from '../services/db-inspect.js';
import { buildExport, importBirthdays, parseImportText } from '../services/transfer.js';

export interface HttpContext {
  method: string;
  url: string;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface BirthdayRoutes {
  hub: GregorianHub;
  service: BirthdayService;
  upcoming: UpcomingService;
  /**
   * Storage facts for the self-check. A getter rather than a value so the report
   * always reflects the live engine.
   */
  storage?: () => { path: string; engine: 'sqlite' | 'json' };
}

/** Minimal shape of the host web server service we bind to. */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (request: any, response: any) => void | Promise<void>;
  }): () => void;
}

/**
 * Pure request dispatcher. Never throws: failures come back as
 * `{ status: 500, body: { error } }` so a handler can always respond.
 * @param req - normalized request context.
 * @param routes - the services the routes read from.
 * @returns The status and JSON body to send.
 */
export async function dispatchBirthdayRequest(
  req: HttpContext,
  routes: BirthdayRoutes,
): Promise<HttpResponse> {
  const { hub, service, upcoming } = routes;
  const path = req.url.split('?')[0].replace(/^\/api\/birthday/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/list') {
      return { status: 200, body: { items: service.list() } };
    }
    if (req.method === 'GET' && path === '/calendars') {
      return { status: 200, body: { items: hub.listCalendars() } };
    }
    if (req.method === 'GET' && path === '/year-info') {
      // Calendar-specific facts that guide data entry, e.g. the Chinese leap
      // month of a year, so the form can tell the user which month is doubled.
      const url = new URL(req.url, 'http://localhost');
      const calendar = url.searchParams.get('calendar') ?? '';
      const year = Number(url.searchParams.get('year'));
      if (calendar === '' || !Number.isFinite(year)) {
        return { status: 400, body: { error: 'calendar and year are required' } };
      }
      return { status: 200, body: { calendar, year, ...hub.yearInfo(calendar, year) } };
    }
    if (req.method === 'GET' && path === '/upcoming') {
      const url = new URL(req.url, 'http://localhost');
      const tz = url.searchParams.get('tz') || 'Asia/Shanghai';
      const hour = url.searchParams.get('hour');
      const items = upcoming.resolveAll(service.list(), {
        userTimezone: tz,
        userReminderHour: hour === null ? undefined : Number(hour),
      });
      return { status: 200, body: { items } };
    }
    if (req.method === 'POST' && (path === '/add' || path === '/')) {
      const body = (req.body ?? {}) as Record<string, any>;
      const record = await service.add({
        name: String(body.name),
        gender: body.gender,
        calendarSystem: String(body.calendarSystem),
        fields: body.fields,
        birthTimezone: String(body.birthTimezone),
        relation: body.relation,
        note: body.note,
      });
      return { status: 200, body: { record } };
    }
    if (req.method === 'POST' && path === '/update') {
      const body = (req.body ?? {}) as Record<string, any>;
      const record = await service.update(Number(body.id), {
        name: body.name,
        gender: body.gender,
        calendarSystem: body.calendarSystem,
        fields: body.fields,
        birthTimezone: body.birthTimezone,
        relation: body.relation,
        note: body.note,
      });
      return { status: 200, body: { ok: record !== undefined, record } };
    }
    if (req.method === 'POST' && path === '/delete') {
      const body = (req.body ?? {}) as Record<string, any>;
      return { status: 200, body: { ok: await service.remove(Number(body.id)) } };
    }

    // --- storage self-check and data transfer -------------------------------
    if (req.method === 'GET' && path === '/db-info') {
      const storage = routes.storage?.();
      if (storage === undefined) {
        return { status: 200, body: { error: 'storage path unavailable in this host' } };
      }
      return {
        status: 200,
        body: inspectDatabase(storage.path, storage.engine, service.list().length),
      };
    }

    if (req.method === 'GET' && path === '/export') {
      // JSON only: one round-trip format, so an export always imports back.
      const envelope = buildExport(service.list());
      return {
        status: 200,
        body: {
          format: 'json',
          filename: 'dsh-birthday.json',
          text: JSON.stringify(envelope, null, 2),
          envelope,
        },
      };
    }

    if (req.method === 'POST' && path === '/import') {
      const body = (req.body ?? {}) as Record<string, any>;
      // Accept either raw text (a pasted/uploaded file) or a pre-parsed payload.
      const entries =
        typeof body.text === 'string' ? parseImportText(body.text) : body.data ?? body;
      const outcome = await importBirthdays(routes.hub, service, entries, {
        mode: body.mode === 'append' ? 'append' : 'merge',
        dryRun: body.dryRun === true,
      });
      return { status: 200, body: outcome };
    }

    return { status: 404, body: { error: 'not_found', path } };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

/** Write one JSON response with the correct content type. */
function sendJson(response: any, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(text);
}

/** Read and parse a JSON request body; an empty body becomes `{}`. */
async function readJsonBody(request: any): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {};
  return JSON.parse(raw);
}

/**
 * Bind the birthday routes onto the host web server.
 * @param webServer - the host's web server service.
 * @param routes - the services the routes read from.
 * @returns One disposer per registered route.
 */
export function mountBirthdayRoutes(
  webServer: WebServerLike,
  routes: BirthdayRoutes,
): Array<() => void> {
  const bind = (path: string, method: string, wantsBody: boolean) =>
    webServer.register({
      kind: 'exact',
      path,
      handler: async (request: any, response: any) => {
        if (request.method !== method) {
          sendJson(response, 405, { error: 'method_not_allowed', expected: method });
          return;
        }
        let body: unknown;
        if (wantsBody && method === 'POST') {
          try {
            body = await readJsonBody(request);
          } catch (e) {
            sendJson(response, 400, { error: `invalid_json_body: ${(e as Error).message}` });
            return;
          }
        }
        const result = await dispatchBirthdayRequest(
          { method, url: request.url ?? path, body },
          routes,
        );
        sendJson(response, result.status, result.body);
      },
    });

  return [
    bind('/api/birthday/list', 'GET', false),
    bind('/api/birthday/calendars', 'GET', false),
    bind('/api/birthday/year-info', 'GET', false),
    bind('/api/birthday/db-info', 'GET', false),
    bind('/api/birthday/export', 'GET', false),
    bind('/api/birthday/upcoming', 'GET', false),
    bind('/api/birthday/add', 'POST', true),
    bind('/api/birthday/update', 'POST', true),
    bind('/api/birthday/delete', 'POST', true),
    bind('/api/birthday/import', 'POST', true),
  ];
}

/**
 * Backwards-compatible alias: the earlier router shape returned one
 * `(ctx) => Promise<unknown>` function. Kept so existing integrations
 * keep working while the web-server binding is the preferred path.
 * @param hub - calendar hub.
 * @param service - birthday service.
 * @param upcoming - upcoming service.
 * @returns A single request-dispatch function returning just the body.
 */
export function createBirthdayRouter(
  hub: GregorianHub,
  service: BirthdayService,
  upcoming: UpcomingService,
): (ctx: HttpContext) => Promise<unknown> {
  const routes = { hub, service, upcoming };
  return async (ctx) => (await dispatchBirthdayRequest(ctx, routes)).body;
}
