import { defineConfig } from 'vitest/config'
import ts from 'typescript'
import { resolve } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'

const host = resolve(import.meta.dirname, '../host-gpt-candidate')
const primitives = resolve(host, 'packages/client/ui-primitives/src')
const primitiveRequire = createRequire(resolve(host, 'packages/client/ui-primitives/package.json'))
const hostRequire = createRequire(resolve(host, 'package.json'))
const { paths } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'tsconfig.compat02.json'), 'utf8')).compilerOptions
// The published Cordis package erases this const enum. Match TypeScript's
// compile-time inlining when Vitest mixes patched source with published SDKs.
const fiberDeclaration = readFileSync(resolve(import.meta.dirname, 'node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts'), 'utf8')
const fiberEnum = /export declare const enum FiberState\s*\{([^}]+)\}/.exec(fiberDeclaration)?.[1]
if (!fiberEnum) throw new Error('Installed Cordis FiberState declaration not found')
const fiberStates = Object.fromEntries([...fiberEnum.matchAll(/(\w+)\s*=\s*(\d+)/g)].map(([, name, value]) => [name, value]))
const sourceAliases = Object.entries(paths).map(([name, values]) => ({
  find: new RegExp('^' + name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.+)') + '$'),
  replacement: (values as string[])[0]!.replace('*', '$1'),
}))
export default defineConfig({
  plugins: [
    // These component suites consume only Button/Input. Re-export the actual
    // RC2 source atoms without loading unrelated, browser-bundled highlighters.
    { name: 'official-primitives-under-test', enforce: 'pre', resolveId(id) {
      if (id === 'virtual:official-primitives-under-test') return '\0official-primitives-under-test'
    }, load(id) {
      if (id === '\0official-primitives-under-test') return `export { Button } from ${JSON.stringify(resolve(primitives, 'Button.tsx'))}; export { Input } from ${JSON.stringify(resolve(primitives, 'Input.tsx'))};`
    } },
    { name: 'published-cordis-const-enum', enforce: 'pre', transform(code, id) {
      if (!/\.[cm]?tsx?$/.test(id.split('?')[0]!) || !/from ['"]@deepseek-ai\/cordis['"]/.test(code)) return
      if (!code.includes('FiberState.')) return
      return code.replace(/\bFiberState\.(\w+)\b/g, (_, name: string) => {
        if (fiberStates[name] === undefined) throw new Error(`Unknown Cordis FiberState.${name}`)
        return fiberStates[name]!
      }).replace(/\bFiberState\s*,\s*/g, '').replace(/,\s*FiberState(?=\s*})/g, '')
    } },
    { name: 'standard-decorators', enforce: 'pre', transform(code, id) {
      const file = id.split('?')[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !/^\s*@[A-Za-z_$]/m.test(code)) return
      const output = ts.transpileModule(code, { fileName: file, compilerOptions: {
        target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, sourceMap: true,
      } })
      return { code: output.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'), map: output.sourceMapText }
    } },
  ],
  resolve: { dedupe: ['react', 'react-dom'], alias: [...sourceAliases,
    // The source agent loop and this fixture must share the published scheduler
    // Symbol and Cordis runtime. A local peer copy is not the same module as the
    // host's pnpm copy, even when their versions and bytes match.
    { find: /^@deepseek-ai\/dsh-tools$/, replacement: hostRequire.resolve('@deepseek-ai/dsh-tools') },
    { find: /^@deepseek-ai\/cordis$/, replacement: hostRequire.resolve('@deepseek-ai/cordis') },
    { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: 'virtual:official-primitives-under-test' },
    { find: 'clsx', replacement: primitiveRequire.resolve('clsx') },
    { find: '@dsh-test/mock-adapter', replacement: resolve(host, 'packages/core/agent-loop/tests/mock-adapter.ts') },
    { find: '@dsh-test/memory-settings', replacement: resolve(host, 'packages/settings/settings/tests/memory.ts') },
    { find: '@dsh-test/live-config', replacement: resolve(host, 'packages/settings/settings/tests/live-config.ts') },
  ] },
  test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], testTimeout: 20000, hookTimeout: 20000,
    server: { deps: { inline: [/@deepseek-ai[\\/]dsh-/] } },
    execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
  },
})
