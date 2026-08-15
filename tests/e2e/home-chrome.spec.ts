import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import { videoTutorial } from '../../src/renderer/src/tutorials/videoTutorial'

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
 * Six product defects were found while writing this spec. Three have since
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
 * The other three are still open, each asserted at the boundary where it
 * bites and carrying a `T-21 FINDING` comment there:
 *   D. AutosaveRestore's corruption branch requires `info.ageMs`, which the
 *      reader never returns for a file that fails validation, so the Clear /
 *      Dismiss banner cannot render (also pinned in
 *      tests/unit/autosaveCorruptInfo.test.ts).
 *   E. computeTooltipPosition clamps 'top'/'bottom' coachmarks to the viewport
 *      but not 'left'/'right', so the video tutorial's step 2 renders 16 px
 *      inside a 1280 px window and its buttons cannot be clicked.
 *   F. Enter (with focus off a button) advances the tutorial two steps.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

/** All four tutorial flags — the seed that keeps a coachmark off the page. */
const ALL_TUTORIALS_SEEN = { video: true, audio: true, image: true, ai: true }

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

/** export.spec's toast recorder: toasts auto-dismiss, so a poll would race them. */
async function installToastLog(window: Page): Promise<void> {
  await window.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __toastLog: string[] }).__toastLog = log
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return
          const text = (node as HTMLElement).textContent ?? ''
          if (text.trim()) log.push(text.trim())
        })
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

