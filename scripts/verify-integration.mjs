/**
 * Integration verification for the DSH plugin surface.
 *
 * Proves, without booting the host app:
 *   1. `lib/index.js` exports the cordis plugin shape DSH needs
 *      (name, Config, apply) and activates against a tool registry.
 *   2. Every declared tool registers through `ctx.tools.register()`, which is
 *      the API that rejected the earlier `ctx.plugin(defineTool(...))` shape.
 *   3. The HTTP routes mount on a `webServer.register({kind, path, handler})`
 *      service and answer real requests over a real socket.
 *
 * Run: node scripts/verify-integration.mjs
 */

import http from 'node:http';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const failures = [];
const notes = [];

function check(label, condition, detail = '') {
  if (condition) {
    notes.push(`  PASS  ${label}`);
  } else {
    failures.push(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- 1. Plugin activation against a mock context ---------------------------

const plugin = await import(new URL('../lib/index.js', import.meta.url).href);

check('exports plugin name', plugin.name === 'dsh-birthday', `got ${JSON.stringify(plugin.name)}`);
check('exports Config schema', plugin.Config !== undefined);
check('exports apply()', typeof plugin.apply === 'function');
check(
  'declares tools injection',
  Array.isArray(plugin.inject) && plugin.inject.includes('tools'),
  `got ${JSON.stringify(plugin.inject)}`,
);

const workDir = resolve(root, '.verify');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const registeredTools = [];
const provided = {};
const injected = [];
const loggerErrors = [];

const ctx = {
  tools: {
    register(definition) {
      registeredTools.push(definition);
      return () => {};
    },
  },
  provide(key, value) {
    provided[key] = value;
    return () => {};
  },
  get() {
    return undefined;
  },
  inject(keys, cb) {
    injected.push({ keys, cb });
  },
  on() {},
  effect() {},
  loader: { has: () => false },
  logger: {
    info() {},
    warn() {},
    error(message) {
      loggerErrors.push(String(message));
    },
  },
};

plugin.apply(ctx, {
  timezoneEngine: 'system',
  enabledCalendars: ['gregorian', 'lunar', 'islamic', 'hebrew'],
  allowThirdPartyAdapters: true,
  dbPath: resolve(workDir, 'birthdays.db'),
  defaultTimezone: 'Asia/Shanghai',
  reminderDaysBefore: [3, 1],
  leapMonthStrategy: 'normal',
});

const toolNames = registeredTools.map((t) => t.name).sort();
check(
  'registers the documented tools',
  toolNames.length === 8,
  `got ${JSON.stringify(toolNames)}`,
);
check(
  'tool names are the documented set',
  JSON.stringify(toolNames) ===
    JSON.stringify(
      [
        'birthday_add',
        'birthday_db_info',
        'birthday_delete',
        'birthday_export',
        'birthday_import',
        'birthday_query',
        'birthday_upcoming',
        'birthday_update',
      ].sort(),
    ),
  `got ${JSON.stringify(toolNames)}`,
);
check(
  'every tool declares output.schema and output.render',
  registeredTools.every((t) => t.output && t.output.schema && typeof t.output.render === 'function'),
);
check(
  'every tool declares a name and description',
  registeredTools.every((t) => typeof t.name === 'string' && t.name !== '' && typeof t.description === 'string'),
);
check('provides the calendar service', typeof provided.calendar?.hub === 'object');
check('provides the birthday service', typeof provided.birthday?.service === 'object');
check('no logger errors during activation', loggerErrors.length === 0, loggerErrors.join(' | '));

// --- 2. HTTP surface over a real socket ------------------------------------

const { mountBirthdayRoutes } = await import(
  new URL('../lib/birthday/routes/api.js', import.meta.url).href
);

const routeTable = new Map();
const webServer = {
  register({ kind, path, handler }) {
    routeTable.set(`${kind}:${path}`, handler);
    return () => routeTable.delete(`${kind}:${path}`);
  },
};

mountBirthdayRoutes(webServer, {
  hub: provided.calendar.hub,
  service: provided.birthday.service,
  upcoming: provided.birthday.upcoming,
  // The store lives inside the plugin; surface its location the same way the
  // plugin does, so the storage self-check has a real path to inspect.
  storage: () => ({ path: provided.birthday.store.path, engine: provided.birthday.store.engine }),
});

check(
  'mounts every documented exact route',
  [...routeTable.keys()].filter((k) => k.startsWith('exact:')).length === 10,
  `got ${JSON.stringify([...routeTable.keys()])}`,
);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routeTable.get(`exact:${url.pathname}`);
  if (handler === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_route' }));
    return;
  }
  await handler(req, res);
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

const calendars = await call('GET', '/api/birthday/calendars');
check('GET /calendars returns 200', calendars.status === 200, `status ${calendars.status}`);
const calendarIds = (calendars.json.items ?? []).map((c) => c.id).sort();
check(
  'GET /calendars lists 4 built-in calendars',
  JSON.stringify(calendarIds) === JSON.stringify(['gregorian', 'hebrew', 'islamic', 'lunar']),
  `got ${JSON.stringify(calendarIds)}`,
);
check(
  'GET /calendars exposes field descriptors',
  (calendars.json.items ?? []).every((c) => Array.isArray(c.fields) && c.fields.length > 0),
);

const added = await call('POST', '/api/birthday/add', {
  name: '验证-农历',
  gender: 'male',
  calendarSystem: 'lunar',
  fields: { year: 1990, month: 8, day: 15, isLeapMonth: false },
  birthTimezone: 'Asia/Shanghai',
  relation: '朋友',
  note: 'integration verification',
});
check('POST /add returns 200', added.status === 200, `status ${added.status} body ${JSON.stringify(added.json)}`);
check(
  'POST /add resolves a Gregorian anchor',
  typeof added.json.record?.gregorianLocalDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(added.json.record.gregorianLocalDate),
  `got ${JSON.stringify(added.json.record?.gregorianLocalDate)}`,
);
check('POST /add computes a zodiac sign', typeof added.json.record?.zodiacSign === 'string' && added.json.record.zodiacSign !== '');
check(
  'POST /add persists the relation',
  added.json.record?.relation === '朋友',
  `got ${JSON.stringify(added.json.record?.relation)}`,
);
check(
  'POST /add persists the gender',
  added.json.record?.gender === 'male',
  `got ${JSON.stringify(added.json.record?.gender)}`,
);
// 1990 lunar 八月十五 = 1990-10-03 = 天秤座 (10-23 boundary respected).
check(
  'zodiac derives from the actual day, not just the month',
  added.json.record?.zodiacSign === '天秤座',
  `got ${JSON.stringify(added.json.record?.zodiacSign)}`,
);

const listed = await call('GET', '/api/birthday/list');
check('GET /list returns 200', listed.status === 200);
check('GET /list contains the new record', (listed.json.items ?? []).length === 1, `got ${(listed.json.items ?? []).length}`);
check(
  'GET /list returns the stored gender',
  listed.json.items?.[0]?.gender === 'male',
  JSON.stringify(listed.json.items?.[0]),
);

const upcomingSame = await call('GET', '/api/birthday/upcoming?tz=Asia/Shanghai&hour=9');
check(
  'GET /upcoming same-timezone marks sameOffset=true',
  upcomingSame.json.items?.[0]?.sameOffset === true,
  JSON.stringify(upcomingSame.json.items?.[0]),
);
check(
  'GET /upcoming carries the relation for the card',
  upcomingSame.json.items?.[0]?.relation === '朋友',
  `got ${JSON.stringify(upcomingSame.json.items?.[0]?.relation)}`,
);
check(
  'GET /upcoming carries the gender for the card',
  upcomingSame.json.items?.[0]?.gender === 'male',
  `got ${JSON.stringify(upcomingSame.json.items?.[0]?.gender)}`,
);
check(
  'GET /upcoming exposes the zodiac for the card',
  upcomingSame.json.items?.[0]?.zodiacSign === '天秤座',
  JSON.stringify(upcomingSame.json.items?.[0]?.zodiacSign),
);
// 生肖 comes from the lunar year, so even a Gregorian record must have one.
// lunar 1990 八月十五 → 庚午 → 马.
check(
  'GET /upcoming carries a 生肖 derived from the lunar year',
  upcomingSame.json.items?.[0]?.shengxiao === '马',
  `got ${JSON.stringify(upcomingSame.json.items?.[0]?.shengxiao)}`,
);
check(
  'GET /list carries the same 生肖',
  listed.json.items?.[0]?.shengxiao === '马',
  `got ${JSON.stringify(listed.json.items?.[0]?.shengxiao)}`,
);
// The client addresses records by `id` on every edit/delete round-trip. When
// /upcoming returned `recordId` instead, edit silently became add and delete
// silently no-oped. Pin the field name AND the round-trip.
const upcomingId = upcomingSame.json.items?.[0]?.id;
check(
  'GET /upcoming carries a numeric id (the field the client addresses)',
  typeof upcomingId === 'number' && Number.isFinite(upcomingId) && upcomingId > 0,
  `got ${JSON.stringify(upcomingId)}; recordId=${JSON.stringify(upcomingSame.json.items?.[0]?.recordId)}`,
);
check(
  'the /upcoming id equals the id from /list',
  upcomingId === listed.json.items?.[0]?.id,
  `upcoming=${JSON.stringify(upcomingId)} list=${JSON.stringify(listed.json.items?.[0]?.id)}`,
);

// Editing THROUGH THE ID THE CLIENT SEES must update in place, not append.
const beforeCount = (await call('GET', '/api/birthday/list')).json.items?.length ?? 0;
const editViaUpcomingId = await call('POST', '/api/birthday/update', {
  id: upcomingId,
  name: '验证-改名',
  relation: '同事',
});
const afterEdit = await call('GET', '/api/birthday/list');
check(
  'POST /update addressed by the /upcoming id updates in place',
  editViaUpcomingId.json.ok === true &&
    (afterEdit.json.items?.length ?? 0) === beforeCount &&
    afterEdit.json.items?.[0]?.name === '验证-改名',
  `ok=${JSON.stringify(editViaUpcomingId.json.ok)} before=${beforeCount} after=${afterEdit.json.items?.length} name=${JSON.stringify(afterEdit.json.items?.[0]?.name)}`,
);

// Deleting through that same id must actually remove the row.
const deleteViaUpcomingId = await call('POST', '/api/birthday/delete', { id: upcomingId });
const afterDelete = await call('GET', '/api/birthday/list');
check(
  'POST /delete addressed by the /upcoming id removes the row',
  deleteViaUpcomingId.json.ok === true && (afterDelete.json.items?.length ?? 0) === beforeCount - 1,
  `ok=${JSON.stringify(deleteViaUpcomingId.json.ok)} remaining=${afterDelete.json.items?.length}`,
);

// Re-add so the later tool assertions have a record to work with.
await call('POST', '/api/birthday/add', {
  name: '验证-复位',
  calendarSystem: 'lunar',
  fields: { year: 1990, month: 8, day: 15, isLeapMonth: false },
  birthTimezone: 'Asia/Shanghai',
});

const upcomingCross = await call('GET', '/api/birthday/upcoming?tz=America/Phoenix&hour=9');
const cross = upcomingCross.json.items?.[0];
check(
  'GET /upcoming cross-timezone marks sameOffset=false and gives an action instant',
  cross?.sameOffset === false && typeof cross?.userActionUtc === 'string',
  JSON.stringify(cross),
);

// Update gender + relation end-to-end, addressed by the id /list reports.
const currentList = await call('GET', '/api/birthday/list');
const currentId = currentList.json.items?.[0]?.id;
const updated = await call('POST', '/api/birthday/update', {
  id: currentId,
  gender: 'female',
  relation: '妈妈',
});
check('POST /update accepts gender + relation', updated.json.ok === true, JSON.stringify(updated.json));
const reread = await call('GET', '/api/birthday/list');
check(
  'POST /update flips gender + relation in place',
  // date unchanged here, so the sign stays 天秤座; gender + relation flip.
  reread.json.items?.[0]?.relation === '妈妈' && reread.json.items?.[0]?.gender === 'female',
  JSON.stringify(reread.json.items?.[0]),
);

const deleted = await call('POST', '/api/birthday/delete', { id: currentId });
check('POST /delete returns ok', deleted.json.ok === true, JSON.stringify(deleted.json));

// --- note editing: the field the user says silently does nothing ------------

const noted = await call('POST', '/api/birthday/add', {
  name: '验证-备注',
  calendarSystem: 'gregorian',
  fields: { year: 1990, month: 1, day: 1 },
  birthTimezone: 'Asia/Shanghai',
  note: '原始备注',
});
const noteId = noted.json.record?.id;
check('POST /add stores an initial note', noted.json.record?.note === '原始备注', JSON.stringify(noted.json.record));

const changedNote = await call('POST', '/api/birthday/update', { id: noteId, note: '改过的备注' });
check('POST /update acknowledges the note change', changedNote.json.ok === true, JSON.stringify(changedNote.json));
const afterNoteChange = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.id === noteId);
check(
  'changing an existing note persists',
  afterNoteChange?.note === '改过的备注',
  `got ${JSON.stringify(afterNoteChange?.note)}`,
);

// Clearing must work too: an empty string means "remove the note", which is
// distinct from "field not supplied" (which keeps the old value).
const clearedNote = await call('POST', '/api/birthday/update', { id: noteId, note: '' });
check('POST /update acknowledges clearing the note', clearedNote.json.ok === true, JSON.stringify(clearedNote.json));
const afterNoteClear = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.id === noteId);
check(
  'clearing a note removes it',
  afterNoteClear?.note === undefined || afterNoteClear?.note === null || afterNoteClear?.note === '',
  `got ${JSON.stringify(afterNoteClear?.note)}`,
);

// Omitting the field entirely must still preserve the stored note.
await call('POST', '/api/birthday/update', { id: noteId, note: '保留我' });
const omitNote = await call('POST', '/api/birthday/update', { id: noteId, relation: '同事' });
check('POST /update acknowledges the omitted-note patch', omitNote.json.ok === true, JSON.stringify(omitNote.json));
const afterOmit = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.id === noteId);
check(
  'omitting the note keeps the stored value',
  afterOmit?.note === '保留我',
  `got ${JSON.stringify(afterOmit?.note)}`,
);

