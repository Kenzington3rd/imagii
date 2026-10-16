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
import { installToastLog, readToastLog } from './toastLog'
import { DEFAULT_WINDOW, MIN_WINDOW, expectControlsWhole, expectNoHorizontalOverflow, expectNoOverlap, expectOneLine, expectSameRow, expectSelectsWhole, setWindowSize as resizeAndSettle } from './layout'
import { leave, retype } from './typing'

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
 * BUG-PREVIEW — FIXED by T-38 (2026-08-16). `PreviewWrapper` used to read
 * `window.__imagiiVideoEl` during a render that happens BEFORE the Player
 * attaches its <video>, and VideoStudio re-renders only on source /
 * clips.length / canUndo / canRedo — never on playback — so a freshly
 * imported video showed a blank 300x150 canvas until the first undoable edit.
 * The Player now publishes the element to the studio as it attaches, and the
 * preview redraws from `requestVideoFrameCallback` (a frame that has been
 * PRESENTED) rather than from `loadeddata` (data, which the decoder may not
 * have turned into a drawable frame yet). The preview tests below no longer
 * make an edit first; "a freshly imported video draws a real frame with no
 * edit first (T-38)" is the pin.
 *
 * OVERLAY ANCHORING — FIXED by T-39 (2026-08-16). The crop rectangle and the
 * safe-zone guides were positioned against the player's black box while sized
 * to the video, so both drew across the letterbox bars, and the Crop control
 * row rendered as a flex sibling of the <video> INSIDE that box while the
 * tutorial's own copy says "above the player". Both overlays now anchor to
 * the rendered picture; "the crop rect and the safe-zone guides sit on the
 * picture, not the letterbox (T-39)" pins the geometry at two window sizes.
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
 * Resize the real BrowserWindow (image.spec.ts uses the same technique for
 * T-45). Driving the OS window rather than a CSS viewport is the point: the
 * overlay geometry below has to survive a relayout that moves the picture
 * without changing its size, which is exactly what a window resize does to a
 * centered `w-auto` video.
 */
async function setWindowSize(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('no BrowserWindow to resize')
      win.setSize(size.width, size.height)
    },
    { width, height }
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
    .locator('[data-tutorial="video-timeline"] .bg-ember')
    .getAttribute('style')
  const match = /calc\(([\d.]+)%/.exec(style ?? '')
  if (!match) throw new Error(`timeline playhead has no percentage: ${String(style)}`)
  return Number(match[1])
}

/*
 * `parkPlayhead` — play for N ms, then pause — lived here until T-38. Its
 * only callers were the crop and preview tests, which played solely to get a
 * frame decoded onto the preview canvas; the preview now carries the first
 * frame from the moment the import finishes, so both of them wait for that
 * instead. Transport playback itself is covered by the transport test.
 */

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

/**
 * A canvas of the given size carrying nothing but OutputPreview's own black
 * backdrop. Same size, same fill, same encoder — so a preview that still
 * matches this has drawn no video frame at all.
 */
function blackCanvasUrl(window: Page, w: number, h: number): Promise<string> {
  return window.evaluate(
    ({ w, h }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      return c.toDataURL()
    },
    { w, h }
  )
}

interface ViewportRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where the PICTURE is, in viewport coordinates.
 *
 * Two things can put it somewhere other than the player's black box: the
 * element is centered inside a box that is wider than it (the bars T-39 is
 * about), and the UA default `object-fit: contain` letterboxes the picture
 * INSIDE the element whenever the element's box and the media's intrinsic
 * aspect disagree. Both are folded in here, computed from the element itself
 * rather than from the product's helper, so this stays a second opinion.
 */
function videoContentBox(window: Page): Promise<ViewportRect> {
  return window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    if (!(v.videoWidth > 0 && v.videoHeight > 0)) throw new Error('video has no intrinsic size yet')
    const box = v.getBoundingClientRect()
    const intrinsic = v.videoWidth / v.videoHeight
    let w = box.width
    let h = box.height
    if (box.width / box.height > intrinsic) w = box.height * intrinsic
    else h = box.width / intrinsic
    return { x: box.left + (box.width - w) / 2, y: box.top + (box.height - h) / 2, w, h }
  })
}