function readToastLog(window: Page): Promise<string[]> {
  return window.evaluate(
    () => (window as unknown as { __toastLog?: string[] }).__toastLog ?? []
  )
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

/** The coachmark's current step number, read off its own counter. */
async function currentStep(window: Page): Promise<number> {
  const text = await window.locator('div[role="dialog"] span', { hasText: /· \d+ of \d+$/ }).first().textContent()
  const match = /· (\d+) of \d+$/.exec((text ?? '').trim())
  if (!match?.[1]) throw new Error(`tutorial step counter not found in: ${String(text)}`)
  return Number(match[1])
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
      // The version line is filled over IPC, so it also proves the preload
      // bridge is live on the very first screen the user ever sees.
      await expect(window.getByText(/^imagii v\d/)).toBeVisible({ timeout: 15_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-01-welcome.png') })

      await window.getByRole('button', { name: "Let's go" }).click()

      // 1. Home renders — the app left the welcome phase for real.
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('Hi Mike — pick a studio to get started.')).toBeVisible()
      await expect(window.locator('h1', { hasText: 'Hi Mike!' })).toHaveCount(0)
      // 2. And the flag is on disk, so the next launch skips Welcome.
      await expect
        .poll(() => readConfig(userDataDir).welcomeSeen, { timeout: 15_000, intervals: [200] })
        .toBe(true)
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
      await expect(dialog.getByText('Save full app state to .imagii.json')).toBeVisible()
      await expect(dialog.getByText('Press ? again to close.')).toBeVisible()

      // The overlay's own close control.
      await window.getByRole('button', { name: 'Close shortcuts' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // Reopen and close with Modal's Escape instead.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
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

  test('Home global Undo reverts the restored canvas and the "last:" readout names the studio', async () => {
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

      // The restore is a canvas mutation, so the tracker names that studio…
      await expect(window.getByText('last: Image Canvas')).toBeVisible({ timeout: 20_000 })
      // …and the button it enables really does hold an undoable step.
      await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled()
      await window.getByRole('button', { name: 'Undo' }).click()

      // End state: the canvas is back to its empty document — the Stream
      // Graphics route shows the empty-state template picker, not the layer.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Undoable rect')).toHaveCount(0)

      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // T-32 (was T-21 finding B): the record is module-level now, so walking
      // into a studio and back does not wipe it. The one step here has been
      // undone, so Undo is spent — but the undone step is still on the redo
      // side after the round trip, which the old Home-scoped tracker lost.
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
      await expect(window.getByText('last: Image Canvas')).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: 'Undo' }).click()

      // T-32 (was T-21 finding C): the click itself re-derives enablement.
      // The old hook read canUndo/canRedo off getState() during render and
      // swallowed the store event its own undo() raised, so Home never
      // re-rendered: Redo stayed dark and Undo stayed lit over an empty past.
      await expect(window.getByRole('button', { name: 'Redo' })).toBeEnabled()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()

      // And Redo is reachable through the UI, not just enabled: the click puts
      // the restored layer back on the canvas.
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(window.getByText('last: Image Canvas')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Undo' })).toBeEnabled()
      await expect(window.getByRole('button', { name: 'Redo' })).toBeDisabled()

      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Redoable rect')).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Home global Undo walks the studios newest-first — a video edit and a canvas edit', async () => {
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

      // ── then a step made inside Stream Graphics ──
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await goHome()
      await expect(window.getByText('last: Image Canvas')).toBeVisible()

      // ── first Undo takes the canvas step, the newest one ──
      await undo.click()
      await expect(window.getByText('last: Video Studio')).toBeVisible()
      await expect(redo).toBeEnabled()
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 20_000 })
      await goHome()
      // …and left the video edit alone.
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(2)).toBeVisible({ timeout: 20_000 })
      await goHome()

      // ── second Undo takes the video step ──
      await undo.click()
      await expect(window.getByText('last: no recent change')).toBeVisible()
      await expect(undo).toBeDisabled()
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(1)).toBeVisible({ timeout: 20_000 })
      await goHome()

      // ── Redo mirrors it: video first, then the canvas ──
      await expect(redo).toBeEnabled()
      await redo.click()
      await expect(window.getByText('last: Video Studio')).toBeVisible()
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(clipList(2)).toBeVisible({ timeout: 20_000 })
      await goHome()

      await redo.click()
      await expect(window.getByText('last: Image Canvas')).toBeVisible()
      await expect(redo).toBeDisabled()
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('AutosaveRestore: Later only hides the banner, Discard deletes the file', async () => {
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

      // ── Discard: file deleted from disk ──
      await window.getByRole('button', { name: 'Discard' }).click()
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

  test('AutosaveRestore: a corrupt autosave offers nothing and is left on disk', async () => {
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
      // Give both autosave IPC calls (read + info) time to resolve and paint.
      await window.waitForTimeout(1500)

      // No restore offer for a file that fails validation — the important
      // half: a corrupt autosave must never be applied to the stores.
      await expect(window.getByText(/imagii autosaved your work/)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Restore' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Discard' })).toHaveCount(0)

      // T-21 FINDING D (not fixed here): the corruption notice — "An autosave
      // was found (…) but failed validation: …" with its Clear / Dismiss
      // buttons — cannot render. AutosaveRestore gates it on
      // `result.info.ageMs !== undefined`, but main's readAndValidate returns
      // `{ exists, filePath, sizeBytes }` with NO ageMs whenever validation
      // fails (there is no savedAt to measure). Both controls are dead; the
      // shape mismatch is pinned in tests/unit/autosaveCorruptInfo.test.ts.
      await expect(window.getByText(/but failed validation/)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Clear' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
      // Same reason the banner is missing: info.ageMs is undefined, so even
      // the "Last autosave: …" line stays away.
      await expect(window.getByText(/^Last autosave: /)).toHaveCount(0)

      // The file is left alone — a corrupt autosave is not silently deleted,
      // so the user can still recover it by hand.
      expect(existsSync(autosaveFile(userDataDir))).toBe(true)
      expect(readFileSync(autosaveFile(userDataDir), 'utf8')).toBe(
        '{"schemaVersion":2,"savedAt":175534'
      )
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
    // Every tutorial flag EXCEPT video — the coachmark auto-starts on /video.
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: { audio: true, image: true, ai: true }
    })
    const total = videoTutorial.steps.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()

      const counter = (n: number): ReturnType<Page['getByText']> =>
        window.getByText(`Video Studio · ${n} of ${total}`, { exact: true })

      // Auto-start on first visit, at step 1 with the real step copy.
      await expect(counter(1)).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('Welcome to Video Studio')).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'home-04-tutorial.png') })

      // Next button.
      await window.getByRole('button', { name: 'Next' }).click()
      await expect(counter(2)).toBeVisible()
      // ArrowRight binding.
      await window.keyboard.press('ArrowRight')
      await expect(counter(3)).toBeVisible()
      // Back button. Clicked from step 3 rather than step 2: step 2 is the
      // one step whose target ([data-tutorial="video-import"]) exists in the
      // unloaded studio, and its 'right' placement puts the whole coachmark
      // past the right edge of the window (T-21 FINDING E — computeTooltipPosition
      // clamps 'top'/'bottom' to the viewport but not 'left'/'right'), so its
      // buttons cannot be clicked. Every other step here has no rendered
      // target and centers.
      await window.getByRole('button', { name: 'Back' }).click()
      await expect(counter(2)).toBeVisible()
      // ArrowLeft binding.
      await window.keyboard.press('ArrowLeft')
      await expect(counter(1)).toBeVisible()
      // Back is not rendered on the first step, so there is nothing to
      // over-run: the guard is structural.
      await expect(window.getByRole('button', { name: 'Back' })).toHaveCount(0)

      // Enter binding. Focus sits on Next after every step change and the
      // handler defers to the button's own activation there, so blur first —
      // the window-level Enter branch is the thing under test.
      //
      // T-21 FINDING F (not fixed here): this advances TWO steps — observed
      // 1 -> 3. The keydown handler runs next() on the body, React flushes and
      // the step-change effect pulls focus onto the new Next button, and
      // Chromium then applies Enter's default action to whatever is focused by
      // that point, clicking Next a second time. A user pressing Enter to page
      // through the tutorial reads every other step. Asserted as "advanced"
      // rather than as a fixed number so the rest of the run stays valid
      // whichever way it is resolved.
      await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await window.keyboard.press('Enter')
      const afterEnter = await currentStep(window)
      expect(afterEnter).toBeGreaterThan(1)

      // Scrim click ADVANCES by design (Tutorial.tsx: the masked rect's
      // onClick is next(), not close) — asserted so the behavior is pinned
      // rather than assumed, and so no other test tries to escape that way.
      await window.locator('svg rect[mask]').click({ position: { x: 8, y: 8 } })
      await expect(counter(afterEnter + 1)).toBeVisible()

      // Run the rest with Next until the last step offers Done.
      for (let step = afterEnter + 1; step < total; step++) {
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

  test('Video tutorial: Skip and Escape close it WITHOUT persisting tutorialSeen.video', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('tutorial-skip')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, {
      welcomeSeen: true,
      tutorialSeen: { audio: true, image: true, ai: true }
    })
    const total = videoTutorial.steps.length

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await window.locator('a', { hasText: 'Video Studio' }).first().click()

      const step1 = window.getByText(`Video Studio · 1 of ${total}`, { exact: true })
      await expect(step1).toBeVisible({ timeout: 20_000 })

      // ── Escape closes without finishing ──
      await window.keyboard.press('Escape')
      await expect(step1).toHaveCount(0)
      // Settle long enough that a settings write would have landed.
      await window.waitForTimeout(1200)
      expect(readConfig(userDataDir).tutorialSeen?.video).toBeUndefined()

      // ── The header's "?" button replays it ──
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      await expect(step1).toBeVisible({ timeout: 10_000 })

      // ── Skip closes without finishing either ──
      await window.getByRole('button', { name: 'Skip' }).click()
      await expect(step1).toHaveCount(0)
      await window.waitForTimeout(1200)
      expect(readConfig(userDataDir).tutorialSeen?.video).toBeUndefined()
      // The other three flags are untouched — the write that did not happen
      // was specific to this tutorial, not a wholesale config failure.
      expect(readConfig(userDataDir).tutorialSeen?.audio).toBe(true)
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
        'Close this video? 1 clip(s) and their edits will be discarded.'
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
      expect(opened.label).toBe('Close templates dialog')

      // ── focus trap: Shift+Tab off the first element wraps to the last ──
      await window.keyboard.press('Shift+Tab')
      const wrappedBack = await focusInfo(window)
      expect(wrappedBack.insideDialog).toBe(true)
      expect(wrappedBack.label).toBe('Cancel')
      // …and Tab off the last wraps to the first.
      await window.keyboard.press('Tab')
      const wrappedForward = await focusInfo(window)
      expect(wrappedForward.insideDialog).toBe(true)
      expect(wrappedForward.label).toBe('Close templates dialog')
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
      expect(opened.label).toBe('Close')

      // ── focus trap wraps in both directions ──
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
        'Cleanup configured. Tweak from the side panels if needed.'
      )
      await expect(
        window.getByText('Cleanup configured. Tweak from the side panels if needed.')
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
