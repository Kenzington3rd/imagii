import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import { dragThrough, dragTo } from './drag'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-22: the Video Studio core editing surface, driven through the REAL built
 * app — ledger rows Video 4a (chrome), 4c (Player), 4d (CropOverlay),
 * 4e (Timeline), 4f (ClipList), 4h (OutputPreview), 4i (ColorGrade),
 * 4q (TextOverlayEditor).
 *
 * House patterns reused from export.spec.ts: hermetic seeded userData, the
 * synthetic-drop import (`dropOnVideoImporter`), and the MutationObserver
 * toast log. The fixture is the same tiny 320x240 / 2 s testsrc2 clip, built
 * once per file by the repo's own bundled ffmpeg.
 *
 * Every test launches its own app instance. Electron cold start is ~1 s
 * here, so per-test isolation costs less than the state coupling a shared
 * window would create (the video store keeps clips, history, and selection
 * for the life of the window).
 *
 * ── Product findings this spec works around ───────────────────────────
 *
 * BUG-SEEK — FIXED by T-37 (2026-08-15). `imagii-file://` used to answer
 * every request with `net.fetch(file://…)`, which ignores Range requests, so
 * Chromium reported `video.seekable` as [0, 0] and clamped EVERY
 * `currentTime` assignment to 0 — the arrow nudges and the `,` / `.` frame
 * steps reset the playhead instead of moving it. The handler now serves
 * 206 Partial Content (src/main/protocol.ts), so the seek assertions below
 * are on where the playhead LANDS, not merely what it requested.
 * `installSeekLog` survives because the requested value still carries the
 * exact nudge and frame math the landing tolerance can't resolve.
 *
 * BUG-PREVIEW — `OutputPreview` never draws until something unrelated
 * re-renders `VideoStudio`. `PreviewWrapper` (VideoStudio.tsx:159) reads
 * `window.__imagiiVideoEl` during render, and on the render right after
 * import the Player has not attached its <video> yet. VideoStudio only
 * re-renders on source / clips.length / canUndo / canRedo changes — never on
 * playback — so a freshly imported video shows a blank 300x150 default
 * canvas until the first undoable edit. The preview tests below make that
 * first edit deliberately before asserting a redraw.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

// Tiny on purpose (see export.spec.ts): 320x240 for 2 s at 15 fps encodes in
// well under a second. 15 fps also makes the frame-step math exact: 1/15 s.
const FIXTURE_SECONDS = 2
const FIXTURE_WIDTH = 320
const FIXTURE_HEIGHT = 240
const FIXTURE_FPS = 15

