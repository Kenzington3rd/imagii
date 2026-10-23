import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { pathToImagiiFileUrl } from '../../src/shared/fileUrl'

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

      // ── imagii-file:// protocol round-trip (2026-08-14 regression) ──
      // Media loading was 100% broken in the shipped app because the URL
      // builder and the protocol handler disagreed about where the path
      // lived inside the URL; every request 403'd. Unit tests pin the
      // pure round-trip; THIS block proves it inside real Chromium —
      // its URL canonicalization, the privileged scheme registration,
      // CSP (connect-src includes imagii-file:), the handler, and
      // net.fetch — by fetching a real file and checking the bytes.
      // A filename with spaces + '#' covers the fragment-truncation bug.
      const mediaFixture = path.join(userDataDir, 'protocol fixture #1.bin')
      const fixtureBytes = Buffer.from('imagii-protocol-roundtrip-fixture-2026')
      writeFileSync(mediaFixture, fixtureBytes)
      const fetched = await window.evaluate(async (url: string) => {
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        return { status: res.status, bytes: buf.byteLength }
      }, pathToImagiiFileUrl(mediaFixture))
      expect(fetched.status).toBe(200)
      expect(fetched.bytes).toBe(fixtureBytes.byteLength)

      // And the safety guard still holds: a traversal path the builder
      // would never produce must be refused, not fetched.
      const traversal = await window.evaluate(async (url: string) => {
        const res = await fetch(url)
        return res.status
      }, `imagii-file://local/${encodeURIComponent('/etc/../etc/passwd')}`)
      expect(traversal).toBe(403)
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

  // T-126 (18): the guides name Inter and nothing shipped it, so a stock Windows machine drew Segoe UI. @fontsource/inter's latin 400, 500
  // and 600 are imported by the renderer entry and the build emits the files beside the page. Two things are read here, in the BUILT app:
  // the style sheets in out/ (every url() is a file the build holds: nothing remote, no @import), and the page's own FontFaces. The
  // `document.fonts.check` the ticket names is TRUE for a family nothing defines (the spec's "no matching face" answer), so on its own it
  // passes on the unfixed build; `fonts.load` returns the faces that matched, and an empty list is the unfixed build.
  test('Inter is bundled: the built style sheets request only files the build holds, and the page loads all three weights from them (T-126 (18))', async () => {
    const assets = path.resolve(__dirname, '../../out/renderer/assets')
    expect(existsSync(assets), 'the build has its assets folder (run `npm run build`)').toBe(true)
    const sheets = readdirSync(assets).filter((f) => f.endsWith('.css'))
    expect(sheets.length, 'the build has a style sheet').toBeGreaterThan(0)
    const urls: string[] = []
    for (const sheet of sheets) {
      const css = readFileSync(path.join(assets, sheet), 'utf8')
      expect(css, `${sheet} @imports nothing`).not.toMatch(/@import\b/i)
      for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) urls.push(m[2] as string)
    }
    for (const url of urls) {
      if (url.startsWith('data:') || url.startsWith('#')) continue
      expect(url, `url(${url}) names no scheme and no host`).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i)
      expect(existsSync(path.resolve(assets, url)), `url(${url}) is a file in the build`).toBe(true)
    }
    const fonts = urls.filter((u) => /inter-latin-(?:400|500|600)-normal-[\w-]+\.woff2$/.test(u))
    expect(fonts.length, 'the three weights are in the built sheet').toBe(3)
    // T-128 (2): and woff2 ALONE. The package's own css listed a .woff after each, which Chromium 126 never requests: the build emitted three
    // files (93 KB) that nothing could load. The sheet names no .woff and the assets folder holds none.
    expect(urls.filter((u) => /\.woff(?![\w])/.test(u)), 'no sheet names a .woff (woff2 alone)').toEqual([])
    expect(readdirSync(assets).filter((f) => /\.woff$/.test(f)), 'the build holds no .woff file').toEqual([])
    expect(readdirSync(assets).filter((f) => f.endsWith('.woff2')).length, 'and exactly the three woff2 files').toBe(3)

    const userDataDir = path.join(os.tmpdir(), `imagii-e2e-font-${Date.now().toString(36)}`)
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ welcomeSeen: true, tutorialSeen: { video: true, audio: true, image: true, ai: true } }),
      'utf8'
    )
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
      for (const weight of [400, 500, 600]) {
        const result = await window.evaluate(async (w) => {
          const matched = await document.fonts.load(`${w} 12px Inter`)
          return {
            faces: matched.map((f) => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, status: f.status })),
            check: document.fonts.check(`${w} 12px Inter`)
          }
        }, weight)
        expect(result.faces.length, `a face matches ${weight} 12px Inter (none: the page defines no Inter)`).toBeGreaterThan(0)
        for (const face of result.faces) {
          expect(face.family).toBe('Inter')
          expect(face.status, `Inter ${face.weight} loaded from the build`).toBe('loaded')
        }
        expect(result.faces.map((f) => f.weight), `the ${weight} face is among them`).toContain(String(weight))
        expect(result.check, `document.fonts.check(${weight} 12px Inter)`).toBe(true)
      }
      // And the page draws with it: the first family of the body is Inter.
      expect(await window.evaluate(() => getComputedStyle(document.body).fontFamily.split(',')[0]?.trim().replace(/["']/g, ''))).toBe('Inter')
    } finally {
      await app.close()
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  // T-127 (1): README says the app "makes zero network requests on startup"; until this test nothing held the claim, and it was false. The
  // built app was launched with Chromium's net-log and left idle: it fetched Electron's spellcheck dictionary from redirector.gvt1.com on
  // every launch, and, on a machine whose DNS is a DNS-over-HTTPS provider (8.8.8.8, 1.1.1.1), probed dns.google a dozen times in the
  // first half minute (the first probe ~5 s after launch, so the idle below is longer than that). Both are the platform's own traffic, which
  // no source scan can see (networkAllowlist.test.ts, WHAT IT CANNOT SEE), so this reads what the network stack actually did: every
  // URL_REQUEST the log began (an http, https, ws, wss or ftp one is the failure) and every host the resolver was asked for.
  //
  // The control keeps the assertion from being vacuous: after the idle the MAIN process fetches one loopback URL, and the log must hold
  // exactly that request and nothing else. A log that records nothing, or a parse that finds nothing, fails the control instead of
  // passing "zero". The DoH leg of the red only shows where the machine's resolver is a DoH-capable provider; the dictionary leg shows
  // anywhere, and `interactionWiring.test.ts` pins both calls on every machine.
  test('the built app makes no network request: a launch left idle past ready logs no http(s) or ws request and no DNS lookup of a remote host (T-127 (1))', async () => {
    const userDataDir = path.join(os.tmpdir(), `imagii-e2e-netlog-${Date.now().toString(36)}`)
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({ welcomeSeen: true, tutorialSeen: { video: true, audio: true, image: true, ai: true } }),
      'utf8'
    )
    const logFile = path.join(userDataDir, 'net.json')
    const server = http.createServer((_req, res) => res.end('control'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const control = `http://127.0.0.1:${(server.address() as { port: number }).port}/net-log-control`
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`, `--log-net-log=${logFile}`, '--net-log-capture-mode=Everything'],
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
    })
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
      await window.waitForTimeout(8_000)
      // The control: a request the network stack certainly makes.
      const body = await app.evaluate(async ({ net }, url) => (await net.fetch(url)).text(), control)
      expect(body).toBe('control')
    } finally {
      // The log is a complete JSON document only once the app has shut down.
      await app.close()
      server.close()
    }
    try {
      const log = JSON.parse(readFileSync(logFile, 'utf8')) as {
        constants: { logEventTypes: Record<string, number> }
        events: Array<{ type: number; phase: number; params?: { url?: string; host?: string } }>
      }
      const typeId = (name: string): number => {
        const id = log.constants.logEventTypes[name]
        expect(id, `the log knows an event type ${name}`).toBeDefined()
        return id as number
      }
      const startJob = typeId('URL_REQUEST_START_JOB')
      const resolverRequest = typeId('HOST_RESOLVER_MANAGER_REQUEST')
      // (A DNS-over-HTTPS probe carries its whole query in the URL: the failure message names the address, not the packet.)
      const requested = log.events.filter((e) => e.type === startJob && e.params?.url).map((e) => (e.params?.url as string).split('?')[0] as string)
      const network = requested.filter((u) => /^(?:https?|wss?|ftps?):\/\//i.test(u))
      // Exactly the control: proves the log sees a request, and that the launch itself made none.
      expect(network, 'every http(s) / ws / ftp request the app began (only the loopback control is allowed)').toEqual([control])
      // And no lookup of a name that is not this machine (a DNS-over-HTTPS probe or a download is a lookup before it is a request).
      const lookedUp = log.events
        .filter((e) => e.type === resolverRequest && e.phase === 1 && e.params?.host)
        .map((e) => (e.params?.host as string).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, ''))
      expect(
        lookedUp.filter((h) => !['127.0.0.1', 'localhost', '::1'].includes(h.toLowerCase())),
        'hosts the resolver was asked for, other than this machine'
      ).toEqual([])
    } finally {
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
})
