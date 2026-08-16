import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import { dragTo } from './drag'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-24: Audio Studio's full interactive surface through the REAL built app.
 *
 * The ledger (docs/INTERACTION_COVERAGE.md, Audio(48)) had exactly one
 * covered element before this spec — the NavCard that reaches the route.
 * Everything reachable without an OS dialog is driven here to its real end
 * state and asserted on what the user can see (active-button styling,
 * readouts, chips, panel copy), never on internal store reads.
 *
 * Import is driven the way export.spec.ts drives Video Studio's: a synthetic
 * `drop` carrying a File with the absolute `path` expando Electron adds to
 * real dropped files. That runs AudioImporter.onDrop -> loadFile ->
 * audioStore.loadSource -> window.api.audio.probe, i.e. the whole renderer
 * import flow including the IPC boundary.
 *
 * Two OS boundaries are handled differently:
 *   - `dialog.showOpenDialog` (the "Choose file…" picker and the three
 *     secondary-track role buttons) is replaced IN THE MAIN PROCESS from the
 *     test via `app.evaluate`. Only the OS chooser itself is replaced; the
 *     click, the `audio:pickFile` IPC handler, the store write, and every
 *     control the loaded state renders are real. See `stubOpenDialog`.
 *   - `dialog.showSaveDialog` (Export) is NOT stubbed: driving it would start
 *     a real ffmpeg render that Layer 5 (`npm run test:media`) already owns.
 *     The Export button's reachable state is asserted instead. See the
 *     DISPOSITIONS note on the export test.
 *
 * Native `confirm()` (Close, preset delete) is driven through a dialog spy
 * that is installed BEFORE the first click and records every message, so the
 * "no dialog at all" case is assertable rather than merely unobserved.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

// 3 s of 440 Hz: long enough that a drag over the middle of the waveform
// lands on unambiguous timestamps, short enough to decode instantly.
const FIXTURE_SECONDS = 3

function runBinary(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** Generate the import fixture with the repo's own bundled ffmpeg. */
async function makeFixtureWav(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${FIXTURE_SECONDS}`,
    '-ac',
    '1',
    '-ar',
    '44100',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

/** A tiny mp4 with sound — drives the "drop a video, extract its audio" path. */
async function makeFixtureMp4(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=160x120:rate=15:duration=${FIXTURE_SECONDS}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${FIXTURE_SECONDS}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

/**
 * Hermetic userData dir with every overlay flag pre-seeded (same shape as
 * smoke.spec.ts / export.spec.ts — electron-store nests dotted keys, so
 * `recentFiles.audio` is seeded as a nested object).
 */
function seedUserData(userDataDir: string, extra?: Record<string, unknown>): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify(
      {
        welcomeSeen: true,
        tutorialSeen: { video: true, audio: true, image: true, ai: true },
        ...extra
      },
      null,
      2
    ),
    'utf8'
  )
}

/**
 * Record the text of every node react-hot-toast mounts. Toasts auto-dismiss,
 * so polling for one with a locator races the timer; a MutationObserver
 * installed before the action never misses one. (Same helper as export.spec.)
 */
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
  return window.evaluate(() => (window as unknown as { __toastLog?: string[] }).__toastLog ?? [])
}

type DialogAction = 'accept' | 'dismiss'

interface DialogSpy {
  messages: string[]
  action: DialogAction
}

/**
 * Installed immediately after the window exists — before any click that could
 * raise a native confirm. Playwright auto-dismisses unhandled dialogs, which
 * would make "the app asked" and "the app didn't ask" look identical; the spy
 * makes both assertable, and `action` selects the accept / decline branch.
 */
function installDialogSpy(window: Page): DialogSpy {
  const spy: DialogSpy = { messages: [], action: 'accept' }
  window.on('dialog', (dialog) => {
    spy.messages.push(dialog.message())
    void (spy.action === 'accept' ? dialog.accept() : dialog.dismiss())
  })
  return spy
}

interface Studio {
  app: ElectronApplication
  window: Page
  /** The generated wav — dropped, picked, and used as the secondary track. */
  fixture: string
  root: string
  userDataDir: string
  dialogs: DialogSpy
}

async function openStudio(label: string, seed?: Record<string, unknown>): Promise<Studio> {
  if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
  const root = path.join(os.tmpdir(), `imagii-e2e-audio-${label}-${Date.now().toString(36)}`)
  const userDataDir = path.join(root, 'userData')
  const sourceDir = path.join(root, 'source')
  mkdirSync(sourceDir, { recursive: true })
  const fixture = path.join(sourceDir, 'e2e-tone.wav')
  await makeFixtureWav(fixture)
  seedUserData(userDataDir, seed)

  const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
  if (!existsSync(mainEntry)) {
    throw new Error(
      `out/main/index.js missing. Run \`npm run build\` before \`npm run test:e2e\`. Checked: ${mainEntry}`
    )
  }
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const window = await app.firstWindow()
  const dialogs = installDialogSpy(window)

  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  await window.locator('a', { hasText: 'Audio Studio' }).first().click()
  await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
  await expect(window.getByText('Drop audio or video here')).toBeVisible({ timeout: 15_000 })
  await installToastLog(window)

  return { app, window, fixture, root, userDataDir, dialogs }
}

async function closeStudio(studio: Studio): Promise<void> {
  await studio.app.close()
  try {
    rmSync(studio.root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/**
 * Dispatch a synthetic `drop` on Audio Studio's drop zone carrying a File with
 * the absolute `path` expando Electron adds to real dropped files.
 */
async function dropOnImporter(window: Page, filePath: string, fileName: string): Promise<void> {
  await window.evaluate(
    ({ filePath, fileName }) => {
      const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
      if (!zone) throw new Error('Audio Studio drop zone not found')
      const file = new File([new Uint8Array([0])], fileName, { type: '' })
      Object.defineProperty(file, 'path', { value: filePath })
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
      zone.dispatchEvent(event)
    },
    { filePath, fileName }
  )
}

/** dragover / dragleave on the same zone — drives the drop zone's hover state. */
async function fireDragEvent(window: Page, type: 'dragover' | 'dragleave'): Promise<void> {
  await window.evaluate((type) => {
    const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
    if (!zone) throw new Error('Audio Studio drop zone not found')
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [] } })
    zone.dispatchEvent(event)
  }, type)
}

