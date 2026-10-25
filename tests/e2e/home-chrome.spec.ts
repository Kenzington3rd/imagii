import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import { videoTutorial } from '../../src/renderer/src/tutorials/videoTutorial'
import { audioTutorial } from '../../src/renderer/src/tutorials/audioTutorial'
import { imageTutorial } from '../../src/renderer/src/tutorials/imageTutorial'
import { aiTutorial } from '../../src/renderer/src/tutorials/aiTutorial'
import type { TutorialDef } from '../../src/renderer/src/tutorials/types'
import { chooserCalls, recordSlowChooser } from './chooser'
import { installToastLog, readToastLog } from './toastLog'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-21: Home, Welcome, and the shared chrome — AutosaveRestore, Modal,
 * Tutorial, RecentFilesMenu, HotkeyOverlay — driven to their real end states
 * in the built app.
 *
 * House patterns come from export.spec.ts: a hermetic per-test userData dir
 * seeded on disk BEFORE launch, a MutationObserver toast log installed before
 * the action that raises the toast, and assertions that land on the FILE the
 * interaction wrote (config.json, autosave/autosave.json) rather than on
 * renderer state alone. "Persisted" is half of nearly every criterion in this
 * ticket, and only the file proves it.
 *
 * Six product defects were found while writing this spec. All six have since
 * been fixed and their contrast assertions here are positives now — the
 * defect each one used to pin is named at the assertion:
 *   A. [FIXED, T-31] Home never mounted <AppToaster/>, so every toast Home
 *      raises (Restore, Discard, project save/load, and all their error
 *      paths) was dispatched into a page that could not draw it. One
 *      app-level mount now serves every route.
 *   B. [FIXED, T-32] useGlobalUndo's tracker was scoped to Home's mount, so
 *      a change made inside a studio was never undoable from Home's global
 *      Undo button. The order is module-level now and survives routing.
 *   C. [FIXED, T-32] Home's Undo/Redo enablement was computed at render and
 *      the hook suppressed its own store event, so nothing re-rendered Home
 *      after the click and Redo stayed disabled after an Undo.
 *   D. [FIXED, T-33] AutosaveRestore's corruption branch required
 *      `info.ageMs`, which the reader never returned for a file that fails
 *      validation, so the Clear / Dismiss banner could not render (also
 *      pinned in tests/unit/autosaveCorruptInfo.test.ts).
 *   E. [FIXED, T-34] computeTooltipPosition clamped 'top'/'bottom' coachmarks
 *      to the viewport but not 'left'/'right', so the video tutorial's step 2
 *      rendered past the right edge of a 1280 px window and its buttons could
 *      not be clicked. One clamp covers all four placements now, and the
 *      dedicated clamp test below drives that step at 1280x800.
 *   F. [FIXED, T-34] Enter (with focus off a button) advanced the tutorial
 *      two steps; the handler preventDefaults the key it consumes.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

/** All four tutorial flags — the seed that keeps a coachmark off the page. */
const ALL_TUTORIALS_SEEN = { video: true, audio: true, image: true, ai: true }

/**
 * The video tour on an EMPTY studio (T-86): the centered cards, plus the
 * importer — the one target an empty studio has. Started from the '?' button;
 * the first-visit tour does not open on an empty studio at all.
 */
const EMPTY_VIDEO_TOUR = videoTutorial.steps.filter(
  (s) => s.targetSelector === undefined || s.targetSelector === '[data-tutorial="video-import"]'
)

interface SeedConfig {
  welcomeSeen?: boolean
  tutorialSeen?: Partial<Record<'video' | 'audio' | 'image' | 'ai', boolean>>
  recentFiles?: Partial<Record<'video' | 'audio' | 'image', string[]>>
}

interface StoredConfig {
  welcomeSeen?: boolean
  tutorialSeen?: Record<string, boolean>
  recentFiles?: Record<string, string[]>
}

/**
 * electron-store nests dotted keys (accessPropertiesByDotNotation defaults to
 * true), so the seed is written as nested objects — the same shape smoke.spec
 * and export.spec write.
 */
function seedUserData(userDataDir: string, config: SeedConfig): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf8'
  )
}

/** The settings file exactly as the next launch would read it. */
function readConfig(userDataDir: string): StoredConfig {
  const file = path.join(userDataDir, 'config.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoredConfig
  } catch {
    // A read landing mid-write reads as "not yet" rather than throwing; every
    // caller is inside expect.poll or a settled-state assertion.
    return {}
  }
}

function autosaveFile(userDataDir: string): string {
  return path.join(userDataDir, 'autosave', 'autosave.json')
}

/** Write an autosave straight into the dir main/autosave.ts reads from. */
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
function canvasProject(layerName: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    savedAt: Date.now(),
    appVersion: '1.0.0',
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

/** Tiny real mp4, generated by the repo's own bundled ffmpeg (export.spec pattern). */
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

/** Tiny real wav for the Audio Studio import. */
async function makeFixtureWav(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=2',
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

/**
 * Give the renderer an exact viewport by resizing the real BrowserWindow's
 * CONTENT area (video-core.spec.ts and image.spec.ts resize the same way; the
 * content variant is used here because the number under test is the one
 * `computeTooltipPosition` clamps against, `window.innerWidth`/`innerHeight`).
 * Polled, because the resize lands as an OS event the renderer sees a beat
 * later.
 */
async function setContentSize(
  app: ElectronApplication,
  window: Page,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('no BrowserWindow to resize')
      win.setContentSize(size.width, size.height)
    },
    { width, height }
  )
  await expect
    .poll(() => window.evaluate(() => `${globalThis.innerWidth}x${globalThis.innerHeight}`), {
      timeout: 15_000,
      intervals: [100]
    })
    .toBe(`${width}x${height}`)
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

/**
 * Drop a file on a zone the way Electron delivers a real OS drop: a File
 * carrying the absolute `path` expando. Same mechanism export.spec documents;
 * `zoneSelector` picks the studio.
 */
async function dropOnZone(
  window: Page,
  zoneSelector: string,
  filePath: string,
  fileName: string
): Promise<void> {
  await window.evaluate(
    ({ zoneSelector, filePath, fileName }) => {
      const zone = document.querySelector(zoneSelector)
      if (!zone) throw new Error(`drop zone not found: ${zoneSelector}`)
      const file = new File([new Uint8Array([0])], fileName, { type: '' })
      Object.defineProperty(file, 'path', { value: filePath })
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
      zone.dispatchEvent(event)
    },
    { zoneSelector, filePath, fileName }
  )
}

interface FocusInfo {
  tag: string | null
  label: string | null
  insideDialog: boolean
  dialogPresent: boolean
}

/** Where focus is, relative to the open dialog. */
function focusInfo(window: Page): Promise<FocusInfo> {
  return window.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    const dialog = document.querySelector('[role="dialog"]')
    return {
      tag: el ? el.tagName : null,
      label: el ? (el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40)) : null,
      insideDialog: Boolean(dialog && el && dialog.contains(el)),
      dialogPresent: Boolean(dialog)
    }
  })
}

/**
 * Where focus is relative to the COACHMARK specifically (T-64).
 *
 * `focusInfo` above takes the first `[role="dialog"]` on the page, which is
 * ambiguous the moment two are open. The coachmark is the one whose
 * aria-label names the tour, so address it by that.
 */
function coachmarkFocus(window: Page): Promise<{ inside: boolean; label: string | null }> {
  return window.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    const card = document.querySelector('[role="dialog"][aria-label*="tutorial"]')
    return {
      inside: Boolean(card && el && card.contains(el)),
      label: el
        ? (el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40))
        : null
    }
  })
}

/** The coachmark's current step number, read off its own counter. */
async function currentStep(window: Page): Promise<number> {
  const text = await window.locator('div[role="dialog"] span', { hasText: /· \d+ of \d+$/ }).first().textContent()
  const match = /· (\d+) of \d+$/.exec((text ?? '').trim())
  if (!match?.[1]) throw new Error(`tutorial step counter not found in: ${String(text)}`)
  return Number(match[1])
}

/**
 * T-125 (13): the background colors painted inside the toast bar that holds `message` - the status disc (the green tick of a success,
 * the red cross of an error) is one of them. react-hot-toast draws its own stock green and red unless `iconTheme` says otherwise.
 */
async function toastDiscColors(window: Page, message: string): Promise<string[]> {
  return window.evaluate((text) => {
    const status = Array.from(document.querySelectorAll('[data-rht-toaster] [role="status"]')).find((el) => (el.textContent ?? '').includes(text))
    const bar = status?.parentElement
    if (!bar) return []
    return Array.from(bar.querySelectorAll('*'))
      .map((el) => getComputedStyle(el).backgroundColor)
      .filter((c) => c !== 'rgba(0, 0, 0, 0)')
  }, message)
}

async function waitForHome(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
}

/** Per-test scratch root; every test owns its own userData directory. */
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

function ensureScreenshots(): void {
  if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
}

