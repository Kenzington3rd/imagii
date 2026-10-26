import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { DEFAULT_CHAIN_SPEC } from '../../src/shared/audio'
import { dragThrough } from './drag'
import {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  expectControlsWhole,
  expectEllipsized,
  expectNoHorizontalOverflow,
  expectOneLine,
  expectSelectsWhole,
  setWindowSize
} from './layout'
import { chooserCalls, recordSlowChooser } from './chooser'
import { installSpawnStall, readSpawnLog } from './mainSpawn'
import { slowPresetWrites } from './slowWrites'
import { readRevealCalls, stubShellReveal } from './shellReveal'
import { localDay, skewTimeZone, utcDay } from './skewedClock'
import { installToastLog, readToastEntries, readToastLog } from './toastLog'
import { leave, retype } from './typing'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-23: Video Studio's PIPELINE panels and the export surface, driven
 * through the REAL built app — ledger rows Video 4g (ChatHighlightPanel),
 * 4j (HighlightPanel), 4k (ReframePanel), 4l (GifPanel), 4m
 * (CompilationPanel), 4n (PipPanel), 4o (CaptionsPanel), 4p (ClipKit),
 * 4r (PostChecklist), 4s (CustomPresetManager), 4t (ExportPanel).
 *
 * T-22 (video-core.spec.ts) covers the editing surface; this file starts
 * where that one stops — at the panels that spawn ffmpeg, write files, and
 * hit OS dialogs.
 *
 * ── How the OS boundaries are crossed ─────────────────────────────────
 *
 * MAIN-PROCESS DIALOG STUB (audio.spec.ts's technique, extended to a
 * queue). `dialog.showOpenDialog` / `dialog.showSaveDialog` are replaced in
 * the MAIN process from the test via `app.evaluate`. Nothing in `src/`
 * changes: `dialog` is Electron's own object and every handler reads the
 * method off it at call time, so the click, the IPC round trip, the
 * validators, the job runner, and the bytes on disk all stay real — only
 * the OS chooser itself is replaced. `stubDialogs` takes a QUEUE because
 * PipPanel asks three times in a row (base file, overlay file, output dir)
 * and each answer has to be different.
 *
 * CLIPBOARD. PostChecklist's copy buttons call
 * `navigator.clipboard.writeText` in the renderer. Rather than granting
 * clipboard-read permission to the page, the test reads the SYSTEM
 * clipboard back from the main process (`app.evaluate(({ clipboard }) =>
 * clipboard.readText())`) — the deepest possible end state, and it needs no
 * permission at all.
 *
 * ── Fixtures ──────────────────────────────────────────────────────────
 *
 * Five, all built once by the repo's own bundled ffmpeg:
 *   clipSrc  — 320x240 / 2 s / 15 fps testsrc2 + 440 Hz. The export fixture.
 *   pipSrc   — 160x120 / 2 s flat green, no audio. The PiP overlay.
 *   burstSrc — 320x240 / 14 s, a quiet 440 Hz bed with one 1.5 s full-scale
 *              burst at 6.0-7.5 s (the Layer 5 `rampSrc` recipe, shortened).
 *              findHighlights returns exactly one candidate for it.
 *   bigSrc   — 3840x2160 / 26 s / 1 fps flat colour (T-83). Big enough that no
 *              platform trips the "smaller than the output" check, and 26 s
 *              sits inside both TikTok's 21-34 s and Reels' 15-90 s sweet
 *              spots — so a 9:16 crop CAN turn those two indicators green,
 *              which is the thing the grid-honesty test has to show.
 *   longSrc  — 64x48 / ~1200 s, built by `-stream_loop` + `-c copy` from a
 *              15 s base so it costs ~0.6 s to make and 5 MB on disk. Two
 *              jobs need it: the chat panel (whose padded ranges run past
 *              90 s and would clamp against a short source) and the
 *              cancel-mid-scan test (whose ebur128 pass has to still be
 *              running when Cancel is clicked).
 *   fullHdSrc, bigLongSrc, midSrc (T-97) — flat-colour sources whose SIZE or
 *              LENGTH sits exactly on a threshold the export grid judges: a
 *              1920x1080 source that a 16:9 crop shrinks below YouTube's output,
 *              a 4K 50 s one that a 2x clip brings inside TikTok's sweet spot, and
 *              a 300 s one whose Reels verdict (yellow past 3 minutes) a 2x clip lifts, and (T-112)
 *              a 36-minute one on either side of Reels' 20-minute limit at 1x and 2x.
 *   cropMarkerSrc (T-96) — 640x360 / 2 s: a red block that a 1:1 crop excludes
 *              and a white square it keeps, so "the crop reached the output" is a
 *              question about the colour of pixels, not about a filename.
 *   shortSrc (T-105) — 320x240 / 6 s: under the GIF panel's 10-second warning at
 *              1x, so only a SLOW GIF of it is long enough to be warned about.
 *   rate60Src (T-130) — 320x240 / 2 s at 60 fps: the compilation and YouTube 1080p60 follow its rate.
 *
 * ── Timeouts ──────────────────────────────────────────────────────────
 *
 * Every test that spawns an ffmpeg job takes 600 s, and the polls that wait
 * for its bytes take 540 s. That is 50-100x what those jobs need on an idle
 * box (the whole file's real time is in the table "How long each layer takes" in
 * docs/TESTING.md, the one place a duration is written), and deliberately so: this runner hosts
 * several agent sessions at once, and a 1080p encode that normally finishes
 * in 3 s has been observed taking 200 s under that load. The generous ceiling
 * absorbs contention without hiding a real hang — a job that never starts
 * still fails, just later. UI-only tests keep the house's 120 s.
 *
 * ── Pinned defects this spec works around ─────────────────────────────
 *
 * T-38 (blank preview) is pinned by T-22, and T-40 (undo coalescing) was
 * FIXED on 2026-08-26 — a gesture end (Timeline mouseup, Rnd stop, slider
 * release or blur) now closes the coalescing window, so consecutive drags
 * are separate undo steps; nothing here worked around it. T-37
 * (seeking clamped to 0) was fixed on 2026-08-15 — the protocol handler now
 * answers Range requests — but none of the panels here seek, so the playback-
 * only parking below is left alone. New findings this spec turned up are marked
 * `FINDING-n` at the assertion that pins them and listed in the report.
 * FINDING-1 (chat "+ clip" toasting success for a clip it never added) was
 * fixed on 2026-08-15 by T-48; both halves of the clamp — a peak that
 * overruns the end lands, a peak outside the source is refused in the
 * panel's own words — are asserted in the ChatHighlightPanel negatives.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

const CLIP_SECONDS = 2
const CLIP_WIDTH = 320
const CLIP_HEIGHT = 240
const CLIP_FPS = 15

/** Root tmp dir for the whole file; the fixtures are built once into it. */
let root = ''
let clipSrc = ''
let pipSrc = ''
let burstSrc = ''
let longSrc = ''
let bigSrc = ''
/** 1920x1080 / 90 s flat colour (T-97): exactly YouTube's size, so a crop of it is smaller than the output. */
let fullHdSrc = ''
/** 3840x2160 / 50 s flat colour (T-97): past TikTok's 34 s sweet spot at 1x, inside it at 2x. */
let bigLongSrc = ''
/** 64x48 / 300 s (T-97): past the 3 minutes Instagram recommends a Reel to, at 1x; 150 s at 2x. */
let midSrc = ''
/** 64x48 / 36 min (T-112): past Reels' 20-minute limit at 1x (the kit asks), 18 minutes at 2x (it does not). */
let kitLongSrc = ''
/** 320x240 / 2 s flv (T-112): a container the importer converts, so the conversion can be held open. */
let flvSrc = ''
/** 48 kHz stereo tone (T-112): a sound for Audio Studio, so Clean audio has something to ask about. */
let toneSrc = ''
/** 640x360 / 2 s (T-96): a red block the 1:1 crop excludes, a white square it keeps. */
let cropMarkerSrc = ''
/** 320x240 / 6 s (T-105): inside the GIF panel's 10-second warning at 1x, outside it at 0.5x. */
let shortSrc = ''
/** 320x240 / 2 s / 60 fps + 440 Hz (T-130): a recording at OBS's usual rate, for the compilation that follows the source's rate and the 60 fps preset. */
let rate60Src = ''
/** 320x240 / 2 s ProRes + PCM sound in a .mov (T-135 (2)): ffprobe reads it, Chromium has no decoder for its picture (the element plays the sound and draws nothing). */
let proresSrc = ''
/** Real duration of longSrc, read back from ffprobe after the loop. */
let longSeconds = 0

interface ProbeStream {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  display_aspect_ratio?: string
  r_frame_rate?: string
}

interface ProbeJson {
  streams?: ProbeStream[]
  format?: { duration?: string; format_name?: string }
}

function runBinary(
  bin: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += String(b)))
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runBinary(ffmpegPath, args)
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

/** ffprobe (the bundled ffprobe-static binary) as parsed JSON. */
async function ffprobeJson(file: string): Promise<ProbeJson> {
  const result = await runBinary(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file
  ])
  if (result.code !== 0) {
    throw new Error(`ffprobe exit ${result.code} for ${file}: ${result.stderr.slice(-400)}`)
  }
  return JSON.parse(result.stdout) as ProbeJson
}

/** Number of frames ffprobe can actually decode out of `file`. */
async function ffprobeFrameCount(file: string): Promise<number> {
  const result = await runBinary(ffprobePath, [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    file
  ])
  if (result.code !== 0) {
    throw new Error(`ffprobe -count_frames exit ${result.code}: ${result.stderr.slice(-400)}`)
  }
  return Number(result.stdout.trim())
}

/**
 * How many pixels of one decoded frame are strongly red (R more than 60 levels
 * above both G and B), read by the bundled ffmpeg into a scratch file — the
 * same bytes-not-names idea as image.spec.ts' `samplePixel`. T-96 needs it
 * because a compilation or GIF that ignored the crop is the right size and
 * length either way; only the colour of its pixels says which one it is.
 */
async function redPixelCount(file: string, timeSec: number): Promise<number> {
  const raw = path.join(root, `red-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.raw`)
  const result = await runBinary(ffmpegPath, [
    '-y',
    // A still image (a Clip Kit thumbnail, T-130) has no clock: `-ss 0` on a JPEG decodes nothing at all.
    ...(/\.(jpe?g|png)$/i.test(file) ? [] : ['-ss', String(timeSec)]),
    '-i', file,
    '-vf', 'format=rgb24',
    '-frames:v', '1',
    '-f', 'rawvideo',
    raw
  ])
  if (result.code !== 0) {
    throw new Error(`pixel read exit ${result.code} for ${file}: ${result.stderr.slice(-400)}`)
  }
  const buf = readFileSync(raw)
  rmSync(raw, { force: true })
  // A read that returned no frame would count zero red pixels: say so rather than let an absence pass for a measurement.
  if (buf.length === 0) throw new Error(`pixel read returned no frame for ${file}`)
  let red = 0
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i] ?? 0
    if (r - Math.max(buf[i + 1] ?? 0, buf[i + 2] ?? 0) > 60) red++
  }
  return red
}

/** Mean luma (0-255) of one whole decoded frame — "is this part of the file brighter than that one". */
async function frameLuma(file: string, timeSec: number): Promise<number> {
  const raw = path.join(root, `luma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.raw`)
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-ss', String(timeSec),
    '-i', file,
    '-vf', 'format=gray',
    '-frames:v', '1',
    '-f', 'rawvideo',
    raw
  ])
  if (result.code !== 0) {
    throw new Error(`luma read exit ${result.code} for ${file}: ${result.stderr.slice(-400)}`)
  }
  const buf = readFileSync(raw)
  rmSync(raw, { force: true })
  let sum = 0
  for (const b of buf) sum += b
  return sum / buf.length
}

/** sha256 of a file's bytes: "the earlier export is exactly what it was". */
function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function videoStream(probe: ProbeJson): ProbeStream {
  const s = probe.streams?.find((x) => x.codec_type === 'video')
  if (!s) throw new Error('no video stream in probe')
  return s
}

/**
 * Hermetic userData dir. `extra` is merged at the top level, and
 * electron-store nests dotted keys, so `export.lastOutputDir` is seeded as
 * `{ export: { lastOutputDir } }` (export.spec.ts's shape).
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

/** The settings store as the app left it on disk. */
function readConfig(userDataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8')) as Record<
    string,
    unknown
  >
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
 * Replace the OS dialogs in the MAIN process with a queue of canned
 * answers. Each call shifts one entry; when the queue runs dry the last
 * answer repeats (so a panel that re-asks for a directory keeps working).
 * `null` in the queue simulates the user cancelling that particular chooser.
 *
 * Only the chooser is replaced — see the file header.
 */
async function stubDialogs(
  app: ElectronApplication,
  answers: { open?: Array<string | null>; save?: Array<string | null> }
): Promise<void> {
  await app.evaluate(({ dialog }, queues) => {
    function next(queue: Array<string | null>): string | null {
      if (queue.length === 0) return null
      return queue.length === 1 ? queue[0] : (queue.shift() ?? null)
    }
    if (queues.open) {
      const open = [...queues.open]
      ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => {
        const picked = next(open)
        return picked === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [picked] }
      }
    }
    if (queues.save) {
      const save = [...queues.save]
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => {
        const picked = next(save)
        return picked === null ? { canceled: true } : { canceled: false, filePath: picked }
      }
    }
  }, answers)
}

/**
 * T-124 (21): every OS chooser the main process is asked to open, recorded. A FOLDER chooser is answered "canceled" so a panel that
 * asks for one writes nothing and the test sees it asked; a FILE chooser takes the next of `files`.
 */
async function recordOpenDialogs(app: ElectronApplication, files: string[]): Promise<void> {
  await app.evaluate(({ dialog }, queue) => {
    const g = globalThis as unknown as { __opened?: string[] }
    g.__opened = []
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { properties?: string[] } | undefined
      const folder = (options?.properties ?? []).includes('openDirectory')
      g.__opened?.push(folder ? 'folder' : 'file')
      if (folder) return { canceled: true, filePaths: [] }
      const next = queue.shift()
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] }
    }
  }, [...files])
}

/** The kinds of chooser ('folder' or 'file') opened since the last recordOpenDialogs. */
async function openedDialogs(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __opened?: string[] }).__opened ?? [])
}

/** The system clipboard, read from the main process (see header). */
function systemClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

/** Wait until some toast text contains `needle`, then return the whole log. */
async function expectToast(window: Page, needle: string): Promise<string[]> {
  await expect
    .poll(() => readToastLog(window), { timeout: 30_000, intervals: [200] })
    .toEqual(expect.arrayContaining([expect.stringContaining(needle)]))
  return readToastLog(window)
}

/**
 * T-84: pressing Cancel is not a failure, and the toast has to say so in
 * words AND in kind.
 *
 * A SIGKILL'd ffmpeg exits non-zero exactly like a crash, so before T-84
 * every Cancel reached the user as a red toast in the runner's own words
 * ("FFmpeg exit null", "pip exit 1", "highlight scan cancelled"). Three
 * things are asserted, because each alone is passed by a different wrong
 * implementation: the sentence is the feature's own; the toast that carries
 * it drew NO status icon (a `toast.error` with the right words is still a red
 * error); and nothing in the log is in ffmpeg's or the IPC bridge's voice.
 */
async function expectCanceledNotFailed(window: Page, copy: string): Promise<void> {
  await expectToast(window, copy)
  const entries = await readToastEntries(window)
  const hit = entries.find((e) => e.text === copy)
  expect(hit, `a toast reading exactly "${copy}"`).toBeDefined()
  expect(hit?.hasIcon, `"${copy}" is a plain toast, not an error or success toast`).toBe(false)
  expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
    /\bexit\b|ffmpeg|ffprobe|cancelled|imagii:cancelled|Error invoking remote method/i
  )
}

/**
 * T-92: a live toast must not catch the click meant for the control beneath it.
 *
 * react-hot-toast draws each card with `pointer-events: auto`, so an 8-second
 * action toast over the Export button blocked it for its whole life (and a
 * pointer parked on the card paused the timer, so it never left): the emote-pack
 * test timed out clicking Export. The card is click-through now. This presses a
 * point on the card's own padding — clear of its text and of its button — and
 * reads where the click LANDED (a capture listener that swallows it, so the app
 * beneath is not actually pressed): it must be something other than the toaster.
 */
async function expectToastClickThrough(window: Page): Promise<void> {
  const card = window.locator('[data-rht-toaster] [role="status"]').first().locator('xpath=..')
  const box = await card.boundingBox()
  if (!box) throw new Error('no toast card on screen')
  await window.evaluate(() => {
    const w = window as unknown as { __landedInToaster: boolean | null }
    w.__landedInToaster = null
    window.addEventListener(
      'click',
      (e) => {
        e.stopImmediatePropagation()
        e.preventDefault()
        w.__landedInToaster = (e.target as Element).closest('[data-rht-toaster]') !== null
      },
      { capture: true, once: true }
    )
  })
  await window.mouse.click(box.x + 3, box.y + box.height / 2)
  expect(
    await window.evaluate(
      () => (window as unknown as { __landedInToaster: boolean | null }).__landedInToaster
    ),
    'the click reached the control under the toast, not the toast'
  ).toBe(false)
}

/**
 * T-92: a toast that carries the ONLY way to do something (Show in folder,
 * Edit in Video Studio) has to outlive react-hot-toast's 2 s default, or the
 * button is gone before a person who looked away can reach it. Asserted by
 * waiting past that default and finding the button still there — the one
 * place in this suite where a fixed wait IS the assertion — and then pressing
 * it: the shell (stubbed in main by `stubShellReveal`, installed before the
 * job) must receive exactly the file that was written.
 */
async function expectRevealToast(
  window: Page,
  app: ElectronApplication,
  written: string
): Promise<void> {
  const button = window
    .locator('[data-rht-toaster]')
    .getByRole('button', { name: 'Show in folder', exact: true })
  await expect(button, '"Show in folder" is on the toast').toBeVisible()
  await window.waitForTimeout(3500)
  await expect(button, '"Show in folder" is still there 3.5 s later').toBeVisible()
  await expectToastClickThrough(window)
  await button.click()
  await expect
    .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
    .toEqual([written])
}

/**
 * Dispatch a synthetic `drop` on Video Studio's drop zone carrying a File
 * with the absolute `path` expando Electron adds to real dropped files
 * (export.spec.ts explains why this is the only way to drive the import).
 */
async function dropOnVideoImporter(window: Page, filePath: string, fileName: string): Promise<void> {
  await window.evaluate(
    ({ filePath, fileName }) => {
      const zone = document.querySelector('[data-tutorial="video-import"] .card')
      if (!zone) throw new Error('Video Studio drop zone not found')
      const file = new File([new Uint8Array([0])], fileName, { type: '' })
      Object.defineProperty(file, 'path', { value: filePath })
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
      zone.dispatchEvent(event)
    },
    { filePath, fileName }
  )
}

interface Studio {
  app: ElectronApplication
  window: Page
  userDataDir: string
  outDir: string
}

/** Launch, walk to Video Studio, and import `fixture` through the drop zone. */
async function launchWithVideo(
  name: string,
  fixture: string = clipSrc,
  seed?: Record<string, unknown>
): Promise<Studio> {
  const studio = await launchHome(name, seed)
  await gotoVideoStudio(studio.window)
  await installToastLog(studio.window)
  await dropOnVideoImporter(studio.window, fixture, path.basename(fixture))
  // Loaded state: the Importer is replaced by the player + Export panel.
  // Pinned to the panel's own scope: GifPanel's "Export GIF" also starts
  // with "Export".
  await expect(exportCard(studio.window).getByRole('button', { name: /^Export/ })).toBeVisible({
    timeout: 30_000
  })
  await expect(studio.window.locator('video')).toHaveCount(1)
  return studio
}

/** Launch and stop on Home (the project-load entry point). */
async function launchHome(name: string, seed?: Record<string, unknown>): Promise<Studio> {
  const userDataDir = path.join(root, `ud-${name}-${Date.now().toString(36)}`)
  const outDir = path.join(root, `out-${name}-${Date.now().toString(36)}`)
  mkdirSync(outDir, { recursive: true })
  seedUserData(userDataDir, seed)
  const app = await launchApp(userDataDir)
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  return { app, window, userDataDir, outDir }
}

async function gotoVideoStudio(window: Page): Promise<void> {
  await window.locator('a', { hasText: 'Video Studio' }).first().click()
  await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
}

// ── panel scopes ──────────────────────────────────────────────────────────

/** A card pinned by a control only that card owns. Used where that
 *  control's label never changes; the three job panels below need the
 *  opposite treatment for the reason given there. */
function cardWithButton(window: Page, name: string | RegExp): Locator {
  return window.locator('.card').filter({ has: window.getByRole('button', { name }) })
}

function chatCard(window: Page): Locator {
  return cardWithButton(window, 'Find chat spikes')
}

function highlightCard(window: Page): Locator {
  return window.locator('[data-tutorial="video-highlights"]')
}

function clipListCard(window: Page): Locator {
  return cardWithButton(window, '+ Add clip')
}

function exportCard(window: Page): Locator {
  return window.locator('[data-tutorial="video-export"]')
}

function captionsCard(window: Page): Locator {
  return window.locator('[data-tutorial="video-captions"]')
}

function reframeCard(window: Page): Locator {
  return window.locator('[data-tutorial="video-reframe"]')
}

/**
 * The three job panels are pinned by their PanelHeader copy, not by their
 * action button: each button's LABEL is its own progress readout ("Export
 * GIF" -> "Exporting…", "Compile" -> "Stitching…", "Composite" ->
 * "Compositing…"), so a button-based card locator stops resolving for
 * exactly as long as the job it started is running.
 */
function gifCard(window: Page): Locator {
  return window.locator('.card').filter({ hasText: 'Export as GIF' })
}

function compileCard(window: Page): Locator {
  return window.locator('.card').filter({ hasText: 'Compile clips (' })
}

/**
 * T-125 (10): Reframe, GIF, Compile and Picture-in-picture hold ONE folder, so a panel that is used after another one's pick already
 * shows it: there is no "Choose folder…" to press (the guide says the four follow each other, and until round 75 each read it once at
 * mount). A test that drives the second panel asserts that, and does not press a button that is no longer there.
 */
async function expectFolderShown(card: Locator, outDir: string, what: string): Promise<void> {
  await expect(card.getByRole('button', { name: 'Choose folder…' }), `${what}: no chooser, the folder is already set`).toHaveCount(0)
  await expect(card.getByRole('button', { name: `Output folder: ${path.basename(outDir)}` }), `${what}: shows the shared folder`).toBeVisible()
}

function pipCard(window: Page): Locator {
  return window.locator('.card').filter({ hasText: 'Picture-in-picture composite' })
}

function postCard(window: Page): Locator {
  return cardWithButton(window, 'Title starters')
}

/** The clip rows of the ClipList, as "name" + "start → end" pairs. */
async function clipRows(window: Page): Promise<Array<{ name: string; range: string }>> {
  const rows = clipListCard(window).locator('li')
  const count = await rows.count()
  const out: Array<{ name: string; range: string }> = []
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    out.push({
      name: (await row.getByRole('textbox').inputValue()).trim(),
      range: (await row.getByRole('button', { name: /^Select clip/ }).innerText()).trim()
    })
  }
  return out
}

function mp4sIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort()
}

// ── chat-log fixtures ────────────────────────────────────────────────────

function mmss(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

/**
 * A chat log whose density profile is arithmetic, not vibes:
 *   - a quiet bed of 2 messages in every 10 s bucket from 0 s to 90 s,
 *     except the 30 s bucket,
 *   - a spike of 9 messages inside 0:30-0:38.
 *
 * ChatHighlightPanel's findPeaks takes the median bucket size (2) and
 * thresholds at max(median * 2, 5) = 5, so exactly one bucket qualifies and
 * its numbers are known in advance: 9 messages, bucket start 30 s.
 */
function chatLogWithOneSpike(): string {
  const lines: string[] = []
  for (const t of [2, 7, 12, 17, 22, 27, 42, 47, 52, 57, 62, 67, 72, 77, 82, 87]) {
    lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  }
  for (let i = 0; i < 9; i++) {
    lines.push(`[${mmss(30 + i)}] hype${i}: POG that was insane`)
  }
  return lines.join('\n')
}

/**
 * Same arithmetic, spike moved to the very first bucket: a quiet bed of 2
 * messages per 10 s bucket from 10 s to 90 s, and 9 messages inside
 * 0:00-0:08. Median is 2 and the threshold max(4, 5) = 5, so only bucket 0
 * qualifies; padded by 15 s it starts at max(0, 0 - 15) = 0. That is the
 * peak whose START is inside a 2 s source while its padded END runs past
 * it — the case that must still land as a clamped clip (T-48).
 */
function chatLogWithEarlySpike(): string {
  const lines: string[] = []
  for (const t of [12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77, 82, 87]) {
    lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  }
  for (let i = 0; i < 9; i++) {
    lines.push(`[${mmss(i)}] hype${i}: POG that was insane`)
  }
  return lines.join('\n')
}

/**
 * T-135 (3): one 30-second explosion of chat, three ADJACENT 10 s buckets. A quiet bed of one message in every bucket from 0 s to 190 s except
 * 120, 130 and 140 (median 1, so the threshold is the floor of 5), and 8 messages inside each of those three buckets. The finder must list it
 * as ONE spike: 24 messages, from 120 - 15 = 105 s (1:45) to 140 + 10 + 15 = 165 s (2:45).
 */
function chatLogWithThreeBucketSpike(): string {
  const lines: string[] = []
  for (let t = 1; t < 200; t += 10) {
    if (t >= 120 && t < 150) continue
    lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  }
  for (const bucket of [120, 130, 140]) {
    for (let i = 0; i < 8; i++) lines.push(`[${mmss(bucket + i)}] hype${bucket}x${i}: POG that was insane`)
  }
  return lines.join('\n')
}

/** Same bed, no spike — every bucket sits under the threshold of 5. */
function chatLogWithNoSpike(): string {
  const lines: string[] = []
  for (const t of [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77]) {
    lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  }
  return lines.join('\n')
}

/**
 * Chat that exists but says nothing about the burst (T-92): a quiet bed from
 * 30 s to 90 s, none of it inside the candidate's window (1.3-12.7 s). With
 * chat in play the moment is judged by all three signals, and chat was silent
 * for it — audio 1 x 0.4 of a total 1.0 = 40. It is what separates "no chat
 * pasted" (the score is the audio alone, 100) from "chat pasted, and it did
 * not light up here" (40).
 */
function chatLogSilentAtBurst(): string {
  const lines: string[] = []
  for (const t of [30, 33, 40, 43, 50, 53, 60, 63, 70, 73]) {
    lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  }
  return lines.join('\n')
}

/**
 * Chat for the HighlightPanel's rescoring: 12 hype messages inside the
 * burst candidate's window (1.3-12.7 s) and a thin tail out to 90 s so
 * `chatDensityMedian` has more than one bucket to take a median of (it
 * returns 0 — no baseline — when every message lands in one bucket).
 *
 * With that shape all three signals saturate: audio 1 (the burst is
 * -4 LUFS), chat density 1 (12 messages against a baseline of 1), hype 1
 * (12 keyword hits against a cap of 5).
 */
function chatLogOverBurst(): string {
  const lines: string[] = []
  for (let i = 0; i < 12; i++) {
    lines.push(`[0:0${i < 6 ? 6 : 7}] burstfan${i}: POGGERS no way`)
  }
  for (const t of [20, 30, 40, 50, 60, 70, 80, 90]) {
    lines.push(`[${mmss(t)}] lurker${t}: hmm`)
  }
  return lines.join('\n')
}

// ── fixture build ────────────────────────────────────────────────────────

test.beforeAll(async () => {
  root = path.join(os.tmpdir(), `imagii-e2e-video-pipelines-${Date.now().toString(36)}`)
  const sourceDir = path.join(root, 'source')
  mkdirSync(sourceDir, { recursive: true })
  if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })

  clipSrc = path.join(sourceDir, 'pipeline.mp4')
  pipSrc = path.join(sourceDir, 'overlay.mp4')
  burstSrc = path.join(sourceDir, 'burst.mp4')
  const loopBase = path.join(sourceDir, 'loopbase.mp4')
  longSrc = path.join(sourceDir, 'long.mp4')

  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${CLIP_WIDTH}x${CLIP_HEIGHT}:rate=${CLIP_FPS}:duration=${CLIP_SECONDS}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    clipSrc
  ])

  // Flat green, no audio — a single colour makes "is the overlay in the
  // output" a pixel question rather than a file-size one (Layer 5's
  // pipOverlaySrc recipe).
  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x1fe04a:size=160x120:rate=${CLIP_FPS}:duration=${CLIP_SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    pipSrc
  ])

  // Quiet bed + one unmistakable burst. `volume=12` clips the sine on
  // purpose: it puts the burst's momentary loudness at about -4 LUFS, which
  // saturates audioPeakToScore instead of landing on its 0.6 knee.
  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x240:rate=15:duration=14',
    '-f', 'lavfi',
    '-i',
    "sine=frequency=440:sample_rate=44100:duration=14,volume='if(between(t,6,7.5),12,0.02)':eval=frame",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '1', '-shortest',
    burstSrc
  ])

  // A 20-minute source for ~0.6 s of work: encode 15 s once, then loop the
  // packets with `-c copy`.
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=2:d=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-shortest',
    loopBase
  ])
  // T-83: 4K, 26 s, one frame per second — a flat colour at 1 fps encodes in
  // well under a second and decodes without effort, and the file is a few KB.
  bigSrc = path.join(sourceDir, 'big.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x303a4a:size=3840x2160:rate=1:duration=26',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    bigSrc
  ])
  fullHdSrc = path.join(sourceDir, 'fullhd.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x303a4a:size=1920x1080:rate=1:duration=90',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    fullHdSrc
  ])
  bigLongSrc = path.join(sourceDir, 'biglong.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x303a4a:size=3840x2160:rate=1:duration=50',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    bigLongSrc
  ])
  midSrc = path.join(sourceDir, 'mid.mp4')
  await ffmpeg(['-y', '-stream_loop', '19', '-i', loopBase, '-c', 'copy', midSrc])
  cropMarkerSrc = path.join(sourceDir, 'cropmarker.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i',
    `color=c=black:s=640x360:r=15:d=${CLIP_SECONDS},drawbox=x=20:y=20:w=80:h=80:color=red:t=fill,drawbox=x=290:y=150:w=60:h=60:color=white:t=fill`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    cropMarkerSrc
  ])
  shortSrc = path.join(sourceDir, 'short6.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    shortSrc
  ])
  rate60Src = path.join(sourceDir, 'rate60.mp4')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${CLIP_WIDTH}x${CLIP_HEIGHT}:rate=60:duration=${CLIP_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    rate60Src
  ])
  flvSrc = path.join(sourceDir, 'stream.flv')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${CLIP_WIDTH}x${CLIP_HEIGHT}:rate=${CLIP_FPS}:duration=${CLIP_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-f', 'flv',
    flvSrc
  ])
  toneSrc = path.join(sourceDir, 'tone.wav')
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-ar', '48000', '-ac', '2', toneSrc])
  kitLongSrc = path.join(sourceDir, 'kitlong.mp4')
  await ffmpeg(['-y', '-stream_loop', '143', '-i', loopBase, '-c', 'copy', kitLongSrc])
  await ffmpeg(['-y', '-stream_loop', '79', '-i', loopBase, '-c', 'copy', longSrc])
  longSeconds = Number((await ffprobeJson(longSrc)).format?.duration ?? 0)
  expect(longSeconds).toBeGreaterThan(600)
  proresSrc = path.join(sourceDir, 'undecodable-prores.mov')
  await ffmpeg([
    '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${CLIP_WIDTH}x${CLIP_HEIGHT}:rate=${CLIP_FPS}:duration=${CLIP_SECONDS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`,
    '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s16le', '-shortest',
    proresSrc
  ])
})

test.afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ═════════════════════════ ChatHighlightPanel (4g) ═════════════════════════

test.describe('ChatHighlightPanel', () => {
  test('the spike window takes typed digits: 45 is 45, not 1045, and a number outside 3 to 60 is clamped when typing ends (T-123 (4))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('chat-window', longSrc)
    try {
      const card = chatCard(window)
      const windowSec = card.getByLabel('Spike window (s)')
      await expect(windowSec).toHaveValue('10')
      await windowSec.click()
      await windowSec.press('Control+a')
      await windowSec.press('Backspace')
      await expect(windowSec, 'emptied: nothing snaps back into it').toHaveValue('')
      await windowSec.press('4')
      await windowSec.press('5')
      await expect(windowSec).toHaveValue('45')
      await leave(windowSec)
      await expect(windowSec).toHaveValue('45')
      await retype(windowSec, '600')
      await leave(windowSec)
      await expect(windowSec).toHaveValue('60')
      await retype(windowSec, '1')
      await leave(windowSec)
      await expect(windowSec).toHaveValue('3')
      await windowSec.click()
      await windowSec.press('Control+a')
      await windowSec.press('Backspace')
      await leave(windowSec)
      await expect(windowSec, 'an emptied box goes back to what it was').toHaveValue('3')
    } finally {
      await app.close()
    }
  })

  test('finds the spike a pasted log actually contains, and + clip lands the padded range in the Clips list', async () => {
    test.setTimeout(120_000)
    // longSrc (20 min) rather than the 2 s export fixture: addPeak clamps
    // the padded range to the SOURCE duration, so on a short source this
    // log's peaks fall outside the video entirely and are refused (the
    // T-48 case, covered by the next test).
    const { app, window } = await launchWithVideo('chat', longSrc)
    try {
      const card = chatCard(window)
      await expect(card.getByText('Chat spike finder')).toBeVisible()
      // T-92: the two number fields say what they are in a streamer's words
      // ("Bucket sec" / "Pad sec" were the labels).
      await expect(card.getByLabel('Spike window (s)')).toHaveValue('10')
      await expect(card.getByLabel('Extra seconds around each clip')).toHaveValue('15')
      // Nothing rendered before an analysis: no peak rows, no + clip.
      await expect(card.locator('li')).toHaveCount(0)

      await card.locator('textarea').fill(chatLogWithOneSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()

      // ── one peak, with the numbers the log's density dictates ──
      await expect(card.locator('li')).toHaveCount(1)
      await expectToast(window, 'Found 1 chat spike')
      const row = card.locator('li').first()
      // bucketStart 30 s, minus the 15 s pad = 0:15. The count is the
      // spike bucket's own size, and the preview is its first 3 messages.
      // T-136 (9): and where it ENDS (the row used to show only the start), so what "+ Clip" adds is what the row says.
      await expect(row.locator('span.font-mono')).toHaveText('0:15 → 0:55')
      await expect(row.getByText('9 messages')).toBeVisible()
      await expect(row).toContainText('POG that was insane · POG that was insane')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-01-chat-peaks.png') })

      // ── + clip: a real clip, with the padded range, in the store ──
      // T-94: the scanner's FIRST clip retires the untouched whole-video
      // "Clip 1" (the dedicated tests below drive that end to end), so the
      // list goes from the one default clip to the one excerpt.
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await expectToast(window, 'Clip added')
      // start = bucketStart (15), end = bucketStart + bucket + 2 * pad = 55.
      expect(await clipRows(window)).toEqual([{ name: 'Chat spike 1', range: '0:15 → 0:55' }])

      // ── the two number inputs change the arithmetic, not just the UI ──
      // Pad 15 -> 0 moves the peak's start from 0:15 to the bucket itself.
      await card.getByRole('spinbutton').nth(1).fill('0')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:30 → 0:40')
      await expect(card.locator('li').first().getByText('9 messages')).toBeVisible()

      // Bucket 10 -> 5 splits the 9-message spike across two 5 s buckets;
      // only the first still clears the threshold, so the count drops to 5.
      await card.getByRole('spinbutton').first().fill('5')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().getByText('5 messages')).toBeVisible()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:30 → 0:35')

      // And the re-run's + clip uses the NEW numbers: 30 -> 30 + 5 + 0. By now
      // there is no whole-video clip left to retire, so this one just adds.
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window))[1]).toEqual({
        name: 'Chat spike 1',
        range: '0:30 → 0:35'
      })
    } finally {
      await app.close()
    }
  })

  // T-135 (3): the finder compared the next bucket's UNPADDED key with the previous row's PADDED start, so with the defaults (10 s buckets, 15 s of padding)
  // adjacent hype buckets read 25 < 20 = false and one 30 s explosion became three overlapping rows (and the 12-row cap filled with near-duplicates).
  test('three adjacent hype buckets are ONE row, and + Clip lands the whole spike with its padding (T-135 (3))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('chat3', longSrc)
    try {
      const card = chatCard(window)
      await card.locator('textarea').fill(chatLogWithThreeBucketSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expectToast(window, 'Found 1 chat spike')
      await expect(card.locator('li'), 'one spike, one row').toHaveCount(1)
      const row = card.locator('li').first()
      await expect(row.locator('span.font-mono')).toHaveText('1:45 → 2:45')
      await expect(row.getByText('24 messages')).toBeVisible()
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      // The window covers all three buckets: 105 s .. 165 s.
      expect(await clipRows(window)).toEqual([{ name: 'Chat spike 1', range: '1:45 → 2:45' }])
    } finally {
      await app.close()
    }
  })

  test('refuses a log with no timestamps, and refuses a peak this video does not contain', async () => {
    test.setTimeout(120_000)
    // A SHORT source on purpose — the last two cases need peaks whose
    // padded ranges run off the end of the video (T-48).
    const { app, window } = await launchWithVideo('chatneg', clipSrc)
    try {
      const card = chatCard(window)
      const analyze = card.getByRole('button', { name: 'Find chat spikes' })

      // ── negative 1: text, but not chat ──
      await card.locator('textarea').fill(
        'these are my stream notes\nno timestamps here\njust prose'
      )
      await analyze.click()
      // The parser's exact copy, not a paraphrase.
      const PARSE_ERROR =
        'No timestamped messages found. Each line should start like [12:34] username: message'
      await expectToast(window, PARSE_ERROR)
      await expect(window.getByText(PARSE_ERROR).first()).toBeVisible()
      await expect(card.locator('li')).toHaveCount(0)
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')

      // ── negative 2: real chat, no spike — a DIFFERENT sentence ──
      // The pair is the discrimination proof: the same button on parseable
      // input never emits the parse-error copy, so the assertion above is
      // pinned to the parse branch rather than to "some toast appeared".
      await card.locator('textarea').fill(chatLogWithNoSpike())
      await analyze.click()
      await expectToast(window, 'No chat spikes detected')
      await expect(card.locator('li')).toHaveCount(0)
      const toasts = await readToastLog(window)
      expect(toasts.filter((t) => t.includes(PARSE_ERROR))).toHaveLength(1)
      expect(toasts.some((t) => t.includes('Found'))).toBe(false)
      // Neither negative produced a clip.
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')

      // ── negative 3 (T-48): a peak this video does not contain ──
      // addPeak clamps BOTH ends to the source now. This log's spike sits at
      // 0:30 — past the end of a 2 s video — so the clamped range collapses
      // and there is no clip to make. Before T-48 the end was clamped and
      // the start was not, the range came out reversed, addClipFromRange
      // refused it in silence, and the panel toasted "Clip added" anyway.
      await card.locator('textarea').fill(chatLogWithOneSpike())
      await analyze.click()
      await expect(card.locator('li')).toHaveCount(1)
      // The peak itself is real: 0:15, past the end of this 2 s source. T-137 (9): the row shows the range "+ Clip" would add, both ends held to the video
      // (it read '0:15 → 0:55', a range that is not in the 2 s file), so a spike entirely past the end is an empty range at the end.
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:02 → 0:02')
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()
      const REFUSAL =
        'That spike is past the end of this video — check the log matches this source.'
      await expectToast(window, REFUSAL)
      await expect(window.getByText(REFUSAL).first()).toBeVisible()
      // No clip, and — the whole point of the ticket — no claim that there is one.
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Clip 1', range: '0:00 → 0:02' }])
      expect((await readToastLog(window)).some((t) => t.includes('Clip added'))).toBe(false)

      // ── the positive half of the same clamp: a peak that merely OVERRUNS ──
      // Its bucket starts inside the video and its padded end runs past it,
      // so the end clamps to the duration and the clip really lands. The
      // pair is the discrimination proof: the refusal above is about the
      // peak being outside the source, not about padding hitting the end.
      await card.locator('textarea').fill(chatLogWithEarlySpike())
      await analyze.click()
      await expect(card.locator('li')).toHaveCount(1)
      // T-137 (9): and the row says what the clip will be, the end held to the 2 s video (it read '0:00 → 0:25').
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:00 → 0:02')
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      // T-94: it replaced the untouched whole-video clip (also 0:00 → 0:02 on
      // this 2 s source, which is why the NAME is what tells them apart).
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Chat spike 1', range: '0:00 → 0:02' }])
    } finally {
      await app.close()
    }
  })
})

test.describe('ChatHighlightPanel — the whole-video clip (T-94)', () => {
  test('the chat scanner retires it too, a manual + Add clip never does, and a clip the user touched is left alone', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t94chat', longSrc)
    try {
      const card = chatCard(window)
      const list = clipListCard(window)
      await card.locator('textarea').fill(chatLogWithOneSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li')).toHaveCount(1)

      // ── manual: "+ Add clip" is the user making a clip on purpose ──
      await list.getByRole('button', { name: '+ Add clip' }).click()
      await expect(list.locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Clip 1', 'Clip 2'])

      // ── scanner: retires the untouched "Clip 1" and ONLY that one ──
      // "Clip 2" is the same whole-video range, but the user asked for it.
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()
      await expectToast(
        window,
        'Removed the whole-video clip — the highlights are your clips now. Press Ctrl+Z to keep it.'
      )
      await expect(list.locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Clip 2', 'Chat spike 1'])

      // ── one undo puts back exactly the state before the scanner's add ──
      await window.keyboard.press('Control+z')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Clip 1', 'Clip 2'])
    } finally {
      await app.close()
    }
  })

  test('a whole-video clip the user has trimmed is theirs: the scanner adds beside it, silently', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t94touched', longSrc)
    try {
      const card = chatCard(window)
      const list = clipListCard(window)
      // Touch Clip 1: any edit at all — here, renaming it.
      await list.locator('li').first().getByRole('textbox').fill('Whole stream')
      await card.locator('textarea').fill(chatLogWithOneSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      await expect(list.locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Whole stream', 'Chat spike 1'])
      // No removal, so no removal toast.
      expect(
        (await readToastLog(window)).some((t) => t.includes('Removed the whole-video clip'))
      ).toBe(false)
    } finally {
      await app.close()
    }
  })
})

// ══════════════════════════ HighlightPanel (4j) ════════════════════════════

test.describe('HighlightPanel', () => {
  test('scans a real VOD, renders the candidate it found with its signal bars, and adds it as a clip', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('scan', burstSrc)
    try {
      const card = highlightCard(window)
      const scan = card.getByRole('button', { name: 'Scan VOD' })
      await expect(scan).toBeEnabled()
      await expect(card.locator('li')).toHaveCount(0)

      // ── the real ebur128 pass over the real file ──
      await scan.click()
      await expect(card.locator('li')).toHaveCount(1, { timeout: 60_000 })
      await expectToast(window, 'Found 1 highlight')
      // Re-scan is the button's post-scan identity.
      await expect(card.getByRole('button', { name: 'Re-scan' })).toBeVisible()

      // The fixture's burst is at 6.0-7.5 s and candidates are padded by
      // 5 s, so the window brackets it without swallowing the whole 14 s.
      const row = card.locator('li').first()
      await expect(row.locator('span.font-mono').first()).toHaveText('0:01 → 0:12')
      // T-92: with no chat the audio signal is the whole average, so a saturated
      // peak is a full 100 (it was audio x 0.4 = 40, a ceiling the panel's own
      // "0–100" never mentioned).
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('100')
      await expect(row).toContainText('Loud audio peak')
      // T-112: the pill reads in ink on its accent wash (accent text on it measured 3.6:1,
      // under AA); the accent border carries the identity.
      const pillStyle = await row.getByTitle('Combined score (0–100)').evaluate((el) => {
        const cs = getComputedStyle(el)
        return { color: cs.color, border: cs.borderTopColor }
      })
      expect(pillStyle.color).toBe('rgb(236, 228, 226)') // ink-base
      expect(pillStyle.border).not.toBe('rgba(0, 0, 0, 0)')

      // ── SignalBars: three of them, and only audio has fired ──
      const bars = row.locator('div[title$="%"]')
      await expect(bars).toHaveCount(3)
      await expect(bars.nth(0)).toHaveAttribute('title', 'Audio: 100%')
      await expect(bars.nth(1)).toHaveAttribute('title', 'Chat: 0%')
      await expect(bars.nth(2)).toHaveAttribute('title', 'Hype: 0%')
      // T-113: each is a named, valued meter (it was a colored width), so a screen reader
      // hears "Audio signal, 100" and not three unlabeled bars.
      const meters = row.getByRole('meter')
      await expect(meters).toHaveCount(3)
      await expect(meters.nth(0)).toHaveAccessibleName('Audio signal')
      await expect(meters.nth(1)).toHaveAccessibleName('Chat signal')
      await expect(meters.nth(2)).toHaveAccessibleName('Hype signal')
      await expect(meters.nth(0)).toHaveAttribute('aria-valuenow', '100')
      await expect(meters.nth(1)).toHaveAttribute('aria-valuenow', '0')
      await expect(meters.nth(2)).toHaveAttribute('aria-valuenow', '0')
      for (let i = 0; i < 3; i += 1) {
        await expect(meters.nth(i)).toHaveAttribute('aria-valuemin', '0')
        await expect(meters.nth(i)).toHaveAttribute('aria-valuemax', '100')
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-02-highlights.png') })

      // ── + Clip ──
      // T-94: the scanner's first clip replaces the untouched whole-video
      // "Clip 1" (driven end to end in the T-94 test below).
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await expectToast(window, 'Clip added — see the Clips list')
      expect(await clipRows(window)).toEqual([{ name: 'Highlight 1', range: '0:01 → 0:12' }])
    } finally {
      await app.close()
    }
  })

  test('the first highlight retires the untouched whole-video clip, one undo brings it back, and Export writes only what is left (T-94)', async () => {
    test.setTimeout(600_000)
    // The VOD path, end to end: load a "VOD" (14 s here, 3 h in life), scan it,
    // add the highlight, export. Before T-94 the whole-video "Clip 1" rode
    // along in every export — the full source re-encoded beside the excerpt —
    // and the button said "Export 6" without saying six of what.
    const { app, window, outDir } = await launchWithVideo('t94', burstSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = highlightCard(window)
      const exp = exportCard(window)
      const undo = window.getByRole('button', { name: 'Undo' })
      const WHOLE_GONE =
        'Removed the whole-video clip — the highlights are your clips now. Press Ctrl+Z to keep it.'

      // ── before: the whole-video clip, and a button that counts FILES ──
      expect(await clipRows(window)).toEqual([{ name: 'Clip 1', range: '0:00 → 0:14' }])
      await expect(exp.getByRole('button', { name: 'Export 1 file', exact: true })).toBeVisible()

      await card.getByRole('button', { name: 'Scan VOD' }).click()
      await expect(card.locator('li')).toHaveCount(1, { timeout: 60_000 })
      await card.locator('li').first().getByRole('button', { name: '+ Clip' }).click()

      // ── after the first + Clip: the whole-video clip is gone ──
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Highlight 1', range: '0:01 → 0:12' }])
      // ...the user was told, once, with the way back...
      const toasts = await expectToast(window, WHOLE_GONE)
      expect(toasts.filter((t) => t.includes('Removed the whole-video clip'))).toHaveLength(1)
      // ...the add itself still reported (the two toasts are different facts)...
      expect(toasts.some((t) => t.includes('Clip added — see the Clips list'))).toBe(true)

      // ── ONE undo restores both halves: the whole-video clip is back and the
      //    highlight is gone, and there is nothing further to undo ──
      await window.keyboard.press('Control+z')
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Clip 1', range: '0:00 → 0:14' }])
      await expect(undo).toBeDisabled()
      // ...and redo takes them away again, together.
      await window.keyboard.press('Control+y')
      expect(await clipRows(window)).toEqual([{ name: 'Highlight 1', range: '0:01 → 0:12' }])

      // ── the button says what it will produce, in files ──
      await presetBox(window, 'X / Twitter').check()
      await expect(exp.getByRole('button', { name: 'Export 2 files', exact: true })).toBeEnabled()

      // ── and the export writes exactly that: the excerpt on two platforms,
      //    NOT the 14 s source on top of it ──
      await exp.getByRole('button', { name: 'Choose folder…' }).click()
      await exp.getByRole('button', { name: 'Export 2 files', exact: true }).click()
      const expected = ['burst_Highlight 1_twitter.mp4', 'burst_Highlight 1_youtube.mp4']
      await expect
        .poll(() => mp4sIn(outDir), { timeout: 540_000, intervals: [500] })
        .toEqual(expected)
      await expectToast(window, 'Exported 2 files')
      for (const name of expected) {
        const seconds = Number((await ffprobeJson(path.join(outDir, name))).format?.duration)
        // The burst candidate is ~1.3-12.7 s of a 14 s file. A full-source
        // re-encode would be 14 s; the excerpt is ~11.4.
        expect(seconds, `${name} is the excerpt, not the source`).toBeGreaterThan(10)
        expect(seconds, `${name} is the excerpt, not the source`).toBeLessThan(13)
      }
      expect(mp4sIn(outDir).some((f) => f.includes('Clip 1'))).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('the optional chat log rescoring is debounced and moves every signal', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('rescore', burstSrc)
    try {
      const card = highlightCard(window)
      // The disclosure is collapsed on arrival — no textarea in the panel.
      await expect(card.locator('textarea')).toHaveCount(0)

      await card.getByRole('button', { name: 'Scan VOD' }).click()
      await expect(card.locator('li')).toHaveCount(1, { timeout: 60_000 })
      const row = card.locator('li').first()
      const score = row.getByTitle('Combined score (0–100)')
      // T-92: no chat, so audio is the whole average and this saturated peak is
      // a full 100.
      await expect(score).toHaveText('100')

      // ── disclosure opens the textarea ──
      // T-113: the button says whether it is open (it showed a chevron and nothing else).
      const disclosure = card.getByRole('button', { name: 'Add chat log (optional)' })
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
      const textarea = card.locator('textarea')
      await expect(textarea).toHaveCount(1)

      // ── debounce: the score does not move on the first keystrokes ──
      // fill() sets the value in one event, so watch the 300 ms window
      // directly: immediately after the input the panel still shows the
      // audio-only score, and only the debounced value triggers a rescore.
      await textarea.fill(chatLogSilentAtBurst())
      expect(await score.innerText()).toBe('100')

      // ── chat in play but silent at this moment weighs against it ──
      await expect(score).toHaveText('40', { timeout: 5_000 })
      await expect(row.locator('div[title$="%"]').nth(1)).toHaveAttribute('title', 'Chat: 0%')

      // ── a log that lights up the moment brings every signal in ──
      await textarea.fill(chatLogOverBurst())
      await expect(score).toHaveText('100', { timeout: 5_000 })
      const bars = row.locator('div[title$="%"]')
      await expect(bars.nth(1)).toHaveAttribute('title', 'Chat: 100%')
      await expect(bars.nth(2)).toHaveAttribute('title', 'Hype: 100%')
      await expect(row).toContainText('Loud audio peak · Chat spike · Hype keywords')
      // The messages that earned it are quoted back.
      await expect(row).toContainText('POGGERS no way')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-03-rescored.png') })

      // ── collapsing hides the input without discarding the score ──
      await card.getByRole('button', { name: 'Add chat log (optional)' }).click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(card.locator('textarea')).toHaveCount(0)
      await expect(score).toHaveText('100')

      // Clearing the log takes the chat signals back out, and the score is
      // the audio alone again.
      await card.getByRole('button', { name: 'Add chat log (optional)' }).click()
      await card.locator('textarea').fill('')
      await expect(bars.nth(1)).toHaveAttribute('title', 'Chat: 0%', { timeout: 5_000 })
      await expect(score).toHaveText('100')
    } finally {
      await app.close()
    }
  })

  test('Cancel kills the scan mid-flight and hands the panel back', async () => {
    test.setTimeout(120_000)
    // A 20-minute source: the ebur128 pass takes ~5 s, so Cancel lands
    // while the job is genuinely in flight rather than racing its end.
    const { app, window } = await launchWithVideo('scancancel', longSrc)
    try {
      const card = highlightCard(window)
      await card.getByRole('button', { name: 'Scan VOD' }).click()

      // The in-flight row: progress bar, percentage readout, Cancel.
      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible({ timeout: 20_000 })
      // T-113: the bar is a named progressbar with its value (it was a colored width).
      const scanBar = card.getByRole('progressbar', { name: 'Scanning the video for highlights' })
      await expect(scanBar).toBeVisible()
      await expect(scanBar).toHaveAttribute('aria-valuemin', '0')
      await expect(scanBar).toHaveAttribute('aria-valuemax', '100')
      await expect(scanBar).toHaveAttribute('aria-valuenow', /^\d+$/)
      await expect(card.getByRole('button', { name: 'Scanning…' })).toBeDisabled()
      await cancel.click()

      // The main process rejected the promise rather than resolving empty,
      // and marked WHY: the user asked. T-84 — the toast is the panel's own
      // neutral sentence, not the killed scan's message in a red toast.
      await expectCanceledNotFailed(window, 'Scan canceled.')
      // UI reset: no progress row, no candidates, and the button is back to
      // its never-scanned identity (audioCandidates was never set).
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Scan VOD' })).toBeEnabled()
      await expect(card.locator('li')).toHaveCount(0)
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')

      // The single scan slot was freed, not left occupied by the dead job.
      await card.getByRole('button', { name: 'Scan VOD' }).click()
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 20_000 })
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(card.getByRole('button', { name: 'Scan VOD' })).toBeEnabled({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })
})

// ═══════════════════════════ CaptionsPanel (4o) ════════════════════════════

test.describe('CaptionsPanel', () => {
  test('the not-ready branch names what is missing and Transcribe opens the setup panel', async () => {
    test.setTimeout(120_000)
    // Whisper is not installed in any test environment (and installing it
    // would mean a 141 MB download — see the DISPOSITIONS note), so the
    // panel's not-ready branch IS its reachable state here.
    const { app, window, userDataDir } = await launchWithVideo('captions')
    try {
      const card = captionsCard(window)
      await expect(card.getByText('Auto-captions')).toBeVisible()
      await expect(card.getByText('Captions need setup')).toBeVisible()
      // Collapsed by default: the instructions are behind the disclosure.
      await expect(card.getByRole('button', { name: 'Refresh status' })).toHaveCount(0)

      // ── the disclosure ──
      await card.getByRole('button', { name: 'Show setup instructions' }).click()
      await expect(card.getByRole('button', { name: 'Hide setup instructions' })).toBeVisible()
      // The two paths come from the main process's own status object.
      // Located by their own class, not by text: the prose above them says
      // "whisper.exe" too, in a <code>.
      const paths = card.locator('div.font-mono.break-all')
      await expect(paths).toHaveCount(2)
      // T-89: current whisper.cpp builds ship `whisper-cli.exe`, so that is the
      // file the card asks for (main also accepts the old `whisper.exe`).
      await expect(paths.nth(0)).toHaveText(/whisper-cli\.exe$/)
      await expect(paths.nth(1)).toHaveText(/ggml-base\.en\.bin$/)
      // T-102: the path the card names is a folder that exists on the portable
      // build and outlives a relaunch — imagii's own data folder — not the
      // app's resources folder, which that build unpacks to %TEMP% each launch.
      // Red against the T-89 card: `.../resources/bin/whisper-cli.exe`.
      const exeShown = (await paths.nth(0).innerText()).trim()
      expect(path.dirname(exeShown)).toBe(path.join(userDataDir, 'bin'))
      expect(exeShown).not.toContain('resources')
      // ...and the folder is THERE: the card creates it when it asks, so the
      // Open folder button next to the path has somewhere to open.
      expect(existsSync(path.dirname(exeShown))).toBe(true)
      // The reason, in one line.
      await expect(
        card.getByText('This folder survives app updates, so you only set this up once.')
      ).toBeVisible()
      // T-89: the card says in ONE line what is manual and what is automatic,
      // and that the download goes online — and never names the old binary.
      await expect(
        card.getByText(
          'You download the captions engine once (whisper-cli.exe); imagii downloads the English model (~141 MB) for you — that download goes online, once.'
        )
      ).toBeVisible()
      // T-139 (6): the file the releases page really offers is a zip, and its engine needs the .dll files beside it.
      await expect(card.locator('code')).toHaveText(['whisper-cli.exe', 'whisper-bin-x64.zip', 'whisper-cli.exe', '.dll'])
      await expect(card.getByText(/whisper\.exe/)).toHaveCount(0)
      await expect(card.getByText(/Download whisper-bin-x64\.zip from the whisper\.cpp releases \(the newest release that lists it; some are marked Pre-release\)/)).toBeVisible()
      await expect(card.getByText(/copy whisper-cli\.exe and every \.dll next to it \(they are in its Release folder\)/)).toBeVisible()
      await expect(card.getByText('(the Windows build)')).toHaveCount(0)
      await expect(card.getByRole('link', { name: 'whisper.cpp releases' })).toHaveAttribute('href', 'https://github.com/ggml-org/whisper.cpp/releases')
      await expect(card.getByRole('link', { name: 'Hugging Face' })).toHaveAttribute('href', 'https://huggingface.co/ggerganov/whisper.cpp/tree/main')
      // Both shell shortcuts and both doc links are rendered (their OS side
      // is dispositioned; what is asserted is that they exist and are
      // reachable from this branch).
      await expect(card.getByRole('button', { name: 'open folder' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Show models folder' })).toBeVisible()
      await expect(card.getByRole('link', { name: 'whisper.cpp releases' })).toBeVisible()
      await expect(card.getByRole('link', { name: 'Hugging Face' })).toBeVisible()
      // T-112: a link is underlined AT REST (it was underlined only on hover, so it was a
      // color and nothing else) and reads in the `warn` tone, 10.4:1 on this ember wash —
      // the accent it replaced measured 4.1:1.
      for (const link of [
        card.getByRole('link', { name: 'whisper.cpp releases' }),
        card.getByRole('link', { name: 'Hugging Face' }),
        card.getByRole('button', { name: 'Open folder', exact: true }),
        card.getByRole('button', { name: 'Show models folder', exact: true }),
        card.getByRole('button', { name: 'Refresh status', exact: true }),
        card.getByRole('button', { name: 'Hide setup instructions', exact: true })
      ]) {
        const style = await link.evaluate((el) => {
          const cs = getComputedStyle(el)
          return { decoration: cs.textDecorationLine, color: cs.color }
        })
        expect(style.decoration).toContain('underline')
        expect(style.color).toBe('rgb(252, 211, 77)')
      }
      // The model is missing, so the auto-install offer is visible. It is
      // NOT clicked — see DISPOSITIONS (141 MB, network, local-first).
      await expect(
        card.getByRole('button', { name: /Download model \(~141 MB\) automatically/ })
      ).toBeVisible()
      await card.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-04-captions-setup.png') })

      // ── refresh status: re-asks the main process, same answer ──
      await card.getByRole('button', { name: 'Refresh status' }).click()
      await expect(card.getByText('Captions need setup')).toBeVisible()
      await expect(card.getByRole('button', { name: 'Refresh status' })).toBeVisible()

      // ── collapse ──
      await card.getByRole('button', { name: 'Hide setup instructions' }).click()
      await expect(card.getByRole('button', { name: 'Refresh status' })).toHaveCount(0)

      // ── Transcribe on a not-ready install opens the setup panel instead
      //    of starting a job: no toast, no progress row, no segments ──
      await card.getByRole('button', { name: 'Transcribe' }).click()
      await expect(card.getByRole('button', { name: 'Refresh status' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Transcribing…' })).toHaveCount(0)
      expect(await readToastLog(window)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('Captions ready')])
      )

      // T-89: two facts the panel never stated, visible before and after any
      // setup. The language is fixed (the model is English-only), and a
      // burn-in reads the ORIGINAL file — the platform exports are separate.
      await expect(card.getByText('Captions are English only.')).toBeVisible()
      await expect(
        card.getByText('Captions burn into the original video, not the platform exports.')
      ).toBeVisible()
      await expect(card.getByText(/determines languages/)).toHaveCount(0)
      await expect(card.getByText(/English only by default/)).toHaveCount(0)

      // With no srtPath the whole style + output subtree stays unmounted.
      await expect(card.getByRole('button', { name: 'Save .srt' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Burn into video' })).toHaveCount(0)
      await expect(card.getByRole('slider', { name: 'Caption size' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('with an SRT restored from a project file, every style control and Save .srt work', async () => {
    test.setTimeout(120_000)
    // srtPath is only ever set by a real transcription (whisper) or by
    // loading a project that carries one — schema v2's videoStudio.srtPath.
    // The project route needs no whisper, so it is how this subtree is
    // reached: seed the .srt inside userData/captions (the only directory
    // captions:saveSrt will read from), point a project file at it, and
    // open that project through Home's own button with the OS chooser
    // stubbed in the main process.
    const studio = await launchHome('captionstyle')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'seeded.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(
        srtPath,
        '1\n00:00:00,000 --> 00:00:01,000\nfirst line\n\n2\n00:00:01,000 --> 00:00:02,000\nsecond line\n',
        'utf8'
      )
      const projectPath = path.join(root, `captions-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            clips: [],
            selectedClipId: null,
            watermark: null,
            srtPath
          }
        }),
        'utf8'
      )
      const savedSrt = path.join(outDir, 'exported-captions.srt')
      await stubDialogs(app, { open: [projectPath], save: [savedSrt] })

      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })

      const card = captionsCard(window)
      // T-89: "Font px" was not pixels (libass scales it against a 288-line
      // script), so it is "Size", with what it comes to read out beside it.
      const fontSlider = card.getByRole('slider', { name: 'Caption size' })
      const position = card.locator('select')
      const colors = card.locator('input[type="color"]')
      // The subtree only exists because srtPath survived the project load.
      await expect(fontSlider).toBeVisible()
      await expect(fontSlider).toHaveValue('32')
      await expect(card.getByText('Size', { exact: true })).toBeVisible()
      await expect(card.getByText('Font px')).toHaveCount(0)
      // T-112: about THIS video — 320x240 here, whose 16:9-equivalent height is 180 px
      // (320 x 9/16), so 32 x 180 / 288 = 20 px; the 1080p wording is for no video at all.
      await expect(card.getByText('about 20 px tall on this video')).toBeVisible()
      await expect(card.getByText(/on 1080p/)).toHaveCount(0)
      await expect(position).toHaveValue('bottom')
      await expect(colors.nth(0)).toHaveValue('#ffffff')
      await expect(colors.nth(1)).toHaveValue('#000000')

      // ── the four style presets, each a complete CaptionStyle ──
      await card.getByRole('button', { name: 'TikTok bold' }).click()
      await expect(fontSlider).toHaveValue('56')
      await expect(card.getByText('about 35 px tall on this video')).toBeVisible() // 56 x 180 / 288
      await card.getByRole('button', { name: 'Reels minimal' }).click()
      await expect(fontSlider).toHaveValue('28')
      await expect(card.getByText('about 18 px tall on this video')).toBeVisible() // 28 x 180 / 288 = 17.5
      await expect(colors.nth(0)).toHaveValue('#f5f5f5')
      await expect(colors.nth(1)).toHaveValue('#222222')
      await card.getByRole('button', { name: 'Big-outline accessibility' }).click()
      await expect(colors.nth(0)).toHaveValue('#ffff00')
      await card.getByRole('button', { name: 'Subtle subtitle' }).click()
      await expect(fontSlider).toHaveValue('24')
      await expect(colors.nth(0)).toHaveValue('#ffffff')

      // ── the dials stay editable after a preset (the panel's promise) ──
      await fontSlider.fill('72')
      await expect(card.getByText('72', { exact: true })).toBeVisible()
      await expect(card.getByText('about 45 px tall on this video')).toBeVisible() // 72 x 180 / 288
      await expect(fontSlider).toHaveAttribute('aria-valuetext', '72, about 45 px tall on this video')
      await position.selectOption('middle')
      await expect(position).toHaveValue('middle')
      await position.selectOption('top')
      await expect(position).toHaveValue('top')
      await colors.nth(0).fill('#ffcc00')
      await expect(card.getByText('#ffcc00')).toBeVisible()
      await colors.nth(1).fill('#101010')
      await expect(card.getByText('#101010')).toBeVisible()

      // ── trim-to-clip: enabled because a clip is selected (loadSource
      //    creates and selects Clip 1 on the way through applyProject) ──
      const trim = card.getByRole('checkbox')
      await expect(trim).toBeEnabled()
      await expect(trim).not.toBeChecked()
      await trim.check()
      await expect(trim).toBeChecked()
      await card.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-05-caption-style.png') })

      // ── T-123 (16): "Save .srt" copies the WHOLE transcript, and it sits directly under "Burn captions over selected
      //    clip range only" (checked, just above). The scope is said at the button: a sentence beside it that the button
      //    is described by, so a screen reader hears it when the button is focused ──
      const SRT_SCOPE = 'The box above only changes Burn into video. Save .srt keeps the captions for the whole video.'
      await expect(card.getByText(SRT_SCOPE)).toBeVisible()
      await expect(card.getByRole('button', { name: 'Save .srt' })).toHaveAccessibleDescription(SRT_SCOPE)

      // ── Save .srt: a real copy through the main process's confinement
      //    check, landing on disk where the (stubbed) chooser said. With the range box CHECKED, as it is now, the file is
      //    still the whole transcript - which is what the sentence above promises ──
      expect(existsSync(savedSrt)).toBe(false)
      await card.getByRole('button', { name: 'Save .srt' }).click()
      await expectToast(window, 'SRT saved')
      expect(existsSync(savedSrt)).toBe(true)
      expect(readFileSync(savedSrt, 'utf8')).toBe(readFileSync(srtPath, 'utf8'))

      // Burn-in is NOT clicked in this test — the ranged-burn test below drives it
      // for real (ffmpeg only; no whisper, no model).
      await expect(card.getByRole('button', { name: 'Burn into video' })).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  // T-127 (11): "Save .srt" went straight to a native Save dialog with no claim, so a double-click opened two, and answered twice wrote the
  // file twice. The dialog here answers after 300 ms (a person takes a moment: that is where the second press lands).
  test('a double-click on Save .srt opens ONE save dialog and writes ONE file (T-127 (11))', async () => {
    test.setTimeout(120_000)
    const studio = await launchHome('captionsavedbl')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'seeded.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,000\nfirst line\n', 'utf8')
      const projectPath = path.join(root, `captionsavedbl-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: { sourcePath: clipSrc, clips: [], selectedClipId: null, watermark: null, srtPath }
        }),
        'utf8'
      )
      const savedSrt = path.join(outDir, 'once.srt')
      await stubDialogs(app, { open: [projectPath], save: [savedSrt] })
      // The save dialog answers after 300 ms and counts how often it was asked.
      await app.evaluate(({ dialog }) => {
        const g = globalThis as unknown as { __saveAsks?: number }
        g.__saveAsks = 0
        const stubbed = (dialog as unknown as { showSaveDialog: (...a: unknown[]) => Promise<unknown> }).showSaveDialog
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (...a: unknown[]) => {
          g.__saveAsks = (g.__saveAsks ?? 0) + 1
          await new Promise((resolve) => setTimeout(resolve, 300))
          return stubbed(...a)
        }
      })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const save = captionsCard(window).getByRole('button', { name: 'Save .srt' })
      await expect(save).toBeVisible()
      await save.dblclick()
      await expectToast(window, 'SRT saved')
      await window.waitForTimeout(800)
      expect(await app.evaluate(() => (globalThis as unknown as { __saveAsks?: number }).__saveAsks), 'one save dialog, not two').toBe(1)
      expect(readdirSync(outDir).filter((f) => f.endsWith('.srt')), 'one file').toEqual(['once.srt'])
      expect((await readToastLog(window)).filter((t) => t === 'SRT saved'), 'said once').toHaveLength(1)
      await expect(save, 'and the claim is given back').toBeEnabled()
    } finally {
      await app.close()
    }
  })

  // T-128 (3), T-110 (s): every transcription keeps its .srt in <userData>/captions for good, and the only way to get rid of one was to find the
  // folder. The Captions panel says how many are kept and has a button for it, behind a confirm. Seeded here: three transcripts (one of them the
  // open video's own), a burn-in's temp copy and a notes file in the same folder (neither is a transcript), and a `.srt` in the models folder
  // beside it (not ours to touch). The folder is read from disk after every step.
  test('Clear saved transcripts: the line counts them, Escape and Cancel change nothing, Clear empties the folder of transcripts and of nothing else, and the open video is no longer transcribed (T-128 (3))', async () => {
    test.setTimeout(180_000)
    const studio = await launchHome('captionsclear')
    const { app, window, userDataDir } = studio
    try {
      const captionsDir = path.join(userDataDir, 'captions')
      mkdirSync(captionsDir, { recursive: true })
      const cue = '1\n00:00:00,000 --> 00:00:01,000\nhello\n'
      const tempCopy = 'seeded.srt.clip-0b6f3a52-1c3e-4f0e-9d77-2f7a9c1d8e44.srt'
      for (const name of ['seeded.srt', 'older-1.srt', 'older-2.srt', tempCopy]) writeFileSync(path.join(captionsDir, name), cue, 'utf8')
      writeFileSync(path.join(captionsDir, 'notes.txt'), 'mine', 'utf8')
      const modelsDir = path.join(userDataDir, 'models')
      mkdirSync(modelsDir, { recursive: true })
      writeFileSync(path.join(modelsDir, 'keep.srt'), 'not a transcript', 'utf8')
      const projectPath = path.join(root, `captionsclear-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: { sourcePath: clipSrc, clips: [], selectedClipId: null, watermark: null, srtPath: path.join(captionsDir, 'seeded.srt') }
        }),
        'utf8'
      )
      await stubDialogs(app, { open: [projectPath] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })

      const card = captionsCard(window)
      const everything = [tempCopy, 'notes.txt', 'older-1.srt', 'older-2.srt', 'seeded.srt'].sort()
      await expect(card.getByText('3 saved transcripts kept on this computer.'), 'the temp copy and the notes file are not transcripts').toBeVisible()
      await expect(card.getByRole('button', { name: 'Save .srt' }), 'the open video has its transcript').toBeVisible()
      const clear = card.getByRole('button', { name: 'Clear saved transcripts' })
      await expect(clear).toBeEnabled()
      const dialog = window.getByRole('dialog', { name: 'Clear saved transcripts?' })

      // Escape: the question closes and nothing is touched.
      await clear.click()
      await expect(dialog).toBeVisible()
      await expect(dialog, 'it says how many it will delete').toContainText('deletes the 3 saved transcripts')
      await expect(dialog, 'and that the open video\'s transcript is among them (this one has one: Save .srt is on the panel)').toContainText('including the one for the video you have open')
      await expect(dialog.getByRole('button', { name: 'Cancel' }), 'it opens on the safe answer').toBeFocused()
      await window.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      expect(readdirSync(captionsDir).sort(), 'Escape deleted nothing').toEqual(everything)
      // Cancel: the same.
      await clear.click()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      expect(readdirSync(captionsDir).sort(), 'Cancel deleted nothing').toEqual(everything)
      await expect(card.getByRole('button', { name: 'Save .srt' })).toBeVisible()

      // Clear: the three transcripts go - the folder keeps what is not one, and the models folder is untouched.
      await clear.click()
      await dialog.getByRole('button', { name: 'Clear transcripts' }).click()
      await expect(dialog).toBeHidden()
      await expectToast(window, 'Cleared 3 saved transcripts')
      expect(readdirSync(captionsDir).sort(), 'only the transcripts went').toEqual([tempCopy, 'notes.txt'].sort())
      expect(readdirSync(modelsDir), 'the folder beside it is not ours to empty').toEqual(['keep.srt'])
      await expect(card.getByText('No saved transcripts.')).toBeVisible()
      await expect(clear, 'nothing left to clear').toBeDisabled()
      await expect(card.getByRole('button', { name: 'Save .srt' }), 'the open video went back to not transcribed').toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Burn into video' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // T-135 (7): the confirm said "including the one for the video you have open" whether or not the open video has a transcript (the count is the folder's).
  // With no transcript for the open video it says what the count is and stops.
  test('Clear saved transcripts: a video with no transcript of its own is not named in the confirm (T-135 (7))', async () => {
    test.setTimeout(180_000)
    const studio = await launchHome('captionsclear-none')
    const { app, window, userDataDir } = studio
    try {
      const captionsDir = path.join(userDataDir, 'captions')
      mkdirSync(captionsDir, { recursive: true })
      const cue = '1\n00:00:00,000 --> 00:00:01,000\nhello\n'
      for (const name of ['elsewhere-1.srt', 'elsewhere-2.srt']) writeFileSync(path.join(captionsDir, name), cue, 'utf8')
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      await expect(card.getByText('2 saved transcripts kept on this computer.')).toBeVisible()
      await expect(card.getByRole('button', { name: 'Save .srt' }), 'the open video was never transcribed').toHaveCount(0)
      await card.getByRole('button', { name: 'Clear saved transcripts' }).click()
      const dialog = window.getByRole('dialog', { name: 'Clear saved transcripts?' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('deletes the 2 saved transcripts imagii keeps on this computer.')
      await expect(dialog, 'no claim about a transcript this video does not have').not.toContainText('video you have open')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      expect(readdirSync(captionsDir).sort(), 'Cancel deleted nothing').toEqual(['elsewhere-1.srt', 'elsewhere-2.srt'])
    } finally {
      await app.close()
    }
  })

  // T-132 (3): the "Clear saved transcripts" button was the only single-label button in the app that wrapped its words onto two lines, at every
  // window up to 1920 px (measured in the built app): its row was a non-wrapping flex line holding the count sentence and the button, in a card
  // 295-345 px wide. The row wraps by item now (the button drops whole to a second line) and the button's label never wraps. T-123's pattern: the
  // geometry at the window a person gets and at the smallest one.
  test('the Clear saved transcripts row keeps its label on one line and inside its card at the default window and the minimum (T-132 (3))', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('captionsrow')
    const { app, window, userDataDir } = studio
    try {
      const captionsDir = path.join(userDataDir, 'captions')
      mkdirSync(captionsDir, { recursive: true })
      for (const name of ['one.srt', 'two.srt', 'three.srt']) writeFileSync(path.join(captionsDir, name), '1\n00:00:00,000 --> 00:00:01,000\nhello\n', 'utf8')
      await gotoVideoStudio(window)
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      const clear = card.getByRole('button', { name: 'Clear saved transcripts' })
      await expect(clear, 'the row is there (three transcripts are kept)').toBeVisible()
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await check(() => expectOneLine(clear, `the Clear saved transcripts button at ${where}`))
        await check(() => expectOneLine(card.getByText('3 saved transcripts kept on this computer.'), `the count sentence at ${where}`))
        await check(() => expectControlsWhole(card, clear, `the Clear saved transcripts button at ${where}`))
        await check(() => expectNoHorizontalOverflow(card, `the Captions card at ${where}`))
      }
      expect(problems, 'the label stays whole at both window sizes').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-132 (14): a clear that removed some transcripts and not all (the rest are open in another program) is documented as something other than
  // a success (`clearedTranscriptsMessage`: "how far it got and what to do"), and the panel drew it with `toast.success`: a green tick over
  // "Cleared 2 of 3 saved transcripts. The rest are open in another program; close it and clear again." Windows is where a file can be held
  // open; here main's handler answers the partial result a held file produces, and everything from the click to the toast is the real app's.
  test('a clear that got part of the way is a warning, not a green tick; a whole one is still a success (T-132 (14))', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('captionspartial')
    const { app, window, userDataDir } = studio
    try {
      const captionsDir = path.join(userDataDir, 'captions')
      mkdirSync(captionsDir, { recursive: true })
      for (const name of ['one.srt', 'two.srt', 'three.srt']) writeFileSync(path.join(captionsDir, name), '1\n00:00:00,000 --> 00:00:01,000\nhello\n', 'utf8')
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      await expect(card.getByText('3 saved transcripts kept on this computer.')).toBeVisible()
      // What a toast's card is drawn with: the status disc of a success (the palette's ok-strong), and an icon svg for a toast given an icon.
      const card_ = (text: string): Promise<{ discs: string[]; svgs: number }> =>
        window.evaluate((needle) => {
          const status = Array.from(document.querySelectorAll('[data-rht-toaster] [role="status"]')).find((el) => (el.textContent ?? '').includes(needle))
          const bar = status?.parentElement
          if (!bar) return { discs: [], svgs: -1 }
          return {
            discs: Array.from(bar.querySelectorAll('*')).map((el) => getComputedStyle(el).backgroundColor).filter((c) => c !== 'rgba(0, 0, 0, 0)'),
            svgs: bar.querySelectorAll('svg').length
          }
        }, text)
      const OK_STRONG = 'rgb(52, 211, 153)'

      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('captions:clearTranscripts')
        ipcMain.handle('captions:clearTranscripts', () => ({ removed: 2, failed: 1 }))
      })
      const clear = card.getByRole('button', { name: 'Clear saved transcripts' })
      const dialog = window.getByRole('dialog', { name: 'Clear saved transcripts?' })
      await clear.click()
      await dialog.getByRole('button', { name: 'Clear transcripts' }).click()
      const PARTIAL = 'Cleared 2 of 3 saved transcripts. The rest are open in another program; close it and clear again.'
      await expectToast(window, PARTIAL)
      const partial = await card_(PARTIAL)
      expect(partial.svgs, 'the partial clear carries the warning icon').toBe(1)
      expect(partial.discs, 'and no green success disc').not.toContain(OK_STRONG)
      // It outlives a success toast (it has a sentence to read and a thing to do).
      await window.mouse.move(2, 2)
      await window.waitForTimeout(3_000)
      expect((await card_(PARTIAL)).svgs, 'still on screen after the success toast\'s 2 s').toBe(1)

      // A clear that got all the way is still the green tick.
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('captions:clearTranscripts')
        ipcMain.handle('captions:clearTranscripts', () => ({ removed: 3, failed: 0 }))
      })
      await expect(card.getByText(/saved transcripts? kept on this computer/)).toBeVisible()
      await clear.click()
      await dialog.getByRole('button', { name: 'Clear transcripts' }).click()
      await expectToast(window, 'Cleared 3 saved transcripts')
      const whole = await card_('Cleared 3 saved transcripts')
      expect(whole.discs, 'a whole clear is the success disc').toContain(OK_STRONG)
      expect(whole.svgs).toBe(0)
    } finally {
      await app.close()
    }
  })

  // T-115, T-116: "Save .srt" on a transcript it cannot save. `captions:saveSrt` reads only from
  // <userData>/captions. A project file may name any safe absolute path as its srtPath, so the button
  // can be pressed on a transcript outside that folder (main refuses) or on one the app no longer
  // has (main used to find out only after the Save dialog had been answered). The panel awaited the
  // call with no catch - an unhandled rejection, no dialog, no toast, nothing (T-115) - and then
  // showed only its bare "Couldn't save the captions file." (T-116): both causes are now a finished
  // sentence written in main, and the missing file is found before the dialog opens.
  const SRT_REFUSALS = [
    {
      title: 'Save .srt on a transcript outside the captions folder says why, instead of doing nothing (T-115, T-116)',
      // Outside userData/captions on purpose (the sibling test seeds INSIDE it).
      where: 'outside' as const,
      sentence: "That transcript isn't in imagii's captions folder on this computer \u2014 transcribe the video again."
    },
    {
      title: 'Save .srt on a transcript that is gone says so, without asking where to save it (T-116)',
      where: 'gone' as const,
      sentence: "That transcript isn't on this computer anymore \u2014 transcribe the video again."
    }
  ]
  for (const refusal of SRT_REFUSALS) {
    test(refusal.title, async () => {
      test.setTimeout(120_000)
      const studio = await launchHome(`captionsavefail-${refusal.where}`)
      const { app, window, userDataDir, outDir } = studio
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      try {
        let srtPath: string
        if (refusal.where === 'outside') {
          srtPath = path.join(outDir, 'elsewhere.srt')
          writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,000\nfirst line\n', 'utf8')
        } else {
          // Inside the captions folder, where the gate lets it through - and no file there.
          mkdirSync(path.join(userDataDir, 'captions'), { recursive: true })
          srtPath = path.join(userDataDir, 'captions', 'vanished.srt')
          expect(existsSync(srtPath)).toBe(false)
        }
        const projectPath = path.join(root, `captionsavefail-${refusal.where}-${Date.now().toString(36)}.imagii.json`)
        writeFileSync(
          projectPath,
          JSON.stringify({
            schemaVersion: 2,
            savedAt: Date.now(),
            appVersion: '1.0.0',
            videoStudio: { sourcePath: clipSrc, clips: [], selectedClipId: null, watermark: null, srtPath }
          }),
          'utf8'
        )
        const savedSrt = path.join(outDir, 'should-not-exist.srt')
        await stubDialogs(app, { open: [projectPath], save: [savedSrt] })
        // Count how often the Save dialog is asked: a refusal must come before it.
        await app.evaluate(({ dialog }) => {
          const g = globalThis as unknown as { __saveAsks?: number }
          g.__saveAsks = 0
          const stubbed = (dialog as unknown as { showSaveDialog: (...a: unknown[]) => Promise<unknown> }).showSaveDialog
          ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (...a: unknown[]) => {
            g.__saveAsks = (g.__saveAsks ?? 0) + 1
            return stubbed(...a)
          }
        })
        await window.getByRole('button', { name: 'Open project' }).click()
        await gotoVideoStudio(window)
        await installToastLog(window)
        await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })

        const card = captionsCard(window)
        const save = card.getByRole('button', { name: 'Save .srt' })
        await expect(save).toBeVisible()
        await save.click()
        // The sentence main wrote, word for word: not the panel's bare fallback, not the channel
        // name, not the refusal's own words, not the generic "a file imagii needs isn't there".
        await expectToast(window, refusal.sentence)
        const shown = await readToastLog(window)
        expect(shown, 'exactly one toast, and it is the sentence').toEqual([refusal.sentence])
        expect(shown.join(' | ')).not.toMatch(/saveSrt|captions directory|SRT saved|invoking remote|Couldn't save/)
        // The dialog was never asked, nothing was written, and nothing escaped as an unhandled rejection.
        expect(await app.evaluate(() => (globalThis as unknown as { __saveAsks?: number }).__saveAsks)).toBe(0)
        expect(existsSync(savedSrt)).toBe(false)
        await window.waitForTimeout(500)
        expect(pageErrors, 'no unhandled rejection').toEqual([])
        // And the button is still there to press again (nothing is stuck).
        await expect(save).toBeEnabled()
      } finally {
        await app.close()
      }
    })
  }

  test('progress reads in plain words, and a phase with no measurable progress is an indeterminate bar (T-89)', async () => {
    test.setTimeout(120_000)
    // Whisper is not installed here (HL-whisper), so the engine cannot produce
    // the events. The panel only knows them as messages on the real
    // `captions:progress` channel, so MAIN sends them — the same channel, the
    // same preload listener, the same render a real transcription drives.
    const { app, window } = await launchWithVideo('captionprogress')
    try {
      const card = captionsCard(window)
      const bar = card.getByRole('progressbar')
      const send = (payload: Record<string, unknown>): Promise<void> =>
        app.evaluate(({ BrowserWindow }, p) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('captions:progress', p)
        }, payload)

      await expect(bar).toHaveCount(0)

      // ── a phase main cannot measure: no percent on the event ──
      await send({ jobId: 'j', phase: 'extracting' })
      await expect(card.getByText('Extracting audio…')).toBeVisible()
      await send({ jobId: 'j', phase: 'transcribing', message: '00:00:07.500' })
      await expect(card.getByText('Transcribing…', { exact: true })).toBeVisible()
      await expect(bar).toHaveAccessibleName('Transcribing…')
      // Indeterminate: no value on the bar, the sliding segment is drawn, and
      // there is no percentage text anywhere in the row.
      await expect(bar).not.toHaveAttribute('aria-valuenow', /.*/)
      await expect(bar.locator('.progress-indeterminate')).toHaveCount(1)
      await expect(card.getByText(/\d+%/)).toHaveCount(0)
      // The raw ids the row used to print, upper-cased, are gone.
      await expect(card.getByText(/TRANSCRIBING|EXTRACTING|BUILDING-SRT|BURNING-IN/)).toHaveCount(0)
      await card.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-07-captions-progress.png') })

      // Many events in one phase never put a number on the bar: the old jitter
      // (15 + Math.random() * 10) reached the row as a changing percentage.
      for (let i = 0; i < 5; i += 1) {
        await send({ jobId: 'j', phase: 'transcribing', message: `00:00:0${i}.000` })
      }
      await expect(bar).not.toHaveAttribute('aria-valuenow', /.*/)
      await expect(card.getByText(/\d+%/)).toHaveCount(0)

      await send({ jobId: 'j', phase: 'building-srt' })
      await expect(card.getByText('Building captions…')).toBeVisible()
      await expect(bar.locator('.progress-indeterminate')).toHaveCount(1)

      // ── a phase main CAN measure keeps its real bar, number and Cancel ──
      await send({ jobId: 'j', phase: 'burning-in', percent: 40 })
      await expect(card.getByText('Burning in…')).toBeVisible()
      await expect(bar).toHaveAttribute('aria-valuenow', '40')
      await expect(bar.locator('.progress-indeterminate')).toHaveCount(0)
      await expect(card.getByText('40%', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

      await send({ jobId: 'j', phase: 'done', percent: 100 })
      await expect(card.getByText('Done', { exact: true })).toBeVisible()
      await expect(bar).toHaveAttribute('aria-valuenow', '100')
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('a ranged burn with no cue in its range says so; with a cue it says "burned in" (T-89)', async () => {
    test.setTimeout(240_000)
    // burn-in is ffmpeg-only (no whisper, no model), so it runs for real: the
    // project route supplies an SRT and two clips, the save chooser is stubbed
    // in MAIN, and the toast is read against the bytes that were written.
    const studio = await launchHome('captionrange')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'range.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      // ONE cue, 0.0-0.5 s of the 2 s source.
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:00,500\nearly words\n', 'utf8')
      const clip = (id: string, name: string, startSec: number, endSec: number) => ({
        id,
        name,
        startSec,
        endSec,
        cropRect: null,
        textOverlays: [],
        selectedPresets: ['youtube']
      })
      const projectPath = path.join(root, `captionrange-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            // Selected: "Late", 1.0-2.0 s, where nobody speaks. "Early" holds the cue.
            clips: [clip('late', 'Late', 1, 2), clip('early', 'Early', 0, 1)],
            selectedClipId: 'late',
            watermark: null,
            srtPath
          }
        }),
        'utf8'
      )
      const outLate = path.join(outDir, 'late-captioned.mp4')
      const outEarly = path.join(outDir, 'early-captioned.mp4')
      await stubDialogs(app, { open: [projectPath], save: [outLate, outEarly] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)

      const card = captionsCard(window)
      const burn = card.getByRole('button', { name: 'Burn into video' })
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await card.getByRole('checkbox').check()

      // ── the range nobody speaks in: the clip is written, and the toast does
      //    not claim captions (red against "Captions burned in") ──
      await burn.click()
      await expectToast(window, 'No captions in this range — exported without captions.')
      const late = (await readToastEntries(window)).find((e) =>
        e.text.startsWith('No captions in this range')
      )
      // A heads-up, not a success tick and not a failure cross: it drew its
      // own (warning) icon rather than react-hot-toast's.
      expect(late?.hasIcon).toBe(true)
      expect((await readToastLog(window)).join(' | ')).not.toContain('Captions burned in')
      await expect.poll(() => existsSync(outLate), { timeout: 60_000 }).toBe(true)
      // T-108: a finished burn leaves no "Done 100%" row behind — the toast said so.
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('progressbar')).toHaveCount(0)
      await expect(card.getByText('Done', { exact: true })).toHaveCount(0)
      const lateProbe = await ffprobeJson(outLate)
      // The file is the range (1 s), uncaptioned — what the toast said.
      expect(Number(lateProbe.format?.duration)).toBeGreaterThan(0.8)
      expect(Number(lateProbe.format?.duration)).toBeLessThan(1.3)
      await expect(burn).toBeEnabled({ timeout: 30_000 })

      // ── the control: select the clip that HAS the cue, same button ──
      await clipListCard(window).getByRole('button', { name: 'Select clip Early' }).click()
      await burn.click()
      await expectToast(window, 'Captions burned in')
      await expect.poll(() => existsSync(outEarly), { timeout: 60_000 }).toBe(true)
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('progressbar')).toHaveCount(0)
      await expect(card.getByText('Done', { exact: true })).toHaveCount(0)
      // The earlier toast was not reused: exactly one of each, in order.
      const texts = (await readToastLog(window)).filter(
        (t) => t.startsWith('No captions in this range') || t === 'Captions burned in'
      )
      expect(texts).toEqual([
        'No captions in this range — exported without captions.',
        'Captions burned in'
      ])
    } finally {
      await app.close()
    }
  })

  // T-133 (4): the ranged burn-in was the one ranged video writer without T-131/T-132's no-picture guard. A project restored over a recording that
  // got SHORTER holds a clip past the end of the picture: ffmpeg exits 0 having written a file with no picture, and the panel said "Captions burned
  // in". It is a sentence now, no file is left, and the button is live again (Layer 5, media.spec.ts, holds this on real files on both majors).
  test('a ranged burn over a clip that lies past the end of the video is a sentence, not "Captions burned in", and leaves no file (T-133 (4))', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('captionpastend')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'past.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:05,200 --> 00:00:05,800\nwords past the end\n', 'utf8')
      const projectPath = path.join(root, `captionpastend-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            clips: [{ id: 'gone', name: 'Gone', startSec: 5, endSec: 6, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] }],
            selectedClipId: 'gone',
            watermark: null,
            srtPath
          }
        }),
        'utf8'
      )
      const out = path.join(outDir, 'gone-captioned.mp4')
      await stubDialogs(app, { open: [projectPath], save: [out] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)

      const card = captionsCard(window)
      const burn = card.getByRole('button', { name: 'Burn into video' })
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await card.getByRole('checkbox').check()
      await burn.click()
      await expectToast(window, "This part of the video has no picture (check the clip's start and end), so no captioned video was saved.")
      const log = (await readToastLog(window)).join(' | ')
      expect(log, 'nothing says the captions were burned in').not.toContain('Captions burned in')
      expect(log).not.toContain('No captions in this range')
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('progressbar')).toHaveCount(0)
      expect(existsSync(out), 'no audio-only file is left where the captioned video was to be').toBe(false)
    } finally {
      await app.close()
    }
  })

  test('a canceled or failed burn-in puts the progress row back and leaves no half-written video (T-100)', async () => {
    test.setTimeout(600_000)
    // The row under the header shows a job that is running. After a burn that was
    // canceled or failed it froze at "Burning in… 5%" with a Cancel button for a
    // job that no longer existed, and the half-written .mp4 stayed where the
    // Save dialog pointed. The 20-minute source keeps the burn running when
    // Cancel is clicked.
    const studio = await launchHome('burnrow')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'row.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:02,000\nhello\n', 'utf8')
      const projectPath = path.join(root, `burnrow-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: longSrc,
            clips: [],
            selectedClipId: null,
            watermark: null,
            srtPath
          }
        }),
        'utf8'
      )
      const canceled = path.join(outDir, 'canceled-burn.mp4')
      const unwritable = path.join(root, 'no-such-folder', 'failed-burn.mp4')
      await stubDialogs(app, { open: [projectPath], save: [canceled, unwritable] })
      // Transcribe needs the engine, which this machine does not have (HL-whisper):
      // main is told it is installed and then fails the job — the panel's real
      // catch runs on a rejection of the shape a failed engine produces.
      await app.evaluate(({ ipcMain, BrowserWindow }) => {
        ipcMain.removeHandler('captions:status')
        ipcMain.handle('captions:status', () => ({
          exeInstalled: true,
          exePath: 'whisper-cli.exe',
          modelInstalled: true,
          modelPath: 'model.bin',
          modelsDir: 'models',
          ready: true
        }))
        ipcMain.removeHandler('captions:transcribe')
        ipcMain.handle('captions:transcribe', (_e, req: { jobId: string }) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('captions:progress', {
            jobId: req.jobId,
            phase: 'transcribing'
          })
          throw new Error('whisper exit 1: model file is damaged')
        })
      })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const card = captionsCard(window)
      const burn = card.getByRole('button', { name: 'Burn into video' })
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      const row = card.getByRole('progressbar')

      // ── canceled mid-burn ──
      await burn.click()
      await expect.poll(() => existsSync(canceled), { timeout: 60_000, intervals: [250] }).toBe(true)
      await expect(row).toHaveAccessibleName('Burning in…')
      // T-112: the header button names the job that is RUNNING. It said "Transcribing…" for
      // a burn-in too (one boolean for both jobs), a job that is not happening at all.
      await expect(card.getByRole('button', { name: 'Burning in…' })).toBeDisabled()
      await expect(card.getByText('Transcribing…')).toHaveCount(0)
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'Burn-in canceled.')
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await expect(row).toHaveCount(0)
      await expect(card.getByText('Burning in…')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      expect(existsSync(canceled), 'the half-written video is gone').toBe(false)

      // ── failed: ffmpeg cannot open the output ──
      await burn.click()
      await expectToast(window, 'Burn-in failed.')
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await expect(row).toHaveCount(0)
      await expect(card.getByText('Burning in…')).toHaveCount(0)
      expect(existsSync(path.dirname(unwritable))).toBe(false)

      // ── a failed transcription: the sliding bar does not slide forever ──
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expectToast(window, 'Transcription failed.')
      await expect(card.getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      await expect(row).toHaveCount(0)
      await expect(card.getByText('Transcribing…', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // T-108 (e). The speech engine is not installed in any test environment (HL-whisper) —
  // but since T-102 the resolver looks in `<userData>/bin` first, so a stand-in "engine"
  // dropped THERE (a shell script that records itself and sleeps) is found by the real
  // resolver and spawned by the real `runTranscribe`, behind the real audio extraction.
  // Cancel, the registry, the latch, the sentinel and the toast are all the product's own.
  async function installFakeEngine(
    userDataDir: string,
    marker: string
  ): Promise<{ pidFile: string }> {
    const bin = path.join(userDataDir, 'bin')
    const models = path.join(userDataDir, 'models')
    mkdirSync(bin, { recursive: true })
    mkdirSync(models, { recursive: true })
    const pidFile = `${marker}.pid`
    const script = path.join(bin, 'whisper-cli.exe')
    writeFileSync(script, `#!/bin/sh\necho started >> '${marker}'\necho $$ > '${pidFile}'\nexec sleep 600\n`, 'utf8')
    chmodSync(script, 0o755)
    // The resolver only asks that the model file is there.
    writeFileSync(path.join(models, 'ggml-base.en.bin'), 'not a real model', 'utf8')
    return { pidFile }
  }

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  test('Cancel stops a transcription while the engine runs: the engine is killed, the toast is neutral, the row resets (T-108)', async () => {
    test.skip(process.platform === 'win32', 'the stand-in engine is a shell script')
    test.setTimeout(240_000)
    const studio = await launchHome('transcribecancel')
    const { app, window, userDataDir } = studio
    try {
      const marker = path.join(root, `engine-${Date.now().toString(36)}.started`)
      const { pidFile } = await installFakeEngine(userDataDir, marker)
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      const card = captionsCard(window)
      // The stand-in engine and model are found: nothing says setup is needed.
      await expect(card.getByText('Captions need setup')).toHaveCount(0)
      const scratch = path.join(os.tmpdir(), 'imagii-audio')
      const before = new Set(existsSync(scratch) ? readdirSync(scratch) : [])

      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      // The real extraction ran, then the engine started (it records itself).
      await expect.poll(() => existsSync(marker), { timeout: 60_000, intervals: [250] }).toBe(true)
      await expect(card.getByText('Transcribing…', { exact: true }).first()).toBeVisible()
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(alive(pid), 'the engine is running').toBe(true)

      // Cancel is on the row for a transcription, as it is for a burn-in.
      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible()
      await cancel.click()

      await expectCanceledNotFailed(window, 'Transcription canceled.')
      await expect.poll(() => alive(pid), { timeout: 15_000, intervals: [200] }).toBe(false)
      // The row went back to idle: no bar, no Cancel for a job that no longer exists,
      // and Transcribe is pressable again.
      await expect(card.getByRole('progressbar')).toHaveCount(0)
      await expect(cancel).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      // Nothing was left in the temp folder: the sound extracted for it is gone.
      expect(
        (existsSync(scratch) ? readdirSync(scratch) : []).filter((f) => !before.has(f)),
        'the extracted WAV was removed'
      ).toEqual([])
      // And nothing came of it: no captions, no "ready" toast.
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/Captions ready|Transcription failed/)
      await expect(card.getByRole('button', { name: 'Save .srt' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Cancel while the sound is still being extracted stops the job before the engine ever starts (T-108)', async () => {
    test.skip(process.platform === 'win32', 'the stand-in engine is a shell script')
    test.setTimeout(240_000)
    // The first child of a transcription is the audio extraction, and on a long recording it
    // is most of the wait. The 20-minute source keeps it running when Cancel is clicked.
    const studio = await launchHome('transcribecancelextract')
    const { app, window, userDataDir } = studio
    try {
      const marker = path.join(root, `engine-${Date.now().toString(36)}.started`)
      await installFakeEngine(userDataDir, marker)
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, longSrc, 'long.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      const card = captionsCard(window)
      const scratch = path.join(os.tmpdir(), 'imagii-audio')
      const before = new Set(existsSync(scratch) ? readdirSync(scratch) : [])

      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expect(card.getByText('Extracting audio…')).toBeVisible({ timeout: 30_000 })
      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible()
      await cancel.click()

      await expectCanceledNotFailed(window, 'Transcription canceled.')
      await expect(card.getByRole('progressbar')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      // The engine was never started, then or later.
      await window.waitForTimeout(1500)
      expect(existsSync(marker), 'the engine never started').toBe(false)
      // The half-written WAV the killed extraction was making is gone.
      await expect
        .poll(() => (existsSync(scratch) ? readdirSync(scratch) : []).filter((f) => !before.has(f)), {
          timeout: 15_000,
          intervals: [250]
        })
        .toEqual([])
    } finally {
      await app.close()
    }
  })
})

// ═════════════════════════════ ExportPanel (4t) ════════════════════════════

/** One platform checkbox in the Export panel's grid. */
function presetBox(window: Page, label: string): Locator {
  // T-130 (q): by the EXACT name on the card. 'YouTube' is a substring of 'YouTube 1080p60', and a substring filter matched both cards.
  return exportCard(window).locator('label').filter({ has: window.getByText(label, { exact: true }) }).getByRole('checkbox')
}

// ═════════════ Player — a picture the preview cannot decode (T-135 (2)) ═════════════

test.describe('Player — a picture the preview cannot decode (T-135 (2))', () => {
  // Chromium has decoders for H.264, VP9 and AV1. A ProRes (or 10-bit HEVC) file probes fine, passes the importer ("Video loaded"), plays its sound and
  // draws nothing: no `error` event, no sentence, and the README said these "should work". The element's own tell is `videoWidth` 0 at `loadedmetadata`
  // for a file ffprobe says has a picture. The Player says so, in one sentence that also says what still works, and offers a copy ffmpeg converts for
  // watching; the original stays the file every export reads.
  const SENTENCE = "imagii can't preview this video's picture format — trimming, scanning and export still work."
  const elementState = (window: Page): Promise<{ w: number; h: number; src: string; error: number | null }> =>
    window.evaluate(() => {
      const v = (window as unknown as { __imagiiVideoEl: HTMLVideoElement | null }).__imagiiVideoEl
      // Between one Player and the next there is no element for a moment: -1 is "not there yet", and a poll tries again.
      if (!v) return { w: -1, h: -1, src: '', error: null }
      return { w: v.videoWidth, h: v.videoHeight, src: v.currentSrc, error: v.error ? v.error.code : null }
    })

  test('a ProRes file says so, keeps trim and export working, and a preview copy shows the picture while exports still read the original', async () => {
    test.setTimeout(300_000)
    const studio = await launchWithVideo('prores', proresSrc)
    const { app, window, outDir } = studio
    try {
      await expect(window.getByText(SENTENCE), 'the sentence').toBeVisible({ timeout: 30_000 })
      const before = await elementState(window)
      expect(before.w, 'the real tell: the element drew no picture for a file that has one').toBe(0)
      expect(before.error, 'and raised no error: an error listener alone would never have heard it').toBeNull()
      const copy = window.getByRole('button', { name: 'Make a preview copy' })
      await expect(copy).toBeEnabled()
      expect(await clipRows(window)).toEqual([{ name: 'Clip 1', range: '0:00 → 0:02' }])

      // ── export stays reachable from the undecodable preview, and writes a real file ──
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: /^Export 1 file/ }).click()
      await expectToast(window, 'Exported 1 file')
      expect(mp4sIn(outDir)).toHaveLength(1)
      const first = await ffprobeJson(path.join(outDir, mp4sIn(outDir)[0] as string))
      expect(first.streams?.some((st) => st.codec_type === 'video'), 'with a picture in it').toBe(true)

      // ── the preview copy: made through the importer's convert, swapped in for playback only ──
      await copy.click()
      await expect(window.getByText(SENTENCE), 'the sentence goes once the picture can be drawn').toBeHidden({ timeout: 120_000 })
      await expect.poll(async () => (await elementState(window)).w, { timeout: 30_000 }).toBe(CLIP_WIDTH)
      const after = await elementState(window)
      expect(after.src, 'the element plays a working copy from imagii\'s import folder').toMatch(/imagii-import/)
      expect(await clipRows(window), 'the clips and their edits are untouched').toEqual([{ name: 'Clip 1', range: '0:00 → 0:02' }])
      await expect(window.getByRole('button', { name: 'Make a preview copy' })).toHaveCount(0)
      // The header names the file the person opened, not the copy.
      await expect(window.locator('header').getByText('undecodable-prores.mov', { exact: true })).toBeVisible()
      // Export still works, from the original: another file, with a picture.
      await card.getByRole('button', { name: /^Export 1 file/ }).click()
      await expect.poll(() => mp4sIn(outDir).length, { timeout: 120_000, intervals: [500] }).toBe(2)
    } finally {
      await app.close()
    }
  })

  test('a video the preview can decode says nothing and offers no copy', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('decodable')
    try {
      await expect.poll(async () => (await elementState(window)).w, { timeout: 30_000 }).toBe(CLIP_WIDTH)
      await window.waitForTimeout(500)
      await expect(window.getByText(SENTENCE)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Make a preview copy' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // The two element-level signals a real file can also give (a file with no decodable stream at all fails with code 4; `play()` rejects with
  // NotSupportedError). Neither can be had from a fixture that Chromium happens to fail on every machine, so the page's element is made to do what
  // it does then: harness stubs of the element, not of the app.
  test('a play() the element refuses leaves the button on Play and says why; an element error says it too', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('play-refused')
    try {
      await expect.poll(async () => (await elementState(window)).w, { timeout: 30_000 }).toBe(CLIP_WIDTH)
      await expect(window.getByText(SENTENCE)).toHaveCount(0)
      await window.evaluate(() => {
        const proto = HTMLMediaElement.prototype as unknown as { play: () => Promise<void>; __realPlay?: () => Promise<void> }
        proto.__realPlay = proto.play
        proto.play = () => Promise.reject(new DOMException('The element has no supported sources.', 'NotSupportedError'))
      })
      const play = window.getByRole('button', { name: 'Play', exact: true })
      await play.click()
      await expect(window.getByText(SENTENCE), 'the refusal is said').toBeVisible({ timeout: 10_000 })
      await expect(window.getByRole('button', { name: 'Play', exact: true }), 'the control did not flip to Pause on a play that never started').toBeVisible()
      await expect(window.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)

      // Put the real play() back, then load a fresh video; an element `error` (code 4, no supported source) raises the same sentence.
      await window.evaluate(() => {
        const proto = HTMLMediaElement.prototype as unknown as { play: () => Promise<void>; __realPlay?: () => Promise<void> }
        if (proto.__realPlay) proto.play = proto.__realPlay
      })
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect(window.locator('video')).toHaveCount(1)
      await expect.poll(async () => (await elementState(window)).w, { timeout: 30_000 }).toBe(CLIP_WIDTH)
      await expect(window.getByText(SENTENCE), 'a new video starts clean').toHaveCount(0)
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl: HTMLVideoElement }).__imagiiVideoEl
        Object.defineProperty(v, 'error', { configurable: true, get: () => ({ code: 4, message: 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS' }) })
        v.dispatchEvent(new Event('error'))
      })
      await expect(window.getByText(SENTENCE), 'an element error is said too').toBeVisible({ timeout: 10_000 })
      // An aborted load (code 1) is not a verdict on the picture: it says nothing.
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect.poll(async () => (await elementState(window)).w, { timeout: 30_000 }).toBe(CLIP_WIDTH)
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl: HTMLVideoElement }).__imagiiVideoEl
        Object.defineProperty(v, 'error', { configurable: true, get: () => ({ code: 1, message: 'aborted' }) })
        v.dispatchEvent(new Event('error'))
      })
      await window.waitForTimeout(500)
      await expect(window.getByText(SENTENCE), 'an aborted load is not "cannot preview"').toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

// ═════════ Leaving a studio mid-job (T-135 (1)) and what the panels keep (T-135 (4)) ═════════

/** T-135 (1): leave Video Studio for Home and come back to it. The video stays loaded (its store outlives the route); a panel that had a job in its state does not. */
async function leaveAndReturn(window: Page): Promise<void> {
  await window.getByRole('link', { name: 'Home' }).click()
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
  await gotoVideoStudio(window)
  await expect(window.locator('video')).toHaveCount(1)
}

test.describe('Leaving a studio mid-job (T-135 (1), (4))', () => {
  // The job panels kept their busy flag and their job's id in the panel's state, so a route change unmounted them: the panel came back idle, its
  // primary enabled, over a job main was still running, with no Cancel anywhere (USER_GUIDE promises one while a render runs) - and a retry hit
  // main's "An export is already running". The jobs are the 20-minute fixture's, so each is still running when the person is back.
  test('a job that is running when the person leaves the studio is still running, with its Cancel, when they come back: Reframe, GIF and Compile', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('leave-panels', longSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click() // Compile needs two

      // ── Reframe ──
      await reframeCard(window).getByRole('button', { name: 'Choose folder…' }).click()
      await reframeCard(window).getByRole('button', { name: 'Reframe to 9:16' }).click()
      await expect(reframeCard(window).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 30_000 })
      await leaveAndReturn(window)
      await expect(reframeCard(window).getByRole('button', { name: 'Reframing…' }), 'not idle: a job is running').toBeDisabled()
      await expect(reframeCard(window).getByRole('progressbar'), 'and its bar is drawn').toBeVisible()
      await reframeCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'Reframe canceled.')
      await expect(reframeCard(window).getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({ timeout: 30_000 })
      await expect(reframeCard(window).getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)

      // ── GIF ──
      await gifCard(window).getByRole('button', { name: 'Export GIF' }).click()
      await expect(gifCard(window).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 30_000 })
      await leaveAndReturn(window)
      await expect(gifCard(window).getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await gifCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'GIF canceled.')
      await expect(gifCard(window).getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 30_000 })

      // ── Compile ──
      await compileCard(window).getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expect(compileCard(window).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 30_000 })
      await leaveAndReturn(window)
      await expect(compileCard(window).getByRole('button', { name: 'Stitching…' })).toBeDisabled()
      await compileCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'Compilation canceled.')
      await expect(compileCard(window).getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({ timeout: 30_000 })
      expect(mp4sIn(outDir).filter((f) => f.endsWith('_compilation.mp4'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('Picture-in-picture: a composite that is running when the person leaves is still running, with its Cancel, when they come back', async () => {
    test.setTimeout(300_000)
    const studio = await launchWithVideo('leave-pip', clipSrc)
    const { app, window, outDir } = studio
    try {
      // Base, overlay, then the folder: two 20-minute sources make a composite that is still running when the person is back.
      await stubDialogs(app, { open: [longSrc, longSrc, outDir] })
      await pipCard(window).getByRole('button', { name: 'Base: none' }).click()
      await pipCard(window).getByRole('button', { name: 'Overlay: none' }).click()
      await pipCard(window).getByRole('button', { name: 'Composite' }).click()
      await expect(pipCard(window).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 60_000 })
      await leaveAndReturn(window)
      // The picked files are the panel's own settings and do not survive a visit; the job does.
      await expect(pipCard(window).getByRole('button', { name: 'Compositing…' })).toBeDisabled()
      await pipCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'Picture-in-picture canceled.')
      await expect(pipCard(window).getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 30_000 })
      expect(mp4sIn(outDir).filter((f) => f.endsWith('_pip.mp4'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('Export: the queue, its progress and its Cancel are still there after a trip to Home', async () => {
    test.setTimeout(300_000)
    const studio = await launchWithVideo('leave-export', longSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = (): Locator => exportCard(window)
      await card().getByRole('button', { name: 'Choose folder…' }).click()
      await card().getByRole('button', { name: /^Export 1 file/ }).click()
      await expect(card().getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await expect(card().getByRole('progressbar', { name: 'Clip 1 · YouTube' })).toBeVisible()

      await leaveAndReturn(window)
      // Back: not idle. The same row, still running; Export is off; and the Cancel is there.
      await expect(card().getByRole('button', { name: 'Exporting…' }), 'Export is off while the batch runs').toBeDisabled()
      await expect(card().getByRole('progressbar', { name: 'Clip 1 · YouTube' }), 'the queue row is drawn').toBeVisible()
      const cancel = card().getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible()
      // Progress still arrives for a batch the panel was away from: the bar moves past where it was when the person left.
      await expect
        .poll(async () => Number(await card().getByRole('progressbar', { name: 'Clip 1 · YouTube' }).getAttribute('aria-valuenow')), { timeout: 120_000, intervals: [500] })
        .toBeGreaterThan(0)
      await cancel.click()
      await expectToast(window, 'Export canceled. Files already finished are in your folder.')
      await expect(card().getByText('Canceled', { exact: true })).toBeVisible()
      await expect(card().getByRole('button', { name: /^Export 1 file/ })).toBeEnabled({ timeout: 30_000 })
      expect(mp4sIn(outDir), 'the canceled job left nothing behind').toEqual([])
    } finally {
      await app.close()
    }
  })

  test('Export: a batch that ends while the person is away shows its finished row when they come back', async () => {
    test.setTimeout(300_000)
    const studio = await launchWithVideo('leave-export-done', clipSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 4000 }])
      const card = (): Locator => exportCard(window)
      await card().getByRole('button', { name: 'Choose folder…' }).click()
      await card().getByRole('button', { name: /^Export 1 file/ }).click()
      await expect(card().getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
      // The batch ends while nobody is looking at the panel: its file lands and its toast says so.
      await expect.poll(() => mp4sIn(outDir).length, { timeout: 120_000, intervals: [500] }).toBe(1)
      await expectToast(window, 'Exported 1 file')
      await gotoVideoStudio(window)
      await expect(card().getByRole('button', { name: /^Export 1 file/ }), 'idle again, ready for the next batch').toBeEnabled()
      const bar = card().getByRole('progressbar', { name: 'Clip 1 · YouTube' })
      await expect(bar, 'the row is there with its result').toHaveAttribute('aria-valuenow', '100')
      await expect(card().getByText(mp4sIn(outDir)[0] as string)).toBeVisible()
      await card().getByRole('button', { name: 'Show in folder' }).click()
      await expect.poll(() => readRevealCalls(app), { timeout: 15_000 }).toEqual([path.join(outDir, mp4sIn(outDir)[0] as string)])
    } finally {
      await app.close()
    }
  })

  test('Clip Kit: a kit that is running when the person leaves is still running, with its Cancel, when they come back - and the same on whichever clip is selected (T-136 (1))', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('leave-kit')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
      const kits = clipListCard(window).getByTitle('Export this clip for all 5 platforms + 3 thumbnails into one folder')
      await expect(kits.first()).toBeVisible()
      // Job 2's probe is held so the kit is still in its export phase when the person is back.
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 25_000 }])
      await kits.first().click()
      await expect(kits.first()).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })
      await leaveAndReturn(window)
      await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
      await expect(kits.first(), 'the running kit\'s button says where it is').toHaveText(EXPORTING_N_OF_5)
      await expect(kits.first()).toBeDisabled()
      const cancel = clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel, 'and its Cancel is there').toHaveCount(1)
      // T-136 (1): the list shows ONE kit button, for the selected clip, so "the other clip's button" is the same button. It is off while the kit
      // works (a second press starts nothing), and it shows the RUNNING kit with its Cancel - the T-135 pin here said the opposite (an idle label,
      // no Cancel), which was the bug: selecting another clip hid the way to stop a kit that runs for minutes.
      await clipListCard(window).locator('li').nth(1).getByRole('button', { name: /^Select clip/ }).click()
      await expect(kits.first()).toBeDisabled()
      await expect(kits.first()).toHaveText(EXPORTING_N_OF_5)
      await expect(clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
      await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
      await expect(kits.first()).toHaveText(EXPORTING_N_OF_5)
      await cancel.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, 'Clip Kit canceled. Files already finished are in your folder.')
      await expect(kits.first()).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      await expect(kits.first()).toBeEnabled()
      await clipListCard(window).locator('li').nth(1).getByRole('button', { name: /^Select clip/ }).click()
      await expect(kits.first(), 'the other clip is free again').toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('Scan VOD: a scan that is running when the person leaves is still running, with its Cancel, when they come back; a second press is not possible', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('leave-scan', longSrc)
    try {
      const scan = (): Locator => highlightCard(window)
      await scan().getByRole('button', { name: 'Scan VOD' }).click()
      await expect(scan().getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 30_000 })
      await leaveAndReturn(window)
      const scanning = scan().getByRole('button', { name: 'Scanning…' })
      await expect(scanning, 'not "Scan VOD" again: the scan is running and the button is off').toBeDisabled()
      await expect(scan().getByRole('progressbar', { name: 'Scanning the video for highlights' })).toBeVisible()
      await scan().getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(window, 'Scan canceled.')
      await expect(scan().getByRole('button', { name: 'Scan VOD' })).toBeEnabled({ timeout: 30_000 })
      await expect(scan().getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // T-135 (4): a scan's candidates, a pasted chat log and the spikes found in it were each panel's state, lost with every visit - and with Clean audio's
  // own navigation. They belong to the open video now (the video store empties them on load and close), so the same video keeps them across any
  // number of visits and a different video starts clean. (The transcript preview is held the same way; a transcription needs the speech engine, which
  // is not on this machine, so that half is the store's unit case and the wiring pin.)
  test('scan candidates, pasted chat logs and found spikes are still there after a trip to Home, and a different video starts clean', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('leave-results', burstSrc)
    try {
      const scan = (): Locator => highlightCard(window)
      await scan().getByRole('button', { name: 'Scan VOD' }).click()
      await expect(scan().locator('li')).toHaveCount(1, { timeout: 60_000 })
      await scan().getByRole('button', { name: 'Add chat log (optional)' }).click()
      await scan().locator('textarea').fill(chatLogOverBurst())
      await expect(scan().locator('li').first().getByText('Chat')).toBeVisible()
      const chat = (): Locator => chatCard(window)
      await chat().locator('textarea').fill(chatLogWithOneSpike())
      await chat().getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(chat().locator('li')).toHaveCount(1)
      // T-137 (9): the row shows the range held to the video (this log's spike is past the end of the 14 s source), so the row is compared with itself, not with the raw range.
      const spikeRange = (await chat().locator('li').first().locator('span.font-mono').innerText()).trim()

      await leaveAndReturn(window)
      await expect(scan().locator('li'), 'the scan\'s candidates are still listed').toHaveCount(1)
      await expect(scan().getByRole('button', { name: 'Re-scan' })).toBeVisible()
      await expect(scan().locator('textarea'), 'the chat log is where it was left').toHaveValue(chatLogOverBurst())
      await expect(chat().locator('textarea')).toHaveValue(chatLogWithOneSpike())
      await expect(chat().locator('li'), 'the spikes are still listed').toHaveCount(1)
      await expect(chat().locator('li').first().locator('span.font-mono')).toHaveText(spikeRange)

      // Clean audio navigates to Audio Studio: the same trip.
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 60_000 })
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await expect(scan().locator('li')).toHaveCount(1)
      await expect(chat().locator('li')).toHaveCount(1)

      // A different video starts clean: close this one and drop another.
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await dropOnVideoImporter(window, clipSrc, path.basename(clipSrc))
      await expect(window.locator('video')).toHaveCount(1)
      await expect(scan().locator('li')).toHaveCount(0)
      await expect(scan().getByRole('button', { name: 'Scan VOD' })).toBeVisible()
      await expect(chat().locator('textarea')).toHaveValue('')
      await expect(chat().locator('li')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Clean audio: the button stays off while its extraction runs, after a trip to Home; and a second extraction from the Audio Studio importer is refused by name', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('leave-clean', clipSrc)
    try {
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 12_000 }])
      const clean = (): Locator => window.getByRole('button', { name: 'Clean audio' })
      await clean().click()
      await expectToast(window, 'Extracting audio')
      await expect(clean()).toBeDisabled()

      // Away and back: still off. (This used to re-arm the button, and a second press ran a second extraction.)
      await leaveAndReturn(window)
      await expect(clean(), 'not re-armed by the visit').toBeDisabled()

      // A second extraction from the other door - the Audio Studio importer - is refused in a sentence that names the one that is running.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await window.evaluate((file) => {
        const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
        if (!zone) throw new Error('Audio Studio drop zone not found')
        const f = new File([new Uint8Array([0])], 'friday.mp4', { type: '' })
        Object.defineProperty(f, 'path', { value: file })
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: { files: [f] } })
        zone.dispatchEvent(event)
      }, burstSrc)
      await expectToast(window, 'Still extracting the sound from "pipeline.mp4". Wait for it to finish, then try again.')
      await expect(window.locator('[data-tutorial="audio-waveform"]'), 'nothing was opened by the refused drop').toHaveCount(0)
      // The first extraction was never disturbed: it finishes and its sound opens in Audio Studio.
      await expect(window.locator('[data-tutorial="audio-waveform"]')).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible()
      // And the slot is given back when it ends: the button is armed again for the next one.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await expect(clean(), 'the finished extraction gave the run back').toBeEnabled()
    } finally {
      await app.close()
    }
  })
})

test.describe('ExportPanel', () => {
  test('a two-clip, two-preset queue writes four files named by the template, and persists what it used', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('queue')
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)

      // ── the output-dir picker: unset, then the folder's basename ──
      await expect(card.getByRole('button', { name: 'Choose folder…' })).toBeVisible()
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await expect(card.getByRole('button', { name: path.basename(outDir) })).toBeVisible()

      // ── filename template ──
      // No watermark on this batch on purpose: a non-empty watermark adds a
      // `drawtext` filter, which the bundled ffmpeg cannot run on this
      // platform (see the watermark test below and DISPOSITIONS). The
      // template is what is under test here.
      await expect(card.getByPlaceholder('@yourhandle (leave blank for none)')).toHaveValue('')
      await card.getByPlaceholder('{source}_{clip}_{preset}').fill('{clip}-{preset}')

      // ── two clips, two presets each ──
      // Both presets are 16:9, so the safe-zone pre-flight stays quiet and
      // this test is about the queue rather than the modal.
      await presetBox(window, 'X / Twitter').check()
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      await clipListCard(window)
        .locator('li')
        .nth(1)
        .getByRole('textbox')
        .fill('Second')
      // The grid follows the selected clip, so clip 2's presets are its own.
      await expect(presetBox(window, 'X / Twitter')).not.toBeChecked()
      await presetBox(window, 'X / Twitter').check()
      await expect(presetBox(window, 'YouTube')).toBeChecked()

      const exportButton = card.getByRole('button', { name: 'Export 4' })
      await expect(exportButton).toBeEnabled()
      await exportButton.click()

      // ── the queue renders one row per clip x preset ──
      await expect(card.getByText('Queue', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(card.getByText('Clip 1 · YouTube')).toBeVisible()
      await expect(card.getByText('Clip 1 · X / Twitter')).toBeVisible()
      await expect(card.getByText('Second · YouTube')).toBeVisible()
      await expect(card.getByText('Second · X / Twitter')).toBeVisible()

      // ── four files, named by the template the user typed ──
      const expected = [
        'Clip 1-twitter.mp4',
        'Clip 1-youtube.mp4',
        'Second-twitter.mp4',
        'Second-youtube.mp4'
      ]
      await expect
        .poll(() => mp4sIn(outDir), { timeout: 540_000, intervals: [500] })
        .toEqual(expected)
      await expectToast(window, 'Exported 4 files')
      // Per-row Show only renders once that row carries an outputPath, so
      // four of them IS the four jobComplete events arriving.
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(4)
      // T-114: and each row's bar is a progressbar named for its job, with its value - a row of four
      // identical bars was four unnamed divs to a screen reader. The percent beside it is still the
      // live region that says the number as it moves.
      for (const job of ['Clip 1 · YouTube', 'Clip 1 · X / Twitter', 'Second · YouTube', 'Second · X / Twitter']) {
        const bar = card.getByRole('progressbar', { name: job, exact: true })
        await expect(bar, job).toHaveCount(1)
        await expect(bar, job).toHaveAttribute('aria-valuemin', '0')
        await expect(bar, job).toHaveAttribute('aria-valuemax', '100')
        await expect(bar, job).toHaveAttribute('aria-valuenow', '100')
      }
      await expect(card.getByRole('status').filter({ hasText: '100%' })).toHaveCount(4)
      // T-92: the first row's button reveals the first row's file.
      await stubShellReveal(app)
      await card.getByRole('button', { name: 'Show in folder', exact: true }).first().click()
      await expect
        .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
        .toEqual([path.join(outDir, 'Clip 1-youtube.mp4')])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-06-queue.png') })

      // ── the bytes: each preset's own geometry ──
      const yt = videoStream(await ffprobeJson(path.join(outDir, expected[1] as string)))
      expect(yt.codec_name).toBe('h264')
      expect(yt.width).toBe(1920)
      expect(yt.height).toBe(1080)
      const tw = videoStream(await ffprobeJson(path.join(outDir, expected[2] as string)))
      expect(tw.width).toBe(1280)
      expect(tw.height).toBe(720)

      // ── what the export persisted for next time ──
      await expect
        .poll(() => readConfig(userDataDir).filenameTemplate, { timeout: 15_000 })
        .toBe('{clip}-{preset}')
      const config = readConfig(userDataDir)
      expect((config.export as { lastOutputDir?: string })?.lastOutputDir).toBe(outDir)
      // An empty watermark leaves nothing saved: the pair is written together
      // (T-49) and, since T-119, cleared together by a blank export, so they are
      // absent whether or not a handle was ever saved. The case that has one saved
      // first is "a blank export forgets the saved watermark" in the ClipKit block.
      expect(config.streamerHandle).toBeUndefined()
      expect(config.watermarkPosition).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  test('a custom preset exports at its stored dimensions, and deleting it mid-batch leaves the running job alone (T-50)', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('customexport')
    const { app, window, outDir, userDataDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      // Accept every confirm: the only one raised here is the preset delete.
      window.on('dialog', (d) => void d.accept())
      const card = exportCard(window)
      const presetsDir = path.join(userDataDir, 'export-presets')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByPlaceholder('{source}_{clip}_{preset}').fill('{clip}-{preset}')

      // ── save a preset through the real manager, at a size no platform has ──
      await card.getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await modal.getByRole('textbox', { name: 'Custom preset name' }).fill('Discord 540p')
      const numbers = modal.getByRole('spinbutton')
      // 16:9 like the YouTube default it is based on, so the safe-zone
      // pre-flight stays quiet and this test is about the queue.
      await numbers.nth(0).fill('960')
      await numbers.nth(1).fill('540')
      await numbers.nth(2).fill('24')
      await modal.getByRole('button', { name: '+ Save preset' }).click()
      await expectToast(window, 'Saved "Discord 540p"')
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // ── queue it alongside a platform preset ──
      await expect(card.getByRole('checkbox')).toHaveCount(7)
      await presetBox(window, 'Discord 540p').check()
      const exportButton = card.getByRole('button', { name: 'Export 2' })
      await expect(exportButton).toBeEnabled()
      await exportButton.click()

      // The whole queue crosses the IPC in ONE exportBatch call, so by the
      // time the Queue panel paints, main already holds each job's resolved
      // dimensions. That is what makes the delete below safe by design
      // rather than by timing.
      await expect(card.getByText('Queue', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(card.getByText('Clip 1 · Discord 540p')).toBeVisible()
      await expect(card.getByText('Clip 1 · YouTube')).toBeVisible()

      // ── delete the preset while the batch is in flight ──
      // Defined behavior (T-50): the in-flight job finishes at the size it
      // already resolved. Whether the encode has finished by the time this
      // click lands or not, the assertions below hold — the file is at the
      // custom size either way.
      await card.getByRole('button', { name: 'Presets' }).click()
      await modal.getByRole('button', { name: 'Delete' }).click()
      await expect(modal.getByText('No custom presets yet.')).toBeVisible()
      expect(readdirSync(presetsDir)).toEqual([])
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // The queue row keeps the name it was queued under. It is a log of
      // what ran, not a live lookup — a row that fell back to the BASE
      // platform's label here would be a ghost telling the user the wrong
      // thing about a file on disk.
      await expect(card.getByText('Clip 1 · Discord 540p')).toBeVisible()

      // ── both files land, and the custom one is at ITS dimensions ──
      const expected = ['Clip 1-Discord 540p.mp4', 'Clip 1-youtube.mp4']
      await expect
        .poll(() => mp4sIn(outDir), { timeout: 540_000, intervals: [500] })
        .toEqual(expected)
      await expectToast(window, 'Exported 2 files')
      const custom = videoStream(
        await ffprobeJson(path.join(outDir, 'Clip 1-Discord 540p.mp4'))
      )
      expect(custom.codec_name).toBe('h264')
      expect(custom.width).toBe(960)
      expect(custom.height).toBe(540)
      // ...and not the base platform's geometry, which is what a fallback
      // to PLATFORM_PRESETS would have produced.
      expect(custom.width).not.toBe(1920)
      const platform = videoStream(await ffprobeJson(path.join(outDir, 'Clip 1-youtube.mp4')))
      expect(platform.width).toBe(1920)
      expect(platform.height).toBe(1080)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-13-custompreset.png') })

      // ── the deleted preset is unqueued everywhere: no ghost row ──
      await expect(card.getByRole('checkbox')).toHaveCount(6)
      await expect(card.locator('label').filter({ hasText: 'Discord 540p' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('the watermark reaches the filter graph, and both halves of it survive a relaunch (T-49)', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('watermark')
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()

      const handle = card.getByPlaceholder('@yourhandle (leave blank for none)')
      const position = card.getByLabel('Watermark position')
      // Both controls are real state, and the position select offers the
      // four corners WatermarkSpec allows.
      await expect(position).toHaveValue('bottom-right')
      await handle.fill('@imagii_e2e')
      await expect(handle).toHaveValue('@imagii_e2e')
      for (const corner of ['bottom-left', 'top-right', 'top-left']) {
        await position.selectOption(corner)
        await expect(position).toHaveValue(corner)
      }

      // T-84: the failure's raw words belong in the console, not the toast.
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      await card.getByRole('button', { name: 'Export 1' }).click()
      // `runExportQueue` persists the handle BEFORE it queues anything, so
      // this assertion holds on every platform.
      await expect
        .poll(() => readConfig(userDataDir).streamerHandle, { timeout: 30_000 })
        .toBe('@imagii_e2e')

      if (process.platform === 'win32') {
        // The shipping platform: the watermarked file renders for real.
        await expect
          .poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] })
          .toBe(1)
        await expectToast(window, 'Exported 1 file')
      } else {
        // PLATFORM PIN (see DISPOSITIONS): ffmpeg-static's Linux build is
        // compiled without libharfbuzz (it does have libfreetype), so `drawtext` — the only filter a
        // watermark or a text overlay produces — does not exist in the
        // binary and the job dies on graph init. That the error names
        // drawtext is itself the proof the watermark reached the filter
        // string. If this line ever fails on Linux, the bundled binary
        // gained the filter and the watermark's pixels become assertable
        // here (and in Layer 5, which has no drawtext coverage at all).
        //
        // T-84: the USER reads a plain sentence now, and ffmpeg's stderr
        // goes to the console — so the proof that the watermark reached the
        // filter string is read from there. Both halves are asserted: the
        // toast carries none of it, and the console carries all of it.
        await expectToast(window, 'Export failed.')
        expect((await readToastLog(window)).join(' | ')).not.toMatch(/drawtext|FFmpeg exit/)
        await expect
          .poll(() => consoleLines.join('\n'), { timeout: 30_000 })
          .toContain("No such filter: 'drawtext'")
        expect(mp4sIn(outDir)).toEqual([])
      }
      // Either way the panel leaves its running state rather than sticking.
      await expect(card.getByRole('button', { name: /^Export/ })).toBeEnabled({ timeout: 30_000 })

      // T-49 (was FINDING-2): the corner is written with the handle. The old
      // build persisted `streamerHandle` + `filenameTemplate` only, so a user
      // who picked "top left" got bottom-right back on the next launch — the
      // export panel remembered half of one preference.
      const config = readConfig(userDataDir)
      expect(config.streamerHandle).toBe('@imagii_e2e')
      expect(config.watermarkPosition).toBe('top-left')
    } finally {
      await app.close()
    }

    // ── the next launch, on the SAME userData: both halves come back ──
    // The panel only exists once a source is loaded, so the fixture is
    // re-imported the way a returning user would open their footage.
    const app2 = await launchApp(userDataDir)
    try {
      const window2 = await app2.firstWindow()
      await window2.waitForLoadState('domcontentloaded')
      await expect(window2.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
      await gotoVideoStudio(window2)
      await dropOnVideoImporter(window2, clipSrc, path.basename(clipSrc))
      const card2 = exportCard(window2)
      await expect(card2.getByPlaceholder('@yourhandle (leave blank for none)')).toHaveValue(
        '@imagii_e2e',
        { timeout: 30_000 }
      )
      await expect(card2.getByLabel('Watermark position')).toHaveValue('top-left')
      // Restoring must not rewrite a different value over the stored one
      // (record.spec's corner test makes the same check for the same reason).
      expect(readConfig(userDataDir).watermarkPosition).toBe('top-left')
    } finally {
      await app2.close()
    }
  })

  test('the text overlay "+ Add text" stores, untouched, is one the exporter takes (T-113)', async () => {
    // The editor's default color used to be the NAME "white" while every overlay gate takes
    // `#RRGGBB` only, so a person who clicked "+ Add text" and nothing else was refused at
    // Export with "a setting imagii can't use". The untouched overlay must reach ffmpeg.
    test.setTimeout(600_000)
    const studio = await launchWithVideo('default-overlay')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()

      const overlays = window
        .locator('.card')
        .filter({ has: window.getByRole('button', { name: '+ Add text' }) })
      await overlays.getByRole('button', { name: '+ Add text' }).click()
      await expect(overlays.locator('h3')).toHaveText('Text overlays (1)')
      // Nothing else is touched: the Color box shows the hex the store kept, not "white".
      await expect(overlays.getByPlaceholder('white or #ffcc00')).toHaveValue('#ffffff')

      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      await card.getByRole('button', { name: 'Export 1' }).click()

      if (process.platform === 'win32') {
        // The shipping platform: the overlay renders and the file exists.
        await expect
          .poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] })
          .toBe(1)
        await expectToast(window, 'Exported 1 file')
      } else {
        // PLATFORM PIN (see the watermark test): ffmpeg-static's Linux build has no `drawtext`,
        // so the job dies on graph init. That it dies THERE, and not at the gate with the
        // refusal sentence, is the proof the untouched overlay passed the gate.
        await expectToast(window, 'Export failed.')
        await expect
          .poll(() => consoleLines.join('\n'), { timeout: 30_000 })
          .toContain("No such filter: 'drawtext'")
        const toasts = (await readToastLog(window)).join(' | ')
        expect(toasts).not.toMatch(/setting imagii can't use/)
        expect(consoleLines.join('\n')).not.toMatch(/textOverlays\[0\] malformed/)
        expect(mp4sIn(outDir)).toEqual([])
      }
      await expect(card.getByRole('button', { name: /^Export/ })).toBeEnabled({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  // T-134 (5): the warning lists each affected clip by name, and a clip's name is whatever the person typed (the rename box has no cap): an unbroken
  // one made the list scroll SIDEWAYS inside its card (the list is an `overflow-y-auto` box, which makes the other axis scroll too). The row now
  // cuts the name with an ellipsis and carries all of it as its tooltip, like every other name a layout cuts (DESIGN_GUIDE, the chip rule).
  // T-135 (6): that capped the clip-name span only. Each zone line under it embeds `preset.label`, which for a custom preset is the preset's NAME
  // (a 60-character name measured scrollWidth 474 against 406; the 80-character one already on disk, 977), so the lines scrolled sideways just the
  // same. The long preset is WRITTEN to the presets folder (a cap on the box does not shorten what is saved) and queued beside YouTube, so both
  // directions of the collision carry its name.
  test('a clip and a custom preset with very long unbroken names are cut with an ellipsis in the safe-zone warning, and the list does not scroll sideways (T-134 (5), T-135 (6))', async () => {
    test.setTimeout(240_000)
    const studio = await launchWithVideo('safezone-longname')
    const { app, window, outDir, userDataDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      const longName = 'ClipNamedByAStreamerWhoNeverHitTheSpaceBar'.repeat(3)
      const presetName = 'PresetNamedByAStreamerWhoNeverHitTheSpaceBarAtAll_0123456789'.padEnd(80, 'x')
      const presetsDir = path.join(userDataDir, 'export-presets')
      mkdirSync(presetsDir, { recursive: true })
      writeFileSync(
        path.join(presetsDir, 'zonelong0.json'),
        JSON.stringify({ id: 'zonelong0', name: presetName, width: 720, height: 1280, fps: 30, videoBitrate: '5M', audioBitrate: '192k', basePlatformId: 'reels' }),
        'utf8'
      )
      // The Export panel read its list when it mounted; opening the Presets dialog reads the folder again.
      await card.getByRole('button', { name: 'Presets' }).click()
      const manager = window.getByRole('dialog', { name: 'Custom export presets' })
      await expect(manager.getByText('Saved presets (1)')).toBeVisible({ timeout: 15_000 })
      await manager.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(manager).toBeHidden()
      const rename = clipListCard(window).locator('input[type="text"]').first()
      await rename.fill(longName)
      await expect(rename).toHaveValue(longName)
      await rename.press('Tab')
      // YouTube (16:9, ticked by default) beside the custom 9:16 preset: each one's centered cut loses the other's frame.
      await card.locator('[data-export-target="zonelong0"]').getByRole('checkbox').check()
      await card.getByRole('button', { name: 'Export 2' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Some platforms will crop the picture' }).last()).toBeVisible()

      const list = modal.getByRole('list', { name: 'Clips that will be cropped' })
      const name = list.locator('li > span').first()
      await expect(name).toHaveText(longName)
      // Both directions of the collision name the preset; each is one line of the list.
      const zones = [`${presetName} frame → cut down for YouTube`, `YouTube frame → cut down for ${presetName}`]
      await expect(list.locator('li > div')).toHaveText(zones)
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await check(() => expectEllipsized(name, longName, `the clip name in the warning at ${where}`))
        for (const [i, zone] of zones.entries()) {
          await check(() => expectEllipsized(list.locator('li > div').nth(i), zone, `the zone line "${zone.slice(0, 40)}..." at ${where}`))
        }
        await check(() => expectNoHorizontalOverflow(list, `the cropped-clips list at ${where}`))
        await check(() => expectNoHorizontalOverflow(modal, `the safe-zone dialog at ${where}`))
        await check(() => expectControlsWhole(modal, modal.getByRole('button'), `the dialog's buttons at ${where}`))
      }
      expect(problems, 'the long names are cut, and nothing scrolls sideways').toEqual([])
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    } finally {
      await app.close()
    }
  })

  test('the safe-zone pre-flight warns before a mixed-aspect batch, and both answers are honoured', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('safezone')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()

      // YouTube (16:9) + Reels (9:16) on one clip: each preset's centered
      // crop drops the other's safe zone, which is exactly what the
      // pre-flight is for.
      await presetBox(window, 'Reels').check()
      await card.getByRole('button', { name: 'Export 2' }).click()

      const modal = window.getByRole('dialog')
      await expect(modal).toBeVisible()
      // T-83: plain words. The title says what will happen to the picture,
      // the body says why, and neither uses "clip" as a verb or "safe zone"
      // as a noun.
      await expect(
        modal.getByRole('heading', { name: 'Some platforms will crop the picture' }).last()
      ).toBeVisible()
      await expect(modal).toContainText(
        'the tall ones keep only the middle of the frame, and anything near the edges is lost'
      )
      await expect(modal).not.toContainText('safe zone')
      await expect(modal).not.toContainText('clips:')
      // Both directions of the collision are listed, by clip name. The 4:3
      // fixture is neither wide nor tall, so each platform's cut takes
      // something the other keeps: "<this platform's picture> is cut down for
      // <that platform>".
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Clip 1')
      await expect(modal.locator('li > div')).toHaveText([
        'Reels frame → cut down for YouTube',
        'YouTube frame → cut down for Reels'
      ])
      // T-113: the list scrolls, and a keyboard user can reach it (Chromium 126 does not focus a
      // scroller by itself, and these rows hold nothing to tab to).
      const cropped = modal.getByRole('list', { name: 'Clips that will be cropped' })
      await expect(cropped).toHaveAttribute('tabindex', '0')
      // T-114: and the dialog does not OPEN on that scroller. The trap focused the first thing in the
      // DOM with a tab stop - the list - so Enter or Space on arrival did nothing, and a keyboard user
      // met the question on a box to scroll. It opens on Cancel (the safe answer); the list is one
      // Shift+Tab away. Nothing here calls .focus() itself.
      const cancel = modal.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeFocused()
      await window.keyboard.press('Shift+Tab')
      await expect(cropped).toBeFocused()
      await window.keyboard.press('Tab')
      await expect(cancel).toBeFocused()
      await window.keyboard.press('Tab')
      await expect(modal.getByRole('button', { name: 'Export anyway' })).toBeFocused()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-07-safezone.png') })

      // ── declined: no queue, no files, and the panel is untouched ──
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByText('Queue', { exact: true })).toHaveCount(0)
      expect(mp4sIn(outDir)).toEqual([])
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled()

      // ── accepted: the same batch runs ──
      await card.getByRole('button', { name: 'Export 2' }).click()
      await expect(window.getByRole('dialog')).toBeVisible()
      await window.getByRole('dialog').getByRole('button', { name: 'Export anyway' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect
        .poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] })
        .toBe(2)
      await expectToast(window, 'Exported 2 files')
      const reels = videoStream(
        await ffprobeJson(path.join(outDir, 'pipeline_Clip 1_reels.mp4'))
      )
      expect(reels.width).toBe(1080)
      expect(reels.height).toBe(1920)
    } finally {
      await app.close()
    }
  })

  test('the grid judges the crop, not the file: a 9:16 crop turns TikTok and Reels green, and the rest say why they are not (T-83)', async () => {
    test.setTimeout(120_000)
    // bigSrc: 4K, 26 s. Big enough that nothing is "smaller than the output",
    // and 26 s sits inside TikTok's 21-34 s and Reels' 15-90 s sweet spots —
    // so SHAPE is the only thing left that can keep those two from green.
    const { app, window } = await launchWithVideo('t83grid', bigSrc)
    try {
      const card = exportCard(window)
      // The tile is the whole card (T-92: the verdict is the checkbox's
      // description, outside its label), found by the checkbox it holds.
      const platform = (name: string): Locator =>
        card
          .locator('[data-export-target]')
          .filter({ has: window.getByRole('checkbox', { name, exact: true }) })
      const cropRow = window.locator('[data-tutorial="video-crop"]')
      const TALL_ON_WIDE = "Only the middle 32% of the picture's width fits this shape"
      const WIDE_ON_TALL = "Only the middle 32% of the picture's height fits this shape"

      // ── no crop: the 16:9 source is the frame, so the tall platforms are the
      //    wrong shape — and the card SAYS so, on screen (not in a tooltip) ──
      await expect(platform('TikTok').getByText('Wrong shape', { exact: true })).toBeVisible()
      await expect(platform('TikTok').getByText(TALL_ON_WIDE)).toBeVisible()
      await expect(platform('Reels').getByText('Wrong shape', { exact: true })).toBeVisible()
      // The old catch-all is gone; "Trim" says "shorten the clip".
      await expect(card.getByText('Trim', { exact: true })).toHaveCount(0)
      // 26 s is under YouTube's one-minute sweet spot: yellow, reason in words.
      await expect(platform('YouTube').getByText('OK', { exact: true })).toBeVisible()
      await expect(platform('YouTube').getByText('Under the 1-minute sweet spot')).toBeVisible()

      // ── draw a 9:16 crop: the grid now judges THAT frame ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await cropRow.getByRole('button', { name: '9:16', exact: true }).click()
      for (const tall of ['TikTok', 'Reels']) {
        await expect(platform(tall).getByText('Great', { exact: true })).toBeVisible()
        await expect(platform(tall)).not.toContainText('Wrong shape')
      }
      for (const wide of ['YouTube', 'X / Twitter', 'Facebook']) {
        await expect(platform(wide).getByText('Wrong shape', { exact: true })).toBeVisible()
        await expect(platform(wide).getByText(WIDE_ON_TALL)).toBeVisible()
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-14-grid-crop.png') })

      // ── clearing the crop gives the source back, and the grid follows ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await expect(platform('TikTok').getByText('Wrong shape', { exact: true })).toBeVisible()
      await expect(platform('TikTok').getByText(TALL_ON_WIDE)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // T-127 (8): the question is asked on click 1 and the second click of a double-click lands on the scrim (Export is outside the centered
  // card) and closed it: the person double-clicked, and was shown nothing. The shared Modal's scrim ignores a click whose `detail` is above 1.
  // The dismiss itself is intact: ONE click on the scrim still closes it (T-123 (7)'s press-inside-the-card rule is its own test).
  test('a double-click on Export raises the safe-zone question and the second click does not dismiss it; one click on the scrim still does (T-127 (8))', async () => {
    test.setTimeout(120_000)
    const { app, window, outDir } = await launchWithVideo('t127scrim')
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await presetBox(window, 'Reels').check()
      await card.getByRole('button', { name: 'Export 2' }).dblclick()
      const modal = window.getByRole('dialog')
      await expect(modal, 'the question is on screen after the double-click').toBeVisible()
      await window.waitForTimeout(400)
      await expect(modal, 'and it stays: the second click did not close it').toBeVisible()
      expect(mp4sIn(outDir), 'nothing was exported while it waited for an answer').toEqual([])
      // A single click on the scrim (the corner: outside the card) is still a dismissal.
      await window.mouse.click(4, 4)
      await expect(window.getByRole('dialog')).toHaveCount(0)
      expect(mp4sIn(outDir)).toEqual([])
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('with a crop in place the safe-zone pre-flight reads the crop, so it is the wide platform that is cut down (T-83)', async () => {
    test.setTimeout(120_000)
    const { app, window, outDir } = await launchWithVideo('t83safe', clipSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await presetBox(window, 'TikTok').check()
      const modal = window.getByRole('dialog')

      // The 4:3 fixture uncropped: each cut takes something the other keeps.
      await card.getByRole('button', { name: 'Export 2 files' }).click()
      await expect(modal.locator('li > div')).toHaveText([
        'TikTok frame → cut down for YouTube',
        'YouTube frame → cut down for TikTok'
      ])
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()

      // A 9:16 crop is the new frame. TikTok's shape IS the frame, so it keeps
      // all of it; YouTube takes a wide strip out of it. One platform loses.
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '9:16', exact: true })
        .click()
      await card.getByRole('button', { name: 'Export 2 files' }).click()
      await expect(modal.locator('li > div')).toHaveText(['TikTok frame → cut down for YouTube'])
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(mp4sIn(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a cropped clip exports at every ticked platform\'s own size with square pixels (T-83)', async () => {
    test.setTimeout(600_000)
    // The bytes of "nothing is stretched" are Layer 5's (a marker that stays
    // square). This is the same promise through the real UI: the crop drawn
    // in the player reaches main as the clip's cropRect, and each platform's
    // export comes out at ITS size, valid, with a 1:1 pixel aspect.
    const { app, window, outDir } = await launchWithVideo('t83export', clipSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      await presetBox(window, 'Reels').check()
      await card.getByRole('button', { name: 'Export 2 files' }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Export anyway' }).click()
      await expect
        .poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] })
        .toBe(2)
      await expectToast(window, 'Exported 2 files')
      const yt = videoStream(await ffprobeJson(path.join(outDir, 'pipeline_Clip 1_youtube.mp4')))
      expect([yt.width, yt.height]).toEqual([1920, 1080])
      expect(yt.sample_aspect_ratio).toBe('1:1')
      const reels = videoStream(await ffprobeJson(path.join(outDir, 'pipeline_Clip 1_reels.mp4')))
      expect([reels.width, reels.height]).toEqual([1080, 1920])
      expect(reels.sample_aspect_ratio).toBe('1:1')
    } finally {
      await app.close()
    }
  })

  test('a crop smaller than the output says the picture will be scaled up and look soft; the same source with no crop says nothing (T-97)', async () => {
    test.setTimeout(120_000)
    // fullHdSrc is 1920x1080 and 90 s: its own size meets YouTube's output
    // exactly and its length sits inside every sweet spot, so size is the ONLY
    // thing a crop can change. The 16:9 button draws a crop 90% of each side
    // (1728x972): smaller than YouTube's 1920x1080, bigger than the 1280x720
    // platforms. The check used to read the FILE's size, so it stayed "Great".
    const { app, window } = await launchWithVideo('t97soft', fullHdSrc)
    try {
      const card = exportCard(window)
      const platform = (name: string): Locator =>
        card
          .locator('[data-export-target]')
          .filter({ has: window.getByRole('checkbox', { name, exact: true }) })
      const SOFT = 'The picture is smaller than this output — it will be scaled up and look soft'

      // ── no crop: the source is the frame, and it is big enough for the three
      //    landscape outputs (the tall ones need 1920 rows it does not have,
      //    which they said before this ticket and still say) ──
      for (const name of ['YouTube', 'X / Twitter', 'Facebook']) {
        await expect(platform(name).getByText('Great', { exact: true })).toBeVisible()
        await expect(platform(name).getByText(SOFT)).toHaveCount(0)
      }

      // ── a 16:9 crop: YouTube's output is now bigger than the picture ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '16:9', exact: true })
        .click()
      await expect(platform('YouTube').getByText('OK', { exact: true })).toBeVisible()
      await expect(platform('YouTube').getByText(SOFT)).toBeVisible()
      // The 1280x720 platforms are still fed more than they need: no warning,
      // so the reason is about THIS output and not a blanket on every card.
      for (const name of ['X / Twitter', 'Facebook']) {
        await expect(platform(name).getByText('Great', { exact: true })).toBeVisible()
        await expect(platform(name).getByText(SOFT)).toHaveCount(0)
      }
      // The old wording is gone, and the reason is part of the checkbox's
      // description (T-92), not its name.
      await expect(card.getByText('will be enlarged')).toHaveCount(0)
      await expect(card.getByRole('checkbox', { name: 'YouTube', exact: true })).toHaveAccessibleDescription(
        /scaled up and look soft/
      )
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-16-grid-soft-crop.png') })

      // ── clearing the crop gives the source back ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await expect(platform('YouTube').getByText('Great', { exact: true })).toBeVisible()
      await expect(platform('YouTube').getByText(SOFT)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the grid judges the length of the file at the clip\'s speed: a 2x clip Instagram would not recommend at 1x is inside the sweet spot at 2x, and Reels\' red waits for 20 minutes (T-97, T-112)', async () => {
    test.setTimeout(240_000)
    // midSrc is 300 s: past the 3 minutes Instagram stops recommending a Reel at 1x
    // (T-112: advice, so yellow in Instagram's words — Reels take up to 20 minutes), and 150 s at 2x.
    // The grid read SOURCE seconds, so a 2x clip was warned at half of what its file would really be.
    const { app, window } = await launchWithVideo('t97speed', midSrc)
    try {
      const card = exportCard(window)
      const platform = (name: string): Locator =>
        card
          .locator('[data-export-target]')
          .filter({ has: window.getByRole('checkbox', { name, exact: true }) })
      const speed = window.getByRole('slider', { name: 'Clip playback speed' })
      const REELS_ADVICE = "Over 3 minutes — Instagram won't recommend it to new viewers"

      // ── 1x: 300 s. Instagram's advice, and NOT the length's red: the platform takes it ──
      // (The card as a whole still reads "Wrong shape": this 4:3 fixture into 9:16 loses most of
      // its width. That is the SHAPE's verdict; the length's own is the sentence and the absence
      // of "Too long". The level the length alone gives is pinned in presets.test.ts.)
      await expect(platform('Reels').getByText(REELS_ADVICE)).toBeVisible()
      await expect(platform('Reels').getByText('Too long', { exact: false })).toHaveCount(0)
      await expect(platform('Reels').getByText('Longer than the typical')).toHaveCount(0)

      // ── 2x: 150 s of file. Over Reels' 1:30 sweet spot, under the 3 minutes ──
      await speed.fill('2')
      await expect(window.getByText('2.00×', { exact: true })).toBeVisible()
      await expect(platform('Reels').getByText(REELS_ADVICE)).toHaveCount(0)
      await expect(platform('Reels').getByText('Too long', { exact: false })).toHaveCount(0)
      await expect(platform('Reels').getByText('Over the 1:30 sweet spot')).toBeVisible()

      // ── 0.5x puts it back past the 3 minutes (600 s of file) — the other way, still not red ──
      await speed.fill('0.5')
      await expect(platform('Reels').getByText(REELS_ADVICE)).toBeVisible()
      await expect(platform('Reels').getByText('Too long', { exact: false })).toHaveCount(0)
    } finally {
      await app.close()
    }

    // ── red waits for the real limit: a 36-minute source is past 20 minutes at 1x and 0.5x, not at 2x ──
    const long = await launchWithVideo('t112reelslimit', kitLongSrc)
    try {
      const reels = exportCard(long.window)
        .locator('[data-export-target]')
        .filter({ has: long.window.getByRole('checkbox', { name: 'Reels', exact: true }) })
      const speed = long.window.getByRole('slider', { name: 'Clip playback speed' })
      await expect(reels.getByText('Too long', { exact: false })).toBeVisible()
      await expect(reels.getByText('Longer than the typical 20-minute limit')).toBeVisible()
      await speed.fill('2') // 18 minutes of file
      await expect(reels.getByText('Too long', { exact: false })).toHaveCount(0)
      await expect(reels.getByText("Over 3 minutes — Instagram won't recommend it to new viewers")).toBeVisible()
    } finally {
      await long.app.close()
    }
  })

  test('a 9:16 clip over TikTok\'s sweet spot at 1x is inside it at 2x, and the card turns Great (T-97)', async () => {
    test.setTimeout(120_000)
    // bigLongSrc: 4K and 50 s. A 9:16 crop is TikTok-shaped and still 1093x1944
    // of picture, so length is all that can keep the card from green: 50 s is
    // past TikTok's 34 s sweet spot, the 25 s of file a 2x clip makes is not.
    const { app, window } = await launchWithVideo('t97green', bigLongSrc)
    try {
      const card = exportCard(window)
      const tiktok = card
        .locator('[data-export-target]')
        .filter({ has: window.getByRole('checkbox', { name: 'TikTok', exact: true }) })
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '9:16', exact: true })
        .click()
      await expect(tiktok.getByText('OK', { exact: true })).toBeVisible()
      await expect(tiktok.getByText('Over the 34-second sweet spot')).toBeVisible()

      await window.getByRole('slider', { name: 'Clip playback speed' }).fill('2')
      await expect(tiktok.getByText('Great', { exact: true })).toBeVisible()
      await expect(tiktok.getByText('Over the 34-second sweet spot')).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-17-grid-speed.png') })
    } finally {
      await app.close()
    }
  })

  test('cancelling a multi-job batch asks first — Keep running resumes it, Cancel jobs kills it', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('cancelbatch', clipSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      // Three 16:9 presets: enough jobs for the >= 2 confirm threshold,
      // and no safe-zone modal in the way.
      await presetBox(window, 'X / Twitter').check()
      await presetBox(window, 'Facebook').check()
      await card.getByRole('button', { name: 'Export 3' }).click()

      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible({ timeout: 30_000 })
      await expect(card.getByRole('button', { name: 'Exporting…' })).toBeDisabled()

      // ── the confirm, with the count of what is at stake ──
      await cancel.click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Cancel running jobs' }).last()).toBeVisible()
      await expect(modal.getByText('Cancel 3 running jobs?')).toBeVisible()

      // ── Keep running: the modal closes and the batch is still alive ──
      await modal.getByRole('button', { name: 'Keep running' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

      // ── Cancel jobs: SIGKILL reaches the running ffmpeg, the batch
      //    rejects, and the panel comes back out of its running state ──
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      // T-84: neutral, in the panel's words, and it says what survived.
      await expectCanceledNotFailed(
        window,
        'Export canceled. Files already finished are in your folder.'
      )
      await expect(card.getByRole('button', { name: 'Export 3' })).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      // The batch is sequential, so killing the running job stops the rest:
      // the queue never produced three files.
      expect(mp4sIn(outDir).length).toBeLessThan(3)
      // Show only renders for a row that reported an outputPath, so there
      // are strictly fewer of them than the three jobs that were queued.
      expect(
        await card.getByRole('button', { name: 'Show in folder', exact: true }).count()
      ).toBeLessThan(3)
      // The canceled rows are painted, not left at a hopeful accent-colored
      // percentage — and T-84 gives them WORDS that outlive the toast: every
      // row that did not finish says "Canceled", none says "Failed" (a cancel
      // is the user's decision, not a fault), and the rows that did finish say
      // neither. T-100: the paint is NEUTRAL. Red is for a fault; a Canceled
      // row under a danger-red bar read as something that broke.
      const shown = await card.getByRole('button', { name: 'Show in folder', exact: true }).count()
      await expect(card.locator('.w-40 > .bg-ink-muted')).toHaveCount(3 - shown)
      await expect(card.locator('.w-40 > .bg-danger-strong')).toHaveCount(0)
      // T-100: and what is in the folder is what finished. The job that was
      // killed mid-encode left a file with a name and no moov atom, in the
      // folder the toast says holds the finished ones.
      expect(mp4sIn(outDir)).toHaveLength(shown)
      for (const file of mp4sIn(outDir)) {
        expect(Number((await ffprobeJson(path.join(outDir, file))).format?.duration)).toBeGreaterThan(0)
      }
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(3 - shown)
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(0)
      // Outlives the toast: wait for the toaster to empty, then look again.
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, {
        timeout: 20_000
      })
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(3 - shown)
    } finally {
      await app.close()
    }
  })

  test('a Cancel pressed between two jobs of a batch stops the rest: the second job never starts (T-98)', async () => {
    test.setTimeout(300_000)
    // "Between two jobs" is the one moment a Cancel has nothing to kill: the
    // finished job's ffmpeg is gone and the next one's is not spawned yet (its
    // ffprobe comes first). It is ~40 ms wide on a real machine, so the test
    // does not aim at it — it HOLDS the second job's probe for 8 s and cancels
    // inside that. Before the latch the click returned false, the probe
    // finished, and the second file was written under the toast that said the
    // batch was canceled.
    const studio = await launchWithVideo('cancelgap', clipSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await presetBox(window, 'X / Twitter').check()
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 8000 }])
      await card.getByRole('button', { name: 'Export 2' }).click()

      // Job 1 runs for real and finishes; the batch is then inside job 2's held probe.
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1, {
        timeout: 120_000
      })
      await expect
        .poll(() => readSpawnLog(app), { timeout: 15_000, intervals: [100] })
        .toEqual(['ffprobe', 'ffmpeg', 'ffprobe'])

      // One job left, so no "cancel N running jobs?" question: the click goes straight through.
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      const clickedAt = Date.now()
      await expectCanceledNotFailed(
        window,
        'Export canceled. Files already finished are in your folder.'
      )
      // The wait ended AT ONCE — the held probe (8 s) has not returned yet.
      expect(Date.now() - clickedAt).toBeLessThan(6000)
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled({ timeout: 4000 })
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(1)
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(0)
      // The finished job's row is untouched; the canceled one's bar is neutral.
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1)
      await expect(card.locator('.w-40 > .bg-ink-muted')).toHaveCount(1)
      await expect(card.locator('.w-40 > .bg-danger-strong')).toHaveCount(0)

      // Wait out the held probe: nothing more is started, nothing more is written.
      await window.waitForTimeout(9000)
      expect(await readSpawnLog(app)).toEqual(['ffprobe', 'ffmpeg', 'ffprobe'])
      expect(mp4sIn(outDir)).toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t.startsWith('Exported'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('Cancel mid-encode leaves no half-written file, and the job that finished before it keeps its file (T-100)', async () => {
    test.setTimeout(600_000)
    // Two clips of the 20-minute source: a 2 s one that finishes in moments and
    // the whole thing, which cannot finish before Cancel is clicked. The
    // second job's file exists the moment ffmpeg opens it and is unplayable
    // until it ends (the moov atom is written last), so before T-100 a Cancel
    // left a real-looking .mp4 beside the finished one, in the folder the toast
    // sends the user to.
    const clip = (id: string, name: string, endSec: number): Record<string, unknown> => ({
      id,
      name,
      startSec: 0,
      endSec,
      cropRect: null,
      textOverlays: [],
      selectedPresets: ['youtube']
    })
    const projectPath = path.join(root, `partial-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: longSrc,
          clips: [clip('quick', 'Quick', 2), clip('slow', 'Slow', Math.floor(longSeconds))],
          selectedClipId: 'quick',
          watermark: null
        }
      }),
      'utf8'
    )
    const studio = await launchHome('partialexport')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const card = exportCard(window)
      await expect(card.getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export 2' }).click()

      // Quick finishes; Slow's file appears when ffmpeg opens it — mid-encode.
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1, {
        timeout: 240_000
      })
      await expect
        .poll(() => mp4sIn(outDir).length, { timeout: 240_000, intervals: [250] })
        .toBe(2)

      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expectCanceledNotFailed(
        window,
        'Export canceled. Files already finished are in your folder.'
      )
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled({ timeout: 30_000 })

      // Only the finished job's file is left, and it is a real video.
      await expect
        .poll(() => mp4sIn(outDir), { timeout: 15_000, intervals: [250] })
        .toEqual(['long_Quick_youtube.mp4'])
      const kept = await ffprobeJson(path.join(outDir, 'long_Quick_youtube.mp4'))
      expect(Number(kept.format?.duration)).toBeGreaterThan(1.5)
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('a failed export says so in plain words, the row keeps saying so after the toast fades, and the next good export is clean (T-84)', async () => {
    test.setTimeout(600_000)
    // The failure is the most ordinary one a streamer meets: the recording was
    // imported, then moved or deleted (an external drive unplugged, a cleanup
    // script) before Export. The source is a COPY this test can remove.
    const moved = path.join(root, 'source', `moved-${Date.now().toString(36)}.mp4`)
    copyFileSync(clipSrc, moved)
    const studio = await launchWithVideo('exportfail', moved)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))

      rmSync(moved)
      await card.getByRole('button', { name: 'Export 1' }).click()

      // ── the toast: the context, then the cause, in the app's words ──
      const MESSAGE =
        "Export failed. A file imagii needs isn't there. It may have been moved or deleted."
      await expectToast(window, 'Export failed.')
      const entries = await readToastEntries(window)
      expect(entries.map((e) => e.text)).toContain(MESSAGE)
      // A failure IS an error toast — the contrast with the cancel specs,
      // where the words are neutral and no icon is drawn.
      expect(entries.find((e) => e.text === MESSAGE)?.hasIcon).toBe(true)
      // None of ffprobe's or the IPC bridge's voice reaches the screen…
      expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
        /ffprobe|ffmpeg|\bexit\b|Error invoking remote method|No such file/i
      )
      // …it went to the console, where a bug report can find it.
      await expect
        .poll(() => consoleLines.join('\n'), { timeout: 30_000 })
        .toMatch(/ffprobe exit 1/)

      // ── the row: a visible failed state, and a failure is not a cancel ──
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(1)
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(0)
      await expect(card.locator('.w-40 > .bg-danger-strong')).toHaveCount(1) // the row's bar
      // …that OUTLIVES the toast: wait for the toaster to empty and look again.
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, {
        timeout: 30_000
      })
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(1)
      expect(mp4sIn(outDir)).toEqual([])
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()

      // ── the control: put the file back, export again — the new queue
      //    replaces the old rows, so a good export carries no stale label ──
      copyFileSync(clipSrc, moved)
      await card.getByRole('button', { name: 'Export 1' }).click()
      await expectToast(window, 'Exported 1 file')
      await expect
        .poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] })
        .toBe(1)
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(0)
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('a hand-edited project with a damaged crop is refused in plain words before any file is written, and redrawing the crop fixes it (T-106)', async () => {
    test.setTimeout(300_000)
    // `video:exportBatch` never validated a clip's crop, the field that becomes
    // `crop=` arguments in the filter graph; Compile and the GIF already did. A
    // project file is JSON a person can edit, which is how a crop like this
    // reaches the app. Before: ffmpeg's own "invalid size" came back through the
    // generic failure line. Now the whole batch is refused up front, in a
    // sentence that says what to do.
    const SENTENCE = "One of this project's clips has a damaged crop — redraw it and try again."
    const projectPath = path.join(root, `damaged-crop-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 4,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [
            {
              id: 'damaged-1',
              name: 'Damaged',
              startSec: 0,
              endSec: CLIP_SECONDS,
              // twice the frame, from the middle of it
              cropRect: { x: 0.5, y: 0.5, w: 2, h: 2 },
              textOverlays: [],
              selectedPresets: ['youtube']
            }
          ],
          selectedClipId: 'damaged-1',
          watermark: null,
          srtPath: null
        }
      }),
      'utf8'
    )
    const studio = await launchHome('t106crop')
    const { app, window, outDir } = studio
    try {
      await installToastLog(window)
      await stubDialogs(app, { open: [projectPath] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expectToast(window, 'Project loaded')
      await gotoVideoStudio(window)
      const card = exportCard(window)
      await expect(card.getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })

      // ── the batch is refused, in words, and nothing was written ──
      await stubDialogs(app, { open: [outDir] })
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export 1 file' }).click()
      await expectToast(window, SENTENCE)
      const refused = await readToastLog(window)
      expect(refused.filter((t) => t.includes('damaged crop'))).toEqual([SENTENCE])
      expect(refused.join(' | ')).not.toMatch(/ffmpeg|ffprobe|exit \d|Error invoking remote method|jobs\[0\]/i)
      await expect(card.getByText('Failed', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Export 1 file' })).toBeEnabled()
      expect(mp4sIn(outDir)).toEqual([])

      // ── T-109: the GIF and the compilation say the SAME sentence, not the generic
      //    failure line the validator's path-shaped message used to turn into ──
      const sentences = async (): Promise<number> =>
        (await readToastLog(window)).filter((t) => t === SENTENCE).length
      const gif = gifCard(window)
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(sentences, { timeout: 30_000, intervals: [200] }).toBe(2)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 30_000 })

      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click() // Compile needs 2
      const compile = compileCard(window)
      await expectFolderShown(compile, outDir, 'Compile after the GIF pick')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expect.poll(sentences, { timeout: 30_000, intervals: [200] }).toBe(3)
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      const all = (await readToastLog(window)).join(' | ')
      expect(all).not.toMatch(/GIF export failed|Compilation failed|segments\[|cropRect|Error invoking remote method/)
      expect(readdirSync(outDir)).toEqual([])
      // Back to the clip with the crop for the redraw below.
      await clipListCard(window).getByRole('button', { name: 'Select clip Damaged' }).click()

      // ── "redraw it": a new crop replaces the damaged one, and the same Export works ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '16:9', exact: true })
        .click()
      // (The compilation check above added a second clip, so the queue is two files now.)
      await card.getByRole('button', { name: 'Export 2 files' }).click()
      await expect.poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] }).toBe(2)
      await expectToast(window, 'Exported 2 files')
    } finally {
      await app.close()
    }
  })

  test('a crop stored in a project is visible when it opens: the box is checked, the rectangle is drawn, and it follows the selected clip (T-109)', async () => {
    test.setTimeout(300_000)
    // `cropEnabled` was plain state starting `false`, so a project opened with a stored
    // crop applied it to every export while the editor showed an unchecked box and no
    // rectangle — a crop the person could neither see nor adjust.
    const projectPath = path.join(root, `stored-crop-${Date.now().toString(36)}.imagii.json`)
    const clip = (id: string, name: string, cropRect: unknown) => ({
      id,
      name,
      startSec: 0,
      endSec: CLIP_SECONDS,
      cropRect,
      textOverlays: [],
      selectedPresets: ['youtube']
    })
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 4,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [
            clip('cropped', 'Cropped', { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }),
            clip('plain', 'Plain', null)
          ],
          selectedClipId: 'cropped',
          watermark: null,
          srtPath: null
        }
      }),
      'utf8'
    )
    const studio = await launchHome('t109crop')
    const { app, window } = studio
    try {
      await installToastLog(window)
      await stubDialogs(app, { open: [projectPath] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expectToast(window, 'Project loaded')
      await gotoVideoStudio(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })

      const toggle = window.getByRole('checkbox', { name: 'Crop', exact: true })
      const rectangle = window.locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
      const picture = (): Promise<{ w: number; h: number }> =>
        window.evaluate(() => {
          const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
          return { w: v?.clientWidth ?? 0, h: v?.clientHeight ?? 0 }
        })
      /** The rectangle's drawn width and height, from react-rnd's inline style. */
      const drawn = async (): Promise<{ w: number; h: number }> => {
        const style = (await rectangle.getAttribute('style')) ?? ''
        const w = /width:\s*([\d.]+)px/i.exec(style)
        const h = /height:\s*([\d.]+)px/i.exec(style)
        return { w: Number(w?.[1] ?? Number.NaN), h: Number(h?.[1] ?? Number.NaN) }
      }

      // ── opened with a crop: the box is checked and the rectangle is on the picture ──
      await expect(toggle).toBeChecked()
      await expect(rectangle).toHaveCount(1)
      await expect(window.locator('[data-tutorial="video-crop"]').getByRole('button', { name: 'Reset' })).toBeVisible()
      const frame = await picture()
      expect(frame.w).toBeGreaterThan(100)
      const box = await drawn()
      // The stored crop is half the frame each way.
      expect(Math.abs(box.w - frame.w / 2), `drawn ${box.w}x${box.h} in a ${frame.w}x${frame.h} picture`).toBeLessThan(2)
      expect(Math.abs(box.h - frame.h / 2)).toBeLessThan(2)

      // ── a clip with no crop shows none: the box follows the selected clip ──
      await clipListCard(window).getByRole('button', { name: 'Select clip Plain' }).click()
      await expect(toggle).not.toBeChecked()
      await expect(rectangle).toHaveCount(0)
      await clipListCard(window).getByRole('button', { name: 'Select clip Cropped' }).click()
      await expect(toggle).toBeChecked()
      await expect(rectangle).toHaveCount(1)

      // ── unchecking it clears the crop (nothing hidden is left applying), and Undo
      //    brings it back — visibly ──
      await toggle.uncheck()
      await expect(toggle).not.toBeChecked()
      await expect(rectangle).toHaveCount(0)
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(toggle).toBeChecked()
      await expect(rectangle).toHaveCount(1)
      expect(Math.abs((await drawn()).w - frame.w / 2)).toBeLessThan(2)
    } finally {
      await app.close()
    }
  })

  test('a project with no crop opens with the box unchecked and no rectangle (T-109 control)', async () => {
    test.setTimeout(180_000)
    const studio = await launchWithVideo('t109nocrop')
    const { app, window } = studio
    try {
      await expect(window.getByRole('checkbox', { name: 'Crop', exact: true })).not.toBeChecked()
      await expect(
        window.locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
      ).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('with no output folder Export opens the chooser — a canceled one starts nothing, a chosen one runs the export — and a disabled Export says why (T-112)', async () => {
    test.setTimeout(300_000)
    const studio = await launchWithVideo('exportneg')
    const { app, window, outDir } = studio
    try {
      const card = exportCard(window)
      // ── 1: no output folder, and the chooser is CANCELED: nothing starts, nothing is said ──
      // (It used to raise a red "Choose an output folder first" toast and send the person to
      // press a different button to reach the very same dialog — the GIF, Compile and Reframe
      // panels all open it themselves.)
      await stubDialogs(app, { open: [null, outDir] })
      await card.getByRole('button', { name: 'Export 1' }).click()
      await window.waitForTimeout(800)
      await expect(card.getByText('Queue', { exact: true })).toHaveCount(0)
      expect(await readToastLog(window)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('Choose an output folder first')])
      )
      expect(mp4sIn(outDir)).toEqual([])
      await expect(card.getByRole('button', { name: 'Choose folder…' })).toBeVisible()

      // ── 2: the chooser is answered: the folder is taken AND the export runs, in one click ──
      await card.getByRole('button', { name: 'Export 1' }).click()
      await expect(card.getByRole('button', { name: path.basename(outDir) })).toBeVisible({ timeout: 30_000 })
      await expectToast(window, 'Exported 1 file')
      expect(mp4sIn(outDir)).toHaveLength(1)
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled({ timeout: 30_000 })

      // ── 3: nothing selected disables the button outright — and says why, in view ──
      await presetBox(window, 'YouTube').uncheck()
      const disabled = card.getByRole('button', { name: 'Export', exact: true })
      await expect(disabled).toBeDisabled()
      // T-112: the reason is on screen (the Compile card's pattern) and on the button.
      const WHY = 'Check at least one platform below to export.'
      await expect(card.getByText(WHY, { exact: true })).toBeVisible()
      await expect(disabled).toHaveAttribute('title', WHY)
      // ...and it goes the moment something is checked.
      await presetBox(window, 'YouTube').check()
      await expect(card.getByText(WHY, { exact: true })).toHaveCount(0)
      await presetBox(window, 'YouTube').uncheck()
      await expect(card.getByText(WHY, { exact: true })).toBeVisible()
      // T-49 (was FINDING-3): the disabled button is the WHOLE refusal.
      // `runExportQueue` used to carry a "No presets selected on any clip"
      // toast for a queue that is built from the same count that disables the
      // button, so no click could ever raise it; the branch is deleted, and
      // interactionWiring.test.ts pins the copy gone from the panel's source
      // (a string nothing renders is invisible from here). This stays as the
      // tripwire for the other direction: a future edit that re-adds a toast
      // on this path is a toast the user will never see either.
      expect(await readToastLog(window)).not.toEqual(
        expect.arrayContaining([expect.stringContaining('No presets selected')])
      )

      // ── all five checkboxes are real, and the count follows them ──
      const platforms = ['YouTube', 'Reels', 'TikTok', 'X / Twitter', 'Facebook']
      for (let i = 0; i < platforms.length; i++) {
        const box = presetBox(window, platforms[i] as string)
        await box.check()
        await expect(box).toBeChecked()
        await expect(card.getByRole('button', { name: `Export ${i + 1}` })).toBeEnabled()
      }
      for (let i = platforms.length - 1; i > 0; i--) {
        await presetBox(window, platforms[i] as string).uncheck()
        await expect(presetBox(window, platforms[i] as string)).not.toBeChecked()
        await expect(card.getByRole('button', { name: `Export ${i}` })).toBeEnabled()
      }
    } finally {
      await app.close()
    }
  })
})

// ═══════════════════════ CustomPresetManager (4s) ══════════════════════════

test.describe('CustomPresetManager', () => {
  test('the size, height and frame-rate boxes take typed digits, and are held to what a preset can be (T-123 (4))', async () => {
    // Each box snapped an emptied value to a default (`|| 64`, `|| 64`, `|| 30`), so typing a new number after emptying it appended
    // to the default: "1280" was 641280, "60" was 3060. A width below 64 is still REFUSED at Save, in a sentence (the case below).
    test.setTimeout(120_000)
    const studio = await launchWithVideo('preset-numbers')
    const { app, window } = studio
    try {
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      const width = modal.getByLabel('Width (px)')
      const height = modal.getByLabel('Height (px)')
      const fps = modal.getByLabel('Frame rate (fps)')
      await expect(width).toHaveValue('1920')

      await width.click()
      await width.press('Control+a')
      await width.press('Backspace')
      await expect(width, 'emptied: nothing snaps back into it').toHaveValue('')
      await width.press('1')
      await width.press('2')
      await width.press('8')
      await width.press('0')
      await expect(width).toHaveValue('1280')
      await leave(width)
      await expect(width).toHaveValue('1280')

      await retype(height, '720')
      await expect(height).toHaveValue('720')
      await leave(height)
      await expect(height).toHaveValue('720')

      await retype(fps, '60')
      await expect(fps).toHaveValue('60')
      await leave(fps)
      await expect(fps).toHaveValue('60')
      // Past the box's own range (1 to 120) the nearest edge, once typing ends.
      await retype(fps, '500')
      await leave(fps)
      await expect(fps).toHaveValue('120')
      await retype(fps, '0')
      await leave(fps)
      await expect(fps).toHaveValue('1')
      // The largest size a preset can have (16384): a bigger one is that, not a failure at save.
      await retype(width, '70000')
      await leave(width)
      await expect(width).toHaveValue('16384')
      // An emptied box goes back to what it had.
      await width.click()
      await width.press('Control+a')
      await width.press('Backspace')
      await leave(width)
      await expect(width).toHaveValue('16384')

      // What was typed is what is saved: 1280 x 720 at 60.
      await retype(width, '1280')
      await retype(fps, '60')
      await modal.getByRole('textbox', { name: 'Custom preset name' }).fill('Typed numbers')
      await modal.getByRole('button', { name: '+ Save preset' }).click()
      await expect(modal.getByText('Saved presets (1)')).toBeVisible({ timeout: 15_000 })
      await expect(modal.locator('span.font-mono', { hasText: '60 fps' })).toContainText('1280×720 · 60 fps')
    } finally {
      await app.close()
    }
  })

  // T-134 (5): a saved preset's name was drawn whole in a flex row with no way to give: an 80-character unbroken name (measured in real Chromium)
  // put Delete at x=905 against a card that ends at 848, and the button could not be pressed without scrolling the dialog sideways. The name is cut
  // with an ellipsis and carries all of itself as its tooltip, Delete never moves, and the name box takes no more than 60 characters. The long
  // names are WRITTEN to the presets folder (a preset saved before the cap, or edited by hand): the row has to cope with whatever is on disk.
  test('a very long unbroken preset name is cut with an ellipsis and Delete stays inside the dialog; the name box takes at most 60 characters (T-134 (5))', async () => {
    test.setTimeout(240_000)
    const studio = await launchWithVideo('preset-longname')
    const { app, window, userDataDir } = studio
    try {
      const presetsDir = path.join(userDataDir, 'export-presets')
      mkdirSync(presetsDir, { recursive: true })
      const names = ['PresetNamedByAStreamerWhoNeverHitTheSpaceBarAtAll_0123456789'.padEnd(80, 'x'), 'Y'.repeat(200), 'Discord 1080p']
      names.forEach((name, i) => {
        const id = `longname${i}`
        writeFileSync(
          path.join(presetsDir, `${id}.json`),
          JSON.stringify({ id, name, width: 1280, height: 720, fps: 60, videoBitrate: '5M', audioBitrate: '256k', basePlatformId: 'reels' }),
          'utf8'
        )
      })
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByText('Saved presets (3)')).toBeVisible({ timeout: 15_000 })
      const rows = modal.locator('ul > li')
      await expect(rows).toHaveCount(3)

      // The box: the cap is on the input itself, so a longer name is not typed (or pasted) in the first place.
      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      await expect(nameInput).toHaveAttribute('maxlength', '60')
      await nameInput.pressSequentially('z'.repeat(75))
      await expect(nameInput, 'typing stops at the cap').toHaveValue('z'.repeat(60))
      await nameInput.fill('')

      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      const deletes = modal.getByRole('button', { name: 'Delete' })
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        for (const name of names.slice(0, 2)) {
          await check(() => expectEllipsized(modal.locator('li > span.font-medium', { hasText: name.slice(0, 20) }), name, `the ${name.length}-character name at ${where}`))
        }
        await check(() => expectControlsWhole(modal, deletes, `the Delete buttons at ${where}`))
        await check(() => expectNoHorizontalOverflow(modal, `the presets dialog at ${where}`))
        // A short name is not cut: the cap only bites when the room is gone.
        await check(async () => {
          const short = modal.locator('li > span.font-medium', { hasText: 'Discord 1080p' })
          expect(await short.evaluate((el) => el.scrollWidth <= el.clientWidth), `"Discord 1080p" is drawn whole at ${where}`).toBe(true)
        })
      }
      expect(problems, 'the long names are cut and every Delete is inside the dialog at both window sizes').toEqual([])

      // And the button still does its job, on the longest row.
      window.once('dialog', (dialog) => void dialog.accept())
      await rows.filter({ hasText: (names[0] as string).slice(0, 20) }).getByRole('button', { name: 'Delete' }).click()
      await expect(modal.getByText('Saved presets (2)')).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

  // T-135 (8): the Presets dialog's Save and Delete had no catch (the audio PresetPanel has had one since T-90): a refused write was an unhandled rejection and the
  // dialog looked as if it had worked, with the typed name cleared only on success but nothing said on failure. The refusal here is REAL: the presets folder is
  // replaced by a file after the dialog has read it, so the save's mkdir fails.
  test('a refused preset save is reported and the form keeps what was typed; once the folder is back, the retry saves (T-135 (8))', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('preset-refused')
    const { app, window, userDataDir } = studio
    try {
      const presetsDir = path.join(userDataDir, 'export-presets')
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible({ timeout: 15_000 })
      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      await nameInput.fill('Refused once')
      // The folder (the dialog's own read made it) is replaced by a file: the save cannot make it.
      rmSync(presetsDir, { recursive: true, force: true })
      writeFileSync(presetsDir, 'not a folder', 'utf8')
      await modal.getByRole('button', { name: '+ Save preset' }).click()
      await expectToast(window, "Couldn't save that preset.")
      await expect(nameInput, 'the name is still in the box').toHaveValue('Refused once')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      expect((await readToastLog(window)).some((t) => t.includes('Saved "Refused once"')), 'no success was claimed').toBe(false)
      // The folder comes back; the same form saves.
      rmSync(presetsDir, { force: true })
      await modal.getByRole('button', { name: '+ Save preset' }).click()
      await expect(modal.getByText('Saved presets (1)')).toBeVisible({ timeout: 15_000 })
      await expect(nameInput, 'a preset that was saved empties the box').toHaveValue('')
      await expectToast(window, 'Saved "Refused once"')
    } finally {
      await app.close()
    }
  })

  test('saves, lists, queues and deletes a custom preset — and refuses the invalid ones by name', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('presets')
    const { app, window, userDataDir } = studio
    try {
      // Installed before the first delete click: an unhandled confirm is
      // auto-dismissed by Playwright and the accept branch would be lost.
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })

      const presetsDir = path.join(userDataDir, 'export-presets')
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Custom export presets' }).last()).toBeVisible()
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      await expect(modal.getByText('No custom presets yet.')).toBeVisible()

      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      const save = modal.getByRole('button', { name: '+ Save preset' })
      const numbers = modal.getByRole('spinbutton')

      // ── negative 1: no name ──
      await save.click()
      await expectToast(window, 'Give it a name')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      // Whitespace is not a name either.
      await nameInput.fill('   ')
      await save.click()
      expect((await readToastLog(window)).filter((t) => t.includes('Give it a name'))).toHaveLength(
        2
      )

      // ── negative 2: sub-64 width ──
      await nameInput.fill('Discord 1080p')
      await numbers.nth(0).fill('32')
      await save.click()
      await expectToast(window, 'Width / height must be at least 64')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      expect(existsSync(presetsDir) ? readdirSync(presetsDir) : []).toEqual([])

      // ── the base select loads that platform's whole encode: its geometry, its frame rate and its two bitrates (T-132 (7)) ──
      // The form opens at YouTube's 30 fps / 8M / 192k; YouTube 1080p60 is the row the ledger sentence is about: it starts at 60 and 12M.
      await expect(numbers.nth(2)).toHaveValue('30')
      await modal.locator('select').selectOption('youtube60')
      await expect(numbers.nth(0)).toHaveValue('1920')
      await expect(numbers.nth(1)).toHaveValue('1080')
      await expect(numbers.nth(2), 'a preset based on YouTube 1080p60 starts at 60 fps').toHaveValue('60')
      await expect(modal.locator('input[type="text"]').nth(1), 'and at its 12M').toHaveValue('12M')
      await expect(modal.locator('input[type="text"]').nth(2)).toHaveValue('192k')
      await modal.locator('select').selectOption('reels')
      await expect(numbers.nth(0)).toHaveValue('1080')
      await expect(numbers.nth(1)).toHaveValue('1920')
      await expect(numbers.nth(2), 'Reels is back to 30 fps').toHaveValue('30')
      await expect(modal.locator('input[type="text"]').nth(1), 'and its own 6M').toHaveValue('6M')
      await expect(modal.locator('input[type="text"]').nth(2), 'and 128k').toHaveValue('128k')

      // ── negative 3 (T-50): a bitrate ffmpeg cannot parse ──
      // Presets are export targets now, so one that could never encode must
      // not reach disk — the same "a saved preset promises it can be used"
      // ruling the rest of T-50 rests on.
      await numbers.nth(0).fill('1280')
      await numbers.nth(1).fill('720')
      await numbers.nth(2).fill('60')
      await modal.locator('input[type="text"]').nth(1).fill('8 Mbps')
      await save.click()
      await expectToast(window, 'Video bitrate needs a number and a unit, like 8M or 8000k.')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      expect(existsSync(presetsDir) ? readdirSync(presetsDir) : []).toEqual([])
      // The audio field is checked too, not just the video one.
      await modal.locator('input[type="text"]').nth(1).fill('5M')
      await modal.locator('input[type="text"]').nth(2).fill('loud')
      await save.click()
      expect(
        (await readToastLog(window)).filter((t) =>
          t.includes('Audio bitrate needs a number and a unit, like 192k or 128k.')
        )
      ).toHaveLength(1)
      expect(existsSync(presetsDir) ? readdirSync(presetsDir) : []).toEqual([])

      // ── save ──
      await modal.locator('input[type="text"]').nth(2).fill('256k')
      await save.click()
      await expectToast(window, 'Saved "Discord 1080p"')
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Discord 1080p')
      await expect(modal.locator('li')).toContainText('1280×720 · 60 fps · 5 Mbps · Reels')
      // The form clears its name so the next save is not a silent duplicate.
      await expect(nameInput).toHaveValue('')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-08-presets.png') })

      // ── it reached disk, in the shape the parser expects ──
      const files = readdirSync(presetsDir)
      expect(files).toHaveLength(1)
      const onDisk = JSON.parse(
        readFileSync(path.join(presetsDir, files[0] as string), 'utf8')
      ) as Record<string, unknown>
      expect(onDisk).toMatchObject({
        name: 'Discord 1080p',
        width: 1280,
        height: 720,
        fps: 60,
        videoBitrate: '5M',
        audioBitrate: '256k',
        basePlatformId: 'reels'
      })

      // ── the footer says what the presets DO, not that they do nothing ──
      // The pre-T-50 copy admitted the dead end ("scaffold metadata only —
      // exports use the base platform's encoder settings"). Pinned in both
      // directions so the promise cannot quietly regress.
      await expect(modal).toContainText(
        'Saved presets join the platform presets in the Export panel — check one to export a clip at its own size and bitrate.'
      )
      await expect(modal.getByText(/scaffold metadata only/)).toHaveCount(0)

      // T-50 (was FINDING-4): a saved custom preset IS an export target now.
      // It joins the five platform checkboxes in the per-clip grid, carrying
      // its own name, its stored geometry and a "custom" tag — the same
      // checkbox, one more row. Pinned in both directions: the count went
      // 6 -> 7 (T-130: the six built-in cards, YouTube 1080p60 among them), and the entry that used to be absent is present.
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      const card = exportCard(window)
      await expect(card.getByRole('checkbox')).toHaveCount(7)
      const customTile = card.locator('label').filter({ hasText: 'Discord 1080p' })
      await expect(customTile).toHaveCount(1)
      await expect(customTile).toContainText('Custom')
      // The geometry and the preset's OWN frame rate (60, not the platform's
      // 30) are the checkbox's description (T-92), not part of its name.
      await expect(presetBox(window, 'Discord 1080p')).toHaveAccessibleDescription(
        /1280×720 · 60 fps/
      )
      // No platform tile wears the tag — it is what separates the groups.
      await expect(card.locator('label').filter({ hasText: /^YouTube$/ })).not.toContainText(
        'Custom'
      )

      // ── and it is a live checkbox: the export count follows it ──
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()
      await presetBox(window, 'Discord 1080p').check()
      await expect(presetBox(window, 'Discord 1080p')).toBeChecked()
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled()

      // ── delete, both branches — with the preset QUEUED on a clip ──
      await card.getByRole('button', { name: 'Presets' }).click()
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      await modal.getByRole('button', { name: 'Delete' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe('Delete preset "Discord 1080p"?')
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      expect(readdirSync(presetsDir)).toHaveLength(1)
      // Dismissed: nothing was unqueued either.
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(presetBox(window, 'Discord 1080p')).toBeChecked()
      await card.getByRole('button', { name: 'Presets' }).click()

      answer = 'accept'
      await modal.getByRole('button', { name: 'Delete' }).click()
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      await expect(modal.getByText('No custom presets yet.')).toBeVisible()
      expect(readdirSync(presetsDir)).toEqual([])
      expect(messages).toEqual([
        'Delete preset "Discord 1080p"?',
        'Delete preset "Discord 1080p"?'
      ])

      // T-50: deleting a preset a clip had QUEUED degrades safely. The row
      // is gone from the grid rather than lingering as a ghost, the export
      // count drops back to the platform presets alone, and the studio is
      // still alive and interactive (no crash boundary, no dead panel).
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByRole('checkbox')).toHaveCount(6)
      await expect(card.getByText('Discord 1080p')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible()
      // The surviving platform checkbox still toggles, so the grid was
      // re-rendered rather than left in a broken half-state.
      await presetBox(window, 'YouTube').uncheck()
      await expect(card.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
      await presetBox(window, 'YouTube').check()
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()
      await card.getByRole('button', { name: 'Presets' }).click()

      // ── the modal's own exits ──
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      await expect(window.getByRole('dialog')).toBeVisible()
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

// ═════════════════════════════ ClipKit (4p) ════════════════════════════════

/** The Clip Kit button, pinned by the one attribute that never changes. */
function kitButton(window: Page): Locator {
  return clipListCard(window).getByTitle(
    'Export this clip for all 5 platforms + 3 thumbnails into one folder'
  )
}

/** The kit button while the platform exports run (T-112: the version in progress, out of five). */
const EXPORTING_N_OF_5 = /^Exporting platform version [1-5] of 5…$/

/** `makeKitDir` stamps the folder with today's date - the person's, on their clock (T-117), not UTC's. */
function kitStamp(): string {
  return localDay().replace(/-/g, '')
}

test.describe('ClipKit', () => {
  test('one click produces the whole kit — five platform MP4s and three thumbnails in one folder', async () => {
    test.setTimeout(600_000)
    // T-117: on a clock whose day is NOT the UTC day (see skewedClock.ts), so the folder's date can only
    // come out right if it is stamped from the person's clock. In UTC the two readings are the same and
    // this case would pass on the old code.
    const restoreClock = skewTimeZone()
    expect(localDay(), 'the skewed clock is on another day than UTC').not.toBe(utcDay())
    const studio = await launchWithVideo('kit').catch((err: unknown) => {
      restoreClock()
      throw err
    })
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      // Located by its (stable) title, not its name: the button's label IS
      // its progress readout, so a name-based locator stops matching the
      // moment the kit starts — exactly the state under test.
      const kit = kitButton(window)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)')
      // T-113: the label IS the progress readout, so a screen reader is told when it changes.
      await expect(kit).toHaveAttribute('aria-live', 'polite')

      // ── no safe-zone question (T-85) ──
      // The kit IS "all five platforms": picking it already answered the
      // question the safe-zone modal asks, and every platform's centered cut
      // is made on purpose (T-83). The old kit raised that modal on every
      // run, on a 4:3-ish source and on every other, so a user clicked
      // through the same warning each time. The click goes straight to the
      // run; there is no dialog to answer.
      await kit.click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // ── the run: the button becomes its own progress readout ──
      // T-112: the label counts, so it is a number of five, not one fixed sentence.
      await expect(kit).toHaveText(EXPORTING_N_OF_5, { timeout: 30_000 })

      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      await expect
        .poll(() => (existsSync(kitDir) ? readdirSync(kitDir).sort() : []), {
          timeout: 540_000,
          intervals: [1000]
        })
        .toEqual([
          'Clip_1_facebook.mp4',
          'Clip_1_reels.mp4',
          'Clip_1_thumb_1.jpg',
          'Clip_1_thumb_2.jpg',
          'Clip_1_thumb_3.jpg',
          'Clip_1_tiktok.mp4',
          'Clip_1_twitter.mp4',
          'Clip_1_youtube.mp4'
        ])
      await expectToast(window, 'Saved your Clip Kit')
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 30_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-09-clipkit.png') })

      // ── the bytes: each slot carries its platform's geometry ──
      const yt = videoStream(await ffprobeJson(path.join(kitDir, 'Clip_1_youtube.mp4')))
      expect(yt.width).toBe(1920)
      expect(yt.height).toBe(1080)
      const reels = videoStream(await ffprobeJson(path.join(kitDir, 'Clip_1_reels.mp4')))
      expect(reels.width).toBe(1080)
      expect(reels.height).toBe(1920)
      const thumb = await ffprobeJson(path.join(kitDir, 'Clip_1_thumb_2.jpg'))
      expect(videoStream(thumb).codec_name).toBe('mjpeg')
      expect(videoStream(thumb).width).toBe(CLIP_WIDTH)

      // ── the parent folder is remembered for the next kit ──
      await expect
        .poll(() => (readConfig(userDataDir).clipKit as { lastOutputDir?: string })?.lastOutputDir, {
          timeout: 15_000
        })
        .toBe(outDir)
    } finally {
      await app.close()
      restoreClock()
    }
  })

  // T-122 (3): the rename field accepts an empty name, and the kit handed the RAW name to `video:makeKitDir`, whose
  // hard `assertNonEmptyString` refused it: the kit failed AFTER the folder was picked, with the bare "Clip Kit
  // failed.". The sanitized name ('clip' for a blank one, the same fallback the file names already use) is what
  // the folder and every file derive from now, and it is what main is asked to make the folder for. Main keeps its
  // gates - they are trust-boundary validation.
  test('a Clip Kit on a clip whose name was cleared still runs: the folder and the files are named "clip" (T-122)', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('kitblank')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      const card = clipListCard(window)
      const rename = card.getByRole('textbox', { name: /^Rename clip/ })
      await rename.fill('')
      await expect(rename).toHaveValue('')

      const kit = kitButton(window)
      await kit.click()
      // One of two outcomes ends the wait, so a refusal fails fast (and says what it said) instead of after the
      // whole poll: the kit's own success toast, or its failure one.
      const outcome = async (): Promise<string> => {
        const log = await readToastLog(window)
        if (log.some((t) => t.includes('Saved your Clip Kit'))) return 'saved'
        return log.find((t) => t.includes('Clip Kit failed')) ?? 'running'
      }
      await expect.poll(outcome, { timeout: 540_000, intervals: [1000] }).not.toBe('running')
      expect(await outcome(), 'a kit asked for on a blank-named clip').toBe('saved')

      const kitDir = path.join(outDir, `clip-kit-${kitStamp()}`)
      expect(readdirSync(kitDir).sort()).toEqual([
        'clip_facebook.mp4',
        'clip_reels.mp4',
        'clip_thumb_1.jpg',
        'clip_thumb_2.jpg',
        'clip_thumb_3.jpg',
        'clip_tiktok.mp4',
        'clip_twitter.mp4',
        'clip_youtube.mp4'
      ])
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 30_000 })
      // The reveal selects the first file of the kit, in the folder the kit made.
      await expect
        .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
        .toEqual([path.join(kitDir, 'clip_youtube.mp4')])
    } finally {
      await app.close()
    }
  })

  // T-120 (11): the kit wrote `clipKit.lastOutputDir` after every run and never read it back, so it asked for a
  // folder from scratch on every press while Export remembers its own. The chooser now opens on that folder
  // (its `defaultPath`). The OS chooser is native and stubbed in main; what it was opened WITH is the evidence.
  test('the Clip Kit chooser opens on the folder the last kit went to, and a stale setting is ignored (T-120)', async () => {
    test.setTimeout(120_000)
    const remembered = path.join(root, `kit-parent-${Date.now().toString(36)}`)
    mkdirSync(remembered, { recursive: true })
    const studio = await launchWithVideo('kitdefault', clipSrc, { clipKit: { lastOutputDir: remembered } })
    const { app, window } = studio
    try {
      // Cancel every chooser, and keep the options each was opened with.
      await app.evaluate(({ dialog }) => {
        const g = globalThis as unknown as { __chooserOptions: Array<Record<string, unknown>> }
        g.__chooserOptions = []
        ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async (
          _win: unknown,
          options: Record<string, unknown>
        ) => {
          g.__chooserOptions.push(options)
          return { canceled: true, filePaths: [] }
        }
      })
      const opened = (): Promise<Array<string | undefined>> =>
        app.evaluate(() =>
          (globalThis as unknown as { __chooserOptions: Array<{ defaultPath?: string }> }).__chooserOptions.map(
            (o) => o.defaultPath
          )
        )
      const kit = kitButton(window)
      const press = async (expectedChoosers: number): Promise<void> => {
        await kit.click()
        await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(expectedChoosers)
        // A chooser that is canceled starts nothing and says nothing.
        await expect(kit).toHaveText('Clip Kit (5 + thumbs)')
      }

      // The remembered folder is where the chooser opens.
      await press(1)
      expect((await opened())[0]).toBe(remembered)

      // A saved value that is not a usable absolute path is ignored, not refused: the chooser opens where it
      // always did, and the kit is not stopped by a stale setting.
      await window.evaluate(() => window.api.settings.set('clipKit.lastOutputDir', 'relative/kits'))
      await press(2)
      expect((await opened())[1]).toBeUndefined()

      // Cleared (a fresh install, or a setting that was removed): the same.
      await window.evaluate(() => window.api.settings.set('clipKit.lastOutputDir', undefined))
      await press(3)
      expect((await opened())[2]).toBeUndefined()

      // And a folder written back is used again on the next press.
      await window.evaluate((dir) => window.api.settings.set('clipKit.lastOutputDir', dir), remembered)
      await press(4)
      expect((await opened())[3]).toBe(remembered)
      // Nothing after the import's own toast: a canceled chooser says nothing.
      expect(await readToastLog(window), 'a canceled chooser says nothing').toEqual(['Video loaded'])
    } finally {
      await app.close()
    }
  })

  test('a second kit of the same clip on the same day lands in its own folder, and the first kit is untouched (T-106)', async () => {
    test.setTimeout(600_000)
    // The folder is named for the clip and the DAY, so the second kit of the day
    // wrote into the first one's folder and replaced every same-named file in it —
    // the five videos, the three thumbnails and the captions at once. A kit is a
    // set, so the folder is the unit that is kept apart.
    const { app, window, outDir } = await launchWithVideo('t106kit')
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      const kit = kitButton(window)
      const first = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      const second = `${first} (2)`
      const FILES = [
        'Clip_1_facebook.mp4',
        'Clip_1_reels.mp4',
        'Clip_1_thumb_1.jpg',
        'Clip_1_thumb_2.jpg',
        'Clip_1_thumb_3.jpg',
        'Clip_1_tiktok.mp4',
        'Clip_1_twitter.mp4',
        'Clip_1_youtube.mp4'
      ]
      const listing = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : [])

      await kit.click()
      await expect.poll(() => listing(first), { timeout: 540_000, intervals: [1000] }).toEqual(FILES)
      await expectToast(window, 'Saved your Clip Kit')
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 30_000 })
      const shas = FILES.map((f) => sha256(path.join(first, f)))
      expect(existsSync(second)).toBe(false)

      // Change the clip so the second kit's files would differ if they replaced the first's.
      await clipListCard(window).getByRole('slider', { name: 'Clip playback speed' }).fill('2')
      await stubShellReveal(app)
      await kit.click()
      await expect.poll(() => listing(second), { timeout: 540_000, intervals: [1000] }).toEqual(FILES)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      // The first folder is exactly what it was...
      expect(listing(first)).toEqual(FILES)
      expect(FILES.map((f) => sha256(path.join(first, f)))).toEqual(shas)
      // ...and the second kit's reveal opened the second kit's folder.
      await expect
        .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
        .toEqual([path.join(second, 'Clip_1_youtube.mp4')])
    } finally {
      await app.close()
    }
  })

  test('cancelling a kit asks first, and Cancel jobs stops it before the thumbnails', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('kitcancel')
    const { app, window, outDir } = studio
    try {
      // The first chooser is dismissed (null), the second answers. A kit with
      // no folder starts nothing: no job, no folder, no toast — and no
      // safe-zone question stands between the click and the chooser (T-85).
      await stubDialogs(app, { open: [null, outDir] })
      const kit = kitButton(window)

      await kit.click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)')
      expect(readdirSync(outDir)).toEqual([])

      // T-112: an EMPTY kit folder is removed when the kit is canceled, so this test (about the
      // confirm, and about a folder that holds a file) holds job 2's probe: job 1 has landed
      // by the time the label says "2 of 5", and the cancel finds a folder worth keeping.
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 20_000 }])
      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })

      // ── the confirm, in the kit's own words ──
      const cancelButton = clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      await cancelButton.click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Cancel Clip Kit' }).last()).toBeVisible()
      await expect(
        modal.getByText('Cancel the Clip Kit batch (5 exports + thumbnails)?')
      ).toBeVisible()

      // ── Keep running: the batch survives the near miss ──
      await modal.getByRole('button', { name: 'Keep running' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(kit).toHaveText(EXPORTING_N_OF_5)

      // ── Cancel jobs: the running ffmpeg is killed and the kit unwinds ──
      await cancelButton.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        'Clip Kit canceled. Files already finished are in your folder.'
      )
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      await expect(
        clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      ).toHaveCount(0)

      // The kit folder was created, and the run stopped inside the export
      // phase: one MP4 and not a single thumbnail. The three extractFrame
      // passes never spawned, so nothing leaked past the kill.
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      expect(existsSync(kitDir)).toBe(true)
      const left = readdirSync(kitDir)
      expect(left.filter((f) => f.endsWith('.mp4'))).toHaveLength(1)
      expect(left.filter((f) => f.endsWith('.jpg'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('Cancel during the thumbnails reaches them: the kit stops before they are written (T-98)', async () => {
    test.setTimeout(600_000)
    // Clip Kit's Cancel only ever reached the export batch: `video:cancelAll`
    // killed live export children and the three thumbnail extracts — the last
    // few seconds of every kit — were beyond it, so a Cancel there was a click
    // that did nothing and the kit finished under a "canceled" button. The
    // first extract is held for 20 s so the click lands in it.
    const studio = await launchWithVideo('kitframes')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await installSpawnStall(app, [{ match: 'frame', nth: 1, ms: 20_000 }])
      const kit = kitButton(window)
      await kit.click()
      await expect(kit).toHaveText('Extracting thumbnail 1 of 3…', { timeout: 540_000 })
      await expect
        .poll(async () => (await readSpawnLog(app)).filter((k) => k === 'frame').length, {
          timeout: 15_000,
          intervals: [100]
        })
        .toBe(1)

      await clipListCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        'Clip Kit canceled. Files already finished are in your folder.'
      )
      // Freed at once: the 20 s hold was cut short by the kill, not waited out.
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 10_000 })

      // The five exports finished before Cancel and stay; not one thumbnail was written.
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      const left = readdirSync(kitDir)
      expect(left.filter((f) => f.endsWith('.mp4'))).toHaveLength(5)
      expect(left.filter((f) => f.endsWith('.jpg'))).toEqual([])
      expect((await readSpawnLog(app)).filter((k) => k === 'frame')).toHaveLength(1)
      expect((await readToastLog(window)).join(' | ')).not.toContain('Saved your Clip Kit')
    } finally {
      await app.close()
    }
  })

  test('a Cancel that lands between two thumbnail calls still stops the kit (T-98)', async () => {
    test.setTimeout(600_000)
    // Between two of the kit's calls nothing is running in main, so there is
    // nothing for main to cancel: the kit itself has to remember. The first
    // thumbnail call is replaced in MAIN by one that waits on a gate the test
    // holds, so the click lands while the renderer is mid-sequence; the gate is
    // then opened and the kit must not go on to the second call.
    const studio = await launchWithVideo('kitgap')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as {
          __frames: { calls: number; release: () => void; gate: Promise<void> }
        }
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        g.__frames = { calls: 0, release, gate }
        ipcMain.removeHandler('video:extractFrame')
        ipcMain.handle('video:extractFrame', async (_e, params: { outputPath: string }) => {
          g.__frames.calls += 1
          await g.__frames.gate
          return { outputPath: params.outputPath }
        })
      })
      const calls = (): Promise<number> =>
        app.evaluate(() => (globalThis as unknown as { __frames: { calls: number } }).__frames.calls)

      const kit = kitButton(window)
      await kit.click()
      await expect(kit).toHaveText('Extracting thumbnail 1 of 3…', { timeout: 540_000 })
      await expect.poll(calls, { timeout: 15_000, intervals: [100] }).toBe(1)

      await clipListCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      // main had nothing running to cancel; now let the in-flight call return.
      await window.waitForTimeout(500)
      await app.evaluate(() =>
        (globalThis as unknown as { __frames: { release: () => void } }).__frames.release()
      )

      await expectCanceledNotFailed(
        window,
        'Clip Kit canceled. Files already finished are in your folder.'
      )
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 10_000 })
      // The second and third calls were never made.
      await window.waitForTimeout(1500)
      expect(await calls()).toBe(1)
      expect((await readToastLog(window)).join(' | ')).not.toContain('Saved your Clip Kit')
    } finally {
      await app.close()
    }
  })

  test('captions that cannot come along say so in plain words, and the rest of the kit is saved (T-100)', async () => {
    test.setTimeout(600_000)
    // The SRT the project remembers is gone (the captions folder was cleaned).
    // Main answers writeKitSrt with a fragment written for a log; the toast used
    // to print it in brackets: "SRT not bundled (source SRT not found)".
    const studio = await launchHome('kitsrt')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'gone.srt') // never created
      const projectPath = path.join(root, `kitsrt-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            clips: [],
            selectedClipId: null,
            watermark: null,
            srtPath
          }
        }),
        'utf8'
      )
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })

      await kitButton(window).click()
      await expectToast(window, 'Saved your Clip Kit')
      const toasts = await readToastLog(window)
      expect(toasts).toContain("Couldn't include captions in the kit.")
      expect(toasts.join(' | ')).not.toMatch(/SRT not bundled|source SRT|not found/)
      // The captions notice is a heads-up, not a failure: the rest is saved.
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      expect(readdirSync(kitDir).filter((f) => f.endsWith('.mp4'))).toHaveLength(5)
      expect(readdirSync(kitDir).filter((f) => f.endsWith('.srt'))).toEqual([])
      // The fragment went where a bug report can find it.
      expect(consoleLines.join('\n')).toMatch(/source SRT not found/)
    } finally {
      await app.close()
    }
  })

  test('a clip over a platform\'s typical limit asks once before the kit starts, names that platform, and both answers are honoured (T-85)', async () => {
    test.setTimeout(600_000)
    // The 36-minute source: Clip 1 spans all of it, which is past Reels'
    // typical 20-minute limit (T-112: it was 3 minutes, which is only where Instagram
    // stops recommending a Reel) and inside every other platform's.
    const studio = await launchWithVideo('kitlong', kitLongSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const kit = kitButton(window)

      await kit.click()
      const modal = window.getByRole('dialog')
      await expect(
        modal.getByRole('heading', { name: 'This clip is long for some platforms' }).last()
      ).toBeVisible()
      await expect(modal).toContainText(/This clip is 36:0\d\./)
      // Exactly the platform that is over — not the four that are not.
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Reels')
      await expect(modal.locator('li')).toContainText('the typical 20-minute limit')
      // It is advice, never a fact: nothing says an upload would be refused.
      await expect(modal).not.toContainText(/rejected|refuse|not allowed|will fail/i)

      // ── declined: nothing starts and the folder is never even asked for ──
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)')
      expect(readdirSync(outDir)).toEqual([])

      // ── accepted: the kit runs. One question, asked once — no safe-zone
      //    modal follows it (T-85). ──
      await kit.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Export anyway' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      // T-112: the label counts — the first of the five is the one in progress.
      await expect(kit).toHaveText('Exporting platform version 1 of 5…', { timeout: 30_000 })

      // Wind it down: the point was the question, not a 36-minute encode.
      const cancelButton = clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      await cancelButton.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        // T-113: nothing had finished, so the folder is gone and the toast does not point at it.
        'Clip Kit canceled.'
      )
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
    } finally {
      await app.close()
    }
  })

  test('the long-clip question quotes the length of the file: a 2x clip is not asked about a limit its file is under (T-97)', async () => {
    test.setTimeout(600_000)
    // kitLongSrc: 36 minutes, so Clip 1 is 36:00 at 1x (past Reels' typical 20 minutes) and
    // 18:00 of file at 2x. The kit compared SOURCE seconds, so it asked about a
    // limit the file was well inside.
    const studio = await launchWithVideo('kitspeed', kitLongSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const kit = kitButton(window)

      // ── 1x: the question names Reels, and quotes the file's length ──
      await kit.click()
      const modal = window.getByRole('dialog')
      await expect(modal).toContainText(/This clip is 36:0\d\./)
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Reels')
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // ── 2x: 18:00 of file, inside Reels' limit: no question, the kit starts ──
      await window.getByRole('slider', { name: 'Clip playback speed' }).fill('2')
      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 1 of 5…', { timeout: 30_000 })
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // Wind it down: the point was that nothing was asked.
      await clipListCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        // T-113: nothing had finished, so the folder is gone and the toast does not point at it.
        'Clip Kit canceled.'
      )
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
    } finally {
      await app.close()
    }
  })

  test('the kit stamps the SAVED watermark on every platform file (T-85)', async () => {
    test.setTimeout(600_000)
    // The handle and corner an earlier Export saved. The kit passed
    // `watermark: null` and never read them, so a user who had set up a
    // watermark got an unmarked kit while the Export panel next door stamped
    // the same clip.
    const studio = await launchWithVideo('kitwatermark', clipSrc, {
      streamerHandle: '@kit_e2e',
      watermarkPosition: 'top-left'
    })
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const kit = kitButton(window)
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      await kit.click()

      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      if (process.platform === 'win32') {
        // The shipping platform: five watermarked files render for real.
        await expect
          .poll(() => (existsSync(kitDir) ? readdirSync(kitDir).filter((f) => f.endsWith('.mp4')).length : 0), {
            timeout: 540_000,
            intervals: [500]
          })
          .toBe(5)
        await expectToast(window, 'Saved your Clip Kit')
      } else {
        // PLATFORM PIN, same as the Export panel's watermark test: the bundled
        // Linux ffmpeg has no `drawtext`, so a kit that really carries the
        // watermark dies at graph init. The old kit finished with 'Clip kit
        // ready' because it carried none. The toast is a plain sentence; the
        // raw words are in the console, and they name the filter (T-84).
        await expectToast(window, 'Clip Kit failed.')
        expect((await readToastLog(window)).join(' | ')).not.toMatch(/drawtext|FFmpeg exit/)
        await expect
          .poll(() => consoleLines.join('\n'), { timeout: 30_000 })
          .toContain("No such filter: 'drawtext'")
        expect(
          existsSync(kitDir) ? readdirSync(kitDir).filter((f) => f.endsWith('.mp4')) : []
        ).toEqual([])
      }
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      // Reading the saved watermark does not rewrite it.
      const config = readConfig(userDataDir)
      expect(config.streamerHandle).toBe('@kit_e2e')
      expect(config.watermarkPosition).toBe('top-left')
    } finally {
      await app.close()
    }
  })

  test('a blank export forgets the saved watermark, and the kit stamps nothing after it (T-119)', async () => {
    test.setTimeout(600_000)
    // The guide: Clip Kit "stamps the watermark you last exported with". The Export panel wrote the handle and
    // the corner only when it had a handle, so a person who cleared the field to stop stamping and exported
    // still got the old handle on every kit file. The case above is the control: with a saved handle the kit
    // dies on this platform's drawtext-less ffmpeg, so a kit that SUCCEEDS here stamped nothing.
    const studio = await launchWithVideo('kitblank', clipSrc, {
      streamerHandle: '@was_saved',
      watermarkPosition: 'top-left'
    })
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir, outDir] })
      const card = exportCard(window)
      const handle = card.getByPlaceholder('@yourhandle (leave blank for none)')
      // The saved handle came back into the field; emptying it is the person saying "no watermark".
      await expect(handle).toHaveValue('@was_saved', { timeout: 30_000 })
      await handle.fill('')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export 1' }).click()
      await expect
        .poll(() => mp4sIn(outDir).length, { timeout: 120_000, intervals: [500] })
        .toBe(1)
      await expectToast(window, 'Exported 1 file')
      // Both keys are gone from the file: forgotten, not blanked.
      await expect
        .poll(() => 'streamerHandle' in readConfig(userDataDir), { timeout: 15_000 })
        .toBe(false)
      expect('watermarkPosition' in readConfig(userDataDir)).toBe(false)

      // The kit, made from the same clip: nothing to stamp, so the five files land.
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))
      const kit = kitButton(window)
      await kit.click()
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      await expect
        .poll(
          () => (existsSync(kitDir) ? readdirSync(kitDir).filter((f) => f.endsWith('.mp4')).length : 0),
          { timeout: 540_000, intervals: [500] }
        )
        .toBe(5)
      await expectToast(window, 'Saved your Clip Kit')
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      expect(consoleLines.join('\n')).not.toContain("No such filter: 'drawtext'")
      // Running the kit did not bring the watermark back.
      expect('streamerHandle' in readConfig(userDataDir)).toBe(false)
      expect('watermarkPosition' in readConfig(userDataDir)).toBe(false)
    } finally {
      await app.close()
    }
  })
})

// ═════════════════════════════ PipPanel (4n) ═══════════════════════════════

test.describe('PipPanel', () => {
  test('picks both inputs, composites them for real, and cancels a long one', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('pip')
    const { app, window, outDir } = studio
    try {
      const card = pipCard(window)
      // Three choosers in a row, then a fourth for the cancel case — the
      // queue is why stubDialogs takes a list.
      await stubDialogs(app, { open: [clipSrc, pipSrc, outDir, longSrc] })
      await stubShellReveal(app)

      // ── negative first: no inputs, no job ──
      await expect(card.getByRole('button', { name: 'Base: none' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Overlay: none' })).toBeVisible()
      await card.getByRole('button', { name: 'Composite' }).click()
      await expectToast(window, 'Pick both files')
      expect(mp4sIn(outDir)).toEqual([])

      // ── the two file pickers ──
      await card.getByRole('button', { name: 'Base: none' }).click()
      await expect(
        card.getByRole('button', { name: `Base: ${path.basename(clipSrc)}` })
      ).toBeVisible()
      await card.getByRole('button', { name: 'Overlay: none' }).click()
      await expect(
        card.getByRole('button', { name: `Overlay: ${path.basename(pipSrc)}` })
      ).toBeVisible()

      // ── the three geometry controls ──
      const numbers = card.getByRole('spinbutton')
      await expect(numbers.nth(0)).toHaveValue('360')
      await numbers.nth(0).fill('120')
      await expect(numbers.nth(1)).toHaveValue('32')
      await numbers.nth(1).fill('8')
      const position = card.locator('select')
      await expect(position).toHaveValue('bottom-right')
      // T-92: corners are spelled out ("Top L" / "Bot R" were the labels), and
      // the two number fields name their unit.
      await expect(position.locator('option')).toHaveText([
        'Top left',
        'Top right',
        'Bottom left',
        'Bottom right'
      ])
      await expect(card.getByText('Overlay width (px)')).toBeVisible()
      await expect(card.getByText('Margin (px)')).toBeVisible()
      await position.selectOption('top-left')
      await expect(position).toHaveValue('top-left')

      // ── output dir, then a real composite ──
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await expect(card.getByRole('button', { name: path.basename(outDir) })).toBeVisible()
      await card.getByRole('button', { name: 'Composite' }).click()

      const composite = path.join(outDir, 'pipeline_pip.mp4')
      await expect
        .poll(() => existsSync(composite), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      // T-112: the toast names the file it wrote.
      await expectToast(window, `Saved ${path.basename(composite)}`)
      await expectRevealToast(window, app, composite)
      // The base's geometry survives; the overlay is scaled into it.
      const v = videoStream(await ffprobeJson(composite))
      expect(v.width).toBe(CLIP_WIDTH)
      expect(v.height).toBe(CLIP_HEIGHT)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-10-pip.png') })

      // ── cancel: swap the base for the 20-minute source so the job is
      //    still running when Cancel is clicked ──
      await card.getByRole('button', { name: `Base: ${path.basename(clipSrc)}` }).click()
      await expect(
        card.getByRole('button', { name: `Base: ${path.basename(longSrc)}` })
      ).toBeVisible()
      await card.getByRole('button', { name: 'Composite' }).click()
      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible({ timeout: 30_000 })
      await cancel.click()
      // cancelPip -> cancelConcatJob -> SIGKILL. The kill is marked in main,
      // so the non-zero exit it causes arrives as a cancel (T-84), not as
      // "pip exit 1" in a red toast.
      await expectCanceledNotFailed(window, 'Picture-in-picture canceled.')
      await expect(card.getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the overlay width takes typed digits: 600 is 600, not 360600, and what leaves the box is inside the range (T-123 (4))', async () => {
    // The box turned an emptied value into 360 on the spot (`Number(typed) || 360`), so the digits typed next appended to it:
    // "600" was 360600, and the composite failed upstream with a bare "Picture-in-picture failed.". `fill` replaces the value in
    // one step and never saw it.
    test.setTimeout(120_000)
    const studio = await launchWithVideo('pip-width')
    const { app, window } = studio
    try {
      const card = pipCard(window)
      const width = card.getByLabel('Overlay width (px)')
      await expect(width).toHaveValue('360')

      await width.click()
      await width.press('Control+a')
      await width.press('Backspace')
      await expect(width, 'emptied: nothing snaps back into it').toHaveValue('')
      await width.press('6')
      await expect(width, 'a prefix on its way into range is shown as typed').toHaveValue('6')
      await width.press('0')
      await width.press('0')
      await expect(width).toHaveValue('600')
      await leave(width)
      await expect(width).toHaveValue('600')

      // The range is the box's own (120 to 960): past it, the nearest edge once typing ends.
      await retype(width, '5000')
      await leave(width)
      await expect(width).toHaveValue('960')
      await retype(width, '7')
      await leave(width)
      await expect(width).toHaveValue('120')
      // An emptied or non-numeric box changes nothing: it shows what it had.
      await width.click()
      await width.press('Control+a')
      await width.press('Backspace')
      await leave(width)
      await expect(width).toHaveValue('120')

      // Enter commits too.
      await retype(width, '480')
      await width.press('Enter')
      await expect(width).toHaveValue('480')
    } finally {
      await app.close()
    }
  })
})

// ═════════════ the five output-folder buttons (T-123 (8)) ═════════════

test.describe('output-folder buttons', () => {
  test('each of the five says what it is to a screen reader, "Output folder: <name>", not just the folder\'s name', async () => {
    // The chip rendered an icon and the folder's basename, so its accessible name was "Videos": a button called Videos, with
    // nothing to say it picks where the file goes. The empty state ("Choose folder…") is its own sentence and stays.
    test.setTimeout(120_000)
    const studio = await launchWithVideo('outdir-names')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const name = `Output folder: ${path.basename(outDir)}`
      const panels: Array<[string, Locator]> = [
        ['Export', exportCard(window)],
        ['Reframe to 9:16', reframeCard(window)],
        ['GIF', gifCard(window)],
        ['Compile', compileCard(window)],
        ['Picture-in-picture', pipCard(window)]
      ]
      for (const [label, card] of panels) {
        const choose = card.getByRole('button', { name: 'Choose folder…' })
        // T-125 (10): Reframe, GIF, Compile and Picture-in-picture are ONE folder (a pick in one is the others' within the visit), so
        // only the first of them to be asked is still empty; Export keeps its own.
        if (label !== 'Export' && label !== 'Reframe to 9:16') {
          await expect(choose, `${label}: already follows the pick made in Reframe`).toHaveCount(0)
          await expect(card.getByRole('button', { name }), `${label}: shows the shared folder`).toBeVisible()
          await expect(card.getByRole('button', { name })).toHaveAccessibleName(name)
          continue
        }
        await expect(choose, `${label}: the empty state is its own sentence`).toBeVisible()
        await choose.click()
        const chosen = card.getByRole('button', { name })
        await expect(chosen, `${label}: the chosen folder's button is named`).toBeVisible()
        await expect(chosen).toHaveAccessibleName(name)
        // It still shows the folder, and its icon is decoration (no second name).
        await expect(chosen).toContainText(path.basename(outDir))
        await expect(chosen.locator('svg')).toHaveAttribute('aria-hidden', 'true')
        // The prefix is for assistive technology: it is a one-pixel, clipped box, not drawn text.
        const prefix = chosen.locator('.sr-only')
        await expect(prefix).toHaveText('Output folder:')
        const box = await prefix.boundingBox()
        expect(box?.width ?? 99, `${label}: the prefix takes no room`).toBeLessThanOrEqual(1.5)
        expect(box?.height ?? 99).toBeLessThanOrEqual(1.5)
      }
    } finally {
      await app.close()
    }
  })
})

// ══════════════ ReframePanel (4k) · GifPanel (4l) · Compilation (4m) ═══════

test.describe('single-output panels', () => {
  test('reframe: the three positions are real state, and 9:16 comes out square-pixelled', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('reframe')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      const card = reframeCard(window)
      // The header states the transform the panel will perform.
      await expect(card.getByText(`${CLIP_WIDTH}×${CLIP_HEIGHT} → 1080×1920`)).toBeVisible()
      // T-85: and says what it is — a fixed strip, not a tracker.
      // T-126 (14): the title is "Reframe to 9:16" ("(center crop)" was stale the day Left and Right became positions).
      await expect(card.getByRole('heading', { name: 'Reframe to 9:16', exact: true })).toBeVisible()
      await expect(card.getByText('(center crop)')).toHaveCount(0)
      await expect(card.getByText('it does not track faces or action', { exact: false })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Auto (centered)' })).toHaveCount(0)
      await expect(card.getByText('Auto-reframe')).toHaveCount(0)

      // ── the three position buttons: exactly one is active at a time ──
      // T-85: there used to be a fourth, "Auto (centered)", which was Center
      // under another name — and the panel promised an "Auto-reframe" that
      // does not exist. `exact` stays: a label is not a prefix of another.
      const labels = ['Center', 'Left', 'Right']
      const posButton = (label: string): Locator =>
        card.getByRole('button', { name: label, exact: true })
      await expect(posButton('Center')).toHaveClass(/bg-accent/)
      // T-112: and the pressed one SAYS so to a screen reader — three buttons, one choice.
      await expect(posButton('Center')).toHaveAttribute('aria-pressed', 'true')
      await expect(posButton('Left')).toHaveAttribute('aria-pressed', 'false')
      await expect(posButton('Right')).toHaveAttribute('aria-pressed', 'false')
      for (const label of labels) {
        await posButton(label).click()
        await expect(posButton(label)).toHaveClass(/bg-accent/)
        await expect(posButton(label)).toHaveAttribute('aria-pressed', 'true')
        for (const other of labels.filter((l) => l !== label)) {
          await expect(posButton(other)).not.toHaveClass(/bg-accent/)
          await expect(posButton(other)).toHaveAttribute('aria-pressed', 'false')
        }
      }
      // Land on Left so the output filename carries the chosen position.
      await posButton('Left').click()

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()

      const output = path.join(outDir, 'pipeline_Clip 1_reframe-1080x1920-left.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      await expectRevealToast(window, app, output)
      const v = videoStream(await ffprobeJson(output))
      expect(v.width).toBe(1080)
      expect(v.height).toBe(1920)
      // T-12: dimensions alone cannot see a stretched frame — the source's
      // display aspect leaks back through `scale` without `setsar=1`.
      expect(v.sample_aspect_ratio).toBe('1:1')
      expect(v.display_aspect_ratio).toBe('9:16')
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled()

      // ── T-123 (18): the saved toast offers the next step Record's own saved take does, "Edit in Video Studio", through the same
      //    ask-before-replace bridge: opening the 9:16 file REPLACES the video being edited (its clip and edits), so it asks ──
      const asked: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        asked.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })
      const sourceName = path.basename(clipSrc)
      const reframedName = path.basename(output)
      const header = window.locator('header')
      await expect(header.getByText(sourceName, { exact: true })).toBeVisible()
      const editHere = window.locator('[data-rht-toaster]').getByRole('button', { name: 'Edit in Video Studio', exact: true })
      await expect(editHere, 'the saved toast carries the action').toBeVisible()
      await editHere.click()
      await expect.poll(() => asked, { timeout: 10_000 }).toEqual(["Replace the video you're editing? 1 clip and its edits will be discarded."])
      // Declined: the source being reframed is still the open video, with its Reframe panel, and the toast's button is still there.
      await window.waitForTimeout(800)
      await expect(header.getByText(sourceName, { exact: true })).toBeVisible()
      await expect(header.getByText(reframedName, { exact: true })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeVisible()
      await expect(editHere).toBeVisible()
      // Accepted: the 9:16 file replaces it. It is vertical, so there is nothing left to reframe, and the Captions panel
      // (transcribe, then burn in) is on the file that was just written: the captioned-vertical route, in order.
      answer = 'accept'
      await editHere.click()
      await expect(header.getByText(reframedName, { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(header.getByText(sourceName, { exact: true })).toHaveCount(0)
      await expect(reframeCard(window)).toHaveCount(0)
      await expect(captionsCard(window)).toBeVisible()
      expect(asked).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  test('gif: the three selects drive the palette job, and the file is named after them', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('gif')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      const card = gifCard(window)
      const selects = card.locator('select')
      await expect(selects).toHaveCount(3)
      await expect(selects.nth(0)).toHaveValue('480')
      await expect(selects.nth(1)).toHaveValue('15')
      await expect(selects.nth(2)).toHaveValue('1')
      // T-92: the width and the frame rate carry their units.
      await expect(selects.nth(0).locator('option')).toHaveText([
        '240 px',
        '320 px',
        '480 px',
        '640 px',
        '800 px'
      ])
      await expect(selects.nth(1).locator('option')).toHaveText([
        '10 fps',
        '12 fps',
        '15 fps',
        '20 fps',
        '24 fps',
        '30 fps'
      ])
      // A 2 s clip is nowhere near the 10 s warning threshold.
      await expect(card.getByText('GIF exports over about 10 s get huge. Trim the clip first.')).toHaveCount(
        0
      )

      await selects.nth(0).selectOption('320')
      await selects.nth(1).selectOption('12')
      await selects.nth(2).selectOption('2')

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export GIF' }).click()

      // The width and fps the user picked are in the filename, so a job
      // built from stale state would land on a different path.
      const output = path.join(outDir, 'pipeline_Clip 1_320px_12fps.gif')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      await expectRevealToast(window, app, output)
      const probe = await ffprobeJson(output)
      expect(probe.format?.format_name).toContain('gif')
      const v = videoStream(probe)
      expect(v.codec_name).toBe('gif')
      expect(v.width).toBe(320)
      // A GIF carries no container duration, so the decoded frame count is
      // the readable proof of both dials: 12 fps over a 2 s clip at 2x
      // speed is 12 frames, and it would be 30 on the panel's defaults.
      const frames = await ffprobeFrameCount(output)
      expect(frames).toBeGreaterThan(9)
      expect(frames).toBeLessThan(15)
      await expect(card.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('compilation: says what it needs at one clip, works at two, and its output is the sum of their ranges', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('compile')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      // One clip: nothing to compile — but the card is THERE (T-92; it used to
      // vanish, so nobody with one clip learned compiling existed) and says what
      // it is waiting for, with its button disabled.
      const lonely = compileCard(window)
      await expect(lonely).toHaveCount(1)
      await expect(lonely.getByText('Compile clips (1)')).toBeVisible()
      await expect(lonely.getByText('Add a second clip to compile.')).toBeVisible()
      await expect(lonely.getByRole('button', { name: 'Compile 1 clip', exact: true })).toBeDisabled()
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()

      const card = compileCard(window)
      // ...and the note goes with the second clip.
      await expect(card.getByText('Add a second clip to compile.')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
      await expect(card.getByText('Compile clips (2)')).toBeVisible()
      const fade = card.getByRole('slider', { name: 'Fade between clips, in milliseconds' })
      await expect(fade).toHaveValue('300')
      await expect(card.getByText('300 ms', { exact: true })).toBeVisible()
      await fade.fill('600')
      await expect(card.getByText('600 ms', { exact: true })).toBeVisible()
      await expect(fade).toHaveAttribute('aria-valuetext', '600 milliseconds')
      // Back to 0 for the run: with no fades the output duration is exactly
      // the sum of the segments, which is the property under test.
      await fade.fill('0')
      await expect(card.getByText('0 ms', { exact: true })).toBeVisible()

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      // T-94: the button says how many clips it will stitch.
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()

      const output = path.join(outDir, 'pipeline_compilation.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      await expectRevealToast(window, app, output)
      const probe = await ffprobeJson(output)
      const v = videoStream(probe)
      expect(v.width).toBe(1920)
      expect(v.height).toBe(1080)
      // T-130 (q): and at the recording's own rate (this fixture is 15 fps), which the card said before the file was written.
      expect(v.r_frame_rate).toBe('15/1')
      // Two full-length copies of a 2 s clip, normalized to one 1080p file.
      expect(Number(probe.format?.duration)).toBeGreaterThan(2 * CLIP_SECONDS - 0.5)
      expect(Number(probe.format?.duration)).toBeLessThan(2 * CLIP_SECONDS + 0.5)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('gif: the crop drawn for the clip reaches the GIF — a 1:1 crop comes out square without the red block, and clearing it brings the whole frame back (T-96)', async () => {
    test.setTimeout(600_000)
    // cropMarkerSrc: 640x360, a red block at the top-left that a 1:1 crop
    // (324x324, centered) excludes. The GIF took only a start and an end, so it
    // came out 16:9 with the red in it, whatever was drawn in the player.
    const { app, window, outDir } = await launchWithVideo('t96gif', cropMarkerSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = gifCard(window)
      const selects = card.locator('select')
      await selects.nth(0).selectOption('320')
      await card.getByRole('button', { name: 'Choose folder…' }).click()

      // ── cropped: 1:1 at 10 fps ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      await selects.nth(1).selectOption('10')
      await card.getByRole('button', { name: 'Export GIF' }).click()
      const cropped = path.join(outDir, 'cropmarker_Clip 1_320px_10fps.gif')
      await expect
        .poll(() => existsSync(cropped), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(cropped)}`)
      await expect(card.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      expect(await redPixelCount(cropped, 0.3), 'the crop excludes the red block').toBe(0)
      const square = videoStream(await ffprobeJson(cropped))
      expect(square.width).toBe(320)
      expect(Math.abs((square.height ?? 0) - 320)).toBeLessThanOrEqual(1)

      // ── the crop cleared: the same clip is the whole 16:9 frame again ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await selects.nth(1).selectOption('12')
      await card.getByRole('button', { name: 'Export GIF' }).click()
      const whole = path.join(outDir, 'cropmarker_Clip 1_320px_12fps.gif')
      await expect
        .poll(() => existsSync(whole), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expect(card.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      const wide = videoStream(await ffprobeJson(whole))
      expect([wide.width, wide.height]).toEqual([320, 180])
      expect(await redPixelCount(whole, 0.3), 'the whole frame has its red block').toBeGreaterThan(100)
    } finally {
      await app.close()
    }
  })

  test('reframe: the crop and the speed set for the clip reach the 9:16 file — no red block and half the length at 1:1 and 2x, and the uncropped 1x control keeps both (T-124 (16))', async () => {
    test.setTimeout(600_000)
    // cropMarkerSrc: 640x360, a red block at the top-left that a 1:1 crop (324x324, centered) excludes. Reframe took the
    // clip's start and end and nothing else: the Left strip of the WHOLE frame, with the red in it, at 1x, whatever was
    // drawn in the player and whatever Speed said.
    const { app, window, outDir } = await launchWithVideo('t124reframe', cropMarkerSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = reframeCard(window)
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      const speed = clipListCard(window).getByRole('slider', { name: 'Clip playback speed' })
      await speed.fill('2')
      await expect(speed).toHaveValue('2')
      await card.getByRole('button', { name: 'Left', exact: true }).click()
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()

      const shaped = path.join(outDir, 'cropmarker_Clip 1_reframe-1080x1920-left.mp4')
      await expect.poll(() => existsSync(shaped), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(shaped)}`)
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled()
      const probe = await ffprobeJson(shaped)
      const v = videoStream(probe)
      expect([v.width, v.height]).toEqual([1080, 1920])
      expect(v.sample_aspect_ratio).toBe('1:1')
      expect(await redPixelCount(shaped, 0.3), 'the crop excludes the red block').toBe(0)
      // 2 s at 2x is 1 s (not 2).
      expect(Number(probe.format?.duration), 'the clip is at 2x').toBeGreaterThan(0.8)
      expect(Number(probe.format?.duration)).toBeLessThan(1.3)

      // ── the control: no crop, 1x — the same clip, the Left strip of the whole frame, the red block in it, 2 s ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await speed.fill('1')
      await expect(speed).toHaveValue('1')
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const whole = path.join(outDir, 'cropmarker_Clip 1_reframe-1080x1920-left (2).mp4')
      await expect.poll(() => existsSync(whole), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled()
      const control = await ffprobeJson(whole)
      expect(Number(control.format?.duration), 'the control is at 1x').toBeGreaterThan(1.8)
      expect(await redPixelCount(whole, 0.3), 'the whole frame has its red block').toBeGreaterThan(5000)
    } finally {
      await app.close()
    }
  })

  test('reframe: the header reads the crop\'s size, not the source\'s, and the panel says the clip\'s look is used (T-125 (9))', async () => {
    test.setTimeout(120_000)
    // The strip is cut from the clip's crop, and the header read the uncropped source whatever was drawn in the player.
    const { app, window } = await launchWithVideo('t125readout', cropMarkerSrc)
    try {
      const card = reframeCard(window)
      // No crop: the source's own size.
      await expect(card.getByText('640×360 → 1080×1920')).toBeVisible()
      await expect(card.getByText("with the clip's crop, speed, color, text and effects", { exact: false })).toBeVisible()

      // A 1:1 crop: the strip is cut from the crop, and the header says so.
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window.locator('[data-tutorial="video-crop"]').getByRole('button', { name: '1:1', exact: true }).click()
      await expect(card.getByText('640×360 → 1080×1920')).toHaveCount(0)
      const readout = (await card.getByText(/^\d+×\d+ → 1080×1920$/).textContent()) ?? ''
      const [w, h] = (/^(\d+)×(\d+) →/.exec(readout) ?? []).slice(1).map(Number)
      expect(Math.abs((w ?? 0) - (h ?? 1)), `a 1:1 crop reads square (${readout})`).toBeLessThanOrEqual(1)
      expect(w, `and smaller than the source's 360 rows (${readout})`).toBeLessThan(360)
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await expect(card.getByText('640×360 → 1080×1920')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('reframe: the color set for the clip reaches the 9:16 file (T-125 (9))', async () => {
    test.setTimeout(600_000)
    // T-124 (16) carried the crop and the speed and said the grade "stays out, matching Compile" - Compile carries it. A clip brightened
    // in the player came out of Reframe with its original color.
    const { app, window, outDir } = await launchWithVideo('t125reframe', cropMarkerSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = reframeCard(window)
      // The control first (Left, no grade), then the same clip brightened.
      await card.getByRole('button', { name: 'Left', exact: true }).click()
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const plain = path.join(outDir, 'cropmarker_Clip 1_reframe-1080x1920-left.mp4')
      await expect.poll(() => existsSync(plain), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled()

      await window.getByRole('slider', { name: 'Brightness', exact: true }).fill('0.5')
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const bright = path.join(outDir, 'cropmarker_Clip 1_reframe-1080x1920-left (2).mp4')
      await expect.poll(() => existsSync(bright), { timeout: 540_000, intervals: [500] }).toBe(true)
      // The file appears at ffmpeg's FIRST write, so this wait covers the rest of the encode and the close, not a render tick:
      // 5 s is the platform's speed, not the contract (measured 5.09 s under three concurrent suites, round 80).
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({ timeout: 60_000 })
      const plainLuma = await frameLuma(plain, 0.5)
      const brightLuma = await frameLuma(bright, 0.5)
      expect(brightLuma - plainLuma, `the brightened clip is brighter in the 9:16 file (plain ${plainLuma}, graded ${brightLuma})`).toBeGreaterThan(30)
    } finally {
      await app.close()
    }
  })

  test('reframe, GIF and compilation are named for the video the person opened (the clip\'s name after it, for the two that are one clip\'s), not for the working copy a converted import is played from (T-124 (17), T-125 (22))', async () => {
    test.setTimeout(600_000)
    // stream.flv is converted to an mp4 working copy named for it plus a random suffix ("stream-aB3dE5fG.mp4"). The header
    // shows "stream.flv" and the Export panel names its files from that; Reframe and GIF named theirs from the copy.
    const studio = await launchHome('t124names')
    const { app, window, outDir } = studio
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      await stubDialogs(app, { open: [outDir] })
      await dropOnVideoImporter(window, flvSrc, 'stream.flv')
      await expect(window.locator('header').getByText('stream.flv', { exact: true })).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('video')).toHaveCount(1)

      const reframe = reframeCard(window)
      await reframe.getByRole('button', { name: 'Choose folder…' }).click()
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const written = (ext: string): string[] => readdirSync(outDir).filter((f) => f.endsWith(ext))
      await expect.poll(() => written('.mp4').length, { timeout: 540_000, intervals: [500] }).toBe(1)
      // Same contract as the graded case above: the poll fires on the first byte, the button comes back at the close (round 80).
      await expect(reframe.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({ timeout: 60_000 })
      expect(written('.mp4'), 'the 9:16 file is named for stream.flv').toEqual(['stream_Clip 1_reframe-1080x1920-center.mp4'])

      // (The GIF panel follows the folder Reframe was just given: the four side panels share one, T-125 (10).)
      const gif = gifCard(window)
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => written('.gif').length, { timeout: 540_000, intervals: [500] }).toBe(1)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      expect(written('.gif'), 'the GIF is named for stream.flv, then the clip').toEqual(['stream_Clip 1_480px_15fps.gif'])

      // T-125 (22): and the compilation, which used to be `stream-aB3dE5fG_compilation.mp4` (the working copy's name).
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const compile = compileCard(window)
      await compile.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expect.poll(() => written('.mp4').length, { timeout: 540_000, intervals: [500] }).toBe(2)
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
      expect(written('.mp4').sort(), 'the compilation is named for stream.flv').toEqual([
        'stream_Clip 1_reframe-1080x1920-center.mp4',
        'stream_compilation.mp4'
      ])

      // T-125 (22): and Audio Studio's re-attach SUGGESTS the original's name ("stream-cleaned.mp4"), not the working copy's
      // ("stream-aB3dE5fG-cleaned.mp4"). The Save dialog is replaced by one that records what it was opened with and says "canceled".
      await app.evaluate(({ dialog }) => {
        const g = globalThis as unknown as { __saveOptions: unknown[] }
        g.__saveOptions = []
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (...args: unknown[]) => {
          g.__saveOptions.push(args.length > 1 ? args[1] : args[0])
          return { canceled: true }
        }
      })
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 60_000 })
      await window.locator('[data-tutorial="audio-export"]').getByRole('button', { name: 'Export', exact: true }).click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __saveOptions: Array<{ defaultPath?: string }> }).__saveOptions.map((o) => o.defaultPath)))
        .toEqual(['stream-cleaned.mp4'])
    } finally {
      await app.close()
    }
  })

  test('GIF, Compile, Reframe and Picture-in-picture start on the folder the last export went to: the button shows it, no chooser opens, and the file lands there (T-124 (21))', async () => {
    test.setTimeout(600_000)
    // Export and Clip Kit remembered their folder between visits; these four asked from scratch every time the studio opened.
    // One shared key, `video.lastOutputDir`, seeded here as electron-store lays a dotted key out on disk.
    const seeded = path.join(root, `seeded-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window, outDir, userDataDir } = await launchWithVideo('t124dirs', clipSrc, {
      video: { lastOutputDir: seeded }
    })
    try {
      await recordOpenDialogs(app, [clipSrc, pipSrc])
      const name = `Output folder: ${path.basename(seeded)}`
      const reframe = reframeCard(window)
      const gif = gifCard(window)
      const compile = compileCard(window)
      const pip = pipCard(window)
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const cards: Array<[string, Locator]> = [
        ['Reframe', reframe],
        ['GIF', gif],
        ['Compile', compile],
        ['Picture-in-picture', pip]
      ]
      for (const [label, card] of cards) {
        await expect(card.getByRole('button', { name }), `${label}: the button shows the remembered folder`).toBeVisible()
        await expect(card.getByRole('button', { name: 'Choose folder…' })).toHaveCount(0)
      }

      const landed = (file: string): boolean => existsSync(path.join(seeded, file))
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      await expect.poll(() => landed('pipeline_Clip 2_reframe-1080x1920-center.mp4'), { timeout: 540_000, intervals: [500] }).toBe(true)
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => landed('pipeline_Clip 2_480px_15fps.gif'), { timeout: 540_000, intervals: [500] }).toBe(true)
      await compile.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expect.poll(() => landed('pipeline_compilation.mp4'), { timeout: 540_000, intervals: [500] }).toBe(true)
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await pip.getByRole('button', { name: 'Composite' }).click()
      await expect.poll(() => landed('pipeline_pip.mp4'), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(pip.getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 60_000 })

      expect(await openedDialogs(app), 'no folder chooser was opened (only the two file choosers)').toEqual(['file', 'file'])
      expect(readdirSync(outDir), 'nothing went to the folder the test owns').toEqual([])
      expect((readConfig(userDataDir).video as { lastOutputDir?: string } | undefined)?.lastOutputDir).toBe(seeded)
    } finally {
      await app.close()
    }
  })

  // T-126 (6): the four side panels' hook and Clip Kit start their chooser on the folder they show; Export's button passed nothing, so the
  // chooser opened wherever the OS last was, beside a chip that named another folder.
  test("Export's folder button opens the chooser on the folder it shows (T-126 (6))", async () => {
    test.setTimeout(240_000)
    const seeded = path.join(root, `t126export-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t126exportdir', clipSrc, { export: { lastOutputDir: seeded } })
    try {
      await recordSlowChooser(app, { answer: null })
      const card = exportCard(window)
      const chip = card.getByRole('button', { name: `Output folder: ${path.basename(seeded)}` })
      await expect(chip, 'Export shows its remembered folder').toBeVisible()
      await chip.click()
      await expect.poll(async () => (await chooserCalls(app)).length).toBe(1)
      expect((await chooserCalls(app))[0], 'a folder chooser, opened on the folder the button shows').toEqual({ folder: true, defaultPath: seeded })
      // A canceled chooser changes nothing.
      await expect(chip).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // T-126 (19): `ExportPanel.startExport` was the only start handler that claimed "busy" before its first await. Compile, GIF, Reframe and
  // Audio Export claimed after the chooser, so a double-click ran two of them: two choosers, two output files (executed in the built app).
  // The chooser here answers after 300 ms, as a real one does, which is the window the second press lands in.
  test('a double-click on Compile opens ONE chooser and writes ONE file (T-126 (19))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t126dblchooser')
    try {
      await recordSlowChooser(app, { answer: outDir, delayMs: 300 })
      await stubShellReveal(app)
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = compileCard(window)
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).dblclick()
      const output = path.join(outDir, 'pipeline_compilation.mp4')
      await expect.poll(() => existsSync(output), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({ timeout: 60_000 })
      expect((await chooserCalls(app)).filter((c) => c.folder), 'one folder chooser, not two').toHaveLength(1)
      expect(mp4sIn(outDir), 'one file, not "pipeline_compilation (2).mp4" beside it').toEqual(['pipeline_compilation.mp4'])
      expect((await readToastLog(window)).filter((t) => t.startsWith('Saved pipeline_compilation')), 'one saved toast').toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  // T-127 (2): Export is the fifth card. It was left out of (20) and kept its Cancel in the header beside the primary ("Export 1 file" is
  // wider than "Exporting...", so the second press landed on Cancel, and one job has no confirm). It is measured here with the others.
  // T-126 (19), (20): with a folder already remembered nothing is asked, but Compile, GIF and Picture-in-picture drew Cancel beside the
  // primary in the busy row, and the busy label is shorter: the second click of a double-click landed on Cancel (measured: the idle button
  // spans x 1093-1205, Cancel 1147-1205) and the job the first click had just started was canceled - "Compilation canceled." and no file.
  // Whether that second press lands on Cancel depends on the widths of two labels in the font in use, so the double-click alone is not
  // a stable witness; the encode is held for a moment (so the busy row can be MEASURED) and the box of Cancel is compared with the box
  // the primary had: they must not overlap. Cancel has a row of its own now, and the claim (19) keeps even a press that is not disabled
  // yet from starting a second job. Every one of the four runs to its end and writes ONE file.
  test('a double-click on Export, Reframe, GIF, Compile and Picture-in-picture runs the job to its end: Cancel is clear of the primary, one file each, no canceled toast (T-126 (19), (20), T-127 (2))', async () => {
    test.setTimeout(600_000)
    const seeded = path.join(root, `t126dblremember-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t126dblremember', clipSrc, { video: { lastOutputDir: seeded }, export: { lastOutputDir: seeded } })
    try {
      await recordSlowChooser(app, { answer: null, files: [clipSrc, pipSrc] })
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 2_500 }])
      const landed = (file: string): boolean => existsSync(path.join(seeded, file))
      const box = (b: { x: number; y: number; width: number; height: number } | null): string =>
        b ? `x ${Math.round(b.x)}-${Math.round(b.x + b.width)}, y ${Math.round(b.y)}-${Math.round(b.y + b.height)}` : 'none'

      const doubleClick = async (label: string, card: Locator, primaryName: string, output: string, cancelOwnsARow: boolean): Promise<void> => {
        const primary = card.getByRole('button', { name: primaryName, exact: true })
        const idle = await primary.boundingBox()
        if (!idle) throw new Error(`${label}: no primary button`)
        await primary.dblclick()
        const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
        await expect(cancel, `${label}: the job is running and offers Cancel`).toBeVisible({ timeout: 20_000 })
        if (cancelOwnsARow) {
          const c = await cancel.boundingBox()
          if (!c) throw new Error(`${label}: no Cancel box`)
          // Its own row, below the primary's (the Reframe precedent): beside it, Cancel took the place the primary's right edge had.
          expect(c.y, `${label}: Cancel (${box(c)}) has a row of its own, below where the primary was (${box(idle)})`).toBeGreaterThanOrEqual(idle.y + idle.height - 1)
          const overlaps = c.x < idle.x + idle.width && c.x + c.width > idle.x && c.y < idle.y + idle.height && c.y + c.height > idle.y
          expect(overlaps, `${label}: Cancel (${box(c)}) is clear of where the primary was (${box(idle)})`).toBe(false)
        }
        await expect.poll(() => landed(output), { timeout: 540_000, intervals: [500] }).toBe(true)
        await expect(card.getByRole('button', { name: primaryName, exact: true }), `${label}: free again`).toBeEnabled({ timeout: 60_000 })
      }

      // Export first, with the one clip the studio opens on (one job: no confirm stands between a misplaced press and the cancel).
      await doubleClick('Export', exportCard(window), 'Export 1 file', 'pipeline_Clip 1_youtube.mp4', true)
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      await doubleClick('Reframe', reframeCard(window), 'Reframe to 9:16', 'pipeline_Clip 2_reframe-1080x1920-center.mp4', false)
      await doubleClick('GIF', gifCard(window), 'Export GIF', 'pipeline_Clip 2_480px_15fps.gif', true)
      const compile = compileCard(window)
      await compile.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await doubleClick('Compile', compile, 'Compile 2 clips', 'pipeline_compilation.mp4', true)
      const pip = pipCard(window)
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await doubleClick('Picture-in-picture', pip, 'Composite', 'pipeline_pip.mp4', true)

      expect(readdirSync(seeded).sort(), 'exactly the five files, none of them a second copy').toEqual(
        ['pipeline_Clip 1_youtube.mp4', 'pipeline_Clip 2_480px_15fps.gif', 'pipeline_Clip 2_reframe-1080x1920-center.mp4', 'pipeline_compilation.mp4', 'pipeline_pip.mp4'].sort()
      )
      const toasts = await readToastLog(window)
      for (const canceled of ['Export canceled. Files already finished are in your folder.', 'Reframe canceled.', 'GIF canceled.', 'Compilation canceled.', 'Picture-in-picture canceled.']) {
        expect(toasts, `"${canceled}": the second press did not cancel the first job`).not.toContain(canceled)
      }
      expect((await chooserCalls(app)).filter((c) => c.folder), 'no folder chooser: the folder was remembered').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-127 (2): the same defect at a PERSON's pace. A double-click measured in a script is two events a millisecond apart; a person's is 60 to
  // 200 ms, after the busy re-render. QA executed it 3 times out of 3 on the unfixed build: the second press (at 60, 120 and 200 ms) hit
  // Cancel, "Export canceled." and no file. The second press here is a real mouse click on the right part of the button just pressed (where
  // the pointer already is), 120 ms after the busy label drew; it must land on the disabled primary, and the export must finish and write
  // its file. The encode is held 2.5 s so the busy state is long enough to be the thing the second press meets.
  test('a second press on Export at a human pace lands on the disabled button, not on Cancel: the export finishes and its file lands (T-127 (2))', async () => {
    test.setTimeout(240_000)
    const seeded = path.join(root, `t127human-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t127human', clipSrc, { export: { lastOutputDir: seeded } })
    try {
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 2_500 }])
      const card = exportCard(window)
      const primary = card.getByRole('button', { name: 'Export 1 file', exact: true })
      const idle = await primary.boundingBox()
      if (!idle) throw new Error('no Export button')
      const x = idle.x + idle.width - 12
      const y = idle.y + idle.height / 2
      await window.mouse.click(x, y)
      await expect(card.getByRole('button', { name: /^Exporting/ }), 'the first press started the export').toBeVisible()
      await window.waitForTimeout(120)
      await window.mouse.click(x, y)
      // Still running a moment later (the encode is held 2.5 s): a press that landed on Cancel would have ended it by now.
      await window.waitForTimeout(400)
      await expect(card.getByRole('button', { name: /^Exporting/ }), 'the second press did not stop the export').toBeVisible()
      const output = path.join(seeded, 'pipeline_Clip 1_youtube.mp4')
      await expect.poll(() => existsSync(output), { timeout: 120_000, intervals: [250] }).toBe(true)
      await expect(card.getByRole('button', { name: 'Export 1 file', exact: true }), 'free again once it has finished').toBeEnabled({ timeout: 60_000 })
      expect(mp4sIn(seeded), 'one file, and it is the export').toEqual(['pipeline_Clip 1_youtube.mp4'])
      const toasts = await readToastLog(window)
      expect(toasts, 'the second press did not cancel the export').not.toContain('Export canceled. Files already finished are in your folder.')
      expect(toasts.filter((t) => t === 'Exported 1 file'), 'and it said it exported').toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  // T-128 (4), T-110 (x): Export saved the watermark handle, its corner and the file-name template with bare awaited writes BEFORE it built the
  // queue, so a write main refused ended `startExport` there: the button came back, no row, no toast, no file. The writes are remembered
  // preferences, not the export; a refusal is one sentence and the export goes on. `settings:set` is made to refuse in the running app.
  test('Export still runs when main refuses to remember the watermark and the template, and says so in one sentence (T-128 (4))', async () => {
    test.setTimeout(240_000)
    const seeded = path.join(root, `t128refused-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t128refused', clipSrc, { export: { lastOutputDir: seeded } })
    try {
      await stubShellReveal(app)
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('settings:set')
        ipcMain.handle('settings:set', () => {
          throw new Error('config write refused')
        })
      })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Export 1 file', exact: true }).click()
      const output = path.join(seeded, 'pipeline_Clip 1_youtube.mp4')
      await expect.poll(() => existsSync(output), { timeout: 120_000, intervals: [250] }).toBe(true)
      await expect(card.getByRole('button', { name: 'Export 1 file', exact: true }), 'free again once it has finished').toBeEnabled({ timeout: 60_000 })
      const toasts = await readToastLog(window)
      expect(toasts, 'it said it exported').toContain('Exported 1 file')
      expect(toasts, 'and that the preferences were not saved, in one plain sentence').toContain("Couldn't save your settings.")
      // T-132 (13): ONE card, not one per refused write (this press makes two or more: the handle and its corner are each their own
      // write, and the template is a third). A fixed toast id makes the repeats replace the live card instead of stacking under it.
      expect(toasts.filter((t) => t === "Couldn't save your settings."), `the sentence was shown ${toasts.filter((t) => t === "Couldn't save your settings.").length} times: ${JSON.stringify(toasts)}`).toHaveLength(1)
      expect(mp4sIn(seeded)).toEqual(['pipeline_Clip 1_youtube.mp4'])
      // T-128 (1): and the finished row's two cut names carry their whole selves (the clip and preset, and the file the row wrote).
      await expect(card.locator('span.truncate[title="Clip 1 \u00b7 YouTube"]'), 'the row\'s name').toHaveCount(1)
      await expect(card.locator('span.truncate[title$="pipeline_Clip 1_youtube.mp4"]'), 'the row\'s file, titled with its full path').toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  // T-127 (3): the window's X (and `app.quit()`) in the middle of a job. Cancel deletes the half-written output (T-100); a quit did not: the
  // kills before-quit issues only START the cleanup, and the process was gone before it ran. Executed on the unfixed build 6 times out of 6:
  // `vid_c1_youtube.mp4` (~1.5 MB, no moov atom) at its final name, and the next export of the clip landed at "(2)". The job here is real and
  // long (a minute of 720p testsrc2 through the 1080p preset), the quit comes once the output holds data, and the folder is read after the
  // app has exited.
  async function quitByWindowX(app: ElectronApplication): Promise<void> {
    const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
    await app
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })
      .catch(() => undefined)
    await Promise.race([closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the app did not exit within 30 s of the window X')), 30_000))])
  }

  test('quitting the app in the middle of an export leaves no half-written file at the final name (T-127 (3))', async () => {
    test.setTimeout(300_000)
    const src = path.join(root, 'source', 't127-quit.mp4')
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', src])
    const seeded = path.join(root, `t127quit-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t127quit', src, { export: { lastOutputDir: seeded } })
    try {
      await exportCard(window).getByRole('button', { name: 'Export 1 file', exact: true }).click()
      const sizes = (): number[] => readdirSync(seeded).map((f) => statSync(path.join(seeded, f)).size)
      // The encode has opened its output at the final name and is writing it.
      await expect.poll(() => sizes().some((n) => n > 300_000), { timeout: 120_000, intervals: [200] }).toBe(true)
      expect(readdirSync(seeded), 'the half-written export is at its final name while the encode runs').toEqual(['t127-quit_Clip 1_youtube.mp4'])
      await quitByWindowX(app)
      expect(readdirSync(seeded), 'nothing is left in the folder after the quit: Cancel deletes the half-written file, and so must a quit').toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('quitting the app in the middle of a re-attach leaves no scratch WAV and no half-written mp4 (T-127 (3))', async () => {
    test.setTimeout(300_000)
    const dir = path.join(root, `t127reattach-${Date.now().toString(36)}`)
    const outDir = path.join(dir, 'out')
    mkdirSync(outDir, { recursive: true })
    const sound = path.join(dir, 'long.wav')
    const picture = path.join(dir, 'pic.mp4')
    // 15 minutes of stereo sound (165 MB): the cleaned render of it, with an aggressive denoise, outlasts the test's wait for it to start.
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=900:sample_rate=48000', '-ac', '2', sound])
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', picture])
    const { app, window } = await launchHome('t127reattach')
    try {
      const output = path.join(outDir, 'result.mp4')
      const scratch = path.join(outDir, 'result.cleaned.wav')
      // The Export panel's Re-attach is this IPC (audio:mux) with the same spec; the button needs a native save dialog, which is not the thing under test.
      void window
        .evaluate(
          ([videoPath, sourcePath, outputPath, chain]) =>
            window.api.audio.mux({ jobId: 't127-reattach', videoPath, sourcePath, outputPath, chain } as never).catch((e: unknown) => String(e)),
          [picture, sound, output, { ...DEFAULT_CHAIN_SPEC, denoise: 'aggressive' }] as const
        )
        .catch(() => undefined)
      // The first pass is rendering the cleaned sound to the scratch WAV.
      await expect.poll(() => existsSync(scratch) && statSync(scratch).size > 3_000_000, { timeout: 120_000, intervals: [200] }).toBe(true)
      await quitByWindowX(app)
      expect(readdirSync(outDir), 'no .cleaned.wav and no result.mp4 after the quit').toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  // T-128 (5), T-127 (3)'s "not covered": the same window X in the middle of the three jobs the quit's wait did not see - the recording's save
  // (the MP4 convert), an import transcode and the extraction of a recording's sound. Each runs in an app whose temp folder is its own
  // (`TMPDIR`), so the scratch the job makes is the only thing in it and a parallel run on the machine cannot be mistaken for the job's.
  // The folders are read after the app has exited.
  async function launchHomeInOwnTmp(name: string): Promise<Studio & { tmp: string }> {
    const stamp = Date.now().toString(36)
    const userDataDir = path.join(root, `ud-${name}-${stamp}`)
    const outDir = path.join(root, `out-${name}-${stamp}`)
    const tmp = path.join(root, `tmp-${name}-${stamp}`)
    mkdirSync(outDir, { recursive: true })
    mkdirSync(tmp, { recursive: true })
    seedUserData(userDataDir)
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, ELECTRON_DISABLE_SANDBOX: '1' }
    })
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
    return { app, window, userDataDir, outDir, tmp }
  }

  /**
   * A slow disk (an antivirus scan, a busy drive): removing a file whose name ends in one of `suffixes` takes `ms` in the app's MAIN process.
   * The cleanup after a kill is a few milliseconds of work on an idle disk, and the window's teardown takes about as long, so on a fast
   * machine the unfixed app wins the race by luck (executed: the extraction's WAV and the transcode's mp4 were both removed in time). The
   * technique is `installSpawnStall`'s: patch the built-in module in main and publish the patch to the app's named imports.
   */
  async function slowUnlinkInMain(app: ElectronApplication, suffixes: string[], ms: number): Promise<void> {
    await app.evaluate((_electron, rule) => {
      const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
      const fsp = getBuiltin('node:fs/promises') as { unlink: (p: unknown) => Promise<void> }
      const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
      const real = fsp.unlink
      fsp.unlink = async (p: unknown): Promise<void> => {
        if (rule.suffixes.some((suffix) => String(p).endsWith(suffix))) await new Promise((resolve) => setTimeout(resolve, rule.ms))
        return real(p)
      }
      mod.syncBuiltinESMExports()
    }, { suffixes, ms })
  }

  /** One minute of 720p VP8 at a low bitrate: a small file (a MediaRecorder take) that libx264 takes a good while to convert. Made once, for both tests. */
  let webmTake: Promise<string> | null = null
  function makeWebmTake(): Promise<string> {
    webmTake ??= (async () => {
      const dir = path.join(root, `t128take-${Date.now().toString(36)}`)
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 't128-take.webm')
      await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-c:v', 'libvpx', '-b:v', '800k', '-deadline', 'realtime', '-cpu-used', '8', '-an', file])
      return file
    })()
    return webmTake
  }

  test("quitting the app in the middle of a recording's MP4 convert leaves no half-written mp4 and keeps the raw take (T-128 (5))", async () => {
    test.setTimeout(300_000)
    const webm = await makeWebmTake()
    const { app, window, userDataDir, outDir } = await launchHomeInOwnTmp('t128recquit')
    try {
      const outPath = path.join(outDir, 'take.mp4')
      await stubDialogs(app, { save: [outPath] })
      await slowUnlinkInMain(app, ['.mp4'], 600)
      const url = await window.evaluate((p) => window.api.video.fileUrl(p), webm)
      // The renderer's own calls (the Record studio's Stop runs exactly these): begin, the bytes in slices, then finalize with Convert on.
      void window
        .evaluate(async (u) => {
          const bytes = await (await fetch(u)).arrayBuffer()
          const { id } = await window.api.recording.begin()
          for (let at = 0; at < bytes.byteLength; at += 4 * 1024 * 1024) await window.api.recording.appendChunk(id, bytes.slice(at, Math.min(at + 4 * 1024 * 1024, bytes.byteLength)))
          return window.api.recording.finalize(id, { filename: 'take', convertToMp4: true, durationMs: 60_000 }).then(
            (r) => JSON.stringify(r),
            (e: unknown) => `ERR ${String(e)}`
          )
        }, url)
        .catch(() => undefined)
      // The convert has opened its output at the name the person chose, and the raw take is in userData.
      await expect.poll(() => existsSync(outPath) && statSync(outPath).size > 300_000, { timeout: 120_000, intervals: [200] }).toBe(true)
      const recordings = path.join(userDataDir, 'recordings')
      const takes = readdirSync(recordings)
      expect(takes, 'the raw take is the one webm in userData/recordings while the convert runs').toHaveLength(1)
      const rawSize = statSync(path.join(recordings, takes[0] as string)).size
      expect(rawSize, 'and it is the whole take').toBe(statSync(webm).size)

      await quitByWindowX(app)

      expect(existsSync(outPath), 'no half-written mp4 at the name the person chose').toBe(false)
      expect(readdirSync(recordings), 'and the raw take survived the quit: a take is never both gone').toEqual(takes)
      expect(statSync(path.join(recordings, takes[0] as string)).size).toBe(rawSize)
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('quitting the app in the middle of an import transcode leaves no half-written mp4 in the working-copy folder (T-128 (5))', async () => {
    test.setTimeout(300_000)
    const source = await makeWebmTake()
    const { app, window, tmp } = await launchHomeInOwnTmp('t128impquit')
    try {
      const importDir = path.join(tmp, 'imagii-import')
      const partials = (): string[] => (existsSync(importDir) ? readdirSync(importDir) : [])
      await slowUnlinkInMain(app, ['.mp4'], 600)
      void window.evaluate((p) => window.api.video.convertForImport(p).catch((e: unknown) => String(e)), source).catch(() => undefined)
      await expect
        .poll(() => partials().some((f) => statSync(path.join(importDir, f)).size > 300_000), { timeout: 120_000, intervals: [200] })
        .toBe(true)
      expect(partials(), 'the transcode is writing its working copy: one mp4 named for the source').toHaveLength(1)
      expect(partials()[0]).toMatch(/^t128-take-[\w-]{8}\.mp4$/)

      await quitByWindowX(app)

      expect(partials(), 'nothing is left in the folder after the quit: a transcode that stops removes its partial').toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test("quitting the app in the middle of an extraction removes the half-written scratch WAV (T-128 (5))", async () => {
    test.setTimeout(300_000)
    const dir = path.join(root, `t128extquit-${Date.now().toString(36)}`)
    mkdirSync(dir, { recursive: true })
    // 115 minutes of silence in FLAC (1.6 MB): under the 2-hour waveform ceiling, and 1.3 GB of WAV once it is extracted (about 4 s of ffmpeg).
    const sound = path.join(dir, 'long.mka')
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '6900', '-c:a', 'flac', sound])
    const { app, window, tmp } = await launchHomeInOwnTmp('t128extquit')
    try {
      const scratch = path.join(tmp, 'imagii-audio')
      const wavs = (): string[] => (existsSync(scratch) ? readdirSync(scratch) : [])
      await slowUnlinkInMain(app, ['.wav'], 600)
      void window.evaluate((p) => window.api.audio.extractFromVideo(p).catch((e: unknown) => String(e)), sound).catch(() => undefined)
      await expect.poll(() => wavs().some((f) => statSync(path.join(scratch, f)).size > 5_000_000), { timeout: 120_000, intervals: [50] }).toBe(true)
      expect(wavs(), 'the extraction is writing its scratch WAV').toHaveLength(1)
      expect(statSync(path.join(scratch, wavs()[0] as string)).size, 'and it is still going (1.3 GB when finished)').toBeLessThan(1_000_000_000)

      await quitByWindowX(app)

      expect(wavs(), 'nothing is left in the scratch folder after the quit').toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test("a folder one panel finished with is the next panel's without asking, a canceled chooser remembers nothing, and a stored value that is not an absolute path is ignored (T-124 (21))", async () => {
    test.setTimeout(600_000)
    const { app, window, outDir, userDataDir } = await launchWithVideo('t124remember')
    try {
      await recordOpenDialogs(app, [])
      const gif = gifCard(window)
      const reframe = reframeCard(window)
      // Nothing stored and nothing chosen: the empty state is the sentence it always was, and a canceled chooser starts nothing.
      await expect(gif.getByRole('button', { name: 'Choose folder…' })).toBeVisible()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => openedDialogs(app)).toEqual(['folder'])
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      expect(
        (readConfig(userDataDir).video as { lastOutputDir?: string } | undefined)?.lastOutputDir,
        'a canceled chooser remembers nothing'
      ).toBeUndefined()

      // The GIF panel picks a folder and finishes; Reframe, never touched, uses that folder when pressed, with no second chooser.
      await stubDialogs(app, { open: [outDir] })
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => existsSync(path.join(outDir, 'pipeline_Clip 1_480px_15fps.gif')), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      await expect
        .poll(() => (readConfig(userDataDir).video as { lastOutputDir?: string } | undefined)?.lastOutputDir, { timeout: 15_000 })
        .toBe(outDir)
      await recordOpenDialogs(app, [])
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      await expect
        .poll(() => existsSync(path.join(outDir, 'pipeline_Clip 1_reframe-1080x1920-center.mp4')), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      expect(await openedDialogs(app), 'Reframe asked for no folder').toEqual([])
      await expect(reframe.getByRole('button', { name: `Output folder: ${path.basename(outDir)}` })).toBeVisible()
    } finally {
      await app.close()
    }

    // A value that came off disk and is not an absolute path is not a folder: the panels start empty, as before.
    const stale = await launchWithVideo('t124stale', clipSrc, { video: { lastOutputDir: 'exports\\..\\elsewhere' } })
    try {
      const cards = [reframeCard(stale.window), gifCard(stale.window), compileCard(stale.window), pipCard(stale.window)]
      for (const card of cards) {
        await expect(card.getByRole('button', { name: 'Choose folder…' })).toBeVisible()
      }
    } finally {
      await stale.app.close()
    }
  })

  test('a remembered folder that no longer exists is ignored by all four buttons, and the action opens the chooser (T-125 (10))', async () => {
    test.setTimeout(240_000)
    // USER_GUIDE: "a folder that is no longer a usable path is ignored". A well-formed path to a folder that was deleted (or sits on a
    // drive that is not plugged in) was seeded into every button and written into: the failure blamed "a file imagii needs", and a
    // Compile reached it only after its whole segment encode.
    const deleted = path.join(root, `deleted-${Date.now().toString(36)}`, 'Clips')
    const { app, window, userDataDir } = await launchWithVideo('t125gone', clipSrc, { video: { lastOutputDir: deleted } })
    try {
      await recordOpenDialogs(app, [])
      const cards: Array<[string, Locator]> = [
        ['Reframe', reframeCard(window)],
        ['GIF', gifCard(window)],
        ['Compile', compileCard(window)],
        ['Picture-in-picture', pipCard(window)]
      ]
      for (const [label, card] of cards) {
        await expect(card.getByRole('button', { name: 'Choose folder…' }), `${label}: the deleted folder is not shown`).toBeVisible()
        await expect(card.getByRole('button', { name: /^Output folder:/ })).toHaveCount(0)
      }
      // Pressing the action asks where, as it does with nothing remembered (the recording stub answers "canceled").
      await gifCard(window).getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => openedDialogs(app)).toEqual(['folder'])
      await expect(gifCard(window).getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      // Ignored, not erased: the stored value is still what it was (the drive may come back).
      expect((readConfig(userDataDir).video as { lastOutputDir?: string }).lastOutputDir).toBe(deleted)
    } finally {
      await app.close()
    }
  })

  test('a pick in one of the four panels is the other three\' folder at once (T-125 (10))', async () => {
    test.setTimeout(240_000)
    const { app, window, outDir } = await launchWithVideo('t125share')
    try {
      await stubDialogs(app, { open: [outDir] })
      const cards: Array<[string, Locator]> = [
        ['Reframe', reframeCard(window)],
        ['GIF', gifCard(window)],
        ['Compile', compileCard(window)],
        ['Picture-in-picture', pipCard(window)]
      ]
      for (const [label, card] of cards) {
        await expect(card.getByRole('button', { name: 'Choose folder…' }), `${label}: empty to begin with`).toBeVisible()
      }
      await gifCard(window).getByRole('button', { name: 'Choose folder…' }).click()
      const name = `Output folder: ${path.basename(outDir)}`
      for (const [label, card] of cards) {
        await expect(card.getByRole('button', { name }), `${label}: follows the pick made in GIF`).toBeVisible()
      }
      // Export keeps its own folder (a batch, not a side export).
      await expect(exportCard(window).getByRole('button', { name: 'Choose folder…' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // T-125 (11), (12): the folder chip drew the folder's whole name, so a long remembered one (a streamer's "Stream_Highlights_2026_Season_
  // Finale_..." is ordinary) pushed the primary button out of every card that holds it, by 55 px in the sweep's measurement, and the
  // picture-in-picture card's Position select drew "Bottom rig" with its "Overlay width (px)" label wrapped onto two lines. A click
  // reaches a button that is outside its card (Playwright scrolls it into view), which is why no behavior case ever saw it.
  test('a long remembered folder name ends in an ellipsis and pushes no button out of any card, and the picture-in-picture card shows its whole Position select (T-125 (11), (12))', async () => {
    test.setTimeout(240_000)
    // No spaces and no hyphens: a name with a break opportunity wraps inside the button instead of widening it, and the folder names a
    // person gives a stream's exports (Stream_Highlights_2026_Season_Finale_...) are exactly the ones with none.
    const longName = 'Stream_Highlights_2026_Season_Finale_Raw_Footage_and_Exports_for_the_Editor_Backup'
    const long = path.join(root, longName)
    mkdirSync(long, { recursive: true })
    const { app, window } = await launchWithVideo('t125long', clipSrc, { video: { lastOutputDir: long }, export: { lastOutputDir: long } })
    try {
      const cards: Array<[string, Locator]> = [
        ['Export', exportCard(window)],
        ['Reframe', reframeCard(window)],
        ['GIF', gifCard(window)],
        ['Compile', compileCard(window)],
        ['Picture-in-picture', pipCard(window)]
      ]
      // Every size and every card is measured before anything fails, so one red names all of them.
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        for (const [label, card] of cards) {
          const chip = card.getByRole('button', { name: `Output folder: ${longName}` })
          await expect(chip, `${label}: shows the remembered folder`).toBeVisible()
          // The measured half: nothing past the card's edge, and every button whole (+55 px on the primary button before).
          await check(() => expectNoHorizontalOverflow(card, `the ${label} card at ${where}`))
          await check(() => expectControlsWhole(card, card.locator('button.btn-ghost, button.btn-primary'), `the ${label} card's buttons at ${where}`))
          // And the way a long name is shortened: an ellipsis, with the whole path as the tooltip.
          await check(() => expectEllipsized(chip.locator('span.truncate'), long, `${label}'s folder name at ${where}`))
        }
        // (12): every option, because the select clips the one it shows, and the longest ("Bottom right") is the default.
        const pip = pipCard(window)
        for (const value of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
          await pip.locator('select').selectOption(value)
          await check(() => expectSelectsWhole(pip, pip.locator('select'), `the Position select showing "${value}" at ${where}`))
        }
        await check(() => expectOneLine(pip.locator('label > span.text-ink-muted'), `the picture-in-picture labels at ${where}`))
      }
      expect(problems, 'every card keeps its buttons whole and shortens a long folder name, at both window sizes').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-126 (11): the fade readout ("300 ms") was a `w-14 text-right` box in a flex row with no guard, wrapped at 1632 px and under, and the row
  // changed height while the slider was dragged. `expectControlsWhole` cannot see a wrapped label (its scrollWidth never grows), so the
  // readout is measured as a LINE, and the row's height is read at both ends of the slider and the middle.
  test('the Compile fade readout stays on one line and the row keeps its height from end to end of the slider, at the default window and the minimum (T-126 (11))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t126fade')
    try {
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = compileCard(window)
      const fade = card.getByRole('slider', { name: 'Fade between clips, in milliseconds' })
      const row = card.locator('label').filter({ has: window.getByRole('slider', { name: 'Fade between clips, in milliseconds' }) })
      const readout = row.locator('span.font-mono')
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        const heights: number[] = []
        // 0, 300 (the default), 1000: one, three and four digits.
        for (const value of ['0', '300', '1000']) {
          await fade.fill(value)
          await expect(readout).toHaveText(`${value} ms`)
          await check(() => expectOneLine(readout, `the fade readout "${value} ms" at ${where}`))
          await check(() => expectControlsWhole(card, readout, `the fade readout "${value} ms" at ${where}`))
          heights.push(Math.round((await row.boundingBox())?.height ?? 0))
        }
        await check(async () => expect(new Set(heights).size, `the fade row changes height with its value at ${where}: ${heights.join(', ')} px`).toBe(1))
      }
      expect(problems, 'the fade readout is one line and the row one height at every size').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-126 (13): "Reframe to 9:16", "Export GIF" and "Compile N clips" wrapped to two lines beside a long folder name at the 298 px cards
  // (measured with "Stream Highlights" and longer): the chip held its name's width and the primary gave. The chip is what gives now
  // (`min-w-0`, its name already ends in an ellipsis) and the primary keeps its words (`whitespace-nowrap`). `expectControlsWhole` passes a
  // wrapped label (the scrollWidth of a wrapped button never grows), so this measures each primary as a line. The folder name HAS spaces, on
  // purpose: the T-125 (11) case below it uses none, and a name with a break opportunity is the one that wraps inside the button instead.
  test('the Reframe, GIF and Compile primary buttons are one line beside a long folder name, at the default window and the minimum (T-126 (13))', async () => {
    test.setTimeout(240_000)
    const long = path.join(root, 'Stream Highlights Season Finale Raw Footage and Exports for the Editor Backup')
    mkdirSync(long, { recursive: true })
    const { app, window } = await launchWithVideo('t126oneline', clipSrc, { video: { lastOutputDir: long } })
    try {
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push((e as Error).message.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').slice(0, 260))
        }
      }
      const cards: Array<[string, Locator]> = [
        ['Reframe', reframeCard(window)],
        ['GIF', gifCard(window)],
        ['Compile', compileCard(window)]
      ]
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        for (const [label, card] of cards) {
          await expect(card.getByRole('button', { name: `Output folder: ${path.basename(long)}` }), `${label}: shows the remembered folder`).toBeVisible()
          await check(() => expectOneLine(card.locator('button.btn-primary'), `the ${label} primary button at ${where}`))
          await check(() => expectControlsWhole(card, card.locator('button.btn-ghost, button.btn-primary'), `the ${label} card's buttons at ${where}`))
        }
      }
      expect(problems, 'each primary button is one line at both window sizes').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-126 (14): the Reframe readout ("1280×720 → 1080×1920") broke after its arrow, the header ("Reframe to 9:16 (center crop)", stale since
  // Left and Right became positions) wrapped, and "OUTPUT PREVIEW" broke mid-word at the 298 px card. The header is a wrap-capable row now:
  // the heading never wraps and a row too narrow for the actions drops them WHOLE to a second row.
  test('the Reframe and Output preview headers keep their words whole at the minimum window, and the preview select shows every platform whole (T-126 (14))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t126headers')
    try {
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      const reframe = reframeCard(window)
      const preview = window.locator('.card').filter({ has: window.getByLabel('Preview platform') })
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        // The title says what the panel does, once, on one line; the readout beside it is one line too.
        const title = reframe.getByRole('heading', { name: 'Reframe to 9:16', exact: true })
        await expect(title, `the Reframe title at ${where}`).toBeVisible()
        await check(() => expectOneLine(title, `the Reframe title at ${where}`))
        await check(() => expectOneLine(reframe.getByText(/^\d+×\d+ → \d+×\d+$/), `the Reframe readout at ${where}`))
        await check(() => expectNoHorizontalOverflow(reframe, `the Reframe card at ${where}`))
        // OUTPUT PREVIEW: its heading is one line, and its select shows the whole of every platform's option.
        const heading = preview.getByRole('heading', { name: 'Output preview', exact: true })
        await expect(heading, `the Output preview heading at ${where}`).toBeVisible()
        await check(() => expectOneLine(heading, `the Output preview heading at ${where}`))
        const select = preview.getByLabel('Preview platform')
        for (const option of await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))) {
          await select.selectOption(option)
          await check(() => expectSelectsWhole(preview, select, `the Preview platform select showing "${option}" at ${where}`))
        }
        await check(() => expectNoHorizontalOverflow(preview, `the Output preview card at ${where}`))
      }
      expect(problems, 'both headers keep their words whole at both window sizes').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-126 (15): the transport row at the 1024 px minimum had no room for a 3-hour VOD's clock ("2:59:59.00 / 3:00:00.00", 23 characters of
  // mono) beside the probe line, and the clock wrapped. The clock and the Crop guides label keep their width; the probe line is what gives,
  // cut with an ellipsis and carrying the whole text as its tooltip.
  test('the player transport keeps its clock and Crop guides on one line at the minimum window with a three-hour video, and the probe line gives (T-126 (15))', async () => {
    test.setTimeout(300_000)
    const vod = path.join(root, 'source', 'three-hours.mp4')
    await ffmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1:d=10800', '-t', '10800',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '600', '-pix_fmt', 'yuv420p', vod
    ])
    const { app, window } = await launchWithVideo('t126transport', vod)
    try {
      const player = window.locator('[data-tutorial="video-player"]')
      const clock = player.locator('.font-mono').first()
      // The playhead at the very end: the longest clock there is ("3:00:00.00 / 3:00:00.00").
      const slider = window.locator('[data-tutorial="video-timeline"] [role="slider"]')
      await slider.focus()
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        if (v) v.currentTime = 10799
      })
      await expect(clock).toContainText(/^\d:\d\d:\d\d\.\d\d \/ 3:00:00\.\d\d$/, { timeout: 15_000 })
      const row = clock.locator('xpath=..')
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await check(() => expectOneLine(clock, `the clock at ${where}`))
        await check(() => expectOneLine(row.getByText('Crop guides', { exact: true }), `the Crop guides label at ${where}`))
        await check(() => expectNoHorizontalOverflow(row, `the transport row at ${where}`))
        await check(() => expectControlsWhole(row, row.locator('button, label'), `the transport controls at ${where}`))
        // The probe line is what gives: it carries its whole text as the tooltip, and at the minimum it is cut.
        const probe = row.locator('div[title]')
        await check(async () => expect(await probe.getAttribute('title'), `the probe line's tooltip at ${where}`).toMatch(/^64×48 · .+ · video h264/))
      }
      expect(problems, 'the transport row holds at both window sizes').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-125 (23): minutes past 59 are not a clock anyone reads ("167:13.0" for a three-hour VOD). From an hour up the Timeline, the clip
  // list and the player write h:mm:ss; under an hour every readout is the string it always was (the rest of the suite reads them).
  test('a video over an hour reads its times as h:mm:ss in the Timeline, the clip list and the player (T-125 (23))', async () => {
    test.setTimeout(240_000)
    const vod = path.join(root, 'source', 'an-hour-and-a-bit.mp4')
    await ffmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1:d=3700', '-t', '3700',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '600', '-pix_fmt', 'yuv420p', vod
    ])
    const { app, window } = await launchWithVideo('t125hours', vod)
    try {
      // Clip 1 is the whole video, 3700 s = 1 h 1 min 40 s.
      const readouts = window.locator('[data-tutorial="video-timeline"] span.font-mono')
      await expect(readouts).toHaveCount(3)
      await expect(readouts.nth(0), 'In').toHaveText('0:00.0')
      await expect(readouts.nth(1), 'Length: not "61:40.0"').toHaveText('1:01:40.0')
      await expect(readouts.nth(2), 'Out').toHaveText('1:01:40.0')
      await expect(window.getByRole('button', { name: 'Select clip Clip 1, 0:00 → 1:01:40' }), 'the clip list').toBeVisible()
      await expect(window.locator('[data-tutorial="video-player"] .font-mono'), 'the player: position / length').toContainText(/\/ 1:01:4\d\.\d\d$/)
      const slider = window.locator('[data-tutorial="video-timeline"] [role="slider"]')
      await expect(slider).toHaveAttribute('aria-valuetext', '0:00.0')
      // A time under the hour is untouched by all of it: the playhead moved to 59 min 59 s reads "59:59.0", not "0:59:59.0".
      await slider.focus()
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        if (v) v.currentTime = 3599
      })
      await expect(slider).toHaveAttribute('aria-valuetext', '59:59.0', { timeout: 15_000 })
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        if (v) v.currentTime = 3600
      })
      await expect(slider).toHaveAttribute('aria-valuetext', '1:00:00.0', { timeout: 15_000 })
    } finally {
      await app.close()
    }
  })

  test('a folder deleted after it was chosen is made again; one that cannot be made is named, before anything is encoded (T-125 (10))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t125remake')
    try {
      const gif = gifCard(window)
      // ── chosen, then deleted behind the app's back: the export makes it again and the file lands ──
      await stubDialogs(app, { open: [outDir] })
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
      await expect(gif.getByRole('button', { name: `Output folder: ${path.basename(outDir)}` })).toBeVisible()
      rmSync(outDir, { recursive: true, force: true })
      expect(existsSync(outDir)).toBe(false)
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expect.poll(() => existsSync(path.join(outDir, 'pipeline_Clip 1_480px_15fps.gif')), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled()

      // ── a folder that cannot be made (a file where a parent should be): a sentence that names it ──
      const blocker = path.join(root, `blocker-${Date.now().toString(36)}.txt`)
      writeFileSync(blocker, 'a file, not a folder')
      const unmakeable = path.join(blocker, 'Clips')
      await stubDialogs(app, { open: [unmakeable] })
      await gif.getByRole('button', { name: `Output folder: ${path.basename(outDir)}` }).click()
      await expect(gif.getByRole('button', { name: 'Output folder: Clips' })).toBeVisible()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      const sentence = `Couldn't create the folder "Clips". If it is on a drive that isn't connected, plug the drive in or choose another folder.`
      await expectToast(window, sentence)
      const log = (await readToastLog(window)).join(' | ')
      expect(log, 'not the old misleading line').not.toMatch(/A file imagii needs/)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 30_000 })
      expect(existsSync(unmakeable)).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('compilation: every clip keeps the crop it was drawn with — the cropped clip has no red block, the uncropped one beside it does (T-96)', async () => {
    test.setTimeout(600_000)
    // Clip 1 is cropped 1:1 (excluding the red block); Clip 2, added after, has
    // no crop. The compilation is 1920x1080 either way, 4 s long: the first 2 s
    // are Clip 1, the next 2 s Clip 2.
    const { app, window, outDir } = await launchWithVideo('t96compile', cropMarkerSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()

      const card = compileCard(window)
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()

      const output = path.join(outDir, 'cropmarker_compilation.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
      const probe = await ffprobeJson(output)
      const v = videoStream(probe)
      expect([v.width, v.height]).toEqual([1920, 1080])
      expect(Number(probe.format?.duration)).toBeGreaterThan(2 * CLIP_SECONDS - 0.5)
      // Clip 1 (0-2 s): cropped, so no red anywhere in the frame.
      expect(await redPixelCount(output, 1), 'Clip 1 is cropped: no red block').toBe(0)
      // Clip 2 (2-4 s): no crop, so the red block is there — the control that
      // makes the absence above mean something.
      expect(await redPixelCount(output, 3), 'Clip 2 is not cropped: red block present').toBeGreaterThan(5000)
    } finally {
      await app.close()
    }
  })

  test('compilation: each clip is compiled as the clip it was built — 2x, brightened and zoomed beside a plain one, with the sound at its speed (T-105)', async () => {
    test.setTimeout(600_000)
    // pipeline.mp4 is 2 s of 320x240 testsrc2 with a 440 Hz tone. Clip 1 is set
    // to 2x, brightness +0.5 and Auto Zoom through the real controls; Clip 2,
    // added after, is plain. Compile carried a clip's range and its crop and
    // nothing else, so both clips came out at 1x and the same color: a 4 s file.
    // The sound is read too — a picture sped up over a tone left at its own
    // length is the "2x clip compiles at 1x, audio included" half of the bug.
    const { app, window, outDir } = await launchWithVideo('t105compile')
    try {
      await stubDialogs(app, { open: [outDir] })
      const clips = clipListCard(window)
      const speed = clips.getByRole('slider', { name: 'Clip playback speed' })
      await speed.fill('2')
      await expect(speed).toHaveValue('2')
      await window.getByRole('slider', { name: 'Brightness', exact: true }).fill('0.5')
      await window.getByRole('checkbox', { name: 'Auto-zoom (gentle pulse)' }).check()
      await clips.getByRole('button', { name: '+ Add clip' }).click()
      await expect(speed).toHaveValue('1') // Clip 2 is selected, and carries none of it

      const card = compileCard(window)
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()

      const output = path.join(outDir, 'pipeline_compilation.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()

      const probe = await ffprobeJson(output)
      // Clip 1: 2 s at 2x = 1 s. Clip 2: 2 s. 3 s in all, not 4 (and not 3.2:
      // Auto Zoom stamped at zoompan's own 25 fps made a clip a fifth too long).
      expect(Number(probe.format?.duration)).toBeGreaterThan(2.8)
      expect(Number(probe.format?.duration)).toBeLessThan(3.2)
      const audio = probe.streams?.find((x) => x.codec_type === 'audio') as
        | (ProbeStream & { duration?: string })
        | undefined
      expect(audio, 'the compilation has its sound').toBeDefined()
      expect(Number(audio?.duration), 'and the sound follows the speed').toBeGreaterThan(2.7)
      expect(Number(audio?.duration)).toBeLessThan(3.3)
      // Clip 1 (0-1 s) is the brightened one; 0.5 s of it and 1 s into Clip 2
      // (output 2.0 s) are the same moment of the source, so the difference is
      // the grade and nothing else.
      const brightened = await frameLuma(output, 0.5)
      const plain = await frameLuma(output, 2.0)
      expect(brightened - plain, `Clip 1 luma ${brightened}, Clip 2 luma ${plain}`).toBeGreaterThan(40)
    } finally {
      await app.close()
    }
  })

  test('compilation: each clip has a verdict row in the grid\'s own words, and it follows the crop (T-105)', async () => {
    test.setTimeout(120_000)
    // fullHdSrc is 1920x1080: exactly the compilation's frame, so uncropped it is
    // "Great" and a 9:16 crop is the only thing that can change a row.
    const { app, window } = await launchWithVideo('t105verdict', fullHdSrc)
    try {
      const clips = clipListCard(window)
      await clips.getByRole('button', { name: '+ Add clip' }).click()
      await clips.getByRole('button', { name: 'Select clip Clip 1' }).click()

      const card = compileCard(window)
      const rows = card.getByRole('list', { name: 'How each clip fits the compilation' }).getByRole('listitem')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0)).toContainText('Clip 1')
      await expect(rows.nth(1)).toContainText('Clip 2')
      for (const n of [0, 1]) await expect(rows.nth(n).getByText('Great', { exact: true })).toBeVisible()

      // ── a 9:16 crop on Clip 1: the row says what the cut loses, in the grid's words ──
      const WIDE_ON_TALL = "Only the middle 32% of the picture's height fits this shape"
      const SOFT = 'The picture is smaller than this output — it will be scaled up and look soft'
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '9:16', exact: true })
        .click()
      await expect(rows.nth(0).getByText('Wrong shape', { exact: true })).toBeVisible()
      await expect(rows.nth(0).getByText(WIDE_ON_TALL, { exact: false })).toBeVisible()
      await expect(rows.nth(0).getByText(SOFT, { exact: false })).toBeVisible()
      // ...Clip 2 has no crop of its own, and its row did not move
      await expect(rows.nth(1).getByText('Great', { exact: true })).toBeVisible()
      await expect(rows.nth(1)).not.toContainText('Wrong shape')

      // ── the same words the export grid uses for the same crop ──
      const youtube = exportCard(window)
        .locator('[data-export-target]')
        .filter({ has: window.getByRole('checkbox', { name: 'YouTube', exact: true }) })
      await expect(youtube.getByText('Wrong shape', { exact: true })).toBeVisible()
      await expect(youtube.getByText(WIDE_ON_TALL, { exact: false })).toBeVisible()
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-17-compile-verdict.png') })

      // ── the crop cleared gives the row back ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()
      await expect(rows.nth(0).getByText('Great', { exact: true })).toBeVisible()
      await expect(rows.nth(0)).not.toContainText('Wrong shape')
    } finally {
      await app.close()
    }
  })

  test('gif: the "over about 10 s" warning counts the GIF that will be written, at the speed on the panel (T-105)', async () => {
    test.setTimeout(180_000)
    const WARNING = 'GIF exports over about 10 s get huge. Trim the clip first.'

    // ── a 14 s clip is warned at 1x, and the GIF at 2x is only 7 s ──
    const long = await launchWithVideo('t105gifwarn-long', burstSrc)
    try {
      const card = gifCard(long.window)
      const speed = card.locator('select').nth(2)
      await expect(card.getByText(WARNING)).toBeVisible() // 14 s at 1x
      await speed.selectOption('2') // 7 s
      await expect(card.getByText(WARNING)).toHaveCount(0)
      await speed.selectOption('1.5') // 9.3 s
      await expect(card.getByText(WARNING)).toHaveCount(0)
      await speed.selectOption('0.5') // 28 s
      await expect(card.getByText(WARNING)).toBeVisible()
      await speed.selectOption('3') // 4.7 s
      await expect(card.getByText(WARNING)).toHaveCount(0)
    } finally {
      await long.app.close()
    }

    // ── a 6 s clip is fine at 1x, and a 0.5x GIF of it is 12 s ──
    const short = await launchWithVideo('t105gifwarn-short', shortSrc)
    try {
      const card = gifCard(short.window)
      const speed = card.locator('select').nth(2)
      await expect(card.getByText(WARNING)).toHaveCount(0) // 6 s at 1x

      // T-114: the live region is always mounted (so a warning that appears is announced), and an
      // empty one used to be a flex item like any other: 12 px of gap above it AND 12 px below, a
      // 12 px hole between the header and the first control for as long as there is nothing to say.
      // Measured on the live page: the gap from the header to the controls is ONE gap, with the
      // warning absent; and the region is still in the accessibility tree, empty, ready to speak.
      const gaps = async (): Promise<{ headerToControls: number; headerToStatus: number }> =>
        card.evaluate((el) => {
          const header = el.querySelector('h3')!.getBoundingClientRect()
          const controls = el.querySelector('.grid')!.getBoundingClientRect()
          const status = el.querySelector('[role="status"]')!.getBoundingClientRect()
          return { headerToControls: controls.top - header.bottom, headerToStatus: status.top - header.bottom }
        })
      const quiet = await gaps()
      expect(quiet.headerToControls, 'one gap, not two').toBeGreaterThan(8)
      expect(quiet.headerToControls, 'one gap, not two').toBeLessThan(16)
      await expect(card.getByRole('status')).toHaveCount(1)
      await expect(card.getByRole('status')).toHaveText('')
      await expect(card.getByRole('status')).toHaveCSS('display', 'block')
      await expect(card.getByRole('status')).not.toHaveCSS('visibility', 'hidden')
      await speed.selectOption('0.5') // 12 s
      await expect(card.getByText(WARNING)).toBeVisible()
      await speed.selectOption('1')
      await expect(card.getByText(WARNING)).toHaveCount(0)
    } finally {
      await short.app.close()
    }
  })

  test('a second GIF, compilation and export with the same settings land beside the first and never over it, and each panel points at the file it wrote (T-106)', async () => {
    test.setTimeout(600_000)
    // The GIF's name is its source, width and frame rate; the compilation's is
    // its source; the export's is the template. The next job with the same
    // settings replaced the last, silently — and because T-100 deletes what a
    // canceled job was writing, a Cancel on that second job took the first one's
    // finished file with it. Each second run below differs in CONTENT where it
    // can (a faster GIF, a faster Clip 1), so a file that was rewritten differs
    // from the one that was there; where it cannot (Clip 2 is the same in both
    // batches), the numbered NAME is the evidence.
    const { app, window, outDir } = await launchWithVideo('t106dup')
    try {
      await stubDialogs(app, { open: [outDir] })
      const revealButton = window
        .locator('[data-rht-toaster]')
        .getByRole('button', { name: 'Show in folder', exact: true })
      const gifs = (): string[] => readdirSync(outDir).filter((f) => f.endsWith('.gif')).sort()

      // ── GIF ──
      const gif = gifCard(window)
      await gif.locator('select').nth(0).selectOption('320')
      await gif.locator('select').nth(1).selectOption('12')
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      const gifFirst = path.join(outDir, 'pipeline_Clip 1_320px_12fps.gif')
      await expect.poll(() => existsSync(gifFirst), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(gifFirst)}`)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled()
      const gifFirstSha = sha256(gifFirst)

      await expect(revealButton, 'the first toast is gone').toHaveCount(0, { timeout: 20_000 })
      await stubShellReveal(app)
      await gif.locator('select').nth(2).selectOption('2') // same name, different frames
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      const gifSecond = path.join(outDir, 'pipeline_Clip 1_320px_12fps (2).gif')
      await expect.poll(() => existsSync(gifSecond), { timeout: 540_000, intervals: [500] }).toBe(true)
      // T-112: the numbered name is IN the toast, so "(2)" is never a surprise in the folder.
      await expectToast(window, `Saved ${path.basename(gifSecond)}`)
      await expectRevealToast(window, app, gifSecond)
      expect(gifs()).toEqual(['pipeline_Clip 1_320px_12fps (2).gif', 'pipeline_Clip 1_320px_12fps.gif'])
      expect(sha256(gifFirst), 'the first GIF is byte for byte what it was').toBe(gifFirstSha)
      expect(sha256(gifSecond), 'and the second is a different GIF').not.toBe(gifFirstSha)

      // ── Compile ──
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const compile = compileCard(window)
      await compile.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await expectFolderShown(compile, outDir, 'Compile after the GIF pick')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      const compFirst = path.join(outDir, 'pipeline_compilation.mp4')
      await expect.poll(() => existsSync(compFirst), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(compFirst)}`)
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
      const compFirstSha = sha256(compFirst)
      expect(Number((await ffprobeJson(compFirst)).format?.duration)).toBeGreaterThan(3.5)

      await expect(revealButton, 'the compilation toast is gone').toHaveCount(0, { timeout: 20_000 })
      await stubShellReveal(app)
      await clipListCard(window).getByRole('button', { name: 'Select clip Clip 1' }).click()
      await clipListCard(window).getByRole('slider', { name: 'Clip playback speed' }).fill('2')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      const compSecond = path.join(outDir, 'pipeline_compilation (2).mp4')
      await expect.poll(() => existsSync(compSecond), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(compSecond)}`)
      await expectRevealToast(window, app, compSecond)
      expect(readdirSync(outDir).filter((f) => f.includes('_compilation')).sort()).toEqual([
        'pipeline_compilation (2).mp4',
        'pipeline_compilation.mp4'
      ])
      expect(sha256(compFirst), 'the first compilation is byte for byte what it was').toBe(compFirstSha)
      const secondLength = Number((await ffprobeJson(compSecond)).format?.duration)
      expect(secondLength, 'the second is the sped-up one: 1 s + 2 s').toBeLessThan(3.4)

      // ── Export (two jobs, run twice) ──
      const exportPanel = exportCard(window)
      await exportPanel.getByRole('button', { name: 'Choose folder…' }).click()
      await exportPanel.getByPlaceholder('{source}_{clip}_{preset}').fill('{clip}-{preset}')
      await clipListCard(window).getByRole('slider', { name: 'Clip playback speed' }).fill('1')
      await exportPanel.getByRole('button', { name: 'Export 2 files' }).click()
      const exportFirst = ['Clip 1-youtube.mp4', 'Clip 2-youtube.mp4']
      await expect
        .poll(() => readdirSync(outDir).filter((f) => f.endsWith('-youtube.mp4')).sort(), {
          timeout: 540_000,
          intervals: [500]
        })
        .toEqual(exportFirst)
      await expectToast(window, 'Exported 2 files')
      await expect(exportPanel.getByRole('button', { name: 'Export 2 files' })).toBeEnabled({ timeout: 30_000 })
      // T-112: each row shows the file it wrote, by the name it was given.
      await expect(exportPanel.getByText('Clip 1-youtube.mp4', { exact: true })).toBeVisible()
      await expect(exportPanel.getByText('Clip 2-youtube.mp4', { exact: true })).toBeVisible()
      const exportFirstShas = exportFirst.map((f) => sha256(path.join(outDir, f)))

      // Clip 1 at 2x, so the same name would hold different video.
      await clipListCard(window).getByRole('slider', { name: 'Clip playback speed' }).fill('2')
      await stubShellReveal(app)
      await exportPanel.getByRole('button', { name: 'Export 2 files' }).click()
      const exportSecond = ['Clip 1-youtube (2).mp4', 'Clip 2-youtube (2).mp4']
      await expect
        .poll(() => readdirSync(outDir).filter((f) => f.endsWith('-youtube (2).mp4')).sort(), {
          timeout: 540_000,
          intervals: [500]
        })
        .toEqual(exportSecond)
      await expect(exportPanel.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(2, {
        timeout: 60_000
      })
      // T-112: and the numbered name is on the row, so "(2)" is never a surprise in the folder.
      await expect(exportPanel.getByText('Clip 1-youtube (2).mp4', { exact: true })).toBeVisible()
      await expect(exportPanel.getByText('Clip 2-youtube (2).mp4', { exact: true })).toBeVisible()
      expect(
        exportFirst.map((f) => sha256(path.join(outDir, f))),
        'the first batch is byte for byte what it was'
      ).toEqual(exportFirstShas)
      // The row's button reveals the file that row wrote — the one with the number.
      await exportPanel.getByRole('button', { name: 'Show in folder', exact: true }).first().click()
      await expect
        .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
        .toEqual([path.join(outDir, 'Clip 1-youtube (2).mp4')])
    } finally {
      await app.close()
    }
  })

  test('a second Reframe and a second picture-in-picture with the same settings land beside the first, and each panel points at the file it wrote (T-106)', async () => {
    test.setTimeout(600_000)
    // The reframe's name is its source, size and position; the composite's is its
    // base. Both used to be replaced by the next job with the same settings.
    const { app, window, outDir } = await launchWithVideo('t106dup2')
    try {
      const revealButton = window
        .locator('[data-rht-toaster]')
        .getByRole('button', { name: 'Show in folder', exact: true })

      // ── Reframe, twice, the same settings ──
      await stubDialogs(app, { open: [outDir] })
      const reframe = reframeCard(window)
      await reframe.getByRole('button', { name: 'Choose folder…' }).click()
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const reframeFirst = path.join(outDir, 'pipeline_Clip 1_reframe-1080x1920-center.mp4')
      await expect.poll(() => existsSync(reframeFirst), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(reframeFirst)}`)
      await expect(reframe.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({ timeout: 60_000 })
      const reframeFirstSha = sha256(reframeFirst)

      await expect(revealButton, 'the first toast is gone').toHaveCount(0, { timeout: 20_000 })
      await stubShellReveal(app)
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const reframeSecond = path.join(outDir, 'pipeline_Clip 1_reframe-1080x1920-center (2).mp4')
      await expect.poll(() => existsSync(reframeSecond), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(reframeSecond)}`)
      await expectRevealToast(window, app, reframeSecond)
      expect(mp4sIn(outDir).filter((f) => f.includes('_reframe'))).toEqual([
        'pipeline_Clip 1_reframe-1080x1920-center (2).mp4',
        'pipeline_Clip 1_reframe-1080x1920-center.mp4'
      ])
      expect(sha256(reframeFirst), 'the first reframe is byte for byte what it was').toBe(reframeFirstSha)
      expect(videoStream(await ffprobeJson(reframeSecond)).height).toBe(1920)

      // ── picture-in-picture, twice: the second with a different margin ──
      // (the pointer is still on the toast the reveal pressed, and react-hot-toast
      // keeps a hovered toast alive: move off it, then wait for it to go)
      await window.mouse.move(2, 2)
      await expect(revealButton, 'the reframe toast is gone').toHaveCount(0, { timeout: 20_000 })
      await stubDialogs(app, { open: [clipSrc, pipSrc] })
      const pip = pipCard(window)
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await expectFolderShown(pip, outDir, 'Picture-in-picture after the Reframe pick')
      await pip.getByRole('button', { name: 'Composite' }).click()
      const pipFirst = path.join(outDir, 'pipeline_pip.mp4')
      await expect.poll(() => existsSync(pipFirst), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(pipFirst)}`)
      await expect(pip.getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 60_000 })
      const pipFirstSha = sha256(pipFirst)

      await expect(revealButton, 'the first composite toast is gone').toHaveCount(0, { timeout: 20_000 })
      await stubShellReveal(app)
      await pip.getByRole('spinbutton').nth(1).fill('8') // margin: same name, different pixels
      await pip.getByRole('button', { name: 'Composite' }).click()
      const pipSecond = path.join(outDir, 'pipeline_pip (2).mp4')
      await expect.poll(() => existsSync(pipSecond), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(pipSecond)}`)
      await expectRevealToast(window, app, pipSecond)
      expect(mp4sIn(outDir).filter((f) => f.includes('_pip'))).toEqual([
        'pipeline_pip (2).mp4',
        'pipeline_pip.mp4'
      ])
      expect(sha256(pipFirst), 'the first composite is byte for byte what it was').toBe(pipFirstSha)
      expect(sha256(pipSecond), 'and the second is a different file').not.toBe(pipFirstSha)
    } finally {
      await app.close()
    }
  })

  test('a vanished source fails Reframe, GIF, Compile and PiP in each panel\'s own plain words, and frees each panel (T-84)', async () => {
    test.setTimeout(300_000)
    // The ordinary failure again — imported, then moved — met by every panel
    // that spawns its own ffmpeg. Each panel's catch is its own site, so each
    // is driven; the toast leads with ITS sentence and ends in the one cause.
    const moved = path.join(root, 'source', `vanish-${Date.now().toString(36)}.mp4`)
    copyFileSync(clipSrc, moved)
    const studio = await launchWithVideo('vanish', moved)
    const { app, window, outDir } = studio
    try {
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click() // Compile needs 2
      rmSync(moved)
      const CAUSE = "A file imagii needs isn't there. It may have been moved or deleted."
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))

      // ── Reframe ──
      await stubDialogs(app, { open: [outDir] })
      const reframe = reframeCard(window)
      await reframe.getByRole('button', { name: 'Choose folder…' }).click()
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      await expectToast(window, `Reframe failed. ${CAUSE}`)
      await expect(reframe.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({
        timeout: 30_000
      })

      // ── GIF ──
      const gif = gifCard(window)
      await expectFolderShown(gif, outDir, 'GIF after the Reframe pick')
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expectToast(window, `GIF export failed. ${CAUSE}`)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 30_000 })

      // ── Compile ──
      const compile = compileCard(window)
      await expectFolderShown(compile, outDir, 'Compile after the Reframe pick')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expectToast(window, `Compilation failed. ${CAUSE}`)
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({
        timeout: 30_000
      })

      // ── PiP: the base is the file that moved ──
      await stubDialogs(app, { open: [moved, pipSrc] })
      const pip = pipCard(window)
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await expectFolderShown(pip, outDir, 'Picture-in-picture after the Reframe pick')
      await pip.getByRole('button', { name: 'Composite' }).click()
      await expectToast(window, `Picture-in-picture failed. ${CAUSE}`)
      await expect(pip.getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 30_000 })

      // Four errors, four error toasts — and not one word of ffmpeg's.
      const entries = await readToastEntries(window)
      const failures = entries.filter((e) => e.text.endsWith(CAUSE))
      expect(failures).toHaveLength(4)
      expect(failures.every((e) => e.hasIcon)).toBe(true)
      expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
        /ffprobe|ffmpeg|\bexit\b|No such file|Error invoking remote method/i
      )
      // The raw errors are in the console, one per panel.
      await expect
        .poll(() => consoleLines.filter((l) => /No such file or directory/.test(l)).length, {
          timeout: 30_000
        })
        .toBeGreaterThanOrEqual(4)
      expect(mp4sIn(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('cancelling a reframe, a GIF and a compilation is a neutral toast in each panel\'s own words, and frees the panel (T-84)', async () => {
    test.setTimeout(600_000)
    // The 20-minute source: each job is still running when Cancel is clicked.
    const studio = await launchWithVideo('cancelpanels', longSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      // Compile only renders with two clips; the second is full-length too.
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()

      // ── Reframe ──
      const reframe = reframeCard(window)
      await reframe.getByRole('button', { name: 'Choose folder…' }).click()
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const reframeCancel = reframe.getByRole('button', { name: 'Cancel', exact: true })
      await expect(reframeCancel).toBeVisible({ timeout: 30_000 })
      await reframeCancel.click()
      await expectCanceledNotFailed(window, 'Reframe canceled.')
      await expect(reframe.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({
        timeout: 30_000
      })
      await expect(reframeCancel).toHaveCount(0)

      // ── GIF ──
      const gif = gifCard(window)
      await expectFolderShown(gif, outDir, 'GIF after the Reframe pick')
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      const gifCancel = gif.getByRole('button', { name: 'Cancel', exact: true })
      await expect(gifCancel).toBeVisible({ timeout: 30_000 })
      await gifCancel.click()
      await expectCanceledNotFailed(window, 'GIF canceled.')
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({
        timeout: 30_000
      })
      await expect(gifCancel).toHaveCount(0)

      // ── Compilation ──
      const compile = compileCard(window)
      await expectFolderShown(compile, outDir, 'Compile after the Reframe pick')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      const compileCancel = compile.getByRole('button', { name: 'Cancel', exact: true })
      await expect(compileCancel).toBeVisible({ timeout: 30_000 })
      await compileCancel.click()
      await expectCanceledNotFailed(window, 'Compilation canceled.')
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      await expect(compileCancel).toHaveCount(0)

      // None of the three left a finished file behind it as if it had worked.
      expect(mp4sIn(outDir).filter((f) => f.endsWith('_compilation.mp4'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a Cancel pressed before the job\'s ffmpeg exists still cancels Reframe, a cropped GIF, Compile and the highlight scan (T-98)', async () => {
    test.setTimeout(300_000)
    // Every one of these probes the source before it spawns, and a Cancel in
    // that wait found no child to kill: it returned false and the job started
    // anyway, then finished under the toast that said it was canceled. The
    // probe is ~40 ms wide, so every ffprobe is held for 6 s and the click
    // lands inside it. Each panel must free itself well inside the hold (the
    // wait ends at once — it does not wait the probe out) and not one ffmpeg
    // may ever have been started.
    const studio = await launchWithVideo('probecancel', clipSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click() // Compile needs 2
      // T-115: the new clip's hook badge asks main for its loudness 250 ms after the clip is selected
      // (a real ffmpeg). That one is the badge's, not a job's: let it finish before the log is watched
      // for strays, or it lands inside the window this test asserts is empty of encoders.
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffprobe', ms: 6000 }])

      // ── Reframe — and its progress row speaks English while it waits (T-100) ──
      const reframe = reframeCard(window)
      await reframe.getByRole('button', { name: 'Choose folder…' }).click()
      await reframe.getByRole('button', { name: 'Reframe to 9:16' }).click()
      const reframeCancel = reframe.getByRole('button', { name: 'Cancel', exact: true })
      await expect(reframeCancel).toBeVisible({ timeout: 30_000 })
      await expect(reframe.getByText('Checking the video…')).toBeVisible()
      await expect(reframe.getByText(/ANALYZING|STARTING|RENDERING|analyzing|starting/)).toHaveCount(0)
      // T-108: checking the source has no length to measure, so the bar is the
      // indeterminate one — no value on it and no "0%" beside it. (`analyzing` used to
      // send percent 0, which the panel drew as a bar at nothing with a number.)
      const checking = reframe.getByRole('progressbar')
      await expect(checking).toHaveAccessibleName('Checking the video…')
      await expect(checking).not.toHaveAttribute('aria-valuenow', /.*/)
      await expect(checking.locator('.progress-indeterminate')).toHaveCount(1)
      await expect(reframe.getByText(/\d+%/)).toHaveCount(0)
      await reframeCancel.click()
      await expectCanceledNotFailed(window, 'Reframe canceled.')
      await expect(reframe.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled({
        timeout: 4000
      })

      // ── GIF (a crop makes it probe first) ──
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      const gif = gifCard(window)
      await expectFolderShown(gif, outDir, 'GIF after the Reframe pick')
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      const gifCancel = gif.getByRole('button', { name: 'Cancel', exact: true })
      await expect(gifCancel).toBeVisible({ timeout: 30_000 })
      await gifCancel.click()
      await expectCanceledNotFailed(window, 'GIF canceled.')
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 4000 })

      // ── Compile ──
      const compile = compileCard(window)
      await expectFolderShown(compile, outDir, 'Compile after the Reframe pick')
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      const compileCancel = compile.getByRole('button', { name: 'Cancel', exact: true })
      await expect(compileCancel).toBeVisible({ timeout: 30_000 })
      await compileCancel.click()
      await expectCanceledNotFailed(window, 'Compilation canceled.')
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({
        timeout: 4000
      })

      // ── the highlight scan (single-slot cancel, no job id) ──
      const scan = highlightCard(window)
      await scan.getByRole('button', { name: 'Scan VOD' }).click()
      const scanCancel = scan.getByRole('button', { name: 'Cancel', exact: true })
      await expect(scanCancel).toBeVisible({ timeout: 30_000 })
      await scanCancel.click()
      await expectCanceledNotFailed(window, 'Scan canceled.')
      await expect(scan.getByRole('button', { name: 'Scan VOD' })).toBeEnabled({ timeout: 4000 })

      // Wait out the last hold: still no encoder, still nothing written.
      await window.waitForTimeout(7000)
      expect((await readSpawnLog(app)).filter((k) => k !== 'ffprobe')).toEqual([])
      expect(readdirSync(outDir)).toEqual([])
      const shown = (await readToastLog(window)).join(' | ')
      expect(shown).not.toMatch(/Saved the|Found \d+ highlight|No standout/)
    } finally {
      await app.close()
    }
  })
})

// ═══════════════════════════ PostChecklist (4r) ════════════════════════════

test.describe('PostChecklist', () => {
  test('title ideas and hashtag packs reach the real clipboard', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('post')
    const { app, window } = studio
    try {
      const card = postCard(window)
      await expect(card.getByText('Posting helpers')).toBeVisible()
      // Nothing generated yet.
      await expect(card.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(1)

      // ── four titles, each with its own copy button ──
      await card.getByRole('button', { name: 'Title starters' }).click()
      const titleRows = card.locator('li')
      await expect(titleRows).toHaveCount(4)
      const first = (await titleRows.first().innerText()).replace(/\s*Copy$/, '').trim()
      expect(first.length).toBeGreaterThan(0)

      // ── the copy button really writes to the OS clipboard ──
      // Read back from the MAIN process, so no page permission is involved.
      await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel-before-copy'))
      await titleRows.first().getByRole('button', { name: 'Copy', exact: true }).click()
      await expectToast(window, 'Copied')
      await expect.poll(() => systemClipboard(app), { timeout: 10_000 }).toBe(first)

      // ── hashtag packs: the select swaps the pack AND what copy yields ──
      const pack = card.getByLabel('Hashtag pack')
      await expect(pack).toHaveValue('twitch_clip')
      await expect(card.locator('code')).toHaveText(
        '#Twitch #TwitchClip #StreamHighlight #GamingClip'
      )
      await pack.selectOption('gaming_short')
      await expect(card.locator('code')).toHaveText(
        '#Shorts #Gaming #Gameplay #FYP #StreamerLife'
      )
      // The pack's copy button is the last one in the card — the four
      // title rows above it are the others.
      await card.getByRole('button', { name: 'Copy', exact: true }).last().click()
      await expect
        .poll(() => systemClipboard(app), { timeout: 10_000 })
        .toBe('#Shorts #Gaming #Gameplay #FYP #StreamerLife')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-11-postchecklist.png') })

      // Every pack in the select is a real pack, not an empty option.
      for (const id of ['reaction', 'ig_reels_general', 'tiktok_general', 'yt_long']) {
        await pack.selectOption(id)
        await expect(card.locator('code')).toContainText('#')
      }
      // T-92: the picker shows names a person would say, not the ids behind
      // them ("ig reels general", "yt long").
      await expect(pack.locator('option')).toHaveText([
        'Twitch clip',
        'Gaming short',
        'Reaction',
        'Instagram Reels, general',
        'TikTok, general',
        'YouTube, long video'
      ])
    } finally {
      await app.close()
    }
  })

  test('logging a post writes a posting-log entry to the settings store, and deleting it (after a confirm) takes it back out', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('diary')
    const { app, window, userDataDir } = studio
    try {
      const card = postCard(window)
      const name = card.getByPlaceholder('Clip name')
      const notes = card.getByPlaceholder('Notes (caption, time, etc.)')
      const log = card.getByRole('button', { name: '+ Log post' })

      // ── negative: an unnamed post is refused in the app's own words ──
      await log.click()
      await expectToast(window, 'Add a clip name first')
      await expect(card.getByText(/^Logged posts \(/)).toHaveCount(0)
      expect(readConfig(userDataDir).postingDiary).toBeUndefined()

      // ── all seven platform toggles are multi-select and reversible ──
      // T-123 (17): Facebook is the one the Clip Kit writes a file for (`*_facebook.mp4`) and the log had no chip for.
      const platforms = ['YouTube', 'Reels', 'TikTok', 'X', 'Facebook', 'Twitch', 'Discord']
      const toggle = (p: string): Locator => card.getByRole('button', { name: p, exact: true })
      // T-113: each toggle says whether it is on to assistive tech (aria-pressed), not only by fill.
      for (const p of platforms) await expect(toggle(p)).toHaveAttribute('aria-pressed', 'false')
      for (const p of platforms) {
        await toggle(p).click()
        await expect(toggle(p)).toHaveClass(/bg-accent/)
        await expect(toggle(p)).toHaveAttribute('aria-pressed', 'true')
      }
      // Clicking again removes just that one — the rest stay selected.
      for (const p of ['Reels', 'X', 'Facebook', 'Twitch']) {
        await toggle(p).click()
        await expect(toggle(p)).not.toHaveClass(/bg-accent/)
        await expect(toggle(p)).toHaveAttribute('aria-pressed', 'false')
      }
      await expect(toggle('YouTube')).toHaveClass(/bg-accent/)
      await expect(toggle('YouTube')).toHaveAttribute('aria-pressed', 'true')
      await expect(toggle('TikTok')).toHaveClass(/bg-accent/)
      await toggle('Discord').click()
      await expect(toggle('Discord')).not.toHaveClass(/bg-accent/)

      // ── log it ──
      await name.fill('First Blood clip')
      await notes.fill('posted after the 8pm stream')
      await log.click()
      await expectToast(window, 'Added to your posting log')
      await expect(card.getByText('Logged posts (1)')).toBeVisible()
      const entry = card.locator('div.bg-bg-hover').filter({ hasText: 'First Blood clip' })
      await expect(entry).toContainText('YouTube · TikTok')
      await expect(entry).toContainText('posted after the 8pm stream')
      // The form resets so the next log is not a silent duplicate.
      await expect(name).toHaveValue('')
      await expect(notes).toHaveValue('')
      await expect(toggle('YouTube')).not.toHaveClass(/bg-accent/)
      await expect(toggle('TikTok')).not.toHaveClass(/bg-accent/)

      // ── T-20: the posting log lives in the settings store, not localStorage ──
      await expect
        .poll(() => (readConfig(userDataDir).postingDiary as unknown[])?.length, {
          timeout: 15_000
        })
        .toBe(1)
      const stored = readConfig(userDataDir).postingDiary as Array<Record<string, unknown>>
      expect(stored[0]).toMatchObject({
        outputName: 'First Blood clip',
        platforms: ['YouTube', 'TikTok'],
        notes: 'posted after the 8pm stream'
      })
      // ...and NOT in the renderer's localStorage, where it used to live.
      expect(
        await window.evaluate(() => localStorage.getItem('imagii.postingDiary'))
      ).toBeNull()

      // ── the three performance inputs persist per field ──
      const perf = entry.getByRole('spinbutton')
      await expect(perf).toHaveCount(3)
      await perf.nth(0).fill('1200')
      await perf.nth(1).fill('95')
      await perf.nth(2).fill('7')
      await expect
        .poll(
          () =>
            (readConfig(userDataDir).postingDiary as Array<{ performance?: unknown }>)[0]
              ?.performance,
          { timeout: 15_000 }
        )
        .toEqual({ views: 1200, likes: 95, comments: 7 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-12-diary.png') })

      // ── a second entry goes on top (newest first). T-123 (17): and it is a Facebook post, the platform the Clip Kit
      //    writes `*_facebook.mp4` for and the log had no chip for: logged, drawn in the row, and stored ──
      await toggle('Facebook').click()
      await name.fill('Second clip')
      await log.click()
      await expect(card.getByText('Logged posts (2)')).toBeVisible()
      await expect(card.locator('div.bg-bg-hover').filter({ hasText: 'Second clip' })).toContainText('Facebook')
      await expect
        .poll(() => {
          const d = readConfig(userDataDir).postingDiary as Array<{ outputName: string }>
          return d.map((e) => e.outputName)
        })
        .toEqual(['Second clip', 'First Blood clip'])
      expect((readConfig(userDataDir).postingDiary as Array<{ platforms: string[] }>)[0]?.platforms).toEqual(['Facebook'])

      // ── delete: Delete means gone for good, so it asks first (T-92) ──
      const asked: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        asked.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })
      await card.getByRole('button', { name: 'Delete entry' }).first().click()
      await expect
        .poll(() => asked, { timeout: 10_000 })
        .toEqual(['Delete "Second clip" from your posting log?'])
      // Cancel keeps it: still two on screen and on disk.
      await expect(card.getByText('Logged posts (2)')).toBeVisible()
      expect((readConfig(userDataDir).postingDiary as unknown[]).length).toBe(2)
      answer = 'accept'
      await card.getByRole('button', { name: 'Delete entry' }).first().click()
      await expect(card.getByText('Logged posts (1)')).toBeVisible()
      await expect
        .poll(() => {
          const d = readConfig(userDataDir).postingDiary as Array<{ outputName: string }>
          return d.map((e) => e.outputName)
        })
        .toEqual(['First Blood clip'])
      await card.getByRole('button', { name: 'Delete entry' }).first().click()
      await expect(card.getByText(/^Logged posts \(/)).toHaveCount(0)
      await expect.poll(() => readConfig(userDataDir).postingDiary).toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-123 (26): each logged post's row held three labelled number boxes (w-16 each: 337 px) in a list 274 px wide, so "comments"
  // and its box were pushed off the right edge behind the list's hidden horizontal scrollbar. A pasted id or link in the notes (the
  // likeliest thing to put there) is the other thing that widens a row. Clicking the box works either way (`click()` scrolls it
  // into view), which is why no behavior case saw it; this reads the geometry.
  test('a logged post wraps its views / likes / comments boxes and its notes inside the list, at the default window and the minimum (T-123 (26))', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('diary-layout')
    const { app, window } = studio
    try {
      await setWindowSize(app, window, DEFAULT_WINDOW)
      const card = postCard(window)
      const log = card.getByRole('button', { name: '+ Log post' })
      await card.getByPlaceholder('Clip name').fill('My great clip')
      await card.getByPlaceholder('Notes (caption, time, etc.)').fill('[0:05] a: POG [0:05] b: POG [0:05] c: NO WAY [0:06] d: KEKW')
      await log.click()
      await card.getByPlaceholder('Clip name').fill('Second clip')
      // One 128-character word (a pasted clip id or link with no place to break): it is wider than the 274 px list unless the notes wrap it.
      await card.getByPlaceholder('Notes (caption, time, etc.)').fill(`see ${'a1b2c3d4'.repeat(16)} for the clip`)
      await log.click()
      await expect(card.getByText('Logged posts (2)')).toBeVisible()

      const list = card.locator('div.max-h-60')
      const stats = list.getByRole('spinbutton')
      await expect(stats).toHaveCount(6)
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await expectNoHorizontalOverflow(list, `the Logged posts list at ${where}`)
        await expectNoHorizontalOverflow(card, `the posting helpers card at ${where}`)
        // Every box, and every label beside it ("comments" is the one that was off the edge), is inside the list.
        await expectControlsWhole(list, stats, `the stat boxes at ${where}`)
        await expectControlsWhole(list, list.locator('label'), `the stat labels at ${where}`)
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-13-diary-layout.png') })
    } finally {
      await app.close()
    }
  })
})


// ═══════════════ Open project — a file that moved (T-84) ═══════════════════

test.describe('Open project with a moved file', () => {
  /** A project file with a canvas, an audio source and a video source. */
  function writeProject(name: string, videoPath: string): string {
    const projectPath = path.join(root, `${name}-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 3,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: videoPath,
          clips: [],
          selectedClipId: null,
          watermark: null,
          srtPath: null
        },
        audioStudio: {
          sourcePath: clipSrc,
          fromVideoPath: null,
          chain: {
            denoise: 'off',
            hum60: false,
            rumbleHighpass: false,
            deEss: false,
            compressor: 'off',
            loudnorm: false,
            loudnormTargetLufs: -16,
            gainDb: 0,
            cutRegions: [],
            secondaryTrack: null
          }
        },
        imageCanvas: {
          doc: {
            width: 800,
            height: 450,
            background: '#101014',
            layers: [
              {
                id: 'kept-rect',
                type: 'rect',
                name: 'Kept rect',
                visible: true,
                locked: false,
                x: 10,
                y: 20,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                opacity: 1,
                width: 200,
                height: 100,
                fill: '#ff5c00',
                stroke: '#ffffff',
                strokeWidth: 2,
                cornerRadius: 4
              }
            ]
          }
        }
      }),
      'utf8'
    )
    return projectPath
  }

  test('opens the rest of the project, names the file that is gone, and a complete project still says "Project loaded" (T-84)', async () => {
    test.setTimeout(180_000)
    const studio = await launchHome('movedvideo')
    const { app, window } = studio
    try {
      await installToastLog(window)
      const gone = path.join(root, 'source', 'stream-that-moved.mp4') // never created
      const consoleLines: string[] = []
      window.on('console', (message) => consoleLines.push(message.text()))

      // ── the project whose video moved ──
      await stubDialogs(app, { open: [writeProject('moved', gone)] })
      await window.getByRole('button', { name: 'Open project' }).click()

      const MESSAGE =
        "Couldn't find stream-that-moved.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio.'
      await expectToast(window, "Couldn't find")
      const log = await readToastLog(window)
      // ONE message, naming the file — and not the success line beside it.
      expect(log.filter((t) => t.includes("Couldn't find"))).toEqual([MESSAGE])
      expect(log).not.toContain('Project loaded')
      expect(log.join(' | ')).not.toMatch(/ffprobe|No such file|Error invoking remote method/)
      await expect
        .poll(() => consoleLines.join('\n'), { timeout: 20_000 })
        .toContain('ffprobe')

      // ── the rest IS open: the canvas, then the audio, then an empty video ──
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.getByText('Layers (1)')).toBeVisible({ timeout: 20_000 })
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.getByText(path.basename(clipSrc), { exact: true })).toBeVisible({
        timeout: 30_000
      })
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await gotoVideoStudio(window)
      // Nothing half-loaded: the studio that lost its file is the empty one.
      await expect(window.getByText('Drop a video here')).toBeVisible()
      await window.locator('a[href="#/home"]').first().click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // ── the control: the same project with its video where it should be ──
      const before = (await readToastLog(window)).length
      await stubDialogs(app, { open: [writeProject('complete', clipSrc)] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).slice(before), { timeout: 30_000 })
        .toContain('Project loaded')
      expect((await readToastLog(window)).slice(before).join(' | ')).not.toContain("Couldn't find")
      await gotoVideoStudio(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
    } finally {
      await app.close()
    }
  })
})

// ═══════ T-107: a video converted on import survives its working copy ══════

test.describe('Open project with a converted import', () => {
  test('an flv is converted again when its project is opened after the working copy is gone: save, prune, relaunch, open (T-107)', async () => {
    test.setTimeout(420_000)
    // Dropping an flv/ts/wmv/mpg/3gp converts it to an mp4 working copy under
    // %TEMP%/imagii-import and the video studio's source IS that copy. Saving the project
    // stored its path, and the next launch deleted it: "Open project" said "Couldn't find
    // stream-aB3dE5fG.mp4" for a file the person never chose, with the original where they
    // dropped it. The project stores the original and a marker, and converts again on
    // open — the sound of that video (Audio Studio) the same way. This is the audio.spec
    // T-99 test's shape, for the video.
    const flv = path.join(root, 'source', 'e2e-clip.flv')
    await ffmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest',
      flv
    ])
    const imports = path.join(os.tmpdir(), 'imagii-import')
    const scratch = path.join(os.tmpdir(), 'imagii-audio')
    const listing = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])
    const importsBefore = new Set(listing(imports))
    const scratchBefore = new Set(listing(scratch))

    const studio = await launchHome('t107convert')
    const { app, window, userDataDir } = studio
    let second: ElectronApplication | null = null
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, flv, 'e2e-clip.flv')
      await expect
        .poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] })
        .toContain('Video loaded')
      await expect(window.locator('video')).toHaveCount(1)
      const copies = listing(imports).filter((f) => !importsBefore.has(f))
      expect(copies, 'one working copy was made').toHaveLength(1)
      const copy = path.join(imports, copies[0] as string)
      // The header names the file the person dropped, not "e2e-clip-aB3dE5fG.mp4".
      await expect(window.locator('header').getByText('e2e-clip.flv', { exact: true })).toBeVisible()

      // Its sound goes to Audio Studio too — the second door to the same working copy.
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect(
        window.locator('[data-tutorial="audio-waveform"]').getByRole('button', { name: 'Play', exact: true })
      ).toBeEnabled({ timeout: 60_000 })
      await expect(window.locator('header').getByText('e2e-clip.flv', { exact: true })).toBeVisible()
      const wavs = listing(scratch).filter((f) => !scratchBefore.has(f))
      expect(wavs, 'one scratch WAV was made').toHaveLength(1)
      const wav = path.join(scratch, wavs[0] as string)

      // ── save from Home ──
      const projectFile = path.join(root, `t107-${Date.now().toString(36)}.imagii.json`)
      await stubDialogs(app, { save: [projectFile] })
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Save project' }).click()
      await expect.poll(() => existsSync(projectFile), { timeout: 15_000 }).toBe(true)
      const raw = readFileSync(projectFile, 'utf8')
      const saved = JSON.parse(raw) as {
        schemaVersion: number
        videoStudio: { sourcePath: string; convertedForImport?: boolean }
        audioStudio: { sourcePath: string; extractedFromVideo?: boolean }
      }
      // The file names the ORIGINAL (both studios), says what was done to it, and holds
      // no path into either temp folder.
      expect(saved.schemaVersion).toBe(5)
      expect(saved.videoStudio.sourcePath).toBe(flv)
      expect(saved.videoStudio.convertedForImport).toBe(true)
      expect(saved.audioStudio.sourcePath).toBe(flv)
      expect(saved.audioStudio.extractedFromVideo).toBe(true)
      expect(raw).not.toContain('imagii-import')
      expect(raw).not.toContain('imagii-audio')
      expect(raw).not.toContain(path.basename(copy))

      // ── the next launch: both scratch files are gone ──
      await app.close()
      rmSync(copy)
      rmSync(wav)
      second = await launchApp(userDataDir)
      const window2 = await second.firstWindow()
      await window2.waitForLoadState('domcontentloaded')
      await expect(window2.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
      await installToastLog(window2)
      await stubDialogs(second, { open: [projectFile] })
      await window2.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(() => readToastLog(window2), { timeout: 120_000, intervals: [250] })
        .toContain('Project loaded')
      const opened = (await readToastLog(window2)).join(' | ')
      expect(opened).not.toMatch(/Couldn't find/)
      // The wait is a transcode, so it said so while it ran.
      expect(opened).toContain('Converting for editing')
      // T-112: and the sound's extraction, which waits as long, said so too (it waited silently).
      expect(opened).toContain('Extracting audio…')

      // The video is back — playing from a NEW working copy, still named for the original.
      await gotoVideoStudio(window2)
      await expect(window2.locator('video')).toHaveCount(1, { timeout: 30_000 })
      await expect(exportCard(window2).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      await expect(window2.locator('header').getByText('e2e-clip.flv', { exact: true })).toBeVisible()
      const fresh = listing(imports).filter((f) => !importsBefore.has(f))
      expect(fresh, 'it was converted again, under a new name').toHaveLength(1)
      expect(fresh[0]).not.toBe(path.basename(copy))
      expect(existsSync(copy), 'the old working copy was not needed').toBe(false)
      // ...and so is the sound.
      await window2.locator('a[href="#/home"]').first().click()
      await window2.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(
        window2.locator('[data-tutorial="audio-waveform"]').getByRole('button', { name: 'Play', exact: true })
      ).toBeEnabled({ timeout: 60_000 })
      await expect(window2.locator('header').getByText('e2e-clip.flv', { exact: true })).toBeVisible()

      // ── and an original that has moved is named, plainly, as the file that is gone ──
      rmSync(flv)
      await window2.locator('a[href="#/home"]').first().click()
      await window2.getByRole('button', { name: 'Open project' }).click()
      const GONE =
        "Couldn't find e2e-clip.flv. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio ' +
        'and the audio again in Audio Studio.'
      await expect
        .poll(() => readToastLog(window2), { timeout: 120_000, intervals: [250] })
        .toContain(GONE)
      expect((await readToastLog(window2)).join(' | ')).not.toMatch(/ffmpeg|convert-to-mp4|exit \d|Error invoking remote method/)
    } finally {
      try {
        await second?.close()
      } catch {
        /* ignore */
      }
      // The first app was closed on purpose (the relaunch); the second closes here.
      try {
        await app.close()
      } catch {
        /* already closed */
      }
    }
  })
})

// ═══════════════ T-92: terminology and microcopy mechanics ═════════════════

test.describe('T-92 microcopy mechanics', () => {
  test('each export checkbox is named for its platform; the size, fps and verdict are its description', async () => {
    test.setTimeout(120_000)
    // The reason text moved INTO each platform <label> in round 50 (T-83), so a
    // screen reader announced "YouTube 1920×1080 Great Picture is smaller than
    // this output — it will be enlarged, checkbox" for what is one tick box.
    // (T-97 reworded the reason: "...scaled up and look soft".)
    const { app, window } = await launchWithVideo('t92name')
    try {
      const card = exportCard(window)
      const platforms: Array<[string, string]> = [
        ['YouTube', '1920×1080 · 30 fps'],
        // T-130 (q): the same platform at 60 fps, its own card beside it.
        ['YouTube 1080p60', '1920×1080 · 60 fps'],
        ['Reels', '1080×1920 · 30 fps'],
        ['TikTok', '1080×1920 · 30 fps'],
        ['X / Twitter', '1280×720 · 30 fps'],
        ['Facebook', '1280×720 · 30 fps']
      ]
      for (const [name, facts] of platforms) {
        const box = card.getByRole('checkbox', { name, exact: true })
        await expect(box, `a checkbox named exactly "${name}"`).toHaveCount(1)
        await expect(box).toHaveAccessibleName(name)
        // The geometry (and the 30 fps every export is encoded at) and the
        // verdict are what it is DESCRIBED by, not what it is called.
        await expect(box).toHaveAccessibleDescription(new RegExp(facts))
      }
      // The verdict is part of the description too: this 320x240 fixture is
      // smaller than every output, and the card says so (T-97: in the words of
      // what will happen to the picture).
      await expect(card.getByRole('checkbox', { name: 'YouTube', exact: true })).toHaveAccessibleDescription(
        /scaled up and look soft/
      )

      // The whole card is still one big hit area, as it was when it was a
      // <label>: a click on the size line ticks the platform.
      // (YouTube is the platform a freshly loaded clip starts on.)
      const youtube = card.getByRole('checkbox', { name: 'YouTube', exact: true })
      await expect(youtube).toBeChecked()
      const sizeLine = card.getByText('1920×1080 · 30 fps', { exact: true })
      const at = await sizeLine.boundingBox()
      if (!at) throw new Error('size line has no box')
      await window.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
      await expect(youtube).not.toBeChecked()
      await window.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
      await expect(youtube).toBeChecked()
      await card.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-15-export-grid.png') })
    } finally {
      await app.close()
    }
  })

  test('the hook badge says what it measures, in words, with no unit a streamer has never seen', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t92hook')
    try {
      // T-112: the fixture clip is 2 s long, so the badge listens to the whole clip and the
      // words say 2 — the window used to run past the clip's end while the label said 3.
      // T-115: the spinner's title ("Analyzing the first 2 seconds…") also says "first 2 seconds", and the
      // ask now waits 250 ms before it starts, so the badge is found by what only the badge says.
      const badge = clipListCard(window).locator('span[title*="Based on how loud the first 2 seconds"]')
      await expect(badge).toHaveCount(1, { timeout: 30_000 })
      const title = (await badge.getAttribute('title')) ?? ''
      expect(title).toMatch(/Based on how loud the first 2 seconds are, not what's on screen$/)
      expect(title).not.toMatch(/LUFS|peak/i)
      // "First 2 s:", not "First 2s:" — units are spaced.
      await expect(clipListCard(window).getByText('First 2 s:')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('the custom-preset form saves a bare bitrate with its unit and refuses one too big to be kilobits', async () => {
    test.setTimeout(120_000)
    // ffmpeg reads a bare "192" as 192 BITS per second, so the form that took
    // exactly that saved an audio rate nothing could hear. The labels never
    // said which unit the field wanted either.
    const { app, window, userDataDir } = await launchWithVideo('t92bitrate')
    try {
      const presetsDir = path.join(userDataDir, 'export-presets')
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      const text = modal.locator('input[type="text"]')
      const save = modal.getByRole('button', { name: '+ Save preset' })

      await nameInput.fill('Bare numbers')
      await text.nth(1).fill('8000')
      await text.nth(2).fill('192')
      await save.click()
      await expectToast(window, 'Saved "Bare numbers"')
      const files = readdirSync(presetsDir)
      expect(files).toHaveLength(1)
      const onDisk = JSON.parse(
        readFileSync(path.join(presetsDir, files[0] as string), 'utf8')
      ) as Record<string, unknown>
      expect(onDisk).toMatchObject({ videoBitrate: '8000k', audioBitrate: '192k' })
      // The list reads the units out loud, and says fps with a space.
      await expect(modal.locator('li')).toContainText('1920×1080 · 30 fps · 8000 kbps · YouTube')

      // The fields show what was saved, so the unit the form assumed is visible.
      await expect(text.nth(1)).toHaveValue('8000k')
      await expect(text.nth(2)).toHaveValue('192k')

      // ── a number that can only be bits per second is refused, with the fix ──
      await nameInput.fill('Too big')
      await text.nth(1).fill('5000000')
      await save.click()
      await expectToast(
        window,
        '5000000 is too big to be kilobits per second. Write 5M instead.'
      )
      expect(readdirSync(presetsDir)).toHaveLength(1)

      // ── the labels say what the field wants ──
      await expect(modal.getByLabel('Video bitrate (e.g. 8M)')).toBeVisible()
      await expect(modal.getByLabel('Audio bitrate (e.g. 192k)')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})

// ═══════════════ Round 62 (T-112): the review gate, renderer half ═══════════════
//
// What the nine-reviewer sweep found in the renderer, driven through the real built app.
// Each test was written red-first against the build the wave was held on; the assertion
// that failed there is quoted in the ledger section for round 62 in INTERACTION_COVERAGE.md.

test.describe('T-112: review-gate fixes', () => {
  test('a 16:9 recording cropped to 9:16 gets a Short from Clip Kit, and the button counts its versions (T-112)', async () => {
    test.setTimeout(600_000)
    // The Short swap read the SOURCE (landscape, so never a Short); the crop is the clip.
    const studio = await launchWithVideo('t112short', cropMarkerSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '9:16', exact: true })
        .click()
      // Job 2's probe is held, so the label has to have MOVED ON from job 1 to say "2 of 5".
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 6000 }])
      const kit = kitButton(window)
      // The label reads in ink on the accent wash (accent text there was 4.1:1, hover 3.6:1).
      const kitStyle = await kit.evaluate((el) => getComputedStyle(el).color)
      expect(kitStyle).toBe('rgb(236, 228, 226)')

      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })

      // Wait for the kit to FINISH (the label leaves "Exporting…" / "Extracting…"), then read the
      // folder once: a wrong file list is a red in seconds, not a poll that waits out its timeout.
      await expect(kit).not.toHaveText(/^(Exporting|Extracting)/, { timeout: 540_000 })
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      expect(existsSync(kitDir) ? readdirSync(kitDir).sort() : []).toEqual([
        'Clip_1_facebook.mp4',
        'Clip_1_reels.mp4',
        'Clip_1_thumb_1.jpg',
        'Clip_1_thumb_2.jpg',
        'Clip_1_thumb_3.jpg',
        'Clip_1_tiktok.mp4',
        'Clip_1_twitter.mp4',
        'Clip_1_youtube_short.mp4'
      ])
      const short = videoStream(await ffprobeJson(path.join(kitDir, 'Clip_1_youtube_short.mp4')))
      expect([short.width, short.height]).toEqual([1080, 1920])
      // No landscape YouTube file beside it: the slot IS the Short.
      expect(readdirSync(kitDir)).not.toContain('Clip_1_youtube.mp4')
      // T-130 (t): and the three thumbnails are the clip's CROPPED picture, not the whole 640x360 frame the crop threw most of away. The 9:16
      // button draws 90% of the frame's height (182x324 of this fixture) and the red block (x 20-100) is outside it; the source frame is the
      // control that the count can see the block.
      expect(await redPixelCount(cropMarkerSrc, 0.5), 'the control: the source frame has the red block').toBeGreaterThan(5000)
      for (const n of [1, 2, 3]) {
        const thumb = videoStream(await ffprobeJson(path.join(kitDir, `Clip_1_thumb_${n}.jpg`)))
        expect(thumb.height, `thumbnail ${n} is the crop's height, not the frame's 360`).toBeLessThan(360)
        expect(thumb.height).toBeGreaterThan(300)
        expect(thumb.width, `thumbnail ${n} is 9:16, not the 640 px frame`).toBeLessThan(220)
        expect(Math.abs((thumb.width ?? 0) / (thumb.height ?? 1) - 9 / 16), `thumbnail ${n}'s shape`).toBeLessThan(0.02)
        expect(await redPixelCount(path.join(kitDir, `Clip_1_thumb_${n}.jpg`), 0), `thumbnail ${n}: no red block, it is outside the crop`).toBe(0)
      }
      await expectToast(window, 'Saved your Clip Kit')
    } finally {
      await app.close()
    }
  })

  test('a fast double-click on Export starts ONE batch and the queue shows it truthfully: no Failed row, no refusal, one file (T-125 (18))', async () => {
    test.setTimeout(300_000)
    // The button was claimed only after the settings writes `runExportQueue` awaits, so a second click in that gap started a second
    // call: main's gate (T-111) refused it, and its catch settled the rows - Failed on the first, Not run on the rest - while the
    // real batch ran under them. The first click claims the panel synchronously now.
    const { app, window, outDir } = await launchWithVideo('t125double')
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: /^Export 1/ }).dblclick({ delay: 0 })
      const REFUSAL = 'An export is already running. Wait for it to finish, or cancel it, then try again.'
      await expect.poll(() => mp4sIn(outDir), { timeout: 240_000, intervals: [500] }).toHaveLength(1)
      await expectToast(window, 'Exported 1 file')
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1)
      // The rows tell the truth about the one batch that ran.
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(0)
      await expect(card.getByText('Not run', { exact: true })).toHaveCount(0)
      await expect(card.getByText(REFUSAL, { exact: true })).toHaveCount(0)
      expect(await readToastLog(window), 'main was never asked twice').not.toContain(REFUSAL)
      await expect(card.getByRole('status').filter({ hasText: '100%' })).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('a failed batch marks the job that failed — Failed, with its reason as text — and the jobs behind it Not run (T-112)', async () => {
    test.setTimeout(600_000)
    // Four jobs; the source is removed while job 2's probe is held, so job 1 finishes, job 2
    // fails, and jobs 3 and 4 never start. Every unfinished row used to read Failed, in red.
    const moved = path.join(root, 'source', `t112-moved-${Date.now().toString(36)}.mp4`)
    copyFileSync(clipSrc, moved)
    const studio = await launchWithVideo('t112fail', moved)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await presetBox(window, 'X / Twitter').check()
      await presetBox(window, 'Facebook').check()
      await presetBox(window, 'Reels').check()
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 6000 }])
      await card.getByRole('button', { name: /^Export 4/ }).click()
      // Reels is a 9:16 platform and the clip is 16:9: the safe-zone question comes first.
      await window.getByRole('dialog').getByRole('button', { name: 'Export anyway' }).click()

      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1, {
        timeout: 120_000
      })
      rmSync(moved) // while job 2's probe is held

      const MESSAGE =
        "Export failed. A file imagii needs isn't there. It may have been moved or deleted."
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(1, { timeout: 60_000 })
      await expect(card.getByText('Not run', { exact: true })).toHaveCount(2)
      // The reason is TEXT on the row that failed (it was a hover title only).
      await expect(card.getByText(MESSAGE, { exact: true })).toBeVisible()
      await expect(card.getByText('Canceled', { exact: true })).toHaveCount(0)
      // Red marks the one job that broke; the rows that never started are neutral ink.
      await expect(card.locator('.w-40 > .bg-danger-strong')).toHaveCount(1)
      await expect(card.getByText('Failed', { exact: true })).toHaveClass(/text-danger/)
      for (const word of await card.getByText('Not run', { exact: true }).all()) {
        await expect(word).toHaveClass(/text-ink-muted/)
        await expect(word).not.toHaveClass(/text-danger/)
      }
      // The job that finished is untouched: its file, its button, no label of its own.
      expect(mp4sIn(outDir)).toHaveLength(1)
      await expect(card.getByRole('button', { name: 'Show in folder', exact: true })).toHaveCount(1)
      // It outlives the toast, which is the point: "see which one" after the message fades.
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, {
        timeout: 30_000
      })
      await expect(card.getByText(MESSAGE, { exact: true })).toBeVisible()
      await expect(card.getByText('Failed', { exact: true })).toHaveCount(1)
      await expect(card.getByText('Not run', { exact: true })).toHaveCount(2)
    } finally {
      await app.close()
    }
  })

  test('a video with no sound has nothing to clean, transcribe or scan, and each panel says so (T-112)', async () => {
    test.setTimeout(180_000)
    // overlay.mp4 is a flat green picture with NO audio stream (probe.audioCodec is null).
    const silent = await launchWithVideo('t112nosound', pipSrc)
    try {
      const { window } = silent
      const NO_SOUND = 'This video has no sound.'
      await expect(window.getByRole('button', { name: 'Clean audio' })).toBeDisabled()
      await expect(window.locator('header').getByText(NO_SOUND, { exact: true })).toBeVisible()
      const captions = captionsCard(window)
      await expect(captions.getByRole('button', { name: 'Transcribe', exact: true })).toBeDisabled()
      await expect(captions.getByText(NO_SOUND, { exact: true })).toBeVisible()
      const finder = highlightCard(window)
      await expect(finder.getByRole('button', { name: 'Scan VOD' })).toBeDisabled()
      await expect(finder.getByText(NO_SOUND, { exact: true })).toBeVisible()
      // T-114: and the clip's hook row, which rates how LOUD the first seconds are, is not drawn for
      // a video with nothing to hear - "First 2 s: Weak hook" over a silent picture is a verdict on
      // the absence of a sound track, and the same consolidation that disabled the three above left
      // this one behind. No label, no spinner, no badge.
      const clips = clipListCard(window)
      await expect(clips.getByRole('button', { name: /^Select clip / }).first()).toBeVisible()
      await window.waitForTimeout(800)
      await expect(clips.getByText(/^First /)).toHaveCount(0)
      await expect(clips.getByText('Hook…')).toHaveCount(0)
      await expect(clips.getByText(/^(Strong|OK|Weak) hook$/)).toHaveCount(0)
      // A disabled button must not be a click that does something anyway.
      await window.getByRole('button', { name: 'Clean audio' }).click({ force: true })
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toHaveCount(0)
    } finally {
      await silent.app.close()
    }

    // The control: a video WITH sound has all three, and none of the sentences.
    const loud = await launchWithVideo('t112sound', clipSrc)
    try {
      const { window } = loud
      await expect(window.getByRole('button', { name: 'Clean audio' })).toBeEnabled()
      await expect(captionsCard(window).getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled()
      await expect(highlightCard(window).getByRole('button', { name: 'Scan VOD' })).toBeEnabled()
      await expect(window.getByText('This video has no sound.')).toHaveCount(0)
      // The control for the hook row: a video WITH sound has it.
      await expect(clipListCard(window).getByText(/^First /)).toBeVisible()
    } finally {
      await loud.app.close()
    }
  })

  test('transcription that finishes after the video changed is not attached to the new video (T-112)', async () => {
    test.setTimeout(240_000)
    // Transcribe A, close it, open B, THEN A's job finishes: B must not get A's captions.
    // The engine is not installed here (HL-whisper), so main is told it is and the job is a
    // handler the test holds — the panel's own code runs on what it returns.
    const second = path.join(root, 'source', `t112-second-${Date.now().toString(36)}.mp4`)
    copyFileSync(clipSrc, second)
    const studio = await launchHome('t112srt')
    const { app, window, userDataDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'from-a.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,000\nwords from video A\n', 'utf8')
      await app.evaluate(({ ipcMain }, srt) => {
        const g = globalThis as unknown as {
          __tx: { calls: number; release: () => void }
        }
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        g.__tx = { calls: 0, release }
        ipcMain.removeHandler('captions:status')
        ipcMain.handle('captions:status', () => ({
          exeInstalled: true,
          exePath: 'whisper-cli.exe',
          modelInstalled: true,
          modelPath: 'model.bin',
          modelsDir: 'models',
          ready: true
        }))
        ipcMain.removeHandler('captions:transcribe')
        ipcMain.handle('captions:transcribe', async (_e, req: { jobId: string }) => {
          g.__tx.calls += 1
          await gate
          return {
            jobId: req.jobId,
            srtPath: srt,
            segments: [{ startSec: 0, endSec: 1, text: 'words from video A' }],
            durationMs: 5
          }
        })
      }, srtPath)
      const calls = (): Promise<number> =>
        app.evaluate(() => (globalThis as unknown as { __tx: { calls: number } }).__tx.calls)

      window.on('dialog', (dialog) => void dialog.accept())
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      await captionsCard(window).getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expect.poll(calls, { timeout: 15_000, intervals: [100] }).toBe(1)

      // Close A (the confirm is accepted above), open B.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
      await dropOnVideoImporter(window, second, path.basename(second))
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      await expect(window.locator('header').getByText(path.basename(second), { exact: true })).toBeVisible()

      // A finishes now.
      await app.evaluate(() =>
        (globalThis as unknown as { __tx: { release: () => void } }).__tx.release()
      )
      await expectToast(
        window,
        'finished after that video was closed or replaced, so they weren\'t added. Transcribe again when you\'re ready.'
      )
      const card = captionsCard(window)
      // B has no captions: no style subtree, no Burn into video, none of A's words.
      await expect(card.getByRole('button', { name: 'Burn into video' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Save .srt' })).toHaveCount(0)
      await expect(card.getByText('words from video A')).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled()
      expect((await readToastLog(window)).join(' | ')).not.toContain('Captions ready')
    } finally {
      await app.close()
    }
  })

  test('the hook badge listens to the first 3 seconds the viewer SEES: the window is 3 x the clip speed (T-112)', async () => {
    test.setTimeout(180_000)
    const { app, window } = await launchWithVideo('t112hook', midSrc)
    try {
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as {
          __hook: Array<{ startSec: number; durationSec?: number }>
        }
        g.__hook = []
        ipcMain.removeHandler('video:analyzeClipHook')
        ipcMain.handle(
          'video:analyzeClipHook',
          (_e, params: { startSec: number; durationSec?: number }) => {
            g.__hook.push(params)
            return { audioEnergyDb: -10 }
          }
        )
      })
      const lastWindow = (): Promise<number | undefined> =>
        app.evaluate(() => {
          const g = globalThis as unknown as { __hook: Array<{ durationSec?: number }> }
          return g.__hook[g.__hook.length - 1]?.durationSec
        })
      const speed = window.getByRole('slider', { name: 'Clip playback speed' })
      // 3 seconds of OUTPUT is 3 x the speed of source: 6 s at 2x, 1.5 s at 0.5x, 12 s at 4x.
      for (const [value, sourceSeconds] of [
        ['2', 6],
        ['0.5', 1.5],
        ['4', 12],
        ['1', 3]
      ] as const) {
        await speed.fill(value)
        await expect.poll(lastWindow, { timeout: 15_000, intervals: [100] }).toBe(sourceSeconds)
      }
      // The words are about what the viewer sees, at any speed: the label and the tooltip
      // both say 3 (the clip is long enough to give the viewer all of them).
      await expect(window.getByTitle(/Based on how loud the first 3 seconds are/)).toBeVisible()
      await expect(clipListCard(window).getByText('First 3 s:')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('the Compile card says what it makes, calls its fade what it is, and its verdict list is reachable by keyboard (T-112)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t112compilecard')
    try {
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = compileCard(window)
      // The frame is the compilation's own and the rate is the recording's (T-130 (q): this fixture is 15 fps), said before the file is written.
      await expect(card).toContainText('1920×1080, 15 fps')
      // Nothing crossfades: the picture and sound dip to black and come back.
      await expect(card).not.toContainText(/crossfade/i)
      await expect(card.getByText('Fade between clips', { exact: true })).toBeVisible()
      await expect(
        card.getByRole('slider', { name: 'Fade between clips, in milliseconds' })
      ).toBeVisible()
      await expect(
        card.getByText(/Each clip fades out to black and the next fades in from black; clips never overlap\./)
      ).toBeVisible()

      // The verdict list: a scroller is focusable (Chromium 126 does not make it so), with a ring.
      const list = card.getByRole('list', { name: 'How each clip fits the compilation' })
      await expect(list).toHaveAttribute('tabindex', '0')
      await list.focus()
      await window.keyboard.press('Shift+Tab')
      await window.keyboard.press('Tab')
      await expect(list).toBeFocused()
      expect(await list.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(255, 49, 49)')

      // The name column flexes: it is no longer an 80 px stub, and the whole name is in its title.
      const name = list.locator('li').first().locator('span').first()
      expect((await name.boundingBox())?.width ?? 0).toBeGreaterThan(100)
      await expect(name).toHaveAttribute('title', 'Clip 1')
      await clipListCard(window).getByRole('textbox').first().fill('Boss fight, final phase, no deaths')
      await expect(
        list.locator('li').first().locator('span[title="Boss fight, final phase, no deaths"]')
      ).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('a 60 fps recording: the Compile card says 60 fps and the compilation is a 60 fps file (T-130 (q))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t130compile60', rate60Src)
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = compileCard(window)
      // The rate is the recording's up to 60, derived from the same probe main reads (it was 30 for every compilation).
      await expect(card).toContainText('1920×1080, 60 fps')
      await expect(card).not.toContainText('30 fps')
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      const output = path.join(outDir, 'rate60_compilation.mp4')
      await expect.poll(() => existsSync(output), { timeout: 540_000, intervals: [500] }).toBe(true)
      await expectToast(window, `Saved ${path.basename(output)}`)
      const v = videoStream(await ffprobeJson(output))
      expect([v.width, v.height]).toEqual([1920, 1080])
      expect(v.r_frame_rate, 'the file is as fast as the recording').toBe('60/1')
    } finally {
      await app.close()
    }
  })

  test('YouTube 1080p60 is a card of its own: ticked beside YouTube it writes a 60 fps file next to the 30 fps one, and Clip Kit is still five (T-130 (q))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t130youtube60', rate60Src)
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await expect(presetBox(window, 'YouTube 1080p60')).not.toBeChecked()
      await presetBox(window, 'YouTube 1080p60').check()
      await card.getByRole('button', { name: 'Export 2 files' }).click()
      await expect.poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] }).toBe(2)
      await expectToast(window, 'Exported 2 files')
      expect(mp4sIn(outDir)).toEqual(['rate60_Clip 1_youtube.mp4', 'rate60_Clip 1_youtube60.mp4'])
      const plain = videoStream(await ffprobeJson(path.join(outDir, 'rate60_Clip 1_youtube.mp4')))
      const sixty = videoStream(await ffprobeJson(path.join(outDir, 'rate60_Clip 1_youtube60.mp4')))
      expect([plain.width, plain.height, plain.r_frame_rate]).toEqual([1920, 1080, '30/1'])
      expect([sixty.width, sixty.height, sixty.r_frame_rate]).toEqual([1920, 1080, '60/1'])
      // The kit is one version per platform: it did not gain a sixth.
      await expect(kitButton(window)).toHaveText('Clip Kit (5 + thumbs)')
    } finally {
      await app.close()
    }
  })

  test('a clip whose stored speed is 0 compiles at 1x instead of being refused (T-112)', async () => {
    test.setTimeout(600_000)
    // A project from an older build, or edited by hand, can hold speedMultiplier 0. The slider and
    // the grid read it as 1x (clipSpeed), so the clip looks ordinary; main's validator (round 61)
    // refuses a speed of 0, and Compile sent the raw field.
    const projectPath = path.join(root, `zero-speed-${Date.now().toString(36)}.imagii.json`)
    const clip = (id: string, name: string, startSec: number, endSec: number, speed?: number) => ({
      id,
      name,
      startSec,
      endSec,
      cropRect: null,
      textOverlays: [],
      selectedPresets: ['youtube'],
      ...(speed === undefined ? {} : { speedMultiplier: speed })
    })
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 4,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [clip('legacy', 'Legacy', 0, 1, 0), clip('plain', 'Plain', 1, 2)],
          selectedClipId: 'legacy',
          watermark: null,
          srtPath: null
        }
      }),
      'utf8'
    )
    const studio = await launchHome('t112zerospeed')
    const { app, window, outDir } = studio
    try {
      await installToastLog(window)
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expectToast(window, 'Project loaded')
      await gotoVideoStudio(window)
      const card = compileCard(window)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeVisible({
        timeout: 30_000
      })
      // The slider reads 1x for the legacy clip: it IS 1x everywhere but on the wire.
      await expect(window.getByRole('slider', { name: 'Clip playback speed' })).toHaveValue('1')
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()

      const output = path.join(outDir, 'pipeline_compilation.mp4')
      // Done is the file OR the failure toast, so a refusal is a red with its own words in seconds
      // rather than a poll that waits out its nine minutes.
      await expect
        .poll(
          async () =>
            existsSync(output) ||
            (await readToastLog(window)).some((t) => t.includes('Compilation failed')),
          { timeout: 540_000, intervals: [500] }
        )
        .toBe(true)
      expect((await readToastLog(window)).join(' | ')).not.toContain('Compilation failed')
      await expectToast(window, `Saved ${path.basename(output)}`)
      const length = Number((await ffprobeJson(output)).format?.duration)
      expect(length, 'two 1 s clips at 1x').toBeGreaterThan(1.7)
      expect(length).toBeLessThan(2.5)
    } finally {
      await app.close()
    }
  })

  test('the GIF length warning is announced: its region is always there, so a Speed change speaks (T-112)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t112gifstatus', shortSrc)
    try {
      const card = gifCard(window)
      const status = card.getByRole('status')
      // 6 s at 1x is fine, and the live region is already on the page, empty.
      await expect(status).toHaveCount(1)
      await expect(status).toHaveText('')
      await card.locator('select').nth(2).selectOption('0.5') // a 12 s GIF
      await expect(status).toHaveCount(1)
      await expect(status).toHaveText('GIF exports over about 10 s get huge. Trim the clip first.')
      await card.locator('select').nth(2).selectOption('1')
      await expect(status).toHaveText('')
    } finally {
      await app.close()
    }
  })

  test('a second drop while a conversion runs is refused, not started in parallel (T-112)', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('t112importer')
    const { app, window } = studio
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      // The flv's conversion (the only ffmpeg this page starts) is held for 10 s.
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 10_000 }])
      await dropOnVideoImporter(window, flvSrc, 'stream.flv')
      await expectToast(window, 'Converting for editing')

      // A second file arrives meanwhile. It used to start a PARALLEL load, and whichever finished
      // last won; now the importer says it is busy and the second file is left alone.
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expectToast(window, 'Still converting the last video. Wait for it to finish.')
      await expect(window.getByText('Drop a video here')).toBeVisible()
      await expect(window.locator('video')).toHaveCount(0)
      expect((await readSpawnLog(app)).filter((k) => k === 'ffmpeg')).toHaveLength(1)

      // The conversion finishes and the video that opens is the FIRST drop.
      await expect(window.locator('header').getByText('stream.flv', { exact: true })).toBeVisible({
        timeout: 120_000
      })
      await expect(window.locator('video')).toHaveCount(1)
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toHaveCount(0)
      // ...and once it is loaded the importer takes a file again (the refusal does not stick):
      // closing returns it, and a fresh drop is accepted.
      window.on('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({
        timeout: 30_000
      })
    } finally {
      await app.close()
    }
  })

  test('Clean audio asks before it replaces a tuned Audio Studio session, in Audio Studio\'s own words (T-112)', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t112cleanconfirm')
    try {
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })
      // Audio Studio: a sound, tuned.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await window.evaluate((file) => {
        const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
        if (!zone) throw new Error('Audio Studio drop zone not found')
        const f = new File([new Uint8Array([0])], 'tone.wav', { type: '' })
        Object.defineProperty(f, 'path', { value: file })
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: { files: [f] } })
        zone.dispatchEvent(event)
      }, toneSrc)
      await expect(window.locator('[data-tutorial="audio-waveform"]')).toBeVisible({ timeout: 30_000 })
      await window
        .locator('[data-tutorial="audio-cleanup"]')
        .getByRole('button', { name: 'Medium', exact: true })
        .click()

      // Back to the video, and Clean audio.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      // T-113: the same list as Audio Studio's Close, led by what is actually happening — nothing
      // is being closed; the video's sound is about to replace the audio being edited.
      expect(messages[0]).toBe("Replace the audio you're editing? Your cleanup settings will be discarded.")
      // Declined: nothing was extracted, nothing opened, the button is free.
      await window.waitForTimeout(800)
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Clean audio' })).toBeEnabled()
      expect(await readToastLog(window)).not.toContain('Opening Audio Studio')

      // Accepted: the video's sound replaces the tuned session.
      answer = 'accept'
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 60_000 })
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({
        timeout: 30_000
      })
      expect(messages).toHaveLength(2)

      // Control: that session is untouched (a fresh load), so asking again asks nothing.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 60_000 })
      expect(messages).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  // T-125 (20): Clean audio asked its question BEFORE a long extraction and then loaded the result and navigated, whatever had happened in
  // between. A person who went to Audio Studio while a long VOD's sound was being extracted and opened a file there had it replaced,
  // chosen over, by a result they had stopped waiting for, and was taken to /audio again. The audio source is compared before and after
  // the extraction (`replacedSince`, ProjectIO's precedent): changed -> nothing loads, nothing navigates, and one line says why.
  test('Clean audio does not replace what was opened in Audio Studio while it was extracting, and does not pull the person back (T-125 (20))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t125cleanrace')
    try {
      // The hook badge's own ffmpeg has run (it asks once the clip is on screen); the next ffmpeg is the extraction, held for 9 s.
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 9000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expectToast(window, 'Extracting audio')

      // While it runs the person goes to Audio Studio and opens a file of their own.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await window.evaluate((file) => {
        const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
        if (!zone) throw new Error('Audio Studio drop zone not found')
        const f = new File([new Uint8Array([0])], 'tone.wav', { type: '' })
        Object.defineProperty(f, 'path', { value: file })
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: { files: [f] } })
        zone.dispatchEvent(event)
      }, toneSrc)
      await expect(window.locator('[data-tutorial="audio-waveform"]')).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('header').getByText('tone.wav', { exact: true })).toBeVisible()

      // The extraction ends. What the person opened stays, nothing navigates, and the line says why.
      const SKIPPED = "Skipped this video's sound because you opened another file in Audio Studio while it was extracting"
      await expectToast(window, SKIPPED)
      await expect(window.locator('header').getByText('tone.wav', { exact: true })).toBeVisible()
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toHaveCount(0)
      expect(await readToastLog(window), 'no "Opening Audio Studio" for a result that was not opened').not.toContain('Opening Audio Studio')
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  // T-133 (9): the Importer's "Choose file…" is `disabled` while a file loads and drew exactly like a live button (btn-primary has no disabled look of
  // its own; the label does not even change). Every other disabled button in the app is dimmed; a scan in interactionWiring.test.ts holds that for the
  // source, this reads the computed opacity on a real render, in the state the test creates (the probe is held 4 s).
  test('the Importer\'s Choose file is dimmed while a file is loading, and live again when it is not (T-133 (9))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchHome('t133importerdim')
    try {
      await gotoVideoStudio(window)
      const choose = window.getByRole('button', { name: 'Choose file…' })
      const opacity = (): Promise<number> => choose.evaluate((el) => Number(getComputedStyle(el).opacity))
      await expect(choose).toBeEnabled()
      expect(await opacity(), 'a live button is not dimmed').toBe(1)
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 1, ms: 4000 }])
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(window.getByText(/Loading…/)).toBeVisible({ timeout: 10_000 })
      await expect(choose).toBeDisabled()
      // (polled: the button's colors transition, so the first frame after it is disabled is not yet the settled look)
      await expect.poll(opacity, { timeout: 5_000, message: 'a button that cannot be pressed looks it' }).toBeLessThan(0.7)
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({ timeout: 60_000 })
    } finally {
      await app.close()
    }
  })

  // T-133 (6): the question Clean audio asks ("Replace the audio you're editing?") runs ONCE, before an extraction that takes minutes on a long
  // recording, and `replacedSince` only notices a different FILE. Work tuned on the file already open during the wait was replaced without a word
  // (loadSource resets the chain and the undo history: no way back), against the guide's "asks first". After the wait it asks again when the
  // chain is no longer the one the person said yes about; work they already agreed to lose is not asked about twice.
  test('Clean audio asks again about work tuned while it was extracting: declining keeps the tuning; work agreed to be lost is not asked about twice (T-133 (6))', async () => {
    test.setTimeout(360_000)
    const { app, window } = await launchWithVideo('t133cleantuned')
    try {
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })
      const ASK = "Replace the audio you're editing? Your cleanup settings will be discarded."
      const SKIPPED = "Skipped this video's sound to keep the changes you made in Audio Studio while it was extracting"
      const medium = window.locator('[data-tutorial="audio-cleanup"]').getByRole('button', { name: 'Medium', exact: true })
      /** Audio Studio holds an UNTOUCHED tone.wav (so Clean audio's first question has nothing to ask about). */
      const openTone = async (): Promise<void> => {
        await window.getByRole('link', { name: 'Home' }).click()
        await window.locator('a', { hasText: 'Audio Studio' }).first().click()
        await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
        await window.evaluate((file) => {
          const zone = document.querySelector('[data-tutorial="audio-importer"] .card')
          if (!zone) throw new Error('Audio Studio drop zone not found')
          const f = new File([new Uint8Array([0])], 'tone.wav', { type: '' })
          Object.defineProperty(f, 'path', { value: file })
          const event = new Event('drop', { bubbles: true, cancelable: true })
          Object.defineProperty(event, 'dataTransfer', { value: { files: [f] } })
          zone.dispatchEvent(event)
        }, toneSrc)
        await expect(window.locator('[data-tutorial="audio-waveform"]')).toBeVisible({ timeout: 30_000 })
      }

      // ── run 1: nothing to lose at the press (no question), tuned during the wait, DECLINED ──
      await openTone()
      await expect(medium).toHaveAttribute('aria-pressed', 'false')
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 9000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expectToast(window, 'Extracting audio')
      expect(messages, 'an untouched session has nothing to ask about before the wait').toEqual([])
      // While it runs the person tunes the file they already have open.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await medium.click()
      await expect(medium).toHaveAttribute('aria-pressed', 'true')
      // The extraction ends: the question appears, in Audio Studio's own words. Declined, the tuning stays and one line says why.
      await expect.poll(() => messages.length, { timeout: 60_000, intervals: [250] }).toBe(1)
      expect(messages[0]).toBe(ASK)
      await expectToast(window, SKIPPED)
      await expect(medium, 'the tuning is kept').toHaveAttribute('aria-pressed', 'true')
      await expect(window.locator('header').getByText('tone.wav', { exact: true })).toBeVisible()
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toHaveCount(0)
      expect(await readToastLog(window), 'nothing says Opening Audio Studio for a result that was not opened').not.toContain('Opening Audio Studio')

      // ── run 2: the work was there at the press (asked once, accepted), and nothing more changed: NOT asked again ──
      answer = 'accept'
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 5000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(2)
      expect(messages[1]).toBe(ASK)
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 90_000 })
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })
      expect(messages, 'work they already agreed to lose is not asked about a second time').toHaveLength(2)
      await expect(medium, 'the new sound starts from a clean chain').toHaveAttribute('aria-pressed', 'false')

      // ── run 3: a clean session at the press, tuned during the wait, ACCEPTED at the second question: the sound replaces it ──
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 7000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expectToast(window, 'Extracting audio')
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await medium.click()
      await expect(medium).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => messages.length, { timeout: 60_000, intervals: [250] }).toBe(3)
      expect(messages[2]).toBe(ASK)
      await expect(medium, 'accepted: the fresh sound has a clean chain').toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 })
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => t.startsWith('Extracted the sound from pipeline.mp4')).length, { timeout: 60_000, intervals: [250] })
        .toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })

  // T-132 (1): the extraction ends minutes later on a long recording, and `navigate` still works from a studio that unmounted, so Clean audio took
  // the person to /audio wherever they were (from /record that cut a live take short: record.spec.ts holds that case). Only a person still on
  // Video Studio is taken along; anyone else keeps their screen, the sound is loaded, and a toast carries the way there. On Audio Studio itself
  // (the sound simply appears in front of them) the toast carries no button. The stay-on-/video path is every other Clean audio case here.
  test('Clean audio finishing while the person is elsewhere loads the sound and offers Open Audio Studio instead of taking them there (T-132 (1))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t132cleanaway')
    try {
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 7000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expectToast(window, 'Extracting audio')

      // While it runs the person goes to Stream Graphics.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 30_000 })

      // The extraction ends: they are not moved, and the toast says what happened and carries the button.
      await expectToast(window, 'Extracted the sound from pipeline.mp4')
      expect(await readToastLog(window), 'nothing says Opening Audio Studio: they were not taken there').not.toContain('Opening Audio Studio')
      await expect(window.locator('h1', { hasText: 'Stream Graphics' }), 'still where they were').toBeVisible()
      const open = window.locator('[data-rht-toaster]').getByRole('button', { name: 'Open Audio Studio', exact: true })
      await expect(open).toBeVisible()
      // The toast outlives a success toast's 2 s (it is the ONLY way to the sound from here).
      await window.mouse.move(2, 2)
      await window.waitForTimeout(3_000)
      await expect(open, 'still there 3 s on').toBeVisible()

      // The button takes them there, to the sound that was loaded meanwhile.
      await open.click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })

      // And from Audio Studio itself: the sound appears in front of them, no button and no move.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoVideoStudio(window)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 5000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expectToast(window, 'Extracting audio')
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => t.startsWith('Extracted the sound from pipeline.mp4')).length, { timeout: 60_000, intervals: [250] })
        .toBe(2)
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible()
      expect((await readToastLog(window)).at(-1), 'on Audio Studio the toast has no button').toBe('Extracted the sound from pipeline.mp4')
      expect(await readToastLog(window)).not.toContain('Opening Audio Studio')
    } finally {
      await app.close()
    }
  })

  // T-124 (6) refused Clean audio on a video over two hours at the button (the most Audio Studio's waveform could hold while the
  // renderer decoded it). T-129 retired that ceiling with the decode: the sound is extracted (a ~1.4 GB scratch WAV, removed by this
  // case) and Audio Studio opens on it, its waveform drawn from main's peaks. This is the round-74 pin, flipped.
  test('Clean audio on a video longer than two hours extracts its sound and opens Audio Studio on it (T-129, flipping T-124 (6))', async () => {
    test.setTimeout(300_000)
    const longVideo = path.join(root, 'source', 'two-hours-and-a-second.mp4')
    await ffmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1:d=7201', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
      '-t', '7201', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '600', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '8k', '-shortest', longVideo
    ])
    const scratch = path.join(os.tmpdir(), 'imagii-audio')
    const wavs = (): string[] => (existsSync(scratch) ? readdirSync(scratch) : [])
    const before = new Set(wavs())
    const { app, window } = await launchWithVideo('t129cleanlong', longVideo)
    try {
      const dialogs: string[] = []
      window.on('dialog', async (dialog) => {
        dialogs.push(dialog.message())
        await dialog.dismiss()
      })
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 20_000, intervals: [200] }).toContain('Extracting audio…')
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 240_000 })
      await expect(
        window.locator('[data-tutorial="audio-waveform"]').getByRole('button', { name: 'Play', exact: true }),
        'the waveform is drawn'
      ).toBeEnabled({ timeout: 120_000 })
      await expect(window.locator('header').getByText('two-hours-and-a-second.mp4', { exact: true })).toBeVisible()
      // Audio Studio held nothing, so there was nothing to ask about replacing.
      expect(dialogs).toEqual([])
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/longer than 2 hours/)
      expect(wavs().filter((f) => !before.has(f)), 'the extracted WAV is what Audio Studio holds').toHaveLength(1)
    } finally {
      await app.close()
      // This case's own scratch WAV only: every file in imagii-audio that was not there before it began.
      for (const f of wavs().filter((name) => !before.has(name) && name.endsWith('.wav'))) rmSync(path.join(scratch, f), { force: true })
    }
  })

  test('Reset clears the crop but keeps the Crop section open, whichever way the crop arrived (T-112)', async () => {
    test.setTimeout(300_000)
    const projectPath = path.join(root, `reset-crop-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 4,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [
            {
              id: 'cropped',
              name: 'Cropped',
              startSec: 0,
              endSec: CLIP_SECONDS,
              cropRect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
              textOverlays: [],
              selectedPresets: ['youtube']
            }
          ],
          selectedClipId: 'cropped',
          watermark: null,
          srtPath: null
        }
      }),
      'utf8'
    )

    const expectOpenAndCleared = async (window: Page): Promise<void> => {
      const row = window.locator('[data-tutorial="video-crop"]')
      const rectangle = window.locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
      // The section is STILL open: checked, presets and Reset on screen, a rectangle drawn…
      await expect(window.getByRole('checkbox', { name: 'Crop', exact: true })).toBeChecked()
      await expect(row.getByRole('button', { name: '9:16', exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()
      await expect(rectangle).toHaveCount(1)
      // …and it is the whole frame, which is what "no crop" draws.
      const frame = await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        return { w: v?.clientWidth ?? 0, h: v?.clientHeight ?? 0 }
      })
      const style = (await rectangle.getAttribute('style')) ?? ''
      const w = Number(/width:\s*([\d.]+)px/i.exec(style)?.[1] ?? Number.NaN)
      expect(Math.abs(w - frame.w), `drawn ${w} in a ${frame.w}px picture`).toBeLessThan(2)
    }

    // ── the crop arrived with a project ──
    const loaded = await launchHome('t112reset-project')
    try {
      await installToastLog(loaded.window)
      await stubDialogs(loaded.app, { open: [projectPath] })
      await loaded.window.getByRole('button', { name: 'Open project' }).click()
      await expectToast(loaded.window, 'Project loaded')
      await gotoVideoStudio(loaded.window)
      await expect(loaded.window.getByRole('checkbox', { name: 'Crop', exact: true })).toBeChecked({
        timeout: 30_000
      })
      await loaded.window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: 'Reset', exact: true })
        .click()
      await expectOpenAndCleared(loaded.window)
    } finally {
      await loaded.app.close()
    }

    // ── the crop was ticked and drawn by hand (the control: it always stayed open) ──
    const drawn = await launchWithVideo('t112reset-hand')
    try {
      await drawn.window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await drawn.window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '1:1', exact: true })
        .click()
      await drawn.window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: 'Reset', exact: true })
        .click()
      await expectOpenAndCleared(drawn.window)
    } finally {
      await drawn.app.close()
    }
  })

  // T-111 / T-112 pinned a returning panel that "believes nothing runs" and a second press that main refused. T-135 (1) removed the belief: the batch is
  // the Export queue store's, so a panel that comes back mid-batch is not idle (no Export button to press: it reads "Exporting…", the row and the
  // Cancel are there). Main's one-batch-at-a-time gate (T-111) stays the backstop, and it is still reachable from another door: Clip Kit runs its
  // five exports as a batch too. Pressing it while the Export batch runs is refused by main in a finished sentence, the running batch is untouched,
  // and the kit's empty folder goes with the refusal (T-112).
  test('after leaving Video Studio mid-batch there is no Export to press, and Clip Kit, the other door, is refused by main while the first batch runs (T-111 / T-112 / T-135 (1))', async () => {
    test.setTimeout(300_000)
    const { app, window, outDir } = await launchWithVideo('t112again')
    try {
      const kitParent = path.join(root, `kit-again-${Date.now().toString(36)}`)
      mkdirSync(kitParent, { recursive: true })
      await stubDialogs(app, { open: [outDir, kitParent] })
      const card = exportCard(window)
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 60_000 }])
      await card.getByRole('button', { name: /^Export 1/ }).click()
      await expect(card.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await expect
        .poll(async () => (await readSpawnLog(app)).filter((k) => k === 'ffmpeg').length, {
          timeout: 30_000,
          intervals: [100]
        })
        .toBe(1)

      // Leave, and come back: the panel draws the batch that is running. There is nothing to press twice.
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible()
      await gotoVideoStudio(window)
      const again = exportCard(window)
      await expect(again.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await expect(again.getByRole('button', { name: /^Export 1/ }), 'no Export button to press a second time').toHaveCount(0)
      await expect(again.getByRole('progressbar', { name: 'Clip 1 · YouTube' })).toBeVisible()
      await expect(again.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      // T-115: the returning panel's hook badge asks for its loudness 250 ms after it mounts (a real
      // ffmpeg that is the badge's, not the refused batch's): let it finish before the log is counted.
      await expect(clipListCard(window).getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      const spawnedBefore = (await readSpawnLog(app)).length

      // The other door: Clip Kit's batch is refused by main, in words, and starts nothing.
      await clipListCard(window).getByTitle('Export this clip for all 5 platforms + 3 thumbnails into one folder').click()
      const REFUSAL =
        'An export is already running. Wait for it to finish, or cancel it, then try again.'
      await expectToast(window, REFUSAL)
      const entry = (await readToastEntries(window)).find((e) => e.text === REFUSAL)
      expect(entry?.hasIcon, 'a refusal is an error toast').toBe(true)
      // The batch that IS running is untouched: no Failed row, its Cancel still there.
      await expect(again.getByText('Failed', { exact: true })).toHaveCount(0)
      await expect(again.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      // ...and the refused kit started nothing: no probe, no encoder, no file, and no empty folder left behind.
      await expect.poll(() => readdirSync(kitParent), { timeout: 15_000, intervals: [200] }).toEqual([])
      expect((await readSpawnLog(app)).length).toBe(spawnedBefore)
      expect(mp4sIn(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })

  // ── the kit's empty folder (T-112, item 11) ──
  //
  // `makeKitDir` makes the folder before the first job, so a kit that was canceled or failed
  // before ANY file landed left an empty `Clip_1-kit-<date>` behind, next to a toast saying
  // nothing was made. The renderer now asks main to remove it (`video:removeKitDir`, a
  // non-recursive rmdir) — and only when no finished file landed in it.

  /** Replaces `video:removeKitDir` in main with one that records the folder it was asked about
   *  and then does the real, non-recursive removal. Only the test that asserts the renderer did
   *  NOT ask uses it; the two removal tests run main's own handler. */
  const recordKitDirRemovals = (app: ElectronApplication): Promise<void> =>
    app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __kitRemovals: string[] }
      g.__kitRemovals = []
      const fs = process.getBuiltinModule('node:fs')
      ipcMain.removeHandler('video:removeKitDir')
      ipcMain.handle('video:removeKitDir', async (_e, dir: string) => {
        g.__kitRemovals.push(dir)
        try {
          await fs.promises.rmdir(dir)
        } catch {
          /* not empty: stays */
        }
      })
    })
  const kitRemovals = (app: ElectronApplication): Promise<string[]> =>
    app.evaluate(() => (globalThis as unknown as { __kitRemovals: string[] }).__kitRemovals)

  test('a kit canceled before any file landed takes its empty folder with it (T-112)', async () => {
    test.setTimeout(240_000)
    const { app, window, outDir } = await launchWithVideo('t112kitempty')
    try {
      // The REAL `video:removeKitDir` (preload, IPC, main's rmdir) is what removes the folder here.
      await stubDialogs(app, { open: [outDir] })
      // Job 1's probe is held, so the Cancel lands before any ffmpeg exists and nothing is written.
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 1, ms: 6000 }])
      const kit = kitButton(window)
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 1 of 5…', { timeout: 30_000 })
      // The folder exists now: this is the thing that used to survive.
      expect(existsSync(kitDir)).toBe(true)
      expect(readdirSync(kitDir)).toEqual([])

      await clipListCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        // T-113: nothing had finished, so the folder is gone and the toast does not point at it.
        'Clip Kit canceled.'
      )
      await expect.poll(() => existsSync(kitDir), { timeout: 15_000, intervals: [100] }).toBe(false)
      // Nothing else in the chosen folder: no stray kit, no partial file.
      expect(readdirSync(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a kit that fails before any file landed takes its empty folder with it (T-112)', async () => {
    test.setTimeout(240_000)
    const moved = path.join(root, 'source', `t112-kitfail-${Date.now().toString(36)}.mp4`)
    copyFileSync(clipSrc, moved)
    const { app, window, outDir } = await launchWithVideo('t112kitfail', moved)
    try {
      await stubDialogs(app, { open: [outDir] })
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 1, ms: 6000 }])
      const kit = kitButton(window)
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 1 of 5…', { timeout: 30_000 })
      expect(existsSync(kitDir)).toBe(true)
      rmSync(moved) // while job 1's probe is held: the job fails, the kit with it

      await expectToast(window, 'Clip Kit failed.')
      await expect.poll(() => existsSync(kitDir), { timeout: 15_000, intervals: [100] }).toBe(false)
      expect(readdirSync(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a kit canceled after a file landed keeps its folder, and the renderer does not even ask (T-112)', async () => {
    test.setTimeout(240_000)
    const { app, window, outDir } = await launchWithVideo('t112kitkeep')
    try {
      await stubDialogs(app, { open: [outDir] })
      await recordKitDirRemovals(app)
      // Job 2's probe is held: by the time the label says "2 of 5", job 1's file is on disk.
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 6000 }])
      const kit = kitButton(window)
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      await kit.click()
      await expect(kit).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })

      await clipListCard(window).getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        'Clip Kit canceled. Files already finished are in your folder.'
      )
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)', { timeout: 30_000 })
      // The finished file and its folder are where the toast says they are...
      expect(readdirSync(kitDir)).toEqual(['Clip_1_youtube.mp4'])
      // ...and the kit never asked main to remove a folder it knew had a file in it. (The
      // handler would have refused anyway: this pins that the renderer's own bookkeeping holds.)
      await window.waitForTimeout(1000)
      expect(await kitRemovals(app)).toEqual([])
    } finally {
      await app.close()
    }
  })
})

// ═══════════ Round 63 (T-113): the review gate's second pass ═══════════
//
// Each test below was written red-first against the build the wave was held on; the assertion
// that failed there is quoted in the ledger section for round 63 in INTERACTION_COVERAGE.md.

test.describe('T-113: review-gate fixes, pass 2', () => {
  /** A project that opens a mid-file clip of clipSrc with a transcript, written where the app keeps them. */
  function writeKitProject(
    userDataDir: string,
    clip: { startSec: number; endSec: number; speedMultiplier?: number },
    cues: string
  ): string {
    const captions = path.join(userDataDir, 'captions')
    mkdirSync(captions, { recursive: true })
    const srtPath = path.join(captions, 'real.srt')
    writeFileSync(srtPath, cues, 'utf8')
    const projectPath = path.join(root, `kit-mid-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [
            {
              id: 'mid',
              name: 'Mid',
              ...clip,
              cropRect: null,
              textOverlays: [],
              selectedPresets: ['youtube']
            }
          ],
          selectedClipId: 'mid',
          watermark: null,
          srtPath
        }
      }),
      'utf8'
    )
    return projectPath
  }

  // The recording is 2 s long; two cues on its SOURCE clock.
  const TRANSCRIPT =
    '1\n00:00:00,600 --> 00:00:01,000\nfirst\n\n2\n00:00:01,200 --> 00:00:01,900\nsecond\n'

  test('the kit\'s captions are on the clip\'s clock: shifted to the clip, and divided by its speed (T-113)', async () => {
    test.setTimeout(600_000)
    // Source 0.5-2.0 s at 2x is a 0.75 s file. On the source clock the first cue sits at 0.6 s
    // (past the middle of a file that is 0.75 s long); on the file's clock it is at 0.05 s.
    const studio = await launchHome('kitsrtshift')
    const { app, window, userDataDir, outDir } = studio
    try {
      const projectPath = writeKitProject(userDataDir, { startSec: 0.5, endSec: 2, speedMultiplier: 2 }, TRANSCRIPT)
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })

      await kitButton(window).click()
      await expectToast(window, 'Saved your Clip Kit')
      const kitDir = path.join(outDir, `Mid-kit-${kitStamp()}`)
      expect(readdirSync(kitDir).filter((f) => f.endsWith('.srt'))).toEqual(['Mid_captions.srt'])
      expect(readFileSync(path.join(kitDir, 'Mid_captions.srt'), 'utf8')).toBe(
        '1\n00:00:00,050 --> 00:00:00,250\nfirst\n\n2\n00:00:00,350 --> 00:00:00,700\nsecond\n'
      )
      // The cues fit the file they sit beside: the video is about 0.75 s, the last cue ends at 0.7.
      const info = await ffprobeJson(path.join(kitDir, 'Mid_youtube.mp4'))
      const seconds = Number((info.format as { duration?: string }).duration)
      expect(seconds).toBeGreaterThan(0.6)
      expect(seconds).toBeLessThan(1.1)
      // The transcript the project holds is untouched.
      expect(readFileSync(path.join(userDataDir, 'captions', 'real.srt'), 'utf8')).toBe(TRANSCRIPT)
    } finally {
      await app.close()
    }
  })

  test('a clip nobody speaks in gets no .srt, and the kit says so (T-113)', async () => {
    test.setTimeout(600_000)
    const studio = await launchHome('kitsrtnone')
    const { app, window, userDataDir, outDir } = studio
    try {
      // 0-0.5 s of the recording: both cues come later.
      const projectPath = writeKitProject(userDataDir, { startSec: 0, endSec: 0.5 }, TRANSCRIPT)
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })

      await kitButton(window).click()
      await expectToast(window, 'Saved your Clip Kit (no captions fall inside this clip)')
      const kitDir = path.join(outDir, `Mid-kit-${kitStamp()}`)
      expect(readdirSync(kitDir).filter((f) => f.endsWith('.srt'))).toEqual([])
      expect(readdirSync(kitDir).filter((f) => f.endsWith('.mp4'))).toHaveLength(5)
    } finally {
      await app.close()
    }
  })

  test('the captions panel: the transcript preview scrolls from the keyboard, and the model download is a named progressbar (T-113)', async () => {
    test.setTimeout(240_000)
    // The engine and the model are not installed in any test environment (HL-whisper, and the
    // model is a 141 MB download), so main is told they are and answers for them — the
    // panel's own code, its toasts and its markup are the product's.
    const studio = await launchHome('t113captions')
    const { app, window, userDataDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'a11y.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:02,000\nhello\n', 'utf8')
      await app.evaluate(
        ({ ipcMain, BrowserWindow }, srt) => {
          const g = globalThis as unknown as { __modelDone?: () => void }
          let modelInstalled = false
          ipcMain.removeHandler('captions:status')
          ipcMain.handle('captions:status', () => ({
            exeInstalled: true,
            exePath: 'whisper-cli.exe',
            modelInstalled,
            modelPath: 'model.bin',
            modelsDir: 'models',
            ready: modelInstalled
          }))
          ipcMain.removeHandler('captions:installModel')
          ipcMain.handle(
            'captions:installModel',
            () =>
              new Promise((resolve) => {
                BrowserWindow.getAllWindows()[0]?.webContents.send('captions:modelProgress', {
                  phase: 'downloading',
                  percent: 42
                })
                g.__modelDone = () => {
                  modelInstalled = true
                  resolve({ ok: true, path: 'model.bin' })
                }
              })
          )
          ipcMain.removeHandler('captions:transcribe')
          ipcMain.handle('captions:transcribe', (_e, req: { jobId: string }) => ({
            jobId: req.jobId,
            srtPath: srt,
            segments: Array.from({ length: 30 }, (_v, i) => ({
              startSec: i * 2,
              endSec: i * 2 + 1.5,
              text: `line number ${i + 1}`
            })),
            durationMs: 5
          }))
        },
        srtPath
      )
      await gotoVideoStudio(window)
      await dropOnVideoImporter(window, clipSrc, 'captions-a11y.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      const card = captionsCard(window)

      // ── the model download: a named progressbar with its value ──
      // Not ready (no model yet), so Transcribe opens the setup panel, which holds the download.
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await card.getByRole('button', { name: /Download model/ }).click()
      const bar = card.getByRole('progressbar', { name: 'Downloading the caption model' })
      await expect(bar).toBeVisible({ timeout: 20_000 })
      await expect(bar).toHaveAttribute('aria-valuemin', '0')
      await expect(bar).toHaveAttribute('aria-valuemax', '100')
      await expect(bar).toHaveAttribute('aria-valuenow', '42')
      await app.evaluate(() => (globalThis as unknown as { __modelDone: () => void }).__modelDone())
      await expect(bar).toHaveCount(0)

      // ── the transcript preview is a scroller a keyboard can reach ──
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      const preview = card.getByLabel('Transcript preview')
      await expect(preview).toBeVisible({ timeout: 30_000 })
      await expect(preview).toHaveAttribute('tabindex', '0')
      // T-114: a name on a plain div is not announced; the region role is what makes it a landmark to land on.
      await expect(card.getByRole('region', { name: 'Transcript preview' })).toBeVisible()
      const overflows = await preview.evaluate((el) => el.scrollHeight > el.clientHeight)
      expect(overflows, 'thirty lines overflow the box: it really is a scroller').toBe(true)
      await preview.focus()
      await expect(preview).toBeFocused()
      await window.keyboard.press('End')
      await expect.poll(() => preview.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('a clip stored at speed 0 exports at 1x, as it plays everywhere else (T-113)', async () => {
    test.setTimeout(600_000)
    // The slider, the grid and Compile read a stored 0 as 1x; main's batch validator refuses 0 as out
    // of range, and the Export panel sent the stored clip raw - so the clip that looked ordinary failed.
    const studio = await launchHome('t113speed0')
    const { app, window, outDir } = studio
    try {
      const projectPath = path.join(root, `speed0-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            clips: [
              {
                id: 'zero',
                name: 'Zero',
                startSec: 0,
                endSec: 2,
                cropRect: null,
                textOverlays: [],
                selectedPresets: ['youtube'],
                speedMultiplier: 0
              }
            ],
            selectedClipId: 'zero',
            watermark: null
          }
        }),
        'utf8'
      )
      await stubDialogs(app, { open: [projectPath, outDir] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const card = exportCard(window)
      await expect(card.getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      // The slider reads it as 1x: that is the clip the person sees.
      await expect(clipListCard(window).getByText('1.00×')).toBeVisible()
      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export 1' }).click()
      // Done or refused, whichever comes first - a refusal is a toast in a second, not a file.
      await expect
        .poll(
          async () =>
            mp4sIn(outDir).length > 0 || (await readToastLog(window)).some((t) => /Export failed|can't use/.test(t)),
          { timeout: 540_000, intervals: [500] }
        )
        .toBe(true)
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/setting imagii can't use|Export failed/)
      await expect.poll(() => mp4sIn(outDir).length, { timeout: 540_000, intervals: [500] }).toBe(1)
      await expectToast(window, 'Exported 1 file')
      // 2 s of source at 1x: a 2 s file, not a refusal and not a different speed.
      const info = await ffprobeJson(path.join(outDir, mp4sIn(outDir)[0] as string))
      expect(Math.abs(Number((info.format as { duration?: string }).duration) - 2)).toBeLessThan(0.4)
    } finally {
      await app.close()
    }
  })

  test('the hook badge asks once the speed slider stops moving, for the exact window - not once per tick (T-113, T-115)', async () => {
    test.setTimeout(180_000)
    // The speed slider moves in 0.05 steps and the window is 3 x the speed, so a badge that asked on
    // every change killed the running ffmpeg and started another per tick (T-113). It now waits for the
    // numbers to be still (a trailing debounce) and asks for the EXACT window: three ticks in a row are
    // ONE ask, for the last of them - not zero asks until the next whole second (the T-113/T-114
    // keying, which also left the badge describing the wrong window).
    const { app, window } = await launchWithVideo('t113hookkey', midSrc)
    try {
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __hook: Array<{ durationSec?: number }> }
        g.__hook = []
        ipcMain.removeHandler('video:analyzeClipHook')
        ipcMain.handle('video:analyzeClipHook', (_e, params: { durationSec?: number }) => {
          g.__hook.push(params)
          return { audioEnergyDb: -10 }
        })
      })
      const calls = (): Promise<number[]> =>
        app.evaluate(() =>
          (globalThis as unknown as { __hook: Array<{ durationSec?: number }> }).__hook.map(
            (p) => p.durationSec ?? 0
          )
        )
      const clips = clipListCard(window)
      const speed = window.getByRole('slider', { name: 'Clip playback speed' })
      // Counting starts here: 2x asks for 6 s, then 1x for 3 s.
      await speed.fill('2')
      await expect.poll(async () => (await calls()).at(-1), { timeout: 15_000 }).toBe(6)
      await speed.fill('1')
      await expect.poll(async () => (await calls()).at(-1), { timeout: 15_000 }).toBe(3)
      await expect(clips.getByText('Strong hook', { exact: true })).toBeVisible({ timeout: 20_000 })
      const before = (await calls()).length

      // A drag of the slider: 1.05x, 1.1x and 1.15x are windows of 3.15, 3.3 and 3.45 s, set one after
      // the other with nothing between them (well inside the debounce).
      for (const value of ['1.05', '1.1', '1.15']) await speed.fill(value)
      // The old badge is still up while that settles: no spinner, no gap.
      await expect(clips.getByText('Hook…')).toHaveCount(0)
      await expect(clips.getByText('Strong hook', { exact: true })).toBeVisible()
      // ONE ask, for the exact last window - and still one a moment later.
      await expect.poll(async () => (await calls()).length, { timeout: 15_000 }).toBe(before + 1)
      expect((await calls()).at(-1)).toBeCloseTo(3.45, 5)
      await window.waitForTimeout(800)
      expect(await calls(), 'the three ticks were one ask').toHaveLength(before + 1)

      // 1.2x is 3.6 s: a new settled value is a new ask, again for the exact window.
      await speed.fill('1.2')
      await expect.poll(async () => (await calls()).length, { timeout: 15_000 }).toBe(before + 2)
      expect((await calls()).at(-1)).toBeCloseTo(3.6, 5)
      await expect(clips.getByText('Hook…')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('dragging the start handle asks once, after it settles, with the exact start, and the last badge stays up meanwhile (T-114, T-115)', async () => {
    test.setTimeout(180_000)
    // The badge's effect was keyed on the EXACT start, so every mousemove of a start-handle drag
    // killed the running ffmpeg and started another - and `setScore(null)` + the spinner flashed the
    // badge away on each (T-114). Keyed on whole seconds it stopped that and left the badge describing
    // a start up to half a second away for good; now the ask waits for the handle to be still
    // (a trailing debounce) and carries the exact start, and the previous score stays on screen
    // while the next is worked out.
    const { app, window } = await launchWithVideo('t114hookdrag', burstSrc)
    try {
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as {
          __hook: Array<{ startSec?: number; durationSec?: number }>
          __db: number
          __gate: Promise<void> | null
          __open: () => void
        }
        g.__hook = []
        g.__db = -10 // loud: "Strong hook"
        g.__gate = null
        ipcMain.removeHandler('video:analyzeClipHook')
        ipcMain.handle('video:analyzeClipHook', async (_e, params: { startSec?: number; durationSec?: number }) => {
          g.__hook.push(params)
          if (g.__gate) await g.__gate
          return { audioEnergyDb: g.__db }
        })
      })
      const calls = (): Promise<Array<{ startSec?: number; durationSec?: number }>> =>
        app.evaluate(
          () => (globalThis as unknown as { __hook: Array<{ startSec?: number; durationSec?: number }> }).__hook
        )
      const clips = clipListCard(window)
      const strong = clips.getByText('Strong hook', { exact: true })
      const spinner = clips.getByText('Hook…')
      // The badge asks on its own once the video is loaded; the speed slider is a way to be sure the
      // stand-in has answered - 2x listens to 6 s, back at 1x to 3 s.
      const speed = window.getByRole('slider', { name: 'Clip playback speed' })
      await speed.fill('2')
      await expect.poll(async () => (await calls()).at(-1)?.durationSec, { timeout: 15_000 }).toBe(6)
      await speed.fill('1')
      await expect.poll(async () => (await calls()).at(-1)?.durationSec, { timeout: 15_000 }).toBe(3)
      await expect(strong).toBeVisible({ timeout: 20_000 })
      const before = (await calls()).length

      const track = window.locator('[data-tutorial="video-timeline"] .relative.h-12')
      const trackBox = (await track.boundingBox())!
      const handle = window.locator('[data-tutorial="video-timeline"] button[aria-hidden="true"]').first() // the start handle (T-119: aria-hidden, found by place)
      const handleBox = (await handle.boundingBox())!
      const duration = 14 // burstSrc
      const at = (sec: number): { x: number; y: number } => ({
        x: trackBox.x + trackBox.width * (sec / duration),
        y: trackBox.y + trackBox.height / 2
      })
      /** Where the handle IS, in source seconds - what the trimmed clip's start is. */
      const startOfHandle = async (): Promise<number> => {
        const box = (await handle.boundingBox())!
        return ((box.x + box.width / 2 - trackBox.x) / trackBox.width) * duration
      }

      // ── a drag through 0.10, 0.20, 0.30, 0.40 s: four moves, ONE ask, for where the handle stopped ──
      await dragThrough(
        window,
        { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
        [0.1, 0.2, 0.3, 0.4].map(at)
      )
      // Nothing was asked mid-drag (the moves are a few ms apart), and the badge never went away.
      await expect(strong).toBeVisible()
      await expect(spinner).toHaveCount(0)
      await expect.poll(async () => (await calls()).length, { timeout: 15_000 }).toBe(before + 1)
      await window.waitForTimeout(800)
      expect(await calls(), 'four moves, one ask').toHaveLength(before + 1)
      const first = (await calls())[before]
      const stopped = await startOfHandle()
      expect(stopped).toBeGreaterThan(0.3)
      // The EXACT start - not 0 (the whole second it rounds to) and not a mid-drag value.
      expect(Math.abs((first?.startSec ?? 99) - stopped), `asked for ${first?.startSec}, the handle is at ${stopped}`).toBeLessThan(0.06)
      expect(first?.durationSec).toBe(3)
      await expect(strong).toBeVisible()
      await expect(spinner).toHaveCount(0)

      // ── a second settled position: one more ask, and the PREVIOUS score stays up while it is held ──
      await app.evaluate(() => {
        const g = globalThis as unknown as { __gate: Promise<void> | null; __open: () => void; __db: number }
        g.__db = -40 // quiet: "Weak hook" - what the held answer will say
        g.__gate = new Promise<void>((resolve) => {
          g.__open = resolve
        })
      })
      const moved = (await handle.boundingBox())!
      await dragThrough(
        window,
        { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 },
        [0.6].map(at)
      )
      await expect.poll(async () => (await calls()).length, { timeout: 15_000 }).toBe(before + 2)
      const second = (await calls())[before + 1]
      const stoppedAgain = await startOfHandle()
      expect(stoppedAgain).toBeGreaterThan(0.5)
      expect(Math.abs((second?.startSec ?? 99) - stoppedAgain), `asked for ${second?.startSec}, the handle is at ${stoppedAgain}`).toBeLessThan(0.06)
      // While that analysis is in flight the PREVIOUS score is still the badge: no spinner, no gap.
      await window.waitForTimeout(500)
      await expect(strong, 'the previous score stays up while the next is worked out').toBeVisible()
      await expect(spinner).toHaveCount(0)
      // It lands, and replaces the old one - the badge now describes the exact trimmed window.
      await app.evaluate(() => (globalThis as unknown as { __open: () => void }).__open())
      await expect(clips.getByText('Weak hook', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(strong).toHaveCount(0)
      expect(await calls(), 'and nothing else was asked').toHaveLength(before + 2)
    } finally {
      await app.close()
    }
  })

  test('a clip too short to have a hook shows no hook row and asks for nothing (T-113)', async () => {
    test.setTimeout(180_000)
    // Main takes windows of 0.5 s or more; the badge asked for 0.1 s and died silently on the
    // refusal. A clip whose output is under half a second has no row at all.
    const studio = await launchHome('t113hookshort')
    const { app, window, userDataDir } = studio
    try {
      void userDataDir
      const projectPath = path.join(root, `hookshort-${Date.now().toString(36)}.imagii.json`)
      const clip = (id: string, name: string, endSec: number, speedMultiplier: number) => ({
        id,
        name,
        startSec: 0,
        endSec,
        cropRect: null,
        textOverlays: [],
        selectedPresets: ['youtube'],
        speedMultiplier
      })
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: {
            sourcePath: clipSrc,
            // 1.5 s of source at 4x plays for 0.375 s; 1 s at 2x plays for exactly 0.5 s.
            clips: [clip('tiny', 'Tiny', 1.5, 4), clip('edge', 'Edge', 1, 2)],
            selectedClipId: 'tiny',
            watermark: null
          }
        }),
        'utf8'
      )
      await stubDialogs(app, { open: [projectPath] })
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __hook: unknown[] }
        g.__hook = []
        ipcMain.removeHandler('video:analyzeClipHook')
        ipcMain.handle('video:analyzeClipHook', (_e, params: unknown) => {
          g.__hook.push(params)
          return { audioEnergyDb: -10 }
        })
      })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({
        timeout: 30_000
      })
      const card = clipListCard(window)
      // Tiny: 0.375 s out. No label, no badge, no spinner, and main was never asked.
      await expect(card.getByText(/^First /)).toHaveCount(0)
      await expect(card.getByText('Hook…')).toHaveCount(0)
      await window.waitForTimeout(800)
      expect(await app.evaluate(() => (globalThis as unknown as { __hook: unknown[] }).__hook.length)).toBe(0)

      // Edge: 0.5 s out is a hook (the boundary is inclusive), and main is asked for its 1 s.
      await card.getByRole('button', { name: /^Select clip Edge/ }).click()
      await expect(card.getByText('First 0.5 s:')).toBeVisible()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __hook: unknown[] }).__hook.length), {
          timeout: 15_000
        })
        .toBe(1)
    } finally {
      await app.close()
    }
  })

  test('a 4-minute vertical clip makes the kit ask about the YouTube Short, and only about it (T-113)', async () => {
    test.setTimeout(240_000)
    // midSrc is 300 s. A 9:16 strip of it makes the YouTube slot a Short (3 minutes); Reels' own
    // limit is 20 minutes, and TikTok's an hour, so the Short is the only platform it is long for.
    const { app, window, outDir } = await launchWithVideo('t113short', midSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await window
        .locator('[data-tutorial="video-crop"]')
        .getByRole('button', { name: '9:16', exact: true })
        .click()
      await kitButton(window).click()
      const modal = window.getByRole('dialog')
      await expect(
        modal.getByRole('heading', { name: 'This clip is long for some platforms' }).last()
      ).toBeVisible()
      await expect(modal.getByRole('listitem')).toHaveText(['YouTube Short — the typical 3-minute limit'])
      // Canceling the question starts nothing and makes no folder.
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await expect(modal).toHaveCount(0)
      expect(readdirSync(outDir)).toEqual([])
    } finally {
      await app.close()
    }
  })
})

// ═══════════════════ T-131: review-gate fixes, sweep 17 ═══════════════════

test.describe('T-131: review-gate fixes, sweep 17', () => {
  // (3) The panels stay mounted when the open video is REPLACED in place (Reframe's "Edit in Video Studio" loads the 9:16 file into this very
  // studio), so the highlight finder kept the previous video's candidates and the chat finder its log and its spikes, and a stale "+ Clip"
  // row made a clip past the end of the new file with a success toast. CaptionsPanel resets on the same key (T-112's lesson).
  test('a scan\'s candidates and a pasted chat log go with the video they were made for: Edit in Video Studio shows neither (T-131 (3))', async () => {
    test.setTimeout(600_000)
    const seeded = path.join(root, `t131stale-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t131stale', burstSrc, { video: { lastOutputDir: seeded } })
    try {
      await stubShellReveal(app)
      const scan = highlightCard(window)
      const chat = chatCard(window)
      // The highlight finder: a real scan, one candidate, and a pasted chat log in its own box.
      await scan.getByRole('button', { name: 'Scan VOD' }).click()
      await expect(scan.locator('li')).toHaveCount(1, { timeout: 60_000 })
      await scan.getByRole('button', { name: 'Add chat log (optional)' }).click()
      await scan.locator('textarea').fill(chatLogWithEarlySpike())
      await expect(scan.locator('textarea')).toHaveValue(/hype0/)
      // The chat spike finder: a log and the spike found in it.
      await chat.locator('textarea').fill(chatLogWithEarlySpike())
      await chat.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(chat.locator('li')).toHaveCount(1)
      await expect(scan.getByRole('button', { name: 'Re-scan' })).toBeVisible()

      // Reframe the open video, then open the result in this studio: the video is replaced in place.
      await reframeCard(window).getByRole('button', { name: 'Reframe to 9:16' }).click()
      const editHere = window.locator('[data-rht-toaster]').getByRole('button', { name: 'Edit in Video Studio', exact: true })
      await expect(editHere, 'the saved toast carries the action').toBeVisible({ timeout: 300_000 })
      const reframed = readdirSync(seeded).find((f) => f.endsWith('.mp4'))
      expect(reframed, 'the reframed file is in the folder').toBeDefined()
      window.on('dialog', (dialog) => void dialog.accept())
      await editHere.click()
      const header = window.locator('header')
      await expect(header.getByText(reframed as string, { exact: true })).toBeVisible({ timeout: 30_000 })

      // Nothing of the old video is left in either finder.
      await expect(scan.getByRole('button', { name: 'Scan VOD' }), 'the finder is back to its first state').toBeVisible()
      await expect(scan.getByRole('button', { name: 'Re-scan' })).toHaveCount(0)
      await expect(scan.locator('li'), 'no candidate of the old video').toHaveCount(0)
      await expect(scan.locator('textarea'), 'and the chat log pasted for it is empty').toHaveValue('')
      await expect(chat.locator('li'), 'no spike of the old log').toHaveCount(0)
      await expect(chat.locator('textarea'), 'and the log is empty').toHaveValue('')
      // The settings are not results: the spike window and the extra seconds stay as the person left them.
      await expect(chat.getByLabel('Spike window (s)')).toHaveValue('10')
    } finally {
      await app.close()
    }
  })

  // (3) ...and the same for a scan that is still running when the video is replaced: its candidates are for the video that is gone. The scan is
  // held in main (the handler is replaced by one that answers when the test says), so the replacement lands while it runs.
  test('a scan that finishes after the video was replaced puts nothing on the new video (T-131 (3))', async () => {
    test.setTimeout(600_000)
    const seeded = path.join(root, `t131late-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t131late', burstSrc, { video: { lastOutputDir: seeded } })
    try {
      await stubShellReveal(app)
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __scanRelease: () => void }
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        g.__scanRelease = release
        ipcMain.removeHandler('video:findHighlights')
        ipcMain.handle('video:findHighlights', async () => {
          await gate
          return [{ startSec: 1, endSec: 5, peakDb: -10, reason: 'loud' }]
        })
      })
      const scan = highlightCard(window)
      await scan.getByRole('button', { name: 'Scan VOD' }).click()
      await expect(scan.getByRole('button', { name: 'Scanning…' })).toBeVisible()
      // Replace the open video while the scan is held.
      await reframeCard(window).getByRole('button', { name: 'Reframe to 9:16' }).click()
      const editHere = window.locator('[data-rht-toaster]').getByRole('button', { name: 'Edit in Video Studio', exact: true })
      await expect(editHere).toBeVisible({ timeout: 300_000 })
      const reframed = readdirSync(seeded).find((f) => f.endsWith('.mp4')) as string
      window.on('dialog', (dialog) => void dialog.accept())
      await editHere.click()
      await expect(window.locator('header').getByText(reframed, { exact: true })).toBeVisible({ timeout: 30_000 })
      // Now the old video's scan answers.
      await app.evaluate(() => (globalThis as unknown as { __scanRelease: () => void }).__scanRelease())
      await expect(scan.getByRole('button', { name: 'Scan VOD' }), 'the scan is over and the finder is in its first state').toBeVisible({ timeout: 30_000 })
      await window.waitForTimeout(500)
      await expect(scan.locator('li'), 'no candidate of the video that is gone').toHaveCount(0)
      expect(await readToastLog(window), 'and no "Found 1 highlight" for a video that is not open').not.toContain('Found 1 highlight')
    } finally {
      await app.close()
    }
  })

  // (8) The second press of a double-click on a closing dialog's button lands on what the dialog covered ("Keep running" double-clicked
  // mid-batch flipped the Facebook checkbox beneath it). A listener on the document in the BUBBLE phase records every click that reaches the
  // page; the window's capture-phase swallow stops a repeat before it gets there. Which control sits under the button depends on the
  // window, so the geometry is not the witness - what reached the page is, and every checkbox of the page is read before and after.
  test('a double-click on "Keep running" closes the question and goes no further: the second press reaches nothing under the dialog (T-131 (8))', async () => {
    test.setTimeout(240_000)
    const seeded = path.join(root, `t131keep-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t131keep', clipSrc, { export: { lastOutputDir: seeded } })
    try {
      await setWindowSize(app, window, DEFAULT_WINDOW)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 6_000 }])
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = exportCard(window)
      await card.getByRole('button', { name: /^Export 2 files/ }).click()
      await expect(card.getByRole('button', { name: /^Exporting/ })).toBeVisible()
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toContainText('Cancel 2 running jobs?')
      const checkboxes = (): Promise<boolean[]> => window.locator('input[type="checkbox"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked))
      const before = await checkboxes()
      expect(before.length, 'the page has checkboxes to protect').toBeGreaterThan(3)
      await window.evaluate(() => {
        const w = window as unknown as { __clicks: Array<{ detail: number; what: string }> }
        w.__clicks = []
        document.addEventListener('click', (e) => {
          const el = e.target as HTMLElement
          w.__clicks.push({ detail: e.detail, what: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 30)}`.trim() })
        })
      })
      await dialog.getByRole('button', { name: 'Keep running' }).dblclick()
      await expect(dialog).toHaveCount(0)
      await window.waitForTimeout(600)
      const landed = await window.evaluate(() => (window as unknown as { __clicks: Array<{ detail: number; what: string }> }).__clicks)
      // The first press stops in the dialog's own card (Modal stops its propagation); the second is the repeat the window swallows. Before
      // the fix the second reached the page: one entry here, `detail: 2`, on whatever the dialog stood over.
      expect(landed, 'no click reached the page: the first press stayed in the dialog and the repeat was swallowed').toEqual([])
      expect(await checkboxes(), 'no checkbox under the dialog was flipped').toEqual(before)
      // A press on the page afterwards is a press like any other: the swallow is for the repeat of a double-click, for half a second.
      await expect(card.getByRole('button', { name: /^Exporting/ }), 'Keep running kept the batch running').toBeVisible()
    } finally {
      await app.close()
    }
  })

  // (9) The >=2-jobs "Cancel running jobs?" modal outlived its batch and read "Cancel 0 running jobs?" (the same shape in Clip Kit).
  test('the Cancel question goes when its batch ends: Export asks about 2 jobs and is gone, not "Cancel 0 running jobs?", when they finish (T-131 (9))', async () => {
    test.setTimeout(600_000)
    const seeded = path.join(root, `t131confirm-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t131confirm', clipSrc, { export: { lastOutputDir: seeded } })
    try {
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 2_500 }])
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const card = exportCard(window)
      await card.getByRole('button', { name: /^Export 2 files/ }).click()
      await card.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toContainText('Cancel 2 running jobs?')
      // Nothing is pressed: the batch runs to its end under the question.
      await expect(dialog, 'the question is gone with the batch').toHaveCount(0, { timeout: 300_000 })
      await expect(card.getByRole('button', { name: /^Export 2 files/ })).toBeEnabled()
      expect(mp4sIn(seeded), 'and both jobs finished: the question did not cancel them').toHaveLength(2)
      await expect(window.getByText('Cancel 0 running jobs?')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the Clip Kit Cancel question goes when the kit ends (T-131 (9))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t131kitconfirm', clipSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 1_200 }])
      await kitButton(window).click()
      const cancel = clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      await cancel.click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toContainText('Cancel the Clip Kit batch')
      // Not answered: the kit runs on under the question and finishes, and the question goes with it.
      await expect(dialog, 'the question is gone with the kit').toHaveCount(0, { timeout: 540_000 })
      await expect(kitButton(window)).toBeEnabled({ timeout: 60_000 })
      expect(readdirSync(outDir).length, 'the kit was not canceled by an unanswered question').toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  // (13) The busy Reframe and Compile primaries shrink (Reframe 137 -> 114 px, Compile 112 -> 86 at the default window, measured), and the live
  // folder chip beside them grows into the room (129 -> 152 px): the strip a double-click's second press lands on was the chip's, and a chooser
  // opened mid-job (executed on a 120 ms second press). The chip is off while the job runs - changing the folder does nothing for the running
  // job - and the primaries keep their width.
  test('a second press on the busy primary never opens a chooser: the folder chip is off while a job runs and the primary keeps its width, on Reframe, GIF, Compile and Picture-in-picture (T-131 (13))', async () => {
    test.setTimeout(900_000)
    const seeded = path.join(root, `t131chip-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const { app, window } = await launchWithVideo('t131chip', clipSrc, { video: { lastOutputDir: seeded }, export: { lastOutputDir: seeded } })
    try {
      await recordSlowChooser(app, { answer: null, files: [clipSrc, pipSrc], delayMs: 150 })
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 2_500 }])
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      const compile = compileCard(window)
      await compile.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      const pip = pipCard(window)
      // One at a time: Base and Overlay share the panel's claim, so the second button is pressed once the first answer has landed (the chooser
      // is held 150 ms, and a press inside that hold is the repeat press the claim exists to drop).
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await expect(pip.getByRole('button', { name: `Base: ${path.basename(clipSrc)}` })).toBeVisible()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await expect(pip.getByRole('button', { name: `Overlay: ${path.basename(pipSrc)}` })).toBeVisible()
      const folderChoosers = async (): Promise<number> => (await chooserCalls(app)).filter((c) => c.folder).length
      const problems: string[] = []
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        for (const [label, card, primaryName, busyName] of [
          ['Reframe', reframeCard(window), 'Reframe to 9:16', /^Reframing/],
          ['GIF', gifCard(window), 'Export GIF', /^Exporting/],
          ['Compile', compile, 'Compile 2 clips', /^Stitching/],
          ['Picture-in-picture', pip, 'Composite', /^Compositing/]
        ] as const) {
          const primary = card.getByRole('button', { name: primaryName, exact: true })
          const chip = card.getByRole('button', { name: /^Output folder:/ })
          const idle = await primary.boundingBox()
          if (!idle) throw new Error(`${label}: no primary button`)
          await primary.click()
          const busyButton = card.getByRole('button', { name: busyName })
          await expect(busyButton, `${label}: the job started`).toBeVisible()
          await expect(chip, `${label} at ${where}: the folder chip is off while the job runs`).toBeDisabled()
          // The second press of a double-click at a person's pace, on the left strip of where the primary was.
          await window.waitForTimeout(150)
          await window.mouse.click(idle.x + 1, idle.y + idle.height / 2)
          await window.waitForTimeout(500)
          const asked = await folderChoosers()
          if (asked !== 0) problems.push(`${label} at ${where}: a second press at x ${Math.round(idle.x + 1)} opened ${asked} folder chooser(s)`)
          // The width: a busy primary that is narrower than the idle one gives its strip to the chip.
          const busy = await busyButton.boundingBox()
          if (label === 'Reframe' || label === 'Compile') {
            if (!busy || busy.width < idle.width - 1) problems.push(`${label} at ${where}: the busy primary shrank from ${Math.round(idle.width)} to ${Math.round(busy?.width ?? 0)} px`)
          }
          await expect(card.getByRole('button', { name: primaryName, exact: true }), `${label}: free again`).toBeEnabled({ timeout: 300_000 })
          await expect(chip, `${label}: the chip is back once the job is over`).toBeEnabled()
        }
      }
      expect(problems, 'no chooser opened mid-job, and no primary lost its strip').toEqual([])
      expect(await folderChoosers(), 'and none at all in the whole run').toBe(0)
    } finally {
      await app.close()
    }
  })

  // (14) The inline "Tokens:" hint took the row and the input clipped its own default value at 1024 px (168 px box, 189 px value): the only
  // cut input app-wide. The hint is on its own line under the box.
  test('the filename template shows its whole default value at the 1024 px minimum, and the token hint is under the box (T-131 (14))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t131template')
    try {
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        const box = exportCard(window).getByPlaceholder('{source}_{clip}_{preset}')
        await expect(box).toHaveValue('{source}_{clip}_{preset}')
        const m = await box.evaluate((el) => {
          const input = el as HTMLInputElement
          return { scrollWidth: input.scrollWidth, clientWidth: input.clientWidth, bottom: input.getBoundingClientRect().bottom }
        })
        expect(m.scrollWidth, `the box (${m.clientWidth} px) holds its whole default value at ${where}`).toBeLessThanOrEqual(m.clientWidth)
        const hint = exportCard(window).getByText('Tokens: {source} {clip} {preset} {date} {time} {handle}')
        const hintBox = await hint.boundingBox()
        expect(hintBox, 'the hint is on screen').not.toBeNull()
        expect(hintBox?.y ?? 0, `the hint sits under the box at ${where}`).toBeGreaterThanOrEqual(m.bottom - 1)
      }
    } finally {
      await app.close()
    }
  })

  // (5) Video Studio's entry points: the Importer's "Choose file…", the Picture-in-picture file buttons, and the two kinds of folder chip. Each
  // goes straight to a native chooser; the stand-in answers after 300 ms, as a real one does, and the second press of the double-click lands in it.
  test('a double-click on "Choose file…" opens ONE chooser and loads the file once (T-131 (5))', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('t131importer')
    const { app, window } = studio
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      await recordSlowChooser(app, { files: [clipSrc, burstSrc], delayMs: 300 })
      await window.getByRole('button', { name: 'Choose file…' }).dblclick()
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      await window.waitForTimeout(800)
      expect(await chooserCalls(app), 'one chooser, not two').toHaveLength(1)
      await expect(window.locator('header').getByText(path.basename(clipSrc), { exact: true }), 'the first answer is the video that is open').toBeVisible()
      expect((await readToastLog(window)).filter((t) => t === 'Video loaded'), 'loaded once').toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('a double-click on the Picture-in-picture file buttons opens ONE chooser each, and the first answer stands (T-131 (5))', async () => {
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t131pippick')
    try {
      await recordSlowChooser(app, { files: [clipSrc, pipSrc, burstSrc], delayMs: 300 })
      const pip = pipCard(window)
      await pip.getByRole('button', { name: 'Base: none' }).dblclick()
      await expect(pip.getByRole('button', { name: `Base: ${path.basename(clipSrc)}` })).toBeVisible()
      await window.waitForTimeout(800)
      expect(await chooserCalls(app), 'one chooser for the Base button').toHaveLength(1)
      await pip.getByRole('button', { name: 'Overlay: none' }).dblclick()
      await expect(pip.getByRole('button', { name: `Overlay: ${path.basename(pipSrc)}` })).toBeVisible()
      await window.waitForTimeout(800)
      expect(await chooserCalls(app), 'and one more for the Overlay button').toHaveLength(2)
      await expect(pip.getByRole('button', { name: `Base: ${path.basename(clipSrc)}` }), 'the second answer did not replace the first').toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('a double-click on a folder chip opens ONE chooser: Export\'s own, and the one the GIF, Compile, Reframe and Picture-in-picture panels share (T-131 (5))', async () => {
    test.setTimeout(240_000)
    const first = path.join(root, `t131chip-a-${Date.now().toString(36)}`)
    const second = path.join(root, `t131chip-b-${Date.now().toString(36)}`)
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    const { app, window } = await launchWithVideo('t131folderchip')
    try {
      await recordSlowChooser(app, { answer: first, delayMs: 300 })
      const exportChip = exportCard(window).getByRole('button', { name: 'Choose folder…' })
      await exportChip.dblclick()
      await expect(exportCard(window).getByRole('button', { name: `Output folder: ${path.basename(first)}` })).toBeVisible()
      await window.waitForTimeout(800)
      expect((await chooserCalls(app)).filter((c) => c.folder), 'Export: one folder chooser').toHaveLength(1)

      await recordSlowChooser(app, { answer: second, delayMs: 300 })
      await gifCard(window).getByRole('button', { name: 'Choose folder…' }).dblclick()
      // The four panels hold one folder, so every one of them shows it afterwards.
      for (const card of [gifCard(window), compileCard(window), reframeCard(window), pipCard(window)]) {
        await expect(card.getByRole('button', { name: `Output folder: ${path.basename(second)}` })).toBeVisible()
      }
      await window.waitForTimeout(800)
      expect((await chooserCalls(app)).filter((c) => c.folder), 'the four panels: one folder chooser').toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  // (1) The lead item through the panel: Compile of a source whose SOUND ends before its picture (the shape of Record's mic-drop takes). The
  // clips are set in a project file; the folder is remembered, so the only press is the Compile button. Before the pad, the clip whose range
  // lay past the sound ended the join there ("Saved", 1.5 s of 5.0 s).
  test('Compile keeps every clip of a source whose sound ends before its picture, and the file is as long as its clips (T-131 (1))', async () => {
    test.setTimeout(600_000)
    const seeded = path.join(root, `t131mic-${Date.now().toString(36)}`)
    mkdirSync(seeded, { recursive: true })
    const micSrc = path.join(root, 'source', 't131-mic-drop.mp4')
    await ffmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k',
      micSrc
    ])
    const studio = await launchHome('t131mic', { video: { lastOutputDir: seeded } })
    const { app, window } = studio
    try {
      await stubShellReveal(app)
      const clip = (id: string, name: string, startSec: number, endSec: number) => ({
        id, name, startSec, endSec, cropRect: null, textOverlays: [], selectedPresets: ['youtube']
      })
      const projectPath = path.join(root, `t131mic-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          // 1.5 s inside the sound, 2 s wholly PAST it (the sound ends at 3 s), 1.5 s inside it again: 5.0 s of compilation.
          videoStudio: {
            sourcePath: micSrc,
            clips: [clip('a', 'Early', 0.5, 2), clip('b', 'After the drop', 5, 7), clip('c', 'Early again', 1, 2.5)],
            selectedClipId: 'a',
            watermark: null,
            srtPath: null
          }
        }),
        'utf8'
      )
      await stubDialogs(app, { open: [projectPath] })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const card = compileCard(window)
      await expect(card.getByRole('button', { name: 'Compile 3 clips', exact: true })).toBeEnabled({ timeout: 30_000 })
      await card.getByRole('slider', { name: 'Fade between clips, in milliseconds' }).fill('0')
      await card.getByRole('button', { name: 'Compile 3 clips', exact: true }).click()
      await expect.poll(() => mp4sIn(seeded).length, { timeout: 540_000, intervals: [500] }).toBe(1)
      await expectToast(window, 'Saved ')
      const probe = await ffprobeJson(path.join(seeded, mp4sIn(seeded)[0] as string))
      const secs = Number(probe.format?.duration)
      expect(secs, `all three clips are in the file (5.0 s), not the 1.5 s the first clip alone makes: ${secs}`).toBeGreaterThan(4.8)
      expect(secs).toBeLessThan(5.3)
      // It carries sound for its whole length (silence after the drop is silence, not an end).
      expect(probe.streams?.some((s) => s.codec_type === 'audio'), 'an audio stream').toBe(true)
    } finally {
      await app.close()
    }
  })

  // (5) The two start handlers that were pin-only: Clip Kit (a folder chooser first) and the burn-in (a Save dialog first).
  test('a double-click on Clip Kit opens ONE folder chooser and makes ONE kit (T-131 (5))', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t131kitdbl', clipSrc)
    try {
      await recordSlowChooser(app, { answer: outDir, delayMs: 300 })
      await stubShellReveal(app)
      await kitButton(window).dblclick()
      await expectToast(window, 'Saved your Clip Kit')
      await expect(kitButton(window)).toBeEnabled({ timeout: 60_000 })
      expect((await chooserCalls(app)).filter((c) => c.folder), 'one folder chooser').toHaveLength(1)
      const kits = readdirSync(outDir).filter((f) => f.includes('-kit-'))
      expect(kits, 'one kit folder, not two').toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('a double-click on Burn into video opens ONE save dialog and writes ONE file (T-131 (5))', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('t131burndbl')
    const { app, window, userDataDir, outDir } = studio
    try {
      const srtPath = path.join(userDataDir, 'captions', 'burndbl.srt')
      mkdirSync(path.dirname(srtPath), { recursive: true })
      writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,000\nfirst line\n', 'utf8')
      const projectPath = path.join(root, `t131burndbl-${Date.now().toString(36)}.imagii.json`)
      writeFileSync(
        projectPath,
        JSON.stringify({
          schemaVersion: 2,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          videoStudio: { sourcePath: clipSrc, clips: [], selectedClipId: null, watermark: null, srtPath }
        }),
        'utf8'
      )
      const burned = path.join(outDir, 'burned-once.mp4')
      await recordSlowChooser(app, { files: [projectPath], saveAs: burned, delayMs: 300 })
      await window.getByRole('button', { name: 'Open project' }).click()
      await gotoVideoStudio(window)
      await installToastLog(window)
      const burn = captionsCard(window).getByRole('button', { name: 'Burn into video' })
      await expect(burn).toBeEnabled({ timeout: 30_000 })
      await burn.dblclick()
      await expectToast(window, 'Captions burned in')
      await expect.poll(() => existsSync(burned), { timeout: 60_000 }).toBe(true)
      await window.waitForTimeout(800)
      expect((await chooserCalls(app)).filter((c) => c.save), 'one save dialog, not two').toHaveLength(1)
      expect(mp4sIn(outDir), 'one file').toEqual(['burned-once.mp4'])
      expect((await readToastLog(window)).filter((t) => t === 'Captions burned in'), 'said once').toHaveLength(1)
      await expect(burn, 'and the claim is given back').toBeEnabled({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })
})

// ═══════ T-136 Track A (round 85): a kit that can always be canceled, one conversion at a time, the model download, the Output preview ═══════

test.describe('T-136 (1): a running Clip Kit shows itself, with its Cancel, whichever clip is selected - and after its clip is gone or the video is closed', () => {
  // The clip list draws ONE kit button, for the selected clip. T-135 (1) tied the run to the clip's row, so selecting another clip put the kit's
  // progress and Cancel behind a disabled button with an idle label, and removing the clip or closing the video left no Cancel anywhere until the
  // kit ended minutes later. The kit is a run in a module store; the button shows it whatever is selected, the run names the clip it was started on,
  // and a closed video's kit is cancelable beside the importer.
  /** Start a kit on the first of two clips and hold it in its export phase (job 2's probe is held), so it is still running when the test acts. */
  async function startHeldKit(label: string): Promise<Studio> {
    const studio = await launchWithVideo(label)
    const { app, window, outDir } = studio
    await stubDialogs(app, { open: [outDir] })
    await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
    await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
    await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 25_000 }])
    await kitButton(window).click()
    // "2 of 5": job 1 has landed (so a Cancel finds a folder worth keeping and says so), and job 2's probe is the held one.
    await expect(kitButton(window)).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })
    return studio
  }
  const CANCELED = 'Clip Kit canceled. Files already finished are in your folder.'

  test('selecting another clip keeps the running kit on the button, names the clip it is for, and keeps its Cancel', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t136kit-select')
    try {
      const list = clipListCard(window)
      await list.locator('li').nth(1).getByRole('button', { name: /^Select clip/ }).click()
      await expect(kitButton(window), 'the other clip shows the RUNNING kit, not a dead idle label').toHaveText(EXPORTING_N_OF_5)
      await expect(kitButton(window)).toBeDisabled()
      await expect(list.getByText('Clip Kit for "Clip 1"', { exact: true }), 'and says whose kit it is').toBeVisible()
      const cancel = list.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel, 'its Cancel is reachable from the other clip').toHaveCount(1)
      await cancel.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, CANCELED)
      await expect(kitButton(window)).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      await expect(kitButton(window)).toBeEnabled()
      await expect(list.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      await expect(list.getByText('Clip Kit for "Clip 1"')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('removing the clip the kit was started on leaves the kit running, named, and cancelable', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t136kit-remove')
    try {
      const list = clipListCard(window)
      window.once('dialog', (dialog) => void dialog.accept())
      await list.locator('li').first().getByRole('button', { name: 'Remove clip' }).click()
      await expect(list.locator('li'), 'the owning clip is gone').toHaveCount(1)
      await expect(kitButton(window), 'the kit is still on the button').toHaveText(EXPORTING_N_OF_5)
      await expect(list.getByText('Clip Kit for "Clip 1"', { exact: true }), 'named from the run, not from the clip that was removed').toBeVisible()
      const cancel = list.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toHaveCount(1)
      await cancel.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, CANCELED)
      await expect(kitButton(window)).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
      await expect(kitButton(window)).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('closing the video leaves the kit running beside the importer, with its Cancel', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t136kit-close')
    try {
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByText('Clip Kit for "Clip 1"', { exact: true }), 'the running kit is still shown, by name').toBeVisible()
      await expect(window.getByText(/The video is closed; the kit keeps writing its files/)).toBeVisible()
      const cancel = window.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel, 'and cancelable').toHaveCount(1)
      await cancel.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, CANCELED)
      await expect(window.getByRole('button', { name: 'Cancel', exact: true }), 'the card goes with the kit').toHaveCount(0, { timeout: 60_000 })
      await expect(window.getByText('Clip Kit for "Clip 1"')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

test.describe('T-136 (2): one conversion at a time, and a late one never replaces the video being edited', () => {
  const SENTENCE = "imagii can't preview this video's picture format — trimming, scanning and export still work."
  const importDir = path.join(os.tmpdir(), 'imagii-import')
  const clockOf = (window: Page, text: RegExp): Locator => window.locator('div.font-mono').filter({ hasText: text })

  test('the importer is still busy after a trip to Home: Choose file is off, a second drop is refused, and main refuses a second conversion by name', async () => {
    test.setTimeout(300_000)
    const studio = await launchHome('t136importer')
    const { app, window } = studio
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      // The flv's conversion (the only ffmpeg this page starts) is held, so it is still running when the person is back.
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 20_000 }])
      await dropOnVideoImporter(window, flvSrc, 'stream.flv')
      await expectToast(window, 'Converting for editing')

      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await gotoVideoStudio(window)
      // Back: this is the same import, not an idle importer.
      await expect(window.getByRole('button', { name: 'Choose file…' }), 'off while the conversion runs').toBeDisabled()
      await expect(window.getByText(/Loading…/)).toBeVisible()
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expectToast(window, 'Still converting the last video. Wait for it to finish.')
      await expect(window.locator('video')).toHaveCount(0)
      expect((await readSpawnLog(app)).filter((k) => k === 'ffmpeg'), 'one conversion, not two').toHaveLength(1)

      // Main's own guard, for whoever asks: the same file again is refused in a sentence that names the one that runs.
      const refusal = await window.evaluate(
        (p) => window.api.video.convertForImport(p).then(() => 'started', (e: unknown) => String(e)),
        flvSrc
      )
      expect(refusal).toContain('Still converting "stream.flv". Wait for it to finish, then try again.')
      expect((await readSpawnLog(app)).filter((k) => k === 'ffmpeg'), 'and it started nothing').toHaveLength(1)

      // The conversion ends and the video that opens is the FIRST drop.
      await expect(window.locator('header').getByText('stream.flv', { exact: true })).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('video')).toHaveCount(1)
      await expect(window.getByRole('button', { name: 'Choose file…' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('a video opened while a conversion runs is kept: the late conversion is skipped in a sentence, and the clips are untouched', async () => {
    test.setTimeout(300_000)
    const clip = (id: string, name: string, endSec: number): object => ({
      id,
      name,
      startSec: 0,
      endSec,
      cropRect: null,
      textOverlays: [],
      selectedPresets: ['youtube']
    })
    const projectPath = path.join(root, `t136keep-${Date.now().toString(36)}.imagii.json`)
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 2,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        videoStudio: {
          sourcePath: clipSrc,
          clips: [clip('keep-a', 'Keep A', 1), clip('keep-b', 'Keep B', 2)],
          selectedClipId: 'keep-a',
          watermark: null
        }
      }),
      'utf8'
    )
    const studio = await launchHome('t136keep')
    const { app, window } = studio
    try {
      await gotoVideoStudio(window)
      await installToastLog(window)
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 14_000 }])
      await dropOnVideoImporter(window, flvSrc, 'stream.flv')
      await expectToast(window, 'Converting for editing')

      // While it converts, a project with an mp4 is opened from Home (a video that needs no conversion).
      await stubDialogs(app, { open: [projectPath] })
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.getByRole('button', { name: 'Open project' }).click()
      await expectToast(window, 'Project loaded')
      await gotoVideoStudio(window)
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Keep A', 'Keep B'])

      // The conversion ends. It used to load the copy over the video being edited (and reset its clips to one, with no confirm).
      await expectToast(window, 'Skipped stream.flv because you opened another video while it was converting')
      await window.waitForTimeout(500)
      await expect(window.locator('header').getByText('pipeline.mp4', { exact: true }), 'the video the person opened is still the one open').toBeVisible()
      await expect(window.locator('header').getByText('stream.flv', { exact: true })).toHaveCount(0)
      expect((await clipRows(window)).map((r) => r.name), 'and its clips are untouched').toEqual(['Keep A', 'Keep B'])
      expect(await readToastLog(window), 'no "Video loaded" for a file that was not loaded').not.toContain('Video loaded')
    } finally {
      await app.close()
    }
  })

  test('the preview copy is still being made after a trip to Home: its button is the busy one, one conversion runs, and main refuses another by name', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('t136pcopy', proresSrc)
    try {
      await expect(window.getByText(SENTENCE)).toBeVisible({ timeout: 30_000 })
      // The first ffmpeg after this is the conversion: it is held 20 s, so its working copy does not exist yet while the person is back. A SECOND
      // conversion would not be held (the rule is for the first spawn only) and would write its file at once.
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 20_000 }])
      const before = new Set(existsSync(importDir) ? readdirSync(importDir) : [])
      const copies = (): string[] => (existsSync(importDir) ? readdirSync(importDir) : []).filter((f) => !before.has(f) && /^undecodable-prores-.*\.mp4$/.test(f))
      await window.getByRole('button', { name: 'Make a preview copy' }).click()
      await expect(window.getByRole('button', { name: 'Making a preview copy…' })).toBeDisabled()

      await leaveAndReturn(window)
      await expect(window.getByText(SENTENCE)).toBeVisible({ timeout: 30_000 })
      await expect(
        window.getByRole('button', { name: 'Making a preview copy…' }),
        'not "Make a preview copy" again: a copy is being made, and a second press would start a second conversion'
      ).toBeDisabled()
      // Main's own guard, for whoever asks: another conversion is refused in a sentence naming the one that runs, and starts nothing.
      const refusal = await window.evaluate(
        (p) => window.api.video.convertForImport(p).then(() => 'started', (e: unknown) => String(e)),
        proresSrc
      )
      expect(refusal).toContain('Still converting "undecodable-prores.mov". Wait for it to finish, then try again.')
      await window.waitForTimeout(2_500)
      expect(copies(), 'no second conversion wrote a working copy while the first was held').toEqual([])

      // It ends and the copy is swapped in, as it always was: one working copy.
      await expect(window.getByText(SENTENCE)).toBeHidden({ timeout: 120_000 })
      expect(copies()).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('a preview copy that is finished while the person is away comes back at the playhead it was asked at, not at 0:00', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('t136pcopypos', proresSrc)
    try {
      await expect(window.getByText(SENTENCE)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 2_000 }])
      const before = new Set(existsSync(importDir) ? readdirSync(importDir) : [])
      // The playhead at 1.0 s of a 2 s picture.
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl: HTMLVideoElement }).__imagiiVideoEl
        v.currentTime = 1
      })
      await expect(clockOf(window, /^0:01\.\d\d \/ 0:02\.\d\d$/)).toBeVisible({ timeout: 15_000 })
      await window.getByRole('button', { name: 'Make a preview copy' }).click()
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // The copy is made while nobody is looking at the Player: the working copy appears and stops growing.
      const copies = (): string[] => (existsSync(importDir) ? readdirSync(importDir) : []).filter((f) => !before.has(f) && /^undecodable-prores-.*\.mp4$/.test(f))
      await expect.poll(() => copies().length, { timeout: 60_000, intervals: [250] }).toBe(1)
      const copy = path.join(importDir, copies()[0] as string)
      let last = -1
      await expect
        .poll(
          async () => {
            const size = statSync(copy).size
            const settled = size > 1000 && size === last
            last = size
            return settled
          },
          { timeout: 60_000, intervals: [1_500] }
        )
        .toBe(true)

      await gotoVideoStudio(window)
      await expect(window.getByText(SENTENCE), 'the copy is the one playing').toBeHidden({ timeout: 60_000 })
      await expect(clockOf(window, /^0:01\.\d\d \/ 0:02\.\d\d$/), 'at the playhead it was made at').toBeVisible({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })
})

test.describe('T-136 (4): the caption model download keeps its bar and its Cancel across a trip to Home', () => {
  // The panel kept `installing` / `installProgress` in useState, so a trip to Home came back with no bar, no Cancel and Download re-enabled (main
  // refused its second press), and the download that ended meanwhile refreshed the status of a panel that was gone, so Transcribe reopened the setup.
  /** main's `net.request` replaced by a download that starts, reports progress up to 40%, and never ends (the real one is 141 MB from Hugging Face). */
  async function stubNeverEndingDownload(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ net }) => {
      const events = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule('node:events') as typeof import('node:events')
      net.request = (() => {
        const request = new events.EventEmitter() as import('node:events').EventEmitter & { end: () => void; abort: () => void }
        let timer: ReturnType<typeof setInterval> | null = null
        request.end = () => {
          setTimeout(() => {
            const response = new events.EventEmitter() as import('node:events').EventEmitter & { statusCode: number; headers: Record<string, string> }
            response.statusCode = 200
            response.headers = { 'content-length': '1000000' }
            request.emit('response', response)
            let sent = 0
            timer = setInterval(() => {
              if (sent >= 400_000) return
              sent += 20_000
              response.emit('data', Buffer.alloc(20_000))
            }, 150)
          }, 50)
        }
        request.abort = () => {
          if (timer) clearInterval(timer)
          request.emit('abort')
        }
        return request
      }) as unknown as typeof net.request
    })
  }

  test('leave mid-download and come back: the bar and the Cancel are there, Download is off, and Cancel stops it', async () => {
    test.setTimeout(240_000)
    const studio = await launchWithVideo('t136model', clipSrc)
    const { app, window, userDataDir } = studio
    try {
      await stubNeverEndingDownload(app)
      const card = captionsCard(window)
      const bar = card.getByRole('progressbar', { name: 'Downloading the caption model' })
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await card.getByRole('button', { name: /Download model/ }).click()
      await expect(bar).toBeVisible({ timeout: 20_000 })
      await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 20_000 }).toBeGreaterThanOrEqual(10)

      await leaveAndReturn(window)
      await expect(bar, 'the bar is drawn for the download that is still running').toBeVisible({ timeout: 20_000 })
      await expect(card.getByRole('button', { name: 'Downloading model…' }), 'Download is off: a second press would be refused by main').toBeDisabled()
      await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 20_000 }).toBeGreaterThanOrEqual(10)
      const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toHaveCount(1)
      await cancel.click()
      await expectCanceledNotFailed(window, 'Download canceled.')
      await expect(bar).toHaveCount(0)
      await expect(card.getByRole('button', { name: /Download model/ }), 'ready for another try').toBeEnabled()
      const partials = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.partial')) : [])
      expect(partials(path.join(userDataDir, 'models')), 'the partial file is gone').toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a download that ends after the person came back leaves the panel ready: no setup card, and Transcribe transcribes', async () => {
    test.setTimeout(240_000)
    const studio = await launchHome('t136modeldone')
    const { app, window } = studio
    try {
      // The engine and the model are not installed in any test environment, so main is told they are, as the T-113 case does.
      await app.evaluate(({ ipcMain, BrowserWindow }) => {
        const g = globalThis as unknown as { __modelDone?: () => void }
        let modelInstalled = false
        ipcMain.removeHandler('captions:status')
        ipcMain.handle('captions:status', () => ({
          exeInstalled: true,
          exePath: 'whisper-cli.exe',
          modelInstalled,
          modelPath: 'model.bin',
          modelsDir: 'models',
          ready: modelInstalled
        }))
        ipcMain.removeHandler('captions:installModel')
        ipcMain.handle(
          'captions:installModel',
          () =>
            new Promise((resolve) => {
              BrowserWindow.getAllWindows()[0]?.webContents.send('captions:modelProgress', { phase: 'downloading', percent: 42 })
              g.__modelDone = () => {
                modelInstalled = true
                resolve({ ok: true, path: 'model.bin' })
              }
            })
        )
        ipcMain.removeHandler('captions:transcribe')
        ipcMain.handle('captions:transcribe', (_e, req: { jobId: string }) => ({
          jobId: req.jobId,
          srtPath: 'stand-in.srt',
          segments: [{ startSec: 0, endSec: 1.5, text: 'a stand-in line' }],
          durationMs: 5
        }))
      })
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, 'model-done.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await card.getByRole('button', { name: /Download model/ }).click()
      const bar = card.getByRole('progressbar', { name: 'Downloading the caption model' })
      await expect(bar).toHaveAttribute('aria-valuenow', '42', { timeout: 20_000 })

      await leaveAndReturn(window)
      await expect(bar).toBeVisible({ timeout: 20_000 })
      await expect(card.getByText('Captions need setup')).toBeVisible()
      // The download ends now, with this panel on screen (the one that STARTED it is gone).
      await app.evaluate(() => (globalThis as unknown as { __modelDone: () => void }).__modelDone())
      await expectToast(window, 'Caption model downloaded')
      await expect(bar).toHaveCount(0)
      await expect(card.getByText('Captions need setup'), 'the setup card goes: the engine and the model are there').toHaveCount(0)
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expect(card.getByLabel('Transcript preview'), 'Transcribe transcribes; it does not reopen the setup').toBeVisible({ timeout: 30_000 })
      await expect(card.getByText('Captions need setup')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

test.describe('T-136 (6): the Output preview says why it is black, until a preview copy can be drawn', () => {
  const NOTE = "No snapshot to show: imagii can't preview this video's picture format. Your exports are not affected."
  const LIVE = /Live snapshot at the playhead position/
  const previewCard = (window: Page): Locator => window.locator('.card').filter({ has: window.getByRole('heading', { name: 'Output preview' }) })

  test('a ProRes file replaces "Live snapshot..." with a one-line note; the copy brings the caption back; a decodable video never shows the note', async () => {
    test.setTimeout(300_000)
    const proRes = await launchWithVideo('t136preview', proresSrc)
    try {
      const card = previewCard(proRes.window)
      await expect(card.getByText(NOTE), 'the note, in the card').toBeVisible({ timeout: 30_000 })
      await expect(card.getByText(LIVE), 'and not a caption promising what is not there').toHaveCount(0)
      // The moment that matters is the one the final state hides: the copy is in the store and the <video> has its source, but the element has not
      // reported yet, so the Player's verdict is still "cannot draw" for a beat. The note is about a picture that cannot be drawn WITHOUT a copy; the
      // instant a copy exists it is untrue. A DOM observer, armed before the press, reads the page after every change from here on: no change may leave
      // the <video> on the copy while the card still says there is no snapshot (the final state alone cannot tell the two apart - the verdict clears
      // itself once the copy loads).
      await proRes.window.evaluate((note) => {
        const seen = { sawCopy: false, noteOverCopy: 0 }
        ;(window as unknown as { __copySeen: typeof seen }).__copySeen = seen
        const original = document.querySelector('video')?.getAttribute('src')
        new MutationObserver(() => {
          const src = document.querySelector('video')?.getAttribute('src')
          if (!src || src === original) return
          seen.sawCopy = true
          if (document.body.textContent?.includes(note)) seen.noteOverCopy += 1
        }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
      }, NOTE)
      await proRes.window.getByRole('button', { name: 'Make a preview copy' }).click()
      await expect(card.getByText(LIVE), 'the copy can be drawn: the caption is true again').toBeVisible({ timeout: 120_000 })
      await expect(card.getByText(NOTE)).toHaveCount(0)
      const seen = await proRes.window.evaluate(() => (window as unknown as { __copySeen: { sawCopy: boolean; noteOverCopy: number } }).__copySeen)
      expect(seen.sawCopy, 'the observer saw the <video> move to the copy (it watched the right thing)').toBe(true)
      expect(seen.noteOverCopy, 'and the note was never on screen once the <video> was on the copy').toBe(0)
    } finally {
      await proRes.app.close()
    }
    const plain = await launchWithVideo('t136previewok', clipSrc)
    try {
      const card = previewCard(plain.window)
      await expect(card.getByText(LIVE)).toBeVisible({ timeout: 30_000 })
      await plain.window.waitForTimeout(500)
      await expect(card.getByText(NOTE)).toHaveCount(0)
    } finally {
      await plain.app.close()
    }
  })
})

// ═════════ The chat spike finder's range, extra seconds, empty result and number boxes (T-136 (9)) ═════════

// A late import on purpose: this block is appended so the two tracks of the round land cleanly, and the line beside the others would be a hunk both touch.
import { expectSameRow } from './layout'

/** What the panel says under the button for a log that was analyzed and holds no spike (`NO_CHAT_SPIKES_MESSAGE`, `shared/chatPeaks.ts`). */
const NO_SPIKES_LINE =
  'No chat spikes found. A spike is a window with at least 5 messages and twice as many as a usual window, and the log needs messages in at least 3 different windows to compare.'

/**
 * T-136 (9): a LONG, moderately busy stretch of chat - a raid. A quiet bed of one message per 10 s window to 1000 s (the median must be the bed's), and twenty adjacent windows from 100 s
 * to 290 s with 6 messages each (120 in all, the densest window 6). One row: from 100 - 15 = 85 s (1:25) to 290 + 10 + 15 = 315 s (5:15).
 */
function chatLogWithLongRun(offsetSec = 0, perWindow = 6): string {
  const lines: string[] = []
  for (let t = 1; t < 1000; t += 10) {
    if (t >= 100 && t < 300) continue
    lines.push(`[${mmss(t + offsetSec)}] viewer${t}: quiet chatter ${t}`)
  }
  for (let bucket = 100; bucket < 300; bucket += 10) {
    for (let i = 0; i < perWindow; i++) lines.push(`[${mmss(bucket + (i % 10) + offsetSec)}] raid${bucket}x${i}: welcome raiders`)
  }
  return lines.join('\n')
}

/** Twenty messages in only two different windows: loud, and nothing to compare it against. */
function chatLogInTwoWindows(): string {
  const lines: string[] = []
  for (let i = 0; i < 10; i++) lines.push(`[${mmss(i)}] a${i}: POG`)
  for (let i = 0; i < 10; i++) lines.push(`[${mmss(10 + i)}] b${i}: POG`)
  return lines.join('\n')
}

test.describe('ChatHighlightPanel - range, extra seconds, empty result, alignment (T-136 (9))', () => {
  test('a long spike shows where it runs, and + Clip adds exactly that range', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t136chat-range', longSrc)
    try {
      const card = chatCard(window)
      await card.locator('textarea').fill(chatLogWithLongRun())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li'), 'twenty windows in a row are one spike').toHaveCount(1)
      const row = card.locator('li').first()
      await expect(row.locator('span.font-mono'), 'the row says how long the clip it adds is').toHaveText('1:25 → 5:15')
      await expect(row.getByText('120 messages')).toBeVisible()
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      expect(await clipRows(window), 'what the row said is what landed').toEqual([{ name: 'Chat spike 1', range: '1:25 → 5:15' }])
    } finally {
      await app.close()
    }
  })

  test('the extra seconds are 0 to 60: a negative number is clamped when typing ends, and the clip it adds has a real length', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t136chat-pad', longSrc)
    try {
      const card = chatCard(window)
      const pad = card.getByLabel('Extra seconds around each clip')
      await expect(pad).toHaveValue('15')
      await card.locator('textarea').fill(chatLogWithOneSpike())

      // -5 used to be taken as typed: a window of zero length (30 + 5 .. 30 + 10 - 5), and a "+ Clip" refusal that blamed the log.
      await retype(pad, '-5')
      await leave(pad)
      await expect(pad, 'a negative number is clamped to 0 when typing ends').toHaveValue('0')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      const row = card.locator('li').first()
      await expect(row.locator('span.font-mono')).toHaveText('0:30 → 0:40')
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      expect(await clipRows(window)).toEqual([{ name: 'Chat spike 1', range: '0:30 → 0:40' }])

      await retype(pad, '600')
      await leave(pad)
      await expect(pad, 'and a number past 60 is 60').toHaveValue('60')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:00 → 1:40')

      // An emptied box goes back to what it was, as the spike window's does.
      await pad.click()
      await pad.press('Control+a')
      await pad.press('Backspace')
      await expect(pad, 'emptied: nothing snaps back into it').toHaveValue('')
      await leave(pad)
      await expect(pad).toHaveValue('60')
      // A number inside the range is kept as typed, a fraction of a second included.
      await retype(pad, '2.5')
      await leave(pad)
      await expect(pad).toHaveValue('2.5')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:27 → 0:42')
    } finally {
      await app.close()
    }
  })

  test('a log with no spike leaves the rule on the panel, which is gone when a spike is found and is still there after a trip to Home', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t136chat-empty', longSrc)
    try {
      const card = chatCard(window)
      const line = card.getByText(NO_SPIKES_LINE, { exact: true })
      // Not analyzed yet: nothing to say, which is not the same as "analyzed, and there is none".
      await expect(line).toHaveCount(0)

      await card.locator('textarea').fill(chatLogWithNoSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expectToast(window, 'No chat spikes detected')
      await expect(line, 'the rule stays on the panel after the 4 s toast is gone').toBeVisible()
      await expect(card.locator('li')).toHaveCount(0)

      // A trip to Home and back keeps it: the result is the open video's.
      await leaveAndReturn(window)
      await expect(line).toBeVisible()

      // A log that has too few windows to compare is the same refusal in the same words.
      await card.locator('textarea').fill(chatLogInTwoWindows())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(line).toBeVisible()
      await expect(card.locator('li')).toHaveCount(0)

      // A text with no messages is a refusal of the LOG, not an empty result: the rule is not printed for it, and what was there stays.
      await card.locator('textarea').fill('these are my stream notes')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expectToast(window, 'No timestamped messages found')

      // A spike takes the line away.
      await card.locator('textarea').fill(chatLogWithOneSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li')).toHaveCount(1)
      await expect(line).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the two number boxes share one line at the minimum window, the default one and 1920 px, and a row keeps its range and count on one line', async () => {
    test.setTimeout(120_000)
    // T-137 (9): the row shows the range held to the video, so the widest row needs a video that long: a ten-hour-and-six-minute picture at 1 fps, 64x48, black
    // (half a megabyte, two seconds to make). The test used a 2 s video and a log ten hours in, which only drew the raw range.
    const marathon = path.join(root, 'source', 'marathon.mp4')
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1:d=36400', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '600', '-pix_fmt', 'yuv420p', marathon])
    const { app, window } = await launchWithVideo('t136chat-layout', marathon)
    try {
      const card = chatCard(window)
      // The widest row the panel draws: a spike ten hours into a marathon stream ("10:01:25 → 10:05:15") with a four-digit count ("1200 messages"). At the 1024 px minimum the card leaves the row 258 px: 122 for a 17-character range and 33 for
      // "+ Clip" left 87 for a count, and "120 messages" is 86 of them, so a longer range or a fourth digit pushed the row past its edge.
      await card.locator('textarea').fill(chatLogWithLongRun(36000, 60))
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li')).toHaveCount(1)
      await expect(card.locator('li span.font-mono'), 'the widest range the panel draws').toHaveText('10:01:25 → 10:05:15')
      await expect(card.locator('li').getByText('1200 messages'), 'and the biggest count').toBeVisible()
      const problems: string[] = []
      const check = async (run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      for (const [size, where] of [
        [MIN_WINDOW, 'the 1024 px minimum'],
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [{ width: 1920, height: 1080 }, '1920 px']
      ] as const) {
        await setWindowSize(app, window, size)
        // The long label ("Extra seconds around each clip") wraps in the narrow column and the short one does not: the boxes sat 16 px apart.
        await check(() =>
          expectSameRow(
            [
              { name: 'the Spike window box', locator: card.getByLabel('Spike window (s)') },
              { name: 'the Extra seconds box', locator: card.getByLabel('Extra seconds around each clip') }
            ],
            `the chat spike finder's number boxes at ${where}`
          )
        )
        await check(() => expectNoHorizontalOverflow(card, `the chat spike finder at ${where}`))
        // The list scrolls (it is `overflow-y-auto`, which makes sideways overflow auto too), so a row wider than its list is a scrollbar the card check above
        // does not see: the list and the row are measured themselves, and the row's "+ Clip" must end inside the row.
        await check(() => expectNoHorizontalOverflow(card.locator('ul'), `the spike list at ${where}`))
        const clipButton = card.locator('li').getByRole('button', { name: '+ Clip' })
        await check(() => expectControlsWhole(card.locator('li'), clipButton, `the spike row's + Clip at ${where}`))
        await check(() => expectOneLine(card.locator('li span'), `the spike row's range and count at ${where}`))
        // "+ Clip" is one line, and it ends at the row's right edge whether it shares the first line or the count left it no room (it drops under the range).
        await check(() => expectOneLine(clipButton, `the spike row's + Clip at ${where}`))
        await check(async () => {
          const fromEdge = await clipButton.evaluate((el) => {
            const li = el.closest('li') as HTMLElement
            return Math.round(li.getBoundingClientRect().right - parseFloat(getComputedStyle(li).paddingRight) - el.getBoundingClientRect().right)
          })
          expect(Math.abs(fromEdge), `+ Clip ends ${fromEdge} px from the row's right edge at ${where}`).toBeLessThanOrEqual(1)
        })
      }
      expect(problems, 'the two boxes are on one line at every size, and so is the row').toEqual([])
    } finally {
      await app.close()
    }
  })
})

// ═══════ T-137 Track A (round 86): the running Clip Kit's label and live region, and the preview copy's skip toast ═══════

test.describe('T-137 (3), (4): the running Clip Kit keeps its label on one line with its Cancel under it, and its card speaks from a live region that was already there', () => {
  /** Start a kit on the first of two clips and hold it in its export phase (job 2's probe is held), so it is still running when the test acts. */
  async function startHeldKit(label: string): Promise<Studio> {
    const studio = await launchWithVideo(label)
    const { app, window, outDir } = studio
    await stubDialogs(app, { open: [outDir] })
    await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
    await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
    await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 25_000 }])
    await kitButton(window).click()
    await expect(kitButton(window)).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })
    return studio
  }
  /** The studio's live region for the closed-video kit card: a direct child of the studio's column, mounted whether a video is open or not. */
  const REGION = 'div.h-full.overflow-auto > div[aria-live="polite"]'

  test('the running label is one line at the default window and at the minimum, its Cancel sits on a row of its own under it, and nothing pokes out of the clip list', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t137kitline')
    try {
      const list = clipListCard(window)
      const cancel = list.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toHaveCount(1)
      for (const [where, size] of [['the default window', DEFAULT_WINDOW], ['the minimum window', MIN_WINDOW]] as const) {
        await setWindowSize(app, window, size)
        await expect(kitButton(window)).toHaveText('Exporting platform version 2 of 5…')
        await expectOneLine(kitButton(window), `the running kit label at ${where}`)
        await expectNoHorizontalOverflow(list, `the clip list at ${where}`)
        const geometry = await window.evaluate(() => {
          const button = document.querySelector('button[title="Export this clip for all 5 platforms + 3 thumbnails into one folder"]') as HTMLElement
          const cancelButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Cancel' && b.title === 'Cancel Clip Kit') as HTMLElement
          const b = button.getBoundingClientRect()
          const c = cancelButton.getBoundingClientRect()
          return { buttonTop: b.top, buttonBottom: b.bottom, buttonRight: b.right, cancelTop: c.top, cancelBottom: c.bottom, cancelRight: c.right, buttonHeight: b.height }
        })
        expect(geometry.cancelTop, `Cancel is on a row of its own, under the button, at ${where} (button ends ${Math.round(geometry.buttonBottom)}, Cancel starts ${Math.round(geometry.cancelTop)})`).toBeGreaterThanOrEqual(geometry.buttonBottom - 0.5)
        expect(Math.abs(geometry.cancelRight - geometry.buttonRight), `and ends where the button does, at ${where}`).toBeLessThanOrEqual(1)
        // A one-line label in a text-xs button with py-1 is about 26 px tall; the wrapped one was 42.
        expect(geometry.buttonHeight, `the button is one line tall at ${where}`).toBeLessThan(34)
      }
      await cancel.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, 'Clip Kit canceled. Files already finished are in your folder.')
    } finally {
      await app.close()
    }
  })

  test('the card for a kit that outlives its video is announced from a live region that was already mounted - empty while no kit runs, leaving no gap - and the same element holds it', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('t137kitlive')
    const { app, window, outDir } = studio
    try {
      // Before any kit: the region is there, empty, and takes no room (the studio's column has a 20 px gap between its children).
      await expect(window.locator(REGION), 'the region is mounted with a video open and no kit running').toHaveCount(1)
      await expect(window.locator(REGION)).toHaveText('')
      const gapOpen = await window.evaluate(() => {
        const header = document.querySelector('div.h-full.overflow-auto > header') as HTMLElement
        const grid = document.querySelector('div.h-full.overflow-auto > div.grid') as HTMLElement
        return Math.round(grid.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
      })
      expect(gapOpen, 'an empty region leaves no hole between the header and the studio').toBe(20)
      const region = await window.locator(REGION).elementHandle()
      expect(region, 'the region element').not.toBeNull()

      await stubDialogs(app, { open: [outDir] })
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 25_000 }])
      await kitButton(window).click()
      await expect(kitButton(window)).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })
      // The video is open, so the clip list's own kit button shows the run and the closed-video card is not drawn.
      await expect(window.locator(REGION)).toHaveText('')

      // Close the video: the card arrives INSIDE the region that was there before it had anything to say.
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
      await expect(window.locator(REGION)).toContainText('Clip Kit for "Clip 1"')
      await expect(window.locator(REGION)).toContainText('The video is closed; the kit keeps writing its files until it finishes or you cancel it.')
      expect(await region?.evaluate((el) => el.isConnected), 'the same element, not a region mounted together with its text').toBe(true)
      expect(await window.locator('div[aria-live="polite"] p[aria-live]').count(), 'the paragraph inside carries no live region of its own').toBe(0)
      // The importer sits where it always did: the empty region adds no gap either.
      const gapClosed = await window.evaluate(() => {
        const card = document.querySelector('[data-tutorial="video-import"]') as HTMLElement
        const region = document.querySelector('div.h-full.overflow-auto > div[aria-live="polite"]') as HTMLElement
        return Math.round(card.getBoundingClientRect().top - region.getBoundingClientRect().bottom)
      })
      expect(gapClosed, 'the card, then the importer, one gap apart').toBe(20)

      await window.getByRole('button', { name: 'Cancel', exact: true }).click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, 'Clip Kit canceled. Files already finished are in your folder.')
      // The kit is over: the card goes, the region stays - still the same element, empty again, and no hole above the importer.
      await expect(window.locator(REGION)).toHaveText('', { timeout: 60_000 })
      expect(await region?.evaluate((el) => el.isConnected)).toBe(true)
      const gapAfter = await window.evaluate(() => {
        const header = document.querySelector('div.h-full.overflow-auto > header') as HTMLElement
        const card = document.querySelector('[data-tutorial="video-import"]') as HTMLElement
        return Math.round(card.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
      })
      expect(gapAfter, 'the importer is one gap under the header, as it was before the region existed').toBe(20)
    } finally {
      await app.close()
    }
  })
})

test.describe('T-137 (5): a preview copy that finishes for a video that was closed does not say the person opened another one', () => {
  const SENTENCE = "imagii can't preview this video's picture format — trimming, scanning and export still work."

  test('closing the video while the copy is made says it was closed or replaced, and names the file', async () => {
    test.setTimeout(300_000)
    const { app, window } = await launchWithVideo('t137pcopyclose', proresSrc)
    try {
      await expect(window.getByText(SENTENCE)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 6_000 }])
      await window.getByRole('button', { name: 'Make a preview copy' }).click()
      await expect(window.getByRole('button', { name: 'Making a preview copy…' })).toBeDisabled()
      window.once('dialog', (dialog) => void dialog.accept())
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })

      const toasts = await expectToast(
        window,
        'Skipped the preview copy for undecodable-prores.mov because the video was closed or replaced while the copy was being made'
      )
      expect(toasts.join(' | '), 'nobody opened another video').not.toMatch(/you opened another video/)
    } finally {
      await app.close()
    }
  })
})


// ══════════════ ChatHighlightPanel - the row is the range "+ Clip" adds (T-137 (9)) ══════════════
//
// The row printed the spike's raw ends while "+ Clip" clamped both to the video (T-48), so a spike near a VOD's end read "19:35 -> 20:15" for a 20:00 video and
// the clip that came out was 19:35 -> 20:00: not "exactly that range" (USER_GUIDE). The row now shows the clamped range, and the clip is the row.

/** A quiet bed of one message per 10 s bucket for the last two minutes of a `duration`-second video, and 9 messages inside its LAST bucket (a spike at the tail). */
function chatLogWithTailSpike(duration: number): { log: string; lastBucket: number } {
  const lastBucket = Math.floor((duration - 1) / 10) * 10
  const lines: string[] = []
  for (let t = lastBucket - 120 + 1; t < lastBucket; t += 10) lines.push(`[${mmss(t)}] viewer${t}: quiet chatter ${t}`)
  for (let i = 0; i < 9; i++) lines.push(`[${mmss(lastBucket + i)}] hype${i}: POG that was insane`)
  return { log: lines.join('\n'), lastBucket }
}

test.describe('ChatHighlightPanel - the range a row shows is the range + Clip adds (T-137 (9))', () => {
  test('a spike at the end of the video shows its end held to the video, and + Clip adds exactly that range', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('t137chat', longSrc)
    try {
      const card = chatCard(window)
      const { log, lastBucket } = chatLogWithTailSpike(longSeconds)
      await card.locator('textarea').fill(log)
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li')).toHaveCount(1)
      const row = card.locator('li').first()
      // The padded window is [lastBucket - 15, lastBucket + 10 + 15]: its end is past the video (lastBucket + 25 > duration), its start is not.
      expect(lastBucket + 25, 'the spike really ends past the video').toBeGreaterThan(longSeconds)
      const shown = (await row.locator('span.font-mono').innerText()).trim()
      const [from, to] = shown.split(' → ') as [string, string]
      const seconds = (clock: string): number => clock.split(':').reduce((total, part) => total * 60 + Number(part), 0)
      expect(seconds(from), 'the start is the padded start').toBe(lastBucket - 15)
      expect.soft(seconds(to), 'the end is the video\'s, not the padded 25 s past the last bucket').toBeLessThanOrEqual(Math.ceil(longSeconds))
      expect(seconds(to)).toBeGreaterThan(seconds(from))
      // And the clip is the row, to the second.
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expectToast(window, 'Clip added')
      expect(await clipRows(window), 'the clip lands with the range the row showed').toEqual([{ name: 'Chat spike 1', range: shown }])
    } finally {
      await app.close()
    }
  })
})

// ═══════ T-138 (4): the Clip Kit's Cancel question is not drawn inside a live region ═══════
//
// The closed-video card sits in `ClipKitRunning`'s always-mounted `aria-live` wrapper (T-137 (3)), and its Cancel rendered the confirm `<Modal>` inline (Modal
// does not portal): pressing Cancel inserted the whole dialog into the polite region (executed: `[role=dialog].closest('[aria-live]')` was the wrapper). The
// question is a sibling of the wrapper now. The clip list's own Cancel is not inside any live region and keeps its arrangement.

test.describe('T-138 (4): the Clip Kit\'s Cancel question is outside every live region, on the closed-video card and in the clip list', () => {
  /** The studio's live region for the closed-video kit card (T-137 (3)): a direct child of the studio's column. */
  const REGION = 'div.h-full.overflow-auto > div[aria-live="polite"]'

  /** What the open dialog is inside, from the page: null when no ancestor is a live region or a status. */
  async function liveAncestorOfDialog(window: Page): Promise<string | null> {
    return window.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) throw new Error('no dialog on screen')
      const hit = dialog.closest('[aria-live],[role="status"]')
      return hit ? `${hit.tagName.toLowerCase()}[${hit.getAttribute('aria-live') ?? hit.getAttribute('role')}]` : null
    })
  }

  /** Start a kit on the first of two clips and hold it in its export phase (job 2's probe is held), so it is still running when the test acts. */
  async function startHeldKit(label: string): Promise<Studio> {
    const studio = await launchWithVideo(label)
    const { app, window, outDir } = studio
    await stubDialogs(app, { open: [outDir] })
    await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
    await clipListCard(window).locator('li').first().getByRole('button', { name: /^Select clip/ }).click()
    await installSpawnStall(app, [{ match: 'ffprobe', nth: 2, ms: 25_000 }])
    await kitButton(window).click()
    await expect(kitButton(window)).toHaveText('Exporting platform version 2 of 5…', { timeout: 120_000 })
    return studio
  }

  async function closeTheVideo(window: Page): Promise<void> {
    window.once('dialog', (dialog) => void dialog.accept())
    await window.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
  }

  test('the closed-video card: the question is no descendant of a live region, adds no gap, Keep running keeps the kit and Cancel jobs ends it', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t138kitcard')
    try {
      await closeTheVideo(window)
      const region = window.locator(REGION)
      await expect(region).toContainText('Clip Kit for "Clip 1"')
      await region.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog.getByText('Cancel the Clip Kit batch (5 exports + thumbnails)?')).toBeVisible()

      expect(await liveAncestorOfDialog(window), 'the open question is inside no aria-live and no role=status element').toBeNull()
      // It is a sibling of the region, drawn after it: the region still holds the card (and only the card), and the fixed dialog adds no gap in the studio's column.
      await expect(region).toContainText('Clip Kit for "Clip 1"')
      expect(await region.locator('[role="dialog"]').count(), 'the region does not contain the dialog').toBe(0)
      const gapUnderQuestion = await window.evaluate(() => {
        const card = document.querySelector('[data-tutorial="video-import"]') as HTMLElement
        const live = document.querySelector('div.h-full.overflow-auto > div[aria-live="polite"]') as HTMLElement
        return Math.round(card.getBoundingClientRect().top - live.getBoundingClientRect().bottom)
      })
      expect(gapUnderQuestion, 'the card, then the importer, one gap apart, with the question open').toBe(20)

      // Keep running: the question closes and the kit is still going, in the same card.
      await dialog.getByRole('button', { name: 'Keep running' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(region).toContainText(/Exporting platform version \d of 5…/)
      await expect(region).toContainText('Clip Kit for "Clip 1"')

      // Cancel jobs: the kit ends, the card goes, the region stays and is empty again.
      await region.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(await liveAncestorOfDialog(window), 'and the second time').toBeNull()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, 'Clip Kit canceled. Files already finished are in your folder.')
      await expect(region).toHaveText('', { timeout: 60_000 })
      await expect(window.getByRole('dialog')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the closed-video card: a question nobody answered goes with the kit when it finishes, and does not wait for the next one (T-131 (9), now that the card is not what holds the question)', async () => {
    test.setTimeout(600_000)
    const { app, window, outDir } = await launchWithVideo('t138kitends', clipSrc)
    try {
      await stubDialogs(app, { open: [outDir] })
      await stubShellReveal(app)
      await installSpawnStall(app, [{ match: 'ffmpeg', ms: 1_200 }])
      await kitButton(window).click()
      await expect(kitButton(window)).toHaveText(EXPORTING_N_OF_5, { timeout: 120_000 })
      await closeTheVideo(window)
      const region = window.locator(REGION)
      await region.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toContainText('Cancel the Clip Kit batch')
      // Not answered: the kit runs on under the question, finishes, and the question goes with it. The question is held by the always-mounted component now, so
      // "the card is gone" no longer closes it by itself.
      await expect(dialog, 'the question is gone with the kit').toHaveCount(0, { timeout: 540_000 })
      await expect(region).toHaveText('', { timeout: 60_000 })
      expect(readdirSync(outDir).length, 'the kit was not canceled by an unanswered question').toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('the clip list: the same question is in no live region either, Keep running keeps the kit and Cancel jobs ends it', async () => {
    test.setTimeout(600_000)
    const { app, window } = await startHeldKit('t138kitlist')
    try {
      const list = clipListCard(window)
      await list.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog.getByText('Cancel the Clip Kit batch (5 exports + thumbnails)?')).toBeVisible()
      expect(await liveAncestorOfDialog(window), 'the clip list\'s question is in no aria-live and no role=status element').toBeNull()

      await dialog.getByRole('button', { name: 'Keep running' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(kitButton(window)).toHaveText(EXPORTING_N_OF_5)

      await list.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(await liveAncestorOfDialog(window), 'and the second time').toBeNull()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(window, 'Clip Kit canceled. Files already finished are in your folder.')
      await expect(kitButton(window)).toHaveText('Clip Kit (5 + thumbs)', { timeout: 60_000 })
    } finally {
      await app.close()
    }
  })
})


// T-138 (9): `video:findHighlights` had no claim in main, and `highlights.ts` keeps ONE scan slot. After a renderer reload (the render-process-gone auto-reload,
// Ctrl+R) the panel's `useScanRun` is fresh while main's scan runs: a second "Scan VOD" started a second ffmpeg, Cancel stopped the newest, and the older survived
// `app.quit()` (executed: PPID 1). Main refuses a second scan in a sentence naming the one that runs.
test.describe('Scan VOD - one scan at a time, in main (T-138 (9))', () => {
  /**
   * Hold every highlight scan the app starts from now on, by PID. A scan is the full-source `ebur128` pass (the per-clip hook analysis runs the same filter
   * with `-ss`, which the scan does not have). Each is stopped (SIGSTOP) the moment it exists - from inside main's own `spawn`, so there is no window - which makes
   * "a scan is running" a fact of the process table and not a race with a scan of a 20-minute file that takes about two seconds. SIGKILL (the cancel and the quit
   * sweep) still reaches a stopped process. Nothing in `src/` changes.
   */
  async function holdScans(app: ElectronApplication): Promise<void> {
    await app.evaluate(() => {
      const g = globalThis as unknown as { __heldScans?: number[] }
      g.__heldScans = []
      const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
      const cp = getBuiltin('node:child_process') as { spawn: (...a: unknown[]) => { pid?: number; kill: (signal: string) => boolean } }
      const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
      const real = cp.spawn
      cp.spawn = (cmd: unknown, args: unknown, opts: unknown) => {
        const child = real(cmd, args, opts)
        if (Array.isArray(args) && args.some((a) => typeof a === 'string' && a.startsWith('ebur128=')) && !args.includes('-ss')) {
          g.__heldScans?.push(child.pid ?? 0)
          child.kill('SIGSTOP')
        }
        return child
      }
      mod.syncBuiltinESMExports()
    })
  }
  const heldScans = (app: ElectronApplication): Promise<number[]> => app.evaluate(() => (globalThis as unknown as { __heldScans?: number[] }).__heldScans ?? [])
  /** Running, stopped or sleeping: anything but gone. A killed child nobody has reaped yet is a zombie (state Z) and is gone. */
  const scanAlive = (pid: number): boolean => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
      return state !== 'Z' && state !== 'X'
    } catch {
      return false
    }
  }

  test('a second "Scan VOD" after a renderer reload is refused in a sentence, starts no second ffmpeg, and no scan outlives the quit', async () => {
    test.skip(process.platform !== 'linux', 'the scan is held with SIGSTOP and its survival read from /proc')
    test.setTimeout(240_000)
    const { app, window } = await launchWithVideo('t138-scan', longSrc)
    // Recorded before the close: after it, the only evidence left is the process table.
    let pids: number[] = []
    try {
      await holdScans(app)
      const scan = (): Locator => highlightCard(window)
      await scan().getByRole('button', { name: 'Scan VOD' }).click()
      await expect.poll(() => heldScans(app), { timeout: 30_000, intervals: [100] }).toHaveLength(1)
      pids = await heldScans(app)
      expect(scanAlive(pids[0] as number), 'the scan main started is running').toBe(true)
      await expect(scan().getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

      // The renderer is reloaded, as Ctrl+R does (and the render-process-gone recovery, which lands on Home instead): a fresh page and fresh stores over the
      // scan main still runs. `reload()` keeps the URL's hash, so the page is back in Video Studio, empty; the video is opened again.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.reload()
      })
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('video')).toHaveCount(0)
      await installToastLog(window)
      await dropOnVideoImporter(window, longSrc, path.basename(longSrc))
      await expect(window.locator('video')).toHaveCount(1)
      const press = scan().getByRole('button', { name: 'Scan VOD' })
      await expect(press, 'the reloaded panel knows nothing of the scan main runs: it offers a scan').toBeEnabled()
      await press.click()

      const sentence = `Still scanning "${path.basename(longSrc)}" for highlights. Wait for it to finish, then try again.`
      await expect
        .configure({ soft: true })
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200], message: 'the refusal is shown as written' })
        .toEqual(expect.arrayContaining([sentence]))
      const entries = await readToastEntries(window)
      expect.soft(entries.find((e) => e.text === sentence)?.hasIcon, 'and it is an error toast, not a "Found" or "No standout moments" one').toBe(true)
      expect.soft((await readToastLog(window)).join(' | '), 'no scan result was announced').not.toMatch(/Found \d|No standout moments|Scan canceled/)
      // The refusal ends the panel's run (it started one): the button is back, and no second ffmpeg was ever spawned.
      pids = await heldScans(app)
      expect.soft(pids, 'main started no second scan').toHaveLength(1)
      await expect.soft(press, 'the panel is idle again').toBeEnabled()
      await expect.soft(scan().getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)

      // A scan that outlives the quit also holds the debugging pipe Playwright closes the app through (the child inherited it), so `close()` would wait on it
      // for the whole test: it is raced against a bound, and the survivors are what the test reports.
      const quit = await Promise.race([app.close().then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000))])
      await expect
        .poll(() => pids.filter(scanAlive), { timeout: 15_000, intervals: [200], message: 'every scan ffmpeg main started is gone once the app has quit' })
        .toEqual([])
      expect.soft(quit, 'and the app quit by itself').toBe(true)
    } finally {
      // Whatever the assertions above found, nothing this test started is left running: by explicit PID, the ones recorded above.
      for (const pid of pids) {
        if (scanAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* gone in the meantime */
          }
        }
      }
      await app.close().catch(() => undefined)
    }
  })
})


// ── T-139 (9): a double-press on a button that makes a record makes one record ─────────────────────────────────────────────────────────────
//
// "+ Log post" cleared the form in the same tick, so the second press of a double-click found no name and raised the red "Add a clip name first" right after
// "Added to your posting log"; "+ Save preset" cleared the name after the awaited write, so the second press got the red "Give it a name" or, on a slow write,
// saved a DUPLICATE. A repeat press (the second of a double-click, `detail` 2) is ignored (`isRepeatPress`), the save is claimed before its first await
// (`claimFirst`) and its button is off while the write is out. The Cleanup presets (audio.spec.ts) are the same.
test.describe('T-139 (9): a double-click on a record-creating button makes one record and raises no error', () => {
  /** A double-click the way a person does it: the second press ~120 ms after the first, with the browser's own click count (2), at the button's centre. */
  async function doubleClickSlowly(window: Page, button: Locator, between: () => Promise<void> = async () => window.waitForTimeout(120)): Promise<void> {
    await button.scrollIntoViewIfNeeded()
    const box = await button.boundingBox()
    if (!box) throw new Error('the button has no box')
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down({ clickCount: 1 })
    await window.mouse.up({ clickCount: 1 })
    await between()
    await window.mouse.down({ clickCount: 2 })
    await window.mouse.up({ clickCount: 2 })
  }

  test('+ Log post: a double-click adds ONE entry, says so once, and raises no "Add a clip name first"', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('t139-log')
    const { app, window, userDataDir } = studio
    try {
      const card = postCard(window)
      await card.getByPlaceholder('Clip name').fill('Double clip')
      await doubleClickSlowly(window, card.getByRole('button', { name: '+ Log post' }))
      await expect(card.getByText('Logged posts (1)')).toBeVisible()
      await window.waitForTimeout(1200)
      const toasts = await readToastLog(window)
      expect(toasts.filter((t) => t === 'Added to your posting log'), 'said once').toHaveLength(1)
      expect(toasts.filter((t) => /Add a clip name first/.test(t)), 'and no error after it').toEqual([])
      await expect
        .poll(() => (readConfig(userDataDir).postingDiary as unknown[] | undefined)?.length ?? 0, { timeout: 15_000, intervals: [200] })
        .toBe(1)
    } finally {
      await app.close()
    }
  })

  test('+ Save preset (Custom export presets): a double-click saves ONE preset and raises no "Give it a name"; the button is off while the write is out', async () => {
    test.setTimeout(180_000)
    const studio = await launchWithVideo('t139-custom')
    const { app, window, userDataDir } = studio
    try {
      const presetsDir = path.join(userDataDir, 'export-presets')
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible({ timeout: 15_000 })
      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      const save = modal.getByRole('button', { name: '+ Save preset' })

      // ── the write finishes between the two presses: the second finds an empty box, and is a repeat, so it is ignored ──
      await nameInput.fill('Twice once')
      await doubleClickSlowly(window, save, async () => {
        await expect(modal.getByText('Saved presets (1)')).toBeVisible({ timeout: 15_000 })
      })
      await window.waitForTimeout(1200)
      expect((await readToastLog(window)).filter((t) => /Give it a name/.test(t)), 'no error after the save').toEqual([])
      expect(readdirSync(presetsDir).filter((f) => f.endsWith('.json')), 'one preset on disk').toHaveLength(1)

      // ── the write is still out when the second press lands: nothing is written twice, and the button says it is busy ──
      await slowPresetWrites(app, 1500)
      await nameInput.fill('Twice slowly')
      await save.dblclick()
      await expect(save, 'off while the write is out').toBeDisabled()
      await expect(modal.getByText('Saved presets (2)')).toBeVisible({ timeout: 15_000 })
      await expect(save, 'and back when it is done').toBeEnabled()
      await window.waitForTimeout(1200)
      expect(readdirSync(presetsDir).filter((f) => f.endsWith('.json')), 'a second preset, not a third').toHaveLength(2)
      expect((await readToastLog(window)).filter((t) => /Give it a name/.test(t)), 'still no error').toEqual([])
      expect((await readToastLog(window)).filter((t) => t === 'Saved "Twice slowly"'), 'said once').toHaveLength(1)
    } finally {
      await app.close()
    }
  })
})

// ── T-140 (8): "+ Save preset" keeps the keyboard's focus while it saves ────────────────────────────────────────────────────────────────────
//
// The button was `disabled` while the write was out. Chromium blurs a focused button that becomes disabled, and behind this dialog (aria-modal, a focus trap) the focus
// fell to the page, so a person who saved with Enter lost their place in the dialog (the T-120 (10) record). It is `aria-disabled` now, dimmed by its own variant, and a press
// on it is still the claim (`savingRef`), so a second one starts nothing.
test.describe('T-140 (8): "+ Save preset" keeps the keyboard\'s focus while it saves', () => {
  test('a keyboard press under a slow write: focus stays on the button through the write and after, and a second press does nothing', async () => {
    test.setTimeout(180_000)
    const studio = await launchWithVideo('t140-custom')
    const { app, window, userDataDir } = studio
    try {
      const presetsDir = path.join(userDataDir, 'export-presets')
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible({ timeout: 15_000 })
      const nameInput = modal.getByRole('textbox', { name: 'Custom preset name' })
      const save = modal.getByRole('button', { name: '+ Save preset' })
      const opacity = (): Promise<number> => save.evaluate((el) => Number(getComputedStyle(el).opacity))

      await slowPresetWrites(app, 1500)
      await nameInput.fill('Focus custom')
      await save.focus()
      await expect(save).toBeFocused()
      expect(await opacity(), 'live before the press').toBe(1)
      await window.keyboard.press('Enter')

      await window.waitForTimeout(700)
      await expect(save, 'the keyboard is still on the button it pressed, halfway through the write').toBeFocused()
      await expect(save, 'and the write IS still out: the button says it is off').toHaveAttribute('aria-disabled', 'true')
      await expect.poll(opacity, { message: 'dimmed while it is off', timeout: 5000, intervals: [100] }).toBeLessThan(0.7)
      await window.keyboard.press('Enter')
      await window.keyboard.press('Space')

      await expect(modal.getByText('Saved presets (1)')).toBeVisible({ timeout: 15_000 })
      await expect(save).toHaveAttribute('aria-disabled', 'false')
      // `btn-primary` transitions all properties, so the opacity eases back rather than jumping: polled, not read once.
      await expect.poll(opacity, { message: 'live again', timeout: 5000, intervals: [100] }).toBe(1)
      await expect(save, 'and the focus is on the button after the write').toBeFocused()
      await window.waitForTimeout(1200)
      expect(readdirSync(presetsDir).filter((f) => f.endsWith('.json')), 'one preset: the presses during the write started nothing').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Saved "Focus custom"'), 'said once').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => /Give it a name/.test(t)), 'no error').toEqual([])
    } finally {
      await app.close()
    }
  })
})

// ── T-140 (10): a failed transcription blames the captions engine, and the setup folders stay reachable ─────────────────────────────────────
//
// A whisper exit matched the runner shape and was told "imagii's video tool stopped ... check that the source file still plays and the folder has room": the wrong program
// and the wrong advice (a missing .dll beside the exe is Windows' exit 0xC0000135, a damaged model is the engine's too). And the setup card showed only while the files were
// missing, so after a failed Transcribe there was no way back to the folders. A stand-in engine dropped where the real resolver looks (`<userData>/bin`, the T-108 technique)
// exits 1 through the real extraction, the real `runTranscribe`, the real error mapping and the real toast.
test.describe('T-140 (10): a failed transcription is the captions engine\'s, with its setup in reach', () => {
  /** An "engine" that fails the way a real one does when the model is bad: a line on stderr and exit 1. The resolver needs only that the model file is there. */
  function installFailingEngine(userDataDir: string): void {
    const bin = path.join(userDataDir, 'bin')
    const models = path.join(userDataDir, 'models')
    mkdirSync(bin, { recursive: true })
    mkdirSync(models, { recursive: true })
    const script = path.join(bin, 'whisper-cli.exe')
    writeFileSync(script, "#!/bin/sh\necho 'whisper_init_from_file: failed to load the model' >&2\nexit 1\n", 'utf8')
    chmodSync(script, 0o755)
    writeFileSync(path.join(models, 'ggml-base.en.bin'), 'not a real model', 'utf8')
  }
  const ENGINE =
    'Transcription failed. The captions engine stopped before it finished. Open Captions setup to check its files and the model, then try again.'
  const MISSING_FILES =
    "Transcription failed. The captions engine couldn't start because a file it needs is missing. " +
    'Copy every .dll that came in the zip next to whisper-cli.exe (Captions setup opens that folder), then try again.'

  test('an engine that exits 1: the toast names the captions engine, not the video tool, and Captions setup opens the folders', async () => {
    test.skip(process.platform === 'win32', 'the stand-in engine is a shell script')
    test.setTimeout(240_000)
    const studio = await launchHome('t140-engine')
    const { app, window, userDataDir } = studio
    try {
      installFailingEngine(userDataDir)
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      // The engine and the model are found, so there is no "needs setup" card - and the setup is still in reach, closed.
      await expect(card.getByText('Captions need setup')).toHaveCount(0)
      const setup = card.getByRole('button', { name: 'Captions setup', exact: true })
      await expect(setup).toBeVisible()
      await expect(setup).toHaveAttribute('aria-expanded', 'false')
      await expect(card.getByRole('button', { name: 'Open folder', exact: true }), 'collapsed: the instructions are behind the disclosure').toHaveCount(0)

      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expectToast(window, 'Transcription failed.')
      const failure = (await readToastLog(window)).find((t) => t.startsWith('Transcription failed.'))
      expect(failure, 'the captions engine\'s sentence, which names where to go').toBe(ENGINE)
      expect(failure).not.toMatch(/video tool|source file|folder has room|whisper exit|exit 1|failed to load/i)
      await expect(card.getByRole('button', { name: 'Transcribe', exact: true })).toBeEnabled({ timeout: 30_000 })

      // The sentence says "Open Captions setup": it is on the panel, and it opens the instructions and both folders.
      await setup.click()
      await expect(setup).toHaveAttribute('aria-expanded', 'true')
      const paths = card.locator('div.font-mono.break-all')
      await expect(paths).toHaveCount(2)
      expect(path.dirname((await paths.nth(0).innerText()).trim()), 'the engine\'s folder is imagii\'s own bin folder').toBe(path.join(userDataDir, 'bin'))
      await expect(paths.nth(1)).toHaveText(/ggml-base\.en\.bin$/)
      // The folder buttons reach the shell with the right folders (the OS window itself is the boundary, as for every reveal control).
      await app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __openPaths: string[] }
        g.__openPaths = []
        ;(shell as unknown as { openPath: unknown }).openPath = async (p: string) => {
          g.__openPaths.push(p)
          return ''
        }
      })
      await card.getByRole('button', { name: 'Open folder', exact: true }).click()
      await card.getByRole('button', { name: 'Show models folder', exact: true }).click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as unknown as { __openPaths?: string[] }).__openPaths ?? []), { timeout: 15_000, intervals: [200] })
        .toEqual([path.join(userDataDir, 'bin'), path.join(userDataDir, 'models')])
      // It folds away again.
      await setup.click()
      await expect(setup).toHaveAttribute('aria-expanded', 'false')
      await expect(card.getByRole('button', { name: 'Open folder', exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('the exit of an engine whose .dll files are not beside it (Windows\' 0xC0000135, 3221225781) has its own sentence in the same toast', async () => {
    test.setTimeout(240_000)
    // A shell cannot exit with that code on any platform here (an exit status is one byte), so the engine's failure is main's own message for it, thrown from the
    // `captions:transcribe` handler as the table in `userFacingError.test.ts` has it: the real panel, the real error mapping and the real toast.
    const studio = await launchHome('t140-dll')
    const { app, window } = studio
    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('captions:status')
        ipcMain.handle('captions:status', () => ({
          exeInstalled: true,
          exePath: 'whisper-cli.exe',
          modelInstalled: true,
          modelPath: 'model.bin',
          modelsDir: 'models',
          ready: true
        }))
        ipcMain.removeHandler('captions:transcribe')
        ipcMain.handle('captions:transcribe', () => {
          throw new Error('whisper exit 3221225781: ')
        })
      })
      await gotoVideoStudio(window)
      await installToastLog(window)
      await dropOnVideoImporter(window, clipSrc, 'pipeline.mp4')
      await expect(exportCard(window).getByRole('button', { name: /^Export/ })).toBeVisible({ timeout: 30_000 })
      const card = captionsCard(window)
      await card.getByRole('button', { name: 'Transcribe', exact: true }).click()
      await expectToast(window, 'Transcription failed.')
      expect((await readToastLog(window)).find((t) => t.startsWith('Transcription failed.')), 'the missing-files sentence').toBe(MISSING_FILES)
      await expect(card.getByRole('button', { name: 'Captions setup', exact: true }), 'and the setup it names is on the panel').toBeVisible()
    } finally {
      await app.close()
    }
  })
})