/** Root tmp dir for the whole file; the fixture is built once into it. */
let root = ''
let fixture = ''

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
async function makeFixtureMp4(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}:rate=${FIXTURE_FPS}:duration=${FIXTURE_SECONDS}`,
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

/** Hermetic userData dir with every overlay flag pre-seeded (smoke.spec shape). */
function seedUserData(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify(
      {
        welcomeSeen: true,
        tutorialSeen: { video: true, audio: true, image: true, ai: true }
      },
      null,
      2
    ),
    'utf8'
  )
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

/** Launch, walk to Video Studio, and import the fixture through the drop zone. */
async function launchWithVideo(name: string): Promise<{ app: ElectronApplication; window: Page }> {
  const userDataDir = path.join(root, `ud-${name}-${Date.now().toString(36)}`)
  seedUserData(userDataDir)
  const app = await launchApp(userDataDir)
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  await window.locator('a', { hasText: 'Video Studio' }).first().click()
  await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
  await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 15_000 })
  await installToastLog(window)
  await dropOnVideoImporter(window, fixture, 'video-core.mp4')
  // Loaded state: the Importer is replaced by the player + Export panel.
  await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible({ timeout: 30_000 })
  await expect(window.locator('video')).toHaveCount(1)
  return { app, window }
}

/** The <video> the Player exposes on `window.__imagiiVideoEl` (ledger hook). */
function videoState(
  window: Page
): Promise<{ t: number; paused: boolean; ended: boolean; ready: number; seeking: boolean }> {
  return window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    return {
      t: v.currentTime,
      paused: v.paused,
      ended: v.ended,
      ready: v.readyState,
      seeking: v.seeking
    }
  })
}

/** The media element's own `seekable` TimeRanges, flattened. */
function seekableRanges(window: Page): Promise<{ ranges: Array<[number, number]>; dur: number }> {
  return window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    const ranges: Array<[number, number]> = []
    for (let i = 0; i < v.seekable.length; i++) {
      ranges.push([v.seekable.start(i), v.seekable.end(i)])
    }
    return { ranges, dur: v.duration }
  })
}

/**
 * Landing tolerance for a seek: half a frame at the fixture's 15 fps
 * (0.033 s). A media element is allowed to snap a seek to the nearest frame
 * boundary, and half a frame is the largest error that can introduce. It is
 * also strictly SMALLER than the smallest movement any binding makes (one
 * frame = 0.067 s), so a seek that is ignored — the T-37 clamp-to-0, or a
 * step that never moves — still fails these assertions. Chromium in practice
 * lands within a microsecond (it reports currentTime at µs resolution), so
 * the tolerance is headroom, not slack.
 */
const SEEK_TOLERANCE = 1 / (2 * FIXTURE_FPS)

/**
 * Seek the media element and wait for the seek to complete. Returns the
 * position it actually landed on, asserted to be the requested one.
 *
 * This is the end state T-37 unblocked: before the protocol handler served
 * Range requests, every one of these assignments clamped to 0.
 */
async function seekTo(window: Page, target: number): Promise<number> {
  await window.evaluate((t) => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    v.currentTime = t
  }, target)
  const landed = await settledTime(window)
  expect(Math.abs(landed - target), `seek to ${target}s landed at ${landed}s`).toBeLessThan(
    SEEK_TOLERANCE
  )
  return landed
}

/** Wait out any in-flight seek, then read the playhead. */
async function settledTime(window: Page): Promise<number> {
  await expect.poll(async () => (await videoState(window)).seeking, { timeout: 10_000 }).toBe(false)
  return (await videoState(window)).t
}

/** Assert the playhead settled on `expected`, within the seek tolerance. */
async function expectLanded(window: Page, expected: number, label: string): Promise<void> {
  const landed = await settledTime(window)
  expect(Math.abs(landed - expected), `${label}: wanted ${expected}s, landed ${landed}s`).toBeLessThan(
    SEEK_TOLERANCE
  )
}

/**
 * Wait for the playhead to SETTLE on `expected`, within the seek tolerance.
 *
 * The polling twin of `expectLanded`, for seeks that travel through the app
 * rather than being assigned directly: a scrub is mouse event -> React ->
 * store -> media element, so the first read can legitimately still show the
 * previous position. Condition-based (never a sleep), so it cannot join the
 * roaming mouse-timing flake roster; a scrub that never happens fails on the
 * timeout and the final assertion prints where the playhead actually is.
 */
async function expectScrubbedTo(window: Page, expected: number, label: string): Promise<void> {
  let last = Number.NaN
  await expect
    .poll(
      async () => {
        last = await settledTime(window)
        return Math.abs(last - expected) < SEEK_TOLERANCE
      },
      { timeout: 10_000, message: `${label}: playhead never reached ${expected}s` }
    )
    .toBe(true)
  expect(Math.abs(last - expected), `${label}: wanted ${expected}s, landed ${last}s`).toBeLessThan(
    SEEK_TOLERANCE
  )
}

/** The Timeline track — the same element the trim-handle drags measure. */
function timelineTrack(window: Page): Locator {
  return window.locator('[data-tutorial="video-timeline"] .relative.h-12')
}

/** Viewport point at `ratio` across the Timeline track. */
async function trackPointAt(window: Page, ratio: number): Promise<{ x: number; y: number }> {
  const box = (await timelineTrack(window).boundingBox())!
  return { x: box.x + box.width * ratio, y: box.y + box.height / 2 }
}

/**
 * The drawn playhead's left edge, in percent of the track. This is the marker
 * the user reads — it comes from the STORE's currentTime, so it is the second
 * half of every scrub assertion (the media element's own position is the
 * first).
 */
async function playheadPercent(window: Page): Promise<number> {
  const style = await window
    .locator('[data-tutorial="video-timeline"] .bg-pink-400')
    .getAttribute('style')
  const match = /calc\(([\d.]+)%/.exec(style ?? '')
  if (!match) throw new Error(`timeline playhead has no percentage: ${String(style)}`)
  return Number(match[1])
}

/**
 * Keep every parked playhead inside the first 1.2 s of a 2 s fixture: far
 * enough from the end that a 0.5 s park cannot run off it, and far enough
 * that `nudge`'s own clamp to the source duration never truncates a
 * requested seek.
 */
const PARK_CEILING = 1.2

/**
 * Park the playhead by PLAYING for `ms` and pausing. Kept for the crop and
 * preview tests, which need a frame actually decoded and painted rather than
 * a particular timestamp; `seekTo` is the direct route to a position.
 * Returns the position it parked at.
 */
async function parkPlayhead(window: Page, ms: number): Promise<number> {
  const before = await videoState(window)
  if (!before.ended && before.t + ms / 1000 > PARK_CEILING) {
    // Out of runway. Run the clip out and let play() restart it at 0 — this
    // helper stays purely transport-driven so it exercises playback, not the
    // seek path `seekTo` covers.
    await window.getByRole('button', { name: 'Play', exact: true }).click()
    await expect
      .poll(async () => (await videoState(window)).ended, { timeout: 20_000 })
      .toBe(true)
  }
  await window.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await videoState(window)).paused, { timeout: 10_000 }).toBe(false)
  await window.waitForTimeout(ms)
  await window.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => (await videoState(window)).paused, { timeout: 10_000 }).toBe(true)
  const parked = (await videoState(window)).t
  expect(parked).toBeGreaterThan(0.05)
  expect(parked).toBeLessThan(PARK_CEILING + 0.5)
  return parked
}

/**
 * Instrument the media element's `currentTime` setter so the seek each
 * binding REQUESTS is observable. The playhead now lands where it was asked
 * to (T-37), but the landing is only resolvable to half a frame, so the
 * request is still the assertion that pins the exact nudge and frame math.
 * Forwards to the real setter, so the landing can be asserted alongside.
 */
async function installSeekLog(window: Page): Promise<void> {
  await window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    if (!desc || !desc.get || !desc.set) throw new Error('currentTime descriptor missing')
    const log: number[] = []
    ;(window as unknown as { __seekLog: number[] }).__seekLog = log
    const get = desc.get
    const set = desc.set
    Object.defineProperty(v, 'currentTime', {
      configurable: true,
      get(this: HTMLVideoElement) {
        return get.call(this) as number
      },
      set(this: HTMLVideoElement, value: number) {
        log.push(value)
        set.call(this, value)
      }
    })
  })
}

/** The last seek the renderer asked the media element for. */
async function lastSeekRequest(window: Page): Promise<number> {
  const log = await window.evaluate(
    () => (window as unknown as { __seekLog?: number[] }).__seekLog ?? []
  )
  expect(log.length).toBeGreaterThan(0)
  return log[log.length - 1] as number
}

async function clearSeekLog(window: Page): Promise<void> {
  // Truncate in place — the instrumented setter closed over THIS array.
  await window.evaluate(() => {
    const log = (window as unknown as { __seekLog?: number[] }).__seekLog
    if (log) log.length = 0
  })
}

/**
 * The ClipList card. Pinned by its own Add button, not by its heading text:
 * CompilationPanel's header is "Compile clips (N)", and Playwright's hasText
 * is a case-insensitive substring match, so "Clips (" catches both cards.
 */
function clipListCard(window: Page): Locator {
  return window.locator('.card').filter({ has: window.getByRole('button', { name: '+ Add clip' }) })
}

/** The TextOverlayEditor card, pinned the same way. */
function overlayCard(window: Page): Locator {
  return window.locator('.card').filter({ has: window.getByRole('button', { name: '+ Add text' }) })
}

/** "0:01.5" -> 1.5. The Timeline readouts truncate to a tenth. */
function parseShort(text: string): number {
  const m = /^(\d+):(\d\d)\.(\d)$/.exec(text.trim())
  if (!m) throw new Error(`unparseable timeline readout: ${JSON.stringify(text)}`)
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10
}

/** [In, Length, Out] from the Timeline card, in seconds. */
async function timelineReadouts(window: Page): Promise<[number, number, number]> {
  const texts = await window
    .locator('[data-tutorial="video-timeline"] span.font-mono')
    .allInnerTexts()
  expect(texts).toHaveLength(3)
  return [parseShort(texts[0] ?? ''), parseShort(texts[1] ?? ''), parseShort(texts[2] ?? '')]
}

/** The OutputPreview canvas as a PNG data URL, plus its backing-store size. */
function canvasSnapshot(window: Page): Promise<{ w: number; h: number; url: string }> {
  return window.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) throw new Error('OutputPreview canvas not found')
    return { w: c.width, h: c.height, url: c.toDataURL() }
  })
}

/** react-rnd projects the STORE's crop rect into inline width/height/transform. */
async function cropBox(window: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const style = await window
    .locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
    .getAttribute('style')
  if (!style) throw new Error('crop rectangle has no inline style')
  // react-draggable writes float noise in exponent form ("-4.57764e-06px").
  const num = String.raw`-?[\d.]+(?:e[+-]?\d+)?`
  const w = new RegExp(`width:\\s*(${num})px`, 'i').exec(style)
  const h = new RegExp(`height:\\s*(${num})px`, 'i').exec(style)
  const t = new RegExp(`transform:\\s*translate\\((${num})px,\\s*(${num})px\\)`, 'i').exec(style)
  if (!w || !h || !t) throw new Error(`crop rectangle style unreadable: ${style}`)
  return { x: Number(t[1]), y: Number(t[2]), w: Number(w[1]), h: Number(h[1]) }
}

/** Assert a crop box, to the nearest pixel. */
function expectBox(
  actual: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
  label: string
): void {
  expect(actual.x, `${label} x`).toBeCloseTo(expected.x, 0)
  expect(actual.y, `${label} y`).toBeCloseTo(expected.y, 0)
  expect(actual.w, `${label} width`).toBeCloseTo(expected.w, 0)
  expect(actual.h, `${label} height`).toBeCloseTo(expected.h, 0)
}

test.beforeAll(async () => {
  root = path.join(os.tmpdir(), `imagii-e2e-video-core-${Date.now().toString(36)}`)
  const sourceDir = path.join(root, 'source')
  mkdirSync(sourceDir, { recursive: true })
  if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
  fixture = path.join(sourceDir, 'video-core.mp4')
  await makeFixtureMp4(fixture)
})

test.afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test.describe('Video Studio core editing surface', () => {
  // ────────────────────────────── Player (4c) ──────────────────────────────

  test('player transport: play/pause button, Space, and the safe-zone overlay', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('transport')
    try {
      // Imported and parked at the start, not playing.
      expect(await videoState(window)).toMatchObject({ t: 0, paused: true })
      // The probe the main process returned drives the player's own readout.
      await expect(
        window.getByText(`${FIXTURE_WIDTH}×${FIXTURE_HEIGHT} · ${FIXTURE_FPS.toFixed(2)} fps`, {
          exact: false
        })
      ).toBeVisible()

      // ── play/pause button ──
      await window.getByRole('button', { name: 'Play', exact: true }).click()
      await expect
        .poll(async () => (await videoState(window)).paused, { timeout: 10_000 })
        .toBe(false)
      // The button swaps identity while playing (icon + accessible name).
      await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
      await expect
        .poll(async () => (await videoState(window)).t, { timeout: 10_000 })
        .toBeGreaterThan(0.2)
      await window.getByRole('button', { name: 'Pause', exact: true }).click()
      await expect
        .poll(async () => (await videoState(window)).paused, { timeout: 10_000 })
        .toBe(true)
      await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
      const afterButtons = (await videoState(window)).t

      // The playhead reached the STORE: Timeline draws it from currentTime.
      const playheadLeft = await window
        .locator('[data-tutorial="video-timeline"] .bg-pink-400')
        .getAttribute('style')
      const pct = Number(/calc\(([\d.]+)%/.exec(playheadLeft ?? '')?.[1] ?? '0')
      expect(pct).toBeGreaterThan(5)

      // ── Space toggles the same transport, from the focused container ──
      await window.locator('[data-tutorial="video-player"] [tabindex="0"]').focus()
      await window.keyboard.press('Space')
      await expect
        .poll(async () => (await videoState(window)).paused, { timeout: 10_000 })
        .toBe(false)
      await expect
        .poll(async () => (await videoState(window)).t, { timeout: 10_000 })
        .toBeGreaterThan(afterButtons + 0.1)
      await window.keyboard.press('Space')
      await expect
        .poll(async () => (await videoState(window)).paused, { timeout: 10_000 })
        .toBe(true)

      // ── safe zones ──
      const guides = window.locator('[data-tutorial="video-player"] svg > g > text')
      await expect(guides).toHaveCount(0)
      await window.getByRole('checkbox', { name: 'Safe zones' }).check()
      await expect(guides).toHaveCount(3)
      // SVG <text> has no innerText, so read the text nodes themselves.
      expect(await guides.allTextContents()).toEqual(['9:16', '1:1', '4:5'])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-01-safezones.png') })
      await window.getByRole('checkbox', { name: 'Safe zones' }).uncheck()
      await expect(guides).toHaveCount(0)

      // ── the media element's own events drive the UI ──
      // Letting it run to the end flips the button back with nobody
      // clicking anything: that is the <video>'s onEnded/onPause, not
      // togglePlay.
      await window.getByRole('button', { name: 'Play', exact: true }).click()
      await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
      await expect
        .poll(async () => (await videoState(window)).ended, { timeout: 20_000 })
        .toBe(true)
      await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('player seeking: the source is seekable and parks mid-file without playing (T-37)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('seekable')
    try {
      // ── the media element considers the whole clip seekable ──
      // This is the direct read-out of the protocol handler's Range support:
      // before T-37 the handler answered every request with the whole file
      // and no Accept-Ranges, and Chromium reported [0, 0] here.
      await expect
        .poll(async () => (await videoState(window)).ready, { timeout: 20_000 })
        .toBeGreaterThan(0)
      const { ranges, dur } = await seekableRanges(window)
      expect(ranges).toHaveLength(1)
      expect(ranges[0]?.[0]).toBe(0)
      expect(dur).toBeGreaterThan(FIXTURE_SECONDS - 0.1)
      expect(Math.abs((ranges[0]?.[1] ?? 0) - dur)).toBeLessThan(0.05)

      // ── park at 1.5 s of a 2 s clip, never having pressed Play ──
      const before = await videoState(window)
      expect(before).toMatchObject({ t: 0, paused: true })
      const landed = await seekTo(window, 1.5)
      expect(landed).toBeGreaterThan(1.4)
      const after = await videoState(window)
      // Still paused: this is a seek, not playback running there.
      expect(after.paused).toBe(true)
      // HAVE_CURRENT_DATA or better — the frame AT 1.5 s is decoded, which is
      // what a Range request bought us.
      expect(after.ready).toBeGreaterThanOrEqual(2)

      // ── and the position reached the UI the user reads ──
      await expect(window.locator('[data-tutorial="video-player"] .font-mono')).toContainText(
        '0:01.5'
      )
      const playheadLeft = await window
        .locator('[data-tutorial="video-timeline"] .bg-pink-400')
        .getAttribute('style')
      const pct = Number(/calc\(([\d.]+)%/.exec(playheadLeft ?? '')?.[1] ?? '0')
      expect(pct).toBeGreaterThan(70)
      expect(pct).toBeLessThan(80)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-01b-seek.png') })

      // ── a backwards seek works too (not just forward streaming) ──
      await seekTo(window, 0.25)
      await expect(window.locator('[data-tutorial="video-player"] .font-mono')).toContainText(
        '0:00.2'
      )
    } finally {
      await app.close()
    }
  })

  test('player keyboard: nudges and frame steps land the playhead, I and O move the clip range', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('keyboard')
    try {
      const player = window.locator('[data-tutorial="video-player"] [tabindex="0"]')
      await player.focus()

      // ── I / O: setMarker reads the media element's position and writes it
      // into the store's clip range, so a direct seek is enough to place it.
      const inPoint = await seekTo(window, 0.4)
      await player.focus()
      await window.keyboard.press('i')
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000 })
        .toBeGreaterThan(0.1)
      let [start, length, end] = await timelineReadouts(window)
      // Readouts truncate to a tenth, so allow that plus a frame of slack.
      expect(Math.abs(start - inPoint)).toBeLessThan(0.15)
      expect(end).toBe(FIXTURE_SECONDS)
      expect(Math.abs(length - (end - start))).toBeLessThan(0.15)

      const outPoint = await seekTo(window, 0.9)
      expect(outPoint).toBeGreaterThan(inPoint)
      await player.focus()
      await window.keyboard.press('o')
      await expect
        .poll(async () => (await timelineReadouts(window))[2], { timeout: 10_000 })
        .toBeLessThan(FIXTURE_SECONDS)
      ;[start, length, end] = await timelineReadouts(window)
      expect(Math.abs(end - outPoint)).toBeLessThan(0.15)
      expect(Math.abs(start - inPoint)).toBeLessThan(0.15)
      expect(Math.abs(length - (end - start))).toBeLessThan(0.15)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-02-in-out.png') })

      // ── the four seek bindings ──
      // Each is asserted twice: the seek it REQUESTS (exact, to 5 decimals —
      // 0.1 s for the arrows, exactly one frame for , and .) and where the
      // playhead LANDS (within half a frame). Before T-37 the landing was 0
      // for all four, whatever they requested.
      const frame = 1 / FIXTURE_FPS
      // A frame-aligned park (12 frames in) so a step lands on a boundary
      // instead of near one, with runway for a backwards 0.1 s nudge.
      const PARK = 12 / FIXTURE_FPS
      await installSeekLog(window)
      const cases: Array<{ key: string; delta: number }> = [
        { key: 'ArrowRight', delta: 0.1 },
        { key: 'ArrowLeft', delta: -0.1 },
        { key: '.', delta: frame },
        { key: ',', delta: -frame }
      ]
      for (const { key, delta } of cases) {
        const parked = await seekTo(window, PARK)
        // Park far enough in that a backwards nudge is not floored at 0.
        expect(parked).toBeGreaterThan(Math.abs(delta))
        await clearSeekLog(window)
        await player.focus()
        await window.keyboard.press(key)
        const requested = await lastSeekRequest(window)
        expect(requested, `${key} should seek by ${delta}s from ${parked}`).toBeCloseTo(
          parked + delta,
          5
        )
        await expectLanded(window, parked + delta, `${key} from ${parked}s`)
      }

      // ── the two frame-step buttons issue the same seeks, and land them ──
      for (const [title, delta] of [
        ['Previous frame (,)', -frame],
        ['Next frame (.)', frame]
      ] as Array<[string, number]>) {
        const parked = await seekTo(window, PARK)
        await clearSeekLog(window)
        await window.getByTitle(title).click()
        expect(await lastSeekRequest(window)).toBeCloseTo(parked + delta, 5)
        await expectLanded(window, parked + delta, `${title} from ${parked}s`)
      }
    } finally {
      await app.close()
    }
  })

  test('player: a tail nudge reaches the media element own duration, not ffprobe rounded one (T-52)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('tailnudge')
    try {
      await expect
        .poll(async () => (await videoState(window)).ready, { timeout: 20_000 })
        .toBeGreaterThan(0)
      // The gap this pin exists for: ffprobe reports the container's rounded
      // 2.000 s, the decoder has 2.020136 s of frames. `nudge` used to clamp
      // to the probe, so every tail nudge stopped ~20 ms short of the real end
      // — an error far too small for the landing tolerance to see, which is
      // why the requested seek is asserted exactly alongside it.
      //
      // Polled, not read once: Chromium reports the container's rounded
      // duration at metadata time and refines it to the decoder's once it has
      // parsed the file. Under a full-suite load that refinement lands after
      // the import finishes, and reading it early made this the one flaky test
      // in the file.
      await expect
        .poll(async () => (await seekableRanges(window)).dur, {
          timeout: 20_000,
          message: 'the fixture must expose the probe/element duration gap this pin exists for'
        })
        .toBeGreaterThan(FIXTURE_SECONDS + 0.005)
      const { dur } = await seekableRanges(window)

      const player = window.locator('[data-tutorial="video-player"] [tabindex="0"]')
      await installSeekLog(window)
      await seekTo(window, dur - 0.05)
      await clearSeekLog(window)
      await player.focus()
      await window.keyboard.press('ArrowRight')

      // The clamp is the element's own duration…
      expect(
        await lastSeekRequest(window),
        'the tail nudge must clamp to the media element duration'
      ).toBeCloseTo(dur, 5)
      // …and the playhead really lands past where ffprobe said the file ended.
      const landed = await settledTime(window)
      expect(landed, `tail nudge landed at ${landed}s`).toBeGreaterThan(FIXTURE_SECONDS)
      expect(Math.abs(landed - dur), `tail nudge wanted ${dur}s, landed ${landed}s`).toBeLessThan(
        SEEK_TOLERANCE
      )
    } finally {
      await app.close()
    }
  })

  // ───────────────────────────── Timeline (4e) ─────────────────────────────

  test('timeline: both trim handles drag the clip range, and Undo reverses each drag', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('timeline')
    try {
      const undoButton = window.getByRole('button', { name: 'Undo' })
      const redoButton = window.getByRole('button', { name: 'Redo' })
      // Import resets history, so both are dead on arrival.
      await expect(undoButton).toBeDisabled()
      await expect(redoButton).toBeDisabled()
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])

      const track = window.locator('[data-tutorial="video-timeline"] .relative.h-12')
      const trackBox = (await track.boundingBox())!

      /**
       * One move, then release once the readout the handle drives has landed.
       * See tests/e2e/drag.ts for why the button-down window is kept to a
       * single mouse round trip (T-55).
       */
      async function dragHandle(label: string, toRatio: number): Promise<void> {
        const handle = window.getByRole('button', { name: label })
        const box = (await handle.boundingBox())!
        const readout = label === 'Trim start' ? 0 : 2
        await dragTo(
          window,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          { x: trackBox.x + trackBox.width * toRatio, y: trackBox.y + trackBox.height / 2 },
          {
            extent: {
              label: `${label} to ${Math.round(toRatio * 100)}%`,
              read: async () => (await timelineReadouts(window))[readout],
              settled: (v) => Math.abs(v - FIXTURE_SECONDS * toRatio) < 0.15
            }
          }
        )
      }

      // ── trim start ──
      await dragHandle('Trim start', 0.25)
      await expect.poll(async () => (await timelineReadouts(window))[0]).toBeGreaterThan(0.3)
      const [startIn, startLen, startOut] = await timelineReadouts(window)
      // 25% of a 2 s source; the readout truncates to a tenth.
      expect(Math.abs(startIn - 0.5)).toBeLessThan(0.15)
      expect(startOut).toBe(FIXTURE_SECONDS)
      expect(Math.abs(startLen - (startOut - startIn))).toBeLessThan(0.15)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-03-trimmed.png') })

      // ── in-studio Undo (T-15) reverses the whole drag as one step ──
      await expect(undoButton).toBeEnabled()
      await undoButton.click()
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])
      await expect(undoButton).toBeDisabled()

      // ── and Redo puts it back ──
      await expect(redoButton).toBeEnabled()
      await redoButton.click()
      expect(Math.abs((await timelineReadouts(window))[0] - startIn)).toBeLessThan(0.001)
      await undoButton.click()
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])

      // ── trim end ──
      await dragHandle('Trim end', 0.6)
      await expect.poll(async () => (await timelineReadouts(window))[2]).toBeLessThan(1.5)
      const [endIn, endLen, endOut] = await timelineReadouts(window)
      expect(Math.abs(endOut - 1.2)).toBeLessThan(0.15)
      expect(endIn).toBe(0)
      expect(Math.abs(endLen - endOut)).toBeLessThan(0.15)

      // ── Ctrl+Z reaches the same history (T-15's hotkey) ──
      await window.keyboard.press('Control+z')
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])
      await window.keyboard.press('Control+y')
      expect(Math.abs((await timelineReadouts(window))[2] - endOut)).toBeLessThan(0.001)
    } finally {
      await app.close()
    }
  })

  test('timeline: clicking the track scrubs there, dragging scrubs continuously, and the trim handles keep priority (T-52)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('scrub')
    try {
      expect(await videoState(window)).toMatchObject({ t: 0, paused: true })

      // ── a plain click lands the playhead at that proportion of the source ──
      const quarter = await trackPointAt(window, 0.25)
      await window.mouse.click(quarter.x, quarter.y)
      await expectScrubbedTo(window, FIXTURE_SECONDS * 0.25, 'click at 25% of the track')
      // A scrub is a seek, not playback: nothing started rolling.
      expect((await videoState(window)).paused).toBe(true)
      // …and the marker the click was aimed at moved with it.
      const clickedPct = await playheadPercent(window)
      expect(clickedPct, 'playhead after a 25% click').toBeGreaterThan(24)
      expect(clickedPct, 'playhead after a 25% click').toBeLessThan(26)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-03b-scrub.png') })

      // ── drag: one gesture, three positions, each landing under the cursor ──
      // One mouse round trip per position, and each position is confirmed
      // before the next move (and before the release) — see tests/e2e/drag.ts.
      const ratios = [0.6, 0.8, 0.35]
      const points = []
      for (const ratio of ratios) points.push(await trackPointAt(window, ratio))
      await dragThrough(window, await trackPointAt(window, 0.6), points, async (_point, i) =>
        expectScrubbedTo(
          window,
          FIXTURE_SECONDS * (ratios[i] as number),
          `drag to ${(ratios[i] as number) * 100}%`
        )
      )
      const released = await settledTime(window)

      // ── the gesture really ended: moving on with the button up scrubs nothing ──
      const away = await trackPointAt(window, 0.9)
      await window.mouse.move(away.x, away.y, { steps: 4 })
      expect(
        Math.abs((await settledTime(window)) - released),
        'a mouse move after mouseup must not scrub'
      ).toBeLessThan(SEEK_TOLERANCE)

      // ── a mousedown that STARTS on a trim handle drags the handle only ──
      // The handles are the more specific gesture and they sit on top of the
      // scrub surface; the playhead must not jump to where the drag ended.
      const handle = window.getByRole('button', { name: 'Trim end' })
      const handleBox = (await handle.boundingBox())!
      const dropAt = await trackPointAt(window, 0.6)
      await dragTo(
        window,
        { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
        dropAt,
        {
          extent: {
            label: 'Trim end to 60%',
            read: async () => (await timelineReadouts(window))[2],
            settled: (v) => Math.abs(v - FIXTURE_SECONDS * 0.6) < 0.15
          }
        }
      )
      await expect.poll(async () => (await timelineReadouts(window))[2]).toBeLessThan(1.5)
      expect(
        Math.abs((await settledTime(window)) - released),
        'dragging a trim handle must not move the playhead'
      ).toBeLessThan(SEEK_TOLERANCE)

      // ── scrubbing during playback seeks and KEEPS PLAYING (T-52 decision) ──
      await window.getByRole('button', { name: 'Play', exact: true }).click()
      await expect
        .poll(async () => (await videoState(window)).paused, { timeout: 10_000 })
        .toBe(false)
      const middle = await trackPointAt(window, 0.5)
      await window.mouse.click(middle.x, middle.y)
      const jumped = FIXTURE_SECONDS * 0.5
      await expect
        .poll(async () => (await videoState(window)).t, { timeout: 10_000 })
        .toBeGreaterThan(jumped - SEEK_TOLERANCE)
      const during = await videoState(window)
      expect(during.paused, 'a scrub during playback must not pause').toBe(false)
      // …and it kept rolling FORWARD from where it was dropped.
      await expect
        .poll(async () => (await videoState(window)).t, { timeout: 10_000 })
        .toBeGreaterThan(jumped + 0.05)
      await window.getByRole('button', { name: 'Pause', exact: true }).click()
      await expect.poll(async () => (await videoState(window)).paused, { timeout: 10_000 }).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('timeline: the track is a keyboard scrubber — arrows nudge, Home and End jump (T-52)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('scrubkeys')
    try {
      const slider = window.getByRole('slider', { name: 'Playhead' })
      await expect(slider).toHaveAttribute('aria-valuemin', '0')
      await expect(slider).toHaveAttribute('aria-valuemax', String(FIXTURE_SECONDS))
      await expect(slider).toHaveAttribute('aria-valuenow', '0')

      await slider.focus()
      await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, 0.1, 'ArrowRight from 0')
      await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, 0.2, 'ArrowRight from 0.1')
      await window.keyboard.press('ArrowLeft')
      await expectScrubbedTo(window, 0.1, 'ArrowLeft from 0.2')

      await window.keyboard.press('End')
      await expectScrubbedTo(window, FIXTURE_SECONDS, 'End')
      await expect(slider).toHaveAttribute('aria-valuenow', String(FIXTURE_SECONDS))
      await window.keyboard.press('Home')
      await expectScrubbedTo(window, 0, 'Home')
      // The value a screen reader announces tracks the playhead it describes.
      await expect(slider).toHaveAttribute('aria-valuenow', '0')

      // A backwards nudge at 0 floors instead of going negative.
      await window.keyboard.press('ArrowLeft')
      await expectScrubbedTo(window, 0, 'ArrowLeft at the start')
    } finally {
      await app.close()
    }
  })

  test('timeline: the playhead never lies — store churn keeps it, leaving and returning resets it (T-52)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('playheadsync')
    try {
      // Wait for metadata before the direct seek: a `currentTime` assignment
      // at HAVE_NOTHING is stored as the element's default start position and
      // fires no `timeupdate`, so the STORE would never hear about it and this
      // test would be racing the decoder rather than the code under it.
      await expect
        .poll(async () => (await videoState(window)).ready, { timeout: 20_000 })
        .toBeGreaterThan(0)
      await seekTo(window, 1.2)
      const parkedPct = await playheadPercent(window)
      expect(parkedPct).toBeGreaterThan(55)
      expect(parkedPct).toBeLessThan(65)

      // ── store churn on the SAME file: unrelated edits re-render the studio
      //    (and the Player with it). Nothing may rewind the playhead. ──
      await clipListCard(window).getByRole('button', { name: '+ Add clip' }).click()
      await expect(clipListCard(window).locator('h3')).toHaveText('Clips (2)')
      await window
        .locator('.card')
        .filter({ hasText: 'Color & motion' })
        .getByRole('slider', { name: 'Brightness' })
        .fill('0.25')
      const afterChurn = await settledTime(window)
      expect(Math.abs(afterChurn - 1.2), `store churn moved the playhead to ${afterChurn}s`).toBeLessThan(
        SEEK_TOLERANCE
      )
      const churnedPct = await playheadPercent(window)
      expect(churnedPct).toBeGreaterThan(55)
      expect(churnedPct).toBeLessThan(65)

      // ── leaving and returning: the studio remounts with a NEW <video> that
      //    starts at 0, so the marker must say 0 too. The stale store value
      //    used to draw a playhead the video was nowhere near. ──
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 15_000 })
      await expect(window.locator('video')).toHaveCount(1)
      // Two clips now, so the ExportPanel's button counts them (and it is not
      // GifPanel's "Export GIF" — hence the exact name).
      await expect(window.getByRole('button', { name: 'Export 2' })).toBeVisible()

      expect((await videoState(window)).t, 'the remounted media element starts at 0').toBeLessThan(
        SEEK_TOLERANCE
      )
      await expect
        .poll(() => playheadPercent(window), {
          timeout: 10_000,
          message: 'the drawn playhead must follow the remounted element back to 0'
        })
        .toBeLessThan(1)
      await expect(window.locator('[data-tutorial="video-player"] .font-mono')).toContainText(
        '0:00.00'
      )
    } finally {
      await app.close()
    }
  })

  // ───────────────────────────── ClipList (4f) ─────────────────────────────

  test('clip list: add, rename, select, speed slider and speed reset', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('cliplist')
    try {
      const clipCard = clipListCard(window)
      const speedReadout = clipCard.locator('span.font-mono.w-10')
      const speedSlider = window.getByRole('slider', { name: 'Clip playback speed' })

      await expect(clipCard.locator('h3')).toHaveText('Clips (1)')
      await expect(clipCard.locator('li')).toHaveCount(1)

      // ── add ──
      await clipCard.getByRole('button', { name: '+ Add clip' }).click()
      await expect(clipCard.locator('h3')).toHaveText('Clips (2)')
      await expect(clipCard.locator('li')).toHaveCount(2)
      // A new clip is selected on creation, so its row is the accented one.
      const secondRow = clipCard.locator('li').nth(1)
      await expect(secondRow).toHaveClass(/border-accent/)

      // ── rename (T-17: the input is a sibling of the select button) ──
      await secondRow.getByRole('textbox').fill('Intro hook')
      // The store took the name: both of the row's controls re-label from it.
      await expect(clipCard.getByRole('textbox', { name: 'Rename clip Intro hook' })).toBeVisible()
      await expect(clipCard.getByRole('button', { name: 'Select clip Intro hook' })).toBeVisible()

      // ── speed slider + reset, on the selected clip ──
      await expect(speedReadout).toHaveText('1.00×')
      await speedSlider.fill('2.5')
      await expect(speedReadout).toHaveText('2.50×')

      // ── select: the panel follows the store's selected clip ──
      await clipCard.getByRole('button', { name: 'Select clip Clip 1' }).click()
      await expect(clipCard.locator('li').first()).toHaveClass(/border-accent/)
      await expect(secondRow).not.toHaveClass(/border-accent/)
      // Clip 1 never had its speed changed — proof the panel switched clips.
      await expect(speedReadout).toHaveText('1.00×')

      await clipCard.getByRole('button', { name: 'Select clip Intro hook' }).click()
      await expect(speedReadout).toHaveText('2.50×')
      await clipCard.getByRole('button', { name: 'Reset speed to 1×' }).click()
      await expect(speedReadout).toHaveText('1.00×')
    } finally {
      await app.close()
    }
  })

  test('clip list: remove asks first — dismissing keeps the clip, accepting removes it', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('remove')
    try {
      // The handler goes on BEFORE the first confirm-triggering click: an
      // unhandled dialog is auto-dismissed and the accept branch is lost.
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })

      const clipCard = clipListCard(window)
      // The remove button only exists once a clip would survive the removal.
      await expect(clipCard.getByRole('button', { name: 'Remove clip' })).toHaveCount(0)
      await clipCard.getByRole('button', { name: '+ Add clip' }).click()
      await expect(clipCard.locator('h3')).toHaveText('Clips (2)')
      await expect(clipCard.getByRole('button', { name: 'Remove clip' })).toHaveCount(2)

      // ── declined: the clip survives ──
      await clipCard.locator('li').nth(1).getByRole('button', { name: 'Remove clip' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe('Remove clip "Clip 2"?')
      await expect(clipCard.locator('h3')).toHaveText('Clips (2)')
      await expect(clipCard.locator('li')).toHaveCount(2)
      await expect(clipCard.getByRole('textbox', { name: 'Rename clip Clip 2' })).toBeVisible()

      // ── accepted: it goes ──
      answer = 'accept'
      await clipCard.locator('li').nth(1).getByRole('button', { name: 'Remove clip' }).click()
      await expect(clipCard.locator('h3')).toHaveText('Clips (1)')
      await expect(clipCard.locator('li')).toHaveCount(1)
      await expect(clipCard.getByRole('textbox', { name: 'Rename clip Clip 2' })).toHaveCount(0)
      expect(messages).toEqual(['Remove clip "Clip 2"?', 'Remove clip "Clip 2"?'])
      // Last clip standing: no way left to empty the list.
      await expect(clipCard.getByRole('button', { name: 'Remove clip' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // ──────────────────────────── CropOverlay (4d) ────────────────────────────

  test('crop overlay: enable, five aspect presets, drag, resize, reset, and uncheck clears the rect', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('crop')
    try {
      const cropRow = window.locator('[data-tutorial="video-crop"]')
      const cropRect = window.locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
      const cropToggle = window.getByRole('checkbox', { name: 'Crop' })

      // Decode a frame first: OutputPreview can only prove the STORE rect
      // cleared if it has something other than black to draw.
      await parkPlayhead(window, 300)

      // ── enable ──
      await expect(cropRect).toHaveCount(0)
      await expect(cropRow.getByRole('button', { name: '1:1', exact: true })).toHaveCount(0)
      await cropToggle.check()
      await expect(cropRect).toHaveCount(1)
      // No rect stored yet: the overlay covers the whole frame.
      const container = await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null })
          .__imagiiVideoEl
        return { w: v?.clientWidth ?? 0, h: v?.clientHeight ?? 0 }
      })
      expect(container).toEqual({ w: FIXTURE_WIDTH, h: FIXTURE_HEIGHT })
      expectBox(await cropBox(window), { x: 0, y: 0, w: container.w, h: container.h }, 'enabled')

      // ── the five aspect presets ──
      // Each writes a normalized rect to the store; react-rnd renders it back
      // as pixels, so the rendered box IS the stored rect. A preset centers a
      // box of exactly the requested aspect (the container-aspect terms
      // cancel: w_px / h_px == ratio).
      const presets: Array<[string, number]> = [
        ['16:9', 16 / 9],
        ['9:16', 9 / 16],
        ['1:1', 1],
        ['4:5', 4 / 5]
      ]
      for (const [label, ratio] of presets) {
        await cropRow.getByRole('button', { name: label, exact: true }).click()
        const box = await cropBox(window)
        expect(box.w / box.h, `${label} aspect`).toBeCloseTo(ratio, 2)
        expect(box.x, `${label} centered x`).toBeCloseTo((container.w - box.w) / 2, 1)
        expect(box.y, `${label} centered y`).toBeCloseTo((container.h - box.h) / 2, 1)
        // 90% of the constraining dimension, per applyAspectPreset.
        expect(Math.max(box.w / container.w, box.h / container.h)).toBeCloseTo(0.9, 2)
        await expect(cropRow.getByRole('button', { name: label, exact: true })).toHaveClass(
          /bg-accent/
        )
      }

      // The fifth preset, `free`, unlocks the ratio instead of writing a rect
      // — the stored box must survive the click untouched.
      const beforeFree = await cropBox(window)
      await cropRow.getByRole('button', { name: 'free', exact: true }).click()
      await expect(cropRow.getByRole('button', { name: 'free', exact: true })).toHaveClass(
        /bg-accent/
      )
      expect(await cropBox(window)).toEqual(beforeFree)

      // ── drag the rectangle ──
      const beforeDrag = await cropBox(window)
      const dragBox = (await cropRect.boundingBox())!
      await window.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
      await window.mouse.down()
      await window.mouse.move(
        dragBox.x + dragBox.width / 2 - 40,
        dragBox.y + dragBox.height / 2 - 8,
        { steps: 8 }
      )
      await window.mouse.up()
      await expect.poll(async () => (await cropBox(window)).x).toBeCloseTo(beforeDrag.x - 40, 0)
      const afterDrag = await cropBox(window)
      expect(afterDrag.y).toBeCloseTo(beforeDrag.y - 8, 0)
      expect(afterDrag.w).toBeCloseTo(beforeDrag.w, 1)
      expect(afterDrag.h).toBeCloseTo(beforeDrag.h, 1)

      // ── resize from the bottom-right handle (aspect is unlocked) ──
      const handle = cropRect.locator('div[style*="se-resize"]')
      const handleBox = (await handle.boundingBox())!
      await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
      await window.mouse.down()
      await window.mouse.move(
        handleBox.x + handleBox.width / 2 + 24,
        handleBox.y + handleBox.height / 2 + 12,
        { steps: 8 }
      )
      await window.mouse.up()
      await expect.poll(async () => (await cropBox(window)).w).toBeCloseTo(afterDrag.w + 24, 0)
      const afterResize = await cropBox(window)
      expect(afterResize.h).toBeCloseTo(afterDrag.h + 12, 0)
      expect(afterResize.x).toBeCloseTo(afterDrag.x, 1)
      expect(afterResize.y).toBeCloseTo(afterDrag.y, 1)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-04-crop.png') })

      // The crop reached the export-side preview too (OutputPreview draws
      // from the stored rect rather than the platform auto-crop).
      const croppedPreview = await canvasSnapshot(window)

      // ── reset ──
      await cropRow.getByRole('button', { name: 'Reset' }).click()
      expectBox(await cropBox(window), { x: 0, y: 0, w: container.w, h: container.h }, 'reset')
      const clearedPreview = await canvasSnapshot(window)
      expect(clearedPreview.url).not.toBe(croppedPreview.url)

      // ── uncheck clears the stored rect, not just the overlay ──
      await cropRow.getByRole('button', { name: '1:1', exact: true }).click()
      await expect
        .poll(async () => (await canvasSnapshot(window)).url)
        .not.toBe(clearedPreview.url)
      await cropToggle.uncheck()
      await expect(cropRect).toHaveCount(0)
      // Same pixels as the reset (rect === null) state: the store was cleared
      // on the way out, so the preview is back on its platform auto-crop.
      expect((await canvasSnapshot(window)).url).toBe(clearedPreview.url)
    } finally {
      await app.close()
    }
  })

  // ─────────────────── ColorGrade (4i) + OutputPreview (4h) ───────────────────

  test('color and motion: four grade sliders, reset, auto-zoom and hype shake', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('grade')
    try {
      const gradeCard = window.locator('.card').filter({ hasText: 'Color & motion' })
      const readouts = gradeCard.locator('span.font-mono.w-12')
      // Defaults from DEFAULT_COLOR_GRADE, rendered from the store.
      await expect(readouts).toHaveText(['0.00', '1.00', '1.00', '+0.00'])

      const values: Array<[string, string]> = [
        ['Brightness', '0.25'],
        ['Contrast', '1.2'],
        ['Saturation', '1.5'],
        ['Temperature', '-0.5']
      ]
      for (const [label, set] of values) {
        await gradeCard.getByRole('slider', { name: label }).fill(set)
        await expect(
          gradeCard.getByRole('slider', { name: label }),
          `${label} slider value`
        ).toHaveValue(set)
      }
      // All four survived together — the panel patches the stored grade
      // rather than replacing it one field at a time.
      await expect(readouts).toHaveText(['0.25', '1.20', '1.50', '-0.50'])

      await gradeCard.getByRole('button', { name: 'Reset color' }).click()
      await expect(readouts).toHaveText(['0.00', '1.00', '1.00', '+0.00'])
      await expect(gradeCard.getByRole('slider', { name: 'Brightness' })).toHaveValue('0')

      // ── the two motion checkboxes ──
      // Both are controlled from the clip in the store, so a box that stays
      // checked across React's re-render is the stored flag.
      const autoZoom = gradeCard.getByRole('checkbox', { name: 'Auto-zoom (gentle pulse)' })
      const hypeShake = gradeCard.getByRole('checkbox', { name: 'Hype shake (subtle jitter)' })
      await expect(autoZoom).not.toBeChecked()
      await expect(hypeShake).not.toBeChecked()
      await autoZoom.check()
      await hypeShake.check()
      await expect(autoZoom).toBeChecked()
      await expect(hypeShake).toBeChecked()
      // Undo is the store's own witness: each flag was a history-pushing edit.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(hypeShake).not.toBeChecked()
      await expect(autoZoom).toBeChecked()
      await autoZoom.uncheck()
      await expect(autoZoom).not.toBeChecked()
    } finally {
      await app.close()
    }
  })

  test('output preview: the platform select redraws the canvas', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('preview')
    try {
      // Decode a frame, then make one undoable edit — BUG-PREVIEW (file
      // header): OutputPreview does not pick up the video element until
      // VideoStudio re-renders, and playback alone never re-renders it.
      await parkPlayhead(window, 300)
      const gradeCard = window.locator('.card').filter({ hasText: 'Color & motion' })
      await gradeCard.getByRole('checkbox', { name: 'Auto-zoom (gentle pulse)' }).check()

      const select = window.getByLabel('Preview platform')
      await expect(select).toHaveValue('reels')
      // Reels is 1080x1920, scaled into a 240 px box.
      await expect.poll(async () => (await canvasSnapshot(window)).h, { timeout: 10_000 }).toBe(240)
      const reels = await canvasSnapshot(window)
      expect(reels.w).toBe(135)

      await select.selectOption('youtube')
      await expect(select).toHaveValue('youtube')
      // 1920x1080 in the same box, redrawn with the wider auto-crop.
      await expect.poll(async () => (await canvasSnapshot(window)).w, { timeout: 10_000 }).toBe(240)
      const youtube = await canvasSnapshot(window)
      expect(youtube.h).toBe(135)
      expect(youtube.url).not.toBe(reels.url)

      await select.selectOption('tiktok')
      await expect.poll(async () => (await canvasSnapshot(window)).w, { timeout: 10_000 }).toBe(135)
      const tiktok = await canvasSnapshot(window)
      // TikTok shares Reels' 9:16 frame, so the same pixels come back.
      expect(tiktok.url).toBe(reels.url)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-05-preview.png') })
    } finally {
      await app.close()
    }
  })

  // ───────────────────────── TextOverlayEditor (4q) ─────────────────────────

  test('text overlays: add, edit every field, remove', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('overlays')
    try {
      const card = overlayCard(window)
      await expect(card.locator('h3')).toHaveText('Text overlays (0)')
      await expect(
        card.getByText('Add a text overlay to draw a caption on the exported video.')
      ).toBeVisible()

      // ── add ──
      await card.getByRole('button', { name: '+ Add text' }).click()
      await expect(card.locator('h3')).toHaveText('Text overlays (1)')
      const row = card.locator('li')
      await expect(row).toHaveCount(1)
      await expect(row.getByPlaceholder('Caption')).toHaveValue('Your text here')

      // ── every field, all reading back from the store ──
      await row.getByPlaceholder('Caption').fill('FIRST BLOOD')
      await expect(row.getByPlaceholder('Caption')).toHaveValue('FIRST BLOOD')

      await row.locator('select').selectOption('Impact')
      await expect(row.locator('select')).toHaveValue('Impact')

      // T-17 left the numeric fields in DOM order size, x, y, start, end;
      // start and end carry aria-labels, the first three do not.
      const numbers = row.locator('input[type="number"]')
      await expect(numbers).toHaveCount(5)
      await numbers.nth(0).fill('72')
      await expect(numbers.nth(0)).toHaveValue('72')

      await row.getByPlaceholder('white or #ffcc00').fill('#ffcc00')
      await expect(row.getByPlaceholder('white or #ffcc00')).toHaveValue('#ffcc00')

      await numbers.nth(1).fill('0.42')
      await expect(numbers.nth(1)).toHaveValue('0.42')
      await numbers.nth(2).fill('0.66')
      await expect(numbers.nth(2)).toHaveValue('0.66')

      // The two time fields round-trip through the store, which re-formats
      // them to two decimals — proof the value went through the clip.
      await row.getByRole('spinbutton', { name: 'Overlay start second' }).fill('0.4')
      await expect(row.getByRole('spinbutton', { name: 'Overlay start second' })).toHaveValue('0.40')
      await row.getByRole('spinbutton', { name: 'Overlay end second' }).fill('1.6')
      await expect(row.getByRole('spinbutton', { name: 'Overlay end second' })).toHaveValue('1.60')

      // A second overlay proves the list is per-clip, not a singleton.
      await card.getByRole('button', { name: '+ Add text' }).click()
      await expect(card.locator('h3')).toHaveText('Text overlays (2)')
      await expect(card.locator('li')).toHaveCount(2)

      // ── remove (T-17: a sibling of the time label, not inside it) ──
      await card.locator('li').nth(1).getByRole('button', { name: 'Remove overlay' }).click()
      await expect(card.locator('h3')).toHaveText('Text overlays (1)')
      // The survivor is the edited one.
      await expect(card.locator('li').first().getByPlaceholder('Caption')).toHaveValue('FIRST BLOOD')
      await card.locator('li').first().getByRole('button', { name: 'Remove overlay' }).click()
      await expect(card.locator('h3')).toHaveText('Text overlays (0)')
      await expect(card.locator('li')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  // ────────────────────────── Studio chrome (4a) ──────────────────────────

  test('clean audio extracts the track and hands it to Audio Studio', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('cleanaudio')
    try {
      await window.getByRole('button', { name: 'Clean audio' }).click()

      // The handoff is a real ffmpeg extract, then a route change.
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({
        timeout: 60_000
      })
      const waveform = window.locator('[data-tutorial="audio-waveform"]')
      await expect(waveform).toBeVisible({ timeout: 30_000 })
      // The wav that landed in Audio Studio was probed by the main process:
      // 48 kHz stereo PCM is exactly what extractAudioFromVideo writes.
      await expect(waveform.getByText('48000 Hz · 2ch', { exact: false })).toBeVisible({
        timeout: 30_000
      })
      // ...and it carries the same 2 s of audio the video did.
      await expect(waveform.getByText(`/ 0:0${FIXTURE_SECONDS}.`, { exact: false })).toBeVisible()
      // The header names the extracted file, not the mp4.
      await expect(window.locator('header').getByText(/\.wav$/)).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-06-clean-audio.png') })

      // The route change replaces the page in one mutation, so the success
      // toast can land inside a larger inserted subtree rather than as its
      // own record — match on containment.
      const toasts = await readToastLog(window)
      expect(toasts.some((t) => t.includes('Opening Audio Studio'))).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('close asks first — dismissing keeps the video, accepting returns the drop zone', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('close')
    try {
      // Installed before the first Close click: an unhandled dialog is
      // auto-dismissed by Playwright and the accept branch would be unreachable.
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })

      // ── declined: everything stays ──
      await window.getByRole('button', { name: 'Close' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe('Close this video? 1 clip(s) and their edits will be discarded.')
      await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible()
      await expect(window.locator('video')).toHaveCount(1)
      await expect(window.getByText('Drop a video here')).toHaveCount(0)

      // ── accepted: back to the importer ──
      answer = 'accept'
      await window.getByRole('button', { name: 'Close' }).click()
      await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 10_000 })
      await expect(window.locator('video')).toHaveCount(0)
      await expect(window.getByRole('button', { name: /^Export/ })).toHaveCount(0)
      // The whole chrome row goes with the source.
      await expect(window.getByRole('button', { name: 'Close' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Clean audio' })).toHaveCount(0)
      expect(messages).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  test('the tutorial button opens the Video Studio coachmarks', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('tutorial')
    try {
      // Seeded `tutorialSeen.video` keeps it from auto-starting, so what
      // opens here is the button's doing.
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await window.getByRole('button', { name: 'Show tutorial' }).click()

      const coachmark = window.getByRole('dialog')
      await expect(coachmark).toBeVisible()
      await expect(coachmark).toContainText('Welcome to Video Studio')
      await expect(coachmark).toContainText('Video Studio · 1 of')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-07-tutorial.png') })

      // Next walks to the step that highlights the importer/player.
      await coachmark.getByRole('button', { name: /Next/ }).click()
      await expect(coachmark).toContainText('Video Studio · 2 of')
      await coachmark.getByRole('button', { name: /Back/ }).click()
      await expect(coachmark).toContainText('Video Studio · 1 of')

      // Escape dismisses it and hands the studio back.
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