// Same contract for relation: "" clears, omission preserves.
const clearedRelation = await call('POST', '/api/birthday/update', { id: noteId, relation: '' });
check('POST /update acknowledges clearing the relation', clearedRelation.json.ok === true, JSON.stringify(clearedRelation.json));
const afterRelationClear = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.id === noteId);
check(
  'clearing a relation removes it',
  afterRelationClear?.relation === undefined ||
    afterRelationClear?.relation === null ||
    afterRelationClear?.relation === '',
  `got ${JSON.stringify(afterRelationClear?.relation)}`,
);

await call('POST', '/api/birthday/delete', { id: noteId });

// --- every editable field must persist, not just the note -------------------

const full = await call('POST', '/api/birthday/add', {
  name: '字段-前',
  gender: 'male',
  relation: '朋友',
  note: '前备注',
  calendarSystem: 'gregorian',
  fields: { year: 1990, month: 1, day: 2 },
  birthTimezone: 'Asia/Shanghai',
});
const fullId = full.json.record?.id;
check('field sweep: record created', typeof fullId === 'number', JSON.stringify(full.json));

const swept = await call('POST', '/api/birthday/update', {
  id: fullId,
  name: '字段-后',
  gender: 'female',
  relation: '妈妈',
  note: '后备注',
  calendarSystem: 'gregorian',
  fields: { year: 1991, month: 5, day: 6 },
  birthTimezone: 'America/New_York',
});
check('field sweep: update acknowledged', swept.json.ok === true, JSON.stringify(swept.json));

