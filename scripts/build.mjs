import { build } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await build({ entry: { index: 'src/index.ts', responses: 'src/responses.ts' }, outDir: 'lib', format: 'esm', dts: false, deps: { neverBundle: Object.keys(pkg.peerDependencies) }, clean: false })
// DSH concatenates plugin assets into a classic script. Register a closure
// factory so externals come from its shared module table, not ESM imports.
await build({ entry: { client: 'src/client/index.ts' }, outDir: 'lib', platform: 'browser', format: 'cjs', dts: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^react(?:\/|$)/] }, clean: false,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
// Exercise the emitted artifact in the same classic-script/module-table shape
// as the product loader. A plain ESM bundle fails before any factory registers.
const registrations = []
runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => registrations.push(value) } },
}, { timeout: 1000 })
assert.equal(registrations.length, 1)
assert.equal(registrations[0].id, pkg.name)
const client = registrations[0].factory(specifier => {
  assert.ok(['react', 'react/jsx-runtime'].includes(specifier), `Undeclared browser external: ${specifier}`)
  return {}
})
assert.equal(typeof client.apply, 'function')
assert.ok(client.inject.includes('settingsScope'))
