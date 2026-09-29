/** Typed emit and independent runtime assembly. Never writes into the installed host. */
import ts from 'typescript'
import { build } from 'tsdown'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { host, project, hostPackages, assertHostSource, actualHostPackages } from './dev-host.mjs'

assertHostSource()
const output = path.resolve(process.env.DSH_HOST_OUTPUT || path.join(project, 'artifacts/host-dsh02'))
if (output === host || output.includes('dsh-launcher') || output === project) throw new Error('Use a separate candidate output directory')
const marker = path.join(output, 'candidate.json')
if (fs.existsSync(output) && !fs.existsSync(marker)) throw new Error('Output already exists without a candidate ownership marker')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(marker, JSON.stringify({ kind: 'dsh-gpt-host-candidate', baseline: '0.2.0-rc.2', patch: 'gpt-dsh02.1' }, null, 2))
const actual = actualHostPackages(), cohort = hostPackages.map(relative => ({ relative, root: path.join(host, relative), pkg: JSON.parse(fs.readFileSync(path.join(host, relative, 'package.json'))) }))
const paths = {}, files = []
for (const { root, pkg } of cohort) {
  paths[pkg.name] = [path.join(root, 'src/index.ts')]; paths[pkg.name + '/*'] = [path.join(root, 'src/*.ts')]
  for (const file of fs.readdirSync(path.join(root, 'src'), { recursive: true })) if (/\.tsx?$/.test(file)) files.push(path.join(root, 'src', file))
}
const converted = ts.convertCompilerOptionsFromJson({ target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
  strict: true, skipLibCheck: true, noUncheckedIndexedAccess: true, noEmitOnError: true,
  declaration: true, declarationMap: false, sourceMap: false, esModuleInterop: true,
  allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, verbatimModuleSyntax: false,
  rootDir: host, outDir: path.join(output, 'emitted'), types: ['node'], paths }, host)
const program = ts.createProgram(files, converted.options)
const diagnostics = [...converted.errors, ...ts.getPreEmitDiagnostics(program)]
if (diagnostics.length) {
  const text = ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: x => x, getCurrentDirectory: () => host, getNewLine: () => '\n' })
  fs.writeFileSync(path.join(output, 'typecheck.log'), text); throw new Error(text)
}
const emitted = program.emit()
if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('Typed host emission failed')
console.log(`Typed emission passed: ${files.length} source files in ${cohort.length} packages`)

const runtime = path.join(output, 'runtime'), modules = path.join(runtime, 'node_modules'), links = []
fs.mkdirSync(modules, { recursive: true })
fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-gpt-compat-host-candidate', private: true, type: 'module' }))
function link(target, destination) {
  if (fs.existsSync(destination)) {
    if (fs.realpathSync(destination) === fs.realpathSync(target)) return
    if (!fs.lstatSync(destination).isSymbolicLink()) throw new Error('Refuse replacing real dependency directory: ' + destination)
    fs.unlinkSync(destination)
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.symlinkSync(fs.realpathSync(target), destination, 'junction')
}
function resolveDependency(directory, name) {
  for (let at = directory;; at = path.dirname(at)) {
    const candidate = path.join(at, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    if (path.dirname(at) === at) return undefined
  }
}
for (const [name, { directory, pkg }] of actual) {
  const destination = path.join(modules, name)
  fs.cpSync(directory, destination, { recursive: true, dereference: true, filter: item => path.basename(item) !== 'node_modules' })
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
    if (dep.startsWith('@deepseek-ai/')) continue
    const target = resolveDependency(directory, dep)
    if (!target) continue
    link(target, path.join(destination, 'node_modules', dep))
    if (!fs.existsSync(path.join(modules, dep))) link(target, path.join(modules, dep))
    links.push({ owner: name, name: dep, directory: target })
  }
}
const built = []
for (const { relative, root, pkg } of cohort) {
  const destination = path.join(modules, pkg.name), emittedRoot = path.join(output, 'emitted', relative, 'src')
  fs.cpSync(emittedRoot, path.join(destination, 'lib/types'), { recursive: true })
  fs.cpSync(path.join(root, 'src'), path.join(destination, 'src'), { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json')))
  manifest.version = '0.2.0-rc.2+gpt-dsh02.1'
  manifest.dshManagedPatch = { id: 'gpt-dsh02.1', upstreamVersion: '0.2.0-rc.2', requiresIndependentRuntime: true }
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const entries = {}
  const collect = value => {
    if (typeof value === 'string' && /^\.\/lib\/[^*]+\.js$/.test(value) && !value.startsWith('./lib/types/')) {
      const stem = value.slice(6, -3), input = path.join(emittedRoot, stem + '.js')
      if (fs.existsSync(input)) entries[stem] = input
    } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (key !== 'types' && key !== 'browser') collect(child)
  }
  collect(manifest.exports)
  if (Object.keys(entries).length) await build({ entry: entries, outDir: path.join(destination, 'lib'), config: false,
    platform: 'node', target: 'es2024', format: 'esm', fixedExtension: false, clean: false, dts: false,
    deps: { neverBundle: [/^@deepseek-ai\//, ...Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })] }, logLevel: 'silent' })
  const hash = crypto.createHash('sha256'); for (const name of fs.readdirSync(path.join(destination, 'lib'), { recursive: true }).filter(x => /\.(?:js|d\.ts)$/.test(x)).sort()) hash.update(name).update(fs.readFileSync(path.join(destination, 'lib', name)))
  built.push({ name: pkg.name, version: manifest.version, relative, typedSources: files.filter(file => file.startsWith(root + path.sep)).length, entries: Object.keys(entries), libSha256: hash.digest('hex') })
}
fs.writeFileSync(path.join(output, 'assembly.json'), JSON.stringify({ kind: 'independent-patched-host', baseline: '0.2.0-rc.2', hostSource: host, copiedHostPackages: actual.size, runtime, built, thirdPartyCacheLinks: links }, null, 2))
console.log(JSON.stringify({ runtime, typedPackages: built.length, copiedHostPackages: actual.size, thirdPartyCacheLinks: links.length }))
