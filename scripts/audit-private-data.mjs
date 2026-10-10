/**
 * Private-data audit for the distributable artifact.
 *
 * Answers one question: does the package (or the repository) contain any of the
 * user's own records or machine identity?
 *
 * Fingerprints are read from the LIVE database at run time and never written
 * down here — a hardcoded list would itself become the leak the moment this
 * script is committed, which is exactly what an earlier version of it did.
 *
 * The search is byte-level, in UTF-8 and UTF-16LE, so a string hidden in a
 * source map or an unfamiliar encoding is still found.
 *
 * Usage:
 *   node scripts/audit-private-data.mjs [--db <path>] [--tokens <path>]
 *   node scripts/audit-private-data.mjs --tokens ./my-fingerprints.txt
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at !== -1 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};

/** Tokens that are product vocabulary, not user data. */
const PRODUCT_VOCABULARY = new Set([
  '本人', '配偶', '爸爸', '妈妈', '儿子', '女儿', '哥哥', '姐姐', '弟弟', '妹妹',
  '家人', '亲戚', '朋友', '同事', '同学', '老师', '学生', '其他',
  'gregorian', 'lunar', 'islamic', 'hebrew',
  'Asia/Shanghai', 'UTC',
]);

/** Locate the live database without importing the plugin. */
function findDatabase() {
  const explicit = flag('db');
  if (explicit !== undefined) return existsSync(explicit) ? explicit : undefined;
  const candidates = [
    process.env.DSH_HOME && join(process.env.DSH_HOME, 'dsh-birthday', 'birthdays.db'),
    join(homedir(), '.dsh', 'dsh-birthday', 'birthdays.db'),
    join(process.cwd(), 'data', 'dsh-birthday.db'),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

/** Read the user's own values out of the live store. */
function tokensFromDatabase(path) {
  const tokens = new Set();
  const raw = readFileSync(path, 'utf-8');
  let rows = [];
  try {
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  } catch {
    return tokens;
  }
  for (const row of rows) {
    for (const key of ['name', 'relation', 'note', 'birth_timezone']) {
      const value = row[key];
      if (typeof value === 'string' && value.trim().length >= 2) tokens.add(value.trim());
    }
    // The date fields are the strongest fingerprints of all, and the Gregorian
    // anchor matters as much as the source fields: an earlier version of this
    // audit fingerprinted only `input_date_json`, so a real birth date sitting
    // in a test fixture went unnoticed.
    if (typeof row.input_date_json === 'string') tokens.add(row.input_date_json);
    if (typeof row.gregorian_local_date === 'string' && row.gregorian_local_date.length >= 6) {
      tokens.add(row.gregorian_local_date);
    }
  }
  return tokens;
}

const tokensFile = flag('tokens');
const tokens = new Set();
let source = '';

if (tokensFile !== undefined) {
  for (const line of readFileSync(tokensFile, 'utf-8').split(/\r?\n/)) {
    if (line.trim().length >= 2) tokens.add(line.trim());
  }
  source = `指纹文件 ${tokensFile}`;
} else {
  const db = findDatabase();
  if (db === undefined) {
    console.error('找不到数据库。请用 --db <path> 指定，或用 --tokens <path> 提供指纹清单。');
    process.exitCode = 1;
    process.exit();
  }
  for (const token of tokensFromDatabase(db)) tokens.add(token);
  source = `数据库 ${db}`;
}

// Machine identity: the account name and the home directory.
const username = (() => {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
})();
if (username && username.length >= 3) tokens.add(username);
tokens.add(homedir());
if (process.env.DSH_HOME) tokens.add(process.env.DSH_HOME);

const fingerprintList = [...tokens].filter((t) => t.length >= 2);

function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

function countInBuffer(buffer, needle) {
  let count = 0;
  for (const encoding of ['utf8', 'utf16le']) {
    const bytes = Buffer.from(needle, encoding);
    if (bytes.length < 4) continue;
    let at = buffer.indexOf(bytes);
    while (at !== -1) {
      count += 1;
      at = buffer.indexOf(bytes, at + 1);
    }
  }
  return count;
}

function audit(title, dir, files, { exclude } = {}) {
  console.log(`\n=== ${title} ===`);
  console.log(`  ${files.length} 个文件，逐字节扫描（UTF-8 + UTF-16LE），指纹 ${fingerprintList.length} 个`);
  let realLeaks = 0;
  const expected = [];
  for (const rel of files) {
    if (exclude && exclude.some((re) => re.test(rel))) continue;
    let buffer;
    try {
      buffer = readFileSync(join(dir, rel));
    } catch {
      continue;
    }
    for (const fingerprint of fingerprintList) {
      const n = countInBuffer(buffer, fingerprint);
      if (n === 0) continue;
      const isVocabulary = PRODUCT_VOCABULARY.has(fingerprint);
      const line = `${rel} (${n}×)`;
      if (isVocabulary) expected.push(`${fingerprint} → ${line}`);
      else {
        realLeaks += 1;
        console.log(`  [命中] ${fingerprint} → ${line}`);
      }
    }
  }
  if (expected.length > 0) {
    console.log(`  [说明] 以下命中是插件自带词表，非你的数据:`);
    for (const line of expected.slice(0, 8)) console.log(`         ${line}`);
  }
  console.log(`  —— 结论: ${realLeaks === 0 ? '未发现你的私有数据' : `发现 ${realLeaks} 处需处理`}`);
  return realLeaks;
}

console.log(`指纹来源: ${source}`);
console.log(`机器身份: username="${username ?? '?'}", home="${homedir()}"`);

const work = mkdtempSync(join(tmpdir(), 'dsh-pii-audit-'));
let leaks = 0;
try {
  // A published tarball can be audited directly, which is the only way to be
  // sure the artifact consumers actually receive is clean.
  const external = flag('tarball');
  let tgz;
  let label;
  if (external !== undefined) {
    tgz = resolve(external);
    if (!existsSync(tgz)) throw new Error(`tarball not found: ${tgz}`);
    label = `① 已发布的 tarball（${tgz}）`;
  } else {
    execSync(`${NPM} pack --pack-destination "${work}" --silent`, { cwd: root, encoding: 'utf-8' });
    tgz = join(work, readdirSync(work).find((f) => f.endsWith('.tgz')));
    label = '① 分发包 tarball（会被分享给他人的东西）';
  }
  const pkgDir = join(work, 'package');
  mkdirSync(pkgDir, { recursive: true });
  execSync(`tar -xzf "${tgz}" -C "${work}"`, { stdio: 'ignore' });
  const pkgFiles = listFiles(pkgDir);

  leaks += audit(label, pkgDir, pkgFiles);

  console.log('\n  数据文件检查:');
  const dataFiles = pkgFiles.filter((f) =>
    /\.(?:db|sqlite|sqlite3|jsonl|bak)$/i.test(f) || /corrupt-\d{4}-/.test(f),
  );
  const jsonFiles = pkgFiles.filter((f) => extname(f) === '.json');
  console.log(`    数据库文件: ${dataFiles.length === 0 ? '无' : dataFiles.join(', ')}`);
  console.log(`    .json 文件: ${jsonFiles.length === 0 ? '无' : jsonFiles.join(', ')}`);
  const largest = pkgFiles
    .map((f) => ({ f, size: statSync(join(pkgDir, f)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);
  console.log(`    最大文件: ${largest.map(({ f, size }) => `${f} ${(size / 1024).toFixed(1)}KB`).join(', ')}`);

  // The audit script itself is excluded from the repository scan: it necessarily
  // mentions whatever it reads, and it stores none of it.
  const ignore = [/^node_modules\//, /^\.git\//, /^lib\//, /^client\//, /^\.verify\//, /^data\//, /^\.acl-report\//, /\.tgz$/, /^coverage\//];
  const repoFiles = listFiles(root).filter((f) => !ignore.some((re) => re.test(f)));
  leaks += audit('② 可提交到 git 的文件（会被 push 到 GitHub 的东西）', root, repoFiles, {
    exclude: [/^scripts\/audit-private-data\.mjs$/],
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n总计需处理: ${leaks} 处`);
if (leaks > 0) process.exitCode = 1;
