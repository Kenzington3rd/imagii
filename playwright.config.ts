import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for imagii's Electron end-to-end smoke layer.
 *
 * The Electron driver is used directly inside each spec (no `projects` array,
 * no `webServer` block) because the app isn't a web app. The build must
 * produce `out/main/index.js` BEFORE running `npx playwright test` — wired
 * through `npm run test:e2e:build`.
 *
 * Why a generous timeout: Electron cold-start on a CI box can take 20-30s
 * just to reach `ready-to-show`, and the smoke spec walks all five studios
 * in one launch. 60s gives plenty of headroom without masking a real hang.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // 60s per test — see header comment.
  timeout: 60_000,
  fullyParallel: false,
  // E2E launches a real Electron process; allowing retries can hide flakes
  // that point at real start-up bugs. Tweak only if a flake is benign.
  retries: 0,
  reporter: [['list']]
})