test.describe('T-21 Home, Welcome, and shared chrome', () => {
  test('Welcome "Let\'s go" writes welcomeSeen and hands off to Home', async () => {
    test.setTimeout(120_000)
    ensureScreenshots()
    const root = makeRoot('welcome')
    const userDataDir = path.join(root, 'userData')
    // No welcomeSeen seed: this is the ONE test that meets the Welcome screen
    // the way a first-run user does. Every other spec seeds past it.
    seedUserData(userDataDir, {})

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.locator('h1', { hasText: 'Hi Mike!' })).toBeVisible({ timeout: 30_000 })
      // T-85: "Everything runs locally" names its two exceptions.
      await expect(
        window.getByText(
          /Everything runs locally on your computer — no accounts, no subscriptions, no cloud — except Reference Search and the one-time caption model download, which go online\./
        )
      ).toBeVisible()
      // The version line is filled over IPC, so it also proves the preload
      // bridge is live on the very first screen the user ever sees.
      await expect(window.getByText(/^imagii v\d/)).toBeVisible({ timeout: 15_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-01-welcome.png') })

      await window.getByRole('button', { name: "Let's go" }).click()

      // 1. Home renders — the app left the welcome phase for real.
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()
      await expect(window.locator('h1', { hasText: 'Hi Mike!' })).toHaveCount(0)
      // T-85: Home's Record card says what it captures (and what it does not),
      // and its footer carries the same two exceptions as the welcome.
      await expect(
        window.getByText(
          'Record your screen or a window, with your webcam and mic, to one video file. Game and desktop sound are not captured.'
        )
      ).toBeVisible()
      await expect(window.getByText(/one-stop|alternative to OBS/)).toHaveCount(0)
      await expect(
        window.getByText(
          'imagii runs locally on your computer, except Reference Search and the one-time caption model download, which go online. No accounts. No subscriptions.'
        )
      ).toBeVisible()
      // 2. And the flag is on disk, so the next launch skips Welcome.
      await expect
        .poll(() => readConfig(userDataDir).welcomeSeen, { timeout: 15_000, intervals: [200] })
        .toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-128 (4), T-110 (x): the Welcome screen's button awaited the write of `welcomeSeen` BEFORE it let the person in, so a write main refused
  // (a full disk, a config it cannot replace) left "Let's go" doing nothing, with nothing said. Main's `settings:set` is made to refuse here
  // (the same ipcMain handler swapped in the running app; every other channel is the real one).
  test('Welcome "Let\'s go" still lets the person in when main refuses to remember it, and says so in one sentence (T-128 (4))', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('welcome-refused')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, {})

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await expect(window.locator('h1', { hasText: 'Hi Mike!' })).toBeVisible({ timeout: 30_000 })
      await installToastLog(window)
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('settings:set')
        ipcMain.handle('settings:set', () => {
          throw new Error('config write refused')
        })
      })

      await window.getByRole('button', { name: "Let's go" }).click()

      await expect(window.locator('h1', { hasText: 'imagii' }), 'the person is let in').toBeVisible({ timeout: 15_000 })
      await expect(window.locator('h1', { hasText: 'Hi Mike!' })).toHaveCount(0)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain("Couldn't save your settings.")
      expect(readConfig(userDataDir).welcomeSeen, 'and nothing was written: the next launch asks again').toBeUndefined()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('HotkeyOverlay: ? opens the route table, the Esc button and Escape both close it', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('hotkeys')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      // Closed until asked for.
      await expect(window.getByRole('dialog')).toHaveCount(0)

      await window.keyboard.press('?')
      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      // Home's rows, not another route's — shortcutsForRoute('/home').
      await expect(dialog.getByText('Open studio')).toBeVisible()
      // T-85: the row says what a project holds — not "full app state", which
      // left a user to assume their mood boards were in it.
      await expect(
        dialog.getByText('Save your project (studios and layout; mood boards live outside projects)')
      ).toBeVisible()
      await expect(dialog.getByText('Save full app state', { exact: false })).toHaveCount(0)
      await expect(dialog.getByText('Press Esc or ? to close.')).toBeVisible()

      // The overlay's own close control.
      await window.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // Reopen and close with Modal's Escape instead.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // T-72: and the third way out — `?` itself, which is what the panel
      // copy promises ("Press ? again to close."). The overlay renders a
      // Modal, so the "is a dialog open" guard added in T-72 has to exempt
      // the overlay's own; if it did not, this press would be swallowed and
      // the overlay would be stuck open behind its own guard.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  /**
   * T-73 — one Escape closes ONE dialog: the topmost.
   *
   * Every open dialog registered its own window keydown, and each one closed
   * on any Escape it saw. The only stack a user can actually build is this
   * one — the shortcuts overlay opened with `?` while a coachmark is up — and
   * on the unfixed build a single Escape closed BOTH, taking the tutorial the
   * user was reading with it. Each dialog claims a depth now (Modal and
   * Tutorial share the claim stack) and only the top of the stack answers
   * Escape.
   */
  test('T-73 Escape closes only the topmost dialog: the overlay goes, the coachmark stays', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('stacked-escape')
    const userDataDir = path.join(root, 'userData')
    // T-86: the first-visit tour waits for a video, so this one is started
    // from the '?' button on the empty studio — the claim stack under test is
    // the same however the coachmark got there.
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const total = EMPTY_VIDEO_TOUR.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await window.getByRole('button', { name: 'Show tutorial' }).click()

      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('dialog')).toHaveCount(1)

      // ── `?` stacks the shortcuts overlay over the coachmark ──
      // Reachable because the coachmark is not a <Modal>: openModalCount() is
      // still 0, which is exactly the shape T-72 left in place.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toHaveCount(2)
      const overlay = window.getByRole('dialog').filter({ hasText: 'Press Esc or ? to close.' })
      await expect(overlay).toHaveCount(1)
      // The topmost dialog is topmost on screen too, not dimmed under the
      // coachmark's scrim: its close control is what a click at its own
      // centre actually hits.
      const box = await overlay.getByRole('button', { name: 'Close' }).boundingBox()
      expect(box).not.toBeNull()
      if (!box) throw new Error('unreachable')
      const hit = await window.evaluate(
        (point) => {
          const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null
          return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? el?.tagName ?? null
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      )
      expect(hit).toBe('Close')

      // ── ONE Escape: the overlay closes, the tutorial survives ──
      await window.keyboard.press('Escape')
      await expect(overlay).toHaveCount(0)
      await expect(window.getByRole('dialog')).toHaveCount(1)
      await expect(counter(1)).toBeVisible()

      // ── the second Escape reaches the coachmark, now that it is topmost ──
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(counter(1)).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  /**
   * T-64 — the coachmark says aria-modal="true"; now it behaves like one.
   *
   * It carried role="dialog" + aria-modal="true" with no Tab trap and no
   * focus restore, so Tab walked straight out into the studio behind the
   * scrim — every control there is unreachable by mouse (the scrim eats the
   * clicks) and reachable by keyboard, which is the worst of both. It shares
   * Modal's trap now (hooks/useFocusTrap.ts).
   */
  test('T-64 the tutorial coachmark traps Tab and restores focus to its opener', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-trap')
    const userDataDir = path.join(root, 'userData')
    // Every tutorial seen: this one is STARTED from the header button, so the
    // opener that focus must come back to is a real element.
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const total = EMPTY_VIDEO_TOUR.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      const opener = window.getByRole('button', { name: 'Show tutorial' })
      await expect(opener).toBeVisible({ timeout: 20_000 })
      await opener.click()

      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })

      // Focus lands on Next, the way it has since the coachmark shipped.
      expect(await coachmarkFocus(window)).toEqual({ inside: true, label: 'Next' })

      // ── Tab cycles inside the card ──
      // Step 1 renders Skip and Next and no Back, so the cycle is two long:
      // Tab off the last wraps to the first, and no press ever lands outside.
      await window.keyboard.press('Tab')
      expect(await coachmarkFocus(window)).toEqual({ inside: true, label: 'Skip' })
      await window.keyboard.press('Tab')
      expect(await coachmarkFocus(window)).toEqual({ inside: true, label: 'Next' })
      for (let i = 0; i < 8; i++) {
        await window.keyboard.press('Tab')
        expect((await coachmarkFocus(window)).inside, `Tab #${i + 1}`).toBe(true)
      }
      // …and backwards.
      for (let i = 0; i < 5; i++) {
        await window.keyboard.press('Shift+Tab')
        expect((await coachmarkFocus(window)).inside, `Shift+Tab #${i + 1}`).toBe(true)
      }

      // ── Escape closes and hands focus back to the button that opened it ──
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect((await focusInfo(window)).label).toBe('Show tutorial')

      // ── and so does Skip, the other way out ──
      await opener.click()
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Skip' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect((await focusInfo(window)).label).toBe('Show tutorial')
      // Both ways out persist the flag now (T-86). It was seeded true, so this
      // only proves neither one cleared it; the persistence itself is driven in
      // "T-86 … Skip persists" / "Escape persists".
      expect(readConfig(userDataDir).tutorialSeen?.video).toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  /**
   * T-64 rider — the coachmark stopped re-scrolling the page under itself.
   *
   * The 300 ms poll re-issued `scrollIntoView({behavior:'smooth'})` on every
   * tick, so a step whose target is on screen and still kept the page in a
   * permanent smooth-scroll animation and re-rendered the card ~3x/s. The
   * scroll belongs to arriving at a step, so it fires once per step; the poll
   * is only there to notice the target MOVING, and now only writes state when
   * it really has.
   */
  test('T-64 the coachmark scrolls its target into view once per step, not 3x a second', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-poll')
    const userDataDir = path.join(root, 'userData')
    // Started from the '?' button: the first-visit tour waits for a video (T-86).
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const total = EMPTY_VIDEO_TOUR.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Instrumented before the studio (and therefore the coachmark) mounts,
      // so no call can be missed. Every scrollIntoView on the page is
      // recorded by the data-tutorial name of the element it was called on.
      await window.addInitScript(() => {
        const calls: string[] = []
        ;(window as unknown as { __scrollCalls: string[] }).__scrollCalls = calls
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function patched(
          this: Element,
          ...args: unknown[]
        ): void {
          calls.push(this.getAttribute('data-tutorial') ?? this.tagName)
          ;(original as (...a: unknown[]) => void).apply(this, args)
        }
      })
      await window.reload()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await window.getByRole('button', { name: 'Show tutorial' }).click()

      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      const scrollsOn = async (name: string): Promise<number> =>
        (
          await window.evaluate(
            () => (window as unknown as { __scrollCalls?: string[] }).__scrollCalls ?? []
          )
        ).filter((n) => n === name).length

      // Step 2 is the first step with a target — the empty studio's importer.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(2)).toBeVisible()
      await expect.poll(() => scrollsOn('video-import'), { timeout: 10_000 }).toBe(1)

      // Two seconds is ~7 poll ticks. Nothing moved, so the count must not
      // move either — this is the assertion that was 7-ish before the fix.
      await window.waitForTimeout(2_000)
      expect(await scrollsOn('video-import')).toBe(1)

      // Stepping away and back is a NEW arrival, so it scrolls again: the
      // fix is "once per step", not "once ever".
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(3)).toBeVisible()
      await window.getByRole('button', { name: 'Back' }).click()
      await expect(counter(2)).toBeVisible()
      await expect.poll(() => scrollsOn('video-import'), { timeout: 10_000 }).toBe(2)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  /**
   * T-119 (11) - the coachmark's scroll honors the OS "Reduce motion" setting.
   *
   * `scrollIntoView({ behavior: 'smooth' })` is an explicit option, and CSS `scroll-behavior` (what the
   * `prefers-reduced-motion` block in index.css sets) does not govern an explicit one - so the page animated to
   * every step's target under Reduce motion, the thing that setting exists to stop. The behavior is chosen when
   * the step is entered: 'auto' (an instant jump) under Reduce motion, 'smooth' otherwise.
   */
  test('T-119 the coachmark scrolls instantly under Reduce motion and smoothly otherwise', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-motion')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const total = EMPTY_VIDEO_TOUR.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Every scrollIntoView on the page is recorded with the `behavior` it was asked for.
      await window.addInitScript(() => {
        const calls: Array<{ name: string; behavior: string | null }> = []
        ;(window as unknown as { __scrollBehaviors: typeof calls }).__scrollBehaviors = calls
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function patched(this: Element, ...args: unknown[]): void {
          const opts = args[0]
          calls.push({
            name: this.getAttribute('data-tutorial') ?? this.tagName,
            behavior: opts && typeof opts === 'object' ? ((opts as ScrollIntoViewOptions).behavior ?? null) : null
          })
          ;(original as (...a: unknown[]) => void).apply(this, args)
        }
      })
      await window.reload()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()

      const reduced = (): Promise<boolean> =>
        window.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      const behaviorsOn = (name: string): Promise<Array<string | null>> =>
        window.evaluate(
          (n) =>
            ((window as unknown as { __scrollBehaviors?: Array<{ name: string; behavior: string | null }> })
              .__scrollBehaviors ?? [])
              .filter((c) => c.name === n)
              .map((c) => c.behavior),
          name
        )
      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })

      // Reduce motion on: arriving at the importer's step is an instant jump.
      await window.emulateMedia({ reducedMotion: 'reduce' })
      expect(await reduced(), 'the emulation took').toBe(true)
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(2)).toBeVisible()
      await expect.poll(() => behaviorsOn('video-import'), { timeout: 10_000 }).toEqual(['auto'])

      // Reduce motion off: the same arrival glides, as it always did.
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      expect(await reduced(), 'the emulation was lifted').toBe(false)
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(3)).toBeVisible()
      await window.getByRole('button', { name: 'Back' }).click()
      await expect(counter(2)).toBeVisible()
      await expect.poll(() => behaviorsOn('video-import'), { timeout: 10_000 }).toEqual(['auto', 'smooth'])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: Restore rehydrates the video and image stores', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('autosave-restore')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const fixture = path.join(sourceDir, 'autosaved-source.mp4')
    await makeFixtureMp4(fixture)
    seedAutosave(userDataDir, {
      schemaVersion: 2,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: fixture,
        clips: [
          {
            id: 'seedclip',
            name: 'Restored clip',
            startSec: 0,
            endSec: 2,
            cropRect: null,
            textOverlays: [],
            selectedPresets: ['youtube']
          }
        ],
        selectedClipId: 'seedclip',
        watermark: null
      },
      imageCanvas: {
        doc: {
          width: 1200,
          height: 800,
          background: '#ffffff',
          layers: [rectLayer('Restored rect')]
        }
      }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)

      // T-31: Home has a toast surface at all — exactly one, mounted by
      // App.tsx. Two would draw every toast twice; react-hot-toast keeps one
      // toast store per toaster id and every <Toaster> renders all of it.
      await expect(window.locator('[data-rht-toaster]')).toHaveCount(1)

      // The banner only renders for an autosave that VALIDATES and is fresh.
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-02-autosave-banner.png') })

      await window.getByRole('button', { name: 'Restore' }).click()

      // T-31 (was T-21 finding A): the success toast is drawn ON HOME. Asserted
      // visible first — toasts auto-dismiss after 2 s — then read back off the
      // durable MutationObserver log, which is what the old contrast pinned as
      // never happening.
      await expect(window.getByText('Restored from autosave')).toBeVisible({ timeout: 20_000 })
      expect(await readToastLog(window)).toContain('Restored from autosave')
      // T-125 (13): the success mark is the palette's ok-strong, not react-hot-toast's stock green, and the page's native controls
      // are told the window is dark and which color is the accent (they were stock Chromium: blue ticks and sliders, light scrollbars).
      const successDiscs = await toastDiscColors(window, 'Restored from autosave')
      expect(successDiscs, 'the success disc is OK_STRONG').toContain('rgb(52, 211, 153)')
      expect(successDiscs, 'and not the library\'s stock green').not.toContain('rgb(97, 211, 69)')
      expect(
        await window.evaluate(() => {
          const cs = getComputedStyle(document.documentElement)
          return { colorScheme: cs.colorScheme, accentColor: cs.accentColor }
        }),
        'native controls: dark, with the accent token'
      ).toEqual({ colorScheme: 'dark', accentColor: 'rgb(255, 49, 49)' })

      // The banner dismisses itself once the restore lands.
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0, { timeout: 20_000 })

      // Video store rehydrated: the studio shows the restored source (name
      // read back off the real file) and the restored clip.
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 20_000 })
      // T-31: the studio no longer mounts its own — still exactly one, the
      // app-level surface following the route.
      await expect(window.locator('[data-rht-toaster]')).toHaveCount(1)
      await expect(window.getByText('autosaved-source.mp4')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('button', { name: 'Select clip Restored clip' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible()
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // Image store rehydrated: the autosaved layer is in the panel.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Restored rect')).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-03-restored.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Home global Undo spares the restored canvas and reverts the real edit made after it', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('global-undo')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Undoable rect'))

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      // Cold Home: nothing tracked, both buttons off.
      await expect(window.getByText('last: no recent change')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeDisabled()

      // No settling wait any more: T-32 dropped the 250 ms post-mount window
      // the old tracker needed, because it only records real history steps —
      // a store event that moves no undo step cannot arm the buttons, so
      // there is nothing to race.
      await window.getByRole('button', { name: 'Restore' }).click()
      await expect(window.getByText('Restored from autosave')).toBeVisible({ timeout: 20_000 })

      // T-47: a restore is an open-a-file, not an edit. It used to push a
      // canvas history step, so the app came back with Undo lit over work
      // the user never did — and one click would have thrown the whole
      // restored session away. Nothing to undo, and nothing to redo.
      await expect(window.getByText('last: no recent change')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeDisabled()

      // ── a REAL edit on top of the restored canvas, made inside the studio
      //    with Home unmounted ──
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Undoable rect')).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Duplicate layer' }).click()
      await expect(window.getByText('Layers (2)')).toBeVisible()
      await expect(window.getByText('Undoable rect copy')).toBeVisible()

      // T-32 (was T-21 finding B): Home was never on screen while that
      // happened, and the tracker still has it.
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('last: Stream Graphics')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled()
      await window.getByRole('button', { name: 'Undo' }).click()

      // End state: the duplicate is gone and the RESTORED layer is still
      // there — Undo walked back the edit, not the restore.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Undoable rect')).toBeVisible()
      await expect(window.getByText('Undoable rect copy')).toHaveCount(0)

      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // T-32: the record is module-level, so walking into a studio and back
      // does not wipe it. The one step here has been undone, so Undo is
      // spent — but the undone step is still on the redo side after the
      // round trip, which the old Home-scoped tracker lost.
      await expect(window.getByText('last: no recent change')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeEnabled()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Home global Redo enables after an Undo and re-applies the change', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('global-redo')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Redoable rect'))

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.getByRole('button', { name: 'Restore' }).click()
      await expect(window.getByText('Restored from autosave')).toBeVisible({ timeout: 20_000 })

      // The undoable step is an edit the user makes, never the restore
      // itself (T-47) — so this test arms the buttons the same way a user
      // would, by changing something on the restored canvas.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Redoable rect')).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Duplicate layer' }).click()
      await expect(window.getByText('Layers (2)')).toBeVisible()
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.getByText('last: Stream Graphics')).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Undo' }).click()

      // T-32 (was T-21 finding C): the click itself re-derives enablement.
      // The old hook read canUndo/canRedo off getState() during render and
      // swallowed the store event its own undo() raised, so Home never
      // re-rendered: Redo stayed dark and Undo stayed lit over an empty past.
      await expect(window.getByRole('button', { name: 'Redo' })).toBeEnabled()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()

      // And Redo is reachable through the UI, not just enabled: the click
      // puts the duplicated layer back on the canvas.
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(window.getByText('last: Stream Graphics')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeDisabled()

      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Layers (2)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Redoable rect copy')).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Home global Undo walks the studios newest-first — a video edit, a mood board, and a canvas edit', async () => {
    test.setTimeout(240_000)
    const root = makeRoot('global-undo-order')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'ordered-source.mp4')
    await makeFixtureMp4(fixture)
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: ALL_TUTORIALS_SEEN,
      recentFiles: { video: [fixture] }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      const home = window.locator('a[href="#/home"]').first()
      const undo = window.getByRole('button', { name: 'Undo' })
      const redo = window.getByRole('button', { name: 'Redo' })
      const goHome = async (): Promise<void> => {
        await home.click()
        await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      }
      // Exact, because the export panel carries a "Compile clips (n)" header
      // that a substring match also hits.
      const clipList = (n: number): ReturnType<Page['getByRole']> =>
        window.getByRole('heading', { name: `Clips (${n})`, exact: true })
      await waitForHome(window)

      // Cold Home: nothing tracked. Loading a source is not an undoable step
      // either — it resets that studio's history — so this must still read
      // empty after the import below is undone back to nothing.
      await expect(window.getByText('last: no recent change')).toBeVisible({ timeout: 20_000 })
      await expect(undo).toBeDisabled()

      // ── a step made inside Video Studio, with Home unmounted ──
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Recent (1)' }).click()
      await window.getByRole('button', { name: /ordered-source\.mp4/ }).click()
      await expect(clipList(1)).toBeVisible({ timeout: 30_000 })
      await window.getByRole('button', { name: '+ Add clip' }).click()
      await expect(clipList(2)).toBeVisible()

      // T-32 (was T-21 finding B): Home was never on screen while that
      // happened, and the tracker still has it.
      await goHome()
      await expect(window.getByText('last: Video Studio')).toBeVisible()
      await expect(undo).toBeEnabled()

      // ── then a mood board created inside References (T-58) ──
      // Before T-58 this studio kept no history at all, so this step was
      // invisible here: the readout stayed on "Video Studio" and Home's Undo
      // could never reach a board.
      await window.locator('a', { hasText: 'References' }).first().click()
      await window.getByRole('button', { name: 'Mood Boards', exact: true }).click()
      await window.getByPlaceholder('New board name', { exact: false }).fill('Ordered board')
      await window.getByRole('button', { name: 'Create board', exact: true }).click()
      await expect(
        window.getByRole('heading', { name: 'Boards (1)', exact: true })
      ).toBeVisible({ timeout: 20_000 })
      await goHome()
      await expect(window.getByText('last: References')).toBeVisible()

      // ── then a step made inside Stream Graphics ──
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await goHome()
      await expect(window.getByText('last: Stream Graphics')).toBeVisible()

      // ── first Undo takes the canvas step, the newest one ──
      await undo.click()
      await expect(window.getByText('last: References')).toBeVisible()
      await expect(redo).toBeEnabled()
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await goHome()
      // …and left the video edit alone.
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(2)).toBeVisible({ timeout: 20_000 })
      await goHome()

      // ── second Undo takes the board, and it goes from the disk too ──
      await undo.click()
      await expect(window.getByText('last: Video Studio')).toBeVisible()
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(
        window.getByRole('heading', { name: 'Boards (0)', exact: true })
      ).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => readdirSync(path.join(userDataDir, 'moodboards')).filter((f) => f.endsWith('.json')))
        .toEqual([])
      await goHome()

      // ── third Undo takes the video step ──
      await undo.click()
      await expect(window.getByText('last: no recent change')).toBeVisible()
      await expect(undo).toBeDisabled()
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(1)).toBeVisible({ timeout: 20_000 })
      await goHome()

      // ── Redo mirrors it: video, then the board, then the canvas ──
      await expect(redo).toBeEnabled()
      await redo.click()
      await expect(window.getByText('last: Video Studio')).toBeVisible()
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(2)).toBeVisible({ timeout: 20_000 })
      await goHome()

      await redo.click()
      await expect(window.getByText('last: References')).toBeVisible()
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(
        window.getByRole('heading', { name: 'Boards (1)', exact: true })
      ).toBeVisible({ timeout: 20_000 })
      await expect(window.locator('li', { hasText: 'Ordered board' })).toHaveCount(1)
      await goHome()

      await redo.click()
      await expect(window.getByText('last: Stream Graphics')).toBeVisible()
      await expect(redo).toBeDisabled()
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: Later only hides the banner, Clear deletes the file', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('autosave-dismiss')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)

      // ── Later: banner hidden, file untouched ──
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Later' }).click()
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      // The dismissed state still tells the user backups are running.
      await expect(window.getByText(/^Last autosave: /)).toBeVisible()
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)
      // Nothing was applied either — Later is not a silent Restore.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Kept rect')).toHaveCount(0)
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // A reload proves "Later" really was per-session: the file is still
      // there, so the offer comes back.
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })

      // ── Clear: file deleted from disk ──
      await window.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect
        .poll(() => existsSync(autosaveFile(userDataDir)), { timeout: 20_000, intervals: [250] })
        .toBe(false)
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      // And it stays gone across a reload — no banner, no offer.
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      expect(existsSync(autosaveFile(userDataDir))).toBe(false)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-133 (9): the banner's Restore and Clear are `disabled` while one of them runs, and drew like live buttons. The clear is held 4 s here (main's
  // handler is replaced by one that waits, then does what the real one does: removes the file), so "while it runs" is a state the test creates.
  async function holdAutosaveClear(app: ElectronApplication, userDataDir: string): Promise<void> {
    await app.evaluate(async ({ ipcMain }, file) => {
      const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
      const fs = getBuiltin('node:fs') as { rmSync: (path: string, opts: { force: boolean }) => void }
      ipcMain.removeHandler('autosave:clear')
      ipcMain.handle('autosave:clear', async () => {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        fs.rmSync(file, { force: true })
      })
    }, autosaveFile(userDataDir))
  }
  const opacityOf = (button: ReturnType<Page['getByRole']>): Promise<number> => button.evaluate((el) => Number(getComputedStyle(el).opacity))

  test('AutosaveRestore: Restore and Clear are dimmed while one of them runs; Later stays live (T-133 (9))', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('autosave-dim')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      // (Restore's label becomes "Restoring…" only while RESTORE runs: each button has a busy flag of its own since T-134 (7), so Clear
      // running leaves the label "Restore" while both buttons dim. The pattern allows either label because this case does not pin which.)
      const restore = window.getByRole('button', { name: /^Restor(e|ing…)$/ })
      const clear = window.getByRole('button', { name: 'Clear', exact: true })
      const later = window.getByRole('button', { name: 'Later' })
      expect(await opacityOf(restore), 'live').toBe(1)
      expect(await opacityOf(clear), 'live').toBe(1)
      await holdAutosaveClear(app, userDataDir)
      await clear.click()
      await expect(restore).toBeDisabled()
      await expect(clear).toBeDisabled()
      await expect.poll(() => opacityOf(restore), { timeout: 5_000, message: 'Restore looks off while the clear runs' }).toBeLessThan(0.7)
      await expect.poll(() => opacityOf(clear), { timeout: 5_000, message: 'Clear looks off' }).toBeLessThan(0.7)
      await expect(later, 'Later is not part of the busy state').toBeEnabled()
      expect(await opacityOf(later)).toBe(1)
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: the damaged banner\'s Clear is dimmed while the clear runs (T-133 (9))', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('autosave-dim-damaged')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await expect(window.getByText(/imagii found an autosave from .*, but it's damaged/)).toBeVisible({ timeout: 20_000 })
      const clear = window.getByRole('button', { name: 'Clear', exact: true })
      expect(await opacityOf(clear), 'live').toBe(1)
      await holdAutosaveClear(app, userDataDir)
      await clear.click()
      await expect(clear).toBeDisabled()
      await expect.poll(() => opacityOf(clear), { timeout: 5_000, message: 'Clear looks off while it runs' }).toBeLessThan(0.7)
      expect(await opacityOf(window.getByRole('button', { name: 'Dismiss' })), 'Dismiss is not part of the busy state').toBe(1)
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: a corrupt autosave says so — Dismiss hides it, Clear deletes the file', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('autosave-corrupt')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    // Truncated mid-object — the shape a crash during a write leaves behind.
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)

      // T-33 (was T-21 finding D): the corruption notice renders. It used to
      // be dead code — the branch required `info.ageMs` and main returned
      // `{ exists, filePath, sizeBytes }` with no age for exactly the files
      // that fail validation, so a user whose autosave was corrupt saw
      // nothing at all: no banner, no Clear, no status line.
      const banner = window.getByText(/imagii found an autosave from .*, but it's damaged/)
      await expect(banner).toBeVisible({ timeout: 20_000 })
      // T-84: the banner speaks to a streamer, not a parser. The age comes
      // from the file's mtime (seeded seconds ago); the validator's reason
      // ("invalid JSON: Unexpected end of JSON input") is for the console —
      // it used to be printed here, and the old words ("failed validation",
      // "It will not be loaded.") named a process the user never sees.
      await expect(banner).toHaveText(
        "imagii found an autosave from a moment ago, but it's damaged and can't be restored. " +
          'Clear it to get rid of it.'
      )
      await expect(banner).not.toContainText('invalid JSON')
      await expect(banner).not.toContainText('validation')
      await expect(window.getByRole('button', { name: 'Clear' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Dismiss' })).toBeVisible()

      // Still no restore offer, and nothing applied — a corrupt autosave
      // must never reach the stores. That half was always true; it is the
      // contrast that proves the banner above is the corruption branch and
      // not the restore one.
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Restore' })).toHaveCount(0)
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // ── Dismiss: banner hidden, file untouched ──
      await window.getByRole('button', { name: 'Dismiss' }).click()
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0)
      // The dismissed state still reports the backup's age — the same
      // mtime-derived number, so the status line is no longer suppressed by
      // a corrupt file either.
      await expect(window.getByText(/^Last autosave: /)).toBeVisible()
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)
      expect(readFileSync(autosaveFile(userDataDir), 'utf8')).toBe(
        '{"schemaVersion":2,"savedAt":175534'
      )

      // Dismiss is per-session, like Later: a reload brings the notice back.
      // T-84: and this time the console is listening, because the reason the
      // banner no longer prints has to go SOMEWHERE a bug report can find it.
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      await window.reload()
      await waitForHome(window)
      await installToastLog(window)
      await expect(window.getByText(/but it's damaged/)).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => consoleLines.join('\n'), { timeout: 20_000 })
        .toContain('invalid JSON')

      // ── Clear: the file is deleted from disk ──
      await window.getByRole('button', { name: 'Clear' }).click()
      await expect
        .poll(() => existsSync(autosaveFile(userDataDir)), { timeout: 20_000, intervals: [250] })
        .toBe(false)
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0)
      expect(await readToastLog(window)).toContain('Autosave cleared')

      // And it stays gone: nothing to warn about after a reload.
      await window.reload()
      await waitForHome(window)
      await window.waitForTimeout(1500)
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0)
      await expect(window.getByText(/^Last autosave: /)).toHaveCount(0)
      expect(existsSync(autosaveFile(userDataDir))).toBe(false)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: a clear that fails says so and leaves the banner and the file alone', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('autosave-clear-fails')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)

      // T-57: make the delete fail the way a locked or read-only file makes
      // it fail. The refusal is stubbed in MAIN — the same place the save
      // dialog is stubbed — rather than by chmod, because file permissions
      // mean different things to root and to Windows and this assertion is
      // about what the user is told, which must be the same everywhere.
      // The message is verbatim what main/autosave.ts raises when a file it
      // tried to delete is still there afterwards and the failed unlink
      // carried no errno code (T-118: with one, it ends in "(EBUSY)" - the
      // second stub below). This is the shape the helper has no words for.
      await app.evaluate(async ({ ipcMain }) => {
        ipcMain.removeHandler('autosave:clear')
        ipcMain.handle('autosave:clear', () => {
          throw new Error('could not delete autosave.json')
        })
      })

      const banner = window.getByText(/imagii found an autosave from .*, but it's damaged/)
      await expect(banner).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Clear' }).click()

      // The error names what failed, why, and what to do — and it says the
      // file is still there, which is the truth the old silent version
      // could not tell. Before T-57 `discard()` had no catch at all: the
      // rejected clear was an unhandled rejection, no toast of any kind
      // appeared, and the banner sat there with no explanation.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 20_000,
          intervals: [200]
        })
        .toContain("Couldn't clear the autosave")
      const failedToasts = (await readToastLog(window)).join(' | ')
      // T-117: the sentence is the banner's own. It used to splice main's string in as written
      // ("Couldn't clear the autosave: could not delete autosave.json. ..."); a locked file now reads
      // as the plain cause when the shape is known (below), and is not shown when it is not.
      expect(failedToasts).toContain("Couldn't clear the autosave. It's still on disk.")
      // T-125 (13): and the error mark is the palette's danger-strong, not the library's stock red.
      const errorDiscs = await toastDiscColors(window, "Couldn't clear the autosave")
      expect(errorDiscs, 'the error disc is DANGER_STRONG').toContain('rgb(251, 113, 133)')
      expect(errorDiscs, 'and not the library\'s stock red').not.toContain('rgb(255, 75, 75)')
      expect(failedToasts).not.toContain('could not delete autosave.json')
      // T-118: no code on the message, so no cause is guessed - the bare sentence is the whole toast.
      expect(failedToasts).not.toContain('Windows blocked access')
      // The success copy must NOT appear — a failed delete that says
      // "Autosave cleared" is the lie this ticket exists to remove.
      expect(failedToasts).not.toContain('Autosave cleared')
      // Nor Electron's invoke envelope (T-30/T-59: same disease).
      expect(failedToasts).not.toMatch(/Error invoking remote method/)

      // Truthful state: the file is still on disk, and the banner is still
      // up with Clear still offered — the button is the only way to reach
      // the file, so hiding it would strand it.
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)
      await expect(banner).toBeVisible()
      const clearButton = window.getByRole('button', { name: 'Clear' })
      await expect(clearButton).toBeVisible()
      await expect(clearButton).toBeEnabled()
      await expect(window.getByRole('button', { name: 'Dismiss' })).toBeVisible()

      // A cause the helper knows is named in plain words, and the code and file name it came with are
      // not shown. The stub is main's real shape for a locked file (T-118): clearAutosave appends the
      // first failed unlink's errno to the names that survived. (Before T-118 main swallowed the errno
      // and could never raise this, so the toast below was unreachable outside a stub.)
      await app.evaluate(async ({ ipcMain }) => {
        ipcMain.removeHandler('autosave:clear')
        ipcMain.handle('autosave:clear', () => {
          throw new Error('could not delete autosave.json (EBUSY)')
        })
      })
      await window.getByRole('button', { name: 'Clear' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 20_000, intervals: [200] })
        .toContain(
          "Couldn't clear the autosave. It's still on disk. Windows blocked access to a file. " +
            'Close any app using it, or check your antivirus.'
        )
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/EBUSY|maken|AppData|autosave\.json|unlink/)
      await expect(banner).toBeVisible()

      // Discrimination: the SAME button, with a clear that works. What is
      // being told apart here is the renderer's two branches, so the stub is
      // swapped for one that succeeds and the file is removed alongside it,
      // keeping the app's answer and the disk in agreement. main's own
      // clearAutosave — both the success and the "could not delete" branch —
      // is driven for real in src/main/autosave.test.ts.
      rmSync(autosaveFile(userDataDir), { force: true })
      await app.evaluate(async ({ ipcMain }) => {
        ipcMain.removeHandler('autosave:clear')
        ipcMain.handle('autosave:clear', () => undefined)
      })
      await clearButton.click()
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0, { timeout: 20_000 })
      expect(await readToastLog(window)).toContain('Autosave cleared')
      expect(existsSync(autosaveFile(userDataDir))).toBe(false)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: Restore with a moved video opens the rest and names the file (T-84)', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('autosave-moved')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    // A snapshot that validates (the file is fine) but whose video is gone:
    // the recording was on a drive that is not plugged in.
    const gone = path.join(root, 'source', 'stream-that-moved.mp4')
    seedAutosave(userDataDir, {
      ...canvasProject('Kept rect'),
      videoStudio: {
        sourcePath: gone,
        clips: [],
        selectedClipId: null,
        watermark: null,
        srtPath: null
      }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })

      await window.getByRole('button', { name: 'Restore' }).click()

      // ONE message, naming the file — in place of "Restored from autosave"
      // (which would be true of the canvas and false of the video) and of
      // ffprobe's stderr (which is what this used to throw).
      const MESSAGE =
        "Couldn't find stream-that-moved.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio.'
      await expect
        .poll(() => readToastLog(window), { timeout: 20_000, intervals: [200] })
        .toContain(MESSAGE)
      const log = await readToastLog(window)
      expect(log).not.toContain('Restored from autosave')
      expect(log.join(' | ')).not.toMatch(/ffprobe|No such file|Error invoking remote method/)
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)

      // The rest came back: the canvas layer is there.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      // …and the studio that lost its file is the empty one, not half-loaded.
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Video tutorial: Next / Back / arrows / Enter / scrim run it to Done and persist tutorialSeen.video', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('tutorial-run')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'tour-run.mp4')
    await makeFixtureMp4(fixture)
    // Every tutorial flag EXCEPT video — the coachmark auto-starts on /video,
    // once there is a video to tour (T-86: not over the bare importer).
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: { audio: true, image: true, ai: true }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-run.mp4')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })

      // The loaded studio's tour: every step but the importer's, which is gone.
      const total = (await stepsWithATarget(window, videoTutorial)).length
      expect(total).toBe(videoTutorial.steps.length - 1)
      expect(total).toBeGreaterThanOrEqual(6)

      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })

      // Auto-start after the first import, at step 1 with the real step copy.
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Welcome to Video Studio')).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-04-tutorial.png') })

      // Next button.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(2)).toBeVisible()
      // ArrowRight binding.
      await window.keyboard.press('ArrowRight')
      await expect(counter(3)).toBeVisible()
      // Back button, clicked from step 3.
      await window.getByRole('button', { name: 'Back' }).click()
      await expect(counter(2)).toBeVisible()
      // ArrowLeft binding.
      await window.keyboard.press('ArrowLeft')
      await expect(counter(1)).toBeVisible()
      // Back is not rendered on the first step, so there is nothing to
      // over-run: the guard is structural.
      await expect(window.getByRole('button', { name: 'Back' })).toHaveCount(0)

      // Enter binding, off a button. Focus sits on Next after every step
      // change and the handler defers to the button's own activation there,
      // so blur first — the window-level Enter branch is the thing under test.
      //
      // T-34 (was T-21 finding F): exactly ONE step. This used to advance TWO
      // (observed 1 -> 3): the keydown handler ran next() on the body, React
      // flushed and the step-change effect pulled focus onto the new Next
      // button, and Chromium then applied Enter's default action to whatever
      // was focused by that point, clicking Next a second time — so a user
      // paging through with Enter read every other step. The handler now
      // preventDefaults the Enter it consumes.
      await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await window.keyboard.press('Enter')
      await expect(counter(2)).toBeVisible()
      expect(await currentStep(window)).toBe(2)

      // Scrim click ADVANCES by design (Tutorial.tsx: the masked rect's
      // onClick is next(), not close) — asserted so the behavior is pinned
      // rather than assumed, and so no other test tries to escape that way.
      await window.locator('svg rect[mask]').click({ position: { x: 8, y: 8 } })
      await expect(counter(3)).toBeVisible()

      // T-34's other half: a step advanced by CLICKING Next leaves focus on
      // the button, where the window handler defers instead of consuming the
      // key. Enter from there must also move exactly one step — the deferral
      // and the preventDefault can never both fire on one keypress.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(4)).toBeVisible()
      expect((await focusInfo(window)).label).toBe('Next')
      await window.keyboard.press('Enter')
      await expect(counter(5)).toBeVisible()
      expect(await currentStep(window)).toBe(5)

      // Run the rest with Next until the last step offers Done.
      for (let step = 5; step < total; step++) {
        await window.getByRole('button', { name: 'Next' }).click()
        await expect(counter(step + 1)).toBeVisible()
      }
      await expect(window.getByRole('button', { name: 'Next' })).toHaveCount(0)
      await window.getByRole('button', { name: 'Done' }).click()

      // Gone from the page…
      await expect(counter(total)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Done' })).toHaveCount(0)
      // …and persisted, so the next launch does not re-run it.
      await expect
        .poll(() => readConfig(userDataDir).tutorialSeen?.video, {
          timeout: 15_000,
          intervals: [200]
        })
        .toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-132 (6): focus is put on Next after every step, and Enter on a focused button is its click on keydown - which auto-repeats while the key
  // is held. Each repeat was a click on the next step's Next, so a held Enter walked the whole tour to Done in a second, and Done persists
  // "seen" (the tour never came back). The Fix wizard has had the guard since T-120; the tour's window keydown holds a repeat the same way.
  // Playwright marks a keydown for a key that is already down as a repeat, which is what a held key does.
  test('Video tutorial: a held Enter steps once, a held arrow steps once, and the tour is neither finished nor marked seen (T-132 (6))', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-held')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'tour-held.mp4')
    await makeFixtureMp4(fixture)
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: { audio: true, image: true, ai: true } })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-held.mp4')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      const total = (await stepsWithATarget(window, videoTutorial)).length
      const counter = (n: number): ReturnType<Page['getByText']> => window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      // Focus is on Next (the tour puts it there on every step).
      await expect(window.getByRole('button', { name: 'Next' })).toBeFocused()

      // Hold Enter: the first keydown is Next's own click (step 2) ...
      await window.keyboard.down('Enter')
      await expect(counter(2)).toBeVisible()
      // ... and the auto-repeats are not more decisions. Without the guard each one clicked the new step's Next.
      for (let i = 0; i < 6; i++) await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await expect(counter(2), 'six repeats walked the tour on').toBeVisible()
      expect(await currentStep(window)).toBe(2)

      // The same for a held ArrowRight (the window-level binding).
      await window.keyboard.down('ArrowRight')
      await expect(counter(3)).toBeVisible()
      for (let i = 0; i < 6; i++) await window.keyboard.down('ArrowRight')
      await window.keyboard.up('ArrowRight')
      await expect(counter(3), 'six repeats of the arrow walked the tour on').toBeVisible()

      // A fresh press is still a decision, and the tour is not finished: it was never marked seen.
      await window.keyboard.press('Enter')
      await expect(counter(4)).toBeVisible()
      await window.waitForTimeout(500)
      expect(readConfig(userDataDir).tutorialSeen?.video, 'a held key did not finish the tour').not.toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-133 (7a): the other end of the held-Enter problem. A held Enter on the tour's Done (or Skip) closes the tour with its FIRST press, the trap puts
  // focus back on the "?" that opened it, and the key's auto-repeats are keyboard clicks (detail 0) on THAT button: the tour reopened itself, and a
  // person who only wanted it gone saw it come back. The guard is on the key: the Enter that was down when the dialog closed does nothing until it
  // is let go. The repeats arrive 800 ms after the press here, as they do after a real OS repeat delay (a fixed-length window would have lapsed).
  test('Video tutorial: a held Enter on Done closes the tour once; the repeats do not reopen it (T-133 (7a))', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-held-done')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'tour-held-done.mp4')
    await makeFixtureMp4(fixture)
    // Started from the "?" button (the tour does not open by itself): that is the control focus goes back to when the tour is gone.
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-held-done.mp4')
      await expect(window.locator('header').getByText('tour-held-done.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      const total = (await stepsWithATarget(window, videoTutorial)).length
      await expect(window.getByText(`Video Studio · 1 of ${total}`, { exact: true })).toBeVisible({ timeout: 20_000 })
      for (let i = 1; i < total; i++) await window.getByRole('button', { name: 'Next' }).click()
      const done = window.getByRole('button', { name: /^Done/ })
      await expect(done).toBeFocused()

      // Hold Enter on Done: the first keydown closes the tour ...
      await window.keyboard.down('Enter')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      // ... and the auto-repeats, arriving after the OS's repeat delay, land on the "?" button focus went back to. They are not presses.
      await window.waitForTimeout(800)
      for (let i = 0; i < 6; i++) await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await window.waitForTimeout(300)
      await expect(window.getByRole('dialog'), 'the repeats reopened the tour').toHaveCount(0)

      // The guard is not a latch: a fresh press of Enter on the "?" button is a decision and opens the tour again.
      await expect(window.getByRole('button', { name: 'Show tutorial' })).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(window.getByRole('dialog')).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-133 (7b): the `?` shortcuts overlay toggled on EVERY auto-repeat of a held key (open, shut, open... at the keyboard's repeat rate). Four
  // keydowns of one held `?` are one press: the overlay is open, and stays open.
  test('Shortcuts overlay: a held ? opens it once and it stays open (T-133 (7b))', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('overlay-held')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      const overlay = window.getByRole('dialog').filter({ hasText: 'Press Esc or ? to close.' })
      for (let i = 0; i < 4; i++) await window.keyboard.down('?')
      await window.keyboard.up('?')
      await window.waitForTimeout(300)
      await expect(overlay, 'four keydowns of a held ? are one press: open (the old toggle on every repeat ended shut)').toBeVisible()
      // A fresh press still closes it (the repeats were ignored, not the key).
      await window.keyboard.press('?')
      await expect(overlay).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Video tutorial: the left/right coachmark stays inside a 1280x800 window and its buttons are clickable (T-34)', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('tutorial-clamp')
    const userDataDir = path.join(root, 'userData')
    // Started from the '?' button: the empty studio is where the importer — the
    // wide target this test needs — is on screen, and the first-visit tour
    // waits for a video (T-86).
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const total = EMPTY_VIDEO_TOUR.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // The size the ticket names, driven through the real OS window so the
      // renderer's own innerWidth/innerHeight are what the geometry sees.
      await setContentSize(app, window, 1280, 800)

      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })

      // Step 2 is the named offender: placement 'right' on
      // [data-tutorial="video-import"], the widest target the unloaded studio
      // renders. Before T-34 the coachmark was laid out at
      // target.right + 16 with no clamp on that axis, so at 1280 px it
      // started ~16 px from the right edge and its buttons sat off-screen.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(2)).toBeVisible()
      const stepDef = videoTutorial.steps[1]
      expect(stepDef?.placement).toBe('right')
      expect(stepDef?.targetSelector).toBe('[data-tutorial="video-import"]')
      // The target really is too wide for its own side — otherwise this test
      // would pass on the unclamped build for the wrong reason.
      const targetRight = await window.evaluate(() => {
        const el = document.querySelector('[data-tutorial="video-import"]')
        if (!el) throw new Error('video-import target not rendered')
        return el.getBoundingClientRect().right
      })
      expect(targetRight).toBeGreaterThan(1280 - 448 - 16)

      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const card = await dialog.boundingBox()
      expect(card).not.toBeNull()
      if (!card) throw new Error('unreachable')
      // The whole coachmark is on screen — not just the corner that used to
      // peek in from the right edge.
      expect(card.x).toBeGreaterThanOrEqual(0)
      expect(card.y).toBeGreaterThanOrEqual(0)
      expect(card.x + card.width).toBeLessThanOrEqual(1280)
      expect(card.y + card.height).toBeLessThanOrEqual(800)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-07-tutorial-clamped.png') })

      // Every control it owns, individually — the buttons are what the
      // finding was actually about.
      for (const name of ['Skip', 'Next']) {
        const box = await window.getByRole('button', { name }).boundingBox()
        expect(box, `${name} has no box`).not.toBeNull()
        if (!box) throw new Error('unreachable')
        expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(1280)
        expect(box.y, `${name} top edge`).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height, `${name} bottom edge`).toBeLessThanOrEqual(800)
        // …and the button is what the user's pointer would actually hit at
        // that spot, not the scrim or a studio control underneath it.
        const hit = await window.evaluate(
          (point) => {
            const el = document.elementFromPoint(point.x, point.y)
            if (!el) return 'nothing at that point'
            const button = el.closest('button')
            return button ? (button.textContent ?? '').trim() : `${el.tagName} (not a button)`
          },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        )
        expect(hit, `${name} is not the top element at its own center`).toContain(name)
      }

      // And it is clickable for real: Next advances the tour.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(3)).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('ErrorBoundary: a real render throw shows the fallback, the stack expands, and Reload to Home recovers (T-35)', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('error-boundary')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      const alert = window.getByRole('alert')

      // ── the production guard, asserted first ──
      // The harness route needs BOTH the hash and the window flag. Without
      // the flag — i.e. in every shipped app — it is just another unknown
      // hash and lands on Home, so this route cannot crash a user.
      await window.evaluate(() => {
        globalThis.location.hash = '#/__crash'
      })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(alert).toHaveCount(0)
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()

      // ── armed: a component throws during render, for real ──
      await window.evaluate(() => {
        ;(globalThis as unknown as { __imagiiCrashTest?: boolean }).__imagiiCrashTest = true
        globalThis.location.hash = '#/home'
      })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
      await window.evaluate(() => {
        globalThis.location.hash = '#/__crash'
      })

      await expect(alert).toBeVisible({ timeout: 15_000 })
      // T-84: the crash screen speaks to a streamer. It used to say "imagii
      // hit a render error" and ask the user to "copy the message below and
      // report it" — to a channel that does not exist in a local-first app.
      // Now: what happened, what is safe, where it is.
      await expect(
        alert.getByRole('heading', { name: 'Something went wrong in this studio' })
      ).toBeVisible()
      // T-125 (21): and what is safe is stated truthfully. It said "most of it should be waiting on the Home screen", which
      // Reload to Home never made true (it changes the hash and rebuilds no store, so nothing "waits" on Home); the next case drives
      // the real claim, that the work is still open in its studio.
      await expect(
        alert.getByText(
          'Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on.'
        )
      ).toBeVisible()
      expect(await alert.innerText()).not.toMatch(/waiting on/i)
      // What the user can SEE says neither — `innerText` skips the closed
      // Details, whose thrown message ("Forced render error …") legitimately
      // does.
      expect(await alert.innerText()).not.toMatch(/render error|\breport\b/i)
      // The technical text is still there for whoever wants it — behind a
      // collapsed "Details" disclosure, not in the user's face.
      const details = alert.locator('details')
      await expect(details.locator('summary')).toHaveText('Details')
      const technical = details.locator('pre')
      await expect(technical).toHaveCount(2) // the thrown message, then React's component stack
      await expect(technical.first()).toBeHidden()
      await expect(
        alert.getByText('Forced render error (T-35 ErrorBoundary harness)')
      ).toBeHidden()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-08-error-boundary.png') })

      // ── the raw-hex styling is intact ──
      // DESIGN_GUIDE.md lists this fallback as one of three documented
      // raw-color exceptions: it uses inline hex on purpose, because the
      // error may have come from layout itself and a Tailwind-classed
      // fallback could go down with it. So these are the values to pin, and
      // "fixing" them to tokens would be the regression.
      const styling = await alert.evaluate((el) => {
        const button = el.querySelector('button')
        const code = el.querySelector('pre')
        return {
          alertBackground: getComputedStyle(el).backgroundColor,
          alertColor: getComputedStyle(el).color,
          usesClasses: el.className,
          buttonBackground: button ? getComputedStyle(button).backgroundColor : 'no button',
          messageColor: code ? getComputedStyle(code).color : 'no pre'
        }
      })
      expect(styling).toEqual({
        alertBackground: 'rgb(18, 12, 12)', // #120c0c
        alertColor: 'rgb(236, 228, 226)', // #ece4e2
        usesClasses: '',
        buttonBackground: 'rgb(255, 49, 49)', // #ff3131
        messageColor: 'rgb(248, 113, 113)'
      })

      // ── the Details disclosure expands: the thrown message, then the stack ──
      await details.locator('summary').click()
      await expect(technical.first()).toBeVisible()
      await expect(
        alert.getByText('Forced render error (T-35 ErrorBoundary harness)')
      ).toBeVisible()
      const stack = technical.nth(1)
      await expect(stack).toBeVisible()
      // React's own component stack, so it is worth reading: several frames,
      // each an "at …" line. (Names are minified in a production build, which
      // is why this asserts the shape rather than a component name.)
      const stackText = (await stack.textContent()) ?? ''
      expect(stackText.split('\n').filter((line) => line.includes('at ')).length).toBeGreaterThan(2)

      // ── Reload to Home recovers ──
      // The flag is deliberately left armed: recovery has to work because the
      // app left the crashing route, not because the crash was defused.
      await window.getByRole('button', { name: 'Reload to Home' }).click()
      await expect(alert).toHaveCount(0, { timeout: 15_000 })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()
      expect(await window.evaluate(() => globalThis.location.hash)).toBe('#/home')

      // …to a WORKING Home, not just a rendered one: routing, the app-wide
      // chrome and a studio all still function after the recovery.
      await expect(window.locator('[data-rht-toaster]')).toHaveCount(1)
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({
        timeout: 20_000
      })
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // And the boundary is armed again for the NEXT crash — recovery resets
      // it rather than spending it.
      await window.evaluate(() => {
        globalThis.location.hash = '#/__crash'
      })
      await expect(alert).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-125 (21): the crash screen's promise, driven. A person who sees "Your work is still open in its studios" and presses Reload to
  // Home must find it there: the studio they were in has what they were doing, and no restore banner appears over it (the banner is for
  // a launch, or a render process that died - a hash change is neither).
  test('ErrorBoundary: after Reload to Home the work is still open in its studio, and no restore banner is offered over it (T-125 (21))', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('error-boundary-open')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Work in Stream Graphics: a text layer on the canvas.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })

      // The studio throws.
      await window.evaluate(() => {
        ;(globalThis as unknown as { __imagiiCrashTest?: boolean }).__imagiiCrashTest = true
        globalThis.location.hash = '#/__crash'
      })
      const alert = window.getByRole('alert')
      await expect(alert).toBeVisible({ timeout: 15_000 })
      await expect(alert.getByText(/^Your work is still open in its studios/)).toBeVisible()

      await window.getByRole('button', { name: 'Reload to Home' }).click()
      await expect(alert).toHaveCount(0, { timeout: 15_000 })
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()
      // No restore banner over Home: nothing was restarted, so there is nothing to restore.
      await expect(window.getByText(/autosaved your work/)).toHaveCount(0)

      // The work is where the screen said it was: back in the studio, the layer is still on the canvas (and the empty-state button is not).
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Layers (1)'), 'the text layer is still open in its studio').toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('button', { name: 'Start with text' })).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('T-123 (15) a renderer that dies is reloaded to Home and the autosave is offered again; a second death at once is left, not looped', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('renderer-gone')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))

    const app = await launchApp(userDataDir)
    // What main says about it: the handler logs, and the log is how a person finds out why the window blinked.
    const mainLog: string[] = []
    app.process().stdout?.on('data', (d: Buffer) => mainLog.push(String(d)))
    app.process().stderr?.on('data', (d: Buffer) => mainLog.push(String(d)))
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      // "Later" hides the banner for this renderer only, so its coming back is the proof of a NEW page.
      await window.getByRole('button', { name: 'Later' }).click()
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      await window.evaluate(() => {
        ;(globalThis as unknown as { __beforeCrash?: boolean }).__beforeCrash = true
      })

      // The page is read from MAIN (webContents.executeJavaScript), not through the Playwright Page:
      // the Page handle belongs to the process that died. A dead renderer never answers, so the read
      // is raced against a short timer and counts as "nothing there".
      const readWindow = (): Promise<{
        crashed: boolean
        page: { h1: string | null; marker: boolean; banner: boolean } | null
      }> =>
        app.evaluate(async ({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0]?.webContents
          if (!wc) return { crashed: true, page: null }
          const read = wc
            .executeJavaScript(
              `({ h1: document.querySelector('h1')?.textContent ?? null,
                  marker: globalThis.__beforeCrash === true,
                  banner: document.body.innerText.includes('imagii autosaved your work') })`
            )
            .catch(() => null)
          const page = await Promise.race([
            read,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
          ])
          return { crashed: wc.isCrashed(), page }
        })
      const crash = (): Promise<void> =>
        app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
        })

      // ── the first death: reloaded, on Home, a new page, the work offered again ──
      await crash()
      await expect
        .poll(readWindow, { timeout: 30_000, intervals: [500] })
        .toEqual({ crashed: false, page: { h1: 'imagii', marker: false, banner: true } })
      expect(mainLog.join('')).toMatch(/renderer process went away \(crashed/)

      // ── a second death straight after: left as it is, said so, and NOT reloaded in a loop ──
      await crash()
      await expect
        .poll(() => mainLog.join(''), { timeout: 15_000 })
        .toMatch(/renderer process went away \(crashed[^\n]*leaving the window as it is/)
      await new Promise((resolve) => setTimeout(resolve, 3000))
      expect((await readWindow()).crashed).toBe(true)
      // One reload, not two: the first log line for each death, and only one reload between them.
      expect((mainLog.join('').match(/renderer process went away/g) ?? []).length).toBe(2)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-124 (2): the T-123 (15) recovery called `webContents.reload()`, which keeps the URL's hash, so a crash inside a
  // studio reloaded INTO the dead studio: the page the reload lands on is `#/audio` again, no Home, no autosave banner,
  // while the log said "reloading to Home." The entry is now loaded fresh.
  test('T-124 (2) a renderer that dies inside a studio is reloaded to Home, with the autosave offered, not into the studio it died in', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('renderer-gone-studio')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))

    const app = await launchApp(userDataDir)
    const mainLog: string[] = []
    app.process().stdout?.on('data', (d: Buffer) => mainLog.push(String(d)))
    app.process().stderr?.on('data', (d: Buffer) => mainLog.push(String(d)))
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Into a studio, by the card a person clicks, so the hash really is the studio's.
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 20_000 })
      expect(await window.evaluate(() => globalThis.location.hash)).toBe('#/audio')

      const readWindow = (): Promise<{
        crashed: boolean
        page: { hash: string; h1: string | null; marker: boolean; banner: boolean } | null
      }> =>
        app.evaluate(async ({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0]?.webContents
          if (!wc) return { crashed: true, page: null }
          const read = wc
            .executeJavaScript(
              `({ hash: globalThis.location.hash,
                  h1: document.querySelector('h1')?.textContent ?? null,
                  marker: globalThis.__beforeCrash === true,
                  banner: document.body.innerText.includes('imagii autosaved your work') })`
            )
            .catch(() => null)
          const page = await Promise.race([
            read,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
          ])
          return { crashed: wc.isCrashed(), page }
        })
      await window.evaluate(() => {
        ;(globalThis as unknown as { __beforeCrash?: boolean }).__beforeCrash = true
      })
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
      })
      await expect
        .poll(readWindow, { timeout: 30_000, intervals: [500] })
        .toEqual({ crashed: false, page: { hash: '#/home', h1: 'imagii', marker: false, banner: true } })
      expect(mainLog.join('')).toMatch(/renderer process went away \(crashed[^\n]*reloading to Home\./)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-124 (3): the same reload also STRANDED the recording sessions the dead page had open (executed: four orphaned fds and
  // webms, then `recording:begin` refused with "too many open sessions"). The reload branch abandons the ones not yet closed.
  test('T-124 (3) a crash mid-take leaves no recording session behind: the temp webm is removed and a new take can begin', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('renderer-gone-take')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // A take in progress, through the preload bridge the Record studio uses: a session and some bytes.
      const sessionId = await window.evaluate(async () => {
        const api = (globalThis as unknown as {
          api: { recording: { begin: () => Promise<{ id: string }>; appendChunk: (id: string, b: ArrayBuffer) => Promise<void> } }
        }).api
        const { id } = await api.recording.begin()
        await api.recording.appendChunk(id, new Uint8Array(65536).buffer)
        return id
      })
      const temp = path.join(userDataDir, 'recordings', `${sessionId}.webm`)
      expect(existsSync(temp), 'the take has a temp file while it is being recorded').toBe(true)

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
      })
      await expect
        .poll(() => existsSync(temp), {
          timeout: 30_000,
          intervals: [250],
          message: 'the dead renderer\'s partial webm is still on disk after the reload'
        })
        .toBe(false)

      // The new page can begin a take: the dead one's session is not holding a slot. (The page is read from MAIN: the
      // Playwright Page handle belongs to the process that died.)
      const inPage = <T,>(code: string): Promise<T | null> =>
        app.evaluate(async ({ BrowserWindow }, js) => {
          const wc = BrowserWindow.getAllWindows()[0]?.webContents
          if (!wc) return null
          return Promise.race([wc.executeJavaScript(js).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))])
        }, code) as Promise<T | null>
      await expect
        .poll(() => inPage<string>(`document.querySelector('h1')?.textContent ?? null`), { timeout: 30_000, intervals: [500] })
        .toBe('imagii')
      const fresh = await inPage<string>(
        `(async () => { const { id } = await window.api.recording.begin(); await window.api.recording.abandon(id); return id })()`
      )
      expect(fresh).toMatch(/^[A-Za-z0-9_-]+$/)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-124 (5): AutosaveRestore gated on the file alone and `dismissed` is the component's own state, so every visit to Home
  // offered the autosave again - mid-session too - and Restore applied it over the LIVE session with no question (the undo
  // histories went with it) while the README and USER_GUIDE say the banner appears on launch and after a crash. It is for a
  // session that holds nothing: a launch, or the page a crash reloads to.
  async function editInStreamGraphics(window: Page): Promise<void> {
    await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
    await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
    await window.getByRole('button', { name: 'Start with text' }).click()
    await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
  }

  test('T-124 (5) the autosave is offered on launch, and not again over the work you are doing: edit, go Home, no banner', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('banner-midsession')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Launch: nothing is open, the work is offered.
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('button', { name: 'Restore' })).toBeVisible()

      // The person declines, starts something new, and comes back to Home.
      await window.getByRole('button', { name: 'Later' }).click()
      await editInStreamGraphics(window)
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()

      // Mid-session: no offer to apply a snapshot over the work, and no Restore button to press by mistake. The quiet status line stays.
      await expect(
        window.getByText(/imagii autosaved your work/),
        'the banner is offered again over the live session'
      ).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Restore' })).toHaveCount(0)
      await expect(window.getByText(/^Last autosave: /)).toBeVisible({ timeout: 15_000 })

      // And the work is still the work: the studio holds the text layer, not the seeded rect.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Kept rect')).toHaveCount(0)

      // A page with nothing in it (the launch, or what a crash reloads to) gets the offer again.
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('T-124 (5) a damaged autosave is announced at launch, not over a session that has work in it', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('banner-damaged-midsession')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      const banner = window.getByText(/imagii found an autosave from .*, but it's damaged/)
      await expect(banner).toBeVisible({ timeout: 20_000 })
      await editInStreamGraphics(window)
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(banner, 'the damaged-file notice came back over the live session').toHaveCount(0)
      // A page with nothing in it hears about the file on disk again (by then the live session's own autosave may have replaced
      // the damaged file with a good one, so either banner is the right answer).
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work|but it's damaged/)).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('RecentFilesMenu: a pick loads the video, Escape and click-outside dismiss, Clear empties the setting', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('recent-files')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'recent-source.mp4')
    await makeFixtureMp4(fixture)
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: ALL_TUTORIALS_SEEN,
      recentFiles: { video: [fixture] }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // The Close button confirms; accept so the studio returns to the
      // importer and the menu can be reached a second time.
      const dialogMessages: string[] = []
      window.on('dialog', (d) => {
        dialogMessages.push(d.message())
        void d.accept()
      })
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      await installToastLog(window)

      const toggle = window.getByRole('button', { name: 'Recent (1)' })
      const clearItem = window.getByRole('button', { name: 'Clear list' })
      await expect(toggle).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')

      // ── toggle opens ──
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(clearItem).toBeVisible()
      await expect(window.getByRole('button', { name: /recent-source\.mp4/ })).toBeVisible()

      // ── Escape dismisses (T-18) ──
      await window.keyboard.press('Escape')
      await expect(clearItem).toHaveCount(0)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')

      // ── click-outside dismisses (T-18) ──
      await toggle.click()
      await expect(clearItem).toBeVisible()
      await window.getByText('Drop a video here').click()
      await expect(clearItem).toHaveCount(0)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')

      // ── picking an entry loads that file for real ──
      await toggle.click()
      await window.getByRole('button', { name: /recent-source\.mp4/ }).click()
      await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('recent-source.mp4')).toBeVisible()
      // The probe the main process returned for the real file.
      await expect(window.getByText('320×240', { exact: false }).first()).toBeVisible()
      await expect
        .poll(() => readToastLog(window), { timeout: 20_000, intervals: [250] })
        .toContain('Video loaded')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-05-recent-loaded.png') })

      // Back to the importer so the menu is reachable again.
      await window.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
      expect(dialogMessages).toContain(
        'Close this video? 1 clip and its edits will be discarded.'
      )

      // ── Clear empties the list, in the UI and on disk ──
      await toggle.click()
      await clearItem.click()
      // With no entries the menu unmounts itself entirely.
      await expect(window.getByRole('button', { name: /^Recent/ })).toHaveCount(0)
      await expect
        .poll(() => readConfig(userDataDir).recentFiles?.video, {
          timeout: 15_000,
          intervals: [200]
        })
        .toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Modal contract (Templates dialog): Escape, scrim, inner click, focus trap, focus restore', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('modal-templates')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })

      // The Templates BUTTON only exists once the canvas has a layer; the
      // empty state shows the grid inline instead.
      await window.getByRole('button', { name: 'Start with text' }).click()
      const opener = window.getByRole('button', { name: 'Templates' })
      await expect(opener).toBeVisible({ timeout: 20_000 })

      // ── open: focus moves to the dialog's first focusable ──
      await opener.click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      // The dialog's own footer line — unique, unlike the title, which Modal
      // also renders as an sr-only heading for aria-labelledby.
      const footer = dialog.getByText(/clicking one replaces the current canvas/)
      await expect(footer).toBeVisible()
      const opened = await focusInfo(window)
      expect(opened.insideDialog).toBe(true)
      expect(opened.label).toBe('Close')

      // ── focus trap: Shift+Tab off the first element wraps to the last ──
      await window.keyboard.press('Shift+Tab')
      const wrappedBack = await focusInfo(window)
      expect(wrappedBack.insideDialog).toBe(true)
      // The dialog has ONE dismiss control now (T-92: the footer's second
      // "Cancel" went), so the last focusable is the last template card.
      expect(wrappedBack.label).not.toBe('Close')
      // …and Tab off the last wraps to the first.
      await window.keyboard.press('Tab')
      const wrappedForward = await focusInfo(window)
      expect(wrappedForward.insideDialog).toBe(true)
      expect(wrappedForward.label).toBe('Close')
      // A run of plain Tabs never escapes either.
      for (let i = 0; i < 8; i++) {
        await window.keyboard.press('Tab')
        expect((await focusInfo(window)).insideDialog).toBe(true)
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-06-templates-modal.png') })

      // ── a click INSIDE the card does not close (stopPropagation) ──
      await footer.click()
      await expect(dialog).toBeVisible()

      // ── Escape closes and focus returns to the opener ──
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      const restored = await focusInfo(window)
      expect(restored.dialogPresent).toBe(false)
      expect(restored.label).toBe('Templates')

      // ── scrim click closes ──
      await opener.click()
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      // The scrim is the dialog's parent; hit its top-left, far from the card.
      await window
        .getByRole('dialog')
        .locator('xpath=..')
        .click({ position: { x: 4, y: 4 } })
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect((await focusInfo(window)).label).toBe('Templates')

      // The canvas was never replaced — closing is not applying.
      await expect(window.getByText('Layers (1)')).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Modal contract (FixWizard): Escape, scrim, focus trap, focus restore', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('modal-fixwizard')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const wav = path.join(sourceDir, 'fixwizard-source.wav')
    await makeFixtureWav(wav)
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible({ timeout: 20_000 })
      await installToastLog(window)

      // Same synthetic-drop route export.spec documents, on the audio zone.
      await dropOnZone(window, '[data-tutorial="audio-importer"] .card', wav, 'fixwizard-source.wav')
      // Positive control for the negative at the end of this test: the toast
      // recorder demonstrably catches this page's toasts.
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toContain('Loaded')

      const opener = window.getByRole('button', { name: 'Help me fix this' })
      await expect(opener).toBeVisible({ timeout: 30_000 })

      // ── open ──
      await opener.click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.getByText('Quick fix · 1 of 3')).toBeVisible()
      await expect(
        dialog.getByText('Is there background noise (HVAC, fan, traffic)?').first()
      ).toBeVisible()
      const opened = await focusInfo(window)
      expect(opened.insideDialog).toBe(true)
      // T-119 (8): the question opens on its first answer (it used to open on Close, the first thing in the
      // dialog), because every later step lands on ITS first answer and the wizard is answered from the keyboard.
      expect(opened.label).toBe('None to speak of')

      // ── focus trap wraps in both directions ──
      // One step back from the first answer is Close; one more goes past the start and wraps to the last answer.
      await window.keyboard.press('Shift+Tab')
      expect((await focusInfo(window)).label).toBe('Close')
      await window.keyboard.press('Shift+Tab')
      const wrappedBack = await focusInfo(window)
      expect(wrappedBack.insideDialog).toBe(true)
      expect(wrappedBack.label).toBe('Yes, pretty loud')
      await window.keyboard.press('Tab')
      const wrappedForward = await focusInfo(window)
      expect(wrappedForward.insideDialog).toBe(true)
      expect(wrappedForward.label).toBe('Close')
      for (let i = 0; i < 5; i++) {
        await window.keyboard.press('Tab')
        expect((await focusInfo(window)).insideDialog).toBe(true)
      }

      // ── Escape closes and focus returns to the opener ──
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect((await focusInfo(window)).label).toBe('Help me fix this')

      // ── scrim click closes ──
      await opener.click()
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window
        .getByRole('dialog')
        .locator('xpath=..')
        .click({ position: { x: 4, y: 4 } })
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // Dismissing the wizard applies NOTHING. Both dismissals route through
      // `reset()`, which never calls patchChain, so the confirmation the
      // Apply button raises must never have been shown. Exact copy, and the
      // recorder that would have caught it is proven live above.
      expect(await readToastLog(window)).not.toContain(
        'Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.'
      )
      await expect(
        window.getByText('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.')
      ).toHaveCount(0)
      // And the studio is still on the loaded source, not back at the importer.
      await expect(window.getByText('Drop audio or video here')).toHaveCount(0)
      await expect(window.getByText('fixwizard-source.wav')).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })
})