/** A Playwright bounding box in the same shape as `videoContentBox`. */
async function boxOf(locator: Locator, label: string): Promise<ViewportRect> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} has no bounding box`)
  return { x: box.x, y: box.y, w: box.width, h: box.height }
}

/** Assert two viewport rectangles are the same rectangle, to the pixel. */
function expectSameRect(actual: ViewportRect, expected: ViewportRect, label: string): void {
  expect(actual.x, `${label} left`).toBeCloseTo(expected.x, 0)
  expect(actual.y, `${label} top`).toBeCloseTo(expected.y, 0)
  expect(actual.w, `${label} width`).toBeCloseTo(expected.w, 0)
  expect(actual.h, `${label} height`).toBeCloseTo(expected.h, 0)
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

  // T-127 (15): the header's file name is cut with an ellipsis at 40 characters; its whole self is the tooltip.
  test('the header names the open video in full as its title (T-127 (15))', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('header-title')
    try {
      const name = window.locator('header span.truncate').filter({ hasText: /^video-core\.mp4$/ })
      await expect(name).toHaveCount(1)
      await expect(name, 'the full name is the tooltip').toHaveAttribute('title', 'video-core.mp4')
    } finally {
      await app.close()
    }
  })

  test('player transport: play/pause button, Space, and the safe-zone overlay', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('transport')
    try {
      // Imported and parked at the start, not playing.
      expect(await videoState(window)).toMatchObject({ t: 0, paused: true })
      // The probe the main process returned drives the player's own readout.
      // T-92: a whole frame rate has no decimals ("15 fps", not "15.00 fps"),
      // and each codec says which stream it is ("video h264 · audio aac").
      await expect(
        window.getByText(
          `${FIXTURE_WIDTH}×${FIXTURE_HEIGHT} · ${FIXTURE_FPS} fps · video h264 · audio aac`,
          { exact: true }
        )
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
        .locator('[data-tutorial="video-timeline"] .bg-ember')
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

      // ── T-63: Space on a focused BUTTON belongs to the button ──
      // The transport shortcuts live on the column, and the crop row sits
      // inside it, so a Space aimed at a crop preset used to reach the
      // transport as well — activating the preset AND toggling playback from
      // one keypress. The other shortcuts are not button keys and stay
      // available from anywhere in the column (asserted below).
      const cropRow = window.locator('[data-tutorial="video-crop"]')
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      const preset = cropRow.getByRole('button', { name: '1:1', exact: true })
      await expect(preset).not.toHaveClass(/bg-accent/)
      await expect(preset).toHaveAttribute('aria-pressed', 'false')
      const beforeSpace = (await videoState(window)).t
      await preset.focus()
      await window.keyboard.press('Space')
      // The button did what a keyboard user asked it to…
      await expect(preset).toHaveClass(/bg-accent/)
      // T-113: …and says so to assistive tech, not only in its fill.
      await expect(preset).toHaveAttribute('aria-pressed', 'true')
      // …and the transport did not move. `play()` clears `paused`
      // synchronously, so this cannot pass by being read too early.
      const afterSpace = await videoState(window)
      expect(afterSpace.paused, 'Space on a focused button must not start playback').toBe(true)
      expect(
        Math.abs(afterSpace.t - beforeSpace),
        'Space on a focused button must not move the playhead'
      ).toBeLessThan(SEEK_TOLERANCE)
      // The non-button keys still reach the transport from inside the row.
      await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, beforeSpace + 0.1, 'ArrowRight from a focused crop preset')
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).uncheck()

      // ── safe zones ──
      const guides = window.locator('[data-tutorial="video-player"] svg > g > text')
      await expect(guides).toHaveCount(0)
      await window.getByRole('checkbox', { name: 'Crop guides' }).check()
      await expect(guides).toHaveCount(3)
      // SVG <text> has no innerText, so read the text nodes themselves.
      expect(await guides.allTextContents()).toEqual(['9:16', '1:1', '4:5'])
      // T-112: the guides are a picture drawn over the video, not content — hidden from
      // assistive tech (their labels read out of context as "9:16 1:1 4:5").
      await expect(window.locator('[data-tutorial="video-player"] svg:has(> g > text)')).toHaveAttribute(
        'aria-hidden',
        'true'
      )
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-01-safezones.png') })
      await window.getByRole('checkbox', { name: 'Crop guides' }).uncheck()
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
        .locator('[data-tutorial="video-timeline"] .bg-ember')
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

  // T-124 (29): Timeline and Player read no modifier at all, so Ctrl+O (a browser chord) set an Out point and was swallowed by the
  // handler's `preventDefault`. A bare-letter shortcut is for the bare letter; the control at the end is what makes the quiet
  // before it mean something.
  test('Ctrl+O, Ctrl+I, Alt+. and Alt+ArrowRight are chords, not the O, I, . and arrow shortcuts: from the Player and from the Playhead slider they move nothing, and the bare O still sets the Out point (T-124 (29))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('chords')
    try {
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS)
      const player = window.locator('[data-tutorial="video-player"] [tabindex="0"]')
      const slider = window.getByRole('slider', { name: 'Playhead' })
      const chords = ['Control+o', 'Control+i', 'Alt+o', 'Meta+i', 'Alt+.', 'Alt+ArrowRight']

      // ── the Player's column ──
      const parked = await seekTo(window, 0.9)
      const before = await timelineReadouts(window)
      await player.focus()
      for (const chord of chords) await window.keyboard.press(chord)
      await window.waitForTimeout(600)
      expect(await timelineReadouts(window), 'no chord from the Player set a point').toEqual(before)
      expect(await settledTime(window), 'and none moved the playhead').toBeCloseTo(parked, 2)

      // ── the Playhead slider (a click on the track hands it the keyboard) ──
      const at40 = await trackPointAt(window, 0.4)
      await window.mouse.click(at40.x, at40.y)
      await expect(slider).toBeFocused()
      const clicked = await settledTime(window)
      const beforeSlider = await timelineReadouts(window)
      for (const chord of chords) await window.keyboard.press(chord)
      await window.waitForTimeout(600)
      expect(await timelineReadouts(window), 'no chord from the slider set a point').toEqual(beforeSlider)
      expect(await settledTime(window), 'and none moved the playhead').toBeCloseTo(clicked, 2)

      // ── the control: the bare O is still the Out point, from the same focus ──
      await window.keyboard.press('o')
      await expect
        .poll(async () => (await timelineReadouts(window))[2], { timeout: 10_000 })
        .toBeLessThan(FIXTURE_SECONDS)
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

  // T-123 (2): the Player's column stood down for ANY <input>, and "Crop guides" is a checkbox INSIDE that column: tick it
  // (the browser leaves it focused) and `,` `.` I O and the arrows went dead, against the hint line under the player. A
  // checkbox owns Space and nothing else.
  test('player keyboard: a ticked Crop guides box keeps its focus and the Player\'s keys still answer, Space stays the box\'s (T-123 (2))', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('checkbox-keys')
    try {
      const guides = window.getByRole('checkbox', { name: 'Crop guides' })
      const frame = 1 / FIXTURE_FPS
      const PARK = 12 / FIXTURE_FPS
      const focusedType = (): Promise<string | null> =>
        window.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type ?? null)

      const parked = await seekTo(window, PARK)
      await installSeekLog(window)
      await guides.check()
      await expect(guides).toBeChecked()
      expect(await focusedType(), 'the trap is real: focus is on the box that was just ticked').toBe('checkbox')

      // The four seek bindings, from the checkbox's focus: each is asked for exactly, and lands.
      let at = parked
      for (const { key, delta } of [
        { key: '.', delta: frame },
        { key: 'ArrowRight', delta: 0.1 },
        { key: ',', delta: -frame },
        { key: 'ArrowLeft', delta: -0.1 }
      ]) {
        await clearSeekLog(window)
        await window.keyboard.press(key)
        expect(await lastSeekRequest(window), `${key} from the focused checkbox seeks by ${delta}`).toBeCloseTo(at + delta, 5)
        await expectLanded(window, at + delta, `${key} from the checkbox`)
        at += delta
        expect(await focusedType(), 'and the box still has the focus').toBe('checkbox')
      }

      // I and O move the clip range from there too.
      await window.keyboard.press('i')
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000 })
        .toBeGreaterThan(0.1)
      await window.keyboard.press('o')
      await expect
        .poll(async () => (await timelineReadouts(window))[2], { timeout: 10_000 })
        .toBeLessThanOrEqual(at + 0.15)

      // Space is the checkbox's own: it unticks the box and the video does not start.
      await guides.focus()
      await window.keyboard.press(' ')
      await expect(guides).not.toBeChecked()
      expect((await videoState(window)).paused, 'Space on a checkbox is a toggle, not play').toBe(true)
      await window.keyboard.press(' ')
      await expect(guides).toBeChecked()
      expect((await videoState(window)).paused).toBe(true)

      // `?` opens the shortcuts from the same focus, and Escape closes it.
      await window.keyboard.press('?')
      await expect(window.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
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
        // T-119: the trim handles are aria-hidden pointer affordances now (no name to find them by);
        // they are the timeline's two hidden buttons, start first.
        const handles = window.locator('[data-tutorial="video-timeline"] button[aria-hidden="true"]')
        const handle = label === 'Trim start' ? handles.first() : handles.last()
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

  /**
   * T-40 — one gesture, one undo step; the NEXT gesture is its own.
   *
   * `historyKey` coalesces a drag's stream of `setClipRange` calls, and it
   * only ever reset on a discrete action or an undo. Two consecutive drags
   * of the same handle therefore carried the same key and collapsed into one
   * step: the first Undo threw away both. This spec used to work around it —
   * the trim-start phase above undoes and redoes before the trim-end drag,
   * which is what re-opened the window for it. Here the two drags are
   * back to back with nothing in between, which is the shape that failed.
   */
  test('timeline: two consecutive trim drags are two undo steps (T-40)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('coalesce')
    try {
      const undoButton = window.getByRole('button', { name: 'Undo' })
      await expect(undoButton).toBeDisabled()
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])

      const track = window.locator('[data-tutorial="video-timeline"] .relative.h-12')
      const trackBox = (await track.boundingBox())!

      async function dragStartTo(toRatio: number): Promise<void> {
        const handle = window.locator('[data-tutorial="video-timeline"] button[aria-hidden="true"]').first() // the start handle (T-119: aria-hidden, found by place)
        const box = (await handle.boundingBox())!
        await dragTo(
          window,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          { x: trackBox.x + trackBox.width * toRatio, y: trackBox.y + trackBox.height / 2 },
          {
            extent: {
              label: `Trim start to ${Math.round(toRatio * 100)}%`,
              read: async () => (await timelineReadouts(window))[0],
              settled: (v) => Math.abs(v - FIXTURE_SECONDS * toRatio) < 0.15
            }
          }
        )
      }

      // ── two drags of the same handle, back to back ──
      await dragStartTo(0.25)
      const [afterFirst] = await timelineReadouts(window)
      expect(Math.abs(afterFirst - 0.5)).toBeLessThan(0.15)

      await dragStartTo(0.5)
      const [afterSecond] = await timelineReadouts(window)
      expect(Math.abs(afterSecond - 1.0)).toBeLessThan(0.15)

      // ── the first Undo takes back the SECOND drag only ──
      await expect(undoButton).toBeEnabled()
      await undoButton.click()
      await expect
        .poll(async () => (await timelineReadouts(window))[0])
        .toBeCloseTo(afterFirst, 3)
      // Still something to undo: the first drag is its own step.
      await expect(undoButton).toBeEnabled()

      // ── the second Undo takes back the first ──
      await undoButton.click()
      expect(await timelineReadouts(window)).toEqual([0, FIXTURE_SECONDS, FIXTURE_SECONDS])
      await expect(undoButton).toBeDisabled()

      // Redo walks the same two steps forward again.
      const redoButton = window.getByRole('button', { name: 'Redo' })
      await redoButton.click()
      await expect
        .poll(async () => (await timelineReadouts(window))[0])
        .toBeCloseTo(afterFirst, 3)
      await redoButton.click()
      await expect
        .poll(async () => (await timelineReadouts(window))[0])
        .toBeCloseTo(afterSecond, 3)
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

      // ── T-56: the far end of the track is the end of the FILE ──
      // The track used to be scaled to ffprobe's rounded 2.000 s while the
      // decoder has 2.020136 s, so a click at the right-hand edge landed on
      // the probe's number and the last frames could not be reached by
      // pointer at all. 99.9% of the track is past the probe duration only if
      // the track is scaled to the element's.
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS + 0.005)
      const { dur } = await seekableRanges(window)
      // Expediter fix (round 42): a CLICK at the track's right edge is not a
      // reliable pointer path to the file's end — the trim-end handle (16 px,
      // drag priority by design) sits at probe/element = ~99% and its overhang
      // covers the last strip entirely at narrow geometries (measured: handle
      // right edge 895.5 on an 896 track — a sub-pixel strip). The honest
      // pointer gesture is a DRAG: it starts on the scrub surface left of the
      // handle, and the window-level move carries it under and past the
      // handle to the edge, where positionToSeconds clamps the ratio. Derive
      // the expectation from the real boxes, never a magic ratio.
      const trackBox = (await timelineTrack(window).boundingBox())!
      const edgeX = trackBox.x + trackBox.width - 1
      const edgeRatio = (edgeX - trackBox.x) / trackBox.width
      const edgePoint = { x: edgeX, y: trackBox.y + trackBox.height / 2 }
      await dragThrough(window, await trackPointAt(window, 0.9), [edgePoint], async () =>
        expectScrubbedTo(window, dur * edgeRatio, 'drag to the right edge of the track')
      )
      const edgeLanded = await settledTime(window)
      expect(
        edgeLanded,
        `a drag to the end of the track landed at ${edgeLanded}s, short of the file's end`
      ).toBeGreaterThan(FIXTURE_SECONDS)

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
      const handle = window.locator('[data-tutorial="video-timeline"] button[aria-hidden="true"]').last() // the end handle (T-119: aria-hidden, found by place)
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
      await expect(slider).toHaveAttribute('aria-valuenow', '0')

      // T-56: the track's coordinate space is the MEDIA ELEMENT's duration,
      // not ffprobe's rounded one. The fixture probes 2.000 s and decodes
      // 2.020136 s, so the right edge of the track used to sit ~20 ms short of
      // the end of the file and the last frames were unreachable from here —
      // the T-52 tail pin, extended from the Player's nudge to the track.
      // Polled for the same reason that pin polls: Chromium reports the
      // container's rounded duration at metadata time and refines it to the
      // decoder's once it has parsed the file (a second `durationchange`).
      await expect
        .poll(async () => (await seekableRanges(window)).dur, {
          timeout: 20_000,
          message: 'the fixture must expose the probe/element duration gap this pin exists for'
        })
        .toBeGreaterThan(FIXTURE_SECONDS + 0.005)
      const { dur } = await seekableRanges(window)
      const maxLabel = String(Number(dur.toFixed(2)))
      expect(Number(maxLabel), 'the track must reach PAST the probe duration').toBeGreaterThan(
        FIXTURE_SECONDS
      )
      await expect(slider).toHaveAttribute('aria-valuemax', maxLabel)

      await slider.focus()
      await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, 0.1, 'ArrowRight from 0')
      await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, 0.2, 'ArrowRight from 0.1')
      await window.keyboard.press('ArrowLeft')
      await expectScrubbedTo(window, 0.1, 'ArrowLeft from 0.2')

      // End goes to the end of the FILE, not to where ffprobe rounded it: the
      // landing is past the probe duration, which is the frames T-56 gave back.
      await window.keyboard.press('End')
      await expectScrubbedTo(window, dur, 'End')
      const endLanded = await settledTime(window)
      expect(endLanded, `End landed at ${endLanded}s`).toBeGreaterThan(FIXTURE_SECONDS)
      await expect(slider).toHaveAttribute('aria-valuenow', maxLabel)
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

  // T-119 (5): the guide's sequence is "click the track, press I". A click on the track hands the keyboard to the
  // Playhead slider (it is the focusable element), and the slider heard only the arrows, Home and End - I / O
  // and , / . worked from the Player's column alone, so USER_GUIDE ("`I` and `O` set them at the playhead") and
  // the shortcut overlay promised keys that did nothing from the surface the person had just clicked. The two trim
  // handles were `<button>`s that did nothing for Enter or Space: dead tab stops announced as actionable.
  test('timeline: click the track, then I and O set the in and out points and , and . step a frame; the trim handles are pointer-only (T-119)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('timelinekeys')
    try {
      const slider = window.getByRole('slider', { name: 'Playhead' })
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS)
      const { dur } = await seekableRanges(window)
      const frame = 1 / FIXTURE_FPS

      // ── click the track, press I: the in point is where the playhead went ──
      const at40 = await trackPointAt(window, 0.4)
      await window.mouse.click(at40.x, at40.y)
      await expectScrubbedTo(window, dur * 0.4, 'a click at 40% of the track')
      await expect(slider, 'the click handed the keyboard to the slider').toBeFocused()
      await expect(slider).toHaveAttribute('aria-valuenow', String(Number((await settledTime(window)).toFixed(2))))
      await window.keyboard.press('i')
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000 })
        .toBeGreaterThan(0.5)
      let [start, length, end] = await timelineReadouts(window)
      // Readouts truncate to a tenth, so allow that plus a frame of slack.
      expect(Math.abs(start - dur * 0.4), `In ${start} vs the click at ${dur * 0.4}`).toBeLessThan(0.15)
      expect(end).toBe(FIXTURE_SECONDS)
      expect(Math.abs(length - (end - start))).toBeLessThan(0.15)

      // ── click further along, press O: the out point is where the playhead went, the in point stays ──
      const at80 = await trackPointAt(window, 0.8)
      await window.mouse.click(at80.x, at80.y)
      await expectScrubbedTo(window, dur * 0.8, 'a click at 80% of the track')
      await window.keyboard.press('O')
      await expect
        .poll(async () => (await timelineReadouts(window))[2], { timeout: 10_000 })
        .toBeLessThan(FIXTURE_SECONDS)
      ;[start, length, end] = await timelineReadouts(window)
      expect(Math.abs(end - dur * 0.8), `Out ${end} vs the click at ${dur * 0.8}`).toBeLessThan(0.15)
      expect(Math.abs(start - dur * 0.4)).toBeLessThan(0.15)
      expect(Math.abs(length - (end - start))).toBeLessThan(0.15)

      // ── and a keypress is a whole undo step: Undo puts the out point back and leaves the in point where I put it
      //    (without the end-of-gesture call the two keypresses coalesce into one step and Undo takes both) ──
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect
        .poll(async () => (await timelineReadouts(window))[2], { timeout: 10_000 })
        .toBe(FIXTURE_SECONDS)
      ;[start] = await timelineReadouts(window)
      expect(Math.abs(start - dur * 0.4), `In ${start} after Undo: the I keypress is its own step`).toBeLessThan(0.15)
      // A second I with no pointer between is another step too (T-40: it used to vanish into the first one's; the
      // run only closes on a pointer-up or an explicit end, and a keypress has no pointer-up). From the keyboard
      // alone: Home, I (the in point goes to the start), five nudges, I again; Undo takes the in point back to
      // where the FIRST I left it (the start), not to where it was before either.
      await slider.focus()
      await window.keyboard.press('Home')
      await expectScrubbedTo(window, 0, 'Home from the slider')
      await window.keyboard.press('i')
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000 })
        .toBeLessThan(0.15)
      for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowRight')
      await expectScrubbedTo(window, 0.5, 'five nudges from the start')
      await window.keyboard.press('i')
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000 })
        .toBeGreaterThan(0.4)
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000, message: 'Undo took the second I back to the first' })
        .toBeLessThan(0.15)

      // ── , and . step one frame from the slider ──
      await slider.focus()
      const parked = await settledTime(window)
      await window.keyboard.press('.')
      await expectScrubbedTo(window, parked + frame, '. from the slider')
      await window.keyboard.press(',')
      await window.keyboard.press(',')
      await expectScrubbedTo(window, parked - frame, ', twice from the slider')

      // ── the trim handles are pointer affordances: no tab stop, no name, no role in the accessibility tree ──
      const handles = window.locator('[data-tutorial="video-timeline"] button[aria-hidden="true"]')
      await expect(handles).toHaveCount(2)
      for (const i of [0, 1]) {
        await expect(handles.nth(i)).toHaveAttribute('tabindex', '-1')
      }
      await expect(window.getByRole('button', { name: /Trim/ })).toHaveCount(0)
      // Tab from the slider moves on: it never lands on a handle.
      await slider.focus()
      await window.keyboard.press('Tab')
      expect(
        await window.evaluate(() => document.activeElement?.getAttribute('aria-hidden') ?? null),
        'Tab from the Playhead slider landed on a hidden handle'
      ).toBeNull()
    } finally {
      await app.close()
    }
  })

  // T-120 (4): the guide's sequence is "click the track, then Space". The click hands the keyboard to the Playhead
  // slider, which heard no Space: nothing played, and an unhandled Space scrolls the studio. The Player's own handler
  // toggles through the element it owns, so the Timeline asks the Player (the transport it registers) instead of
  // keeping a second copy of play / pause.
  test('timeline: click the track, then Space plays and pauses the video, and the studio does not scroll (T-120)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('timelinespace')
    try {
      const slider = window.getByRole('slider', { name: 'Playhead' })
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS)
      const { dur } = await seekableRanges(window)

      const at20 = await trackPointAt(window, 0.2)
      await window.mouse.click(at20.x, at20.y)
      await expectScrubbedTo(window, dur * 0.2, 'a click at 20% of the track')
      await expect(slider, 'the click handed the keyboard to the slider').toBeFocused()
      const parked = await settledTime(window)
      expect((await videoState(window)).paused, 'nothing is playing yet').toBe(true)

      // Every Space keydown's outcome, as it reaches the window after the app's handlers: was it handled?
      await window.evaluate(() => {
        const w = window as unknown as { __space: boolean[] }
        w.__space = []
        window.addEventListener('keydown', (e) => {
          if (e.key === ' ') w.__space.push(e.defaultPrevented)
        })
      })
      /** How many elements are scrolled away from their top, plus the page itself. */
      const scrolledPx = (): Promise<number> =>
        window.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('*')].reduce((sum, el) => sum + el.scrollTop, 0) +
          (document.scrollingElement?.scrollTop ?? 0)
        )
      const scrollBefore = await scrolledPx()

      await window.keyboard.press(' ')
      await expect.poll(async () => (await videoState(window)).paused, { timeout: 10_000 }).toBe(false)
      await expect
        .poll(async () => (await videoState(window)).t, { timeout: 10_000, message: 'the video is playing' })
        .toBeGreaterThan(parked + 0.15)
      await window.keyboard.press(' ')
      await expect.poll(async () => (await videoState(window)).paused, { timeout: 10_000 }).toBe(true)
      await expect(slider, 'Space left the keyboard on the slider').toBeFocused()

      expect(await window.evaluate(() => (window as unknown as { __space: boolean[] }).__space), 'both Spaces were handled').toEqual([true, true])
      expect(await scrolledPx(), 'an unhandled Space scrolls the studio').toBe(scrollBefore)
    } finally {
      await app.close()
    }
  })

  // T-120 (14): the Timeline's I and O marked the store's `currentTime`, which is written on `timeupdate` (about every
  // 250 ms during playback), while the Player's own I and O read the element. The store's number is made stale on
  // purpose here (the element's timeupdate is stopped before React hears it), so the two readings are a second
  // apart and the answer cannot be an accident of when the last timeupdate happened to land.
  test('timeline: I during playback marks the frame on screen, not the last time the store heard of (T-120)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('timelinelive')
    try {
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS)
      const { dur } = await seekableRanges(window)
      const at5 = await trackPointAt(window, 0.05)
      await window.mouse.click(at5.x, at5.y)
      await expectScrubbedTo(window, dur * 0.05, 'a click at 5% of the track')
      await expect(window.getByRole('slider', { name: 'Playhead' })).toBeFocused()

      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        if (!v) throw new Error('__imagiiVideoEl is not set')
        // Capture phase on the element itself runs before React's listener: the store never hears a timeupdate.
        v.addEventListener('timeupdate', (e) => e.stopImmediatePropagation(), { capture: true })
        void v.play()
      })
      await expect.poll(async () => (await videoState(window)).t, { timeout: 10_000 }).toBeGreaterThan(0.9)
      const before = (await videoState(window)).t
      await window.keyboard.press('i')
      const after = (await videoState(window)).t
      await window.evaluate(() =>
        (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl?.pause()
      )
      await expect
        .poll(async () => (await timelineReadouts(window))[0], { timeout: 10_000, message: 'the in point moved to the playing frame' })
        .toBeGreaterThan(0.7)
      const [start] = await timelineReadouts(window)
      // The store's playhead was still at the click (~0.1 s); the picture was at `before`..`after`. The readout
      // truncates to a tenth, so allow that plus the key's own latency.
      expect(start, `In ${start} vs the frame on screen at ${before}-${after}`).toBeGreaterThanOrEqual(before - 0.15)
      expect(start).toBeLessThanOrEqual(after + 0.15)
    } finally {
      await app.close()
    }
  })

  test('timeline: the arrows and , . during playback step from the frame on screen, not the last time the store heard of (T-121)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('timelinestep')
    try {
      await expect
        .poll(async () => (await seekableRanges(window)).dur, { timeout: 20_000 })
        .toBeGreaterThan(FIXTURE_SECONDS)
      const { dur } = await seekableRanges(window)
      // The store never hears a timeupdate, so its playhead stays wherever the last click or key left it while the
      // picture plays on (the capture phase on the element itself runs before React's listener).
      await window.evaluate(() => {
        const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
        if (!v) throw new Error('__imagiiVideoEl is not set')
        v.addEventListener('timeupdate', (e) => e.stopImmediatePropagation(), { capture: true })
      })
      const slider = window.getByRole('slider', { name: 'Playhead' })
      // QA's measurement before the fix: `.` stepped BACK 0.151 s and the right arrow moved +0.053 s (the 0.1 s
      // nudge from a store that trailed by 0.05). The fixture is 15 fps, so a frame is 1/15 s.
      const cases: Array<[string, number]> = [
        ['ArrowRight', 0.1],
        ['ArrowLeft', -0.1],
        ['.', 1 / FIXTURE_FPS],
        [',', -1 / FIXTURE_FPS]
      ]
      for (const [key, delta] of cases) {
        // Park the store's playhead near the start with a click, then let the picture run past it.
        const at5 = await trackPointAt(window, 0.05)
        await window.mouse.click(at5.x, at5.y)
        await expectScrubbedTo(window, dur * 0.05, `a click at 5% of the track before ${key}`)
        await expect(slider).toBeFocused()
        await window.evaluate(() => {
          const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
          void v?.play()
        })
        await expect.poll(async () => (await videoState(window)).t, { timeout: 10_000 }).toBeGreaterThan(0.9)
        const before = (await videoState(window)).t
        await window.keyboard.press(key)
        await window.evaluate(() =>
          (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl?.pause()
        )
        const after = (await videoState(window)).t
        // From the frame on screen: the step plus the little the picture ran between the read and the key and the
        // pause. From the store's stale ~0.1 s it would have landed near 0.2 s (or 0), most of a second away.
        expect(after - before, `${key} moved the playhead from ${before} s to ${after} s`).toBeGreaterThanOrEqual(delta - 0.05)
        expect(after - before, `${key} moved the playhead from ${before} s to ${after} s`).toBeLessThanOrEqual(delta + 0.6)
      }
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
      // T-119 (10): the field shows where the keyboard is. It had `outline-none` and only a background
      // change on focus (1.06:1 against the card), the one such field in the app without a ring. The ring is
      // a box-shadow in the accent color; unfocused, there is none.
      const rename = secondRow.getByRole('textbox')
      const ringOf = (): Promise<string> => rename.evaluate((el) => getComputedStyle(el).boxShadow)
      await rename.blur()
      expect(await ringOf(), 'no ring while the field is not focused').toBe('none')
      await rename.focus()
      expect(await ringOf(), 'a focus ring in the accent color (#ff3131)').toContain('rgb(255, 49, 49)')
      await rename.fill('Intro hook')
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
      // T-112: the selection is said, not only drawn — the selected row (and the button that
      // selects it, where keyboard focus lands) is the current one; the other is not.
      await expect(clipCard.locator('li').first()).toHaveAttribute('aria-current', 'true')
      await expect(secondRow).not.toHaveAttribute('aria-current', /.*/)
      await expect(clipCard.getByRole('button', { name: /^Select clip Clip 1/ })).toHaveAttribute(
        'aria-current',
        'true'
      )
      await expect(clipCard.getByRole('button', { name: /^Select clip Intro hook/ })).not.toHaveAttribute(
        'aria-current',
        /.*/
      )
      // T-112 (label in name): the button's accessible name CONTAINS the timecode it shows, so
      // a person who says what they read ("0:00 → 0:02") reaches it.
      for (const index of [0, 1]) {
        const row = clipCard.locator('li').nth(index)
        const shown = (await row.getByRole('button', { name: /^Select clip/ }).innerText()).trim()
        expect(shown).toMatch(/^\d+:\d{2} → \d+:\d{2}$/)
        const label = await row.getByRole('button', { name: /^Select clip/ }).getAttribute('aria-label')
        expect(label, `the name of row ${index} contains "${shown}"`).toContain(shown)
      }
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

  /**
   * T-80 — clicking inside the field you are typing in is not the end of the
   * edit.
   *
   * T-40 put `onPointerUp={endGesture}` on the panel so a slider release
   * closes the coalescing window. Every pointerup in the panel bubbles to it,
   * including the plain click a user makes to move the caret mid-word — so
   * one rename split into as many undo steps as the user clicked, and the
   * first Undo took back only the tail of it. For text entry the documented
   * gesture end is blur, and blur alone.
   */
  test('clip list: a caret click mid-rename keeps the edit one undo step (T-80)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('caret')
    try {
      const clipCard = clipListCard(window)
      const field = clipCard.locator('li').first().getByRole('textbox')
      const undoButton = window.getByRole('button', { name: 'Undo' })

      // Importing a source resets history, so the rename below is the only
      // step there will ever be — which is what makes "one Undo" exact.
      await expect(undoButton).toBeDisabled()
      await expect(field).toHaveValue('Clip 1')

      // ── type the first half ──
      await field.click()
      await field.press('Control+a')
      await field.pressSequentially('HOOK')
      await expect(field).toHaveValue('HOOK')

      // ── the caret click: a real press and release INSIDE the focused
      //    field, past the end of the text so the caret lands after it ──
      const box = (await field.boundingBox())!
      await window.mouse.move(box.x + box.width - 6, box.y + box.height / 2)
      await window.mouse.down()
      await window.mouse.up()
      await expect(field).toBeFocused()

      // ── type the rest ──
      await field.pressSequentially(' TIME')
      await expect(field).toHaveValue('HOOK TIME')
      await expect(clipCard.getByRole('button', { name: 'Select clip HOOK TIME' })).toBeVisible()

      // ── ONE undo takes back the whole caption ──
      await undoButton.click()
      await expect(field).toHaveValue('Clip 1')
      await expect(undoButton).toBeDisabled()
      // Redo puts the whole edit back in one step too.
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(field).toHaveValue('HOOK TIME')
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
      const cropToggle = window.getByRole('checkbox', { name: 'Crop', exact: true })

      // OutputPreview can only prove the STORE rect cleared if it has
      // something other than black to draw. Since T-38 the first frame is
      // already on the canvas when the import finishes, so this waits for it
      // rather than playing to get one.
      await expect
        .poll(async () => (await canvasSnapshot(window)).h, { timeout: 20_000 })
        .toBe(240)
      const blank = await blackCanvasUrl(window, 135, 240)
      await expect
        .poll(async () => (await canvasSnapshot(window)).url, {
          timeout: 20_000,
          message: 'the preview never drew a frame to compare crops against'
        })
        .not.toBe(blank)

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
      // T-62: through drag.ts. react-rnd writes the live translate into the
      // element's own inline style, so the box `cropBox` reads IS the drawn
      // state — the button comes up only once the move has fully landed.
      const beforeDrag = await cropBox(window)
      const dragBox = (await cropRect.boundingBox())!
      await dragTo(
        window,
        { x: dragBox.x + dragBox.width / 2, y: dragBox.y + dragBox.height / 2 },
        { x: dragBox.x + dragBox.width / 2 - 40, y: dragBox.y + dragBox.height / 2 - 8 },
        {
          extent: {
            label: 'crop rect drag left 40px',
            read: async () => (await cropBox(window)).x,
            settled: (x) => x <= beforeDrag.x - 40 + 0.5
          }
        }
      )
      await expect.poll(async () => (await cropBox(window)).x).toBeCloseTo(beforeDrag.x - 40, 0)
      const afterDrag = await cropBox(window)
      expect(afterDrag.y).toBeCloseTo(beforeDrag.y - 8, 0)
      expect(afterDrag.w).toBeCloseTo(beforeDrag.w, 1)
      expect(afterDrag.h).toBeCloseTo(beforeDrag.h, 1)

      // ── resize from the bottom-right handle (aspect is unlocked) ──
      const handle = cropRect.locator('div[style*="se-resize"]')
      const handleBox = (await handle.boundingBox())!
      await dragTo(
        window,
        { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
        { x: handleBox.x + handleBox.width / 2 + 24, y: handleBox.y + handleBox.height / 2 + 12 },
        {
          extent: {
            label: 'crop se-handle resize +24px',
            read: async () => (await cropBox(window)).w,
            settled: (w) => w >= afterDrag.w + 24 - 0.5
          }
        }
      )
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

  test('overlays: the crop rect and the safe-zone guides sit on the picture, not the letterbox (T-39)', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('overlay-anchor')
    try {
      // The picture has no rectangle until the element knows its intrinsic
      // size, so wait for metadata before measuring anything.
      await expect
        .poll(async () => (await videoState(window)).ready, { timeout: 20_000 })
        .toBeGreaterThan(0)

      const frame = window.locator('[data-tutorial="video-player"] .bg-black')
      // The safe-zone SVG, pinned by the labels it draws: every Icon in the
      // player is an <svg> too, and none of them contains a <text>.
      const guides = window.locator('[data-tutorial="video-player"] svg:has(g > text)')
      const cropRect = window.locator('[data-tutorial="video-player"] .pointer-events-auto.border-2')
      const cropRow = window.locator('[data-tutorial="video-crop"]')

      // ── the crop controls are ABOVE the player, which is where the
      //    tutorial's own copy tells the user to look for them ──
      const rowBefore = await boxOf(cropRow, 'crop row')
      const frameBefore = await boxOf(frame, 'player frame')
      expect(
        rowBefore.y + rowBefore.h,
        'the crop control row must clear the top of the player box'
      ).toBeLessThanOrEqual(frameBefore.y + 1)

      await window.getByRole('checkbox', { name: 'Crop guides' }).check()
      await window.getByRole('checkbox', { name: 'Crop', exact: true }).check()
      await expect(guides).toHaveCount(1)
      await expect(cropRect).toHaveCount(1)

      async function assertAnchored(label: string): Promise<ViewportRect> {
        const picture = await videoContentBox(window)
        const box = await boxOf(frame, 'player frame')
        // There is a letterbox here to get wrong: the black box is far wider
        // than the picture it centers. Without this the assertions below
        // would pass on a wrapper-anchored overlay too.
        expect(box.w, `${label}: the player box really does have bars`).toBeGreaterThan(
          picture.w + 40
        )
        expectSameRect(await boxOf(guides, 'safe-zone svg'), picture, `${label} safe-zone guides`)
        expectSameRect(await boxOf(cropRect, 'crop rect'), picture, `${label} crop rect`)
        return picture
      }

      // Both sizes clear the 1024x640 window minimum (src/main/index.ts).
      await setWindowSize(app, 1100, 700)
      await expect
        .poll(async () => (await boxOf(frame, 'player frame')).w, {
          timeout: 20_000,
          message: 'the player box never followed the window down to 1100 px'
        })
        .toBeLessThan(800)
      const narrow = await assertAnchored('narrow window')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-06-overlay-anchor.png') })

      // ── a second window width moves the picture without resizing it ──
      // The video keeps its 320x240 natural size and slides sideways, so an
      // overlay that only watches the ELEMENT for resizes never hears about
      // this at all.
      await setWindowSize(app, 1560, 980)
      await expect
        .poll(async () => (await videoContentBox(window)).x, {
          timeout: 20_000,
          message: 'the window resize never moved the picture'
        })
        .not.toBe(narrow.x)
      const wide = await assertAnchored('wide window')
      expect(wide.w, 'the picture kept its size across the resize').toBeCloseTo(narrow.w, 0)
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
      // T-92: the player never shows the grade (the encoder applies it), and
      // the card says so before anyone drags a slider looking for a preview.
      await expect(
        gradeCard.getByText('Color changes show up in the exported file, not in this preview.')
      ).toBeVisible()
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

      // T-40: Reset is its own undo step. Every control in this panel shares
      // one coalescing key ("the grade of this clip"), so before the gesture
      // window learned to close, the four slider edits AND the reset were a
      // single step and this Undo landed on the defaults it had just set.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(readouts).toHaveText(['0.25', '1.20', '1.50', '-0.50'])
      // And each slider is a step of its own: undoing again walks back one
      // field, not the whole panel.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(readouts).toHaveText(['0.25', '1.20', '1.50', '+0.00'])
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(readouts).toHaveText(['0.25', '1.20', '1.50', '-0.50'])
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(readouts).toHaveText(['0.00', '1.00', '1.00', '+0.00'])

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
      // Straight to the select: since T-38 the preview draws itself as soon
      // as the import finishes, so there is no edit to make first — only the
      // decoder to wait on, and the canvas says when it has landed.
      const select = window.getByLabel('Preview platform')
      await expect(select).toHaveValue('reels')
      // Reels is 1080x1920, scaled into a 240 px box.
      await expect.poll(async () => (await canvasSnapshot(window)).h, { timeout: 20_000 }).toBe(240)
      const blank = await blackCanvasUrl(window, 135, 240)
      await expect
        .poll(async () => (await canvasSnapshot(window)).url, {
          timeout: 20_000,
          message: 'the preview never drew a frame to compare platforms against'
        })
        .not.toBe(blank)
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

  test('output preview: a freshly imported video draws a real frame with no edit first (T-38)', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('preview-immediate')
    try {
      // Nothing has been clicked since the drop — this is the app exactly as
      // it looks the moment an import finishes.
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()

      // The canvas is sized for the default platform (Reels, 1080x1920 into a
      // 240 px box), not the 300x150 an undrawn <canvas> defaults to.
      await expect.poll(async () => (await canvasSnapshot(window)).h, { timeout: 20_000 }).toBe(240)
      const shot = await canvasSnapshot(window)
      expect(shot.w).toBe(135)

      // …and it carries a decoded frame, not just the black backdrop the
      // draw lays down first.
      const black = await blackCanvasUrl(window, shot.w, shot.h)
      await expect
        .poll(async () => (await canvasSnapshot(window)).url, {
          timeout: 20_000,
          message: 'the preview never drew a video frame'
        })
        .not.toBe(black)

      // Still nothing to undo: the preview did not need an edit to appear.
      await expect(window.getByRole('button', { name: 'Undo' })).toBeDisabled()
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

      // T-17 left the numeric fields in DOM order size, x, y, start, end; T-125 (23) made start and end text boxes (they take
      // 1:30 and 2:47:13), so the number boxes are the first three.
      const numbers = row.locator('input[type="number"]')
      await expect(numbers).toHaveCount(3)
      await numbers.nth(0).fill('72')
      await expect(numbers.nth(0)).toHaveValue('72')

      await row.getByPlaceholder('white or #ffcc00').fill('#ffcc00')
      await expect(row.getByPlaceholder('white or #ffcc00')).toHaveValue('#ffcc00')

      // T-113: the Color box takes a name too, and keeps the code that name stands for.
      const color = row.getByPlaceholder('white or #ffcc00')
      await color.fill('Gold')
      await color.press('Enter')
      await expect(color).toHaveValue('#ffd700')
      // A name imagii does not know is refused in a sentence, here, with the text kept to fix...
      await color.fill('notacolor')
      await color.blur()
      await expect(row.getByRole('alert')).toHaveText(
        "imagii doesn't know that color. Use a name like white or a code like #ffcc00."
      )
      await expect(color).toHaveValue('notacolor')
      // T-114: the box points at its sentence, so focusing it reads the reason - and says nothing extra
      // when there is nothing wrong.
      await expect(color).toHaveAccessibleDescription(
        "imagii doesn't know that color. Use a name like white or a code like #ffcc00."
      )
      await expect(color).toHaveAttribute('aria-invalid', 'true')
      // ...and typing again takes the sentence away.
      await color.fill('white')
      await expect(row.getByRole('alert')).toHaveCount(0)
      await expect(color).toHaveAccessibleDescription('')
      await color.blur()
      await expect(color).toHaveValue('#ffffff')

      // T-113: a size past the range becomes the nearest edge when typing ends, and a size
      // inside it goes straight in (so typing 72 is never turned into 82 on the way).
      await numbers.nth(0).fill('9999')
      await numbers.nth(0).blur()
      await expect(numbers.nth(0)).toHaveValue('512')
      await numbers.nth(0).fill('3')
      await numbers.nth(0).blur()
      await expect(numbers.nth(0)).toHaveValue('8')
      await numbers.nth(0).click()
      await numbers.nth(0).press('Control+a')
      await numbers.nth(0).pressSequentially('72')
      await expect(numbers.nth(0)).toHaveValue('72')

      await numbers.nth(1).fill('0.42')
      await expect(numbers.nth(1)).toHaveValue('0.42')
      await numbers.nth(2).fill('0.66')
      await expect(numbers.nth(2)).toHaveValue('0.66')

      // T-114: both position boxes are named. One <label> wraps the pair, so only the first used to
      // have a name from it ("x / y") and the second had none at all. T-115: the names say what the
      // boxes ARE ("x" and "y" said what they are called), including the range they take.
      await expect(numbers.nth(1)).toHaveAccessibleName('x / y, horizontal position (0 to 1)')
      await expect(numbers.nth(2)).toHaveAccessibleName('x / y, vertical position (0 to 1)')
      await expect(row.getByRole('spinbutton', { name: 'x / y, horizontal position (0 to 1)', exact: true })).toHaveValue('0.42')
      await expect(row.getByRole('spinbutton', { name: 'x / y, vertical position (0 to 1)', exact: true })).toHaveValue('0.66')

      // The two time fields round-trip through the store, which re-formats
      // them to two decimals — proof the value went through the clip.
      // T-123 (3): the boxes keep what is typed until typing ends, so the formatted value is what a commit shows.
      await row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' }).fill('0.4')
      await row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' }).press('Enter')
      await expect(row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' })).toHaveValue('0.40')
      await row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' }).fill('1.6')
      await row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' }).press('Enter')
      await expect(row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' })).toHaveValue('1.60')

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

  test('text overlays: the Time boxes take typed digits (12 is 12, not 1.00), and the end never sits before the start (T-123 (3))', async () => {
    // The Time boxes rewrote their own value to "N.00" on every keystroke (`value={n.toFixed(2)}` and `Number(typed) || 0`): typing
    // "12" gave 1.00, because the "1" came back as "1.00" and the "2" landed after it. `fill` replaces the value in one step, so
    // the case above never saw it. The boxes keep what is typed until typing ends, like Size and Color beside them (T-113).
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('overlay-time')
    try {
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      const start = row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' })
      const end = row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' })
      await expect(start).toHaveValue('0.00')

      // ── typing "12": the box holds what was typed, at every step ──
      await start.click()
      await start.press('Control+a')
      await start.press('Backspace')
      await expect(start, 'emptied: nothing snaps back into it').toHaveValue('')
      await start.press('1')
      await expect(start).toHaveValue('1')
      await start.press('2')
      await expect(start, 'two keys, "12" - not "1.002", not "1.00"').toHaveValue('12')
      // Leaving it commits: the value is formatted, and the end (which was 2 s) is lifted to the new start.
      await leave(start)
      await expect(start).toHaveValue('12.00')
      await expect(end, 'the end cannot sit before the start').toHaveValue('12.00')

      // ── the end box the same way; typed past the start it stays, typed before it is clamped to it ──
      await retype(end, '15.5')
      await expect(end).toHaveValue('15.5')
      await leave(end)
      await expect(end).toHaveValue('15.50')
      await retype(end, '3')
      await expect(end).toHaveValue('3')
      await leave(end)
      await expect(end, 'an end before the start is clamped to the start').toHaveValue('12.00')
      await expect(start).toHaveValue('12.00')

      // ── Enter commits too, and an empty or non-numeric box changes nothing ──
      await retype(start, '4')
      await start.press('Enter')
      await expect(start).toHaveValue('4.00')
      await expect(end).toHaveValue('12.00')
      await start.click()
      await start.press('Control+a')
      await start.press('Backspace')
      await leave(start)
      await expect(start, 'an emptied box goes back to what it was').toHaveValue('4.00')

      // ── the committed numbers are the clip's: they survive a rebuild of the row ──
      await card.getByRole('button', { name: '+ Add text' }).click()
      await expect(card.locator('li')).toHaveCount(2)
      await expect(card.locator('li').first().getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' })).toHaveValue('4.00')
      await expect(card.locator('li').first().getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' })).toHaveValue('12.00')
    } finally {
      await app.close()
    }
  })

  // T-125 (23), (27): the Timeline reads h:mm:ss from an hour up, so the boxes that take a time in the source take it written that way
  // (a stream's own timestamps are "2:47:13"), and a text box can be typed a letter into, so it refuses one in a sentence. Each overlay
  // field's accessible name begins with the text drawn beside it (WCAG 2.5.3): "Overlay start second" sat beside a visible "Source time".
  test('text overlays: the Source time boxes take 1:30 and 2:47:13, refuse what is not a time, and every field is named by the text beside it (T-125 (23), (27))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('overlay-clock')
    try {
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      const start = row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' })
      const end = row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' })
      await expect(start).toHaveValue('0.00')
      await expect(end).toHaveValue('2.00')

      // ── m:ss and h:mm:ss are seconds in the source ──
      await retype(start, '0:01')
      await leave(start)
      await expect(start, 'm:ss').toHaveValue('1.00')
      await retype(end, '1:02:03')
      await leave(end)
      // T-126 (5): at rest the box says the clock from one hour up (it echoed "3723.00" beside a Timeline that reads 1:02:03), and a
      // time typed as a stream writes it stays that way: "2:47:13" is not rewritten to "10033.00" the moment the box is left.
      await expect(end, 'h:mm:ss, 1 h 2 min 3 s, shown as the clock').toHaveValue('1:02:03.00')
      await retype(end, '2:47:13')
      await leave(end)
      await expect(end, 'a stream timestamp stays a stream timestamp').toHaveValue('2:47:13.00')
      await retype(end, '1:02:03')
      await leave(end)
      await expect(end).toHaveValue('1:02:03.00')
      await retype(start, '1:00:00')
      await leave(start)
      await expect(start, 'one hour').toHaveValue('1:00:00.00')
      await expect(end, 'the end stays where it was: it is after the new start').toHaveValue('1:02:03.00')
      await retype(end, '1:00:01.5')
      await leave(end)
      await expect(end, 'a fraction rides on the seconds').toHaveValue('1:00:01.50')
      // Plain seconds still work, and an end typed before the start is held at the start.
      await retype(end, '12.5')
      await leave(end)
      await expect(end, 'before the start: clamped to it').toHaveValue('1:00:00.00')
      // And the clock re-reads as itself: leaving a box that shows "1:00:00.00" again changes nothing.
      await retype(end, '1:00:00.00')
      await leave(end)
      await expect(end).toHaveValue('1:00:00.00')

      // ── what is not a time is refused, in a sentence, with the text kept to fix ──
      const REFUSAL = 'imagii could not read that time. Use seconds like 90.5, or a time like 1:30 or 2:47:13.'
      for (const typed of ['abc', '1:75', '-5', '1:2:3:4', '1:60:00']) {
        await retype(start, typed)
        await leave(start)
        await expect(row.getByRole('alert'), `"${typed}" is refused`).toHaveText(REFUSAL)
        await expect(start, 'and kept, to fix').toHaveValue(typed)
        await expect(start).toHaveAttribute('aria-invalid', 'true')
        await expect(start).toHaveAccessibleDescription(REFUSAL)
      }
      expect(await readToastLog(window), 'a refused time is the box\'s sentence, not a toast').not.toContain(REFUSAL)
      // The overlay kept what it had (nothing the refused text said reached it), typing again takes the sentence away, and a good time lands.
      await start.press('Control+a')
      await start.press('Backspace')
      await expect(row.getByRole('alert')).toHaveCount(0)
      await start.press('2')
      await leave(start)
      // T-127 (7): the end is still at one hour, so the PAIR is the clock: the start (2 s) reads "0:02.00", not "2.00" beside a clock.
      await expect(start).toHaveValue('0:02.00')
      await expect(row.getByRole('alert')).toHaveCount(0)
      // An emptied box commits nothing and says nothing.
      await start.click()
      await start.press('Control+a')
      await start.press('Backspace')
      await leave(start)
      await expect(start).toHaveValue('0:02.00')
      await expect(row.getByRole('alert')).toHaveCount(0)

      // ── T-127 (7): the PAIR decides the form, both ways (each box picked its own: "3590.00 -> 1:00:10.00 s") ──
      // Over: the end is at one hour, so the start reads as the clock too and there is no "s" after the end.
      await expect(end).toHaveValue('1:00:00.00')
      await expect(row.getByText('s', { exact: true }), 'a clock has no unit').toHaveCount(0)
      // Under: the end back below an hour, and both are seconds, with the unit.
      await retype(end, '30')
      await leave(end)
      await expect(start, 'both under an hour: seconds').toHaveValue('2.00')
      await expect(end).toHaveValue('30.00')
      await expect(row.getByText('s', { exact: true }), 'and the "s" is back').toHaveCount(1)
      // Over from the other side: the START at an hour lifts the end to it, and both are the clock again.
      await retype(start, '1:00:00')
      await leave(start)
      await expect(start).toHaveValue('1:00:00.00')
      await expect(end, 'the end is lifted to the start').toHaveValue('1:00:00.00')
      await expect(row.getByText('s', { exact: true })).toHaveCount(0)
      // The span of the pair across the line: 59:50 to 1:00:10 reads as one form.
      await retype(start, '3590')
      await leave(start)
      await retype(end, '3610')
      await leave(end)
      await expect(start, 'under an hour, beside an end over it: the clock').toHaveValue('59:50.00')
      await expect(end).toHaveValue('1:00:10.00')
      await retype(start, '2')
      await leave(start)
      await expect(start).toHaveValue('0:02.00')

      // ── (27) every field is named by the text drawn beside it ──
      const labels = row.locator('label')
      const count = await labels.count()
      let checked = 0
      for (let i = 0; i < count; i++) {
        const label = labels.nth(i)
        const visible = ((await label.locator('span.text-ink-muted').first().textContent()) ?? '').trim()
        if (!visible) continue
        const controls = label.locator('input, select')
        for (let j = 0; j < (await controls.count()); j++) {
          const escaped = visible.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
          await expect(controls.nth(j), `the field beside "${visible}" is named by it`).toHaveAccessibleName(new RegExp(`^${escaped}`))
          checked += 1
        }
      }
      // Font, Size (px), Color (a DraftField's own row), x / y twice and Source time start: six of the seven fields draw a label.
      expect(checked, 'the loop looked at the card\'s labelled fields').toBeGreaterThanOrEqual(6)
      await expect(row.getByRole('spinbutton', { name: 'x / y, horizontal position (0 to 1)', exact: true })).toBeVisible()
      await expect(row.getByRole('spinbutton', { name: 'x / y, vertical position (0 to 1)', exact: true })).toBeVisible()
      await expect(row.getByRole('textbox', { name: 'Overlay start second' }), 'the old names are gone').toHaveCount(0)
      await expect(row.getByRole('spinbutton', { name: 'Overlay horizontal position (0 to 1)' })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('text overlays: the position boxes take a leading decimal (.5 is 0.5, not 1), and a typed number is held to 0 to 1 (T-124 (15))', async () => {
    // The x / y boxes were controlled by `Math.min(1, Math.max(0, Number(e.target.value) || 0))` on every keystroke, and a number
    // input reports "" for a lone ".", which became 0 and rewrote the box: ".5" was "05", then 1, and ".25" was 1.
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('overlay-position')
    try {
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      const x = row.getByRole('spinbutton', { name: 'x / y, horizontal position (0 to 1)' })
      const y = row.getByRole('spinbutton', { name: 'x / y, vertical position (0 to 1)' })
      await expect(x).toHaveValue('0.1')

      for (const [typed, shown] of [
        ['.25', '0.25'],
        ['0.75', '0.75'],
        ['.5', '0.5'],
        // T-125 (8): a "0" is already a number in range, so it went to the overlay and the box was rewritten to the stored "0"; the
        // "." then read as "" (a number input's value for "0.") and the next digits stacked up behind a lost dot: "0.05" became 1.
        ['0.05', '0.05']
      ] as const) {
        await x.click()
        await x.press('Control+a')
        await x.press('Backspace')
        await expect(x, 'emptied: nothing snaps back into it').toHaveValue('')
        // The lone "." is nothing a number input can report: the box must not rewrite itself to 0 (which made the next digit "05").
        await x.press('.')
        await expect(x, 'a lone "." is not turned into 0').toHaveValue('')
        await x.press('Control+a')
        await x.press('Backspace')
        await x.pressSequentially(typed)
        // Usable as typed, so the overlay follows the keys - and the box keeps what is TYPED while it has focus (T-125 (8): a box that
        // swaps in the stored number mid-word rewrites "0.05" into 1), then shows the stored number when it is left.
        await expect(x, `"${typed}" stays as typed while the box has focus`).toHaveValue(typed)
        await leave(x)
        await expect(x, `"${typed}" is ${shown}, not 1`).toHaveValue(shown)
        // ...and the overlay really has it (the store followed the keys): the box reads it back after a trip off and on.
        await x.focus()
        await expect(x).toHaveValue(shown)
        await leave(x)
      }

      await retype(y, '.3')
      // T-125 (8): while the box has focus it shows what was typed (the store already has 0.3), and the stored form once it is left.
      await expect(y).toHaveValue('.3')
      await leave(y)
      await expect(y).toHaveValue('0.3')
      // Past the range is the nearest edge when typing ends, and an emptied box commits nothing.
      await retype(y, '7')
      await leave(y)
      await expect(y).toHaveValue('1')
      await retype(x, '-2')
      await leave(x)
      await expect(x).toHaveValue('0')
      await x.click()
      await x.press('Control+a')
      await x.press('Backspace')
      await leave(x)
      await expect(x, 'an emptied box goes back to what it was').toHaveValue('0')
    } finally {
      await app.close()
    }
  })

  // T-124 (18), (19): the overlay's Time boxes are seconds in the SOURCE video, and a window that never meets the selected clip draws
  // nothing: the export finishes cleanly with the text missing and nothing says why. Nothing previews an overlay either (the player
  // draws the picture only), which BRANDING says a control says in one line.
  test('text overlays: the Time boxes say they are source time, a window that misses the clip is flagged, and the card says nothing previews it (T-124 (18), (19))', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('overlay-window')
    try {
      const card = overlayCard(window)
      // Before an overlay exists the card has its own sentence; the no-preview line arrives with the first one.
      await expect(card.getByText('Text appears in the exported file, not in the player.')).toHaveCount(0)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      await expect(
        card.getByText('Text appears in the exported file, not in the player. Times are seconds in the source video, or a time like 2:47:13.'),
        'the card says nothing previews an overlay, and what its times are'
      ).toBeVisible()
      await expect(row.getByText('Source time', { exact: true })).toBeVisible()

      const start = row.getByRole('textbox', { name: 'Source time, start (seconds, or a time like 2:47:13)' })
      const end = row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' })
      const status = row.getByRole('status')
      // The untouched overlay spans the clip (0 to 2 s here): nothing to warn about, and the live region is there but empty.
      await expect(start).toHaveValue('0.00')
      await expect(end).toHaveValue('2.00')
      await expect(status).toHaveText('')

      // A window after the clip: flagged, with the clip's own range, in the live region.
      await retype(start, '5')
      await leave(start)
      await retype(end, '8')
      await leave(end)
      await expect(status, 'a window that misses the clip draws nothing, and the card says so').toHaveText(
        "This text won't show in the export: its times fall outside the clip, which runs from 0.00 to 2.00 s of the video."
      )
      // Back over the clip: the warning goes.
      await retype(start, '1')
      await leave(start)
      await expect(status).toHaveText('')
      // A window that only opens as the clip ends shows nothing either (half-open against the clip's end).
      await retype(start, '2')
      await leave(start)
      await expect(status).toContainText("won't show in the export")
      // T-125 (14): an end typed before the start is clamped TO the start, and a window of no length is never on screen wherever it
      // sits - inside the clip (start 1) as much as outside it. Its sentence is the true one ("its times fall outside the clip" is
      // false for a window inside it), and it is the same on both sides of the clip's edge.
      const ZERO = "This text won't show in the export: its start and end are the same, so it never shows."
      await retype(start, '1')
      await leave(start)
      await retype(end, '1')
      await leave(end)
      await expect(end, 'the end is the start').toHaveValue('1.00')
      await expect(status, 'inside the clip, and still a window of no length').toHaveText(ZERO)
      await expect(status).not.toContainText('fall outside the clip')
      await retype(start, '5')
      await leave(start)
      await expect(end, 'the end follows the start up').toHaveValue('5.00')
      await expect(status, 'outside the clip, the same window of no length').toHaveText(ZERO)
      // A window with any length goes back to the sentence about the clip (or to none).
      await retype(end, '5.5')
      await leave(end)
      await expect(status).toHaveText(
        "This text won't show in the export: its times fall outside the clip, which runs from 0.00 to 2.00 s of the video."
      )
      await retype(start, '0.5')
      await leave(start)
      await expect(status, 'a window of 5 s over a 2 s clip meets it: nothing to say').toHaveText('')
    } finally {
      await app.close()
    }
  })

  test('the clip speed says it is applied when you export, and that the player plays at normal speed (T-124 (19))', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('speed-disclosure')
    try {
      await expect(window.getByText('Speed is applied when you export. The player here always plays at normal speed.')).toBeVisible()
      // And it is true: moving the slider does not change what the player plays.
      const slider = window.getByRole('slider', { name: 'Clip playback speed' })
      await slider.press('End')
      await expect(slider).toHaveValue('4')
      const rate = await window.evaluate(() => (document.querySelector('video') as HTMLVideoElement).playbackRate)
      expect(rate, 'the player\'s own playback rate').toBe(1)
    } finally {
      await app.close()
    }
  })

  // T-124 (23): the Text overlays card was visibly broken at the default window. Its rows were two columns of a 230 px card: the Font
  // select (`flex-1`, no `min-w-0`) ran under "Size", the "x / y" label (`w-12`) was squeezed onto three lines, the Time row was
  // 41 px wider than its cell and the remove cross sat 12 px outside the card. Nothing in the behavior case could see any of it:
  // `fill()` and `click()` scroll a control into view and do not care what it is drawn over.
  test('the Text overlays card draws every control whole, on one line and over nothing else, at the default window and the minimum (T-124 (23))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('overlay-layout')
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      await expect(row).toHaveCount(1)
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await resizeAndSettle(app, window, size)
        await expectNoHorizontalOverflow(card, `the Text overlays card at ${where}`)
        const controls = row.locator('input, select, button')
        await expectControlsWhole(card, controls.filter({ hasNot: window.locator('select') }), `the overlay's boxes and buttons at ${where}`)
        await expectSelectsWhole(card, row.locator('select'), `the overlay's Font select at ${where}`)
        // The labels each fit on one line: "x / y" was drawn as "x", "/", "y". T-125 (16): and "Size (px)" is one of them.
        await expect(row.getByText('Size (px)', { exact: true }), `the Size label says what it counts, at ${where}`).toBeVisible()
        await expectOneLine(row.locator('label > span.text-ink-muted'), `the overlay's labels at ${where}`)
        // And nothing is painted over anything else (the Font select ran under "Size").
        await expectNoOverlap(row.locator('input, select, button, label > span'), `the overlay's controls at ${where}`)
        // The remove cross is inside the card.
        await expectControlsWhole(card, row.getByRole('button', { name: 'Remove overlay' }), `the remove cross at ${where}`)
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-overlay-layout-min.png') })
    } finally {
      await app.close()
    }
  })

  // T-125 (17): the Source time row wraps in a card this narrow, and as three flex items it broke between the arrow and its box, leaving
  // "→" at the end of the first line with "[end] s" under it. Nothing is clipped, overlapped or cut, so the other layout checks pass.
  test('the Source time row keeps the arrow with its end box and its "s", at the default window and the minimum (T-125 (17))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('overlay-arrow')
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      const problems: string[] = []
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await resizeAndSettle(app, window, size)
        try {
          await expectSameRow(
            [
              { name: 'the arrow', locator: row.locator('span.text-ink-dim', { hasText: '→' }) },
              { name: 'the end box', locator: row.getByRole('textbox', { name: 'Source time, end (seconds, or a time like 2:47:13)' }) },
              { name: 'the "s"', locator: row.locator('span.text-ink-dim', { hasText: /^s$/ }) }
            ],
            `the Source time row's end half at ${where}`
          )
        } catch (e) {
          problems.push(((e as Error).message.split('\n')[0] ?? '').replace(/\u001b\[[0-9;]*m/g, ''))
        }
      }
      expect(problems, 'the arrow, the end box and "s" share a line at every window size').toEqual([])
    } finally {
      await app.close()
    }
  })

  // T-126 (3): a Source time box has no label of its own (the row's "Source time" is the caller's), and its refusal sentence used to be
  // drawn BESIDE the box in the same flex row: an ~8-line column 70 px wide at the card's 224 px row, and for the end box a sentence
  // between the box and its "s". Text and aria were pinned; where the sentence is drawn was not. It is now a full-width row of its own,
  // under the box, after everything else in the row.
  test('a refused Source time is one full-width sentence under its box, over nothing, at the default window and the minimum (T-126 (3))', async () => {
    test.setTimeout(120_000)
    const { app, window } = await launchWithVideo('overlay-refusal-layout')
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      const card = overlayCard(window)
      await card.getByRole('button', { name: '+ Add text' }).click()
      const row = card.locator('li')
      const alert = row.getByRole('alert')
      const REFUSAL = 'imagii could not read that time. Use seconds like 90.5, or a time like 1:30 or 2:47:13.'
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
        await resizeAndSettle(app, window, size)
        for (const which of ['start', 'end'] as const) {
          const box = row.getByRole('textbox', { name: `Source time, ${which} (seconds, or a time like 2:47:13)` })
          await retype(box, 'abc')
          await leave(box)
          const what = `the ${which} box's refusal at ${where}`
          await expect(alert, `${what}: shown, once`).toHaveCount(1)
          await expect(alert).toHaveText(REFUSAL)
          const m = await alert.evaluate((el, boxSelector) => {
            const li = el.closest('li') as HTMLElement
            const input = li.querySelector(boxSelector) as HTMLElement
            const lr = li.getBoundingClientRect()
            const cs = getComputedStyle(li)
            const inner = lr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - li.clientLeft * 2
            const a = el.getBoundingClientRect()
            const b = input.getBoundingClientRect()
            return {
              width: a.width,
              inner,
              top: a.top,
              boxBottom: b.bottom,
              left: a.left,
              rowLeft: lr.left + parseFloat(cs.paddingLeft),
              lines: a.height / (parseFloat(getComputedStyle(el).lineHeight) || 16)
            }
          }, `input[aria-label="Source time, ${which} (seconds, or a time like 2:47:13)"]`)
          await check(async () => expect(m.top, `${what}: the sentence is UNDER its box, not beside it`).toBeGreaterThanOrEqual(m.boxBottom - 1))
          await check(async () => expect(m.width, `${what}: full width (${Math.round(m.width)} px of a ${Math.round(m.inner)} px row)`).toBeGreaterThanOrEqual(m.inner * 0.9))
          await check(async () => expect(m.left, `${what}: and starts at the row's left edge`).toBeLessThanOrEqual(m.rowLeft + 2))
          await check(async () => expect(m.lines, `${what}: one column of at most four lines, not a sliver`).toBeLessThanOrEqual(4.5))
          await check(() => expectControlsWhole(card, alert, `${what} (inside the card)`))
          // And the sentence does not pull the row apart: the end box keeps its arrow and its "s" on ITS line (the sentence is drawn last), the
          // start box keeps "Source time" on its line.
          await check(() =>
            expectSameRow(
              which === 'end'
                ? [
                    { name: 'the arrow', locator: row.locator('span.text-ink-dim', { hasText: '→' }) },
                    { name: 'the end box', locator: box },
                    { name: 'the "s"', locator: row.locator('span.text-ink-dim', { hasText: /^s$/ }) }
                  ]
                : [
                    { name: '"Source time"', locator: row.getByText('Source time', { exact: true }) },
                    { name: 'the start box', locator: box }
                  ],
              `the ${which} half of the Source time row, with its refusal showing, at ${where}`
            )
          )
          await check(() => expectNoOverlap(row.locator('input, select, button, label > span, [role="alert"]'), `the overlay's controls and sentence at ${where}`))
          // Typing a good time takes the sentence away and leaves the row as it was.
          await retype(box, which === 'start' ? '0' : '2')
          await leave(box)
          await expect(alert).toHaveCount(0)
        }
      }
      expect(problems, 'a refusal is a full-width sentence under its box at every window size').toEqual([])
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
      await expect(waveform.getByText('48000 Hz · 2 ch', { exact: false })).toBeVisible({
        timeout: 30_000
      })
      // ...and it carries the same 2 s of audio the video did.
      await expect(waveform.getByText(`/ 0:0${FIXTURE_SECONDS}.`, { exact: false })).toBeVisible()
      // T-108: the header names the VIDEO the sound came from. It used to show the extracted
      // WAV's random scratch name ("aB3dE5fG7h.wav"), a file the person never chose.
      await expect(window.locator('header').getByText('video-core.mp4', { exact: true })).toBeVisible()
      await expect(window.locator('header').getByText(/\.wav$/)).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'video-core-06-clean-audio.png') })

      // T-70: the recorder reads react-hot-toast's own `[role="status"]`
      // node, so the toast is one entry of its own — the route change that
      // inserts a whole studio's subtree around it no longer swallows it into
      // a larger record, and this can be the exact sentence.
      expect(await readToastLog(window)).toContain('Opening Audio Studio')
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
      expect(messages[0]).toBe('Close this video? 1 clip and its edits will be discarded.')
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

  // T-125 (24): Clip Kit writes a whole posting folder (a version per platform, three thumbnails, the captions) and was the one feature
  // nothing in the tour mentioned. The step points at the button, so the highlight must sit on it.
  test('the Video tour introduces Clip Kit after Export, and its highlight sits on the Clip Kit button (T-125 (24))', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('tour-clipkit')
    try {
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const coachmark = window.getByRole('dialog')
      const heading = coachmark.locator('h3')
      const seen: string[] = []
      for (let i = 0; i < 16; i++) {
        seen.push(((await heading.textContent()) ?? '').trim())
        if (seen[seen.length - 1] === 'Clip Kit') break
        await coachmark.getByRole('button', { name: /Next/ }).click()
      }
      expect(seen[seen.length - 1], `the tour reached a Clip Kit step (saw ${seen.join(' > ')})`).toBe('Clip Kit')
      expect(seen[seen.length - 2], 'it follows Export').toBe('Export')
      await expect(coachmark).toContainText(
        "Select a clip and click 'Clip Kit' to export it for all five platforms, plus three thumbnails, into one new folder."
      )
      // The accent outline is drawn 8 px outside the target, and the step scrolls the target into view on arrival.
      const button = window.getByRole('button', { name: /^Clip Kit/ })
      await expect(button).toBeVisible()
      await expect
        .poll(
          async () => {
            const box = await button.boundingBox()
            const ring = await window.locator('svg rect[fill="none"][rx="10"]').evaluate((el) => ({
              x: Number(el.getAttribute('x')),
              y: Number(el.getAttribute('y')),
              w: Number(el.getAttribute('width')),
              h: Number(el.getAttribute('height'))
            }))
            if (!box) return 'no button box'
            const off = [ring.x - (box.x - 8), ring.y - (box.y - 8), ring.w - (box.width + 16), ring.h - (box.height + 16)]
            return off.every((d) => Math.abs(d) <= 2) ? 'on the button' : `outline off the button by ${off.map(Math.round).join(', ')}`
          },
          { timeout: 10_000, intervals: [200] }
        )
        .toBe('on the button')
      // And the tour carries on to its close.
      await coachmark.getByRole('button', { name: /Next/ }).click()
      await expect(heading).toHaveText("You're all set")
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
