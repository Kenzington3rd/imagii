import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-47 — session continuity: close the app, reopen where you were.
 *
 * The owner's directive is that reopening imagii OFFERS to continue exactly
 * where the user was, and never forces it. So the spec is written around
 * both halves: one test drives a real two-studio session through a window
 * close and back, and one proves that declining the offer leaves a
 * fresh-start session completely untouched.
 *
 * What the ticket's gap looked like before this landed, all of it asserted
 * here as a positive now:
 *   - the snapshot recorded DATA but no PLACE, so restore landed on Home
 *     with the selections and the playhead gone;
 *   - the last few seconds of work missed the 5 s debounce, so quitting
 *     right after an edit offered a snapshot that predated it;
 *   - the window forgot its size and position between launches.
 *
 * Non-goals, deliberately not tested here because they are not restored:
 * an in-flight export or recording does not survive a restart (both are
 * cancelled/reaped on quit — see the before-quit handler and record.spec),
 * and References search results are network state that is never persisted.
 *
 * House patterns come from home-chrome.spec.ts (hermetic userData seeded
 * before launch, assertions that land on the FILE) and record.spec.ts (a
 * second launch on the same userData; main-process work driven through
 * `app.evaluate`).
 */

const ALL_TUTORIALS_SEEN = { video: true, audio: true, image: true, ai: true }

/** Half a frame at the fixture's 15 fps — the whole suite's seek tolerance. */
const SEEK_TOLERANCE = 0.034

/** The geometry the user "leaves" the window at in the continuity test. */
const CHOSEN_BOUNDS = { x: 60, y: 50, width: 1120, height: 760 }

interface StoredConfig {
  welcomeSeen?: boolean
  windowBounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

function seedUserData(userDataDir: string, config: unknown): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
}

function readConfig(userDataDir: string): StoredConfig {
  const file = path.join(userDataDir, 'config.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoredConfig
  } catch {
    // A read landing mid-write reads as "not yet" rather than throwing.
    return {}
  }
}

function autosaveFile(userDataDir: string): string {
  return path.join(userDataDir, 'autosave', 'autosave.json')
}

interface SnapshotClip {
  id: string
  name: string
}

interface SnapshotOnDisk {
  schemaVersion?: number
  place?: {
    route?: string
    videoClipId?: string
    canvasLayerId?: string
    referencesTab?: string
    videoTimeSec?: number
  }
  videoStudio?: { clips?: SnapshotClip[]; selectedClipId?: string | null }
  imageCanvas?: { doc?: { layers?: Array<{ id: string; name: string }> } }
}

/** The autosave file exactly as the next launch would read it. */
function readSnapshot(userDataDir: string): SnapshotOnDisk | null {
  const file = autosaveFile(userDataDir)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SnapshotOnDisk
  } catch {
    return null
  }
}

/** Write a snapshot straight into the dir main/autosave.ts reads from. */
function seedAutosave(userDataDir: string, contents: unknown): void {
  mkdirSync(path.join(userDataDir, 'autosave'), { recursive: true })
  writeFileSync(
    autosaveFile(userDataDir),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8'
  )
}

/** A rect layer in the exact shape canvasStore.makeRectLayer produces. */
function rectLayer(name: string): Record<string, unknown> {
  return {
    id: 'seedrect',
    type: 'rect',
    name,
    visible: true,
    locked: false,
    x: 40,
    y: 40,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    width: 200,
    height: 120,
    fill: 'rgba(255,49,49,0.4)',
    stroke: '#ff3131',
    strokeWidth: 2,
    cornerRadius: 8
  }
}

/** Passes shared/projectValidation and is fresh enough to be offered. */
function canvasProject(layerName: string, place: unknown): Record<string, unknown> {
  return {
    schemaVersion: 3,
    savedAt: Date.now(),
    appVersion: '1.0.0',
    place,
    imageCanvas: {
      doc: { width: 1200, height: 800, background: '#ffffff', layers: [rectLayer(layerName)] }
    }
  }
}

