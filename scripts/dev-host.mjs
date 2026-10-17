import { resolve, dirname, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const host = resolve(process.env.DSH_HOST_ROOT || join(project, '../host-gpt-candidate'))
export const hostModules = resolve(process.env.DSH_HOST_NODE_MODULES || join(host, 'node_modules'))
export const hostPackages = ['packages/core/agent', 'packages/core/agent-loop', 'packages/core/session',
  'packages/core/system-prompt', 'packages/llm/llm', 'packages/compaction/compaction-basic',
  'packages/shell/shell', 'packages/shell/bash-local', 'packages/shell/pwsh-local',
  'packages/fs/fs', 'packages/fs/fs-local', 'packages/fs/fs-sandbox', 'packages/session/session-persistence-jsonl']
export function assertHostSource() {
  const file = join(host, 'packages/core/session/package.json')
  if (!existsSync(file) || JSON.parse(readFileSync(file, 'utf8')).version !== '0.2.1-rc.2') throw new Error('DSH_HOST_ROOT must name independently patched DSH 0.2.1-rc.2 source; older RC2 is unsupported')
}
export function actualHostPackages() {
  const found = new Map()
  function inspect(directory) {
    const file = join(directory, 'package.json')
    if (!existsSync(file)) return
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (pkg.name?.startsWith('@deepseek-ai/')) found.set(pkg.name, { directory: realpathSync(directory), pkg })
  }
  for (const group of readdirSync(join(host, 'packages'))) {
    const parent = join(host, 'packages', group)
    try { for (const name of readdirSync(parent)) inspect(join(parent, name)) } catch {}
  }
  for (const name of readdirSync(join(host, 'vendor'))) inspect(join(host, 'vendor', name))
  for (const name of readdirSync(join(host, 'apps'))) inspect(join(host, 'apps', name))
  inspect(join(host, 'native/system'))
  for (const name of readdirSync(join(host, 'native/system/packages'))) inspect(join(host, 'native/system/packages', name))
  if (found.get('@deepseek-ai/dsh-session')?.pkg.version !== '0.2.1-rc.2' || found.get('@deepseek-ai/cordis')?.pkg.version !== '4.0.5') throw new Error('Exact DSH 0.2.1-rc.2 / Cordis 4.0.5 source distribution required')
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
