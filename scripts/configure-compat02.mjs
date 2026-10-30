import fs from 'node:fs'
import path from 'node:path'
import { project as root, host, hostModules, hostPackages, assertHostSource } from './dev-host.mjs'
assertHostSource()
const modules = path.join(root, 'node_modules')
function link(from, to) {
  const resolved = fs.realpathSync(from)
  const prior = fs.lstatSync(to, { throwIfNoEntry: false })
  if (prior) {
    if (fs.existsSync(to) && fs.realpathSync(to) === resolved) return
    if (!prior.isSymbolicLink()) throw new Error('Refuse replacing a real dependency directory: ' + to)
    fs.unlinkSync(to)
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.symlinkSync(resolved, to, 'junction')
}
for (const name of fs.readdirSync(modules)) {
  if (name.startsWith('.')) continue
  const names = name.startsWith('@') ? fs.readdirSync(path.join(modules, name)).map(sub => name + '/' + sub) : [name]
  for (const dep of names) link(path.join(modules, dep), path.join(host, 'node_modules', dep))
}
if (process.env.DSH_TSX_DIRECTORY) link(process.env.DSH_TSX_DIRECTORY, path.join(host, 'node_modules/tsx'))
const installed = path.join(hostModules, '.pnpm')
for (const dep of ['chokidar', 'koffi']) {
  const entry = fs.existsSync(installed) && fs.readdirSync(installed).find(item => item.startsWith(dep + '@'))
  if (entry) link(path.join(installed, entry, 'node_modules', dep), path.join(host, 'node_modules', dep))
}
const packages = hostPackages.map(value => value.replace(/^packages\//, ''))
const paths = {}
for (const pkgPath of packages) {
  const dir = path.join(host, 'packages', pkgPath)
  const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  paths[name] = [path.relative(root, path.join(dir, 'src/index.ts')).replaceAll('\\', '/')]
  paths[name + '/*'] = [path.relative(root, path.join(dir, 'src/*.ts')).replaceAll('\\', '/')]
}
fs.writeFileSync(path.join(root, 'tsconfig.compat02.json'), JSON.stringify({
  extends: './tsconfig.actual02.json', compilerOptions: { paths },
}, null, 2) + '\n')
fs.writeFileSync(path.join(host, 'tsconfig.compat02.json'), JSON.stringify({
  extends: path.relative(host, path.join(root, 'tsconfig.actual02.json')).replaceAll('\\', '/'),
  compilerOptions: { paths: Object.fromEntries(Object.entries(paths).map(([name, values]) =>
    [name, values.map(value => path.relative(host, path.resolve(root, value)).replaceAll('\\', '/'))])) },
  include: packages.map(pkg => 'packages/' + pkg + '/src/**/*.ts'),
}, null, 2) + '\n')
console.log(JSON.stringify({ patchedSourcePackages: packages.length, baseline: '0.2.1-rc.3' }))