/**
 * T-86 — a tour needs something to point at, and Skip means skip.
 *
 * Two defects shared one hook. `useTutorial` opened the tour on a first visit
 * whatever the studio was showing, and on an EMPTY studio (nothing but the
 * importer) that put a coachmark over nothing, telling the user to drag
 * handles that were not there. And `onClose(false)` — Skip and Escape — never
 * wrote the first-visit flag, so a user who dismissed the tour got it back on
 * every visit, forever.
 *
 * The rule now: a tour is held until the studio has content (the first import
 * opens it), it shows only the steps whose target is on the page, and any way
 * out of it — Skip, Escape, Done — persists. The tests read the expected step
 * list off the DOM (the same "is there a target" question the app asks) AND
 * pin it from outside: the importer's own step must be missing once the
 * importer is gone, and the tour must be shorter than the definition.
 */

/** Titles of the steps a tour should show right now: untargeted ones, plus those whose target is on screen. */
async function stepsWithATarget(window: Page, def: TutorialDef): Promise<string[]> {
  return window.evaluate(
    (steps) =>
      steps
        .filter((s) => {
          if (s.sel === null) return true
          const el = document.querySelector(s.sel)
          return el !== null && el.getClientRects().length > 0
        })
        .map((s) => s.title),
    def.steps.map((s) => ({ sel: s.targetSelector ?? null, title: s.title }))
  )
}

