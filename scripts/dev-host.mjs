import { resolve, dirname, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
export const host = resolve(process.env.DSH_HOST_ROOT || '../deepseek-harness')
export function dependencyDirectory(name) {
  const require = createRequire(new URL('../package.json', import.meta.url))
  try { return dirname(require.resolve(`${name}/package.json`)) } catch {}
  // Existing DSH workspaces may expose peers only through pnpm's virtual store.
  const store = resolve('node_modules/.pnpm'), prefix = name.replace('/', '+') + '@'
  if (existsSync(store)) for (const entry of readdirSync(store).sort()) {
    const path = join(store, entry, 'node_modules', name)
    if (entry.startsWith(prefix) && existsSync(join(path, 'package.json'))) return path
  }
  throw new Error(`Missing development dependency ${name}; install package.json dependencies`)
}