/** The waveform's Play/Pause button is only enabled once wavesurfer is ready. */
function playButton(window: Page) {
  return window
    .locator('[data-tutorial="audio-waveform"]')
    .getByRole('button', { name: 'Play', exact: true })
}

async function dropAndWaitReady(studio: Studio, fileName = 'e2e-tone.wav'): Promise<void> {
  await dropOnImporter(studio.window, studio.fixture, fileName)
  await expect(playButton(studio.window)).toBeEnabled({ timeout: 30_000 })
}

/**
 * Replace the OS open-dialog in the MAIN process. Nothing in `src/` changes:
 * `dialog` is Electron's own object and the bundled `audio:pickFile` handler
 * reads `dialog.showOpenDialog` at call time, so the click, the IPC round
 * trip, and everything downstream of it stay real. `null` simulates the user
 * cancelling the chooser.
 */
async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () =>
      picked === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] }
  }, filePath)
}

// ── panel scopes ──────────────────────────────────────────────────────────
const CLEANUP = '[data-tutorial="audio-cleanup"]'
const LEVELS = '[data-tutorial="audio-levels"]'
const MULTITRACK = '[data-tutorial="audio-multitrack"]'
const EXPORT = '[data-tutorial="audio-export"]'
const WAVEFORM = '[data-tutorial="audio-waveform"]'
const FIXWIZARD = '[data-tutorial="audio-fixwizard"]'

/** CleanupPanel / LevelsPanel mark the selected option with the accent fill. */
function expectSelected(locator: ReturnType<Page['locator']>): Promise<void> {
  return expect(locator).toHaveClass(/bg-accent/)
}

function expectNotSelected(locator: ReturnType<Page['locator']>): Promise<void> {
  return expect(locator).toHaveClass(/bg-bg-hover/)
}

function cutChips(window: Page) {
  return window.locator('button[title="Click to remove this cut"]')
}

/**
 * "0:00.65-0:01.27 x" -> [0.65, 1.27]. Used on cut chips and on the transport
 * readout ("0:01.49 / 0:03.00"), so both are asserted as real numbers rather
 * than as "some text changed".
 */
function parseTimestampPair(text: string): [number, number] {
  const matches = text.match(/(\d+):(\d{2})\.(\d{2})/g)
  if (!matches || matches.length !== 2) throw new Error(`unparseable cut chip: ${text}`)
  const toSeconds = (t: string): number => {
    const m = t.match(/(\d+):(\d{2})\.(\d{2})/)
    if (!m) throw new Error(`unparseable timestamp: ${t}`)
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100
  }
  return [toSeconds(matches[0] as string), toSeconds(matches[1] as string)]
}

/** The selection region wavesurfer draws while a cut drag is in progress. */
function selectionRegion(window: Page) {
  return window.locator(`${WAVEFORM} [part^="region region-"]`)
}

/**
 * Make a cut the way the panel copy says one is made: ONE drag on the
 * waveform. WaveformView commits on the regions plugin's `region-created`,
 * which wavesurfer 7.12.6 emits from `saveRegion()` when the button comes up.
 * Before T-36 the commit rode `update-end`, which a drag-created region never
 * emits — its own draggable never saw the pointerdown — so a second gesture on
 * the leftover region was what actually made the cut.
 *
 * The button is released only once the selection region has reached the
 * cursor; see `tests/e2e/drag.ts` for the crossing-event race that makes that
 * wait load-bearing (T-55).
 */
async function dragCut(window: Page, fromFraction: number, toFraction: number): Promise<void> {
  const surface = window.locator(`${WAVEFORM} .card > div`).first()
  const box = await surface.boundingBox()
  if (!box) throw new Error('waveform surface has no box')
  const y = box.y + box.height / 2
  const toX = box.x + box.width * toFraction
  await dragTo(
    window,
    { x: box.x + box.width * fromFraction, y },
    { x: toX, y },
    {
      extent: {
        label: `waveform drag to ${Math.round(toFraction * 100)}%`,
        read: async () => {
          const b = await selectionRegion(window)
            .boundingBox({ timeout: 1_000 })
            .catch(() => null)
          return b ? b.x + b.width : Number.NaN
        },
        // wavesurfer seeds a selection 5 px wide, so a fully-landed drag puts
        // the region's right edge a hair PAST the cursor.
        settled: (right) => right >= toX
      }
    }
  )
}

