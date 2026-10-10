/**
 * Packaging verification: is the tarball actually shareable?
 *
 * A plugin can work perfectly in its own repository and still be unusable by
 * anyone else. This harness packs the package, extracts it into a clean
 * directory, and checks the things that break exactly that way:
 *
 *   - every path in `exports` / `main` / `types` exists INSIDE the tarball
 *     (a path that only exists locally is the classic packaging bug);
 *   - the `dsh` bundle/client metadata points at files that shipped;
 *   - the peers declared match what the compiled code actually imports;
 *   - no tests, scripts, build caches or absolute user paths leaked in;
 *   - the client bundle still loads as a classic script with only the
 *     host-provided react — which is how the browser loads it.
 *
 * Everything runs offline and in-process: no registry access, no network.
 * Run: node scripts/verify-package.mjs
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** npm is a shell script on POSIX and npm.cmd on Windows. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Run `npm pack` into a directory.
 *
 * A shell is required on Windows (npm is a `.cmd`, and Node refuses to spawn
 * those without one since the CVE-2024-27980 fix), so the command is assembled
 * as one quoted string rather than an argv array — passing argv with
 * `shell: true` is deprecated because it concatenates without escaping.
 */
function packInto(dir) {
  const command = `${NPM} pack --pack-destination "${dir}" --silent`;
  return execSync(command, { cwd: root, encoding: 'utf-8' });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Every file under a directory, as paths relative to it. */
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

/** Bare specifiers imported or required by every .js file under a directory. */
function importedSpecifiers(dir) {
  const found = new Set();
  for (const rel of listFiles(dir)) {
    if (!rel.endsWith('.js')) continue;
    const text = readFileSync(join(dir, rel), 'utf-8');
    for (const m of text.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      found.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  return found;
}

const work = mkdtempSync(join(tmpdir(), 'dsh-pack-verify-'));
const pkgDir = join(work, 'package');

try {
  console.log('1. pack');
  const tarball = packInto(work)
    .trim()
    .split('\n')
    .pop()
    .trim();
  const tgz = join(work, tarball);
  check('npm pack produced a tarball', existsSync(tgz), tgz);
  console.log(`  (tarball: ${tarball.split(/[\\/]/).pop()}, ${Math.round(statSync(tgz).size / 1024)} KB)`);

  console.log('2. extract');
  mkdirSync(pkgDir, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', work], { stdio: 'ignore' });
  check('tarball extracts to package/', existsSync(join(pkgDir, 'package.json')));

  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
  const shipped = listFiles(pkgDir);

  console.log('3. every declared entry point shipped');
  const targets = [];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value === 'string') targets.push([`exports["${key}"]`, value]);
    else for (const [condition, path] of Object.entries(value)) targets.push([`exports["${key}"].${condition}`, path]);
  }
  targets.push(['main', manifest.main], ['types', manifest.types]);
  for (const [label, rel] of targets) {
    if (typeof rel !== 'string') continue;
    check(`${label} -> ${rel}`, shipped.includes(rel.replace(/^\.\//, '')), 'missing from the tarball');
  }

  console.log('4. dsh metadata');
  const patch = manifest.dsh?.bundle?.patch;
  const patches = (Array.isArray(patch) ? patch : [patch]).filter(Boolean);
  check('dsh.bundle.patch is declared', patches.length > 0);
  for (const p of patches) {
    check(`bundle patch ships: ${p}`, shipped.includes(String(p).replace(/^\.\//, '')));
  }
  check(
    'dsh.client declares a platform and an injection target',
    manifest.dsh?.client?.platform === 'web' && Array.isArray(manifest.dsh?.client?.inject),
    JSON.stringify(manifest.dsh?.client),
  );

  console.log('5. declared dependencies match the compiled imports');
  const imports = importedSpecifiers(join(pkgDir, 'lib'));
  const peers = manifest.peerDependencies ?? {};
  const deps = manifest.dependencies ?? {};
  const optional = manifest.optionalDependencies ?? {};
  const undeclared = [...imports].filter(
    (name) => !peers[name] && !deps[name] && !optional[name],
  );
  check('server runtime imports are all declared', undeclared.length === 0, undeclared.join(', '));
  check(
    'host-provided modules are declared as peers',
    typeof peers['@deepseek-ai/dsh-tools'] === 'string' &&
      typeof peers['@deepseek-ai/schemastery'] === 'string',
    JSON.stringify(peers),
  );
  check(
    'peers are optional, so pnpm will not try to fetch private packages',
    ['@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery', '@deepseek-ai/cordis'].every(
      (name) => manifest.peerDependenciesMeta?.[name]?.optional === true,
    ),
  );
  const unusedDeps = Object.keys(deps).filter((name) => {
    // A dependency is unused when nothing in lib/ or src/ mentions it.
    const needle = name;
    const inLib = [...imports].includes(needle);
    const inSrc = listFiles(join(pkgDir, 'src'))
      .filter((f) => /\.tsx?$/.test(f))
      .some((f) => new RegExp(`["']${needle.replace(/[/@.]/g, (c) => `\\${c}`)}`).test(readFileSync(join(pkgDir, 'src', f), 'utf-8')));
    return !inLib && !inSrc;
  });
  check('no unused runtime dependencies', unusedDeps.length === 0, unusedDeps.join(', '));

  console.log('6. nothing that should not ship');
  for (const junk of ['tests/', 'scripts/', '.verify/', 'node_modules/', '.git/']) {
    check(`does not ship ${junk}`, !shipped.some((f) => f.startsWith(junk)));
  }
  const leaked = shipped.filter((rel) => {
    if (!/\.(?:js|mjs|cjs|ts|tsx|json|md|yml|yaml)$/.test(rel)) return false;
    return /[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+/.test(readFileSync(join(pkgDir, rel), 'utf-8'));
  });
  check('no absolute user paths in shipped files', leaked.length === 0, leaked.slice(0, 3).join(', '));
  // Any absolute Windows path at all: the build machine's directory layout must
  // not travel with the package. Anchored so `https://` style URLs do not match
  // (they are `s:` followed by `//`, not a drive letter).
  const absolutePaths = shipped.filter((rel) =>
    /\.(?:js|mjs|cjs|json|md|yml|yaml)$/.test(rel) &&
    /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_]/.test(readFileSync(join(pkgDir, rel), 'utf-8')),
  );
  check('no absolute filesystem paths in shipped files', absolutePaths.length === 0, absolutePaths.slice(0, 3).join(', '));
  check('LICENSE ships and the license field agrees', manifest.license === 'MIT' && shipped.includes('LICENSE'));
  check('README ships', shipped.includes('README.md'));
  check(
    'every docs/ link in the README resolves inside the tarball',
    [...readFileSync(join(pkgDir, 'README.md'), 'utf-8').matchAll(/\]\((docs\/[^)]+)\)/g)]
      .map((m) => m[1])
      .every((rel) => shipped.includes(rel)),
  );

  console.log('7. client bundle loads as a classic script');
  const clientText = readFileSync(join(pkgDir, 'client', 'client.js'), 'utf-8');
  check('no top-level ESM import/export', !/^\s*(?:import|export)\s/m.test(clientText));
  check('registers itself with __ModuleLoader__.load', /__ModuleLoader__\.load\(/.test(clientText));
  const specifiers = [...new Set([...clientText.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]))];
  const allowed = new Set(['react', 'react-dom', 'react/jsx-runtime']);
  const disallowed = specifiers.filter((s) => !allowed.has(s));
  check('only requires host-provided modules', disallowed.length === 0, `unexpected: ${disallowed.join(', ')}`);
  check('requires no node builtins', !specifiers.some((s) => s.startsWith('node:')));

  // Execute it for real against this repo's react, the way the browser does.
  const registrations = [];
  globalThis.window = { __ModuleLoader__: { load: (mod) => registrations.push(mod) } };
  const reactPath = require.resolve('react');
  const jsxPath = require.resolve('react/jsx-runtime');
  const fakeRequire = (name) => {
    if (name === 'react') return require(reactPath);
    if (name === 'react/jsx-runtime') return require(jsxPath);
    throw new Error(`bundle required unexpected module: ${name}`);
  };
  let executed = true;
  let executeError = '';
  try {
    // eslint-disable-next-line no-new-func
    new Function('require', clientText)(fakeRequire);
  } catch (e) {
    executed = false;
    executeError = e.message;
  }
  check('bundle executes without throwing', executed, executeError);
  check('bundle registered exactly one module', registrations.length === 1, String(registrations.length));
  const registration = registrations[0];
  check('registered under the package name', registration?.id === manifest.name, String(registration?.id));
  const clientExports = registration?.factory?.(fakeRequire);
  check('factory returns a cordis plugin shape', typeof clientExports?.apply === 'function');
  check(
    'client plugin injects the slots service',
    Array.isArray(clientExports?.inject) && clientExports.inject.includes('slots'),
    JSON.stringify(clientExports?.inject),
  );

  console.log(`\n` + `${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