const sweptRecord = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.id === fullId);
const sweptFields = sweptRecord?.fields ?? {};
const fieldResults = [
  ['name', sweptRecord?.name === '字段-后', sweptRecord?.name],
  ['gender', sweptRecord?.gender === 'female', sweptRecord?.gender],
  ['relation', sweptRecord?.relation === '妈妈', sweptRecord?.relation],
  ['note', sweptRecord?.note === '后备注', sweptRecord?.note],
  ['calendarSystem', sweptRecord?.calendarSystem === 'gregorian', sweptRecord?.calendarSystem],
  ['birthTimezone', sweptRecord?.birthTimezone === 'America/New_York', sweptRecord?.birthTimezone],
  ['fields.year', Number(sweptFields.year) === 1991, sweptFields.year],
  ['fields.month', Number(sweptFields.month) === 5, sweptFields.month],
  ['fields.day', Number(sweptFields.day) === 6, sweptFields.day],
  ['gregorian anchor', sweptRecord?.gregorianLocalDate === '1991-05-06', sweptRecord?.gregorianLocalDate],
];
for (const [label, ok, got] of fieldResults) {
  check(`field sweep: ${label} persisted`, ok === true, `got ${JSON.stringify(got)}`);
}
check(
  'field sweep: the zodiac followed the new date',
  sweptRecord?.zodiacSign === '金牛座',
  `got ${JSON.stringify(sweptRecord?.zodiacSign)}`,
);

