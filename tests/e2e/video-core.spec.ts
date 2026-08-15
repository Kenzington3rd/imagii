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
 * ── Two product findings this spec had to work around ─────────────────
 *
 * BUG-SEEK — the loaded video is NOT seekable. `imagii-file://` responses
 * come from `net.fetch(file://…)` (src/main/protocol.ts:43), which ignores
 * Range requests, so Chromium reports `video.seekable` as [0, 0] even with
 * the whole file buffered. Every assignment to `currentTime` therefore
 * clamps to 0: the arrow nudges and the `,` / `.` frame steps (and the two
 * frame buttons) reset the playhead instead of moving it. The bindings
 * themselves are proven here by recording the seek each one REQUESTS on the
 * media element (`installSeekLog`) — the request carries the exact nudge and
 * frame math — and the playhead is parked at a non-zero position the only
 * way that works today: by playing and pausing.
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
): Promise<{ t: number; paused: boolean; ended: boolean; ready: number }> {
  return window.evaluate(() => {
    const v = (window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl
    if (!v) throw new Error('__imagiiVideoEl is not set')
    return { t: v.currentTime, paused: v.paused, ended: v.ended, ready: v.readyState }
  })
}

/**
 * Keep every parked playhead inside the first 1.2 s of a 2 s fixture: far
 * enough from the end that a 0.5 s park cannot run off it, and far enough
 * that `nudge`'s own clamp to the source duration never truncates a
 * requested seek.
 */
const PARK_CEILING = 1.2

/**
 * BUG-SEEK workaround: the only way to put the playhead anywhere but 0 is to
 * play and pause. Returns the position it parked at.
 */
async function parkPlayhead(window: Page, ms: number): Promise<number> {
  const before = await videoState(window)
  if (!before.ended && before.t + ms / 1000 > PARK_CEILING) {
    // Out of runway. Run the clip out instead of rewinding: play() on an
    // ended element restarts at 0, the only reposition BUG-SEEK allows.
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
 * binding REQUESTS is observable. Needed because BUG-SEEK clamps every
 * request to 0 before it can be read back — the request itself is the
 * deepest end state the renderer can reach today. Forwards to the real
 * setter, so the clamp still happens and can be asserted alongside.
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

  test('player keyboard: nudges and frame steps issue exact seeks, I and O move the clip range', async () => {
    test.setTimeout(90_000)
    const { app, window } = await launchWithVideo('keyboard')
    try {
      const player = window.locator('[data-tutorial="video-player"] [tabindex="0"]')
      await player.focus()

      // ── I / O: the two bindings whose end state IS reachable ──
      // (setMarker reads the media element's position and writes the store's
      // clip range, so parking the playhead by playback is enough.)
      const inPoint = await parkPlayhead(window, 400)
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

      const outPoint = await parkPlayhead(window, 500)
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
      // BUG-SEEK (file header): the source is not seekable, so the playhead
      // cannot land on the requested position. What IS assertable is the seek
      // each binding asks the media element for — which carries the whole
      // contract: 0.1 s for the arrows, exactly one frame for , and .
      const frame = 1 / FIXTURE_FPS
      await installSeekLog(window)
      const cases: Array<{ key: string; delta: number }> = [
        { key: 'ArrowRight', delta: 0.1 },
        { key: 'ArrowLeft', delta: -0.1 },
        { key: '.', delta: frame },
        { key: ',', delta: -frame }
      ]
      for (const { key, delta } of cases) {
        const parked = await parkPlayhead(window, 300)
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
      }

      // And the clamp itself, asserted once: today the playhead lands on 0
      // instead of the requested position. When src/main/protocol.ts serves
      // Range requests this line flips to the requested value and the ledger
      // rows for the nudges and frame steps stop needing BUG-SEEK.
      expect((await videoState(window)).t).toBe(0)

      // ── the two frame-step buttons issue the same seeks ──
      for (const [title, delta] of [
        ['Previous frame (,)', -frame],
        ['Next frame (.)', frame]
      ] as Array<[string, number]>) {
        const parked = await parkPlayhead(window, 300)
        await clearSeekLog(window)
        await window.getByTitle(title).click()
        expect(await lastSeekRequest(window)).toBeCloseTo(parked + delta, 5)
      }
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

      async function dragHandle(label: string, toRatio: number): Promise<void> {
        const handle = window.getByRole('button', { name: label })
        const box = (await handle.boundingBox())!
        await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await window.mouse.down()
        await window.mouse.move(
          trackBox.x + trackBox.width * toRatio,
          trackBox.y + trackBox.height / 2,
          { steps: 8 }
        )
        await window.mouse.up()
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