/** Walk the open tour to Done, asserting each step against `expected` (title, counter, cutout). */
async function walkTour(window: Page, def: TutorialDef, expected: string[]): Promise<void> {
  const dialog = window.getByRole('dialog')
  for (let i = 0; i < expected.length; i++) {
    await expect(
      window.getByText(`${def.title} · ${i + 1} of ${expected.length}`, { exact: true })
    ).toBeVisible()
    await expect(dialog.locator('h3')).toHaveText(expected[i] ?? '')
    const step = def.steps.find((s) => s.title === expected[i])
    // A targeted step draws its cutout; an untargeted one is a plain card. A
    // targeted step with NO cutout is the orphan this ticket exists to remove.
    await expect(window.locator('svg rect[stroke]')).toHaveCount(step?.targetSelector ? 1 : 0)
    await window
      .getByRole('button', { name: i === expected.length - 1 ? 'Done' : 'Next' })
      .click()
  }
  await expect(window.getByRole('dialog')).toHaveCount(0)
}

test.describe('T-86 tours wait for something to point at', () => {
  test('an empty video studio gets no tour; the first import opens it, and it shows only steps with a target', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tour-gated')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'tour-source.mp4')
    await makeFixtureMp4(fixture)
    // Only the video tour is unseen, as on a first visit.
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: { audio: true, image: true, ai: true }
    })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })

      // ── empty studio: no coachmark over the importer, and the flag survives ──
      // The old build opened the tour within one settings round trip of the
      // studio mounting; two seconds is far past that.
      await window.waitForTimeout(2_000)
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect(readConfig(userDataDir).tutorialSeen?.video).toBeUndefined()

      // ── the first import opens it ──
      await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-source.mp4')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })

      const expected = await stepsWithATarget(window, videoTutorial)
      const importTitle = videoTutorial.steps.find((s) => s.id === 'import')?.title
      expect(importTitle).toBeDefined()
      expect(expected, 'the importer is gone, so its step is not in the tour').not.toContain(
        importTitle
      )
      expect(expected.length).toBeLessThan(videoTutorial.steps.length)
      expect(expected.length).toBeGreaterThan(3)

      await walkTour(window, videoTutorial, expected)
      // Done persists, as it always has.
      await expect
        .poll(() => readConfig(userDataDir).tutorialSeen?.video, { timeout: 15_000 })
        .toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  for (const exit of ['Skip', 'Escape'] as const) {
    test(`${exit} persists: the tour is not back on the next visit or the next launch`, async () => {
      test.setTimeout(240_000)
      const root = makeRoot(`tour-${exit.toLowerCase()}`)
      const userDataDir = path.join(root, 'userData')
      const sourceDir = path.join(root, 'source')
      mkdirSync(sourceDir, { recursive: true })
      const fixture = path.join(sourceDir, 'tour-source.mp4')
      await makeFixtureMp4(fixture)
      seedUserData(userDataDir, {
        welcomeSeen: true,
        tutorialSeen: { audio: true, image: true, ai: true }
      })

      const openVideoStudioWithClip = async (app: ElectronApplication): Promise<Page> => {
        const window = await app.firstWindow()
        await waitForHome(window)
        await window.locator('a', { hasText: 'Video Studio' }).first().click()
        await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
        await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-source.mp4')
        return window
      }

      const first = await launchApp(userDataDir)
      try {
        const window = await openVideoStudioWithClip(first)
        const tour = window.getByRole('dialog')
        await expect(tour).toBeVisible({ timeout: 30_000 })

        if (exit === 'Skip') await window.getByRole('button', { name: 'Skip' }).click()
        else await window.keyboard.press('Escape')
        await expect(tour).toHaveCount(0)

        // The write is what makes the label honest. On the old build this stayed
        // undefined for as long as the poll was willing to wait.
        await expect
          .poll(() => readConfig(userDataDir).tutorialSeen?.video, { timeout: 15_000 })
          .toBe(true)

        // ── the next visit, same session: Home and back ──
        await window.locator('a[href="#/home"]').first().click()
        await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
        await window.locator('a', { hasText: 'Video Studio' }).first().click()
        // The loaded studio is still there (the store outlives the route)…
        await expect(window.getByRole('button', { name: /^Export/ }).first()).toBeVisible({
          timeout: 20_000
        })
        // …and no tour opens over it.
        await window.waitForTimeout(2_000)
        await expect(window.getByRole('dialog')).toHaveCount(0)

        // The other flags were seeded, and nothing else was written.
        expect(readConfig(userDataDir).tutorialSeen?.audio).toBe(true)
      } finally {
        await first.close()
      }

      // ── the next LAUNCH, same userData ──
      const second = await launchApp(userDataDir)
      try {
        const window = await openVideoStudioWithClip(second)
        await expect(window.getByRole('button', { name: /^Export/ }).first()).toBeVisible({
          timeout: 30_000
        })
        await window.waitForTimeout(2_000)
        await expect(window.getByRole('dialog')).toHaveCount(0)
      } finally {
        await second.close()
        cleanup(root)
      }
    })
  }

  test('Audio Studio and Stream Graphics hold their tours until there is content; References has one from the first visit', async () => {
    test.setTimeout(240_000)
    const root = makeRoot('tour-others')
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const wav = path.join(sourceDir, 'tour-audio.wav')
    await makeFixtureWav(wav)
    // Nothing seen: every studio is on its first visit.
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: {} })

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      const goHome = async (): Promise<void> => {
        await window.locator('a[href="#/home"]').first().click()
        await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      }

      // ── References: its tab strip is on screen from the first frame ──
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
      await walkTour(window, aiTutorial, await stepsWithATarget(window, aiTutorial))
      await expect
        .poll(() => readConfig(userDataDir).tutorialSeen?.ai, { timeout: 15_000 })
        .toBe(true)
      await goHome()

      // ── Audio Studio: the importer alone is nothing to tour ──
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible({ timeout: 20_000 })
      await window.waitForTimeout(2_000)
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect(readConfig(userDataDir).tutorialSeen?.audio).toBeUndefined()
      await dropOnZone(window, '[data-tutorial="audio-importer"] .card', wav, 'tour-audio.wav')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      const audioSteps = await stepsWithATarget(window, audioTutorial)
      expect(audioSteps.length).toBeLessThan(audioTutorial.steps.length)
      await walkTour(window, audioTutorial, audioSteps)
      await expect
        .poll(() => readConfig(userDataDir).tutorialSeen?.audio, { timeout: 15_000 })
        .toBe(true)
      await goHome()

      // ── Stream Graphics: the template picker is not a canvas ──
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await window.waitForTimeout(2_000)
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect(readConfig(userDataDir).tutorialSeen?.image).toBeUndefined()
      await window.locator('[data-tutorial="image-import"] button.card').first().click()
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
      const imageSteps = await stepsWithATarget(window, imageTutorial)
      expect(imageSteps.length).toBeGreaterThan(3)
      await walkTour(window, imageTutorial, imageSteps)
      await expect
        .poll(() => readConfig(userDataDir).tutorialSeen?.image, { timeout: 15_000 })
        .toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })
})