function runBinary(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** Tiny real mp4, generated by the repo's own bundled ffmpeg. */
async function makeFixtureMp4(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x240:rate=15:duration=2',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
  if (!existsSync(mainEntry)) {
    throw new Error(
      `out/main/index.js missing. Run \`npm run build\` before \`npm run test:e2e\`. Checked: ${mainEntry}`
    )
  }
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
}

async function waitForHome(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
}

function makeRoot(label: string): string {
  return path.join(os.tmpdir(), `imagii-e2e-${label}-${Date.now().toString(36)}`)
}

function cleanup(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

function windowBounds(app: ElectronApplication): Promise<Bounds> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('no window')
    return win.getBounds()
  })
}

/** The work area of the display the window opened on. */
function primaryWorkArea(app: ElectronApplication): Promise<Bounds> {
  return app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
}

async function setWindowBounds(app: ElectronApplication, bounds: Bounds): Promise<void> {
  await app.evaluate(({ BrowserWindow }, b) => {
    BrowserWindow.getAllWindows()[0]?.setBounds(b)
  }, bounds)
}

/**
 * Close the window the way the X button does — the path where the renderer
 * is still alive at `close` and gone by `before-quit`, which is exactly why
 * the quit flush has to hook both.
 */
async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await app
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    .catch(() => {
      /* the app may already be on its way out */
    })
  await closed
}

/** The media element's own playhead — where the video actually is. */
function playhead(window: Page): Promise<number> {
  return window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement }).__imagiiVideoEl
    return v ? v.currentTime : -1
  })
}

/** The clip row the studio is showing as selected. */
function selectedClipRow(window: Page): ReturnType<Page['locator']> {
  return window.locator('li.border-accent')
}

async function goHome(window: Page): Promise<void> {
  await window.locator('a[href="#/home"]').first().click()
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
}

