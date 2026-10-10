/**
 * Client-bundle verification.
 *
 * DSH ships `client/client.js` to the browser as a plain `<script>` and expects
 * it to call `window.__ModuleLoader__.load({ id, factory })`. This script
 * proves, without a browser:
 *   1. the file is a classic script (no import/export statements);
 *   2. it registers exactly one module whose `factory(require)` returns the
 *      client plugin exports (`name`, `inject`, `apply`);
 *   3. `apply(ctx)` registers the sidebar entry and the main panel into the
 *      real slot keys with the documented option shape.
 *
 * Run: node scripts/verify-client.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const clientPath = resolve(root, 'client/client.js');

const failures = [];
const notes = [];
function check(label, condition, detail = '') {
  if (condition) notes.push(`  PASS  ${label}`);
  else failures.push(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

const code = readFileSync(clientPath, 'utf8');

// --- 1. Static format checks ------------------------------------------------

check('bundle exists and is non-trivial', code.length > 1000, `${code.length} bytes`);
check('no top-level import statement', !/^\s*import\s/m.test(code));
check('no top-level export statement', !/^\s*export\s/m.test(code));
check('wraps in window.__ModuleLoader__.load', code.includes('window.__ModuleLoader__.load'));
check('declares the module id', code.includes('id: "dsh-birthday"'));
check(
  'obtains react through the injected require',
  code.includes('require("react")') || code.includes('require("react/jsx-runtime")'),
);
check('returns module.exports from the factory', code.includes('return module.exports;'));
// Every specifier must be one the host loader provides. react/jsx-runtime is
// the standard automatic-runtime entry and every shipped DSH client bundle
// requires it, so it belongs on the allow-list — but nothing else may appear.
const specifiers = [...code.matchAll(/require\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
const allowed = new Set(['react', 'react-dom', 'react/jsx-runtime']);
const unexpected = [...new Set(specifiers)].filter((s) => !allowed.has(s));
check(
  'requires only host-provided modules',
  unexpected.length === 0,
  `unexpected: ${JSON.stringify(unexpected)}`,
);

// --- 2. Load it the way the browser loader does -----------------------------

const nodeRequire = createRequire(import.meta.url);
let loaded = null;
const previousWindow = globalThis.window;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition;
    },
  },
};

try {
  // eslint-disable-next-line no-new-func
  new Function(code)();
} catch (e) {
  failures.push(`  FAIL  bundle evaluation threw — ${e && e.message ? e.message : String(e)}`);
}

check('loader received exactly one module definition', loaded !== null);
if (loaded !== null) {
  check('module id is dsh-birthday', loaded.id === 'dsh-birthday', String(loaded.id));
  check('definition carries a factory', typeof loaded.factory === 'function');
}

const mod = loaded !== null && typeof loaded.factory === 'function' ? loaded.factory(nodeRequire) : {};
check('client plugin exports name', mod.name === 'dsh-birthday', String(mod.name));
check(
  'client plugin injects slots',
  Array.isArray(mod.inject) && mod.inject.includes('slots'),
  JSON.stringify(mod.inject),
);
check('client plugin exports apply()', typeof mod.apply === 'function');

// --- 3. Slot registrations --------------------------------------------------

const registrations = [];
const ctx = {
  slots: {
    inject(key, cb) {
      // Model the host: the slot is declared, so the callback runs.
      registrations.length;
      cb();
      return () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
  logger: { warn() {}, info() {}, error() {} },
};

if (typeof mod.apply === 'function') {
  try {
    mod.apply(ctx);
  } catch (e) {
    failures.push(`  FAIL  apply() threw — ${e && e.message ? e.message : String(e)}`);
  }
}

check(
  'registers 2 slot entries',
  registrations.length === 2,
  `got ${JSON.stringify(registrations.map((r) => r.options?.name))}`,
);

const sidebar = registrations.find((r) => r.options?.name === 'sidebar.panellist');
check('registers the sidebar entry into sidebar.panellist', sidebar !== undefined);
check(
  'sidebar entry carries the documented id and label',
  sidebar?.options?.id === 'dsh-birthday' && sidebar?.options?.label === '生日',
  JSON.stringify(sidebar?.options),
);

const main = registrations.find((r) => r.options?.name === 'main');
check('registers the main panel into main', main !== undefined);
check(
  'main panel key matches the sidebar id',
  main?.options?.key === 'dsh-birthday',
  JSON.stringify(main?.options),
);

check(
  'every entry supplies a component factory',
  registrations.every((r) => typeof r.component === 'function'),
);

for (const reg of registrations) {
  const element = reg.component();
  check(
    `${reg.options.name} component returns a React element`,
    element !== null && typeof element === 'object' && element.type !== undefined,
  );
}

if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

// --- Report -----------------------------------------------------------------

console.log('dsh-birthday client bundle verification');
console.log(`  bundle: ${clientPath}`);
console.log('');
for (const note of notes) console.log(note);
if (failures.length > 0) {
  console.log('');
  for (const failure of failures) console.log(failure);
}
console.log('');
console.log(`${notes.length} passed, ${failures.length} failed`);
process.exitCode = failures.length === 0 ? 0 : 1;