await call('POST', '/api/birthday/delete', { id: fullId });

// --- leap-month guidance + 时辰 ---------------------------------------------

const leap2020 = await call('GET', '/api/birthday/year-info?calendar=lunar&year=2020');
check('GET /year-info reports 2020 as a leap-4th-month year', leap2020.json.leapMonth === 4, JSON.stringify(leap2020.json));
check('GET /year-info explains it for the user', String(leap2020.json.note ?? '').includes('闰四'), JSON.stringify(leap2020.json.note));
const leap2021 = await call('GET', '/api/birthday/year-info?calendar=lunar&year=2021');
check('GET /year-info reports null for a year with no leap month', leap2021.json.leapMonth === null, JSON.stringify(leap2021.json));
const leapGregorian = await call('GET', '/api/birthday/year-info?calendar=gregorian&year=2020');
check('GET /year-info is empty for a calendar without the concept', leapGregorian.json.leapMonth === undefined, JSON.stringify(leapGregorian.json));
const badYearInfo = await call('GET', '/api/birthday/year-info');
check('GET /year-info without params is a 400', badYearInfo.status === 400, `status ${badYearInfo.status}`);

// 时辰 is declared as a closed select with 辰 as the default.
const allCalendars = (await call('GET', '/api/birthday/calendars')).json.items ?? [];
const lunarDescriptor = allCalendars.find((c) => c.id === 'lunar');
const shichenField = lunarDescriptor?.fields?.find((f) => f.key === 'shichen');
check('lunar calendar declares a 时辰 field', shichenField !== undefined, JSON.stringify(lunarDescriptor?.fields));
check('时辰 offers the twelve branches', shichenField?.options?.length === 12, JSON.stringify(shichenField?.options));
check('时辰 defaults to 辰', shichenField?.defaultValue === '辰', JSON.stringify(shichenField?.defaultValue));

