import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { DEFAULT_CHAIN_SPEC } from '../../src/shared/audio'
import { chooserCalls, recordSlowChooser } from './chooser'
import { dragTo } from './drag'
import {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  expectControlsWhole,
  expectNoHorizontalOverflow,
  expectOneLine,
  expectSelectsWhole,
  setWindowSize
} from './layout'
import { installSpawnStall, readSpawnLog } from './mainSpawn'
import { readRevealCalls, stubShellReveal } from './shellReveal'
import { installToastLog, readToastEntries, readToastLog } from './toastLog'

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
 *   - `dialog.showSaveDialog` (Export) is stubbed ONLY by the two T-84 tests
 *     at the end of this file (`stubSaveDialog`): they start a real ffmpeg
 *     render to prove what the user reads when it fails and when it is
 *     canceled. What the render's BYTES are stays Layer 5's
 *     (`npm run test:media`), so the configuration test below still does not
 *     click Export. See the DISPOSITIONS note on that test.
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

// ── T-129: long files, the waveform's own pixels, the renderer's memory, main's peaks children ──────────────────────────────────

/**
 * A 2 h 5 min MP3, made cheaply: one minute of a 440 Hz tone and one minute of silence are each encoded once (48 kHz mono, 32 kbps,
 * under a second), then joined by STREAM COPY - 60 tone minutes, then 65 silent ones - which takes about a second and is 30 MB. The
 * first hour is the tone, the rest silence, so the drawn waveform can be checked for where the sound is. 48 kHz is the rate the old
 * renderer decode ran at (it decoded at the file's own rate before resampling), and decoding it in main takes real seconds (about 12 s
 * on the bundled ffmpeg), which is what the progress line, the Close and the quit cases need.
 */
async function makeTwoHourMp3(dir: string): Promise<string> {
  const tone = path.join(dir, 't129-tone-60s.mp3')
  const quiet = path.join(dir, 't129-quiet-60s.mp3')
  for (const [input, out] of [['sine=frequency=440:sample_rate=48000:duration=60', tone], ['anullsrc=r=48000:cl=mono:d=60', quiet]] as const) {
    const made = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', input, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', out])
    if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
  }
  const list = path.join(dir, 't129-list.txt')
  writeFileSync(list, [...Array<string>(60).fill(`file '${tone}'`), ...Array<string>(65).fill(`file '${quiet}'`)].join('\n'))
  const long = path.join(dir, 'two-hours-five.mp3')
  const joined = await runBinary(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', long])
  if (joined.code !== 0) throw new Error(`fixture ffmpeg exit ${joined.code}: ${joined.stderr.slice(-800)}`)
  return long
}

/**
 * A WAV whose format tag no decoder knows (0x9999): ffprobe reads a sound stream and a 3 s length from its header, ffmpeg has nothing to
 * decode it with ("Decoding requested, but no decoder found", exit 234, on both majors).
 */
function unknownFormatWav(): Buffer {
  const rate = 8000
  const data = Buffer.alloc(rate * 2 * 3)
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(0x9999, 0)
  fmt.writeUInt16LE(1, 2)
  fmt.writeUInt32LE(rate, 4)
  fmt.writeUInt32LE(rate * 2, 8)
  fmt.writeUInt16LE(2, 12)
  fmt.writeUInt16LE(16, 14)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  fmt.copy(head, 20)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/**
 * The drawn waveform, column by column: for every pixel column of every canvas wavesurfer drew (its shadow root is open), the column's
 * x in CSS pixels across the whole waveform and how many of its pixels are painted. A silent stretch draws 1-pixel bars.
 */
async function waveformColumns(window: Page): Promise<Array<{ x: number; h: number }>> {
  return window.evaluate(() => {
    const host = document.querySelector('[data-tutorial="audio-waveform"] .card > div > div')
    const root = host?.shadowRoot
    if (!root) throw new Error('the waveform has no shadow root: wavesurfer drew nothing')
    const canvases = [...root.querySelectorAll('.canvases canvas')] as HTMLCanvasElement[]
    const out: Array<{ x: number; h: number }> = []
    for (const canvas of canvases) {
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue
      const left = parseFloat(canvas.style.left || '0')
      const scale = canvas.width / (parseFloat(canvas.style.width) || canvas.width)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let x = 0; x < canvas.width; x++) {
        let h = 0
        for (let y = 0; y < canvas.height; y++) if ((data[(y * canvas.width + x) * 4 + 3] as number) > 0) h++
        out.push({ x: left + x / scale, h: h / scale })
      }
    }
    if (out.length === 0) throw new Error('the waveform has no painted canvas')
    return out
  })
}

/**
 * T-132 (5): how far the drawn waveform reaches ABOVE and BELOW its centre line, in CSS pixels: the tallest painted run in any column on each
 * side of the middle row of every canvas wavesurfer drew. `waveformColumns` counts a column's painted pixels altogether; a waveform whose
 * lows run louder than its highs is wrong in WHICH half carries the height, which the total cannot say.
 */
async function waveformHalves(window: Page): Promise<{ up: number; down: number; canvasHeight: number }> {
  return window.evaluate(() => {
    const host = document.querySelector('[data-tutorial="audio-waveform"] .card > div > div')
    const root = host?.shadowRoot
    if (!root) throw new Error('the waveform has no shadow root: wavesurfer drew nothing')
    const canvases = [...root.querySelectorAll('.canvases canvas')] as HTMLCanvasElement[]
    let up = 0
    let down = 0
    let canvasHeight = 0
    for (const canvas of canvases) {
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue
      const scale = canvas.width / (parseFloat(canvas.style.width) || canvas.width)
      canvasHeight = Math.max(canvasHeight, canvas.height / scale)
      const centre = Math.floor(canvas.height / 2)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let x = 0; x < canvas.width; x++) {
        let above = 0
        let below = 0
        for (let y = 0; y < canvas.height; y++) {
          if ((data[(y * canvas.width + x) * 4 + 3] as number) === 0) continue
          if (y < centre) above++
          else below++
        }
        up = Math.max(up, above / scale)
        down = Math.max(down, below / scale)
      }
    }
    return { up, down, canvasHeight }
  })
}

/** A mono 16-bit WAV at 8 kHz (the rate main reads the peaks at, so nothing is resampled): a 100 Hz square wave of `high` and `low` (fractions of full scale). */
function squareWav(seconds: number, high: number, low: number): Buffer {
  const rate = 8000
  const count = rate * seconds
  const data = Buffer.alloc(count * 2)
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.floor(i / 40) % 2 === 0 ? high * 32767 : low * 32767), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** The audio paths `recentFiles.audio` holds on disk (electron-store nests the dotted key), as the app left them. */
function recentAudioOnDisk(userDataDir: string): string[] {
  const config = JSON.parse(readFileSync(path.join(userDataDir, 'config.json'), 'utf8')) as { recentFiles?: { audio?: string[] } }
  return config.recentFiles?.audio ?? []
}

/**
 * The renderer's peak memory so far, readable at any moment (the long-file case watches it WHILE the waveform is drawn, so a renderer
 * that climbs past the line and then dies is caught on the line, not later on a Play that never turns on). On Linux the kernel keeps
 * the process's high-water mark (`VmHWM` in /proc/<pid>/status), which no sampling can miss, and once the process is gone its last
 * reading stands; elsewhere Electron's own metrics are sampled every 100 ms until `stop()`.
 */
async function rendererMemory(app: ElectronApplication): Promise<{ peakMb: () => Promise<number>; stop: () => Promise<void>; how: string }> {
  const pid = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId() ?? 0)
  const status = `/proc/${pid}/status`
  if (pid > 0 && existsSync(status)) {
    let lastMb = 0
    return {
      how: `VmHWM of renderer pid ${pid}`,
      peakMb: async () => {
        if (!existsSync(status)) return lastMb
        const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync(status, 'utf8'))
        if (!m) throw new Error(`no VmHWM in ${status}`)
        lastMb = Math.round(Number(m[1]) / 1024)
        return lastMb
      },
      stop: async () => undefined
    }
  }
  let peakKb = 0
  let stopped = false
  const sample = async (): Promise<void> => {
    while (!stopped) {
      const kb = await app
        .evaluate(({ app: electronApp }, wanted) => electronApp.getAppMetrics().find((m) => m.pid === wanted)?.memory.workingSetSize ?? 0, pid)
        .catch(() => 0)
      peakKb = Math.max(peakKb, kb)
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const running = sample()
  return {
    how: 'sampled workingSetSize',
    peakMb: async () => Math.round(peakKb / 1024),
    stop: async () => {
      stopped = true
      await running
    }
  }
}

/** The long-file case's memory line: an order of magnitude under the old path's gigabytes, and far over the ~185 MB measured. */
const RENDERER_MEMORY_LINE_MB = 800

/** Count the page's own `fetch` / XHR requests for the app's file protocol: the old waveform pulled the whole file in through one. */
async function countRendererFileFetches(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __fileFetches: number }
    w.__fileFetches = 0
    const realFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith('imagii-file:')) w.__fileFetches += 1
      return realFetch(input, init)
    }
    const realOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (String(url).startsWith('imagii-file:')) w.__fileFetches += 1
      return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest)
    } as typeof XMLHttpRequest.prototype.open
  })
}

function rendererFileFetches(window: Page): Promise<number> {
  return window.evaluate(() => (window as unknown as { __fileFetches: number }).__fileFetches)
}

interface PeaksChild {
  pid: number
  exit: { code: number | null; signal: string | null } | null
}

/**
 * Record, in MAIN, every ffmpeg the app starts to read a file's sound for its waveform (its argv ends in raw 16-bit PCM on stdout), and
 * how each one ended. With `reportAt`, the record is also written to that file at `will-quit` - after the quit's drain, the last moment
 * the app is still there to say whether it had stopped its children.
 */
async function recordPeaksChildren(app: ElectronApplication, reportAt?: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, report) => {
    const g = globalThis as unknown as { __peaksChildren: Array<{ pid: number; exit: { code: number | null; signal: string | null } | null }> }
    g.__peaksChildren = []
    const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
    const cp = getBuiltin('node:child_process') as { spawn: (...a: unknown[]) => { pid?: number; on: (e: string, f: (...a: unknown[]) => void) => void } }
    const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
    const real = cp.spawn
    cp.spawn = (cmd: unknown, args: unknown, opts: unknown) => {
      const child = real(cmd, args, opts)
      if (Array.isArray(args) && args.includes('s16le') && args[args.length - 1] === 'pipe:1') {
        const entry = { pid: child.pid ?? 0, exit: null as { code: number | null; signal: string | null } | null }
        g.__peaksChildren.push(entry)
        child.on('exit', (code: unknown, signal: unknown) => {
          entry.exit = { code: (code as number | null) ?? null, signal: (signal as string | null) ?? null }
        })
      }
      return child
    }
    mod.syncBuiltinESMExports()
    if (report) {
      const fs = getBuiltin('node:fs') as { writeFileSync: (p: string, d: string) => void }
      electronApp.on('will-quit', () => fs.writeFileSync(report, JSON.stringify(g.__peaksChildren)))
    }
  }, reportAt ?? null)
}

function readPeaksChildren(app: ElectronApplication): Promise<PeaksChild[]> {
  return app.evaluate(() => (globalThis as unknown as { __peaksChildren?: PeaksChild[] }).__peaksChildren ?? [])
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
/** T-124 (26): the sentence under Manual gain: the limiter ends a chain with something in it, and a bare pass-through has none. */
const CEILING_SENTENCE =
  'When you boost, switch something on or cut a part out, peaks above −1 dBFS are limited in the export, so a boost cannot clip. Otherwise the export keeps your levels as they are.'
const MULTITRACK = '[data-tutorial="audio-multitrack"]'
const EXPORT = '[data-tutorial="audio-export"]'
const WAVEFORM = '[data-tutorial="audio-waveform"]'
const FIXWIZARD = '[data-tutorial="audio-fixwizard"]'

/** CleanupPanel / LevelsPanel mark the selected option with the accent fill. */
/**
 * Replace the OS SAVE dialog in the MAIN process (the same technique as
 * `stubOpenDialog`, for the Export button's chooser). Only the chooser is
 * replaced: the click, `audio:suggestOutputName`, `audio:export`, the real
 * ffmpeg job and its cancel are all real.
 */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({
      canceled: false,
      filePath: picked
    })
  }, filePath)
}

/**
 * The T-90 export tests need to know what the dialog was ASKED for (the AAC
 * option must ask for `.m4a`), not just to answer it. Same stub, same place
 * (main's `dialog`), plus a record of the options it was opened with.
 */
async function stubRecordingSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    const g = globalThis as unknown as { __audioSaveOptions: unknown[] }
    g.__audioSaveOptions = []
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
      _win: unknown,
      options: unknown
    ) => {
      g.__audioSaveOptions.push(options)
      return { canceled: false, filePath: picked }
    }
  }, filePath)
}

interface SaveOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

function readSaveOptions(app: ElectronApplication): Promise<SaveOptions[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __audioSaveOptions?: SaveOptions[] }).__audioSaveOptions ?? []
  )
}

