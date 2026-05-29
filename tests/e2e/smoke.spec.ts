import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Round 17 phase-7: Electron end-to-end smoke test.
 *
 * Launches the built app, bypasses the Welcome screen by pre-seeding
 * electron-store's `welcomeSeen: true` in a dedicated userData directory,
 * then walks every studio via its NavCard. A screenshot lands in
 * tests/e2e/screenshots/ for each one so a CI run leaves visual evidence.
 *
 * Why a custom userDataDir: pre-seeding `welcomeSeen` avoids the Welcome
 * screen's two-click intro and keeps every run hermetic regardless of
 * what's in the developer's real userData.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

const STUDIOS = [
  { name: 'Record', heading: /record/i },
  { name: 'Video Studio', heading: /video studio|video/i },
  { name: 'Audio Studio', heading: /audio/i },
  { name: 'Stream Graphics', heading: /image|graphics/i },
  { name: 'References', heading: /references/i }
]

test.describe('imagii Electron smoke', () => {
  test('launches, navigates every studio, screenshots each', async () => {
    if (!existsSync(SCREENSHOTS)) {
      mkdirSync(SCREENSHOTS, { recursive: true })
    }
    // Hermetic userData directory so this test never collides with the
    // developer's real app data. Includes a config.json with welcomeSeen
    // already true so the Home page renders immediately.
    const userDataDir = path.join(
      os.tmpdir(),
      `imagii-e2e-${Date.now().toString(36)}`
    )
    mkdirSync(userDataDir, { recursive: true })
    // Pre-seed every flag that triggers an overlay so the test never has
    // to dismiss one mid-click. Round 8/round 12 audits confirmed these
    // are the four tutorial flags + the welcome flag.
    // electron-store stores dotted keys as nested objects (the default
     // accessPropertiesByDotNotation = true), so flatten via JSON nesting.
    writeFileSync(
      path.join(userDataDir, 'config.json'),
      JSON.stringify(
        {
          welcomeSeen: true,
          tutorialSeen: {
            video: true,
            audio: true,
            image: true,
            ai: true
          }
        },
        null,
        2
      ),
      'utf8'
    )

    const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
    if (!existsSync(mainEntry)) {
      // Loud, actionable failure: tell the developer to build first.
      throw new Error(
        `out/main/index.js missing. Run \`npm run build\` before \`npm run test:e2e\`. Checked: ${mainEntry}`
      )
    }

    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1'
      }
    })

    try {
      const window = await app.firstWindow()
      // Wait for the renderer to paint past the initial loading state.
      await window.waitForLoadState('domcontentloaded')
      // The Home heading is "imagii" — short, stable, no emoji.
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({
        timeout: 30_000
      })

      // Assert all 5 NavCards render on Home.
      for (const studio of STUDIOS) {
        await expect(
          window.locator('a', { hasText: studio.name })
        ).toBeVisible()
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, '00-home.png') })

      // Walk each studio: click the NavCard, assert the route landed, take
      // a screenshot, then click the HomeLink back. The HomeLink is the
      // sticky chip in the top-left of every studio route.
      for (let i = 0; i < STUDIOS.length; i++) {
        const studio = STUDIOS[i]
        if (!studio) continue
        await window.locator('a', { hasText: studio.name }).first().click()
        // Each studio route is heavy; wait for a stable text node, then
        // screenshot. The HomeLink chip is "Home" or "imagii".
        await window.waitForTimeout(500)
        await window.screenshot({
          path: path.join(
            SCREENSHOTS,
            `${String(i + 1).padStart(2, '0')}-${studio.name.replace(/\s+/g, '-').toLowerCase()}.png`
          )
        })
        // A tutorial overlay sometimes covers the page on first visit
        // (the pre-seed flags don't cover every overlay state). Press
        // Escape so the overlay yields focus, then click HomeLink.
        await window.keyboard.press('Escape')
        await window.waitForTimeout(150)
        const home = window
          .locator('a[href="/home"], a[href="#/home"]')
          .first()
        // force:true bypasses any lingering pointer-events overlay so the
        // test can complete its walk even if a tutorial briefly flickers.
        await home.click({ force: true })
        await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({
          timeout: 10_000
        })
      }
    } finally {
      await app.close()
      // Clean up the hermetic userData directory.
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
})
