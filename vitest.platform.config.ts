import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/local-cpa*.spec.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
  },
})