test.describe('T-47 session continuity', () => {
  test('two studios, a window close, and a relaunch that offers the whole session back', async () => {
    test.setTimeout(240_000)
    const root = makeRoot('continuity')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'continuity-source.mp4')
    await makeFixtureMp4(fixture)
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: ALL_TUTORIALS_SEEN,
      recentFiles: { video: [fixture] }
    })

    let parkedAt = 0
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // The user drags the window to a size they like.
      await setWindowBounds(app, CHOSEN_BOUNDS)

      // ── real work in Video Studio ──
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await window.getByRole('button', { name: 'Recent (1)' }).click()
      await window.getByRole('button', { name: /continuity-source\.mp4/ }).click()
      await expect(window.getByRole('heading', { name: 'Clips (1)', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await window.getByRole('button', { name: '+ Add clip' }).click()
      await expect(window.getByRole('heading', { name: 'Clips (2)', exact: true })).toBeVisible()

      // ── a tab chosen in References ──
      await goHome(window)
      await window.locator('a', { hasText: 'References' }).first().click()
      await window.getByRole('button', { name: 'Asset Library' }).click()
      await expect(window.getByText(/Curated assets shipped with imagii/)).toBeVisible({
        timeout: 20_000
      })

      // ── and a layer on the canvas ──
      await goHome(window)
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      // Adding a layer selects it; the Properties panel only renders for a
      // selected layer, so its presence IS the selection.
      await expect(window.getByText('Properties')).toBeVisible()

      // ── back to the studio they were last in ──
      await goHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 20_000 })

      // …and a playhead parked mid-file, by scrubbing the timeline. Parked
      // here rather than before the walk through the other studios because
      // leaving and returning legitimately rewinds it (T-52): the position
      // this session ends on is the one continuity has to bring back.
      const track = window.locator('[data-tutorial="video-timeline"] .relative.h-12')
      const box = await track.boundingBox()
      if (!box) throw new Error('timeline track has no box')
      await window.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
      await expect.poll(() => playhead(window), { timeout: 15_000 }).toBeGreaterThan(0.5)

      // The debounced autosave lands, and already carries the place record.
      await expect
        .poll(() => readSnapshot(userDataDir)?.videoStudio?.clips?.length, {
          timeout: 30_000,
          intervals: [500]
        })
        .toBe(2)
      const debounced = readSnapshot(userDataDir)
      expect(debounced?.schemaVersion).toBe(3)
      expect(debounced?.place?.route).toBe('/video')

      // ── the last few seconds: an edit and a selection, then quit at once ──
      await window.getByRole('button', { name: '+ Add clip' }).click()
      await expect(window.getByRole('heading', { name: 'Clips (3)', exact: true })).toBeVisible()
      await window.getByRole('button', { name: 'Select clip Clip 1' }).click()
      await expect(selectedClipRow(window).getByLabel('Rename clip Clip 1')).toBeVisible()
      parkedAt = await playhead(window)
      expect(parkedAt).toBeGreaterThan(0.5)

      // No wait for another debounce tick — this is the window X, and the
      // flush on the close path is the only thing that can catch up.
      await closeWindow(app)

      // ── what the quit wrote ──
      const snapshot = readSnapshot(userDataDir)
      expect(snapshot?.videoStudio?.clips).toHaveLength(3)
      const clipOne = snapshot?.videoStudio?.clips?.find((c) => c.name === 'Clip 1')
      expect(clipOne).toBeDefined()
      expect(snapshot?.place?.route).toBe('/video')
      expect(snapshot?.place?.videoClipId).toBe(clipOne?.id)
      expect(snapshot?.place?.referencesTab).toBe('assets')
      expect(snapshot?.place?.canvasLayerId).toBe(
        snapshot?.imageCanvas?.doc?.layers?.[0]?.id
      )
      expect(snapshot?.place?.videoTimeSec ?? -1).toBeCloseTo(parkedAt, 3)

      // ── and what the window itself remembered ──
      expect(readConfig(userDataDir).windowBounds).toEqual({ ...CHOSEN_BOUNDS, maximized: false })
    } finally {
      await app.close().catch(() => undefined)
    }

    // ── second launch on the SAME userData ──
    const app2 = await launchApp(userDataDir)
    try {
      const window = await app2.firstWindow()
      await waitForHome(window)

      // Window geometry comes back regardless of what the user does with
      // the banner — it is not part of the opt-in offer.
      expect(await windowBounds(app2)).toEqual(CHOSEN_BOUNDS)

      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Restore' }).click()
      await expect(window.getByText('Restored from autosave')).toBeVisible({ timeout: 20_000 })

      // 1. The ROUTE: the app took them back into the studio they left.
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 20_000 })
      // 2. The WORK, including the edit made in the last second before quit.
      await expect(window.getByRole('heading', { name: 'Clips (3)', exact: true })).toBeVisible({
        timeout: 20_000
      })
      // 3. The SELECTION — Clip 1, not the studio's default of the newest.
      await expect(selectedClipRow(window).getByLabel('Rename clip Clip 1')).toBeVisible()
      // 4. The PLAYHEAD, landed on the media element within half a frame.
      await expect
        .poll(() => playhead(window), { timeout: 20_000, intervals: [250] })
        .toBeGreaterThan(parkedAt - SEEK_TOLERANCE)
      expect(Math.abs((await playhead(window)) - parkedAt)).toBeLessThan(SEEK_TOLERANCE)

      // 5. Nothing to undo. A restore is an open-a-file, not an edit: the
      //    app must never come back offering to revert the work it just
      //    handed over (the canvas restore used to push a history step, so
      //    one click of Home's global Undo threw the session away).
      await goHome(window)
      await expect(window.getByText('last: no recent change')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeDisabled()

      // 6. The canvas came back WITH its selection.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Properties')).toBeVisible()

      // 7. And References is on the tab they left it on.
      await goHome(window)
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(window.getByText(/Curated assets shipped with imagii/)).toBeVisible({
        timeout: 20_000
      })
    } finally {
      await app2.close().catch(() => undefined)
      cleanup(root)
    }
  })

  test('quitting the APP, not the window, takes the same final snapshot', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('continuity-appquit')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      // Nothing on disk yet: the debounce is 5 s and this is second one.
      expect(readSnapshot(userDataDir)).toBeNull()
    } finally {
      // `app.close()` runs `app.quit()` in main — the OTHER exit, where the
      // window is still up when before-quit fires. The window-close path is
      // covered by the continuity test above; both have to work, because
      // neither fires on the other's route out.
      await app.close().catch(() => undefined)
    }

    const snapshot = readSnapshot(userDataDir)
    expect(snapshot?.imageCanvas?.doc?.layers).toHaveLength(1)
    expect(snapshot?.place?.route).toBe('/image')
    expect(snapshot?.place?.canvasLayerId).toBe(snapshot?.imageCanvas?.doc?.layers?.[0]?.id)
    cleanup(root)
  })

  test('Later and Discard leave a fresh-start session untouched — continuity is opt-in', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('continuity-declined')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    // A snapshot whose place points somewhere else entirely: if declining
    // leaked any part of it, this is the route, tab and selection that
    // would show up.
    seedAutosave(
      userDataDir,
      canvasProject('Declined rect', {
        route: '/image',
        canvasLayerId: 'seedrect',
        referencesTab: 'assets',
        videoTimeSec: 1.2
      })
    )

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      /** Nothing from the snapshot is anywhere in this session. */
      const expectFreshSession = async (): Promise<void> => {
        await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
        await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
        await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
        await expect(window.getByText('Declined rect')).toHaveCount(0)
        await expect(window.getByText('Properties')).toHaveCount(0)
        await goHome(window)
        await window.locator('a', { hasText: 'References' }).first().click()
        // The default tab, not the snapshot's Asset Library.
        await expect(
          window.getByPlaceholder(/Search for inspiration/)
        ).toBeVisible({ timeout: 20_000 })
        await expect(window.getByText(/Curated assets shipped with imagii/)).toHaveCount(0)
        await goHome(window)
      }

      // ── Later ──
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Later' }).click()
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      await expectFreshSession()
      // The offer is still on disk for next time — Later is not a delete.
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)

      // ── Discard ──
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Discard' }).click()
      await expect
        .poll(() => existsSync(autosaveFile(userDataDir)), { timeout: 20_000, intervals: [250] })
        .toBe(false)
      await expectFreshSession()
    } finally {
      await app.close().catch(() => undefined)
      cleanup(root)
    }
  })

  test('a corrupt place record degrades to the data-only restore, never a crash', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('continuity-badplace')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    // Every field wrong in a different way: a route that is not a route, a
    // structured object where an id belongs, an unknown tab, a playhead
    // that is a string. The work — one canvas layer — is perfectly good.
    seedAutosave(
      userDataDir,
      canvasProject('Salvaged rect', {
        route: '/../etc/passwd',
        canvasLayerId: { id: 'seedrect' },
        referencesTab: 'billing',
        videoTimeSec: 'soon'
      })
    )

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      // The snapshot still validates, so the restore is still OFFERED —
      // the corruption banner is for a file whose DATA failed, and this
      // one's data is fine.
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText(/but failed validation/)).toHaveCount(0)

      await window.getByRole('button', { name: 'Restore' }).click()
      await expect(window.getByText('Restored from autosave')).toBeVisible({ timeout: 20_000 })

      // Degraded, not crashed: the bad route is dropped, so the restore
      // behaves exactly as it did before T-47 — the user stays on Home.
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
      // …and the WORK came back in full, which is the point.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Salvaged rect')).toBeVisible()
      // The malformed layer id selected nothing rather than the wrong thing.
      await expect(window.getByText('Properties')).toHaveCount(0)
      // The unknown tab left References on its default.
      await goHome(window)
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(window.getByPlaceholder(/Search for inspiration/)).toBeVisible({
        timeout: 20_000
      })
    } finally {
      await app.close().catch(() => undefined)
      cleanup(root)
    }
  })

  test('bounds saved on a display that is gone reopen centered, not off-screen', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('continuity-bounds')
    const userDataDir = path.join(root, 'userData')
    // The shape a second monitor leaves behind after it is unplugged: a
    // perfectly well-formed rectangle that is nowhere near this screen.
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: ALL_TUTORIALS_SEEN,
      windowBounds: { x: 9000, y: 9000, width: 1180, height: 720, maximized: false }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      const bounds = await windowBounds(app)
      const work = await primaryWorkArea(app)
      // The SIZE the user chose survives — it is still a good size.
      expect(bounds.width).toBe(1180)
      expect(bounds.height).toBe(720)
      // The position does not: the window is on the primary display, where
      // the user can actually reach it.
      expect(bounds.x).toBeGreaterThanOrEqual(work.x)
      expect(bounds.y).toBeGreaterThanOrEqual(work.y)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(work.x + work.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(work.y + work.height)
    } finally {
      await app.close().catch(() => undefined)
      cleanup(root)
    }
  })
})
