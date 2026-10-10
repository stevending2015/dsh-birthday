/**
 * Birthday database layer.
 *
 * The engine is chosen by what the file ACTUALLY is, not by which modules happen
 * to load. Picking by module availability means a JSON file can be handed to
 * SQLite the day the native driver becomes available — which reads as data loss.
 *
 * The JSON fallback writes atomically and never discards a file it cannot parse.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * CJS resolver for the optional native driver. The package is ESM, so
 * `require` is not a global; `createRequire` keeps the lookup optional.
 */
const nodeRequire = createRequire(import.meta.url);

export interface BirthdayRow {
  id?: number;
  name: string;
  gender?: string | null;
  /** Chinese zodiac animal, derived from the lunar year. */
  shengxiao?: string | null;
  calendar_system: string;
  input_date_json: string;
  birth_timezone: string;
  gregorian_local_date: string;
  birthday_start_utc: string;
  shichen?: string | null;
  zodiac_sign?: string | null;
  wuxing_summary?: string | null;
  annual_degradation?: string | null;
  relation?: string | null;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BirthdayStore {
  init(): void;
  insert(row: BirthdayRow): number;
  update(id: number, patch: Partial<BirthdayRow>): void;
  remove(id: number): void;
  get(id: number): BirthdayRow | undefined;
  list(): BirthdayRow[];
  close(): void;
  /** Whether the underlying engine is SQLite (vs JSON fallback). */
  readonly engine: 'sqlite' | 'json';
  /** Absolute path of the file backing this store. */
  readonly path: string;
}

/** The 16-byte header every plain SQLite database starts with. */
export const SQLITE_MAGIC = 'SQLite format 3\0';

/** What a file looks like on disk, judged by its bytes. */
export type StoreFileKind = 'missing' | 'sqlite' | 'json' | 'other';

/** Cached result of the native-driver probe; the check opens a real database. */
let sqliteUsable: boolean | undefined;

/**
 * Whether the native SQLite driver actually WORKS on this host.
 *
 * Resolving the package proves nothing: `require('better-sqlite3')` loads only a
 * JS wrapper that defers to the native binding, so it succeeds even when that
 * binding was never built — which is exactly what pnpm's ignored build scripts
 * leave behind. Only opening a database proves the driver is usable.
 * @returns True when a real SQLite connection can be established.
 */
export function canUseSqlite(): boolean {
  if (sqliteUsable !== undefined) return sqliteUsable;
  try {
    const Database = nodeRequire('better-sqlite3');
    const probe = new Database(':memory:');
    probe.exec('CREATE TABLE probe (x INTEGER)');
    probe.close();
    sqliteUsable = true;
  } catch {
    sqliteUsable = false;
  }
  return sqliteUsable;
}

/**
 * Classify a store file by its leading bytes.
 * @param path - file to inspect.
 * @returns The detected kind.
 */
export function detectStoreFileKind(path: string): StoreFileKind {
  if (!existsSync(path)) return 'missing';
  let head: Buffer;
  try {
    const fd = openSync(path, 'r');
    try {
      head = Buffer.alloc(16);
      const read = readSync(fd, head, 0, 16, 0);
      head = head.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  } catch {
    return 'other';
  }
  if (head.length === 0) return 'json'; // Empty file: treat as an empty JSON store.
  if (head.subarray(0, SQLITE_MAGIC.length).toString('latin1') === SQLITE_MAGIC) return 'sqlite';
  const text = head.toString('utf8');
  return text.startsWith('{') || text.startsWith('[') ? 'json' : 'other';
}

/**
 * Replace a file's contents atomically.
 *
 * `writeFileSync` truncates first, so a crash mid-write leaves an empty or
 * half-written file — and for a store, that is silent total data loss. Writing a
 * sibling temp file, flushing it, then renaming means a reader only ever sees
 * the complete old file or the complete new one.
 * @param path - destination.
 * @param text - full new contents.
 */
export function atomicWriteFileSync(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, text, 'utf-8');
    // Force the bytes to disk BEFORE the rename, so a power cut cannot leave the
    // new name pointing at a file whose contents never landed.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS birthdays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gender TEXT,
    shengxiao TEXT,
    calendar_system TEXT NOT NULL DEFAULT 'gregorian',
    input_date_json TEXT NOT NULL,
    birth_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    gregorian_local_date TEXT NOT NULL,
    birthday_start_utc DATETIME NOT NULL,
    shichen TEXT,
    zodiac_sign TEXT,
    wuxing_summary TEXT,
    annual_degradation TEXT,
    relation TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gregorian_local ON birthdays(gregorian_local_date);
CREATE INDEX IF NOT EXISTS idx_birthday_start ON birthdays(birthday_start_utc);
CREATE INDEX IF NOT EXISTS idx_name ON birthdays(name);
CREATE INDEX IF NOT EXISTS idx_calendar_system ON birthdays(calendar_system);
`;

/** Columns added after the first release, with the DDL that introduces them. */
const ADDED_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'gender', ddl: 'gender TEXT' },
  { name: 'shengxiao', ddl: 'shengxiao TEXT' },
];

class SqliteStore implements BirthdayStore {
  readonly engine = 'sqlite' as const;
  // Resolved lazily so a host without the native module still works.
  private Database: any;
  private db: any;

  constructor(private readonly dbPath: string) {
    this.Database = nodeRequire('better-sqlite3');
  }

  get path(): string {
    return this.dbPath;
  }

  init(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new this.Database(this.dbPath);
    try {
      this.db.exec(SCHEMA);
      this.migrate();
    } catch (e) {
      // Opening succeeded but the schema did not — e.g. the file has the SQLite
      // header yet is corrupt. Close the handle before rethrowing: on Windows an
      // open handle locks the file, which would stop the operator from replacing
      // it, and the caller is about to fall back to another store.
      this.close();
      throw e;
    }
  }

  /** Add columns that a pre-existing database from an earlier version lacks. */
  private migrate(): void {
    const existing = new Set(
      (this.db.prepare('PRAGMA table_info(birthdays)').all() as Array<{ name: string }>)
        .map((c) => c.name),
    );
    for (const column of ADDED_COLUMNS) {
      if (!existing.has(column.name)) {
        this.db.exec(`ALTER TABLE birthdays ADD COLUMN ${column.ddl}`);
      }
    }
  }

  insert(row: BirthdayRow): number {
    const stmt = this.db.prepare(`
      INSERT INTO birthdays (
        name, gender, shengxiao, calendar_system, input_date_json, birth_timezone,
        gregorian_local_date, birthday_start_utc,
        shichen, zodiac_sign, wuxing_summary, annual_degradation,
        relation, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      row.name,
      row.gender ?? null,
      row.shengxiao ?? null,
      row.calendar_system,
      row.input_date_json,
      row.birth_timezone,
      row.gregorian_local_date,
      row.birthday_start_utc,
      row.shichen ?? null,
      row.zodiac_sign ?? null,
      row.wuxing_summary ?? null,
      row.annual_degradation ?? null,
      row.relation ?? null,
      row.note ?? null,
    );
    return Number(info.lastInsertRowid);
  }

