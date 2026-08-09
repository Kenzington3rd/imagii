import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Layer 5 (round 18): real-media integration suite. Kept out of the default
// vitest config so `npm run verify` stays a ~10-second pre-commit pass —
// these tests spawn real ffmpeg/ffprobe processes and take ~1-2 minutes.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.spec.ts'],
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
