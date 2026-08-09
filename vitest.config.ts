import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    // tests/unit hosts cross-tree tests (e.g. main vs renderer preset-table
    // sync) that can't live inside either tsconfig project's file set.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    globals: false
  }
})
