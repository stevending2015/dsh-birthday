/**
 * Bundle the client entry into the single classic-script file DSH ships to
 * the browser.
 *
 * DSH loads a client bundle as a plain `<script>` and expects it to call
 * `window.__ModuleLoader__.load({ id, factory })`, where `factory(require)`
 * returns the module exports. Emitting ESM here fails in the browser with
 * "Cannot use import statement outside a module", so we emit CJS and wrap it.
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outdir = resolve(root, 'client');
const pkgId = 'dsh-birthday';

mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(outdir, 'client.js'),
  bundle: true,
  // CJS: `require("react")` is what the factory hands us; no import/export
  // statements survive into the shipped file.
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  // Classic JSX transform so the only runtime dependency is `react` itself
  // (no `react/jsx-runtime` specifier for the loader to resolve).
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: {
    js: [
      `window.__ModuleLoader__.load({`,
      `  id: ${JSON.stringify(pkgId)},`,
      `  factory: (require) => {`,
      `var module = { exports: {} };`,
      `var exports = module.exports;`,
      `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
    ].join('\n'),
  },
  footer: {
    js: ['return module.exports;', '  }', '});'].join('\n'),
  },
  sourcemap: true,
  logLevel: 'info',
});

console.log('client bundle written to', resolve(outdir, 'client.js'));