  update(id: number, patch: Partial<BirthdayRow>): void {
    const keys = Object.keys(patch).filter((k) => k !== 'id');
    if (keys.length === 0) return;
    const assignments = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (patch as any)[k] ?? null);
    const stmt = this.db.prepare(
      `UPDATE birthdays SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );
    stmt.run(...values, id);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM birthdays WHERE id = ?').run(id);
  }

  get(id: number): BirthdayRow | undefined {
    return this.db.prepare('SELECT * FROM birthdays WHERE id = ?').get(id);
  }

  list(): BirthdayRow[] {
    return this.db.prepare('SELECT * FROM birthdays ORDER BY name').all();
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // Already closed, or closed by the failed-init path: nothing to do.
    }
    this.db = undefined;
  }
}

class JsonStore implements BirthdayStore {
  readonly engine = 'json' as const;
  private rows: BirthdayRow[] = [];
  private nextId = 1;

  /**
   * @param dbPath - backing file.
   * @param onWarn - called with a human-readable problem report. Recovery must
   *                 never be silent, so activation surfaces these in the log.
   */
  constructor(
    private readonly dbPath: string,
    private readonly onWarn?: (message: string) => void,
  ) {}

  get path(): string {
    return this.dbPath;
  }

  init(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    if (!existsSync(this.dbPath)) return;

    const raw = readFileSync(this.dbPath, 'utf-8');
    if (raw.trim() === '') {
      // A zero-length store is the signature of a write that was cut short by a
      // crash or power loss. Say so; do not quietly start from nothing.
      this.quarantine(raw, '文件为空（可能是写入被中断/掉电截断）');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { rows?: unknown; nextId?: unknown };
      if (!Array.isArray(parsed.rows)) throw new Error('缺少 rows 数组');
      this.rows = parsed.rows as BirthdayRow[];
      this.nextId =
        typeof parsed.nextId === 'number' && parsed.nextId > 0
          ? parsed.nextId
          : this.rows.reduce((max, r) => Math.max(max, Number(r.id ?? 0) + 1), 1);
    } catch (e) {
      this.quarantine(raw, `无法解析：${(e as Error).message}`);
    }
  }

  /**
   * Preserve an unusable store file and start fresh.
   *
   * The original bytes are MOVED aside, not deleted and not overwritten, so the
   * data can still be recovered by hand. Refusing to discard it is the whole
   * point: an earlier version reset the file to empty with no warning, which
   * turned one bad write into permanent loss.
   */
  private quarantine(raw: string, reason: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${this.dbPath}.corrupt-${stamp}`;
    let kept = false;
    try {
      renameSync(this.dbPath, target);
      kept = true;
    } catch {
      // Moving failed (locked or read-only): leave the file alone and try to
      // keep a copy instead, so nothing is lost either way.
      try {
        writeFileSync(target, raw, 'utf-8');
        kept = true;
      } catch {
        kept = false;
      }
    }
    this.rows = [];
    this.nextId = 1;
    this.onWarn?.(
      kept
        ? `[dsh-birthday] 数据库文件不可用（${reason}），原文件已保留为 ${target}，已从空库启动。`
        : `[dsh-birthday] 数据库文件不可用（${reason}），且无法备份，已从空库启动。`,
    );
  }