test.describe('imagii Audio Studio', () => {
  test('imports a generated wav through the drop zone and drives the transport', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('import')
    const { window } = studio
    try {
      // ── the drop zone's own drag feedback ──
      const zone = window.locator('[data-tutorial="audio-importer"] .card')
      await expect(zone).not.toHaveClass(/border-accent/)
      await fireDragEvent(window, 'dragover')
      await expect(zone).toHaveClass(/border-accent/)
      await expect(zone).toHaveClass(/bg-bg-hover/)
      await fireDragEvent(window, 'dragleave')
      await expect(zone).not.toHaveClass(/border-accent/)

      await dropOnImporter(window, studio.fixture, 'e2e-tone.wav')

      // Loaded state: the importer is replaced by the waveform + panels, and
      // the header carries the file the main process actually probed.
      await expect(playButton(window)).toBeEnabled({ timeout: 30_000 })
      await expect(window.getByText('Drop audio or video here')).toHaveCount(0)
      await expect(window.getByText('e2e-tone.wav')).toBeVisible()
      // Probe readout — these numbers came back over IPC from ffprobe.
      await expect(window.locator(WAVEFORM)).toContainText('44100 Hz')
      await expect(window.locator(WAVEFORM)).toContainText('1ch')
      await expect(window.locator(WAVEFORM)).toContainText('pcm_s16le')
      const transport = window.locator(`${WAVEFORM} .font-mono`).first()
      await expect(transport).toHaveText(`0:00.00 / 0:0${FIXTURE_SECONDS}.00`)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Loaded')

      // ── click-to-seek ──
      const surface = window.locator(`${WAVEFORM} .card > div`).first()
      const box = await surface.boundingBox()
      if (!box) throw new Error('waveform surface has no box')
      await window.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
      // Half way into a 3 s file, within a generous band for pixel rounding.
      await expect
        .poll(
          async () => {
            const text = (await transport.textContent()) ?? ''
            return parseTimestampPair(text)[0]
          },
          { timeout: 10_000, intervals: [200] }
        )
        .toBeGreaterThan(1.2)
      expect(parseTimestampPair((await transport.textContent()) ?? '')[0]).toBeLessThan(1.8)

      // ── play / pause ──
      const before = parseTimestampPair((await transport.textContent()) ?? '')[0]
      await playButton(window).click()
      const pause = window.locator(WAVEFORM).getByRole('button', { name: 'Pause', exact: true })
      await expect(pause).toBeVisible({ timeout: 10_000 })
      // The clock advances because the media element is really playing.
      await expect
        .poll(
          async () => parseTimestampPair((await transport.textContent()) ?? '')[0],
          { timeout: 15_000, intervals: [200] }
        )
        .toBeGreaterThan(before + 0.15)
      await pause.click()
      await expect(playButton(window)).toBeVisible({ timeout: 10_000 })
      const stopped = parseTimestampPair((await transport.textContent()) ?? '')[0]
      await window.waitForTimeout(600)
      // Paused means paused: the clock is where it was left.
      const afterWait = parseTimestampPair((await transport.textContent()) ?? '')[0]
      expect(Math.abs(afterWait - stopped)).toBeLessThan(0.15)

      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-01-loaded.png') })

      // ── the "?" tutorial button replays the walkthrough on demand ──
      // (tutorialSeen is seeded, so nothing auto-starts and this is the only
      // way the overlay can appear.)
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const tour = window.getByRole('dialog')
      await expect(tour).toBeVisible()
      await expect(tour).toContainText('Welcome to Audio Studio')
      await expect(tour).toHaveAttribute('aria-label', /step 1 of \d+/)
      await tour.getByRole('button', { name: 'Skip' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('refuses a text file drop and never enters a loaded state', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('reject')
    const { window } = studio
    try {
      // NEGATIVE: ffmpeg's `tty` demuxer makes ffprobe read any text file as a
      // 640x400 "ansi" video and exit 0, so the refusal has to come from the
      // audio probe's own no-audio-stream floor rather than from ffprobe.
      const notes = path.join(studio.root, 'source', 'stream-notes.txt')
      writeFileSync(notes, 'this is not audio, it is a text file\n', 'utf8')
      await dropOnImporter(window, notes, 'stream-notes.txt')

      const REFUSAL = 'No audio stream found in file'
      // Arrives wrapped in Electron's IPC preamble ("Error invoking remote
      // method 'audio:probe': …"), so the sentence is asserted as a substring.
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toEqual(expect.arrayContaining([expect.stringContaining(REFUSAL)]))
      await expect(window.getByText(REFUSAL, { exact: false }).first()).toBeVisible()

      // And it never entered a loaded state.
      const toasts = await readToastLog(window)
      expect(toasts).not.toContain('Loaded')
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      await expect(window.locator(WAVEFORM)).toHaveCount(0)
      await expect(window.locator(EXPORT)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('drop of a video extracts its audio and offers the mux-back path', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('extract')
    const { window } = studio
    try {
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)
      await dropOnImporter(window, video, 'e2e-clip.mp4')

      // audioNeedsExtraction -> audio:extractFromVideo -> real ffmpeg -> the
      // extracted wav is what the waveform loads.
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toContain('Loaded')
      // The extract writes 48 kHz stereo pcm_s16le regardless of the source.
      await expect(window.locator(WAVEFORM)).toContainText('48000 Hz')
      await expect(window.locator(WAVEFORM)).toContainText('2ch')

      // fromVideo is set, so the Export panel offers the re-attach path and
      // locks the format select to mp4 while it is ticked.
      const muxBack = window.locator(EXPORT).getByRole('checkbox')
      await expect(muxBack).toBeChecked()
      await expect(window.locator(EXPORT).getByRole('combobox').first()).toBeDisabled()
      await muxBack.uncheck()
      await expect(window.locator(EXPORT).getByRole('combobox').first()).toBeEnabled()
      await muxBack.check()
      await expect(window.locator(EXPORT).getByRole('combobox').first()).toBeDisabled()
    } finally {
      await closeStudio(studio)
    }
  })

  test('recent files menu and the file picker both load a source', async () => {
    test.setTimeout(120_000)
    // The recents list is settings-backed (`recentFiles.audio`), so seeding
    // config.json is the same state a previous session would have left.
    const seedRoot = path.join(os.tmpdir(), `imagii-e2e-audio-recents-seed-${Date.now().toString(36)}`)
    mkdirSync(seedRoot, { recursive: true })
    const seededFixture = path.join(seedRoot, 'from-last-session.wav')
    await makeFixtureWav(seededFixture)
    const studio = await openStudio('recents', { recentFiles: { audio: [seededFixture] } })
    const { window } = studio
    try {
      // ── recents ──
      const recentToggle = window.getByRole('button', { name: 'Recent (1)' })
      await expect(recentToggle).toBeVisible()
      await recentToggle.click()
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'true')
      // Escape dismisses the popover (T-18) without picking anything.
      await window.keyboard.press('Escape')
      await expect(recentToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(window.getByRole('button', { name: /from-last-session\.wav/ })).toHaveCount(0)
      await recentToggle.click()
      await window.getByRole('button', { name: /from-last-session\.wav/ }).click()
      await expect(playButton(window)).toBeEnabled({ timeout: 30_000 })
      await expect(window.getByText('from-last-session.wav')).toBeVisible()

      // Close returns to the importer with the recents list intact.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      expect(studio.dialogs.messages).toEqual([])

      // ── the picker (OS chooser replaced in the main process) ──
      await stubOpenDialog(studio.app, studio.fixture)
      await window.getByRole('button', { name: 'Choose file…' }).click()
      await expect(playButton(window)).toBeEnabled({ timeout: 30_000 })
      await expect(window.getByText('e2e-tone.wav')).toBeVisible()

      // Both loads pushed onto the recents list.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      const toggle = window.getByRole('button', { name: 'Recent (2)' })
      await expect(toggle).toBeVisible()

      // A cancelled picker leaves the importer alone.
      await stubOpenDialog(studio.app, null)
      await window.getByRole('button', { name: 'Choose file…' }).click()
      await window.waitForTimeout(500)
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      await expect(window.locator(WAVEFORM)).toHaveCount(0)

      // ── clear list ──
      await toggle.click()
      await window.getByRole('button', { name: 'Clear list' }).click()
      await expect(window.getByRole('button', { name: /^Recent \(/ })).toHaveCount(0)
    } finally {
      await closeStudio(studio)
      try {
        rmSync(seedRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('waveform drag makes cut regions, and cut chips remove them', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('cuts')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      await expect(
        window.getByText('Drag on the waveform to select a region to cut. Click a cut tag to undo it.')
      ).toBeVisible()

      // ── ONE GESTURE, ONE CUT (T-36) ──
      // This assertion is the flipped tripwire: it used to pin `toHaveCount(0)`
      // here, because the commit rode `update-end` and a drag-created region
      // never emits one. The panel copy above promises a single drag, and now
      // a single drag is what delivers it.
      await dragCut(window, 0.2, 0.4)
      await expect(cutChips(window)).toHaveCount(1)

      // Chip carries the real timestamps the pixels mapped to: 20%..40% of a
      // 3 s file (wavesurfer seeds the selection 5 px wide, so the end runs a
      // hair past 40%).
      const [start, end] = parseTimestampPair((await cutChips(window).first().textContent()) ?? '')
      expect(start).toBeGreaterThan(0.5)
      expect(start).toBeLessThan(0.8)
      expect(end).toBeGreaterThan(1.1)
      expect(end).toBeLessThan(1.4)
      // The selection region is gone and the store-driven cut region replaced
      // it — rose fill, not the drag-selection red.
      await expect(selectionRegion(window)).toHaveCount(0)
      const cutRegion = window.locator(`${WAVEFORM} [part~="cut-0"]`)
      await expect(cutRegion).toHaveCount(1)
      await expect(cutRegion).toHaveCSS('background-color', 'rgba(244, 63, 94, 0.35)')
      await expect(
        window.getByText('Drag on the waveform to select a region to cut. Click a cut tag to undo it.')
      ).toHaveCount(0)

      // ── a second cut, from its own single gesture ──
      await dragCut(window, 0.6, 0.8)
      await expect(cutChips(window)).toHaveCount(2)
      await expect(window.locator(`${WAVEFORM} [part~="cut-1"]`)).toHaveCount(1)
      const [secondStart] = parseTimestampPair((await cutChips(window).nth(1).textContent()) ?? '')
      expect(secondStart).toBeGreaterThan(1.7)
      expect(secondStart).toBeLessThan(2.0)

      // ── a third drag, running INTO the second cut, gets its own chip ──
      // and — the point of this block — re-rendering the stored cuts does not
      // commit them a second time. Every stored cut goes back through
      // `addRegion`, which emits the same `region-created` the commit listens
      // to; without the id guard in WaveformView each re-render would add the
      // whole list again and these counts would run away.
      // (It starts in the 40%..60% gap on purpose: a drag that BEGINS on top
      // of an existing cut region never reaches wavesurfer's drag-selection —
      // the region's own draggable preventDefaults the pointermove first.)
      await dragCut(window, 0.45, 0.65)
      await expect(cutChips(window)).toHaveCount(3)
      await expect(window.locator(`${WAVEFORM} [part~="cut-2"]`)).toHaveCount(1)
      const [thirdStart, thirdEnd] = parseTimestampPair(
        (await cutChips(window).nth(2).textContent()) ?? ''
      )
      expect(thirdStart).toBeGreaterThan(1.25)
      expect(thirdStart).toBeLessThan(1.45)
      // It really overlaps the 60%..80% cut.
      expect(thirdEnd).toBeGreaterThan(1.85)
      // Three stored cuts, three regions on the waveform, no leftovers.
      await expect(window.locator(`${WAVEFORM} [part^="region "]`)).toHaveCount(3)
      await expect(selectionRegion(window)).toHaveCount(0)
      for (const id of ['cut-0', 'cut-1', 'cut-2']) {
        await expect(window.locator(`${WAVEFORM} [part~="${id}"]`)).toHaveCount(1)
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-02-cuts.png') })

      // ── chip removal ──
      await cutChips(window).first().click()
      await expect(cutChips(window)).toHaveCount(2)
      // The one left at the front is the SECOND cut, not a re-render of the first.
      expect(parseTimestampPair((await cutChips(window).first().textContent()) ?? '')[0]).toBeGreaterThan(1.7)
      await expect(window.locator(`${WAVEFORM} [part~="cut-2"]`)).toHaveCount(0)
      await expect(window.locator(`${WAVEFORM} [part^="region "]`)).toHaveCount(2)
      await cutChips(window).first().click()
      await expect(cutChips(window)).toHaveCount(1)
      await cutChips(window).first().click()
      await expect(cutChips(window)).toHaveCount(0)
      await expect(window.locator(`${WAVEFORM} [part~="cut-0"]`)).toHaveCount(0)
      await expect(
        window.getByText('Drag on the waveform to select a region to cut. Click a cut tag to undo it.')
      ).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })

  test('every Cleanup control writes through to the chain', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('cleanup')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      const option = (name: string) => cleanup.getByRole('button', { name, exact: true })

      // Default is Off, and it reads as selected.
      await expectSelected(option('Off'))
      for (const name of ['Light', 'Medium', 'Aggressive'] as const) {
        await option(name).click()
        await expectSelected(option(name))
        await expectNotSelected(option('Off'))
      }

      // ── parametric: the two sliders exist only under "Custom" ──
      await expect(cleanup.getByRole('slider')).toHaveCount(0)
      await option('Custom').click()
      await expectSelected(option('Custom'))
      const noiseFloor = cleanup.getByRole('slider', { name: 'Noise floor' })
      const reduction = cleanup.getByRole('slider', { name: 'Reduction' })
      await expect(noiseFloor).toBeVisible()
      await expect(reduction).toBeVisible()
      // Round-18 ranges: afftdn's real accepted values.
      await expect(noiseFloor).toHaveAttribute('min', '-80')
      await expect(noiseFloor).toHaveAttribute('max', '-20')
      await expect(reduction).toHaveAttribute('min', '1')
      await expect(reduction).toHaveAttribute('max', '50')
      await expect(cleanup.locator('label', { hasText: 'Noise floor' })).toContainText('-25 dB')
      await expect(cleanup.locator('label', { hasText: 'Reduction' })).toContainText('12 dB')
      await noiseFloor.press('ArrowRight')
      await expect(cleanup.locator('label', { hasText: 'Noise floor' })).toContainText('-24 dB')
      await noiseFloor.press('ArrowLeft')
      await noiseFloor.press('ArrowLeft')
      await expect(cleanup.locator('label', { hasText: 'Noise floor' })).toContainText('-26 dB')
      await reduction.press('ArrowRight')
      await expect(cleanup.locator('label', { hasText: 'Reduction' })).toContainText('13 dB')
      await reduction.press('End')
      await expect(cleanup.locator('label', { hasText: 'Reduction' })).toContainText('50 dB')
      // Leaving Custom hides them again; the values are kept in the chain and
      // come back when Custom is re-selected.
      await option('Medium').click()
      await expect(cleanup.getByRole('slider')).toHaveCount(0)
      await option('Custom').click()
      await expect(cleanup.locator('label', { hasText: 'Reduction' })).toContainText('50 dB')
      await option('Off').click()
      await expectSelected(option('Off'))

      // ── the three cleanup toggles ──
      const rumble = cleanup.getByLabel('Remove low rumble (highpass 80 Hz)')
      const hum = cleanup.getByLabel('Reduce 60 Hz hum / power-line buzz')
      const deEss = cleanup.getByLabel('De-ess sibilance (dynamic)')
      for (const box of [rumble, hum, deEss]) {
        await expect(box).not.toBeChecked()
        await box.check()
        await expect(box).toBeChecked()
      }
      for (const box of [rumble, hum, deEss]) {
        await box.uncheck()
        await expect(box).not.toBeChecked()
      }
    } finally {
      await closeStudio(studio)
    }
  })

  test('every Levels control writes through to the chain', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('levels')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const levels = window.locator(LEVELS)
      const preset = (name: string) => levels.getByRole('button', { name, exact: true })

      // ── compressor x4 ──
      await expectSelected(preset('Off'))
      for (const name of ['Voice', 'Music', 'Mixed'] as const) {
        await preset(name).click()
        await expectSelected(preset(name))
        await expectNotSelected(preset('Off'))
      }
      await preset('Off').click()
      await expectSelected(preset('Off'))

      // ── loudnorm + LUFS number + platform select ──
      const lufs = levels.getByLabel('Loudness target in LUFS')
      const loudnorm = levels.getByRole('checkbox')
      await expect(lufs).toBeDisabled()
      await expect(levels.getByLabel('Loudness platform preset')).toHaveCount(0)
      await loudnorm.check()
      await expect(lufs).toBeEnabled()
      await expect(lufs).toHaveValue('-16')
      const platform = levels.getByLabel('Loudness platform preset')
      // -16 is the podcast target, so the picker reads Podcast without anyone
      // having chosen it.
      await expect(platform).toHaveValue('podcast')
      await expect(levels).toContainText('Two-pass loudnorm')

      // Platform -> number, every option in the picker.
      await platform.selectOption('youtube')
      await expect(lufs).toHaveValue('-14')
      await platform.selectOption('broadcast')
      await expect(lufs).toHaveValue('-23')
      await platform.selectOption('podcast')
      await expect(lufs).toHaveValue('-16')
      await platform.selectOption('broadcast')
      await expect(lufs).toHaveValue('-23')
      // TikTok shares YouTube's -14 target, and lufsTargetToPresetId maps -14
      // back to the FIRST match, so the picker snaps to YouTube. Documented
      // behavior (LevelsPanel.tsx), pinned here so a change is deliberate.
      await platform.selectOption('tiktok')
      await expect(lufs).toHaveValue('-14')
      await expect(platform).toHaveValue('youtube')

      // Number -> "Custom" detection.
      await lufs.fill('-18')
      await expect(platform).toHaveValue('custom')
      // Selecting Custom explicitly leaves the typed value alone.
      await platform.selectOption('custom')
      await expect(lufs).toHaveValue('-18')
      // Back onto a preset value and the picker recognises it again.
      await lufs.fill('-23')
      await expect(platform).toHaveValue('broadcast')

      // Unticking hides the platform row but keeps the number.
      await loudnorm.uncheck()
      await expect(levels.getByLabel('Loudness platform preset')).toHaveCount(0)
      await expect(lufs).toBeDisabled()
      await expect(lufs).toHaveValue('-23')

      // ── manual gain ──
      const gain = levels.getByRole('slider', { name: 'Manual gain in decibels' })
      const readout = levels.locator('span.font-mono')
      await expect(readout).toHaveText('+0.0 dB')
      await gain.press('ArrowRight')
      await expect(readout).toHaveText('+0.5 dB')
      await gain.press('End')
      await expect(readout).toHaveText('+12.0 dB')
      await gain.press('Home')
      await expect(readout).toHaveText('-12.0 dB')
      await expect(gain).toHaveAttribute('aria-valuetext', '-12.0 decibels')
    } finally {
      await closeStudio(studio)
    }
  })

  test('undo and redo work from the header buttons and from the keyboard', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('undo')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const undo = window.getByRole('button', { name: 'Undo' })
      const redo = window.getByRole('button', { name: 'Redo' })
      const cleanup = window.locator(CLEANUP)
      const medium = cleanup.getByRole('button', { name: 'Medium', exact: true })
      const off = cleanup.getByRole('button', { name: 'Off', exact: true })

      // A freshly loaded source has no history in either direction.
      await expect(undo).toBeDisabled()
      await expect(redo).toBeDisabled()

      await medium.click()
      await expectSelected(medium)
      await expect(undo).toBeEnabled()
      await expect(redo).toBeDisabled()

      // ── buttons ──
      await undo.click()
      await expectSelected(off)
      await expect(redo).toBeEnabled()
      await redo.click()
      await expectSelected(medium)

      // ── keyboard (useUndoRedoHotkeys, shared since T-15) ──
      await window.keyboard.press('Control+z')
      await expectSelected(off)
      await window.keyboard.press('Control+y')
      await expectSelected(medium)
      await window.keyboard.press('Control+z')
      await expectSelected(off)
      await window.keyboard.press('Control+Shift+z')
      await expectSelected(medium)

      // The guard: Ctrl+Z inside a text field must not roll back the chain.
      const presetName = window.locator('.card').filter({ hasText: 'Cleanup presets' })
      await presetName.getByPlaceholder('My mic preset').fill('typed')
      await presetName.getByPlaceholder('My mic preset').press('Control+z')
      await expectSelected(medium)
    } finally {
      await closeStudio(studio)
    }
  })

  test('Fix Wizard reconfigures Cleanup and Levels, and resets on both exits', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizard')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const openWizard = window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' })
      const dialog = window.getByRole('dialog')

      // ── Escape at question 2 resets the run ──
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await dialog.getByRole('button', { name: 'A little' }).click()
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await expect(dialog).toContainText('Is there background noise (HVAC, fan, traffic)?')

      // ── a full run, then Start over ──
      await dialog.getByRole('button', { name: 'Yes, pretty loud' }).click()
      await dialog.getByRole('button', { name: 'Yeah, kind of echoy' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      await expect(dialog).toContainText('Ready to apply')
      await dialog.getByRole('button', { name: 'Start over' }).click()
      await expect(dialog).toHaveCount(0)
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')

      // ── the run that applies ──
      await dialog.getByRole('button', { name: 'Yes, pretty loud' }).click()
      await dialog.getByRole('button', { name: 'Yeah, kind of echoy' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      // The summary names exactly what will be set…
      await expect(dialog).toContainText('Denoise: aggressive')
      await expect(dialog).toContainText('Highpass + 60 Hz hum reduction: on')
      await expect(dialog).toContainText('De-ess: on')
      await expect(dialog).toContainText('Compressor: voice')
      await expect(dialog).toContainText('Loudnorm to −16 LUFS')
      // …and the echoy answer produces the room-treatment tip (INIT-A) rather
      // than a filter that cannot exist.
      await expect(dialog).toContainText('room reverb is hard to remove after the fact')

      const closeWizard = dialog.getByRole('button', { name: 'Close' })
      await expect(closeWizard).toHaveCount(0) // summary step has Start over / Apply
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Cleanup configured. Tweak from the side panels if needed.')

      // ── the panels really changed ──
      const cleanup = window.locator(CLEANUP)
      const levels = window.locator(LEVELS)
      await expectSelected(cleanup.getByRole('button', { name: 'Aggressive', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (highpass 80 Hz)')).toBeChecked()
      await expect(cleanup.getByLabel('Reduce 60 Hz hum / power-line buzz')).toBeChecked()
      await expect(cleanup.getByLabel('De-ess sibilance (dynamic)')).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Voice', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()
      await expect(levels.getByLabel('Loudness target in LUFS')).toHaveValue('-16')
      await expect(levels.getByLabel('Loudness platform preset')).toHaveValue('podcast')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-03-wizard-applied.png') })

      // ── the wizard's own close button, and the reset after Apply ──
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)

      // One patchChain for the whole wizard result — a single Undo puts the
      // chain back the way it was.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expectSelected(cleanup.getByRole('button', { name: 'Off', exact: true }))
      await expect(levels.getByRole('checkbox')).not.toBeChecked()

      // ── the scrim dismisses and resets too ──
      await openWizard.click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await window.mouse.click(12, 12) // outside the dialog card = the scrim
      await expect(dialog).toHaveCount(0)
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')

      // ── the quiet-room answers CLEAR what a previous pass turned on ──
      // Hand-set the three toggles first so "off" is a real change rather
      // than a default that never moved.
      await window.keyboard.press('Escape')
      await cleanup.getByLabel('Remove low rumble (highpass 80 Hz)').check()
      await cleanup.getByLabel('Reduce 60 Hz hum / power-line buzz').check()
      await cleanup.getByLabel('De-ess sibilance (dynamic)').check()
      await openWizard.click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Music', exact: true }).click()
      await expect(dialog).toContainText('Denoise: off')
      await expect(dialog).toContainText('Highpass + 60 Hz hum reduction: off')
      await expect(dialog).toContainText('De-ess: off')
      await expect(dialog).toContainText('Compressor: music')
      // A dry room gets no reverb tip.
      await expect(dialog).not.toContainText('room reverb is hard to remove')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expectSelected(cleanup.getByRole('button', { name: 'Off', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (highpass 80 Hz)')).not.toBeChecked()
      await expect(cleanup.getByLabel('Reduce 60 Hz hum / power-line buzz')).not.toBeChecked()
      await expect(cleanup.getByLabel('De-ess sibilance (dynamic)')).not.toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Music', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()

      // ── the last two answers: mild noise, mixed content ──
      await openWizard.click()
      await dialog.getByRole('button', { name: 'A little' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Both, mixed' }).click()
      await expect(dialog).toContainText('Denoise: medium')
      await expect(dialog).toContainText('Compressor: mixed')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expectSelected(cleanup.getByRole('button', { name: 'Medium', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (highpass 80 Hz)')).toBeChecked()
      await expect(cleanup.getByLabel('Reduce 60 Hz hum / power-line buzz')).toBeChecked()
      await expect(cleanup.getByLabel('De-ess sibilance (dynamic)')).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Mixed', exact: true }))
    } finally {
      await closeStudio(studio)
    }
  })

  test('cleanup presets save, apply, and delete through both confirm branches', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('presets')
    const { window, dialogs } = studio
    try {
      await dropAndWaitReady(studio)
      const presets = window.locator('.card').filter({ hasText: 'Cleanup presets' })
      const nameInput = presets.getByPlaceholder('My mic preset')
      const cleanup = window.locator(CLEANUP)
      const levels = window.locator(LEVELS)
      const presetDir = path.join(studio.userDataDir, 'audio-presets')

      await expect(presets).toContainText('Get the chain dialed in, name it, and save.')

      // Naming nothing is refused before any IPC happens.
      await presets.getByRole('button', { name: 'Save current' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Name your preset first')
      expect(existsSync(presetDir) ? readdirSync(presetDir) : []).toEqual([])

      // ── dial a chain in, save it with Enter ──
      await cleanup.getByRole('button', { name: 'Medium', exact: true }).click()
      await cleanup.getByLabel('De-ess sibilance (dynamic)').check()
      await levels.getByRole('button', { name: 'Voice', exact: true }).click()
      await levels.getByRole('checkbox').check()
      await levels.getByLabel('Loudness target in LUFS').fill('-14')
      await nameInput.fill('Mic A')
      await nameInput.press('Enter')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Saved "Mic A"')
      await expect(presets.getByText('Mic A')).toBeVisible()
      await expect(nameInput).toHaveValue('')

      // It reached main and landed on disk with the chain the panels built.
      const files = readdirSync(presetDir)
      expect(files).toHaveLength(1)
      const saved = JSON.parse(readFileSync(path.join(presetDir, files[0] as string), 'utf8'))
      expect(saved.name).toBe('Mic A')
      expect(saved.chain).toMatchObject({
        denoise: 'medium',
        deEss: true,
        compressor: 'voice',
        loudnorm: true,
        loudnormTargetLufs: -14
      })

      // ── a second preset, saved with the button ──
      await cleanup.getByRole('button', { name: 'Off', exact: true }).click()
      await cleanup.getByLabel('De-ess sibilance (dynamic)').uncheck()
      await levels.getByRole('button', { name: 'Music', exact: true }).click()
      await levels.getByRole('checkbox').uncheck()
      await nameInput.fill('Mic B')
      await presets.getByRole('button', { name: 'Save current' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Saved "Mic B"')
      await expect(presets.getByRole('button', { name: 'Apply' })).toHaveCount(2)
      expect(readdirSync(presetDir)).toHaveLength(2)

      // ── apply restores the first chain over the current one ──
      const rowA = presets.locator('li').filter({ hasText: 'Mic A' })
      await rowA.getByRole('button', { name: 'Apply' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Applied "Mic A"')
      await expectSelected(cleanup.getByRole('button', { name: 'Medium', exact: true }))
      await expect(cleanup.getByLabel('De-ess sibilance (dynamic)')).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Voice', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()
      await expect(levels.getByLabel('Loudness target in LUFS')).toHaveValue('-14')

      // ── delete: declined, then accepted ──
      dialogs.action = 'dismiss'
      const rowB = presets.locator('li').filter({ hasText: 'Mic B' })
      await rowB.getByRole('button', { name: 'Remove preset' }).click()
      await expect
        .poll(() => dialogs.messages, { timeout: 15_000, intervals: [200] })
        .toContain('Delete preset "Mic B"?')
      await expect(presets.getByRole('button', { name: 'Apply' })).toHaveCount(2)
      expect(readdirSync(presetDir)).toHaveLength(2)

      dialogs.action = 'accept'
      await rowB.getByRole('button', { name: 'Remove preset' }).click()
      await expect(presets.getByRole('button', { name: 'Apply' })).toHaveCount(1)
      await expect(presets.getByText('Mic B')).toHaveCount(0)
      await expect(presets.getByText('Mic A')).toBeVisible()
      await expect
        .poll(() => readdirSync(presetDir).length, { timeout: 15_000, intervals: [200] })
        .toBe(1)
      expect(dialogs.messages.filter((m) => m === 'Delete preset "Mic B"?')).toHaveLength(2)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a second track can be added in every role and its mix controls drive the chain', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('secondary')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const panel = window.locator(MULTITRACK)
      await expect(panel).toContainText('Layer in background music')

      // OS chooser replaced in the main process; the click, the IPC, the
      // store write, and every control below are real.
      await stubOpenDialog(studio.app, studio.fixture)

      // ── background music: -10 dB, ducking on by default ──
      await panel.getByRole('button', { name: /Background music/ }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Background music added')
      await expect(panel).toContainText('Background music: e2e-tone.wav')
      const gain = panel.getByRole('slider', { name: 'Secondary track gain in decibels' })
      await expect(panel).toContainText('-10.0 dB')
      await gain.press('ArrowRight')
      await expect(panel).toContainText('-9.5 dB')

      const matchLoudness = panel.getByLabel('Match loudness with primary (auto-balance via loudnorm)')
      await expect(matchLoudness).not.toBeChecked()
      await matchLoudness.check()
      await expect(matchLoudness).toBeChecked()

      const duck = panel.getByLabel('Duck under primary (sidechain compress)')
      await expect(duck).toBeChecked()

      // ── the four ducking sliders (DEFAULT_DUCK_PARAMS) ──
      const threshold = panel.getByRole('slider', { name: 'Threshold' })
      const ratio = panel.getByRole('slider', { name: 'Ratio' })
      const attack = panel.getByRole('slider', { name: 'Attack' })
      const release = panel.getByRole('slider', { name: 'Release' })
      await expect(panel.locator('label', { hasText: 'Threshold' })).toContainText('-26 dBFS')
      await expect(panel.locator('label', { hasText: 'Ratio' })).toContainText('8 :1')
      await expect(panel.locator('label', { hasText: 'Attack' })).toContainText('20 ms')
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('400 ms')
      await threshold.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Threshold' })).toContainText('-25 dBFS')
      await ratio.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Ratio' })).toContainText('8.5 :1')
      await attack.press('ArrowLeft')
      await expect(panel.locator('label', { hasText: 'Attack' })).toContainText('19 ms')
      await release.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('410 ms')
      await expect(release).toHaveAttribute('aria-valuetext', '410 ms')

      // Ducking off hides the four sliders; back on restores the values.
      await duck.uncheck()
      await expect(panel.getByRole('slider', { name: 'Threshold' })).toHaveCount(0)
      await duck.check()
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('410 ms')

      // ── remove, then the other two roles and their defaults ──
      await panel.getByRole('button', { name: /Remove/ }).click()
      await expect(panel).toContainText('Layer in background music')
      await expect(panel.getByRole('button', { name: /Second mic/ })).toBeVisible()

      await panel.getByRole('button', { name: /Second mic/ }).click()
      await expect(panel).toContainText('Second mic: e2e-tone.wav')
      await expect(panel).toContainText('+0.0 dB')
      await expect(panel.getByLabel('Duck under primary (sidechain compress)')).not.toBeChecked()
      await expect(panel.getByRole('slider', { name: 'Threshold' })).toHaveCount(0)
      await panel.getByRole('button', { name: /Remove/ }).click()

      await panel.getByRole('button', { name: /Game audio/ }).click()
      await expect(panel).toContainText('Game audio: e2e-tone.wav')
      await expect(panel).toContainText('-3.0 dB')
      await expect(panel.getByLabel('Duck under primary (sidechain compress)')).toBeChecked()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-04-secondary.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('Close asks before discarding work and stays put when declined', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('close')
    const { window, dialogs } = studio
    try {
      await dropAndWaitReady(studio)

      // ── nothing touched: no dialog at all ──
      // The spy is what makes this assertable — an unhandled confirm would be
      // auto-dismissed and look exactly like never asking.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      expect(dialogs.messages).toEqual([])

      // ── an edited chain is worth asking about ──
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      const medium = cleanup.getByRole('button', { name: 'Medium', exact: true })
      await medium.click()
      await expectSelected(medium)

      dialogs.action = 'dismiss'
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect
        .poll(() => dialogs.messages, { timeout: 15_000, intervals: [200] })
        .toEqual(['Close this audio? your cleanup settings will be discarded.'])
      // Declined means nothing happened: same source, same chain.
      await expect(window.getByText('e2e-tone.wav')).toBeVisible()
      await expectSelected(medium)
      await expect(window.getByText('Drop audio or video here')).toHaveCount(0)

      // ── a cut region joins the sentence ──
      await dragCut(window, 0.2, 0.4)
      await expect(cutChips(window)).toHaveCount(1)
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect
        .poll(() => dialogs.messages.length, { timeout: 15_000, intervals: [200] })
        .toBe(2)
      expect(dialogs.messages[1]).toBe(
        'Close this audio? your cleanup settings, 1 cut region(s) will be discarded.'
      )
      await expect(window.getByText('e2e-tone.wav')).toBeVisible()

      // ── accepted: the source and everything with it is gone ──
      dialogs.action = 'accept'
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      expect(dialogs.messages).toHaveLength(3)

      // clearSource() resets the chain too — the next source starts clean.
      await dropAndWaitReady(studio)
      await expectSelected(cleanup.getByRole('button', { name: 'Off', exact: true }))
      await expect(cutChips(window)).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the Export panel is reachable and configurable with a source loaded', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('export')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const exportPanel = window.locator(EXPORT)
      const format = exportPanel.getByRole('combobox').first()

      // DISPOSITION: the Export button itself is NOT clicked. It opens
      // dialog.showSaveDialog (a main-process OS dialog) and then runs a real
      // ffmpeg render; `runAudioExport` / `runAudioMux` are Layer 5's
      // (`npm run test:media`). What is asserted here is everything the user
      // can reach before that boundary.
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await expect(exportButton).toBeVisible()
      await expect(exportButton).toBeEnabled()

      // ── format / bitrate selects ──
      await expect(format).toHaveValue('mp3')
      const bitrate = exportPanel.getByRole('combobox').nth(1)
      await expect(bitrate).toHaveValue('192k')
      await bitrate.selectOption('320k')
      await expect(bitrate).toHaveValue('320k')
      // Lossless formats have no bitrate to choose.
      await format.selectOption('wav')
      await expect(exportPanel.getByRole('combobox')).toHaveCount(1)
      await format.selectOption('flac')
      await expect(exportPanel.getByRole('combobox')).toHaveCount(1)
      await format.selectOption('aac')
      await expect(exportPanel.getByRole('combobox')).toHaveCount(2)
      // The bitrate survived the round trip through the lossless formats.
      await expect(exportPanel.getByRole('combobox').nth(1)).toHaveValue('320k')

      // No job has started, so no progress row and no Cancel.
      await expect(exportPanel.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
      await expect(exportPanel.getByRole('button', { name: 'Show' })).toHaveCount(0)
      // A source-less studio has no Export panel at all.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.locator(EXPORT)).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})
