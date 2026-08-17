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
  // ONE worker, deliberately (T-62, round 43). Playwright's CDP mouse never
  // moves the real X pointer, so whenever a SECOND test's Electron window
  // maps over screen centre mid-drag, the display server's crossing event
  // lands as a document-level pointerout with the button down and ends the
  // gesture early (the T-55 mechanism, proven with an intruder harness).
  // drag.ts closes every window it can — but the crossing can land between
  // mouse.down() and the first processed move, before any drawn state
  // exists to poll, and that residue reproduced ~2 in 9 loaded runs. One
  // window at a time removes the trigger outright (25/25 and 2/2 controls
  // green). Cost: ~4 min instead of ~2.7 for the full suite. Do not raise
  // this without re-reading T-55/T-62 in docs/TICKETS.md.
  workers: 1,
  // E2E launches a real Electron process; allowing retries can hide flakes
  // that point at real start-up bugs. Tweak only if a flake is benign.
  retries: 0,
  reporter: [['list']]
})
