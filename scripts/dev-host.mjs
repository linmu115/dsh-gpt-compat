import { resolve, dirname, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const host = resolve(process.env.DSH_HOST_ROOT || join(project, '../host-gpt-candidate'))
export const hostModules = resolve(process.env.DSH_HOST_NODE_MODULES || (process.env.APPDATA
  ? join(process.env.APPDATA, 'in.dsh-plug.dsh-launcher/versions/0.2.0-rc.2/node_modules') : join(host, 'node_modules')))
export const hostPackages = ['packages/core/agent', 'packages/core/agent-loop', 'packages/core/scope', 'packages/core/session',
  'packages/core/system-prompt', 'packages/llm/llm', 'packages/compaction/compaction-basic',
  'packages/shell/shell', 'packages/shell/bash-local', 'packages/shell/pwsh-local',
  'packages/fs/fs', 'packages/fs/fs-local', 'packages/fs/fs-sandbox']
export function assertHostSource() {
  const file = join(host, 'packages/core/session/package.json')
  if (!existsSync(file) || JSON.parse(readFileSync(file, 'utf8')).version !== '0.2.0-rc.2') throw new Error('DSH_HOST_ROOT must name independently patched DSH 0.2.0-rc.2 source; older RC2 is unsupported')
}
export function actualHostPackages() {
  const found = new Map(), store = join(hostModules, '.pnpm')
  const inspect = scope => {
    if (!existsSync(scope)) return
    for (const leaf of readdirSync(scope)) {
      const at = join(scope, leaf)
      if (!existsSync(join(at, 'package.json'))) continue
      const directory = realpathSync(at), pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (pkg.name?.startsWith('@deepseek-ai/')) {
        const prior = found.get(pkg.name)
        if (prior && prior.pkg.version !== pkg.version) throw new Error(`Ambiguous actual host package: ${pkg.name}`)
        found.set(pkg.name, { directory, pkg })
      }
    }
  }
  if (existsSync(store)) for (const entry of readdirSync(store)) inspect(join(store, entry, 'node_modules/@deepseek-ai'))
  inspect(join(hostModules, '@deepseek-ai'))
  if (found.get('@deepseek-ai/dsh-session')?.pkg.version !== '0.2.0-rc.2' || found.get('@deepseek-ai/cordis')?.pkg.version !== '4.0.4') throw new Error('Actual DSH 0.2.0-rc.2 / Cordis 4.0.4 distribution is required')
  return found
}
export function dependencyDirectory(name) {
  const require = createRequire(join(project, 'package.json'))
  try { return dirname(require.resolve(`${name}/package.json`)) } catch {}
  // Existing DSH workspaces may expose peers only through pnpm's virtual store.
  const store = join(project, 'node_modules/.pnpm'), prefix = name.replace('/', '+') + '@'
  if (existsSync(store)) for (const entry of readdirSync(store).sort()) {
    const path = join(store, entry, 'node_modules', name)
    if (entry.startsWith(prefix) && existsSync(join(path, 'package.json'))) return path
  }
  throw new Error(`Missing development dependency ${name}; install package.json dependencies`)
}
