import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'

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
 * Four, all built once by the repo's own bundled ffmpeg:
 *   clipSrc  — 320x240 / 2 s / 15 fps testsrc2 + 440 Hz. The export fixture.
 *   pipSrc   — 160x120 / 2 s flat green, no audio. The PiP overlay.
 *   burstSrc — 320x240 / 14 s, a quiet 440 Hz bed with one 1.5 s full-scale
 *              burst at 6.0-7.5 s (the Layer 5 `rampSrc` recipe, shortened).
 *              findHighlights returns exactly one candidate for it.
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
 * T-38 (blank preview) and T-40 (undo coalescing) are pinned by T-22. T-37
 * (seeking clamped to 0) was fixed on 2026-08-15 — the protocol handler now
 * answers Range requests — but none of the panels here seek, so the playback-
 * only parking below is left alone. New findings this spec turned up are marked
 * `FINDING-n` at the assertion that pins them and listed in the report.
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

/** Record the text of every node react-hot-toast mounts (export.spec pattern). */
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

/** Wait until some toast text contains `needle`, then return the whole log. */
async function expectToast(window: Page, needle: string): Promise<string[]> {
  await expect
    .poll(() => readToastLog(window), { timeout: 30_000, intervals: [200] })
    .toEqual(expect.arrayContaining([expect.stringContaining(needle)]))
  return readToastLog(window)
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
    // the padded range to the SOURCE duration, so a short source would
    // silently swallow every range this panel produces (FINDING-1 below).
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
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      await row.getByRole('button', { name: '+ clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (2)')
      await expectToast(window, 'Clip added')
      // start = bucketStart (15), end = bucketStart + bucket + 2 * pad = 55.
      expect((await clipRows(window))[1]).toEqual({
        name: 'Chat hype 1',
        range: '0:15 → 0:55'
      })

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

      // And the re-run's + clip uses the NEW numbers: 30 -> 30 + 5 + 0.
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (3)')
      expect((await clipRows(window))[2]).toEqual({
        name: 'Chat hype 1',
        range: '0:30 → 0:35'
      })
    } finally {
      await app.close()
    }
  })

  test('refuses a log with no timestamps, says so in its own words, and claims a clip it never adds', async () => {
    test.setTimeout(120_000)
    // A SHORT source on purpose — the last case needs a peak whose padded
    // range runs off the end of the video (FINDING-1).
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

      // ── FINDING-1: "+ clip" reports success for a clip it never adds ──
      // addPeak clamps the padded end to the SOURCE duration but not the
      // start, so on any source shorter than the chat timestamps the range
      // comes out reversed. addClipFromRange rejects a reversed range and
      // returns silently — and addPeak toasts "Clip added" regardless. The
      // user sees a success message and an unchanged Clips list.
      await card.locator('textarea').fill(chatLogWithOneSpike())
      await analyze.click()
      await expect(card.locator('li')).toHaveCount(1)
      // The peak itself is real: 0:15, past the end of this 2 s source.
      await expect(card.locator('li').first().locator('span.font-mono')).toHaveText('0:15')
      await card.locator('li').first().getByRole('button', { name: '+ clip' }).click()
      await expectToast(window, 'Clip added')
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (1)')
      expect(await clipRows(window)).toEqual([{ name: 'Clip 1', range: '0:00 → 0:02' }])
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
      await row.getByRole('button', { name: '+ Clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (2)')
      await expectToast(window, 'Clip added — see the Clips list')
      const rows = await clipRows(window)
      expect(rows[1]?.name).toBe('Highlight 1')
      expect(rows[1]?.range).toBe('0:01 → 0:12')
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

      // The main process rejected the promise rather than resolving empty:
      // the renderer's catch shows the killed scan's own message.
      await expectToast(window, 'highlight scan cancelled')
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
      // when there is a handle to remember.
      expect(config.streamerHandle).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  test('the watermark reaches the filter graph and its handle is remembered; its position is not', async () => {
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
        await expectToast(window, "No such filter: 'drawtext'")
        expect(mp4sIn(outDir)).toEqual([])
      }
      // Either way the panel leaves its running state rather than sticking.
      await expect(card.getByRole('button', { name: /^Export/ })).toBeEnabled({ timeout: 30_000 })

      // FINDING-2: the position is NOT persisted alongside the handle —
      // runExportQueue writes `streamerHandle` and `filenameTemplate` only,
      // so a user who picks "top left" gets bottom-right back next launch.
      // Pinned in the store the panel would have to use.
      const config = readConfig(userDataDir)
      expect(config.streamerHandle).toBe('@imagii_e2e')
      expect(JSON.stringify(config)).not.toContain('top-left')
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
      await expect(modal.getByRole('heading', { name: 'Safe-zone warning' }).last()).toBeVisible()
      // Both directions of the collision are listed, by clip name.
      await expect(modal.locator('li')).toHaveText([
        'Clip 1 — clips: YouTube → Reels, Reels → YouTube'
      ])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'pipelines-07-safezone.png') })

      // ── declined: no queue, no files, and the panel is untouched ──
      await modal.getByRole('button', { name: 'Cancel export' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByText('Queue', { exact: true })).toHaveCount(0)
      expect(mp4sIn(outDir)).toEqual([])
      await expect(card.getByRole('button', { name: 'Export 2' })).toBeEnabled()

      // ── accepted: the same batch runs ──
      await card.getByRole('button', { name: 'Export 2' }).click()
      await expect(window.getByRole('dialog')).toBeVisible()
      await window.getByRole('dialog').getByRole('button', { name: 'Continue anyway' }).click()
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
      await expectToast(window, 'FFmpeg exit')
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
      // The cancelled rows are painted as errors (rose bar), not left at a
      // hopeful accent-coloured percentage.
      await expect(card.locator('.bg-rose-400')).not.toHaveCount(0)
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
      // FINDING-3: because the button is disabled at totalQueued === 0 and
      // the queue is built from the same sum, `runExportQueue`'s
      // "No presets selected on any clip" toast is unreachable dead code.
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
  test('saves, lists and deletes a custom preset — and refuses the two invalid ones by name', async () => {
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

      // ── save ──
      await numbers.nth(0).fill('1280')
      await numbers.nth(1).fill('720')
      await numbers.nth(2).fill('60')
      await modal.locator('input[type="text"]').nth(1).fill('5M')
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

      // FINDING-4: a saved custom preset never becomes an export target.
      // ExportPanel's grid maps ALL_PLATFORM_IDS only, so the five built-in
      // checkboxes are all there is — the modal's own footer admits the
      // presets "scaffold metadata only". Pinned in both directions.
      await modal.getByRole('button', { name: 'Done' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(exportCard(window).getByRole('checkbox')).toHaveCount(5)
      await expect(exportCard(window).getByText('Discord 1080p')).toHaveCount(0)

      // ── delete, both branches ──
      await exportCard(window).getByRole('button', { name: 'Presets' }).click()
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      await modal.getByRole('button', { name: '✕ delete' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe('Delete preset "Discord 1080p"?')
      await expect(modal.getByText('Saved presets (1)')).toBeVisible()
      expect(readdirSync(presetsDir)).toHaveLength(1)

      answer = 'accept'
      await modal.getByRole('button', { name: '✕ delete' }).click()
      await expect(modal.getByText('Saved presets (0)')).toBeVisible()
      await expect(modal.getByText('No custom presets yet.')).toBeVisible()
      expect(readdirSync(presetsDir)).toEqual([])
      expect(messages).toEqual([
        'Delete preset "Discord 1080p"?',
        'Delete preset "Discord 1080p"?'
      ])

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

      // ── the same safe-zone pre-flight ExportPanel runs, on the kit's own
      //    fixed 5-platform mix (both 16:9 and 9:16 are in it, always) ──
      await kit.click()
      const modal = window.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Safe-zone warning' }).last()).toBeVisible()
      await expect(modal.locator('li')).toHaveCount(1)
      await expect(modal.locator('li')).toContainText('YouTube → Reels')
      await expect(modal.locator('li')).toContainText('Reels → Facebook')
      await modal.getByRole('button', { name: 'Continue anyway' }).click()

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
      await stubDialogs(app, { open: [outDir] })
      const kit = kitButton(window)

      // ── the kit's OWN safe-zone modal, declined: nothing starts, and the
      //    output folder is never even asked for ──
      await kit.click()
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel export' }).click()
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(kit).toHaveText('Clip Kit (5 + thumbs)')
      expect(readdirSync(outDir)).toEqual([])

      await kit.click()
      await window
        .getByRole('dialog')
        .getByRole('button', { name: 'Continue anyway' })
        .click()
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
      await expectToast(window, 'FFmpeg exit')
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
      // cancelPip -> cancelConcatJob -> SIGKILL, surfaced as a non-zero exit.
      await expectToast(window, 'pip exit')
      await expect(card.getByRole('button', { name: 'Composite' })).toBeEnabled({ timeout: 30_000 })
      await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

// ══════════════ ReframePanel (4k) · GifPanel (4l) · Compilation (4m) ═══════

test.describe('single-output panels', () => {
  test('reframe: the four positions are real state, and 9:16 comes out square-pixelled', async () => {
    test.setTimeout(600_000)
    const studio = await launchWithVideo('reframe')
    const { app, window, outDir } = studio
    try {
      await stubDialogs(app, { open: [outDir] })
      const card = reframeCard(window)
      // The header states the transform the panel will perform.
      await expect(card.getByText(`${CLIP_WIDTH}×${CLIP_HEIGHT} → 1080×1920`)).toBeVisible()

      // ── the four position buttons: exactly one is active at a time ──
      // `exact` throughout: "Center" is a substring of "Auto (centered)".
      const labels = ['Center', 'Left', 'Right', 'Auto (centered)']
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
      await card.getByRole('button', { name: 'Compile', exact: true }).click()

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
      await expect(card.getByRole('button', { name: 'Compile', exact: true })).toBeEnabled()
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