const shichenRec = await call('POST', '/api/birthday/add', {
  name: '验证-时辰',
  calendarSystem: 'lunar',
  fields: { year: 2020, month: 4, day: 15, isLeapMonth: true, shichen: '午' },
  birthTimezone: 'Asia/Shanghai',
});
check('POST /add accepts a leap-month date with 时辰', shichenRec.status === 200 && !shichenRec.json.error, JSON.stringify(shichenRec.json));
const shichenRecord = (await call('GET', '/api/birthday/list')).json.items?.find((r) => r.name === '验证-时辰');
check('时辰 is stored on the record', shichenRecord?.shichen === '午', `got ${JSON.stringify(shichenRecord?.shichen)}`);
check('时辰 stays inside the calendar fields', shichenRecord?.fields?.shichen === '午', JSON.stringify(shichenRecord?.fields));
const shichenUpcoming = (await call('GET', '/api/birthday/upcoming?tz=Asia/Shanghai')).json.items?.find((r) => r.name === '验证-时辰');
check('时辰 reaches the card via /upcoming', shichenUpcoming?.shichen === '午', JSON.stringify(shichenUpcoming));
check('a leap-month record still resolves to a Gregorian anchor', shichenRecord?.gregorianLocalDate === '2020-06-06', JSON.stringify(shichenRecord?.gregorianLocalDate));
check('the record carries a 生肖 for the card', shichenRecord?.shengxiao === '鼠', JSON.stringify(shichenRecord?.shengxiao));

const badShichen = await call('POST', '/api/birthday/add', {
  name: '验证-坏时辰',
  calendarSystem: 'lunar',
  fields: { year: 2020, month: 4, day: 15, shichen: '不存在' },
  birthTimezone: 'Asia/Shanghai',
});
check('an invalid 时辰 is rejected', typeof badShichen.json.error === 'string', JSON.stringify(badShichen.json));