  private flush(): void {
    atomicWriteFileSync(
      this.dbPath,
      JSON.stringify({ rows: this.rows, nextId: this.nextId }, null, 2),
    );
  }

  insert(row: BirthdayRow): number {
    const id = this.nextId++;
    this.rows.push({ ...row, id, created_at: new Date().toISOString() });
    this.flush();
    return id;
  }

  update(id: number, patch: Partial<BirthdayRow>): void {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    this.rows[idx] = { ...this.rows[idx], ...patch, updated_at: new Date().toISOString() };
    this.flush();
  }

  remove(id: number): void {
    this.rows = this.rows.filter((r) => r.id !== id);
    this.flush();
  }

  get(id: number): BirthdayRow | undefined {
    return this.rows.find((r) => r.id === id);
  }

  list(): BirthdayRow[] {
    return [...this.rows];
  }

  close(): void {
    /* noop */
  }
}

/**
 * Create the store for a path, choosing the engine from the file's own bytes.
 *
 * Selection rules, and why each matters:
 *   - the file is JSON  → the JSON engine, ALWAYS. Handing JSON to SQLite
 *     (because the native driver finally loaded) fails or, worse, starts an
 *     empty database over the user's records.
 *   - the file is SQLite and the driver loads → the SQLite engine.
 *   - the file is SQLite but the driver is missing → do NOT touch it. Fall back
 *     to a sibling `<path>.json` so the unreadable-but-intact file survives
 *     until the driver is available again.
 *   - the file is unrecognized (e.g. an encrypted container) → same as above:
 *     leave it alone and use the sibling.
 *   - the file is absent → SQLite when possible, JSON otherwise.
 *
 * @param dbPath - the store path.
 * @param onWarn - receives a message whenever a fallback happens, so a degraded
 *                 engine is visible in the log instead of being discovered later.
 * @returns The store, already initialised.
 */
export function createBirthdayStore(
  dbPath: string,
  onWarn?: (message: string) => void,
): BirthdayStore {
  const kind = detectStoreFileKind(dbPath);

  /**
   * Try the native engine, reporting why it failed instead of throwing.
   *
   * The driver is probed HERE rather than up front, so a JSON store never loads
   * it: probing costs startup time, and it constructs a native `Database` object
   * whose destructor runs `RemoveEnvironmentCleanupHook`. If such an object is
   * still uncollected when the isolate is disposed, that destructor aborts the
   * process with `Assertion failed: (env) != nullptr`. Not creating one at all
   * is the only reliable way to keep that away from a JSON-only host.
   */
  const trySqlite = (path: string): BirthdayStore | undefined => {
    if (!canUseSqlite()) return undefined;
    try {
      const store = new SqliteStore(path);
      store.init();
      return store;
    } catch (e) {
      onWarn?.(`[dsh-birthday] SQLite 打开失败（${(e as Error).message}）。`);
      return undefined;
    }
  };

  /** Last resort: a sibling JSON file, leaving `path` untouched. */
  const siblingJson = (path: string, reason: string): BirthdayStore => {
    const sibling = `${path}.json`;
    onWarn?.(
      `[dsh-birthday] ${path} ${reason}；为避免破坏原文件，改用 ${sibling}。`,
    );
    const store = new JsonStore(sibling, onWarn);
    store.init();
    return store;
  };

  if (kind === 'json') {
    // JSON must never be handed to SQLite: that would start an empty database
    // over the user's records the day the native driver becomes loadable.
    const store = new JsonStore(dbPath, onWarn);
    store.init();
    return store;
  }

  if (kind === 'sqlite') {
    const store = trySqlite(dbPath);
    if (store !== undefined) return store;
    // Present but unreadable — a truncated or foreign SQLite container, or no
    // driver. Do not write into it; a corrupt file must not take the plugin down.
    return siblingJson(
      dbPath,
      canUseSqlite()
        ? '声明为 SQLite 但无法打开（可能已损坏）'
        : '是 SQLite 数据库，但 better-sqlite3 不可用',
    );
  }

  if (kind === 'other') {
    return siblingJson(dbPath, '既不是明文 SQLite 也不是 JSON（可能已加密）');
  }

  // Absent: prefer SQLite so new installs get the stronger engine.
  const fresh = trySqlite(dbPath);
  if (fresh !== undefined) return fresh;
  const store = new JsonStore(dbPath, onWarn);
  store.init();
  return store;
}