test.describe('T-131: review-gate fixes, sweep 17 (Home and the tours)', () => {
  /** Launch with the video tour unseen, import a video (that opens the tour) and stop at its first step. */
  async function openVideoTour(label: string): Promise<{ app: ElectronApplication; window: Page; root: string; userDataDir: string }> {
    const root = makeRoot(label)
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    const fixture = path.join(sourceDir, 'tour-source.mp4')
    await makeFixtureMp4(fixture)
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: { audio: true, image: true, ai: true } })
    const app = await launchApp(userDataDir)
    const window = await app.firstWindow()
    await waitForHome(window)
    await window.locator('a', { hasText: 'Video Studio' }).first().click()
    await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 20_000 })
    await dropOnZone(window, '[data-tutorial="video-import"] .card', fixture, 'tour-source.mp4')
    await expect(window.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
    return { app, window, root, userDataDir }
  }

  /** Click Next (one press each) until the card's title is `title`. */
  async function advanceTo(window: Page, title: string): Promise<void> {
    const dialog = window.getByRole('dialog')
    for (let i = 0; i < 30; i++) {
      if ((await dialog.locator('h3').innerText()) === title) return
      await dialog.getByRole('button', { name: 'Next' }).click()
      await window.waitForTimeout(60)
    }
    throw new Error(`the tour never reached "${title}"`)
  }

  // (6) next() advanced once per discrete click, so a double-click skipped a step, and where two steps share a target and a placement ("Pick
  // your platforms", "Add a watermark" and "Export" all point at the Export card) Next stays where it was, so the second press lands on it.
  test('a double-click on Next, Back or the scrim moves the tour ONE step (T-131 (6))', async () => {
    test.setTimeout(180_000)
    const { app, window, root } = await openVideoTour('tour-dblclick')
    try {
      const dialog = window.getByRole('dialog')
      const title = (): Promise<string> => dialog.locator('h3').innerText()
      await advanceTo(window, 'Pick your platforms')

      // Next: one step, to the very next title ("Add a watermark"), not the one after it.
      await dialog.getByRole('button', { name: 'Next' }).dblclick()
      await expect(dialog.locator('h3')).toHaveText('Add a watermark')
      await window.waitForTimeout(400)
      expect(await title(), 'the second press of the double-click did not skip a step').toBe('Add a watermark')

      // Back: one step, to "Pick your platforms" again, not two.
      await dialog.getByRole('button', { name: 'Back' }).dblclick()
      await expect(dialog.locator('h3')).toHaveText('Pick your platforms')
      await window.waitForTimeout(400)
      expect(await title(), 'nor did it go back two').toBe('Pick your platforms')

      // The scrim (a press anywhere outside the card) is Next too, and it is one step per double-click as well.
      const card = (await dialog.boundingBox()) as { x: number; y: number; width: number; height: number }
      const outside = { x: card.x > 60 ? 10 : card.x + card.width + 10, y: 10 }
      await window.mouse.dblclick(outside.x, outside.y)
      await expect(dialog.locator('h3')).toHaveText('Add a watermark')
      await window.waitForTimeout(400)
      expect(await title(), 'the scrim moves one step per double-click').toBe('Add a watermark')

      // A person who presses once at their own pace still moves one step each time: the rule is the repeat, not the speed.
      await dialog.getByRole('button', { name: 'Next' }).click()
      await expect(dialog.locator('h3')).toHaveText('Export')
      await dialog.getByRole('button', { name: 'Back' }).click()
      await expect(dialog.locator('h3')).toHaveText('Add a watermark')
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // (6)+(8)+(7) The last step: it names the ? key beside the round ? button, a double-click on Done closes the tour and goes no further (the
  // second press lands on what the centered card stood over, which was a studio control), and the studio's hint lines name the key too.
  test('the last step names the ? key; a double-click on Done ends the tour and its second press reaches nothing; the Player and Timeline hints name the key (T-131 (6), (7), (8))', async () => {
    test.setTimeout(180_000)
    const { app, window, root, userDataDir } = await openVideoTour('tour-done')
    try {
      const dialog = window.getByRole('dialog')
      await advanceTo(window, "You're all set")
      await expect(dialog).toContainText('The ? button in the header replays this tour any time, and the ? key on your keyboard lists every shortcut on the screen you are on.')
      await window.evaluate(() => {
        const w = window as unknown as { __clicks: Array<{ detail: number; what: string }> }
        w.__clicks = []
        document.addEventListener('click', (e) => {
          const el = e.target as HTMLElement
          w.__clicks.push({ detail: e.detail, what: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 30)}`.trim() })
        })
      })
      await dialog.getByRole('button', { name: 'Done' }).dblclick()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await window.waitForTimeout(600)
      const landed = await window.evaluate(() => (window as unknown as { __clicks: Array<{ detail: number; what: string }> }).__clicks)
      // The first press is the tour's own (it is gone with the card); the repeat must not have reached the page under it.
      expect(landed.filter((c) => c.detail > 1), 'the second press of the double-click reached the page under the card').toEqual([])
      await expect.poll(() => readConfig(userDataDir).tutorialSeen?.video, { timeout: 15_000 }).toBe(true)

      // (7): the key is named where a person looks for it, in the Player's hint line and the Timeline's.
      const hints = window.locator('p.text-xs.text-ink-dim').filter({ hasText: 'all shortcuts' })
      await expect(hints, 'the Player\'s line and the Timeline\'s').toHaveCount(2)
      await expect(hints.first()).toContainText('set in/out')
      await expect(hints.first().locator('kbd', { hasText: /^\?$/ })).toHaveCount(1)
      await expect(hints.nth(1)).toContainText('at the playhead')
      await expect(hints.nth(1).locator('kbd', { hasText: /^\?$/ })).toHaveCount(1)
      // ...and the key does what the line says.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toContainText('Keyboard shortcuts')
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // (5) Home's two project buttons go straight to a native dialog. The stand-in answers after 300 ms; the second press lands in that window.
  test('a double-click on Open project opens ONE chooser and opens the project once; a double-click on Save project opens ONE dialog and writes ONE file (T-131 (5))', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('home-dblclick')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: { video: true, audio: true, image: true, ai: true } })
    const projectFile = path.join(root, 'canvas.imagii.json')
    writeFileSync(projectFile, JSON.stringify(canvasProject('Layer from the opened project')), 'utf8')
    const saved = path.join(root, 'saved-once.imagii.json')
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)

      await recordSlowChooser(app, { files: [projectFile, projectFile], delayMs: 300 })
      await window.getByRole('button', { name: 'Open project' }).dblclick()
      await expect.poll(() => readToastLog(window), { timeout: 30_000, intervals: [200] }).toContain('Project loaded')
      await window.waitForTimeout(800)
      expect((await chooserCalls(app)).filter((c) => !c.save), 'Open project: one chooser').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Project loaded'), 'opened once').toHaveLength(1)

      await recordSlowChooser(app, { saveAs: saved, delayMs: 300 })
      await window.getByRole('button', { name: 'Save project' }).dblclick()
      await expect.poll(() => existsSync(saved), { timeout: 30_000, intervals: [200] }).toBe(true)
      await window.waitForTimeout(800)
      expect((await chooserCalls(app)).filter((c) => c.save), 'Save project: one Save dialog').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Project saved'), 'saved once').toHaveLength(1)
      const written = JSON.parse(readFileSync(saved, 'utf8')) as { imageCanvas?: { doc?: { layers?: Array<{ name: string }> } } }
      expect(written.imageCanvas?.doc?.layers?.[0]?.name, 'and the file holds the project that was opened').toBe('Layer from the opened project')
      expect(readdirSync(root).filter((f) => f.endsWith('.imagii.json')).sort(), 'one new file, not two').toEqual(['canvas.imagii.json', 'saved-once.imagii.json'])
    } finally {
      await app.close()
      cleanup(root)
    }
  })
})

// T-136 (11): the banner's Clear deleted the file and said "Autosave cleared", and the line "Last autosave: N min ago" stayed up under it - the dismissed
// branch draws from the `info` read when the page mounted, and a successful Clear did not change it. It lasted until the next visit to Home, which is
// the one place a person looks for it. A successful Clear is a file that is not there.
test.describe('T-136 (11): the status line goes with the file', () => {
  test('after Clear on the healthy banner there is no "Last autosave" line, at once, and none after a visit either', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('t136-clear-healthy')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect.poll(async () => await readToastLog(window), { timeout: 20_000 }).toContain('Autosave cleared')
      expect(existsSync(autosaveFile(userDataDir)), 'the file is gone').toBe(false)
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      // The point of the case: not "after a reload" - right now, in the same visit.
      await expect(window.getByText(/^Last autosave: /), 'no backup is reported: there is none').toHaveCount(0)
      await window.waitForTimeout(500)
      await expect(window.getByText(/^Last autosave: /)).toHaveCount(0)

      // And a visit afterwards agrees with it.
      await window.reload()
      await waitForHome(window)
      await expect(window.getByText(/^Last autosave: /)).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('the control: Later keeps the file and the line says so', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('t136-later')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, canvasProject('Kept rect'))
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await expect(window.getByText(/imagii autosaved your work/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Later' }).click()
      await expect(window.getByText(/^Last autosave: /)).toBeVisible()
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('after Clear on the damaged banner there is no "Last autosave" line either', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('t136-clear-damaged')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      await expect(window.getByText(/but it's damaged/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect.poll(async () => await readToastLog(window), { timeout: 20_000 }).toContain('Autosave cleared')
      expect(existsSync(autosaveFile(userDataDir))).toBe(false)
      await expect(window.getByText(/but it's damaged/)).toHaveCount(0)
      await expect(window.getByText(/^Last autosave: /), 'a deleted file is not a backup').toHaveCount(0)
      await window.waitForTimeout(500)
      await expect(window.getByText(/^Last autosave: /)).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a Clear that is refused leaves the banner, the file and (after Dismiss) the line: nothing says the file is gone', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('t136-clear-refused')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    seedAutosave(userDataDir, '{"schemaVersion":2,"savedAt":175534')
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      await app.evaluate(async ({ ipcMain }) => {
        ipcMain.removeHandler('autosave:clear')
        ipcMain.handle('autosave:clear', () => {
          throw new Error('could not delete autosave.json')
        })
      })
      await expect(window.getByText(/but it's damaged/)).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect.poll(async () => (await readToastLog(window)).join(' | '), { timeout: 20_000 }).toContain("Couldn't clear the autosave")
      expect(existsSync(autosaveFile(userDataDir)), 'the file is still there').toBe(true)
      await window.getByRole('button', { name: 'Dismiss' }).click()
      await expect(window.getByText(/^Last autosave: /), 'and the line still reports it').toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })
})

// T-137 (6): ONE size rule for Save, Open and autosave. A project over 50 MiB used to save ("Project saved", 56.9 MiB of pretty-printed JSON), refuse to
// open again with the damaged-file sentence, and stop autosaving with a console line. Save now refuses before it asks where to save, in a sentence that
// names the size; Open says the project is too large (not damaged); autosave stops and says so, once, in a toast. The project here is a seeded file one
// text layer short of the limit (a picture layer whose src is padded: it need not decode, the document just carries it), so a real "+ Add text" in Stream
// Graphics is the edit that crosses the line, and nothing is faked in the app: the files on disk are the evidence.
test.describe('T-137 (6): a project over the size limit', () => {
  const LIMIT = 50 * 1024 * 1024

  /** A project file whose text is exactly `size` characters: one picture layer, its src padded to fit. */
  function projectFileOfSize(size: number): string {
    const make = (src: string): string =>
      JSON.stringify({
        schemaVersion: 5,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        imageCanvas: {
          doc: {
            width: 1200,
            height: 800,
            background: '#ffffff',
            layers: [
              { id: 'bigpic', type: 'image', name: 'Huge picture', visible: true, locked: false, x: 60, y: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, src, width: 100, height: 100 }
            ]
          }
        }
      })
    return make('A'.repeat(size - make('').length))
  }

  const SAVE_REFUSAL = /^This project is too large to save \(\d+\.\d MB; the limit is 50 MB\)\. Remove or shrink large images on the canvas, then save again\.$/
  const AUTOSAVE_PAUSED = /^Autosave is paused: this project is too large to keep \(\d+\.\d MB; the limit is 50 MB\)\. Remove or shrink large images on the canvas and it will start again\.$/
  const OPEN_REFUSAL = /^That project is too large to open \(\d+\.\d MB; the limit is 50 MB\)\./

  /** A launched app that has opened the seeded project one text layer short of the limit (so it is a project that fits), on Home. */
  async function openNearlyFull(label: string, answers: { saveAs?: string; files?: string[] } = {}): Promise<{
    app: ElectronApplication
    window: Page
    root: string
    userDataDir: string
    nearly: string
  }> {
    const root = makeRoot(label)
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    // Under the limit by 150 characters: the captured project adds a `place` record (about 55), so it opens, saves and autosaves; one text layer (216
    // characters, and its comma) is what takes it over.
    const nearly = path.join(root, 'nearly.imagii.json')
    writeFileSync(nearly, projectFileOfSize(LIMIT - 150), 'utf8')
    const app = await launchApp(userDataDir)
    const window = await app.firstWindow()
    await waitForHome(window)
    await installToastLog(window)
    await recordSlowChooser(app, { files: [nearly, ...(answers.files ?? [])], ...(answers.saveAs ? { saveAs: answers.saveAs } : {}) })
    await window.getByRole('button', { name: 'Open project' }).click()
    await expect.poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] }).toContain('Project loaded')
    return { app, window, root, userDataDir, nearly }
  }

  /** One real "+ Add text" in Stream Graphics: the edit that takes the seeded project over the limit. */
  async function addTextInStreamGraphics(window: Page, layers: number): Promise<void> {
    if (layers === 2) {
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 30_000 })
    }
    await window.locator('[data-tutorial="image-import"]').getByRole('button', { name: '+ Add text' }).click()
    await expect(window.getByRole('heading', { name: `Layers (${layers})` })).toBeVisible()
  }

  test('a project that fits is saved as the compact text that was measured, within the limit, and the file opens again', async () => {
    test.setTimeout(240_000)
    const savedOnce = path.join(os.tmpdir(), `imagii-e2e-t137-saved-${Date.now().toString(36)}.imagii.json`)
    const { app, window, root } = await openNearlyFull('t137-fits', { saveAs: savedOnce, files: [savedOnce] })
    try {
      await window.getByRole('button', { name: 'Save project' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] }).toContain('Project saved')
      expect(statSync(savedOnce).size, 'a file Save writes is within the limit it was measured against').toBeLessThanOrEqual(LIMIT)
      expect(readFileSync(savedOnce, 'utf8').startsWith('{"schemaVersion"'), 'compact JSON: the text that was measured').toBe(true)
      // ...and it is a file Open accepts (the point of one rule): opened again, in the same app.
      await window.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => t === 'Project loaded').length, { timeout: 120_000, intervals: [250] })
        .toBe(2)
    } finally {
      await app.close()
      cleanup(root)
      rmSync(savedOnce, { force: true })
    }
  })

  test('autosave of a project over the limit stops and says so, once, in a toast; the file on disk stays the last project that fit', async () => {
    test.setTimeout(300_000)
    const { app, window, root, userDataDir } = await openNearlyFull('t137-autosave')
    try {
      // The control for "stops": the fitting project is autosaved.
      await expect.poll(() => readAutosaveLayers(userDataDir) ?? 0, { timeout: 60_000, intervals: [500] }).toBe(1)
      await addTextInStreamGraphics(window, 2)
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => AUTOSAVE_PAUSED.test(t)).length, { timeout: 60_000, intervals: [500] })
        .toBe(1)
      // More edits while it stays over: the one toast is not raised again, and the file on disk is still the fitting project.
      await addTextInStreamGraphics(window, 3)
      await window.waitForTimeout(13_000)
      expect((await readToastLog(window)).filter((t) => AUTOSAVE_PAUSED.test(t)), 'told once').toHaveLength(1)
      expect(readAutosaveLayers(userDataDir), 'and nothing over the limit was written').toBe(1)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Save refuses a project over the limit in a sentence, BEFORE the dialog, and writes nothing', async () => {
    test.setTimeout(300_000)
    const never = path.join(os.tmpdir(), `imagii-e2e-t137-never-${Date.now().toString(36)}.imagii.json`)
    const { app, window, root } = await openNearlyFull('t137-save', { saveAs: never })
    try {
      await addTextInStreamGraphics(window, 2)
      await window.evaluate(() => {
        window.location.hash = '#/home'
      })
      await waitForHome(window)
      await window.getByRole('button', { name: 'Save project' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => SAVE_REFUSAL.test(t)).length, { timeout: 60_000, intervals: [250] })
        .toBe(1)
      expect((await chooserCalls(app)).filter((c) => c.save), 'the person was never asked where to save a file that would not be written').toHaveLength(0)
      expect(existsSync(never)).toBe(false)
      expect((await readToastLog(window)).filter((t) => t === 'Project saved'), 'and it never said it saved').toHaveLength(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Open of a file past the limit names the size, not "damaged or saved by a newer version"', async () => {
    test.setTimeout(240_000)
    const tooBig = path.join(os.tmpdir(), `imagii-e2e-t137-too-big-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(tooBig, projectFileOfSize(LIMIT + 5000), 'utf8')
    const root = makeRoot('t137-open')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN })
    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      await recordSlowChooser(app, { files: [tooBig] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => OPEN_REFUSAL.test(t)).length, { timeout: 120_000, intervals: [250] })
        .toBe(1)
      expect((await readToastLog(window)).some((t) => /damaged|newer version/.test(t))).toBe(false)
    } finally {
      await app.close()
      cleanup(root)
      rmSync(tooBig, { force: true })
    }
  })
})

/** The number of layers in the canvas the autosave file holds, or null when there is no readable autosave. */
function readAutosaveLayers(userDataDir: string): number | null {
  const file = autosaveFile(userDataDir)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { imageCanvas?: { doc?: { layers?: unknown[] } } }
    return parsed.imageCanvas?.doc?.layers?.length ?? null
  } catch {
    return null
  }
}
