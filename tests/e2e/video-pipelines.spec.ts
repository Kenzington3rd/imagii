import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { installToastLog, readToastEntries, readToastLog } from './toastLog'

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
 *
 * ── Timeouts ──────────────────────────────────────────────────────────
 *
 * Every test that spawns an ffmpeg job takes 600 s, and the polls that wait
 * for its bytes take 540 s. That is 50-100x what those jobs need on an idle
 * box (the whole file runs in ~70 s), and deliberately so: this runner hosts
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
/** Real duration of longSrc, read back from ffprobe after the loop. */
let longSeconds = 0

interface ProbeStream {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  display_aspect_ratio?: string
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

function pipCard(window: Page): Locator {
  return window.locator('.card').filter({ hasText: 'Picture-in-picture composite' })
}

function postCard(window: Page): Locator {
  return cardWithButton(window, 'Suggest 4 titles')
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

/** Same bed, no spike — every bucket sits under the threshold of 5. */
function chatLogWithNoSpike(): string {
  const lines: string[] = []
  for (const t of [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77]) {
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
  await ffmpeg(['-y', '-stream_loop', '79', '-i', loopBase, '-c', 'copy', longSrc])
  longSeconds = Number((await ffprobeJson(longSrc)).format?.duration ?? 0)
  expect(longSeconds).toBeGreaterThan(600)
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
  test('finds the spike a pasted log actually contains, and + clip lands the padded range in the Clips list', async () => {
    test.setTimeout(120_000)
    // longSrc (20 min) rather than the 2 s export fixture: addPeak clamps
    // the padded range to the SOURCE duration, so on a short source this
    // log's peaks fall outside the video entirely and are refused (the
    // T-48 case, covered by the next test).
    const { app, window } = await launchWithVideo('chat', longSrc)
    try {
      const card = chatCard(window)
      await expect(card.getByText('Chat highlight reel')).toBeVisible()
      // Nothing rendered before an analysis: no peak rows, no + clip.
      await expect(card.locator('li')).toHaveCount(0)

      await card.locator('textarea').fill(chatLogWithOneSpike())
      await card.getByRole('button', { name: 'Find chat spikes' }).click()

      // ── one peak, with the numbers the log's density dictates ──
      await expect(card.locator('li')).toHaveCount(1)
      await expectToast(window, 'Found 1 hype moments')
      const row = card.locator('li').first()
      // bucketStart 30 s, minus the 15 s pad = 0:15. The count is the
      // spike bucket's own size, and the preview is its first 3 messages.
      await expect(row.locator('span.font-mono')).toHaveText('0:15')
      await expect(row.getByText('9 msgs')).toBeVisible()
      await expect(row).toContainText('POG that was insane · POG that was insane')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-01-chat-peaks.png') })

      // ── + clip: a real clip, with the padded range, in the store ──
      // T-94: the scanner's FIRST clip retires the untouched whole-video
      // "Clip 1" (the dedicated tests below drive that end to end), so the
      // list goes from the one default clip to the one excerpt.
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await row.getByRole('button', { name: '+ clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await expectToast(window, 'Clip added')
      // start = bucketStart (15), end = bucketStart + bucket + 2 * pad = 55.
      expect(await clipRows(window)).toEqual([{ name: 'Chat hype 1', range: '0:15 → 0:55' }])

      // ── the two number inputs change the arithmetic, not just the UI ──
      // Pad 15 -> 0 moves the peak's start from 0:15 to the bucket itself.
      await card.getByRole('spinbutton').nth(1).fill('0')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:30')
      await expect(card.locator('li').first().getByText('9 msgs')).toBeVisible()

      // Bucket 10 -> 5 splits the 9-message spike across two 5 s buckets;
      // only the first still clears the threshold, so the count drops to 5.
      await card.getByRole('spinbutton').first().fill('5')
      await card.getByRole('button', { name: 'Find chat spikes' }).click()
      await expect(card.locator('li').first().getByText('5 msgs')).toBeVisible()
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:30')

      // And the re-run's + clip uses the NEW numbers: 30 -> 30 + 5 + 0. By now
      // there is no whole-video clip left to retire, so this one just adds.
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window))[1]).toEqual({
        name: 'Chat hype 1',
        range: '0:30 → 0:35'
      })
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
        'No timestamped messages found. Each line should start like [12:34] username: msg'
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
      await expectToast(window, 'No chat spikes detected.')
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
      // The peak itself is real: 0:15, past the end of this 2 s source.
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:15')
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
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
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:00')
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expectToast(window, 'Clip added')
      // T-94: it replaced the untouched whole-video clip (also 0:00 → 0:02 on
      // this 2 s source, which is why the NAME is what tells them apart).
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Chat hype 1', range: '0:00 → 0:02' }])
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
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expectToast(
        window,
        'Removed the whole-video clip — the highlights are your clips now. Press Ctrl+Z to keep it.'
      )
      await expect(list.locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Clip 2', 'Chat hype 1'])

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
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expectToast(window, 'Clip added')
      await expect(list.locator('h3')).toHaveText('Clips (2)')
      expect((await clipRows(window)).map((r) => r.name)).toEqual(['Whole stream', 'Chat hype 1'])
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
      await expectToast(window, 'Found 1 candidates')
      // Re-scan is the button's post-scan identity.
      await expect(card.getByRole('button', { name: 'Re-scan' })).toBeVisible()

      // The fixture's burst is at 6.0-7.5 s and candidates are padded by
      // 5 s, so the window brackets it without swallowing the whole 14 s.
      const row = card.locator('li').first()
      await expect(row.locator('span.font-mono').first()).toHaveText('0:01 → 0:12')
      // Combined score with no chat = audio (saturated at 1) x 0.4.
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('40')
      await expect(row).toContainText('loud audio peak')

      // ── SignalBars: three of them, and only audio has fired ──
      const bars = row.locator('div[title$="%"]')
      await expect(bars).toHaveCount(3)
      await expect(bars.nth(0)).toHaveAttribute('title', 'Audio: 100%')
      await expect(bars.nth(1)).toHaveAttribute('title', 'Chat: 0%')
      await expect(bars.nth(2)).toHaveAttribute('title', 'Hype: 0%')
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
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('40')

      // ── disclosure opens the textarea ──
      await card.getByRole('button', { name: 'Add chat log (optional)' }).click()
      const textarea = card.locator('textarea')
      await expect(textarea).toHaveCount(1)

      // ── debounce: the score does not move on the first keystrokes ──
      // fill() sets the value in one event, so watch the 300 ms window
      // directly: immediately after the input the panel still shows the
      // audio-only score, and only the debounced value triggers a rescore.
      await textarea.fill(chatLogOverBurst())
      expect(await row.getByTitle('Combined score (0–100)').innerText()).toBe('40')

      // ── after the debounce every signal is in ──
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('100', { timeout: 5_000 })
      const bars = row.locator('div[title$="%"]')
      await expect(bars.nth(1)).toHaveAttribute('title', 'Chat: 100%')
      await expect(bars.nth(2)).toHaveAttribute('title', 'Hype: 100%')
      await expect(row).toContainText('loud audio peak · chat spike · hype keywords')
      // The messages that earned it are quoted back.
      await expect(row).toContainText('POGGERS no way')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-03-rescored.png') })

      // ── collapsing hides the input without discarding the score ──
      await card.getByRole('button', { name: 'Add chat log (optional)' }).click()
      await expect(card.locator('textarea')).toHaveCount(0)
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('100')

      // Clearing the log takes the chat signals back out.
      await card.getByRole('button', { name: 'Add chat log (optional)' }).click()
      await card.locator('textarea').fill('')
      await expect(row.getByTitle('Combined score (0–100)')).toHaveText('40', { timeout: 5_000 })
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
    const { app, window } = await launchWithVideo('captions')
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
      await expect(paths.nth(0)).toHaveText(/whisper\.exe$/)
      await expect(paths.nth(1)).toHaveText(/ggml-base\.en\.bin$/)
      // Both shell shortcuts and both doc links are rendered (their OS side
      // is dispositioned; what is asserted is that they exist and are
      // reachable from this branch).
      await expect(card.getByRole('button', { name: 'open folder' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Show models folder' })).toBeVisible()
      await expect(card.getByRole('link', { name: 'whisper.cpp releases' })).toBeVisible()
      await expect(card.getByRole('link', { name: 'Hugging Face' })).toBeVisible()
      // The model is missing, so the auto-install offer is visible. It is
      // NOT clicked — see DISPOSITIONS (141 MB, network, local-first).
      await expect(
        card.getByRole('button', { name: /Download model \(~141 MB\) automatically/ })
      ).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-04-captions-setup.png') })

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
        expect.arrayContaining([expect.stringContaining('Captioned')])
      )

      // With no srtPath the whole style + output subtree stays unmounted.
      await expect(card.getByRole('button', { name: 'Save .srt' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Burn into video' })).toHaveCount(0)
      await expect(card.getByRole('slider', { name: 'Caption font size in pixels' })).toHaveCount(0)
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
      const fontSlider = card.getByRole('slider', { name: 'Caption font size in pixels' })
      const position = card.locator('select')
      const colors = card.locator('input[type="color"]')
      // The subtree only exists because srtPath survived the project load.
      await expect(fontSlider).toBeVisible()
      await expect(fontSlider).toHaveValue('32')
      await expect(position).toHaveValue('bottom')
      await expect(colors.nth(0)).toHaveValue('#ffffff')
      await expect(colors.nth(1)).toHaveValue('#000000')

      // ── the four style presets, each a complete CaptionStyle ──
      await card.getByRole('button', { name: 'TikTok bold' }).click()
      await expect(fontSlider).toHaveValue('56')
      await card.getByRole('button', { name: 'Reels minimal' }).click()
      await expect(fontSlider).toHaveValue('28')
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
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-05-caption-style.png') })

      // ── Save .srt: a real copy through the main process's confinement
      //    check, landing on disk where the (stubbed) chooser said ──
      expect(existsSync(savedSrt)).toBe(false)
      await card.getByRole('button', { name: 'Save .srt' }).click()
      await expectToast(window, 'SRT saved')
      expect(existsSync(savedSrt)).toBe(true)
      expect(readFileSync(savedSrt, 'utf8')).toBe(readFileSync(srtPath, 'utf8'))

      // Burn-in is NOT clicked — see DISPOSITIONS (Layer 5 owns runBurnIn).
      await expect(card.getByRole('button', { name: 'Burn into video' })).toBeEnabled()
    } finally {
      await app.close()
    }
  })
})

// ═════════════════════════════ ExportPanel (4t) ════════════════════════════

/** One platform checkbox in the Export panel's grid. */
function presetBox(window: Page, label: string): Locator {
  return exportCard(window).locator('label').filter({ hasText: label }).getByRole('checkbox')
}

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
      await expect(card.getByRole('button', { name: 'Show', exact: true })).toHaveCount(4)
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
      // An empty watermark writes nothing — the handle key is only touched
      // when there is a handle to remember, and since T-49 its corner is
      // written in the same block, so the pair is absent together.
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
      await modal.getByRole('button', { name: 'Done' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)

      // ── queue it alongside a platform preset ──
      await expect(card.getByRole('checkbox')).toHaveCount(6)
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
      await modal.getByRole('button', { name: '✕ delete' }).click()
      await expect(modal.getByText('No custom presets yet.')).toBeVisible()
      expect(readdirSync(presetsDir)).toEqual([])
      await modal.getByRole('button', { name: 'Done' }).click()
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
      await expect(card.getByRole('checkbox')).toHaveCount(5)
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
        // compiled without libfreetype, so `drawtext` — the only filter a
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
      const platform = (name: string): Locator => card.locator('label').filter({ hasText: name })
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
      await window.getByRole('checkbox', { name: 'Crop' }).check()
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
      await window.getByRole('checkbox', { name: 'Crop' }).uncheck()
      await expect(platform('TikTok').getByText('Wrong shape', { exact: true })).toBeVisible()
      await expect(platform('TikTok').getByText(TALL_ON_WIDE)).toBeVisible()
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
      await window.getByRole('checkbox', { name: 'Crop' }).check()
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
      await window.getByRole('checkbox', { name: 'Crop' }).check()
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
        await card.getByRole('button', { name: 'Show', exact: true }).count()
      ).toBeLessThan(3)
      // The cancelled rows are painted (danger bar), not left at a hopeful
      // accent-coloured percentage — and T-84 gives them WORDS that outlive
      // the toast: every row that did not finish says "Canceled", none says
      // "Failed" (a cancel is the user's decision, not a fault), and the rows
      // that did finish say neither.
      await expect(card.locator('.bg-danger-strong')).not.toHaveCount(0)
      const shown = await card.getByRole('button', { name: 'Show', exact: true }).count()
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

  test('refuses to start without an output folder, and cannot start with nothing selected', async () => {
    test.setTimeout(120_000)
    const studio = await launchWithVideo('exportneg')
    const { app, window, outDir } = studio
    try {
      const card = exportCard(window)
      // ── negative 1: no output folder ──
      await card.getByRole('button', { name: 'Export 1' }).click()
      await expectToast(window, 'Choose an output folder first')
      await expect(window.getByText('Choose an output folder first').first()).toBeVisible()
      await expect(card.getByText('Queue', { exact: true })).toHaveCount(0)
      expect(mp4sIn(outDir)).toEqual([])

      // ── negative 2: nothing selected disables the button outright ──
      await presetBox(window, 'YouTube').uncheck()
      const disabled = card.getByRole('button', { name: 'Export', exact: true })
      await expect(disabled).toBeDisabled()
      // T-49 (was FINDING-3): the disabled button is now the WHOLE refusal.
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

      // ── the base select loads that platform's geometry ──
      await modal.locator('select').selectOption('reels')
      await expect(numbers.nth(0)).toHaveValue('1080')
      await expect(numbers.nth(1)).toHaveValue('1920')

      // ── negative 3 (T-50): a bitrate ffmpeg cannot parse ──
      // Presets are export targets now, so one that could never encode must
      // not reach disk — the same "a saved preset promises it can be used"
      // ruling the rest of T-50 rests on.
      await numbers.nth(0).fill('1280')
      await numbers.nth(1).fill('720')
      await numbers.nth(2).fill('60')
      await modal.locator('input[type="text"]').nth(1).fill('8 Mbps')
      await save.click()
      await expectToast(window, 'Bitrates look like 8M or 192k')
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      expect(existsSync(presetsDir) ? readdirSync(presetsDir) : []).toEqual([])
      // The audio field is checked too, not just the video one.
      await modal.locator('input[type="text"]').nth(1).fill('5M')
      await modal.locator('input[type="text"]').nth(2).fill('loud')
      await save.click()
      expect(
        (await readToastLog(window)).filter((t) => t.includes('Bitrates look like'))
      ).toHaveLength(2)
      expect(existsSync(presetsDir) ? readdirSync(presetsDir) : []).toEqual([])

      // ── save ──
      await modal.locator('input[type="text"]').nth(2).fill('256k')
      await save.click()
      await expectToast(window, 'Saved "Discord 1080p"')
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Discord 1080p')
      await expect(modal.locator('li')).toContainText('1280×720 · 60fps · 5M · Reels')
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
        'Saved presets join the platform presets in the Export panel — tick one to export a clip at its own size and bitrate.'
      )
      await expect(modal.getByText(/scaffold metadata only/)).toHaveCount(0)

      // T-50 (was FINDING-4): a saved custom preset IS an export target now.
      // It joins the five platform checkboxes in the per-clip grid, carrying
      // its own name, its stored geometry and a "custom" tag — the same
      // checkbox, one more row. Pinned in both directions: the count went
      // 5 -> 6, and the entry that used to be absent is present.
      await modal.getByRole('button', { name: 'Done' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      const card = exportCard(window)
      await expect(card.getByRole('checkbox')).toHaveCount(6)
      const customTile = card.locator('label').filter({ hasText: 'Discord 1080p' })
      await expect(customTile).toHaveCount(1)
      await expect(customTile).toContainText('1280×720')
      await expect(customTile).toContainText('custom')
      // No platform tile wears the tag — it is what separates the groups.
      await expect(card.locator('label').filter({ hasText: 'YouTube' })).not.toContainText(
        'custom'
      )

      // ── and it is a live checkbox: the export count follows it ──
      await expect(card.getByRole('button', { name: 'Export 1' })).toBeEnabled()
      await presetBox(window, 'Discord 1080p').check()
      await expect(presetBox(window, 'Discord 1080p')).toBeChecked()
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled()

      // ── delete, both branches — with the preset QUEUED on a clip ──
      await card.getByRole('button', { name: 'Presets' }).click()
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      await modal.getByRole('button', { name: '✕ delete' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe('Delete preset "Discord 1080p"?')
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      expect(readdirSync(presetsDir)).toHaveLength(1)
      // Dismissed: nothing was unqueued either.
      await modal.getByRole('button', { name: 'Done' }).click()
      await expect(presetBox(window, 'Discord 1080p')).toBeChecked()
      await card.getByRole('button', { name: 'Presets' }).click()

      answer = 'accept'
      await modal.getByRole('button', { name: '✕ delete' }).click()
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
      await modal.getByRole('button', { name: 'Done' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByRole('checkbox')).toHaveCount(5)
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

/** `makeKitDir` stamps the folder with today's date. */
function kitStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

test.describe('ClipKit', () => {
  test('one click produces the whole kit — five platform MP4s and three thumbnails in one folder', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('kit')
    const { app, window, userDataDir, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      // Located by its (stable) title, not its name: the button's label IS
      // its progress readout, so a name-based locator stops matching the
      // moment the kit starts — exactly the state under test.
      const kit = kitButton(window)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)')

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
      await expect(kit).toHaveText('Exporting 5 platform versions…', { timeout: 30_000 })

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
      await expectToast(window, 'Clip kit ready')
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

      await kit.click()
      await expect(kit).toHaveText('Exporting 5 platform versions…', { timeout: 30_000 })

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
      await expect(kit).toHaveText('Exporting 5 platform versions…')

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

      // The kit folder was created, but the run stopped inside the export
      // phase: fewer than five MP4s and not a single thumbnail. The three
      // extractFrame passes never spawned, so nothing leaked past the kill.
      const kitDir = path.join(outDir, `Clip_1-kit-${kitStamp()}`)
      expect(existsSync(kitDir)).toBe(true)
      const left = readdirSync(kitDir)
      expect(left.filter((f) => f.endsWith('.mp4')).length).toBeLessThan(5)
      expect(left.filter((f) => f.endsWith('.jpg'))).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('a clip over a platform\'s typical limit asks once before the kit starts, names that platform, and both answers are honoured (T-85)', async () => {
    test.setTimeout(600_000)
    // The 20-minute source: Clip 1 spans all of it, which is past Reels'
    // typical 3-minute limit and inside every other platform's.
    const studio = await launchWithVideo('kitlong', longSrc)
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const kit = kitButton(window)

      await kit.click()
      const modal = window.getByRole('dialog')
      await expect(
        modal.getByRole('heading', { name: 'This clip is long for some platforms' }).last()
      ).toBeVisible()
      await expect(modal).toContainText(/This clip is 20:0\d\./)
      // Exactly the platform that is over — not the four that are not.
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('Reels')
      await expect(modal.locator('li')).toContainText('the typical 3-minute limit')
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
      await expect(kit).toHaveText('Exporting 5 platform versions…', { timeout: 30_000 })

      // Wind it down: the point was the question, not a 20-minute encode.
      const cancelButton = clipListCard(window).getByRole('button', { name: 'Cancel', exact: true })
      await cancelButton.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel jobs' }).click()
      await expectCanceledNotFailed(
        window,
        'Clip Kit canceled. Files already finished are in your folder.'
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
        await expectToast(window, 'Clip kit ready')
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
      await expectToast(window, 'PiP done.')
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
})

// ══════════════ ReframePanel (4k) · GifPanel (4l) · Compilation (4m) ═══════

test.describe('single-output panels', () => {
  test('reframe: the three positions are real state, and 9:16 comes out square-pixelled', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('reframe')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = reframeCard(window)
      // The header states the transform the panel will perform.
      await expect(card.getByText(`${CLIP_WIDTH}×${CLIP_HEIGHT} → 1080×1920`)).toBeVisible()
      // T-85: and says what it is — a fixed strip, not a tracker.
      await expect(card.getByText('Reframe to 9:16 (center crop)')).toBeVisible()
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
      for (const label of labels) {
        await posButton(label).click()
        await expect(posButton(label)).toHaveClass(/bg-accent/)
        for (const other of labels.filter((l) => l !== label)) {
          await expect(posButton(other)).not.toHaveClass(/bg-accent/)
        }
      }
      // Land on Left so the output filename carries the chosen position.
      await posButton('Left').click()

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Reframe to 9:16' }).click()

      const output = path.join(outDir, 'pipeline_reframe-1080x1920-left.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, 'Vertical version saved.')
      const v = videoStream(await ffprobeJson(output))
      expect(v.width).toBe(1080)
      expect(v.height).toBe(1920)
      // T-12: dimensions alone cannot see a stretched frame — the source's
      // display aspect leaks back through `scale` without `setsar=1`.
      expect(v.sample_aspect_ratio).toBe('1:1')
      expect(v.display_aspect_ratio).toBe('9:16')
      await expect(card.getByRole('button', { name: 'Reframe to 9:16' })).toBeEnabled()
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
      const card = gifCard(window)
      const selects = card.locator('select')
      await expect(selects).toHaveCount(3)
      await expect(selects.nth(0)).toHaveValue('480')
      await expect(selects.nth(1)).toHaveValue('15')
      await expect(selects.nth(2)).toHaveValue('1')
      // A 2 s clip is nowhere near the 10 s warning threshold.
      await expect(card.getByText('GIF exports over ~10s get huge. Trim the clip first.')).toHaveCount(
        0
      )

      await selects.nth(0).selectOption('320')
      await selects.nth(1).selectOption('12')
      await selects.nth(2).selectOption('2')

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      await card.getByRole('button', { name: 'Export GIF' }).click()

      // The width and fps the user picked are in the filename, so a job
      // built from stale state would land on a different path.
      const output = path.join(outDir, 'pipeline_320px_12fps.gif')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, 'GIF saved.')
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

  test('compilation: appears only with two clips, and its output is the sum of their ranges', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('compile')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      // One clip: nothing to compile, so the panel is not rendered at all.
      await expect(compileCard(window)).toHaveCount(0)
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()

      const card = compileCard(window)
      await expect(card.getByText('Compile clips (2)')).toBeVisible()
      const fade = card.getByRole('slider', { name: 'Crossfade duration in milliseconds' })
      await expect(fade).toHaveValue('300')
      await expect(card.getByText('300 ms')).toBeVisible()
      await fade.fill('600')
      await expect(card.getByText('600 ms')).toBeVisible()
      await expect(fade).toHaveAttribute('aria-valuetext', '600 milliseconds')
      // Back to 0 for the run: with no fades the output duration is exactly
      // the sum of the segments, which is the property under test.
      await fade.fill('0')
      await expect(card.getByText('0 ms')).toBeVisible()

      await card.getByRole('button', { name: 'Choose folder…' }).click()
      // T-94: the button says how many clips it will stitch.
      await card.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()

      const output = path.join(outDir, 'pipeline_compilation.mp4')
      await expect
        .poll(() => existsSync(output), { timeout: 540_000, intervals: [500] })
        .toBe(true)
      await expectToast(window, 'Compilation saved.')
      const probe = await ffprobeJson(output)
      const v = videoStream(probe)
      expect(v.width).toBe(1920)
      expect(v.height).toBe(1080)
      // Two full-length copies of a 2 s clip, normalized to one 1080p file.
      expect(Number(probe.format?.duration)).toBeGreaterThan(2 * CLIP_SECONDS - 0.5)
      expect(Number(probe.format?.duration)).toBeLessThan(2 * CLIP_SECONDS + 0.5)
      await expect(card.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled()
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
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
      await gif.getByRole('button', { name: 'Export GIF' }).click()
      await expectToast(window, `GIF export failed. ${CAUSE}`)
      await expect(gif.getByRole('button', { name: 'Export GIF' })).toBeEnabled({ timeout: 30_000 })

      // ── Compile ──
      const compile = compileCard(window)
      await compile.getByRole('button', { name: 'Choose folder…' }).click()
      await compile.getByRole('button', { name: 'Compile 2 clips', exact: true }).click()
      await expectToast(window, `Compilation failed. ${CAUSE}`)
      await expect(compile.getByRole('button', { name: 'Compile 2 clips', exact: true })).toBeEnabled({
        timeout: 30_000
      })

      // ── PiP: the base is the file that moved ──
      await stubDialogs(app, { open: [moved, pipSrc, outDir] })
      const pip = pipCard(window)
      await pip.getByRole('button', { name: 'Base: none' }).click()
      await pip.getByRole('button', { name: 'Overlay: none' }).click()
      await pip.getByRole('button', { name: 'Choose folder…' }).click()
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
      await gif.getByRole('button', { name: 'Choose folder…' }).click()
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
      await compile.getByRole('button', { name: 'Choose folder…' }).click()
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
      await expect(card.getByRole('button', { name: 'copy' })).toHaveCount(1)

      // ── four titles, each with its own copy button ──
      await card.getByRole('button', { name: 'Suggest 4 titles' }).click()
      const titleRows = card.locator('li')
      await expect(titleRows).toHaveCount(4)
      const first = (await titleRows.first().innerText()).replace(/\s*copy$/, '').trim()
      expect(first.length).toBeGreaterThan(0)

      // ── the copy button really writes to the OS clipboard ──
      // Read back from the MAIN process, so no page permission is involved.
      await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel-before-copy'))
      await titleRows.first().getByRole('button', { name: 'copy' }).click()
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
      await card.getByRole('button', { name: 'copy' }).last().click()
      await expect
        .poll(() => systemClipboard(app), { timeout: 10_000 })
        .toBe('#Shorts #Gaming #Gameplay #FYP #StreamerLife')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-11-postchecklist.png') })

      // Every pack in the select is a real pack, not an empty option.
      for (const id of ['reaction', 'ig_reels_general', 'tiktok_general', 'yt_long']) {
        await pack.selectOption(id)
        await expect(card.locator('code')).toContainText('#')
      }
    } finally {
      await app.close()
    }
  })

  test('logging a post writes a diary entry to the settings store, and deleting it takes it back out', async () => {
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
      await expect(card.getByText(/^Diary \(/)).toHaveCount(0)
      expect(readConfig(userDataDir).postingDiary).toBeUndefined()

      // ── all six platform toggles are multi-select and reversible ──
      const platforms = ['YouTube', 'Reels', 'TikTok', 'X', 'Twitch', 'Discord']
      const toggle = (p: string): Locator => card.getByRole('button', { name: p, exact: true })
      for (const p of platforms) {
        await toggle(p).click()
        await expect(toggle(p)).toHaveClass(/bg-accent/)
      }
      // Clicking again removes just that one — the rest stay selected.
      for (const p of ['Reels', 'X', 'Twitch']) {
        await toggle(p).click()
        await expect(toggle(p)).not.toHaveClass(/bg-accent/)
      }
      await expect(toggle('YouTube')).toHaveClass(/bg-accent/)
      await expect(toggle('TikTok')).toHaveClass(/bg-accent/)
      await toggle('Discord').click()
      await expect(toggle('Discord')).not.toHaveClass(/bg-accent/)

      // ── log it ──
      await name.fill('First Blood clip')
      await notes.fill('posted after the 8pm stream')
      await log.click()
      await expectToast(window, 'Logged to diary')
      await expect(card.getByText('Diary (1)')).toBeVisible()
      const entry = card.locator('div.bg-bg-hover').filter({ hasText: 'First Blood clip' })
      await expect(entry).toContainText('YouTube · TikTok')
      await expect(entry).toContainText('posted after the 8pm stream')
      // The form resets so the next log is not a silent duplicate.
      await expect(name).toHaveValue('')
      await expect(notes).toHaveValue('')
      await expect(toggle('YouTube')).not.toHaveClass(/bg-accent/)
      await expect(toggle('TikTok')).not.toHaveClass(/bg-accent/)

      // ── T-20: the diary lives in the settings store, not localStorage ──
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

      // ── a second entry goes on top (newest first) ──
      await name.fill('Second clip')
      await log.click()
      await expect(card.getByText('Diary (2)')).toBeVisible()
      await expect
        .poll(() => {
          const d = readConfig(userDataDir).postingDiary as Array<{ outputName: string }>
          return d.map((e) => e.outputName)
        })
        .toEqual(['Second clip', 'First Blood clip'])

      // ── delete ──
      await card.getByRole('button', { name: 'Delete entry' }).first().click()
      await expect(card.getByText('Diary (1)')).toBeVisible()
      await expect
        .poll(() => {
          const d = readConfig(userDataDir).postingDiary as Array<{ outputName: string }>
          return d.map((e) => e.outputName)
        })
        .toEqual(['First Blood clip'])
      await card.getByRole('button', { name: 'Delete entry' }).first().click()
      await expect(card.getByText(/^Diary \(/)).toHaveCount(0)
      await expect.poll(() => readConfig(userDataDir).postingDiary).toEqual([])
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
