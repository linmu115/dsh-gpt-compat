import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// @ts-ignore JavaScript development helper; not shipped in the plugin.
import { host, dependencyDirectory } from './scripts/dev-host.mjs'

export default defineConfig(async () => {
  const { standardDecoratorPlugin } = await import(pathToFileURL(resolve(host, 'vitest.shared.ts')).href)
  return {
    plugins: [standardDecoratorPlugin(), tsconfigPaths({ projects: ['./tsconfig.test.json', resolve(host, 'tsconfig.base.json')] })],
    resolve: { alias: {
      react: dependencyDirectory('react'),
      'react-dom': dependencyDirectory('react-dom'),
      '@testing-library/react': resolve(dependencyDirectory('@testing-library/react'), 'dist/index.js'),
      '@dsh-test/mock-adapter': resolve(host, 'packages/core/agent-loop/tests/mock-adapter.ts'),
      '@dsh-test/memory-settings': resolve(host, 'packages/settings/settings/tests/memory.ts'),
    } },
    test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], testTimeout: 20000, hookTimeout: 20000 },
  }
})