await call('POST', '/api/birthday/delete', { id: shichenRecord?.id });

// --- storage self-check + export/import -------------------------------------

await call('POST', '/api/birthday/add', {
  name: '导出-甲',
  gender: 'male',
  relation: '爸爸',
  note: '含,逗号与"引号"',
  calendarSystem: 'lunar',
  fields: { year: 1990, month: 8, day: 15, isLeapMonth: false, shichen: '辰' },
  birthTimezone: 'Asia/Shanghai',
});
await call('POST', '/api/birthday/add', {
  name: '导出-乙',
  calendarSystem: 'gregorian',
  fields: { year: 1988, month: 3, day: 12 },
  birthTimezone: 'America/Phoenix',
});

const dbInfo = await call('GET', '/api/birthday/db-info');
check('GET /db-info reports the live engine and path', typeof dbInfo.json.path === 'string' && dbInfo.json.engine !== undefined, JSON.stringify(dbInfo.json));
check(
  'GET /db-info states whether the database is encrypted',
  ['none', 'suspected', 'unknown'].includes(dbInfo.json.encryption),
  JSON.stringify(dbInfo.json.encryption),
);
check('GET /db-info is consistent with the bytes on disk', dbInfo.json.consistent === true, JSON.stringify(dbInfo.json));
check('GET /db-info reports a non-zero size for an existing store', dbInfo.json.sizeBytes > 0, String(dbInfo.json.sizeBytes));
check('GET /db-info summarises the verdict in words', typeof dbInfo.json.summary === 'string' && dbInfo.json.summary.length > 0);

const exported = await call('GET', '/api/birthday/export');
check('GET /export returns a JSON envelope', exported.json.format === 'json', JSON.stringify(exported.json.format));
check('GET /export is versioned and self-describing', exported.json.envelope?.format === 'dsh-birthday-export' && exported.json.envelope?.version >= 1, JSON.stringify(exported.json.envelope?.version));
check('GET /export counts the records', exported.json.envelope?.count === exported.json.envelope?.birthdays?.length, `${exported.json.envelope?.count} vs ${exported.json.envelope?.birthdays?.length}`);
const exportedA = exported.json.envelope?.birthdays?.find((b) => b.name === '导出-甲');
check('GET /export keeps the source-of-truth fields', exportedA?.calendarSystem === 'lunar' && exportedA?.fields?.shichen === '辰' && exportedA?.birthTimezone === 'Asia/Shanghai', JSON.stringify(exportedA));
check('GET /export marks derived values as reference', exportedA?.derived?.shengxiao === '马', JSON.stringify(exportedA?.derived));

// JSON is the single transfer format: a `format` query must not change it.
const csvAsk = await call('GET', '/api/birthday/export?format=csv');
check(
  'JSON is the only export format',
  csvAsk.json.format === 'json' && csvAsk.json.envelope?.format === 'dsh-birthday-export',
  JSON.stringify(csvAsk.json.format),
);

// Import the export back into an empty library: everything should land.
const beforeImport = (await call('GET', '/api/birthday/list')).json.items?.length ?? 0;
// A dry run against a library that already holds these records must report
// them as duplicates and write nothing.
const dryRunExisting = await call('POST', '/api/birthday/import', { text: exported.json.text, dryRun: true });
check(
  'POST /import dry run reports existing records as duplicates',
  dryRunExisting.json.dryRun === true &&
    dryRunExisting.json.imported === 0 &&
    dryRunExisting.json.skipped === dryRunExisting.json.total,
  JSON.stringify(dryRunExisting.json),
);
check('POST /import dry run wrote nothing', ((await call('GET', '/api/birthday/list')).json.items?.length ?? 0) === beforeImport, 'count changed');

// A dry run of genuinely new records reports them as importable, still unwritten.
const dryRunNew = await call('POST', '/api/birthday/import', {
  dryRun: true,
  data: [
    { name: '试运行-新', calendarSystem: 'gregorian', fields: { year: 2001, month: 2, day: 3 }, birthTimezone: 'UTC' },
  ],
});
check(
  'POST /import dry run counts new records as importable',
  dryRunNew.json.dryRun === true && dryRunNew.json.imported === 1 && dryRunNew.json.failed === 0,
  JSON.stringify(dryRunNew.json),
);
check(
  'POST /import dry run did not write the new record',
  ((await call('GET', '/api/birthday/list')).json.items ?? []).every((r) => r.name !== '试运行-新'),
  'the dry-run record was written',
);

