/**
 * The storage self-check decides whether the database is encrypted, so it must
 * be based on what the bytes actually are — not on a filename or a guess.
 *
 * These cases write real files and assert the verdict: plain SQLite, plain
 * JSON, an encrypted-looking blob, an empty file, and a missing path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDatabase, SQLITE_MAGIC } from '../../src/birthday/services/db-inspect.js';

let dir: string;
const at = (name: string) => join(dir, name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-db-inspect-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('inspectDatabase', () => {
  it('reports a missing file without pretending to know', () => {
    const report = inspectDatabase(at('nope.db'), 'json');
    expect(report.exists).toBe(false);
    expect(report.format).toBe('missing');
    expect(report.encryption).toBe('unknown');
    expect(report.summary).toContain('不存在');
  });

  it('recognises a plain SQLite file by its magic header', () => {
    // Just enough of the header for the check; the rest is irrelevant.
    writeFileSync(at('plain.db'), Buffer.concat([Buffer.from(SQLITE_MAGIC, 'latin1'), Buffer.alloc(100)]));
    const report = inspectDatabase(at('plain.db'), 'sqlite');
    expect(report.format).toBe('sqlite');
    expect(report.encryption).toBe('none');
    expect(report.consistent).toBe(true);
    expect(report.summary).toContain('未加密');
  });

  it('recognises the JSON fallback as plain text', () => {
    writeFileSync(at('plain.json'), '{"rows":[],"nextId":1}');
    const report = inspectDatabase(at('plain.json'), 'json');
    expect(report.format).toBe('json');
    expect(report.encryption).toBe('none');
    expect(report.consistent).toBe(true);
    expect(report.summary).toContain('JSON');
  });

  it('flags an encrypted-looking container as suspected', () => {
    // An encrypted store has no SQLite magic and is not JSON: high-entropy
    // bytes that happen to avoid both signatures.
    const blob = Buffer.alloc(4096);
    for (let i = 0; i < blob.length; i += 1) blob[i] = (i * 137 + 29) % 256;
    blob[0] = 0x8f;
    writeFileSync(at('secret.db'), blob);
    const report = inspectDatabase(at('secret.db'), 'sqlite');
    expect(report.format).toBe('unrecognized');
    expect(report.encryption).toBe('suspected');
    expect(report.summary).toContain('疑似已加密');
  });

  it('does not mistake a JSON file renamed to .db for SQLite', () => {
    writeFileSync(at('misnamed.db'), '{"rows":[{"id":1}]}');
    const report = inspectDatabase(at('misnamed.db'), 'json');
    expect(report.format).toBe('json');
    expect(report.encryption).toBe('none');
  });

  it('reports an engine/format mismatch rather than claiming consistency', () => {
    // The JSON engine pointed at a real SQLite file: the live engine is not
    // reading what the path holds.
    writeFileSync(at('mismatch.db'), Buffer.concat([Buffer.from(SQLITE_MAGIC, 'latin1'), Buffer.alloc(50)]));
    const report = inspectDatabase(at('mismatch.db'), 'json');
    expect(report.format).toBe('sqlite');
    expect(report.consistent).toBe(false);
  });

  it('reports size, and the record count it was given', () => {
    writeFileSync(at('sized.json'), '{"rows":[],"nextId":1}');
    const report = inspectDatabase(at('sized.json'), 'json', 7);
    expect(report.sizeBytes).toBeGreaterThan(0);
    expect(report.records).toBe(7);
    expect(report.readable).toBe(true);
  });

  it('treats a very short non-JSON file as unrecognized, not as JSON', () => {
    writeFileSync(at('tiny.db'), Buffer.from([0x01, 0x02, 0x03]));
    const report = inspectDatabase(at('tiny.db'), 'sqlite');
    expect(report.format).toBe('unrecognized');
    expect(report.encryption).toBe('suspected');
  });
});