/** Container + stream facts of a media file, from the repo's own ffprobe. */
function probeFile(file: string): Promise<{
  format: string
  duration: number
  codecs: string[]
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file
    ])
    let out = ''
    child.stdout.on('data', (b) => (out += String(b)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code} for ${file}`))
      const j = JSON.parse(out) as {
        format: { format_name: string; duration: string }
        streams: Array<{ codec_name: string }>
      }
      resolve({
        format: j.format.format_name,
        duration: Number(j.format.duration),
        codecs: j.streams.map((st) => st.codec_name)
      })
    })
  })
}

/**
 * An hour of 8 kHz mono sound, small on disk (~14 MB) and cheap to decode, but
 * long enough that a two-pass loudness render is still measuring when Cancel
 * is clicked.
 */
async function makeLongMp3(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=8000:duration=3600',
    '-ac',
    '1',
    '-b:a',
    '32k',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

// T-113: the selected button of a group is told to assistive tech, not only drawn in the accent
// fill (aria-pressed) — every group these two read (Cleanup's strengths, Levels' compressors).
async function expectSelected(locator: ReturnType<Page['locator']>): Promise<void> {
  await expect(locator).toHaveClass(/bg-accent/)
  await expect(locator).toHaveAttribute('aria-pressed', 'true')
}

async function expectNotSelected(locator: ReturnType<Page['locator']>): Promise<void> {
  await expect(locator).toHaveClass(/bg-bg-hover/)
  await expect(locator).toHaveAttribute('aria-pressed', 'false')
}

/** T-90: says WHEN a marked part goes (at export) and how to undo the mark. */
const WAVEFORM_HINT =
  'Drag across the waveform to mark a part to remove — it comes out when you export. Click a mark to put it back.'

function cutChips(window: Page) {
  return window.locator('button[title="Click to put this part back"]')
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
 * The box a gesture can be planned against: one that is a real number AND has
 * stopped moving.
 *
 * T-62. Every coordinate of a synthetic drag is computed from one read of the
 * surface, so the read is as load-bearing as the gesture — and a single read
 * answers only for the instant it was taken. Two ways that goes wrong, both
 * load-sensitive and both silent: the surface has not laid out yet (no box at
 * all, or a zero width, which collapses `from` and `to` onto the same point),
 * or a re-render is still settling and the surface moves out from under
 * coordinates that were correct when they were read. Either way the press
 * lands somewhere else, wavesurfer never opens a drag selection, and the
 * failure arrives ten seconds later as the drag helper's `the drag never
 * reached its extent (last read: NaN)` — naming the extent, which was never
 * the problem. Two consecutive identical reads rules both out, as a
 * condition and never a sleep: a surface that never lays out, or never stops
 * moving, still fails, and fails saying which read never settled.
 *
 * What this does NOT explain, and what the round-39 flake turned out to be:
 * the same `last read: NaN` still appears roughly one mixed 2-worker run in
 * four, on whichever drag happens to be running, and an instrumented run
 * proved the planning box was identical before and after settling every
 * time. That leaves the crossing event in `tests/e2e/drag.ts`'s header at the
 * earliest point of its window — between `mouse.down()` and the first move
 * the page processes, before the selection region exists. Nothing is drawn
 * yet, so no polled condition can wait it out and the helper is forbidden
 * from re-sending the gesture. `--workers=1` (green 2/2 over these three
 * specs) remains the documented fallback.
 */
async function settledBox(
  target: ReturnType<Page['locator']>,
  label: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  let previous = ''
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox().catch(() => null)
        if (!box || !(box.width > 0)) {
          previous = ''
          return false
        }
        const current = `${box.x},${box.y},${box.width},${box.height}`
        const stable = current === previous
        previous = current
        return stable
      },
      { timeout: 15_000, message: `${label}: never settled on a box to gesture across` }
    )
    .toBe(true)
  const box = await target.boundingBox()
  if (!box) throw new Error(`${label}: settled, then gone`)
  return box
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
  const box = await settledBox(surface, 'waveform surface')
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
      await expect(window.locator(WAVEFORM)).toContainText('1 ch')
      // T-100: the codec id is ffprobe's word for how the file is stored, not
      // something a person cleaning audio can use; the sample rate and the
      // channel count are, and stay.
      await expect(window.locator(WAVEFORM)).not.toContainText('pcm_s16le')
      await expect(window.locator(WAVEFORM)).not.toContainText(/pcm_|mp3float|aac_/)
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

      // T-84: the probe's "No audio stream found in file" is main's note to
      // itself; the user is told what it MEANS, in audio words (the importer
      // used to share the video importer's phrasing), with no IPC preamble in
      // front of it.
      const REFUSAL = "This file has no sound, so there's nothing to clean. Pick a file with audio."
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toContain(REFUSAL)
      await expect(window.getByText(REFUSAL, { exact: false }).first()).toBeVisible()
      expect((await readToastLog(window)).join(' | ')).not.toMatch(
        /No audio stream found|Error invoking remote method/
      )

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
      // T-108: the header names the VIDEO the person dropped — the extracted WAV is
      // scratch with a random name they never chose ("aB3dE5fG7h.wav").
      const header = window.locator('header')
      await expect(header.getByText('e2e-clip.mp4', { exact: true })).toBeVisible()
      await expect(header.getByText(/\.wav$/)).toHaveCount(0)
      // The extract writes 48 kHz stereo pcm_s16le regardless of the source.
      await expect(window.locator(WAVEFORM)).toContainText('48000 Hz')
      await expect(window.locator(WAVEFORM)).toContainText('2 ch')

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

  // T-119 (6): the video Importer refused a second import while one ran (T-112); this one did not. A slow
  // extraction of a video's sound landed after a second file had loaded - and been tuned - and replaced it.
  // The extraction's ffmpeg is held for 8 s, so "meanwhile" is a state the test creates.
  test('a second file while the first one is still being extracted is refused, from a drop and from Recent, and the first one is what opens (T-119)', async () => {
    test.setTimeout(180_000)
    const seedRoot = path.join(os.tmpdir(), `imagii-e2e-audio-busy-seed-${Date.now().toString(36)}`)
    mkdirSync(seedRoot, { recursive: true })
    const seededFixture = path.join(seedRoot, 'from-last-session.wav')
    await makeFixtureWav(seededFixture)
    const studio = await openStudio('importerbusy', { recentFiles: { audio: [seededFixture] } })
    const { window, app } = studio
    try {
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)

      // The flag is released when a load FAILS too (the importer stays mounted after a refusal, so a stuck flag
      // would refuse every later file): a text file is refused, then the next file is taken.
      const notes = path.join(studio.root, 'source', 'stream-notes.txt')
      writeFileSync(notes, 'this is not audio, it is a text file\n', 'utf8')
      await dropOnImporter(window, notes, 'stream-notes.txt')
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toContain("This file has no sound, so there's nothing to clean. Pick a file with audio.")
      await expect(window.getByText('Drop audio or video here')).toBeVisible()

      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 8_000 }])
      await dropOnImporter(window, video, 'e2e-clip.mp4')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Extracting audio…')

      // A second file arrives meanwhile, by a drop. It used to start a PARALLEL load. It sits in a folder that
      // looks cloud-synced, which is what discriminates WHERE the refusal happens: before anything else is said
      // about the file, so the person is not told "cloud-sync folder" and then "wait" in two sentences.
      const synced = path.join(studio.root, 'source', 'Dropbox', 'e2e-tone.wav')
      mkdirSync(path.dirname(synced), { recursive: true })
      copyFileSync(studio.fixture, synced)
      await dropOnImporter(window, synced, 'e2e-tone.wav')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Still extracting audio from the last file. Wait for it to finish.')
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/cloud-sync/i)
      // ...and by the Recent menu, which loads through the same function.
      await window.getByRole('button', { name: 'Recent (1)' }).click()
      await window.getByRole('button', { name: /from-last-session\.wav/ }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      await expect(window.locator(WAVEFORM)).toHaveCount(0)
      expect((await readSpawnLog(app)).filter((k) => k === 'ffmpeg'), 'one extraction, no second load').toHaveLength(1)

      // The extraction finishes and the sound that opens is the FIRST drop's.
      await expect(playButton(window)).toBeEnabled({ timeout: 120_000 })
      const header = window.locator('header')
      await expect(header.getByText('e2e-clip.mp4', { exact: true })).toBeVisible()
      await expect(header.getByText('e2e-tone.wav', { exact: true })).toHaveCount(0)
      await expect(header.getByText('from-last-session.wav', { exact: true })).toHaveCount(0)

      // The refusal does not stick: once it is loaded and closed, the importer takes a file again.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      await dropAndWaitReady(studio)
      await expect(window.locator('header').getByText('e2e-tone.wav', { exact: true })).toBeVisible()
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
        window.getByText(WAVEFORM_HINT)
      ).toBeVisible()

      // ── ONE GESTURE, ONE CUT (T-36) ──
      // This assertion is the flipped tripwire: it used to pin `toHaveCount(0)`
      // here, because the commit rode `update-end` and a drag-created region
      // never emits one. The panel copy above promises a single drag, and now
      // a single drag is what delivers it.
      await dragCut(window, 0.2, 0.4)
      await expect(cutChips(window)).toHaveCount(1)
      // T-90: the marks are labelled for what they are — removed at export, not
      // now — and the chip's own hint says clicking puts the part back.
      await expect(window.locator(WAVEFORM)).toContainText('Removed when you export:')
      await expect(cutChips(window).first()).toHaveAttribute('title', 'Click to put this part back')

      // Chip carries the real timestamps the pixels mapped to: 20%..40% of a
      // 3 s file (wavesurfer seeds the selection 5 px wide, so the end runs a
      // hair past 40%).
      const [start, end] = parseTimestampPair((await cutChips(window).first().textContent()) ?? '')
      expect(start).toBeGreaterThan(0.5)
      expect(start).toBeLessThan(0.8)
      expect(end).toBeGreaterThan(1.1)
      expect(end).toBeLessThan(1.4)
      // The selection region is gone and the store-driven cut region replaced
      // it. Both fills are the ACCENT token now (T-56 — the stored one was a
      // raw rose-500 rgba literal, a palette color that was never in
      // tokens.ts at all); the committed cut is the heavier of the two.
      await expect(selectionRegion(window)).toHaveCount(0)
      const cutRegion = window.locator(`${WAVEFORM} [part~="cut-0"]`)
      await expect(cutRegion).toHaveCount(1)
      await expect(cutRegion).toHaveCSS('background-color', 'rgba(255, 49, 49, 0.35)')
      // A stored cut is a mark, not a control: it never swallows a pointer
      // (T-61 — see the drag that starts on top of one, below).
      await expect(cutRegion).toHaveCSS('pointer-events', 'none')
      await expect(
        window.getByText(WAVEFORM_HINT)
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
      // (Until T-61 this drag had to START in the 40%..60% gap: a gesture that
      // BEGAN on top of an existing cut never reached wavesurfer's
      // drag-selection at all. The next block is that gesture.)
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

      // ── a drag that STARTS on top of an existing cut makes its own cut ──
      // T-61: the gesture a user makes to widen a cut. It used to do nothing
      // at all — every stored region got its own `makeDraggable` even at
      // drag:false/resize:false, and that handler `preventDefault`s the
      // document-level pointermove before `enableDragSelection`'s handler sees
      // it, which bails on `defaultPrevented`. Silence, on the one gesture
      // most likely to be tried twice.
      //
      // It creates a new cut rather than extending the one under the press:
      // that is what the drag does everywhere else on this waveform (the third
      // drag above ENDS inside a cut and gets its own chip), and the panel
      // copy promises one drag, one region to cut. The audio chain takes
      // overlapping regions already.
      const inside = 0.7 // squarely inside the 60%..80% cut
      await dragCut(window, inside, 0.95)
      await expect(cutChips(window)).toHaveCount(4)
      await expect(window.locator(`${WAVEFORM} [part~="cut-3"]`)).toHaveCount(1)
      const [fourthStart, fourthEnd] = parseTimestampPair(
        (await cutChips(window).nth(3).textContent()) ?? ''
      )
      // The press really landed inside the existing 60%..80% cut…
      expect(fourthStart).toBeGreaterThan(FIXTURE_SECONDS * 0.6)
      expect(fourthStart).toBeLessThan(FIXTURE_SECONDS * 0.8)
      // …and the new cut runs out past its far edge, which is the whole point
      // of the gesture.
      expect(fourthEnd).toBeGreaterThan(FIXTURE_SECONDS * 0.8)
      await expect(window.locator(`${WAVEFORM} [part^="region "]`)).toHaveCount(4)
      await expect(selectionRegion(window)).toHaveCount(0)
      // Back to three so the removal block below reads as it always has.
      await cutChips(window).nth(3).click()
      await expect(cutChips(window)).toHaveCount(3)

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
        window.getByText(WAVEFORM_HINT)
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
      // T-112: the hint names the preset that owns the number it quotes. T-125 (3) swapped the floors so the strengths are ordered
      // by what they remove: Light is -35 / 12 dB (chain.ts), Medium -30 / 18, Aggressive -25 / 24 - and Custom still STARTS at
      // -25 / 12, which is no preset's setting, so the hint must not say it is.
      // The hint is the label's title (hover), so it is read as the attribute.
      const floorLabel = cleanup.locator('label', { hasText: 'Noise floor' })
      await expect(floorLabel).toHaveAttribute('title', /-35 is the Light preset's setting\.$/)
      await expect(floorLabel).not.toHaveAttribute('title', /-25|medium/i)
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
      const rumble = cleanup.getByLabel('Remove low rumble (below 80 Hz)')
      const hum = cleanup.getByLabel('Hum removal (60 Hz mains)')
      const deEss = cleanup.getByLabel("Softer harsh 's' sounds")
      for (const box of [rumble, hum, deEss]) {
        await expect(box).not.toBeChecked()
        await box.check()
        await expect(box).toBeChecked()
      }
      for (const box of [rumble, hum, deEss]) {
        await box.uncheck()
        await expect(box).not.toBeChecked()
      }

      // ── T-90: hum removal is tuned to the user's grid ──
      // The picker is there exactly while hum removal is on, starts at the
      // 60 Hz the filter always used, and relabels the box when it changes.
      const mains = cleanup.getByLabel('Power-line frequency')
      await expect(mains).toHaveCount(0)
      await hum.check()
      await expect(mains).toBeVisible()
      await expect(mains).toHaveValue('60')
      await expect(mains.locator('option')).toHaveText([
        '60 Hz — US, Canada',
        '50 Hz — most other regions'
      ])
      await mains.selectOption('50')
      await expect(cleanup.getByLabel('Hum removal (50 Hz mains)')).toBeChecked()
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).toHaveCount(0)
      await mains.selectOption('60')
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).toBeChecked()
      await hum.uncheck()
      await expect(mains).toHaveCount(0)
      // The strength row and the three boxes speak a streamer's language.
      await expect(cleanup).toContainText('Quieter background (strength)')
      await expect(cleanup).not.toContainText(/Denoise|highpass|De-ess|sibilance/i)
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
      const lufs = levels.getByLabel('Loudness target (LUFS)')
      const loudnorm = levels.getByRole('checkbox')
      await expect(lufs).toBeDisabled()
      await expect(levels.getByLabel('Loudness platform preset')).toHaveCount(0)
      await loudnorm.check()
      await expect(lufs).toBeEnabled()
      await expect(lufs).toHaveValue('-16')
      // T-113: the range the box settles to is said beside it, not only enforced.
      // T-114: beside the checkbox's label, not inside it - it was part of the checkbox's accessible
      // name ("Even volume ... LUFS) · -70 to -5") - in parentheses, with the true minus the paragraph
      // below uses (U+2212), not a hyphen.
      const range = levels.getByText('(\u221270 to \u22125)', { exact: true })
      await expect(range).toBeVisible()
      await expect(levels.getByText('· -70 to -5')).toHaveCount(0)
      expect(await loudnorm.evaluate((el) => el.closest('label')?.textContent ?? '')).not.toMatch(/70/)
      await expect(loudnorm).not.toHaveAccessibleName(/70/)
      await expect(loudnorm).toHaveAccessibleName(/^Even volume/)
      const platform = levels.getByLabel('Loudness platform preset')
      // -16 is the podcast target, so the picker reads Podcast without anyone
      // having chosen it.
      await expect(platform).toHaveValue('podcast')
      // T-90: the developer note ("Two-pass loudnorm… fixed at -1.5 dBTP this
      // round") is a creator-facing explanation of what the number means.
      await expect(levels).toContainText(
        'Loudness target — how loud the finished audio is. −16 suits talking and podcasts; ' +
          "−14 matches YouTube, Spotify, TikTok and Reels. imagii measures the whole file first, so exports take a little longer."
      )
      await expect(levels).not.toContainText(/loudnorm|dBTP|this round/)

      // Platform -> number, every option in the picker.
      await platform.selectOption('streaming')
      await expect(lufs).toHaveValue('-14')
      await platform.selectOption('broadcast')
      await expect(lufs).toHaveValue('-23')
      await platform.selectOption('podcast')
      await expect(lufs).toHaveValue('-16')
      await platform.selectOption('broadcast')
      await expect(lufs).toHaveValue('-23')
      // T-90: YouTube/Spotify and TikTok/Reels were two rows with one number,
      // so choosing the second snapped the picker back to the first. They are
      // ONE row now, and the row you pick is the row that stays picked.
      await expect(platform.locator('option')).toHaveText([
        'Talking and podcasts (−16)',
        'YouTube, TikTok, Reels (−14)',
        'Broadcast TV and radio (−23)',
        'Custom'
      ])
      await platform.selectOption({ label: 'YouTube, TikTok, Reels (−14)' })
      await expect(lufs).toHaveValue('-14')
      await expect(platform).toHaveValue('streaming')
      await expect(platform.locator('option:checked')).toHaveText(
        'YouTube, TikTok, Reels (−14)'
      )

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
      // T-123 (10): the ceiling is said where the boost is. The export ends in a -1 dBFS limiter (Layer 5 measures it:
      // +12 dB on a -2 dBFS file lands at or under -0.9 dBFS, where it used to land at 0.0), so the panel says what it does.
      // T-124 (26): and says it of what it is true of. A bare pass-through (nothing boosted, nothing switched on) keeps no limiter
      // on purpose - "nothing switched on is the file that went in" - so the sentence is conditional, and says what stays as it was.
      const ceiling = levels.getByText(CEILING_SENTENCE, { exact: true })
      await expect(ceiling).toBeVisible()
      await expect(levels.getByText('Peaks above −1 dBFS are limited when you export', { exact: false })).toHaveCount(0)
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

  test('a ticked checkbox or a moved slider keeps its focus and still lets Ctrl+Z, Ctrl+Y and ? through (T-123 (2))', async () => {
    // Every window-level key guard stood down for ANY <input>, and a checkbox that has just been ticked (or a slider that has
    // just been moved) is the focused element: tick Hum removal, press Ctrl+Z, and nothing happened. The overlay's "?" died the
    // same way. A text field still owns its keys (the existing case above); a checkbox and a range have no use for these.
    test.setTimeout(120_000)
    const studio = await openStudio('undo-focus')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      const hum = cleanup.getByLabel('Hum removal (60 Hz mains)')
      const focusedType = (): Promise<string | null> =>
        window.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type ?? null)

      // ── a checkbox: tick it, and it is the focused element ──
      await expect(hum).not.toBeChecked()
      await hum.check()
      await expect(hum).toBeChecked()
      expect(await focusedType(), 'the trap is real: focus is on the checkbox that was just ticked').toBe('checkbox')
      await window.keyboard.press('Control+z')
      await expect(hum, 'Ctrl+Z from the focused checkbox undoes the tick').not.toBeChecked()
      await window.keyboard.press('Control+y')
      await expect(hum, 'Ctrl+Y puts it back').toBeChecked()
      await window.keyboard.press('Control+Shift+z')
      await expect(hum).toBeChecked()
      await window.keyboard.press('Control+z')
      await expect(hum).not.toBeChecked()
      await hum.check()
      expect(await focusedType()).toBe('checkbox')
      // `?` from the same focus opens the shortcuts, and Escape closes them.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      // The native key of a checkbox is still the checkbox's: Space toggles it, and nothing else changes.
      await hum.focus()
      await window.keyboard.press(' ')
      await expect(hum).not.toBeChecked()
      await window.keyboard.press(' ')
      await expect(hum).toBeChecked()

      // ── a slider: moved with its own keys, and Ctrl+Z from it is still the studio's ──
      await cleanup.getByRole('button', { name: 'Custom', exact: true }).click()
      const noiseFloor = cleanup.getByRole('slider', { name: 'Noise floor' })
      await expect(cleanup.locator('label', { hasText: 'Noise floor' })).toContainText('-25 dB')
      await noiseFloor.focus()
      await window.keyboard.press('ArrowRight')
      await expect(cleanup.locator('label', { hasText: 'Noise floor' }), 'the arrow is the slider\'s own').toContainText('-24 dB')
      expect(await focusedType()).toBe('range')
      await window.keyboard.press('Control+z')
      await expect(
        cleanup.locator('label', { hasText: 'Noise floor' }),
        'Ctrl+Z from the focused slider is the studio\'s: the -24 is undone'
      ).not.toContainText('-24 dB')
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // ── a text field is still its own: Ctrl+Z inside it never reaches the studio (the case above, once more) ──
      const presetName = window.locator('.card').filter({ hasText: 'Cleanup presets' }).getByPlaceholder('My mic preset')
      await presetName.fill('typed')
      const before = await cleanup.locator('label', { hasText: 'Noise floor' }).textContent()
      await presetName.press('Control+z')
      await expect(cleanup.locator('label', { hasText: 'Noise floor' })).toHaveText(before ?? '')
      await window.keyboard.press('Escape')
    } finally {
      await closeStudio(studio)
    }
  })

  // T-123 (25), (27): the Cleanup card clipped its own labels ("Aggress" for "Aggressive", five equal columns in a card too
  // narrow for the longest one) and the two flex-1 selects were as wide as their longest option and poked past the card's
  // edge (by 3 and 19 px). Playwright's click() scrolls what it clicks into view, so no behavior case could see either; this
  // reads the geometry, at the window a 1080p display opens the app at and at the smallest the window can be.
  test('Cleanup and Levels draw every label whole and keep their selects inside the card, at the default window and the minimum (T-123 (25), (27))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('layout')
    const { app, window } = studio
    try {
      await setWindowSize(app, window, DEFAULT_WINDOW)
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      const levels = window.locator(LEVELS)
      // The two selects only exist once their checkbox is on: put both on, and the Custom sliders too.
      await cleanup.getByLabel('Hum removal (60 Hz mains)').check()
      await levels.getByRole('checkbox').check()
      const powerLine = cleanup.getByLabel('Power-line frequency')
      const platform = levels.getByLabel('Loudness platform preset')
      await expect(powerLine).toBeVisible()
      await expect(platform).toBeVisible()
      const strengths = cleanup.locator('button[aria-pressed]').filter({ hasText: /^(Off|Light|Medium|Aggressive|Custom)$/ })
      await expect(strengths).toHaveCount(5)

      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await expectNoHorizontalOverflow(cleanup, `the Cleanup card at ${where}`)
        await expectNoHorizontalOverflow(levels, `the Levels card at ${where}`)
        // Every strength label is drawn whole ("Aggressive", not "Aggress"), and inside the card.
        await expectControlsWhole(cleanup, strengths, `Cleanup's strength buttons at ${where}`)
        // Both selects end inside their card.
        await expectControlsWhole(cleanup, powerLine, `the Power-line select at ${where}`)
        await expectControlsWhole(levels, platform, `the Platform select at ${where}`)
        // T-124 (24): and each shows its WHOLE selected value. A select clips its own text, so the two checks above are vacuous
        // for it (`scrollWidth` equals `clientWidth` whatever is cut off): round 73's `min-w-0` made the Power-line select
        // show "60 Hz — US," of "60 Hz — US, Canada" and stayed green. The text is measured instead. Both options of each
        // select are measured, because a person who changes the choice should not meet the clipped one.
        for (const select of [powerLine, platform]) {
          const options = await select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value))
          const owner = select === powerLine ? cleanup : levels
          for (const value of options) {
            await select.selectOption(value)
            await expectSelectsWhole(owner, select, `the ${select === powerLine ? 'Power-line' : 'Platform'} select showing option "${value}" at ${where}`)
          }
          await select.selectOption(options[0] ?? '')
        }
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-layout-min.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  // T-124 (19): none of the side panels changes what the player plays (the waveform is the original sound) and every setting is applied
  // at export; BRANDING says a control with no live preview says so in one line.
  test('the side column says its changes are applied when you export, and the player keeps playing the original sound (T-124 (19))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('preview-disclosure')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      await expect(window.getByText('Changes here are applied when you export. The player plays your original sound.')).toBeVisible()
      // The wizard's toast says the same where the person has just pressed Apply.
      await window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' }).click()
      const dialog = window.getByRole('dialog')
      await dialog.getByRole('button', { name: 'A little' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.')
    } finally {
      await closeStudio(studio)
    }
  })

  // T-124 (25): a slider's readout ("-25 dB") was a `w-14` box with no shrink guard in a row that had no room for it: it was
  // squeezed to 38 px and wrapped onto two lines, and the row's height changed with the value while the slider was dragged (a
  // one-digit readout fits where a two-digit one wraps). The readout is a single line that is never squeezed, and the row is
  // the same height at either end of the slider.
  test('the Custom noise sliders keep their readouts on one line and the row the same height from end to end of the slider (T-124 (25))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('slider-layout')
    const { app, window } = studio
    try {
      await setWindowSize(app, window, DEFAULT_WINDOW)
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      await cleanup.getByRole('button', { name: 'Custom', exact: true }).click()
      const rows = [cleanup.locator('label', { hasText: 'Noise floor' }), cleanup.locator('label', { hasText: 'Reduction' })]
      const sliders = [cleanup.getByRole('slider', { name: 'Noise floor' }), cleanup.getByRole('slider', { name: 'Reduction' })]
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await setWindowSize(app, window, size)
        await expectNoHorizontalOverflow(cleanup, `the Cleanup card with Custom on at ${where}`)
        for (const [i, row] of rows.entries()) {
          const readout = row.locator('span.font-mono')
          const slider = sliders[i]
          if (!slider) throw new Error('missing slider')
          const heights: number[] = []
          // The ends and the middle: -80 / -25 / -20 dB, and 1 / 12 / 50 dB.
          for (const key of ['Home', 'End', 'ArrowLeft']) {
            await slider.press(key)
            await expectOneLine(readout, `the readout of ${i === 0 ? 'Noise floor' : 'Reduction'} at ${where}`)
            await expectControlsWhole(cleanup, readout, `the readout of ${i === 0 ? 'Noise floor' : 'Reduction'} at ${where}`)
            heights.push(Math.round((await row.boundingBox())?.height ?? 0))
          }
          expect(new Set(heights).size, `the ${i === 0 ? 'Noise floor' : 'Reduction'} row changes height with its value at ${where}: ${heights.join(', ')} px`).toBe(1)
        }
      }
    } finally {
      await closeStudio(studio)
    }
  })

  // T-123 (14): an ADPCM WAV opens (ffprobe reads it, the import says "Loaded") and the panel was a dead waveform with no word,
  // because `WaveSurfer.create({ url })` swallows the load's rejection and tells only the `error` event, which nothing listened to.
  // T-129: the waveform is drawn from MAIN's peaks now, and ffmpeg reads ADPCM, so the waveform IS drawn; what Chromium's media
  // element cannot do is PLAY it. The sentence says that, once, and Play stays off.
  test('a file the player cannot play still shows its waveform, and says it cannot be played, once, in a finished sentence (T-123 (14), T-129)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('waveform-error')
    const { window } = studio
    // Written out, not imported: an E2E asserts the words a person reads (and a build without the constant can still run it).
    // T-132 (10): the old advice, "Re-export it as WAV or MP3", was circular for the file that fails here (it already IS a WAV) and never said
    // that the waveform, the cuts and Export still work.
    const PLAYBACK_ERROR_MESSAGE =
      "imagii can't play this file here, but the waveform, cuts and export still work on it. To hear it, re-export it as a standard PCM WAV or MP3."
    try {
      const adpcm = path.join(studio.root, 'source', 'adpcm.wav')
      const made = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'adpcm_ms', adpcm])
      if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
      await dropOnImporter(window, adpcm, 'adpcm.wav')

      // The import itself succeeded, and so did the picture of the sound: main read it...
      await expect.poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] }).toContain(PLAYBACK_ERROR_MESSAGE)
      await expect(window.getByText(PLAYBACK_ERROR_MESSAGE)).toBeVisible()
      const drawn = await waveformColumns(window)
      expect(drawn.filter((c) => c.h > 4).length, 'the waveform is drawn from main\'s peaks (ffmpeg reads ADPCM)').toBeGreaterThan(50)
      // ...and the person reads the sentence ONCE.
      await window.waitForTimeout(1000)
      const toasts = await readToastLog(window)
      expect(toasts.filter((t) => t === PLAYBACK_ERROR_MESSAGE), `the sentence was toasted ${toasts.filter((t) => t === PLAYBACK_ERROR_MESSAGE).length} times: ${JSON.stringify(toasts)}`).toHaveLength(1)
      // It is a sentence, not a cause: no decoder name, no DOMException, no envelope.
      expect(toasts.join(' | ')).not.toMatch(/EncodingError|decodeAudioData|Unable to decode|Error invoking remote method|MEDIA_ERR/)
      // The studio is open on the file (the cleanup and export still work: they read the file, not the player), and the transport
      // that needs the player stays off.
      await expect(window.locator(WAVEFORM)).toBeVisible()
      await expect(playButton(window)).toBeDisabled()
    } finally {
      await closeStudio(studio)
    }
  })

  // T-123 (14) had a second case here: the page's `fetch` refused the app's file protocol, which is what wavesurfer's fetcher called
  // to pull the WHOLE file into the renderer for its decode. T-129 removed that path (with `peaks`, wavesurfer fetches nothing; the
  // long-file case below counts the renderer's fetches of the file and finds none), so the way a waveform fails now is MAIN failing to
  // read the sound. That is the refusal that remains: a file ffprobe reads (a sound stream, a 3 s length) whose sound no decoder can
  // read - a WAV with an unknown format tag - opens, its waveform job fails, and the studio lets go of it with one finished sentence.
  test('a file main cannot read the sound of is refused while its waveform is drawn: one finished sentence, and the studio lets go (T-129)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('waveform-unreadable')
    const { window } = studio
    const WAVEFORM_READ_FAILED =
      "imagii couldn't read the sound in this file to draw its waveform. It may be damaged or in a format imagii can't read here. Re-export it as a standard PCM WAV or MP3 and try again."
    try {
      const odd = path.join(studio.root, 'source', 'unknown-format.wav')
      writeFileSync(odd, unknownFormatWav())
      await dropOnImporter(window, odd, 'unknown-format.wav')
      await expect.poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] }).toContain(WAVEFORM_READ_FAILED)
      await expect(window.getByText(WAVEFORM_READ_FAILED)).toBeVisible()
      await window.waitForTimeout(1000)
      const toasts = await readToastLog(window)
      expect(toasts.filter((t) => t === WAVEFORM_READ_FAILED), `the sentence was toasted ${toasts.filter((t) => t === WAVEFORM_READ_FAILED).length} times: ${JSON.stringify(toasts)}`).toHaveLength(1)
      // ffmpeg's words are the console's, not the person's.
      expect(toasts.join(' | ')).not.toMatch(/decoder|Decoding requested|exit 234|Error invoking remote method/)
      // Refused, not half-held: back to the drop zone, no waveform panel, no export.
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      await expect(window.locator(WAVEFORM)).toHaveCount(0)
      await expect(window.locator(EXPORT)).toHaveCount(0)
      // T-132 (11): and not "celebrated" first. "Loaded" and the Recent entry landed the moment the file OPENED, before the waveform read could
      // refuse it, so a file the studio then let go of flashed a green "Loaded" beside the refusal and stayed in Recent.
      expect(toasts, `no green "Loaded" for a file that was refused: ${JSON.stringify(toasts)}`).not.toContain('Loaded')
      expect(recentAudioOnDisk(studio.userDataDir), 'the refused file never lands in Recent').not.toContain(odd)
      await expect(window.getByRole('button', { name: /^Recent \(/ }), 'and the importer offers no Recent list for it').toHaveCount(0)
      // And the way on works: a readable file is taken straight after - and THAT one is Loaded, and is in Recent.
      await dropAndWaitReady(studio)
      await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Loaded')
      await expect.poll(() => recentAudioOnDisk(studio.userDataDir), { timeout: 15_000, intervals: [200] }).toEqual([studio.fixture])
    } finally {
      await closeStudio(studio)
    }
  })

  // T-132 (5): wavesurfer's `normalize` scales the whole waveform by the loudest sample it finds in channel 0 - the HIGHS - alone. A take whose
  // lows run louder than its highs (a mic with a DC offset, an asymmetric voice) was scaled to the quiet half, so the bottom bars were drawn
  // past the canvas edge and the top ones five times too tall. `maxPeak` hands it the loudest of both. The file is a 100 Hz square wave at +0.2
  // and -0.8 of full scale: drawn right, the bars reach a quarter as far above the centre line as below it, and the low side just fills its half.
  test('an asymmetric take draws both halves to scale: quiet highs, loud lows (T-132 (5))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('waveform-asymmetric')
    const { window } = studio
    try {
      const asymmetric = path.join(studio.root, 'source', 'asymmetric.wav')
      writeFileSync(asymmetric, squareWav(3, 0.2, -0.8))
      await dropOnImporter(window, asymmetric, 'asymmetric.wav')
      await expect(playButton(window)).toBeEnabled({ timeout: 30_000 })
      const { up, down, canvasHeight } = await waveformHalves(window)
      expect(canvasHeight, 'the waveform is 96 px tall').toBeGreaterThanOrEqual(90)
      const half = canvasHeight / 2
      // Scaled by the loudest sample of EITHER half (0.8): the lows fill their half, the highs are 0.2 / 0.8 of it.
      expect(down, `the lows (the loud half) fill their half of the canvas: ${down} px of ${half}`).toBeGreaterThanOrEqual(half - 3)
      expect(up, `the highs reach a quarter as far (0.2 of 0.8): ${up} px above the centre`).toBeGreaterThanOrEqual(half * 0.2)
      expect(up, `and no further: scaled by the highs alone they filled their whole half (${half} px)`).toBeLessThanOrEqual(half * 0.35)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-132 (9) and (11): while main reads the sound for the waveform (seconds, up to tens of seconds for a long file) Play is off - and drew like a
  // live button. It is dimmed now, like every other disabled button in the app. And "Loaded" and the Recent entry wait for the waveform: the
  // peaks job's ffmpeg is held for 5 s here, so "meanwhile" is a state the test creates.
  test('while the waveform is being drawn Play is dimmed and nothing says Loaded; when it arrives Play is live and the file is Loaded and in Recent (T-132 (9), (11))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('waveform-drawing')
    const { window, app } = studio
    try {
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 5_000 }])
      await dropOnImporter(window, studio.fixture, 'e2e-tone.wav')
      const drawing = window.getByRole('progressbar', { name: 'Drawing the waveform' })
      await expect(drawing).toBeVisible({ timeout: 30_000 })
      const opacity = (): Promise<number> => playButton(window).evaluate((el) => Number(getComputedStyle(el).opacity))
      await expect(playButton(window)).toBeDisabled()
      expect(await opacity(), 'a Play that cannot play looks it').toBeLessThan(0.7)
      // Nothing is celebrated while the file may still be refused.
      expect(await readToastLog(window), 'no "Loaded" before the waveform').not.toContain('Loaded')
      expect(recentAudioOnDisk(studio.userDataDir), 'and no Recent entry').toEqual([])

      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      expect(await opacity(), 'Play is full strength once it can play').toBe(1)
      await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Loaded')
      await expect.poll(() => recentAudioOnDisk(studio.userDataDir), { timeout: 15_000, intervals: [200] }).toEqual([studio.fixture])
    } finally {
      await closeStudio(studio)
    }
  })

  // T-123 (14): a 3 to 6 h stream recording decoded to 10-20 GB of renderer memory (measured: 3.25 GB for 1 h, 6.5 GB for 2 h) and
  // took the window with it, so T-123 refused anything over two hours at load. T-129 (T-110 (ao)) is the real fix: MAIN reads the sound
  // as a stream into 4000 highest/lowest pairs and wavesurfer is handed those and the length, never the file to decode, while the
  // media element streams the file for playback. This case is that pin FLIPPED: a 2 h 5 min file (the first hour a tone, the rest
  // silence, 48 kHz - the rate the old path decoded at) opens; while main reads it the box the waveform will fill says how far it has
  // got; the waveform then draws, tone where the tone is and flat where the silence is; the renderer never fetched the file; and the
  // renderer's peak memory stays far under the old path's (a generous 800 MB line; the old path refused this file outright, and with
  // its ceiling lifted it decoded it to gigabytes - measured, see LESSONS).
  test('a file longer than two hours opens, shows how far its waveform has been read, draws it, and the renderer never holds the file (T-129, flipping T-123 (14))', async () => {
    test.setTimeout(300_000)
    const studio = await openStudio('long-file')
    const { app, window } = studio
    try {
      const longMp3 = await makeTwoHourMp3(path.join(studio.root, 'source'))
      const renderer = await rendererMemory(app)
      await countRendererFileFetches(window)
      await dropOnImporter(window, longMp3, 'two-hours-five.mp3')

      // The studio opens on the file at once, and the box the waveform will fill says how far main has read (not an empty dark box).
      const drawing = window.getByRole('progressbar', { name: 'Drawing the waveform' })
      await expect(drawing).toBeVisible({ timeout: 30_000 })
      await expect(drawing).toHaveText(/^Drawing the waveform… \d+%$/)
      await expect.poll(async () => Number(await drawing.getAttribute('aria-valuenow').catch(() => '0')), { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0)
      // The words the person reads carry main's progress too (not only the attribute a screen reader reads).
      const shownPercent = async (): Promise<number> =>
        Number(/(\d+)%$/.exec((await drawing.textContent({ timeout: 1000 }).catch(() => '')) ?? '')?.[1] ?? '0')
      await expect.poll(shownPercent, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0)
      await expect(playButton(window), 'no player before there is a waveform').toBeDisabled()
      await expect(window.locator('header').getByText('two-hours-five.mp3', { exact: true })).toBeVisible()

      // Then the waveform replaces it. The renderer's memory and the player's word are watched the whole time it waits, because the
      // old path (wavesurfer handed the file to decode) failed one of two ways on this file, measured: its decode climbed past a
      // gigabyte in seconds and the renderer crashed, or the decode was refused at once and wavesurfer reported an error. Either must
      // fail HERE, by name, not three minutes later on a Play that never turns on.
      let drawnAtMb = 0
      const verdict = async (): Promise<'over the line' | 'player error' | 'drawn' | 'waiting'> => {
        drawnAtMb = await renderer.peakMb()
        if (drawnAtMb >= RENDERER_MEMORY_LINE_MB) return 'over the line'
        if ((await readToastLog(window).catch(() => [] as string[])).some((t) => /can't play this file/.test(t))) return 'player error'
        return (await playButton(window).isEnabled({ timeout: 250 }).catch(() => false)) ? 'drawn' : 'waiting'
      }
      await expect.poll(verdict, { timeout: 180_000, intervals: [100] }).not.toBe('waiting')
      expect(drawnAtMb, `the renderer peaked at ${drawnAtMb} MB while the waveform was read and drawn`).toBeLessThan(RENDERER_MEMORY_LINE_MB)
      expect(await readToastLog(window), 'the long file plays: the player has nothing to say about it').not.toContainEqual(expect.stringMatching(/can't play this file/))
      await expect(playButton(window)).toBeEnabled()
      await expect(drawing).toHaveCount(0)
      // 2 h 5 min and a few seconds: each joined minute carries its encoder's own padding (about 24 ms).
      await expect(window.locator(`${WAVEFORM} .font-mono`).first()).toHaveText(/^0:00\.00 \/ 2:05:0\d\.\d\d$/)
      const columns = await waveformColumns(window)
      const width = Math.max(...columns.map((c) => c.x))
      // The painted columns only: bars are 2 px wide with a 1 px gap, and a gap column is empty wherever it is.
      const heightIn = (from: number, to: number): number[] =>
        columns.filter((c) => c.x >= width * from && c.x <= width * to && c.h > 0).map((c) => c.h)
      const tone = heightIn(0.05, 0.4)
      const quiet = heightIn(0.55, 0.95)
      expect(quiet.length, 'the silent part is drawn too (1 px bars)').toBeGreaterThan(20)
      expect(tone.length).toBeGreaterThan(20)
      expect(Math.min(...tone), 'the first hour is a tone: tall bars all the way').toBeGreaterThan(40)
      expect(Math.max(...quiet), 'the rest is silence: flat').toBeLessThanOrEqual(2)
      // The renderer never asked for the file: wavesurfer had the peaks, and the media element streams it (its own requests are not fetch).
      expect(await rendererFileFetches(window), 'fetches of the file from the page').toBe(0)
      // And after the drawn waveform was read back off its canvases: still under the line (VmHWM only rises).
      const peakMb = await renderer.peakMb()
      await renderer.stop()
      console.info(`[t129] renderer peak memory with a 2 h 5 min file drawn: ${peakMb} MB (${renderer.how})`)
      expect(peakMb, `the renderer peaked at ${peakMb} MB`).toBeLessThan(RENDERER_MEMORY_LINE_MB)
      expect(await readToastLog(window)).toContain('Loaded')
    } finally {
      await closeStudio(studio)
    }
  })

  // T-129: the peaks job is registered with the per-job cancel registry: a file closed while its waveform is still being read stops
  // main's ffmpeg (Close and a superseding open are what send the Cancel), and the person, who pressed Close, is told nothing more.
  test('Close while a long file is still being drawn stops main\'s job: its ffmpeg is killed, nothing is said, and the next file opens (T-129)', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('long-file-close')
    const { app, window } = studio
    try {
      const longMp3 = await makeTwoHourMp3(path.join(studio.root, 'source'))
      await recordPeaksChildren(app)
      await dropOnImporter(window, longMp3, 'two-hours-five.mp3')
      const drawing = window.getByRole('progressbar', { name: 'Drawing the waveform' })
      await expect.poll(async () => Number(await drawing.getAttribute('aria-valuenow').catch(() => '0')), { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0)
      // Mid-read: the job's ffmpeg is running.
      expect((await readPeaksChildren(app)).map((c) => c.exit)).toEqual([null])
      await window.locator('header').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.getByText('Drop audio or video here')).toBeVisible()
      // Killed by the app, not left to read two hours of sound for nobody.
      await expect.poll(async () => (await readPeaksChildren(app)).map((c) => c.exit?.signal ?? c.exit?.code ?? null), { timeout: 10_000, intervals: [100] }).toEqual(['SIGKILL'])
      await window.waitForTimeout(1500)
      const toasts = await readToastLog(window)
      expect(toasts.join(' | '), 'their own Close is not news').not.toMatch(/waveform|Canceled|canceled|couldn't|Couldn't/)
      await expect(window.locator(WAVEFORM)).toHaveCount(0)
      // And the way on works.
      await dropAndWaitReady(studio)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-129: and with the quit sweep and the quit's drain (T-127 (3)): a quit while a long file is being drawn kills the job's ffmpeg,
  // and the app waits for that run to end before it goes, so no decoder is left running after the window.
  test('quitting while a long file is being drawn kills main\'s job before the app is gone (T-129)', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('long-file-quit')
    const { app, window } = studio
    const report = path.join(studio.root, 'peaks-at-will-quit.json')
    try {
      const longMp3 = await makeTwoHourMp3(path.join(studio.root, 'source'))
      await recordPeaksChildren(app, report)
      await dropOnImporter(window, longMp3, 'two-hours-five.mp3')
      const drawing = window.getByRole('progressbar', { name: 'Drawing the waveform' })
      await expect.poll(async () => Number(await drawing.getAttribute('aria-valuenow').catch(() => '0')), { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0)
      expect((await readPeaksChildren(app)).map((c) => c.exit)).toEqual([null])
      await app.close()
      const atQuit = JSON.parse(readFileSync(report, 'utf8')) as PeaksChild[]
      expect(atQuit.map((c) => c.exit?.signal ?? null), `the peaks ffmpeg at will-quit: ${JSON.stringify(atQuit)}`).toEqual(['SIGKILL'])
    } finally {
      rmSync(studio.root, { recursive: true, force: true })
    }
  })

  // T-124 (6): a VIDEO over two hours dropped on the importer was refused before any sound was extracted (the 2-hour gate asked first).
  // T-129 retired the gate: the sound of a 2 h 1 s video is extracted (a ~1.4 GB scratch WAV, 48 kHz stereo) and opens, its waveform
  // drawn from main's peaks of that WAV, with Re-attach offered (it has a picture). The fixture is 2 h 1 s of 1 fps video and 8 kHz sound,
  // 650 KB; the WAV this case makes is removed by it.
  test('a video longer than two hours is extracted and opens, its waveform drawn from main\'s peaks (T-129, flipping T-124 (6))', async () => {
    test.setTimeout(300_000)
    const studio = await openStudio('long-video')
    const { window } = studio
    const scratch = path.join(os.tmpdir(), 'imagii-audio')
    const wavs = (): string[] => (existsSync(scratch) ? readdirSync(scratch) : [])
    const before = new Set(wavs())
    try {
      const longVideo = path.join(studio.root, 'source', 'two-hour-vod.mp4')
      const made = await runBinary(ffmpegPath, [
        '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x48:r=1:d=7201', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
        '-t', '7201', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '600', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '8k', '-shortest', longVideo
      ])
      if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
      await dropOnImporter(window, longVideo, 'two-hour-vod.mp4')
      await expect(playButton(window)).toBeEnabled({ timeout: 240_000 })
      await expect(window.locator('header').getByText('two-hour-vod.mp4', { exact: true })).toBeVisible()
      await expect(window.locator(`${WAVEFORM} .font-mono`).first()).toHaveText(/^0:00\.00 \/ 2:00:0[01]\.\d\d$/)
      await expect(window.locator(EXPORT).getByText('Re-attach to video (output .mp4)'), 'it has a picture to put the sound back on').toBeVisible()
      const toasts = await readToastLog(window)
      expect(toasts).toContain('Loaded')
      expect(toasts.join(' | ')).not.toMatch(/longer than 2 hours/)
      expect(wavs().filter((f) => !before.has(f)), 'the extracted WAV is the file the studio holds').toHaveLength(1)
    } finally {
      await closeStudio(studio)
      // This case's own scratch WAV only (~1.4 GB): every file in imagii-audio that was not there before it began.
      for (const f of wavs().filter((name) => !before.has(name) && name.endsWith('.wav'))) rmSync(path.join(scratch, f), { force: true })
    }
  })

  // T-126 (7): "is this a video?" was decided from the file NAME. An .mkv or .mp4 that holds sound alone (a podcast, a voice memo, a stream's
  // audio-only rip) was treated as one: Re-attach was ON by default and its mux dies on `-map 0:v:0` (there is no picture), and a 2-hour one was told
  // to export a part from Video Studio, which refuses a file with no picture and sends the person back here. The probe reads the streams now.
  // (T-129 retired the 2-hour ceiling, and with it the sentence this case also pinned; see the end of the case.)
  test('an audio-only .mkv loads as sound: no Re-attach is offered, and it exports as plain audio (T-126 (7))', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('audio-only-mkv')
    const { app, window } = studio
    try {
      const podcast = path.join(studio.root, 'source', 'podcast.mkv')
      const made = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', podcast])
      if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
      await dropOnImporter(window, podcast, 'podcast.mkv')
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      await expect.poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] }).toContain('Loaded')
      await expect(window.locator('header').getByText('podcast.mkv', { exact: true })).toBeVisible()

      // Nothing to re-attach a sound to: no Re-attach box, and the format select is the person's.
      const exportPanel = window.locator(EXPORT)
      await expect(exportPanel.getByRole('checkbox'), 'no Re-attach to video for a file with no picture').toHaveCount(0)
      await expect(exportPanel.getByText('Re-attach to video (output .mp4)')).toHaveCount(0)
      await expect(exportPanel.getByRole('combobox').first()).toBeEnabled()

      // It exports as plain audio (the Re-attach it used to be sent down fails on `-map 0:v:0`).
      const out = path.join(studio.root, 'podcast-clean.mp3')
      await stubSaveDialog(app, out)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await exportButton.click()
      await expect.poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] }).toContain('Cleaned audio exported')
      await expect(exportButton).toBeEnabled({ timeout: 30_000 })
      const probed = await probeFile(out)
      expect(probed.codecs, 'an audio file: no video stream').toEqual(['mp3'])
      // T-129: this case also pinned the 2-hour ceiling's AUDIO sentence for a long audio-only mkv ("split it in another app", never
      // "export a part from Video Studio"). The ceiling is retired, so there is no sentence to choose: a long audio-only mkv is extracted
      // and opened like this short one (Layer 5: "an audio-only mkv over two hours is extracted", hasVideo false at 2 h 1 s).
    } finally {
      await closeStudio(studio)
    }
  })

  // T-125 (4): the pre-extract probe (T-124 (6)) refused a container with no duration in its header - a MediaRecorder WebM, an older
  // take, a crashed MKV - with "imagii can't read this audio format", for a file the extraction handles end to end (the control: the
  // same file imported before T-124). A probe that cannot READ a length is an unknown length, and the extraction goes ahead.
  test('a recording whose header has no duration (a MediaRecorder WebM) imports: the probe not reading a length is not a refusal (T-125 (4))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('no-duration')
    const { window } = studio
    try {
      const webm = path.join(studio.root, 'source', 'take-no-duration.webm')
      const made = await runBinary(ffmpegPath, [
        '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-live', '1', '-f', 'webm', webm
      ])
      if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
      // The fixture is what it says: no duration in the header (ffprobe prints N/A), so `probeAudio` cannot use it.
      const probed = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', webm])
      expect(probed.stdout.toString().trim(), 'a header with no duration').toBe('N/A')

      await dropOnImporter(window, webm, 'take-no-duration.webm')
      await expect(window.locator(WAVEFORM)).toBeVisible({ timeout: 60_000 })
      await expect(playButton(window)).toBeEnabled()
      const log = await readToastLog(window)
      expect(log, 'the file loaded').toContain('Loaded')
      expect(log.join(' | '), 'and nobody told the person the format cannot be read').not.toMatch(/can't read this audio format/)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the Fix Wizard keeps the chain\'s 50 Hz mains and its summary names the notch it will apply (T-112)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizard50')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const cleanup = window.locator(CLEANUP)
      // The person is on 50 Hz mains and has said so in the Cleanup panel.
      await cleanup.getByLabel('Hum removal (60 Hz mains)').check()
      await cleanup.getByLabel('Power-line frequency').selectOption('50')
      await expect(cleanup.getByLabel('Hum removal (50 Hz mains)')).toBeChecked()

      const dialog = window.getByRole('dialog')
      await window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' }).click()
      await dialog.getByRole('button', { name: 'A little' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      // The summary says WHICH notch (it used to say only "on", and Apply could not be checked).
      await expect(dialog).toContainText('Hum removal: on (50 Hz mains)')
      await expect(dialog).not.toContainText('60 Hz')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expect(dialog).toHaveCount(0)
      // ...and Apply did exactly that: still 50, still on.
      await expect(cleanup.getByLabel('Hum removal (50 Hz mains)')).toBeChecked()
      await expect(cleanup.getByLabel('Power-line frequency')).toHaveValue('50')

      // A quiet room switches hum removal off, and then there is no notch to name.
      await window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' }).click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Music' }).click()
      await expect(dialog).toContainText('Hum removal: off')
      await expect(dialog).not.toContainText('Hz mains')
    } finally {
      await closeStudio(studio)
    }
  })

  test('the loudness target box stops a number loudnorm refuses: -3 becomes -5, -80 becomes -70, junk changes nothing (T-112)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('lufsbox')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const levels = window.locator(LEVELS)
      await levels.getByRole('checkbox').check()
      const lufs = levels.getByLabel('Loudness target (LUFS)')
      // The box carries loudnorm's range itself (it only marks a number invalid; the commit below stops it).
      await expect(lufs).toHaveAttribute('min', '-70')
      await expect(lufs).toHaveAttribute('max', '-5')

      // A target inside the range reaches the chain as it is typed (the platform picker follows).
      await lufs.fill('-18')
      await expect(levels.getByLabel('Loudness platform preset')).toHaveValue('custom')
      await lufs.fill('-23')
      await expect(levels.getByLabel('Loudness platform preset')).toHaveValue('broadcast')

      // -3 passed the old 0 ceiling and was refused only at Export. It is stopped at the box.
      await lufs.fill('-3')
      await expect(levels.getByLabel('Loudness platform preset')).toHaveValue('broadcast') // not committed yet
      await lufs.blur()
      await expect(lufs).toHaveValue('-5')
      await lufs.fill('-80')
      await lufs.press('Enter')
      await expect(lufs).toHaveValue('-70')
      // Not a number: the last good target stays.
      await lufs.fill('')
      await lufs.blur()
      await expect(lufs).toHaveValue('-70')
      // The way to -23 passes through -2: a keystroke is never refused.
      await lufs.fill('')
      await lufs.pressSequentially('-23')
      await expect(lufs).toHaveValue('-23')
      await expect(levels.getByLabel('Loudness platform preset')).toHaveValue('broadcast')
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
      // T-90: Start over RESTARTS — the dialog stays open on question one with
      // nothing answered. (It used to close the dialog, which is Close's job.)
      await dialog.getByRole('button', { name: 'Start over' }).click()
      await expect(dialog).toHaveCount(1)
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await expect(dialog).toContainText('Is there background noise (HVAC, fan, traffic)?')
      await expect(dialog).not.toContainText('Ready to apply')
      // …and it is a real restart: a different run from here gives a different
      // summary, not the first run's answers.
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Music', exact: true }).click()
      await expect(dialog).toContainText('Quieter background: off')
      await expect(dialog).not.toContainText('Quieter background: on (aggressive)')
      await dialog.getByRole('button', { name: 'Start over' }).click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      // Close is what closes: it leaves a fresh wizard behind for next time.
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)
      await openWizard.click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')

      // ── the run that applies ──
      await dialog.getByRole('button', { name: 'Yes, pretty loud' }).click()
      await dialog.getByRole('button', { name: 'Yeah, kind of echoy' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      // The summary names exactly what will be set, in a streamer's words
      // (T-90) and in imagii's voice, not "I'll"…
      await expect(dialog).toContainText('Based on your answers, imagii will set:')
      await expect(dialog).not.toContainText("I'll")
      await expect(dialog).toContainText('Quieter background: on (aggressive)')
      await expect(dialog).toContainText('Low rumble removal: on')
      // T-112: the line names the notch it will apply (the chain is on 60 Hz mains).
      await expect(dialog).toContainText('Hum removal: on (60 Hz mains)')
      await expect(dialog).toContainText("Softer harsh 's' sounds: on")
      await expect(dialog).toContainText('Compressor: voice')
      await expect(dialog).toContainText('Even volume: on (target −16)')
      await expect(dialog).not.toContainText(/Denoise|Highpass|De-ess|Loudnorm|LUFS/)
      // …and the echoy answer produces the room-treatment tip (INIT-A) rather
      // than a filter that cannot exist.
      await expect(dialog).toContainText('room reverb is hard to remove after the fact')

      const closeWizard = dialog.getByRole('button', { name: 'Close' })
      await expect(closeWizard).toHaveCount(0) // summary step has Start over / Apply
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.')
      // T-125 (19): the only sentence that says the cleanup waits for the export is still on screen well past a success toast's 2 s
      // (react-hot-toast takes it down at about 3 s with its exit animation; an action toast lasts 8 s).
      await window.mouse.move(2, 2)
      await window.waitForTimeout(4_500)
      await expect(
        window.getByText('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.'),
        'the Apply toast carries a needed fact and is held like an action toast'
      ).toBeVisible()

      // ── the panels really changed ──
      const cleanup = window.locator(CLEANUP)
      const levels = window.locator(LEVELS)
      await expectSelected(cleanup.getByRole('button', { name: 'Aggressive', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (below 80 Hz)')).toBeChecked()
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).toBeChecked()
      await expect(cleanup.getByLabel("Softer harsh 's' sounds")).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Voice', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()
      await expect(levels.getByLabel('Loudness target (LUFS)')).toHaveValue('-16')
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
      await cleanup.getByLabel('Remove low rumble (below 80 Hz)').check()
      await cleanup.getByLabel('Hum removal (60 Hz mains)').check()
      await cleanup.getByLabel("Softer harsh 's' sounds").check()
      await openWizard.click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Music', exact: true }).click()
      await expect(dialog).toContainText('Quieter background: off')
      await expect(dialog).toContainText('Low rumble removal: off')
      await expect(dialog).toContainText('Hum removal: off')
      await expect(dialog).toContainText("Softer harsh 's' sounds: off")
      await expect(dialog).toContainText('Compressor: music')
      // A dry room gets no reverb tip.
      await expect(dialog).not.toContainText('room reverb is hard to remove')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expectSelected(cleanup.getByRole('button', { name: 'Off', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (below 80 Hz)')).not.toBeChecked()
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).not.toBeChecked()
      await expect(cleanup.getByLabel("Softer harsh 's' sounds")).not.toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Music', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()

      // ── T-90: the list and the apply step are ONE object ──
      // A quiet room with a talking recording: the old summary printed
      // "Highpass + 60 Hz hum reduction: off" and Apply then switched the
      // highpass ON. Now the rumble line says on, the hum line says off, and
      // the panels agree with both after Apply.
      await openWizard.click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Talking / voice' }).click()
      await expect(dialog).toContainText('Low rumble removal: on')
      await expect(dialog).toContainText('Hum removal: off')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expect(cleanup.getByLabel('Remove low rumble (below 80 Hz)')).toBeChecked()
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).not.toBeChecked()
      await expect(cleanup.getByLabel("Softer harsh 's' sounds")).toBeChecked()

      // ── the last two answers: mild noise, mixed content ──
      await openWizard.click()
      await dialog.getByRole('button', { name: 'A little' }).click()
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await dialog.getByRole('button', { name: 'Both, mixed' }).click()
      await expect(dialog).toContainText('Quieter background: on (medium)')
      await expect(dialog).toContainText('Compressor: mixed')
      await dialog.getByRole('button', { name: 'Apply' }).click()
      await expectSelected(cleanup.getByRole('button', { name: 'Medium', exact: true }))
      await expect(cleanup.getByLabel('Remove low rumble (below 80 Hz)')).toBeChecked()
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).toBeChecked()
      await expect(cleanup.getByLabel("Softer harsh 's' sounds")).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Mixed', exact: true }))
    } finally {
      await closeStudio(studio)
    }
  })

  // T-119 (8): each answer replaces the buttons that were just pressed, so keyboard focus fell to the page
  // behind the dialog after every step (the focus trap only places it when the dialog opens). A person who
  // answers with Enter must be able to answer the next question with Enter.
  test('Fix Wizard keeps keyboard focus on every step: the first option of each question, then Apply (T-119)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizardfocus')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const openWizard = window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' })
      const dialog = window.getByRole('dialog')
      /** Where focus is, as the element's visible text (or 'body' when it fell out of the dialog). */
      const focusedText = (): Promise<string> =>
        window.evaluate(() => {
          const el = document.activeElement
          return !el || el === document.body ? 'body' : (el.textContent ?? '').trim()
        })

      await openWizard.focus()
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await expect(dialog.getByRole('button', { name: 'None to speak of' })).toBeFocused()

      // Answer by keyboard alone; every step lands on its first option.
      await window.keyboard.press('Enter') // None to speak of
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await expect(dialog.getByRole('button', { name: 'Sounds dry' })).toBeFocused()
      await window.keyboard.press('Tab')
      await window.keyboard.press('Enter') // Yeah, kind of echoy
      await expect(dialog).toContainText('Quick fix · 3 of 3')
      await expect(dialog.getByRole('button', { name: 'Talking / voice' })).toBeFocused()
      await window.keyboard.press('Enter') // Talking / voice
      await expect(dialog).toContainText('Ready to apply')
      await expect(dialog.getByRole('button', { name: 'Apply' })).toBeFocused()
      expect(await focusedText()).toBe('Apply')

      // Start over is a step too: the first question's first option again.
      await dialog.getByRole('button', { name: 'Start over' }).click()
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await expect(dialog.getByRole('button', { name: 'None to speak of' })).toBeFocused()

      // The trap still works from the new position: Tab stays inside the dialog, and Escape hands focus back to
      // the button that opened it.
      for (let i = 0; i < 6; i++) {
        await window.keyboard.press('Tab')
        expect(await focusedText(), `Tab ${i + 1} left the dialog`).not.toBe('body')
        expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
      }
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(openWizard).toBeFocused()
    } finally {
      await closeStudio(studio)
    }
  })

  // T-120 (10): the wizard puts focus on each next question's first option inside the same event as the answer
  // (React flushes a discrete event's effects at its end), so a HELD Enter - whose auto-repeats are keydowns on
  // whatever has focus - answered all three questions and pressed Apply. A repeat is not a new decision.
  // Playwright marks a keydown for a key that is already down as a repeat, which is what a held key does.
  test('Fix Wizard: a held Enter answers one question, not all three and Apply (T-120)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizardheld')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const dialog = window.getByRole('dialog')
      await window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' }).focus()
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await expect(dialog.getByRole('button', { name: 'None to speak of' })).toBeFocused()

      // Hold Enter: the first keydown answers question 1 ...
      await window.keyboard.down('Enter')
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      // ... and five auto-repeats land on the next question's first option, then the next.
      for (let i = 0; i < 5; i++) await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await expect(dialog, 'the repeats walked the wizard on').toContainText('Quick fix · 2 of 3')
      await expect(dialog).not.toContainText('Ready to apply')
      await expect(dialog.getByRole('button', { name: 'Sounds dry' })).toBeFocused()
      expect(await readToastLog(window), 'Apply was pressed by a repeat').not.toContain(
        'Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.'
      )

      // A fresh press is a decision: it answers question 2, and so on to Apply.
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 3 of 3')
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Ready to apply')
      await window.keyboard.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.')
    } finally {
      await closeStudio(studio)
    }
  })

  // T-133 (9): the audio Importer's "Choose file…" says "Loading…" while a file loads and is `disabled`, and drew like a live button.
  test('the Importer\'s Choose file is dimmed while a file is loading (T-133 (9))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('importer-dim')
    const { window, app } = studio
    try {
      const choose = window.getByRole('button', { name: /^(Choose file…|Loading…)$/ })
      const opacity = (): Promise<number> => choose.evaluate((el) => Number(getComputedStyle(el).opacity))
      await expect(choose).toHaveText('Choose file…')
      expect(await opacity(), 'a live button is not dimmed').toBe(1)
      await installSpawnStall(app, [{ match: 'ffprobe', nth: 1, ms: 4000 }])
      await dropOnImporter(window, studio.fixture, 'e2e-tone.wav')
      await expect(choose).toHaveText('Loading…', { timeout: 10_000 })
      await expect(choose).toBeDisabled()
      // (polled: the button's colors transition, so the first frame after it is disabled is not yet the settled look)
      await expect.poll(opacity, { timeout: 5_000, message: 'a button that cannot be pressed looks it' }).toBeLessThan(0.7)
      await expect(window.locator('[data-tutorial="audio-waveform"]')).toBeVisible({ timeout: 60_000 })
    } finally {
      await closeStudio(studio)
    }
  })

  // T-133 (7a): the same boundary on the way OUT of the wizard. A held Enter on Apply closes the dialog with its first press; focus goes back to
  // "Help me fix this", and the key's auto-repeats (a keyboard click on that button) opened the wizard again from question 1.
  test('Fix Wizard: a held Enter on Apply applies once; the repeats do not reopen the wizard (T-133 (7a))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizardheldapply')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      const dialog = window.getByRole('dialog')
      const openWizard = window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' })
      await openWizard.focus()
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 1 of 3')
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 3 of 3')
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Ready to apply')
      await expect(dialog.getByRole('button', { name: 'Apply' })).toBeFocused()

      // Hold Enter on Apply: the first keydown applies and closes ...
      await window.keyboard.down('Enter')
      await expect(dialog).toHaveCount(0)
      // ... the repeats (after an OS repeat delay) land on "Help me fix this", where focus went back to. They are not presses.
      await window.waitForTimeout(800)
      for (let i = 0; i < 6; i++) await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await window.waitForTimeout(300)
      await expect(dialog, 'the repeats reopened the wizard').toHaveCount(0)
      expect(await readToastLog(window)).toContain('Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.')

      // Not a latch: a fresh press on the button opens the wizard again.
      await expect(openWizard).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(dialog).toContainText('Quick fix · 1 of 3')
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

      // T-90: the panel says exactly what a preset keeps — before AND after
      // the first one is saved, not only on the empty list.
      const PRESET_HINT =
        'Saves your cleanup settings — noise, levels, and voice treatments — so you can reuse them. ' +
        'Cuts and the second track stay with the session.'
      await expect(presets).toContainText(PRESET_HINT)

      // Naming nothing is refused before any IPC happens.
      await presets.getByRole('button', { name: 'Save current' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Name your preset first')
      expect(existsSync(presetDir) ? readdirSync(presetDir) : []).toEqual([])

      // ── dial a chain in, save it with Enter ──
      await cleanup.getByRole('button', { name: 'Medium', exact: true }).click()
      await cleanup.getByLabel("Softer harsh 's' sounds").check()
      await levels.getByRole('button', { name: 'Voice', exact: true }).click()
      await levels.getByRole('checkbox').check()
      await levels.getByLabel('Loudness target (LUFS)').fill('-14')
      // …and the 50 Hz mains, chosen through the picker that appears with it.
      await cleanup.getByLabel('Hum removal (60 Hz mains)').check()
      await cleanup.getByLabel('Power-line frequency').selectOption('50')
      await expect(cleanup.getByLabel('Hum removal (50 Hz mains)')).toBeChecked()
      // THIS recording's own edits: one cut, and a music bed. Neither is a
      // cleanup setting, and neither may end up in the preset (T-90).
      await dragCut(window, 0.2, 0.4)
      await expect(cutChips(window)).toHaveCount(1)
      const todaysCut = (await cutChips(window).first().textContent()) ?? ''
      await stubOpenDialog(studio.app, studio.fixture)
      await window
        .locator(MULTITRACK)
        .getByRole('button', { name: /Background music/ })
        .click()
      await expect(window.locator(MULTITRACK)).toContainText('Background music: e2e-tone.wav')
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
        loudnormTargetLufs: -14,
        hum60: true,
        humHz: 50
      })
      // T-90: cleanup settings ONLY. The cut and the music bed that were on
      // screen when "Save current" was pressed are not in the file…
      expect('cutRegions' in saved.chain).toBe(false)
      expect('secondaryTrack' in saved.chain).toBe(false)
      expect(readFileSync(path.join(presetDir, files[0] as string), 'utf8')).not.toContain(
        'e2e-tone.wav'
      )

      // ── a second preset, saved with the button ──
      await cleanup.getByRole('button', { name: 'Off', exact: true }).click()
      await cleanup.getByLabel("Softer harsh 's' sounds").uncheck()
      await levels.getByRole('button', { name: 'Music', exact: true }).click()
      await levels.getByRole('checkbox').uncheck()
      await nameInput.fill('Mic B')
      await presets.getByRole('button', { name: 'Save current' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Saved "Mic B"')
      await expect(presets.getByRole('button', { name: 'Apply' })).toHaveCount(2)
      expect(readdirSync(presetDir)).toHaveLength(2)
      // T-127 (15): a preset's name is cut with an ellipsis in a narrow card; its whole self is the tooltip.
      await expect(presets.locator('li span.truncate').filter({ hasText: /^Mic A$/ })).toHaveAttribute('title', 'Mic A')

      // ── apply restores the first chain over the current one ──
      const rowA = presets.locator('li').filter({ hasText: 'Mic A' })
      await rowA.getByRole('button', { name: 'Apply' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Applied "Mic A"')
      await expectSelected(cleanup.getByRole('button', { name: 'Medium', exact: true }))
      await expect(cleanup.getByLabel("Softer harsh 's' sounds")).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Voice', exact: true }))
      await expect(levels.getByRole('checkbox')).toBeChecked()
      await expect(levels.getByLabel('Loudness target (LUFS)')).toHaveValue('-14')
      await expect(cleanup.getByLabel('Hum removal (50 Hz mains)')).toBeChecked()
      await expect(cleanup.getByLabel('Power-line frequency')).toHaveValue('50')
      // Applying it did not touch this recording's own cut or music bed.
      await expect(cutChips(window)).toHaveCount(1)
      expect((await cutChips(window).first().textContent()) ?? '').toBe(todaysCut)
      await expect(window.locator(MULTITRACK)).toContainText('Background music: e2e-tone.wav')

      // ── delete: declined, then accepted ──
      dialogs.action = 'dismiss'
      const rowB = presets.locator('li').filter({ hasText: 'Mic B' })
      await rowB.getByRole('button', { name: 'Delete preset' }).click()
      await expect
        .poll(() => dialogs.messages, { timeout: 15_000, intervals: [200] })
        .toContain('Delete preset "Mic B"?')
      await expect(presets.getByRole('button', { name: 'Apply' })).toHaveCount(2)
      expect(readdirSync(presetDir)).toHaveLength(2)

      dialogs.action = 'accept'
      await rowB.getByRole('button', { name: 'Delete preset' }).click()
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

      const matchLoudness = panel.getByLabel('Match loudness with your voice')
      await expect(matchLoudness).not.toBeChecked()
      await matchLoudness.check()
      await expect(matchLoudness).toBeChecked()

      const duck = panel.getByLabel('Duck under your voice')
      await expect(duck).toBeChecked()
      // T-122: "This track dips whenever you talk" is a promise about the export, and the export only dips the
      // track when Duck is on, so the sentence is on screen exactly then (it was unconditional, and "Second
      // mic" defaults Duck OFF with no sidechaincompress built).
      const dipsFooter = panel.getByText(/This track dips whenever you talk/)
      await expect(dipsFooter).toBeVisible()

      // ── the four ducking sliders (DEFAULT_DUCK_PARAMS) ──
      const threshold = panel.getByRole('slider', { name: 'Threshold' })
      const ratio = panel.getByRole('slider', { name: 'Ratio' })
      const attack = panel.getByRole('slider', { name: 'Attack' })
      const release = panel.getByRole('slider', { name: 'Release' })
      await expect(panel.locator('label', { hasText: 'Threshold' })).toContainText('-26 dBFS')
      // T-126 (12): a ratio's unit is ":1" and joins its number, in the drawn readout and in what a screen reader is given ("8 :1" before).
      await expect(panel.locator('label', { hasText: 'Ratio' })).toContainText('8:1')
      await expect(panel.locator('label', { hasText: 'Ratio' })).not.toContainText('8 :1')
      await expect(ratio).toHaveAttribute('aria-valuetext', '8:1')
      await expect(panel.locator('label', { hasText: 'Attack' })).toContainText('20 ms')
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('400 ms')
      await threshold.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Threshold' })).toContainText('-25 dBFS')
      await ratio.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Ratio' })).toContainText('8.5:1')
      await expect(ratio).toHaveAttribute('aria-valuetext', '8.5:1')
      await attack.press('ArrowLeft')
      await expect(panel.locator('label', { hasText: 'Attack' })).toContainText('19 ms')
      await release.press('ArrowRight')
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('410 ms')
      await expect(release).toHaveAttribute('aria-valuetext', '410 ms')

      // Ducking off hides the four sliders AND the sentence that says the track dips; back on restores the values.
      await duck.uncheck()
      await expect(panel.getByRole('slider', { name: 'Threshold' })).toHaveCount(0)
      await expect(dipsFooter, 'Duck off: nothing dips, so the footer that says it does is gone').toHaveCount(0)
      await duck.check()
      await expect(panel.locator('label', { hasText: 'Release' })).toContainText('410 ms')
      await expect(dipsFooter).toBeVisible()

      // ── remove, then the other two roles and their defaults ──
      await panel.getByRole('button', { name: /Remove/ }).click()
      await expect(panel).toContainText('Layer in background music')
      await expect(panel.getByRole('button', { name: /Second mic/ })).toBeVisible()

      await panel.getByRole('button', { name: /Second mic/ }).click()
      await expect(panel).toContainText('Second mic: e2e-tone.wav')
      await expect(panel).toContainText('+0.0 dB')
      await expect(panel.getByLabel('Duck under your voice')).not.toBeChecked()
      await expect(panel.getByRole('slider', { name: 'Threshold' })).toHaveCount(0)
      await expect(dipsFooter, 'Second mic defaults Duck off: no sidechaincompress, no dip, no footer').toHaveCount(0)
      await panel.getByRole('button', { name: /Remove/ }).click()

      await panel.getByRole('button', { name: /Game audio/ }).click()
      await expect(panel).toContainText('Game audio: e2e-tone.wav')
      await expect(panel).toContainText('-3.0 dB')
      await expect(panel.getByLabel('Duck under your voice')).toBeChecked()
      await expect(dipsFooter).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'audio-04-secondary.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  // T-126 (12): the second-track card squeezed itself. The gain readout ("-10.0 dB", eight characters of mono) was a `w-12` box and wrapped
  // to two lines at every window size; "✕ Remove" had no guard against the file name beside it, which is the one that should give; and the
  // four ducking sliders' label and readout were 1 px apart at 2560. A long file name is used on purpose (the name truncates, and a button
  // beside a short one is never squeezed), and the three widths are measured before anything fails, so one red names all of them.
  test('the second-track card draws its gain readout, its Remove button and its slider readouts whole, on one line and apart, at 1024, 1632 and 2560 (T-126 (12))', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('secondary-layout')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const longName = 'second-microphone-take-number-twelve-from-the-long-friday-stream.wav'
      const longFixture = path.join(studio.root, 'source', longName)
      copyFileSync(studio.fixture, longFixture)
      await stubOpenDialog(app, longFixture)
      const panel = window.locator(MULTITRACK)
      await panel.getByRole('button', { name: /Background music/ }).click()
      await expect(panel).toContainText('Background music: ')
      // T-127 (15): the name is cut with an ellipsis where the card is narrow; its whole self is the tooltip. The header's name too.
      const secondName = panel.locator('span.truncate').filter({ hasText: longName })
      await expect(secondName, 'the second track\'s name carries its full self as its title').toHaveAttribute('title', `Background music: ${longName}`)
      const headerName = window.locator('header span.truncate').filter({ hasText: /^e2e-tone\.wav$/ })
      await expect(headerName, 'the header\'s file name carries its full self as its title').toHaveAttribute('title', 'e2e-tone.wav')
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
        [{ width: 2560, height: 1200 }, '2560 px']
      ] as const) {
        await setWindowSize(app, window, size)
        const gain = panel.locator('span.font-mono').filter({ hasText: /^[+-]\d+\.\d dB$/ })
        await expect(gain, `the gain readout at ${where}`).toHaveCount(1)
        await check(() => expectOneLine(gain, `the gain readout at ${where}`))
        await check(() => expectControlsWhole(panel, gain, `the gain readout at ${where}`))
        const remove = panel.getByRole('button', { name: /Remove/ })
        await check(() => expectOneLine(remove, `the Remove button at ${where}`))
        await check(() => expectControlsWhole(panel, remove, `the Remove button at ${where}`))
        await check(() => expectOneLine(panel.locator('label span.font-mono'), `the ducking readouts at ${where}`))
        for (const name of ['Threshold', 'Ratio', 'Attack', 'Release']) {
          const gap = await panel.locator('label', { hasText: name }).first().evaluate((label) => {
            const left = label.querySelector('span.text-ink-muted')?.getBoundingClientRect()
            const right = label.querySelector('span.font-mono')?.getBoundingClientRect()
            return left && right ? right.left - left.right : -1
          })
          await check(async () => expect(gap, `the ${name} label and its readout are ${Math.round(gap)} px apart at ${where} (gap-2 keeps them 8)`).toBeGreaterThanOrEqual(7.5))
        }
      }
      expect(problems, 'the second-track card keeps its readouts and Remove whole, and its slider rows spaced, at every width').toEqual([])
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
        .toEqual(['Close this audio? Your cleanup settings will be discarded.'])
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
        'Close this audio? Your cleanup settings and 1 cut will be discarded.'
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

      // DISPOSITION: the Export button itself is NOT clicked HERE. It opens
      // dialog.showSaveDialog (a main-process OS dialog) and then runs a real
      // ffmpeg render; `runAudioExport` / `runAudioMux` are Layer 5's
      // (`npm run test:media`). What is asserted here is everything the user
      // can reach before that boundary. (T-84's two tests below stub the
      // dialog and click it, for the failure and cancel copy.)
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
      await expect(exportPanel.getByRole('button', { name: 'Show in folder' })).toHaveCount(0)
      // A source-less studio has no Export panel at all.
      await window.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(window.locator(EXPORT)).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a render that cannot be written says so in plain words and frees the button (T-84)', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('exportfail')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      // The save dialog is stubbed (the OS chooser itself stays HL); what it
      // returns is a path inside a folder that does not exist, so the REAL
      // ffmpeg job fails to open its output. Unlike the video side there is no
      // cheap "source vanished" here — the player holds the decoded file.
      await stubSaveDialog(app, path.join(studio.root, 'no-such-folder', 'out.mp3'))
      await exportButton.click()

      const FAILED =
        "Export failed. A file imagii needs isn't there. It may have been moved or deleted."
      await expect
        .poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] })
        .toContain(FAILED)
      const entries = await readToastEntries(window)
      // A failure IS an error toast (an icon beside it)…
      expect(entries.find((e) => e.text === FAILED)?.hasIcon).toBe(true)
      // …in plain words: none of ffmpeg's, none of the bridge's.
      expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
        /FFmpeg|exit|Error invoking remote method|No such file|\.mp3/
      )
      // The panel is free again, not stuck on "Exporting…".
      await expect(exportButton).toBeEnabled({ timeout: 30_000 })
      await expect(exportPanel.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
      expect(existsSync(path.join(studio.root, 'no-such-folder'))).toBe(false)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-126 (19): `ExportDialog.startExport` claimed "running" after the save dialog it awaits, so a double-click on Export opened TWO save
  // dialogs and ran two exports (executed in the built app). The dialog here answers after 300 ms, as a real one does: that is the window
  // the second press lands in. ExportPanel (Video Studio) has had the claim since T-125 (18).
  test('a double-click on Export opens ONE save dialog and writes ONE file (T-126 (19))', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('export-dblclick')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const out = path.join(studio.root, 'double.mp3')
      await app.evaluate(({ dialog }, picked) => {
        const g = globalThis as unknown as { __audioSaveOptions: unknown[] }
        g.__audioSaveOptions = []
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (_win: unknown, options: unknown) => {
          g.__audioSaveOptions.push(options)
          await new Promise((resolve) => setTimeout(resolve, 300))
          return { canceled: false, filePath: picked }
        }
      }, out)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await exportButton.dblclick()
      await expect.poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] }).toContain('Cleaned audio exported')
      await expect(exportButton).toBeEnabled({ timeout: 30_000 })
      expect(await readSaveOptions(app), 'one save dialog, not two').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Cleaned audio exported'), 'one "exported" toast').toHaveLength(1)
      expect(readdirSync(studio.root).filter((f) => /\.(mp3|wav|m4a|flac)$/i.test(f)).sort(), 'one file written').toEqual(['double.mp3'])
      expect((await probeFile(out)).codecs).toEqual(['mp3'])
    } finally {
      await closeStudio(studio)
    }
  })

  test('Cancel on a long render is a neutral toast in the panel\'s own words, and frees the button (T-84)', async () => {
    test.setTimeout(300_000)
    const studio = await openStudio('exportcancel')
    const { app, window } = studio
    try {
      const long = path.join(studio.root, 'source', 'long-tone.mp3')
      await makeLongMp3(long)
      await dropOnImporter(window, long, 'long-tone.mp3')
      await expect(playButton(window)).toBeEnabled({ timeout: 120_000 })

      // Loudness normalization is a TWO-pass render: an hour of audio spends
      // tens of seconds in the measure pass, which is the window Cancel needs.
      await window.locator(LEVELS).getByRole('checkbox').check()

      const out = path.join(studio.root, 'cancelled.mp3')
      await stubSaveDialog(app, out)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await exportButton.click()

      const cancel = exportPanel.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeVisible({ timeout: 30_000 })
      await expect(exportPanel.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
      await cancel.click()

      // Raised from ONE place — the export call's rejection — not also by the
      // Cancel handler (the old build toasted twice: a neutral line AND the
      // killed ffmpeg's message in red).
      const CANCELED = 'Audio export canceled.'
      await expect
        .poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] })
        .toContain(CANCELED)
      const entries = await readToastEntries(window)
      expect(entries.filter((e) => e.text === CANCELED)).toHaveLength(1)
      expect(entries.find((e) => e.text === CANCELED)?.hasIcon).toBe(false)
      expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
        /FFmpeg|\bexit\b|cancelled|imagii:cancelled|Error invoking remote method/i
      )
      // Freed, and nothing was written under a name that claims success.
      await expect(exportButton).toBeEnabled({ timeout: 30_000 })
      await expect(cancel).toHaveCount(0)
      expect(existsSync(out)).toBe(false)
      expect(entries.map((e) => e.text)).not.toContain('Cleaned audio exported')
    } finally {
      await closeStudio(studio)
    }
  })

  test('the AAC option asks for, and writes, a real .m4a (T-90)', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('aac')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const exportPanel = window.locator(EXPORT)
      const format = exportPanel.getByRole('combobox').first()

      // The option says what the file will be called.
      await expect(format.locator('option')).toHaveText(['MP3', 'WAV', 'FLAC', 'AAC (.m4a)'])
      await format.selectOption('aac')

      const out = path.join(studio.root, 'voice-cleaned.m4a')
      await stubRecordingSaveDialog(app, out)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 90_000, intervals: [250] })
        .toContain('Cleaned audio exported')

      // The save dialog was opened for .m4a — name, extension filter, all of it.
      const [opts] = await readSaveOptions(app)
      expect(opts?.defaultPath).toBe('e2e-tone-cleaned.m4a')
      expect(opts?.filters).toEqual([{ name: 'M4A', extensions: ['m4a'] }])

      // And what landed is an MP4-family audio file, not a raw ADTS stream.
      const facts = await probeFile(out)
      expect(facts.format).toContain('m4a')
      expect(facts.codecs).toEqual(['aac'])
      const head = readFileSync(out).subarray(4, 12).toString('latin1')
      expect(head).toBe('ftypM4A ')
      await expect(exportPanel.getByRole('button', { name: 'Show in folder' })).toBeVisible()
      // T-92: and pressing it reaches the shell with the file that was written.
      await stubShellReveal(app)
      await exportPanel.getByRole('button', { name: 'Show in folder' }).click()
      await expect
        .poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] })
        .toEqual([out])
    } finally {
      await closeStudio(studio)
    }
  })

  test('Re-attach to video exports a video with the cleaned sound, and says what it is doing (T-90)', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('reattach')
    const { app, window } = studio
    try {
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)
      await dropOnImporter(window, video, 'e2e-clip.mp4')
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      const exportPanel = window.locator(EXPORT)

      // Nothing is cut yet, so there is nothing extra to warn about.
      await expect(exportPanel).not.toContainText('re-encodes the video')
      await dragCut(window, 0.2, 0.4)
      await expect(cutChips(window)).toHaveCount(1)
      await expect(exportPanel).toContainText(
        'Parts you removed come out of the picture too, so imagii re-encodes the video to match. ' +
          'That takes longer than attaching the sound alone.'
      )

      const out = path.join(studio.root, 'e2e-clip-cleaned.mp4')
      await stubRecordingSaveDialog(app, out)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      // The bar names the phase in words, never the pass id.
      await expect(exportPanel).not.toContainText(/\b(measure|render|mux)\b/)
      // T-124 (20): the toast carries buttons now, so its text is the sentence and then their names.
      await expect
        .poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] })
        .toEqual(expect.arrayContaining([expect.stringContaining('Cleaned audio attached to the video')]))

      // The save dialog was opened for an .mp4 — this used to throw before the
      // dialog could open at all (the validator did not know the format).
      const [opts] = await readSaveOptions(app)
      expect(opts?.defaultPath).toBe('e2e-clip-cleaned.mp4')
      expect(opts?.filters).toEqual([{ name: 'MP4', extensions: ['mp4'] }])

      const facts = await probeFile(out)
      expect(facts.codecs.sort()).toEqual(['aac', 'h264'])
      // The removed part came out of the picture AND the sound: shorter than
      // the 3 s source by about the 0.6 s that was marked.
      expect(facts.duration).toBeLessThan(2.9)
      expect(facts.duration).toBeGreaterThan(1.8)
      // T-100: a re-attach is two passes (render, then put it on the picture),
      // and the row says which one it ended on.
      await expect(exportPanel).toContainText('Step 2 of 2 — attaching to video')
    } finally {
      await closeStudio(studio)
    }
  })

  // T-125 (7): .aiff, .aif and .wma are audio WebAudio cannot decode, so the importer pulls their sound through the extraction a
  // video's takes - and the studio then called them VIDEOS: Export defaulted to "Re-attach to video" (checked) and failed on
  // `-map 0:v:0` because there is no picture, the file was suggested a name from the scratch WAV, and a project stored the scratch
  // path's cousin. A WMA loaded and exported is the case: the checkbox is not there, the name is the WMA's, the file is written.
  test('a WMA loads and exports as the sound file it is: no "Re-attach to video", named for the WMA, written (T-125 (7))', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('wma')
    const { app, window } = studio
    try {
      const wma = path.join(studio.root, 'source', 'take one.wma')
      const made = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '44100', '-ac', '2', wma])
      if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)
      await dropOnImporter(window, wma, 'take one.wma')
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      // The header names the file the person dropped, not the scratch WAV the studio plays.
      await expect(window.locator('header').getByText('take one.wma', { exact: true })).toBeVisible()

      const exportPanel = window.locator(EXPORT)
      // A sound-only file has no picture to re-attach to: the option is not offered, and nothing says "video".
      await expect(exportPanel.getByRole('checkbox')).toHaveCount(0)
      await expect(exportPanel).not.toContainText(/re-attach|video/i)

      const out = path.join(studio.root, 'take one-cleaned.mp3')
      await stubRecordingSaveDialog(app, out)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] })
        .toEqual(expect.arrayContaining([expect.stringContaining('Cleaned audio exported')]))
      const [opts] = await readSaveOptions(app)
      expect(opts?.defaultPath, 'named for the WMA, not for the scratch WAV').toBe('take one-cleaned.mp3')
      const facts = await probeFile(out)
      expect(facts.codecs).toEqual(['mp3'])
      expect(facts.duration).toBeGreaterThan(1.5)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-124 (20): the re-attach toast was a dead end. Every other finished file in the app says where it is and what to do next
  // (Record's take, Reframe's 9:16 file); this one said "Cleaned audio attached to the video" and left the person to find the .mp4
  // in a folder and drag it into Video Studio by hand - the very next step of the order the guide recommends (clean the sound,
  // THEN clip). The new button is on the re-attached video only: an audio-only export has nothing for Video Studio to open.
  test('the re-attach toast names the file, shows it in its folder, and opens it in Video Studio; an audio-only export offers no video to open (T-124 (20))', async () => {
    test.setTimeout(300_000)
    const studio = await openStudio('reattach-next')
    const { app, window } = studio
    try {
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)
      await dropOnImporter(window, video, 'e2e-clip.mp4')
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      const exportPanel = window.locator(EXPORT)
      const toaster = window.locator('[data-rht-toaster]')

      // ── the audio-only export first: no video to open, so the toast has no such button ──
      await exportPanel.getByRole('checkbox').uncheck()
      await exportPanel.getByRole('combobox').first().selectOption('wav')
      const wav = path.join(studio.root, 'e2e-clip-cleaned.wav')
      await stubRecordingSaveDialog(app, wav)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      // (`toContain` on the log is an EXACT entry: the sentence and nothing after it, so no button text rides along.)
      await expect
        .poll(() => readToastLog(window), { timeout: 120_000, intervals: [250] })
        .toContain('Cleaned audio exported')
      await expect(toaster.getByRole('button', { name: 'Edit in Video Studio' })).toHaveCount(0)

      // ── the re-attach: the same two buttons Record's saved take has ──
      await expect(toaster).toHaveCount(1)
      await window.waitForTimeout(500)
      await exportPanel.getByRole('checkbox').check()
      const out = path.join(studio.root, 'e2e-clip-cleaned.mp4')
      await stubRecordingSaveDialog(app, out)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const edit = toaster.getByRole('button', { name: 'Edit in Video Studio', exact: true })
      await expect(edit, 'the saved toast carries the action').toBeVisible({ timeout: 120_000 })
      await expect(toaster.getByText('Cleaned audio attached to the video')).toBeVisible()

      // Show in folder reaches the shell with the file that was written.
      await stubShellReveal(app)
      await toaster.getByRole('button', { name: 'Show in folder', exact: true }).click()
      await expect.poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] }).toEqual([out])

      // Edit in Video Studio opens THAT file there: the route, the header and the player.
      await edit.click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('header').getByText('e2e-clip-cleaned.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('video')).toHaveCount(1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a preset that cannot be saved or deleted says so in plain words (T-90)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('presetfail')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const presets = window.locator('.card').filter({ hasText: 'Cleanup presets' })
      const presetDir = path.join(studio.userDataDir, 'audio-presets')

      // A preset that saves fine, so there is one to fail to delete.
      await presets.getByPlaceholder('My mic preset').fill('Keeper')
      await presets.getByRole('button', { name: 'Save current' }).click()
      await expect(presets.getByText('Keeper')).toBeVisible()

      // Main's handlers now fail the way a full disk does. The renderer's own
      // catch is the thing under test, so the rejection is the real shape
      // (Electron wraps a handler's throw in the "Error invoking remote
      // method" envelope), produced by replacing the handler in MAIN.
      await app.evaluate(({ ipcMain }) => {
        for (const channel of ['audio:savePreset', 'audio:deletePreset']) {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, () => {
            throw new Error('ENOSPC: no space left on device, write')
          })
        }
      })

      await presets.getByPlaceholder('My mic preset').fill('Doomed')
      await presets.getByRole('button', { name: 'Save current' }).click()
      const SAVE_FAILED =
        "Couldn't save that preset. Your disk is full. Free up some space and try again."
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain(SAVE_FAILED)
      // The name stays in the box so the user can try again, and nothing says "Saved".
      await expect(presets.getByPlaceholder('My mic preset')).toHaveValue('Doomed')
      expect(await readToastLog(window)).not.toContain('Saved "Doomed"')

      await presets.locator('li').filter({ hasText: 'Keeper' }).getByRole('button', { name: 'Delete preset' }).click()
      const DELETE_FAILED =
        "Couldn't delete that preset. Your disk is full. Free up some space and try again."
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain(DELETE_FAILED)
      // Both are errors (an icon beside them), in words with no channel names.
      const entries = await readToastEntries(window)
      expect(entries.find((e) => e.text === SAVE_FAILED)?.hasIcon).toBe(true)
      expect(entries.map((e) => e.text).join(' | ')).not.toMatch(
        /Error invoking remote method|audio:savePreset|ENOSPC/
      )
      // The preset that was already there is still listed and still on disk.
      await expect(presets.getByText('Keeper')).toBeVisible()
      expect(readdirSync(presetDir)).toHaveLength(1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a preset an older build saved with cut times and a music file applies its cleanup and nothing else (T-90)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('oldpreset')
    const { window } = studio
    try {
      // The file exactly as a pre-T-90 build wrote it: the WHOLE chain, last
      // Monday's cut and last Monday's music included.
      const presetDir = path.join(studio.userDataDir, 'audio-presets')
      mkdirSync(presetDir, { recursive: true })
      writeFileSync(
        path.join(presetDir, 'old1.json'),
        JSON.stringify({
          id: 'old1',
          name: 'Monday mic',
          createdAt: 1,
          chain: {
            denoise: 'aggressive',
            hum60: true,
            rumbleHighpass: true,
            deEss: false,
            compressor: 'mixed',
            loudnorm: true,
            loudnormTargetLufs: -14,
            gainDb: 0,
            cutRegions: [{ startSec: 0.5, endSec: 1.5 }],
            secondaryTrack: {
              filePath: studio.fixture,
              fileName: 'monday-music.wav',
              role: 'music',
              gainDb: -10,
              duckUnderPrimary: true
            }
          }
        }),
        'utf8'
      )
      await dropAndWaitReady(studio)
      const presets = window.locator('.card').filter({ hasText: 'Cleanup presets' })
      await expect(presets.getByText('Monday mic')).toBeVisible()
      await expect(cutChips(window)).toHaveCount(0)

      await presets.locator('li').filter({ hasText: 'Monday mic' }).getByRole('button', { name: 'Apply' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Applied "Monday mic"')

      // The cleanup arrived…
      const cleanup = window.locator(CLEANUP)
      const levels = window.locator(LEVELS)
      await expectSelected(cleanup.getByRole('button', { name: 'Aggressive', exact: true }))
      await expect(cleanup.getByLabel('Hum removal (60 Hz mains)')).toBeChecked()
      await expectSelected(levels.getByRole('button', { name: 'Mixed', exact: true }))
      await expect(levels.getByLabel('Loudness target (LUFS)')).toHaveValue('-14')
      // …and last Monday's cut and music did not.
      await expect(cutChips(window)).toHaveCount(0)
      await expect(window.locator(WAVEFORM)).toContainText('Drag across the waveform')
      await expect(window.locator(MULTITRACK)).toContainText('Layer in background music')
      await expect(window.locator(MULTITRACK)).not.toContainText('monday-music.wav')
    } finally {
      await closeStudio(studio)
    }
  })

  test('the Export row names its steps, and says Failed or Canceled after the toast fades (T-100)', async () => {
    test.setTimeout(120_000)
    // Loudness normalization is two passes and each reports its own 0-100%, so
    // the bar went to 100 and then back to 0 under a different word — a stall,
    // to anyone who had not read the code. And a render that stopped left a
    // bar and a percentage and nothing to say which kind of stop it was once
    // the toast was gone. The job is driven from MAIN (audio:export replaced by
    // one the test holds), so the events arrive on the real channel in an order
    // the test chooses, instead of racing a render that takes milliseconds.
    const studio = await openStudio('exportrow')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      await window.locator(LEVELS).getByRole('checkbox').check() // two passes
      await stubSaveDialog(app, path.join(studio.root, 'row.mp3'))
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as {
          __audioJob: { jobId: string; fail: (message: string) => void }
        }
        g.__audioJob = { jobId: '', fail: () => undefined }
        ipcMain.removeHandler('audio:export')
        ipcMain.handle(
          'audio:export',
          (_e, spec: { jobId: string }) =>
            new Promise((_resolve, reject) => {
              g.__audioJob = { jobId: spec.jobId, fail: (m) => reject(new Error(m)) }
            })
        )
      })
      const jobId = (): Promise<string> =>
        app.evaluate(() => (globalThis as unknown as { __audioJob: { jobId: string } }).__audioJob.jobId)
      const progress = (pass: string, percent: number): Promise<void> =>
        app.evaluate(
          ({ BrowserWindow }, p) => {
            const g = globalThis as unknown as { __audioJob: { jobId: string } }
            BrowserWindow.getAllWindows()[0]?.webContents.send('audio:progress', {
              jobId: g.__audioJob.jobId,
              ...p
            })
          },
          { pass, percent }
        )
      const stop = (message: string): Promise<void> =>
        app.evaluate((_e, m) => {
          ;(globalThis as unknown as { __audioJob: { fail: (m: string) => void } }).__audioJob.fail(m)
        }, message)
      const exportPanel = window.locator(EXPORT)
      const row = exportPanel.locator('.flex.items-center.gap-3.text-sm')
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      // ── the two passes read as Step 1 of 2 and Step 2 of 2 ──
      await exportButton.click()
      await expect.poll(jobId, { timeout: 15_000 }).not.toBe('')
      await expect(row).toContainText('Step 1 of 2 — measuring loudness')
      // T-112: the bar is a progressbar to a screen reader, named by the pass, with its number.
      const bar = exportPanel.getByRole('progressbar')
      await expect(bar).toHaveAccessibleName('Step 1 of 2 — measuring loudness')
      await expect(bar).toHaveAttribute('aria-valuemin', '0')
      await expect(bar).toHaveAttribute('aria-valuemax', '100')
      await progress('measure', 60)
      await expect(row).toContainText('60%')
      await expect(bar).toHaveAttribute('aria-valuenow', '60')
      await progress('measure', 100)
      await progress('render', 20)
      // The bar went back to 20%, and the words say it is the next step.
      await expect(row).toContainText('Step 2 of 2 — rendering')
      await expect(row).toContainText('20%')
      await expect(row).not.toContainText('Step 1 of 2')
      await expect(bar).toHaveAccessibleName('Step 2 of 2 — rendering')
      await expect(bar).toHaveAttribute('aria-valuenow', '20')
      await expect(row).not.toContainText(/Failed|Canceled/)

      // ── a failure: the words outlive the toast, and the bar is red ──
      await stop('FFmpeg exit 1: Conversion failed!')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toEqual(expect.arrayContaining([expect.stringContaining('Export failed.')]))
      await expect(row.getByText('Failed', { exact: true })).toBeVisible()
      await expect(row.getByText('Canceled', { exact: true })).toHaveCount(0)
      await expect(row.locator('.bg-danger-strong')).toHaveCount(1)
      await expect(row).toContainText('Step 2 of 2 — rendering')
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, {
        timeout: 30_000
      })
      await expect(row.getByText('Failed', { exact: true })).toBeVisible()

      // ── a cancel: the same row, a different word and NO danger red ──
      const firstJob = await jobId()
      await exportButton.click()
      await expect.poll(jobId, { timeout: 15_000 }).not.toBe(firstJob)
      // A new run starts clean: no word from the last one.
      await expect(row.getByText('Failed', { exact: true })).toHaveCount(0)
      await progress('measure', 40)
      await stop('imagii:cancelled')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Audio export canceled.')
      await expect(row.getByText('Canceled', { exact: true })).toBeVisible()
      await expect(row.getByText('Failed', { exact: true })).toHaveCount(0)
      await expect(row.locator('.bg-danger-strong')).toHaveCount(0)
      await expect(row.locator('.bg-ink-muted')).toHaveCount(1)
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, {
        timeout: 30_000
      })
      await expect(row.getByText('Canceled', { exact: true })).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })

  test('Cancel in the render pass leaves no half-written file (T-100)', async () => {
    test.setTimeout(300_000)
    // The existing cancel test stops the MEASURE pass, which writes nothing. The
    // render pass opens the output file on its first frame, so a Cancel there
    // left an unplayable .mp3 at the name the user chose in the Save dialog,
    // beside a toast that said it was canceled. Aggressive noise removal keeps
    // an hour of audio rendering for minutes.
    const studio = await openStudio('rendercancel')
    const { app, window } = studio
    try {
      const long = path.join(studio.root, 'source', 'long-tone.mp3')
      await makeLongMp3(long)
      await dropOnImporter(window, long, 'long-tone.mp3')
      await expect(playButton(window)).toBeEnabled({ timeout: 120_000 })
      await window
        .locator(CLEANUP)
        .getByRole('button', { name: 'Aggressive', exact: true })
        .click()

      const out = path.join(studio.root, 'rendered.mp3')
      await stubSaveDialog(app, out)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      await expect.poll(() => existsSync(out), { timeout: 60_000, intervals: [250] }).toBe(true)
      await expect(exportPanel).toContainText('Rendering…') // one pass: no steps to count

      await exportPanel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] })
        .toContain('Audio export canceled.')
      await expect(exportPanel.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      expect(existsSync(out), 'the half-written audio is gone').toBe(false)
      await expect(exportPanel.getByText('Canceled', { exact: true })).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })

  test('a sound extracted from a video survives its scratch file: save, prune, relaunch, open (T-99)', async () => {
    test.setTimeout(300_000)
    // Dropping a video extracts its sound to a WAV in %TEMP%/imagii-audio, and
    // the project that was saved next stored THAT path. The next launch deletes
    // old scratch files, so "Open project" said "Couldn't find aB3dE5fG7h.wav"
    // — a name the user never chose — with the video it came from sitting in the
    // same project. The project now stores the video and re-extracts on open.
    const studio = await openStudio('t99')
    let second: ElectronApplication | null = null
    try {
      const { app, window } = studio
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)
      const scratch = path.join(os.tmpdir(), 'imagii-audio')
      const before = new Set(existsSync(scratch) ? readdirSync(scratch) : [])
      await dropOnImporter(window, video, 'e2e-clip.mp4')
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      const extracted = readdirSync(scratch).filter((f) => !before.has(f))
      expect(extracted, 'one scratch WAV was made').toHaveLength(1)
      const wav = path.join(scratch, extracted[0] as string)

      // ── save from Home ──
      const projectFile = path.join(studio.root, 'saved.imagii.json')
      await stubSaveDialog(app, projectFile)
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Save project' }).click()
      await expect.poll(() => existsSync(projectFile), { timeout: 15_000 }).toBe(true)
      const saved = JSON.parse(readFileSync(projectFile, 'utf8')) as {
        schemaVersion: number
        audioStudio: { sourcePath: string; extractedFromVideo?: boolean; fromVideoPath?: string }
      }
      // The file names the VIDEO, says the sound is extracted, and holds no
      // path into the temp folder anywhere.
      expect(saved.audioStudio.sourcePath).toBe(video)
      expect(saved.audioStudio.extractedFromVideo).toBe(true)
      expect(readFileSync(projectFile, 'utf8')).not.toContain('imagii-audio')
      expect(readFileSync(projectFile, 'utf8')).not.toContain(path.basename(wav))

      // ── the next launch: the scratch WAV is gone ──
      await app.close()
      rmSync(wav)
      const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
      second = await electron.launch({
        args: [mainEntry, `--user-data-dir=${studio.userDataDir}`],
        env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
      })
      const window2 = await second.firstWindow()
      await window2.waitForLoadState('domcontentloaded')
      await expect(window2.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
      await installToastLog(window2)
      await stubOpenDialog(second, projectFile)
      await window2.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(() => readToastLog(window2), { timeout: 60_000, intervals: [250] })
        .toContain('Project loaded')
      expect((await readToastLog(window2)).join(' | ')).not.toMatch(/Couldn't find/)

      // The audio is back: loaded, playable, still a sound from a video.
      await window2.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(playButton(window2)).toBeEnabled({ timeout: 60_000 })
      await expect(window2.locator(EXPORT).getByRole('checkbox')).toBeChecked() // Re-attach to video
      // The header still names the video, though the WAV under it has a new random name (T-108).
      await expect(window2.locator('header').getByText('e2e-clip.mp4', { exact: true })).toBeVisible()
      expect(existsSync(wav), 'the old scratch file was not needed').toBe(false)
      expect(
        readdirSync(scratch).filter((f) => !before.has(f)),
        'it was extracted again, under a new name'
      ).toHaveLength(1)

      // ── and a video that has moved is named, plainly, as the file that is gone ──
      rmSync(video)
      await window2.getByRole('link', { name: 'Home' }).click()
      await window2.getByRole('button', { name: 'Open project' }).click()
      const GONE =
        "Couldn't find e2e-clip.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the audio again in Audio Studio.'
      await expect
        .poll(() => readToastLog(window2), { timeout: 60_000, intervals: [250] })
        .toContain(GONE)
    } finally {
      try {
        await second?.close()
      } catch {
        /* ignore */
      }
      // The first app was closed on purpose (the relaunch), so closing it again
      // is the one close that may refuse; the scratch folder goes either way.
      try {
        await closeStudio(studio)
      } catch {
        rmSync(studio.root, { recursive: true, force: true })
      }
    }
  })

  test('a project saved before the marker, whose scratch WAV was already pruned, is recovered from the video it names (T-107)', async () => {
    test.setTimeout(300_000)
    // Schema 3 and older wrote the scratch WAV as the audio source and the video beside it
    // (`fromVideoPath`). Once a launch had pruned the WAV, "Open project" said "Couldn't
    // find aB3dE5fG7h.wav" and the sound was lost with the video still on disk. The file
    // carries the video, so it is extracted again from that; and if the VIDEO is what is
    // gone, that is the file named.
    const studio = await openStudio('t107v3')
    try {
      const { app, window } = studio
      const video = path.join(studio.root, 'source', 'e2e-clip.mp4')
      await makeFixtureMp4(video)
      const deadWav = path.join(os.tmpdir(), 'imagii-audio', 'aB3dE5fG7h.wav')
      expect(existsSync(deadWav), 'the scratch WAV the old file names is gone').toBe(false)
      const projectFile = path.join(studio.root, 'old-v3.imagii.json')
      writeFileSync(
        projectFile,
        JSON.stringify({
          schemaVersion: 3,
          savedAt: Date.now(),
          appVersion: '1.0.0',
          audioStudio: { sourcePath: deadWav, fromVideoPath: video, chain: DEFAULT_CHAIN_SPEC }
        }),
        'utf8'
      )

      await stubOpenDialog(app, projectFile)
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Open project' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] })
        .toContain('Project loaded')
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/Couldn't find/)

      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(playButton(window)).toBeEnabled({ timeout: 60_000 })
      await expect(window.locator('header').getByText('e2e-clip.mp4', { exact: true })).toBeVisible()
      await expect(window.locator(EXPORT).getByRole('checkbox')).toBeChecked() // Re-attach to video

      // ── and with the video gone too, it is the VIDEO that is named ──
      rmSync(video)
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Open project' }).click()
      const GONE =
        "Couldn't find e2e-clip.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the audio again in Audio Studio.'
      await expect
        .poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] })
        .toContain(GONE)
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('T-131: review-gate fixes, sweep 17 (Audio Studio)', () => {
  // (4) The wizard replaces its answer buttons with the next question's, in the same place, so the second press of a double-click answered
  // the next question too ("Quick fix 3 of 3" from one double-click, executed). A repeat is not a new answer (T-120's held Enter, for clicks).
  test('a double-click on a Fix wizard answer answers ONE question, at every step (T-131 (4))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('wizard-dblclick')
    const { window } = studio
    try {
      await dropAndWaitReady(studio)
      await window.locator(FIXWIZARD).getByRole('button', { name: 'Help me fix this' }).click()
      const dialog = window.getByRole('dialog')
      await expect(dialog).toContainText('Quick fix · 1 of 3')

      await dialog.getByRole('button', { name: 'A little' }).dblclick()
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await window.waitForTimeout(400)
      await expect(dialog, 'the second press did not answer question 2').toContainText('Quick fix · 2 of 3')
      await expect(dialog).toContainText('Does the room sound echoy or hollow?')

      await dialog.getByRole('button', { name: 'Sounds dry' }).dblclick()
      await expect(dialog).toContainText('Quick fix · 3 of 3')
      await window.waitForTimeout(400)
      await expect(dialog, 'nor question 3').toContainText('Quick fix · 3 of 3')
      await expect(dialog).toContainText('What is this clip mostly?')

      await dialog.getByRole('button', { name: 'Talking / voice' }).dblclick()
      await expect(dialog).toContainText('Ready to apply')
      await window.waitForTimeout(400)
      // The summary is still up and nothing was applied by the second press.
      await expect(dialog, 'the summary waits for Apply').toContainText('Ready to apply')
      expect(await readToastLog(window), 'nothing was applied').not.toContain(
        'Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.'
      )
      // A person who presses once, at their own pace, still gets every answer: the rule is about the repeat, not the speed.
      await dialog.getByRole('button', { name: 'Start over' }).click()
      await dialog.getByRole('button', { name: 'None to speak of' }).click()
      await expect(dialog).toContainText('Quick fix · 2 of 3')
      await dialog.getByRole('button', { name: 'Sounds dry' }).click()
      await expect(dialog).toContainText('Quick fix · 3 of 3')
    } finally {
      await closeStudio(studio)
    }
  })

  // (5) Audio Studio's two pickers: the importer's "Choose file…" and the second-track role buttons. Each goes straight to a native chooser,
  // which the stand-in answers after 300 ms, as a real one does; the second press of the double-click lands in that window.
  test('a double-click on "Choose file…" opens ONE chooser and loads the file once (T-131 (5))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('importer-dblclick')
    const { app, window } = studio
    try {
      await recordSlowChooser(app, { files: [studio.fixture, studio.fixture], delayMs: 300 })
      await window.getByRole('button', { name: 'Choose file…' }).dblclick()
      await expect(playButton(window)).toBeEnabled({ timeout: 30_000 })
      await window.waitForTimeout(800)
      expect(await chooserCalls(app), 'one chooser, not two').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Loaded'), 'loaded once').toHaveLength(1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a double-click on a second-track role button opens ONE chooser and adds the track once (T-131 (5))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('role-dblclick')
    const { app, window } = studio
    try {
      await dropAndWaitReady(studio)
      const panel = window.locator(MULTITRACK)
      await recordSlowChooser(app, { files: [studio.fixture, studio.fixture], delayMs: 300 })
      await panel.getByRole('button', { name: /Background music/ }).dblclick()
      await expect(panel).toContainText('Background music: e2e-tone.wav')
      await window.waitForTimeout(800)
      expect(await chooserCalls(app), 'one chooser, not two').toHaveLength(1)
      expect((await readToastLog(window)).filter((t) => t === 'Background music added'), 'added once, not replaced by a second answer').toHaveLength(1)
    } finally {
      await closeStudio(studio)
    }
  })
})
