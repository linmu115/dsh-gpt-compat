/** Assemble a test-only installed-artifact tree without changing shared workspace dependencies. */
import { build } from 'tsdown'
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, realpathSync, symlinkSync, copyFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const host = resolve(process.argv[2])
const stage = resolve(process.argv[3])
const archive = resolve(process.argv[4])
if (existsSync(join(stage, 'package.json')) && (process.argv[5] !== '--resume'
  || JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).name !== 'gpt-compat-artifact-qualification')) throw new Error('Use a fresh staging directory')
mkdirSync(stage, { recursive: true })
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'gpt-compat-artifact-qualification', private: true, type: 'module' }))
const packages = new Map()
for (const scope of ['vendor', 'packages']) {
  for (const group of readdirSync(join(host, scope), { withFileTypes: true }).filter(e => e.isDirectory())) {
    const base = join(host, scope, group.name)
    const dirs = scope === 'vendor' ? [base] : readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(base, e.name))
    for (const dir of dirs) if (existsSync(join(dir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      packages.set(pkg.name, { dir, pkg })
    }
  }
}
const plugin = join(stage, 'node_modules/dsh-gpt-compat')
mkdirSync(plugin, { recursive: true })
execFileSync('tar', ['-xf', archive, '-C', plugin, '--strip-components=1'])
const nameOf = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
const imports = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"]([A-Za-z@][A-Za-z0-9_@./:-]*)['"]/g)].map(m => m[1]).filter(s => !s.startsWith('node:'))
const queued = new Set(), built = [], externals = [], omittedFaces = []
const queue = []
function enqueue(spec, owner) { if (!queued.has(nameOf(spec))) { queued.add(nameOf(spec)); queue.push({ name: nameOf(spec), owner }) } }
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-pwsh-local', '@deepseek-ai/dsh-shell-env', '@deepseek-ai/dsh-launch-environment']) enqueue(name, host)
for (const file of readdirSync(join(plugin, 'lib')).filter(f => f.endsWith('.mjs'))) {
  for (const spec of imports(readFileSync(join(plugin, 'lib', file), 'utf8'))) enqueue(spec, host)
}
while (queue.length) {
  const { name, owner } = queue.shift()
  const source = packages.get(name), destination = join(stage, 'node_modules', name)
  mkdirSync(dirname(destination), { recursive: true })
  if (!source) {
    const candidates = [join(owner, 'node_modules', name), join(host, 'node_modules', name)]
    let resolved = candidates.find(existsSync)
    if (!resolved) {
      const pnpm = join(host, 'node_modules/.pnpm')
      const prefix = name.replace('/', '+') + '@'
      resolved = readdirSync(pnpm).filter(dir => dir.startsWith(prefix)).map(dir => join(pnpm, dir, 'node_modules', name)).find(existsSync)
    }
    if (!resolved) throw new Error('Missing external dependency: ' + name)
    if (existsSync(destination)) {
      if (realpathSync(destination) !== realpathSync(resolved)) throw new Error('Existing dependency differs: ' + name)
    } else symlinkSync(realpathSync(resolved), destination, 'junction')
    externals.push(name)
    continue
  }
  const { pkg, dir } = source
  mkdirSync(destination, { recursive: true })
  writeFileSync(join(destination, 'package.json'), JSON.stringify(pkg, null, 2))
  const files = new Set()
  const emitted = new Map()
  const exports = value => {
    if (typeof value === 'string') { if (/^\.\/lib\/.*\.(?:m?js)$/.test(value) && !value.includes('*')) files.add(value) }
    else if (value && typeof value === 'object') {
      if (typeof value.default === 'string' && typeof value.types === 'string' && value.types.endsWith('.d.ts')) emitted.set(value.default, value.types.replace(/\.d\.ts$/, '.js'))
      for (const [key, item] of Object.entries(value)) if (key !== 'types' && key !== 'browser') exports(item)
    }
  }
  exports(pkg.exports)
  if (!files.size && pkg.main?.startsWith('lib/')) files.add('./' + pkg.main)
  const entries = {}
  for (const file of files) {
    if (file.startsWith('./lib/typert.')) { omittedFaces.push(name + ':' + file); continue }
    const relative = file.replace(/^\.\/lib\//, '').replace(/\.m?js$/, '')
    const input = emitted.has(file) ? join(dir, emitted.get(file)) : file.startsWith('./lib/types/') ? join(dir, file) : join(dir, 'lib/types', relative + '.js')
    if (!existsSync(input)) throw new Error(`Missing emitted runtime ${name}: ${input}`)
    entries[relative] = input
  }
  await build({ entry: entries, outDir: join(destination, 'lib'), format: 'esm', platform: 'node', target: 'es2024',
    config: false, clean: false, dts: false, fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })] }, logLevel: 'silent' })
  for (const file of files) if (file.endsWith('.mjs')) {
    const output = join(destination, file)
    copyFileSync(output.replace(/\.mjs$/, '.js'), output)
  }
  for (const file of readdirSync(join(destination, 'lib'), { recursive: true }).filter(f => /\.m?js$/.test(f))) {
    for (const spec of imports(readFileSync(join(destination, 'lib', file), 'utf8'))) enqueue(spec, dir)
  }
  built.push(name)
}
const require = createRequire(join(stage, 'package.json'))
const resolved = require.resolve('dsh-gpt-compat/responses')
await import(new URL('file:///' + resolved.replaceAll('\\', '/')))
writeFileSync(join(stage, 'assembly.json'), JSON.stringify({ archive, host, built, externals, omittedFaces, resolved }, null, 2))
console.log(JSON.stringify({ stage, built: built.length, externalCacheLinks: externals.length, artifactImport: 'passed' }))