const realImport = await call('POST', '/api/birthday/import', { text: exported.json.text, mode: 'append' });
check('POST /import append adds the records', realImport.json.imported === realImport.json.total && realImport.json.failed === 0, JSON.stringify(realImport.json));
const afterImport = (await call('GET', '/api/birthday/list')).json.items ?? [];
check('POST /import doubled the library in append mode', afterImport.length === beforeImport * 2, `${afterImport.length} from ${beforeImport}`);

const reimported = afterImport.filter((r) => r.name === '导出-甲');
check('POST /import round-trips every editable field', reimported.length === 2 && reimported.every((r) => r.relation === '爸爸' && r.note === '含,逗号与"引号"' && r.fields?.shichen === '辰'), JSON.stringify(reimported[0]));
check('POST /import recomputes derived values', reimported.every((r) => r.zodiacSign === '天秤座' && r.shengxiao === '马'), JSON.stringify(reimported.map((r) => [r.zodiacSign, r.shengxiao])));

// Only JSON is accepted: CSV text must be rejected with a readable reason.
const csvImport = await call('POST', '/api/birthday/import', {
  text: 'name,calendarSystem\r\n张三,lunar\r\n',
  mode: 'append',
});
check(
  'POST /import rejects non-JSON input',
  typeof csvImport.json.error === 'string',
  JSON.stringify(csvImport.json),
);

const badImport = await call('POST', '/api/birthday/import', {
  text: JSON.stringify([
    { name: '好', calendarSystem: 'gregorian', fields: { year: 1990, month: 1, day: 1 }, birthTimezone: 'UTC' },
    { name: '坏', calendarSystem: 'mayan', fields: { year: 1, month: 1, day: 1 }, birthTimezone: 'UTC' },
  ]),
});
check(
  'POST /import reports a bad record without aborting the batch',
  badImport.json.imported === 1 && badImport.json.failed === 1,
  JSON.stringify(badImport.json),
);

const garbageImport = await call('POST', '/api/birthday/import', { text: 'not json, not csv' });
check('POST /import rejects unreadable input with an error', typeof garbageImport.json.error === 'string', JSON.stringify(garbageImport.json));

// Clean up everything this block added.
for (const record of ((await call('GET', '/api/birthday/list')).json.items ?? [])) {
  await call('POST', '/api/birthday/delete', { id: record.id });
}

const notFound = await call('GET', '/api/birthday/nope');
check('unknown route returns 404', notFound.status === 404, `status ${notFound.status}`);

// --- 3. Tool execution through the registered definition --------------------

const upcomingTool = registeredTools.find((t) => t.name === 'birthday_upcoming');
await call('POST', '/api/birthday/add', {
  name: '验证-公历',
  calendarSystem: 'gregorian',
  fields: { year: 1995, month: 3, day: 12 },
  birthTimezone: 'Asia/Shanghai',
});
const toolValue = await upcomingTool.execute(
  { userTimezone: 'Asia/Shanghai' },
  { signal: new AbortController().signal },
);
check(
  'birthday_upcoming tool executes and returns the declared shape',
  typeof toolValue === 'object' &&
    typeof toolValue.count === 'number' &&
    Array.isArray(toolValue.items) &&
    toolValue.items.length === toolValue.count &&
    toolValue.items.every((i) => typeof i.id === 'number' && i.id > 0),
  JSON.stringify(toolValue),
);
const rendered = upcomingTool.output.render({}, toolValue);
check(
  'tool render() projects a text content block',
  Array.isArray(rendered) && rendered[0]?.type === 'text' && rendered[0].text.includes('nextLocalDate'),
);
check('no logger errors after tool execution', loggerErrors.length === 0, loggerErrors.join(' | '));

await new Promise((ok) => server.close(ok));

// --- Report -----------------------------------------------------------------

console.log('dsh-birthday integration verification');
console.log(`  root: ${root}`);
console.log('');
for (const note of notes) console.log(note);
if (failures.length > 0) {
  console.log('');
  for (const failure of failures) console.log(failure);
}
console.log('');
console.log(`${notes.length} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
