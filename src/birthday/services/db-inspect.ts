/**
 * Storage self-check: what the database actually is on disk, and whether it is
 * encrypted.
 *
 * The check is byte-level rather than a guess, because "encrypted" has a
 * precise signature here:
 *
 *   - a plain SQLite file begins with the 16-byte magic `SQLite format 3\0`;
 *   - the JSON fallback begins with `{` and parses;
 *   - anything else (high-entropy bytes, no magic) is what an encrypted
 *     container — SQLCipher, or an encrypted volume — looks like from outside.
 *
 * Note that plain `better-sqlite3` cannot encrypt at rest: an encrypted store
 * means either a cipher-capable driver or an encrypted filesystem, and in both
 * cases the file will not start with the SQLite magic.
 */

import { openSync, readSync, closeSync, statSync, existsSync, accessSync, constants } from 'node:fs';
import { SQLITE_MAGIC } from '../db.js';

/**
 * Re-exported so callers can probe the magic without reaching into the store
 * layer; the constant itself lives with the store, its single source of truth.
 */
export { SQLITE_MAGIC };

export type StorageFormat = 'sqlite' | 'json' | 'unrecognized' | 'missing';
export type EncryptionStatus = 'none' | 'suspected' | 'unknown';

export interface DatabaseInspection {
  path: string;
  exists: boolean;
  /** Engine the running plugin is using for this path. */
  engine: 'sqlite' | 'json';
  /** What the bytes on disk actually look like. */
  format: StorageFormat;
  encryption: EncryptionStatus;
  sizeBytes: number;
  readable: boolean;
  writable: boolean;
  /** Records currently stored (as reported by the live engine). */
  records?: number;
  /** Whether the engine and the file agree; a mismatch means a stale fallback. */
  consistent: boolean;
  /** One sentence a user can act on. */
  summary: string;
}

/**
 * Read the first bytes of a file without loading it.
 * @param path - file to sample.
 * @param length - how many bytes.
 * @returns The bytes, or null when unreadable.
 */
function readHead(path: string, length: number): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Whether the bytes are valid JSON text (at least an object or array root). */
function looksLikeJson(head: Buffer): boolean {
  const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return text.startsWith('{') || text.startsWith('[');
}

/**
 * Inspect the storage backing the birthday library.
 * @param storePath - the path the live engine uses.
 * @param engine - the engine actually in use.
 * @param records - record count, for the summary.
 * @returns The inspection report.
 */
export function inspectDatabase(
  storePath: string,
  engine: 'sqlite' | 'json',
  records?: number,
): DatabaseInspection {
  if (!existsSync(storePath)) {
    return {
      path: storePath,
      exists: false,
      engine,
      format: 'missing',
      encryption: 'unknown',
      sizeBytes: 0,
      readable: false,
      writable: false,
      records,
      consistent: false,
      summary: '数据库文件尚不存在，将在首次写入时创建。',
    };
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(storePath).size;
  } catch {
    sizeBytes = 0;
  }

  const readable = (() => {
    try {
      accessSync(storePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  })();
  const writable = (() => {
    try {
      accessSync(storePath, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  })();

  const head = readHead(storePath, Math.max(SQLITE_MAGIC.length, 64));

  let format: StorageFormat = 'unrecognized';
  if (head !== null && head.length >= SQLITE_MAGIC.length) {
    if (head.subarray(0, SQLITE_MAGIC.length).toString('latin1') === SQLITE_MAGIC) {
      format = 'sqlite';
    } else if (looksLikeJson(head)) {
      format = 'json';
    } else {
      format = 'unrecognized';
    }
  } else if (head !== null && head.length > 0 && looksLikeJson(head)) {
    format = 'json';
  }

  const encryption: EncryptionStatus =
    format === 'sqlite' || format === 'json' ? 'none' : 'suspected';

  const consistent =
    (engine === 'sqlite' && format === 'sqlite') || (engine === 'json' && format === 'json');

  let summary: string;
  if (!readable) {
    summary = '数据库文件不可读，无法判断加密状态。';
  } else if (format === 'sqlite') {
    summary = '明文 SQLite，未加密（文件以 SQLite 头部标识开头）。';
  } else if (format === 'json') {
    summary = 'JSON 明文存储，未加密（内容可直接读取）。';
  } else {
    summary =
      '文件头既不是 SQLite 标识也不是 JSON，疑似已加密（或为加密卷/未知格式），需用对应密钥才能读取。';
  }

  return {
    path: storePath,
    exists: true,
    engine,
    format,
    encryption,
    sizeBytes,
    readable,
    writable,
    records,
    consistent,
    summary,
  };
}
