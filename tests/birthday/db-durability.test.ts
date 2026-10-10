/**
 * Durability guarantees of the store.
 *
 * These cover the failure modes that make a birthday disappear across a reboot:
 *
 *   - a write interrupted by a crash must not leave a half-written file
 *     (the old code truncated first, so a power cut could empty the store);
 *   - an unreadable file must be preserved, never silently reset;
 *   - a JSON store must never be handed to SQLite just because the native
 *     driver became available, which would start an empty database over it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWriteFileSync,
  canUseSqlite,
  createBirthdayStore,
  detectStoreFileKind,
  SQLITE_MAGIC,
  type BirthdayRow,
  type BirthdayStore,
} from '../../src/birthday/db.js';

let dir: string;
const opened: BirthdayStore[] = [];

function makeStore(path: string, onWarn?: (m: string) => void): BirthdayStore {
  const store = createBirthdayStore(path, onWarn);
  opened.push(store);
  return store;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-durability-'));
});
afterEach(() => {
  while (opened.length > 0) {
    try {
      opened.pop()?.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function row(over: Partial<BirthdayRow> = {}): BirthdayRow {
  return {
    name: '张三',
    calendar_system: 'gregorian',
    input_date_json: JSON.stringify({ year: 1990, month: 1, day: 1 }),
    birth_timezone: 'Asia/Shanghai',
    gregorian_local_date: '1990-01-01',
    birthday_start_utc: '1989-12-31T16:00:00.000Z',
    ...over,
  };
}

describe('atomicWriteFileSync', () => {
  it('writes the full contents and leaves no temp file behind', () => {
    const path = join(dir, 'a.txt');
    atomicWriteFileSync(path, 'hello');
    expect(readFileSync(path, 'utf-8')).toBe('hello');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces existing contents completely, never appending', () => {
    const path = join(dir, 'b.txt');
    atomicWriteFileSync(path, 'a much longer original value');
    atomicWriteFileSync(path, 'short');
    expect(readFileSync(path, 'utf-8')).toBe('short');
  });

  it('overwrites a stale temp file from a previous crash', () => {
    const path = join(dir, 'c.txt');
    writeFileSync(`${path}.tmp`, 'leftover from a crash', 'utf-8');
    atomicWriteFileSync(path, 'fresh');
    expect(readFileSync(path, 'utf-8')).toBe('fresh');
    expect(readdirSync(dir)).toEqual(['c.txt']);
  });
});

describe('detectStoreFileKind', () => {
  it('detects a missing file', () => {
    expect(detectStoreFileKind(join(dir, 'nope.db'))).toBe('missing');
  });

  it('detects JSON regardless of the extension', () => {
    const path = join(dir, 'looks-like.db');
    writeFileSync(path, '{"rows":[],"nextId":1}', 'utf-8');
    expect(detectStoreFileKind(path)).toBe('json');
  });

  it('detects a real SQLite file', () => {
    const path = join(dir, 'real.db');
    writeFileSync(path, Buffer.concat([Buffer.from(SQLITE_MAGIC, 'latin1'), Buffer.alloc(64)]));
    expect(detectStoreFileKind(path)).toBe('sqlite');
  });

  it('calls an unrecognized blob "other", not "json"', () => {
    const path = join(dir, 'blob.db');
    writeFileSync(path, Buffer.from([0x8f, 0x00, 0x11, 0x22, 0x33]));
    expect(detectStoreFileKind(path)).toBe('other');
  });

  it('treats an empty file as an empty JSON store', () => {
    const path = join(dir, 'empty.db');
    writeFileSync(path, '');
    expect(detectStoreFileKind(path)).toBe('json');
  });
});

describe('durability of the JSON engine', () => {
  it('keeps every record across a close and reopen', () => {
    const path = join(dir, 'persist.db');
    const first = makeStore(path);
    first.insert(row({ name: '张三' }));
    first.insert(row({ name: '李四' }));
    first.close();

    const second = makeStore(path);
    expect(second.list().map((r) => r.name).sort()).toEqual(['张三', '李四']);
  });

  it('recovers the next id so re-inserts cannot collide', () => {
    const path = join(dir, 'ids.db');
    const first = makeStore(path);
    first.insert(row());
    first.insert(row());
    first.close();

    const second = makeStore(path);
    expect(second.insert(row())).toBe(3);
  });

  it('preserves an unparseable file instead of silently emptying it', () => {
    const path = join(dir, 'broken.db');
    writeFileSync(path, '{"rows":[{"name":"张三"', 'utf-8'); // truncated mid-write
    const warnings: string[] = [];
    const store = makeStore(path, (m) => warnings.push(m));

    expect(store.list()).toEqual([]);
    // The warning names where the data went.
    expect(warnings.join()).toContain('已保留为');
    const salvaged = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(salvaged).toHaveLength(1);
    // And the original bytes are still there, byte for byte.
    expect(readFileSync(join(dir, salvaged[0]), 'utf-8')).toBe('{"rows":[{"name":"张三"');
  });

  it('reports a zero-length store as an interrupted write', () => {
    const path = join(dir, 'truncated.db');
    writeFileSync(path, '');
    const warnings: string[] = [];
    makeStore(path, (m) => warnings.push(m));
    expect(warnings.join()).toContain('文件为空');
  });

  it('starts cleanly when the store file does not exist yet', () => {
    const warnings: string[] = [];
    const store = makeStore(join(dir, 'brand-new.db'), (m) => warnings.push(m));
    expect(store.list()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('writes valid JSON that the next open can read', () => {
    const path = join(dir, 'valid.db');
    // Pre-create a JSON store so content-based selection picks the JSON engine
    // (a brand-new path would use SQLite wherever the native driver loads).
    writeFileSync(path, JSON.stringify({ rows: [], nextId: 1 }), 'utf-8');
    const store = makeStore(path);
    expect(store.engine).toBe('json');
    store.insert(row({ note: '含逗号, 与"引号"' }));
    store.close();
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].note).toBe('含逗号, 与"引号"');
  });

  it('writes a store whose engine matches the file it was given', () => {
    const jsonPath = join(dir, 'engine-json.db');
    writeFileSync(jsonPath, JSON.stringify({ rows: [], nextId: 1 }), 'utf-8');
    expect(makeStore(jsonPath).engine).toBe('json');
  });

  it('survives a file that claims to be SQLite but is not openable', () => {
    // The magic is present but the rest is garbage — a truncated or foreign
    // SQLite container. Activation must not throw, and must not write into it.
    const path = join(dir, 'broken-sqlite.db');
    const blob = Buffer.concat([Buffer.from(SQLITE_MAGIC, 'latin1'), Buffer.alloc(64)]);
    writeFileSync(path, blob);
    const warnings: string[] = [];

    const store = makeStore(path, (m) => warnings.push(m));
    expect(store.path).toBe(`${path}.json`);
    expect(warnings.join()).toContain('无法打开');
    // The original bytes were not touched.
    expect(readFileSync(path)).toEqual(blob);
  });
});

describe('engine selection by file content', () => {
  it('never opens a JSON file with SQLite, even when the driver is available', () => {
    // This is the regression that would silently start an empty database over an
    // existing JSON store the day better-sqlite3 becomes loadable.
    const path = join(dir, 'json-store.db');
    writeFileSync(path, JSON.stringify({ rows: [row({ name: '保留' })], nextId: 2 }), 'utf-8');

    const store = makeStore(path);
    expect(store.engine).toBe('json');
    expect(store.list().map((r) => r.name)).toEqual(['保留']);
    // The file is still JSON — SQLite did not touch it.
    expect(readFileSync(path, 'utf-8').trimStart().startsWith('{')).toBe(true);
  });

  it('does not overwrite an unreadable file; it uses a sibling instead', () => {
    const path = join(dir, 'encrypted.db');
    const blob = Buffer.from([0x8f, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    writeFileSync(path, blob);
    const warnings: string[] = [];
    const store = makeStore(path, (m) => warnings.push(m));

    // A sibling is used and the original is untouched.
    expect(store.path).toBe(`${path}.json`);
    expect(readFileSync(path)).toEqual(blob);
    expect(warnings.join()).toContain('避免破坏原文件');
  });

  it('uses the requested path for a brand-new store', () => {
    const path = join(dir, 'fresh-store.db');
    const store = makeStore(path);
    expect(store.path).toBe(path);
  });

  it('reports whether the native driver is actually usable', () => {
    expect(typeof canUseSqlite()).toBe('boolean');
  });

  it('is not fooled by a lazy wrapper whose native binding was never built', async () => {
    // `require('better-sqlite3')` succeeding means nothing on its own: the
    // wrapper defers to a native binding that pnpm's ignored build scripts never
    // produce. This reproduces that exact split and asserts the probe follows
    // the real answer, not the wrapper.
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    let wrapperLoads = true;
    let realOpenWorks = true;
    try {
      const Database = req('better-sqlite3');
      try {
        new Database(':memory:').close();
      } catch {
        realOpenWorks = false;
      }
    } catch {
      wrapperLoads = false;
    }

    if (wrapperLoads && !realOpenWorks) {
      expect(canUseSqlite()).toBe(false); // the trap this guards against
    } else {
      expect(canUseSqlite()).toBe(realOpenWorks);
    }
  });

  it('keeps a JSON store readable after many writes', () => {
    const path = join(dir, 'many.db');
    const store = makeStore(path);
    for (let i = 0; i < 25; i += 1) store.insert(row({ name: `人${i}` }));
    store.close();
    const reopened = makeStore(path);
    expect(reopened.list()).toHaveLength(25);
  });
});
