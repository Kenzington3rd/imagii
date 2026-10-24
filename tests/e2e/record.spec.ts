import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { installSpawnStall } from './mainSpawn'
import { installToastLog, readToastEntries, readToastLog } from './toastLog'
import { readRevealCalls, stubShellReveal } from './shellReveal'
import { localDay, skewTimeZone, utcDay } from './skewedClock'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-27: Record Studio — everything the ledger marked headless-limited,
 * driven for real.
 *
 * The ledger's Record row (17 elements, 13 HL) assumed desktopCapturer,
 * MediaRecorder and the media devices are all absent headless. A probe run
 * before this spec was written found that only ONE of those three is true
 * on this Linux/xvfb Electron 31 box:
 *
 *   - `desktopCapturer.getSources()` returns a real "Entire screen" source
 *     with a non-empty thumbnail.
 *   - `getUserMedia({ chromeMediaSource: 'desktop' })` returns a live
 *     1280x1024@30 video track for that source id.
 *   - `MediaRecorder` exists and produces real vp9/vp8 webm bytes from a
 *     canvas captureStream.
 *   - `enumerateDevices()` returns NOTHING — there is no microphone and no
 *     camera in the container, and Chromium's
 *     `--use-fake-device-for-media-capture` switch does not take through
 *     Electron's command line (probed both before and after the app path).
 *
 * So the screen-capture half of the pipeline is covered here end to end —
 * sources grid, selection, Start, elapsed timer, Stop, Esc, the native
 * save dialog (stubbed in MAIN, not in the renderer), the ffmpeg convert,
 * the bytes on disk, the toast and both of its actions. The mic/webcam
 * half stays a Windows hand-test (see the T-27 report's HAND-TEST block),
 * and its zero-device UI branches are pinned here because that IS the
 * state a user with no mic/cam plugged in sees.
 *
 * House patterns are export.spec's and home-chrome.spec's: a hermetic
 * per-test userData dir seeded on disk BEFORE launch, a MutationObserver
 * toast log installed before the action that raises the toast, and
 * assertions that land on the FILE the interaction wrote (config.json, the
 * saved recording, userData/recordings) rather than on renderer state
 * alone.
 *
 * Product defects found while writing this spec. None is fixed here (T-27
 * is a coverage ticket and touches no `src/`); each is asserted at the
 * boundary where it actually bites and carries a `T-27 FINDING` comment
 * at that assertion:
 *   A. Zero sources was indistinguishable from never-searched. When
 *      desktopCapturer returned [], `chooseSource` set phase 'choosing'
 *      but the idle and choosing branches rendered identically, so the user
 *      got the same "Pick a screen or window" button back with no "no
 *      screens found" message, no error toast, and no spinner. Clicking
 *      Refresh sources on a box with nothing to capture looked like a dead
 *      button.
 *      FIXED 2026-08-17 by T-41, and this spec's zero-sources test is now
 *      the positive: the ambiguous 'choosing' phase is gone, replaced by a
 *      three-state `sourceSearch` ('never' | 'searching' | 'done') whose
 *      renders differ — the invitation, "Looking for screens and windows…"
 *      with the button disabled, and the amber "No screens or windows
 *      found." twin of the mic/camera warnings. The rejected-IPC branch
 *      (capture blocked outright, rather than empty) is driven too, so the
 *      wait can never stick on screen.
 *   B. "Include webcam in recording" had no zero-camera hint. The Audio
 *      card renders "No microphone found." when `mics` is empty; the
 *      Webcam card rendered nothing at all when `cams` is empty — the
 *      checkbox stayed ticked, the Corner select appeared, and recording
 *      then silently produced screen-only video because
 *      `effectiveCamId` is null and the compositor branch was skipped
 *      without a toast.
 *      FIXED 2026-08-16 by T-42, and this spec's webcam tests are now the
 *      positives: the zero-camera branch renders the mic warning's twin,
 *      the Corner picker is gated on there being a camera to put in a
 *      corner, and starting a take with the box ticked raises the existing
 *      webcam-failure toast rather than proceeding in silence. The
 *      WITH-a-camera half is driven by stubbing `enumerateDevices` in the
 *      renderer (see `stubCameras`), which also lifts the Webcam `<select>`
 *      out of the HL block it sat in.
 *   C. The MP4 checkbox was the only Record preference that did not
 *      persist. `record.webcamCorner` was written to config.json on every
 *      change; `convertToMp4` was component-local `useState(true)`, so a
 *      user who wanted WebM re-ticked it on every single visit to the
 *      route — including after a mid-session trip to Home.
 *      FIXED 2026-08-17 by T-43 together with D: `record.convertToMp4` is
 *      a settings key like the corner, and the MP4 test below is now the
 *      positive (written on change, restored by a second launch).
 *   E. "Discard recording" reported as a crash and stranded a broken file.
 *      FIXED 2026-08-15 by T-44, and this spec's discard test is now the
 *      positive: cancelConverts('recording') marks the child as
 *      user-cancelled, so convertToMp4 rejects with
 *      ConvertCancelledError instead of an exit-signal error,
 *      promoteTempWebm reaps the half-written .mp4 at the user's chosen
 *      path, and finalize resolves null — the same "nothing was saved"
 *      answer the cancelled save dialog gives, which the renderer already
 *      renders as the calm "Recording discarded". A real convert failure
 *      still rejects; since T-59 it reaps its partial too and rejects in
 *      the studio's own words, driven by the crash test below.
 *   D. Visiting /record wrote to config.json with no user action. The
 *      corner-persist effect had no "did the user touch it" guard, so
 *      mounting the route stamped `record.webcamCorner: "bottom-right"`
 *      over an absent key. Harmless in value (it equalled the default) but
 *      it meant the settings file was written by navigation alone.
 *      FIXED 2026-08-17 by T-43: there is no persist effect at all now.
 *      Each control writes its own choice in its `onChange`, so a write is
 *      a user action by construction, and the mount effect only reads. Both
 *      persistence tests below assert the file is byte-identical after an
 *      untouched visit.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

/** All four tutorial flags — the seed that keeps a coachmark off the page. */
const ALL_TUTORIALS_SEEN = { video: true, audio: true, image: true, ai: true }

interface SeedConfig {
  welcomeSeen?: boolean
  tutorialSeen?: Partial<Record<'video' | 'audio' | 'image' | 'ai', boolean>>
  record?: { webcamCorner?: string }
  recentFiles?: Partial<Record<'video' | 'audio' | 'image', string[]>>
}

interface StoredConfig {
  welcomeSeen?: boolean
  record?: { webcamCorner?: string; convertToMp4?: boolean }
  recentFiles?: Record<string, string[]>
}

/**
 * electron-store nests dotted keys (accessPropertiesByDotNotation defaults to
 * true), so `record.webcamCorner` lands on disk as `{ record: { webcamCorner } }`
 * — the same shape smoke.spec, export.spec and home-chrome.spec write.
 */
function seedUserData(userDataDir: string, config: SeedConfig): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
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

/** The main-process temp dir every streaming session writes its .webm into. */
function recordingsDir(userDataDir: string): string {
  return path.join(userDataDir, 'recordings')
}

/** Partial .webm files left behind by begin/appendChunk with no finalize. */
function leftoverTemps(userDataDir: string): string[] {
  const dir = recordingsDir(userDataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.webm'))
}

function runBinary(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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

interface ProbeStream {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
}

interface ProbeJson {
  streams?: ProbeStream[]
  format?: { format_name?: string; duration?: string }
}

/** Read the saved recording back with the repo's own bundled ffprobe. */
async function probeFile(filePath: string): Promise<ProbeJson> {
  const result = await runBinary(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    filePath
  ])
  if (result.code !== 0) {
    throw new Error(`ffprobe exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
  return JSON.parse(result.stdout) as ProbeJson
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
 * Replace `dialog.showSaveDialog` in the MAIN process. The renderer half is
 * untouchable (contextBridge objects are frozen), and the save dialog is the
 * one thing standing between `recording:finalize` and a real file, so it is
 * stubbed exactly where Electron owns it. `filePath: null` stubs the Cancel
 * branch. Every other byte of the save path — the write stream, the
 * temp-file promotion, the ffmpeg convert, the stat — runs for real.
 */
async function stubSaveDialog(
  app: ElectronApplication,
  filePath: string | null,
  delayMs = 0
): Promise<void> {
  await app.evaluate(
    async ({ dialog }, { chosen, delay }) => {
      const g = globalThis as unknown as { __saveDialogOptions: Array<{ title?: string }> }
      g.__saveDialogOptions = []
      const target = dialog as unknown as { showSaveDialog: unknown }
      // T-88: the options the OS dialog would have been opened with are
      // recorded (its title is what tells the user Cancel discards the take),
      // and `delay` holds the "dialog" open the way a person reading it does —
      // the saving card is on screen for exactly that long, which makes its
      // per-state copy assertable without racing a copy that takes ms.
      target.showSaveDialog = async (_win: unknown, options: { title?: string }) => {
        g.__saveDialogOptions.push(options)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        return chosen === null
          ? { canceled: true, filePath: undefined }
          : { canceled: false, filePath: chosen }
      }
    },
    { chosen: filePath, delay: delayMs }
  )
}

/** The `defaultPath` every stubbed save dialog was opened with, in order (T-117: the take's suggested name). */
function readSaveDialogDefaults(app: ElectronApplication): Promise<Array<string | undefined>> {
  return app.evaluate(() =>
    (
      (globalThis as unknown as { __saveDialogOptions?: Array<{ defaultPath?: string }> })
        .__saveDialogOptions ?? []
    ).map((o) => o.defaultPath)
  )
}

/** What the source list says when it cannot be listed (T-117: it showed main's own string as written). */
const LIST_FAILED = "Couldn't list what can be recorded."

/** The titles every stubbed save dialog was opened with, in order (T-88). */
function readSaveDialogTitles(app: ElectronApplication): Promise<Array<string | undefined>> {
  return app.evaluate(() =>
    (
      (globalThis as unknown as { __saveDialogOptions?: Array<{ title?: string }> })
        .__saveDialogOptions ?? []
    ).map((o) => o.title)
  )
}

/**
 * Force `desktopCapturer.getSources` to return an empty list. The xvfb box
 * always has exactly one screen, so the zero-sources branch — a real state on
 * a locked workstation or a permissions-denied macOS/Wayland session — can
 * only be reached by making main answer the way those systems answer.
 *
 * `delayMs` holds the answer back so the in-flight state T-41 added is a
 * state a test can see: a real `getSources` call with thumbnails takes long
 * enough to be worth saying "Looking for…" about, and an instant stub does
 * not.
 */
async function stubEmptySources(app: ElectronApplication, delayMs: number): Promise<void> {
  await app.evaluate(async ({ desktopCapturer }, ms) => {
    const target = desktopCapturer as unknown as { getSources: unknown }
    target.getSources = async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return []
    }
  }, delayMs)
}

/**
 * Answer `desktopCapturer.getSources` with a named list instead of the box's
 * own screen. T-69 is about what a refresh does to a selection the user
 * already made, which needs a SECOND, DIFFERENT list — and xvfb has exactly
 * one screen to offer. The ids are the only fabricated part that matters
 * (they are what `selectedSourceId` holds and what the reconcile compares);
 * the thumbnail is a real 1x1 PNG so the cards render like any other.
 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function stubSourceList(app: ElectronApplication, names: string[]): Promise<void> {
  await app.evaluate(
    async ({ desktopCapturer, nativeImage }, { wanted, png }) => {
      const thumbnail = nativeImage.createFromDataURL(png)
      const target = desktopCapturer as unknown as { getSources: unknown }
      target.getSources = async () =>
        wanted.map((name, i) => ({ id: `window:t69-${i}:0`, name, thumbnail }))
    },
    { wanted: names, png: TINY_PNG }
  )
}

/**
 * Make `desktopCapturer.getSources` throw, the way a blocked capture answers
 * on a system that refuses outright instead of returning nothing. The
 * rejection crosses the IPC bridge wrapped in Electron's
 * "Error invoking remote method …" envelope, which is what makes this the
 * test of both halves: the studio must strip the envelope (T-30/T-59) AND
 * leave the in-flight state.
 */
async function stubFailingSources(app: ElectronApplication, message: string): Promise<void> {
  await app.evaluate(async ({ desktopCapturer }, msg) => {
    const target = desktopCapturer as unknown as { getSources: unknown }
    target.getSources = async () => {
      throw new Error(msg)
    }
  }, message)
}

/**
 * Give the renderer some cameras. `enumerateDevices()` returns nothing in
 * this container and Chromium's fake-device switch does not survive
 * Electron's command line (see the header), so the WITH-a-camera half of the
 * Webcam card — the device `<select>` and the Corner picker T-42 gates on it
 * — is otherwise unreachable headless.
 *
 * Only the two `mediaDevices` calls `refreshDevices` makes are replaced, and
 * `getUserMedia` delegates to the real implementation for anything that is
 * not that function's own permission probe, so desktop capture still runs
 * for real if a test that installs this later records. Install it BEFORE
 * navigating to /record: `refreshDevices` runs on mount.
 */
async function stubCameras(window: Page): Promise<void> {
  await window.evaluate(() => {
    const md = navigator.mediaDevices as unknown as {
      getUserMedia: (c?: MediaStreamConstraints) => Promise<MediaStream>
      enumerateDevices: () => Promise<unknown[]>
    }
    const w = window as unknown as { __realMediaDevices?: typeof md }
    // Keep the real implementations once, so unstubDevices can put them back.
    w.__realMediaDevices ??= {
      getUserMedia: md.getUserMedia.bind(navigator.mediaDevices),
      enumerateDevices: md.enumerateDevices.bind(navigator.mediaDevices)
    }
    const realGetUserMedia = w.__realMediaDevices.getUserMedia
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      // refreshDevices' CAMERA probe: `{ video: true }` and nothing else. T-88
      // split the old combined `{ audio: true, video: true }` probe in two, so
      // the microphone probe (`{ audio: true }`) goes to the real API — which,
      // with no microphone in this container, rejects. That is the point: a
      // camera that is there must be listed even though the mic is not.
      // Anything else (the desktop-capture constraints, a specific deviceId)
      // also goes to the real API.
      if (c && c.video === true && !c.audio) return new MediaStream()
      return realGetUserMedia(c)
    }
    md.enumerateDevices = async () => [
      { deviceId: 'fake-cam-1', kind: 'videoinput', label: 'Fake Cam A', groupId: 'g1' },
      { deviceId: 'fake-cam-2', kind: 'videoinput', label: 'Fake Cam B', groupId: 'g1' }
    ]
  })
}

/**
 * The mirror of `stubCameras` (T-88): one microphone and NO camera, which is
 * the commonest streamer setup that is not "everything plugged in". The
 * `{ video: true }` probe goes to the real API, which rejects here — the case
 * the combined probe turned into "No microphone found".
 */
async function stubMicrophones(window: Page): Promise<void> {
  await window.evaluate(() => {
    const md = navigator.mediaDevices as unknown as {
      getUserMedia: (c?: MediaStreamConstraints) => Promise<MediaStream>
      enumerateDevices: () => Promise<unknown[]>
    }
    const w = window as unknown as { __realMediaDevices?: typeof md }
    w.__realMediaDevices ??= {
      getUserMedia: md.getUserMedia.bind(navigator.mediaDevices),
      enumerateDevices: md.enumerateDevices.bind(navigator.mediaDevices)
    }
    const realGetUserMedia = w.__realMediaDevices.getUserMedia
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (c && c.audio === true && !c.video) return new MediaStream()
      return realGetUserMedia(c)
    }
    md.enumerateDevices = async () => [
      { deviceId: 'fake-mic-1', kind: 'audioinput', label: 'Fake Mic A', groupId: 'g2' },
      { deviceId: 'fake-mic-2', kind: 'audioinput', label: 'Fake Mic B', groupId: 'g2' }
    ]
  })
}

/** Put the real `mediaDevices` back: the device was unplugged (T-88). */
async function unstubDevices(window: Page): Promise<void> {
  await window.evaluate(() => {
    const md = navigator.mediaDevices as unknown as Record<string, unknown>
    const real = (window as unknown as { __realMediaDevices?: Record<string, unknown> })
      .__realMediaDevices
    if (!real) throw new Error('no stub was installed')
    md.getUserMedia = real.getUserMedia
    md.enumerateDevices = real.enumerateDevices
  })
}

/**
 * Count every device-scan call the renderer makes, delegating to whatever
 * implementation is installed (real, or a stub installed LATER replaces this
 * wrapper — install the spy last, or read counts from a spy-only test). T-88's
 * Refresh test asks the one question the DOM cannot answer directly: did the
 * click re-run the device scan? `gum` holds the constraints of each
 * `getUserMedia` call as JSON; `enumerations` counts `enumerateDevices` calls.
 */
async function spyOnDeviceScans(window: Page): Promise<void> {
  await window.evaluate(() => {
    const md = navigator.mediaDevices
    const g = window as unknown as { __deviceScans: { gum: string[]; enumerations: number } }
    g.__deviceScans = { gum: [], enumerations: 0 }
    const realGum = md.getUserMedia.bind(md)
    const realEnum = md.enumerateDevices.bind(md)
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      g.__deviceScans.gum.push(JSON.stringify(c ?? {}))
      return realGum(c)
    }
    md.enumerateDevices = () => {
      g.__deviceScans.enumerations += 1
      return realEnum()
    }
  })
}

function readDeviceScans(window: Page): Promise<{ gum: string[]; enumerations: number }> {
  return window.evaluate(
    () =>
      (window as unknown as { __deviceScans: { gum: string[]; enumerations: number } })
        .__deviceScans
  )
}

async function waitForHome(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
}

/** Home -> Record through the NavCard the user actually clicks. */
async function gotoRecordFromHome(window: Page): Promise<void> {
  await waitForHome(window)
  await window.getByRole('link', { name: /Record/ }).first().click()
  await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
}

/** Per-test scratch root; every test owns its own userData directory. */
function makeRoot(label: string): string {
  return path.join(os.tmpdir(), `imagii-e2e-rec-${label}-${Date.now().toString(36)}`)
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

const SEED: SeedConfig = { welcomeSeen: true, tutorialSeen: ALL_TUTORIALS_SEEN }

test.describe('T-27 Record Studio', () => {
  // ------------------------------------------------------------------
  // 1. Route + option wiring (no capture involved)
  // ------------------------------------------------------------------

  test('Home NavCard opens Record and the option cards render their defaults', async () => {
    test.setTimeout(120_000)
    ensureScreenshots()
    const root = makeRoot('route')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)

      // The route's own copy, so a silent swap of the NavCard target fails here.
      await expect(
        window.getByText('Capture a screen or window, with optional webcam and mic — saved locally as MP4 (or WebM).')
      ).toBeVisible()
      // All four panels of the idle layout.
      await expect(window.getByText('What to record')).toBeVisible()
      await expect(window.getByText('Audio', { exact: true })).toBeVisible()
      await expect(window.getByText('Webcam', { exact: true })).toBeVisible()
      await expect(window.getByText('Output', { exact: true })).toBeVisible()

      // Defaults: mic on, webcam off, MP4 on.
      await expect(window.getByRole('checkbox').nth(0)).toBeChecked()
      await expect(window.getByRole('checkbox').nth(1)).not.toBeChecked()
      await expect(window.getByRole('checkbox').nth(2)).toBeChecked()

      // Start is disabled until a source is chosen — nothing is selected yet.
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeDisabled()
      // Idle shows neither the REC header nor the saving card.
      await expect(window.getByRole('button', { name: 'Stop' })).toHaveCount(0)
      await expect(window.getByText(/Finishing up/)).toHaveCount(0)

      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-01-idle.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-88: the hints name the real recoveries and the button that re-checks; T-122 added the third
  // (plug one in, close any other app using it, or allow access in Windows privacy settings).
  const CAM_WARNING =
    'No camera found. Plug one in, close any other app using it, or allow camera access in Windows privacy settings, then click Refresh sources.'
  const MIC_WARNING =
    'No microphone found. Plug one in, close any other app using it, or allow microphone access in Windows privacy settings, then click Refresh sources.'

  test('mic checkbox toggles the microphone row; with no device it is the warning, not a select', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('mic')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)

      const micBox = window.getByRole('checkbox').nth(0)
      const micWarning = window.getByText(MIC_WARNING)
      const micSelect = window.locator('select[aria-label="Microphone"]')

      // Checked by default -> the mic row is revealed. There is no audio input
      // device in this container, so the revealed row is the warning branch.
      // A machine WITH a mic gets the <select> instead; that fork is the
      // Windows hand-test's first step.
      await expect(micBox).toBeChecked()
      await expect(micWarning).toBeVisible()
      await expect(micSelect).toHaveCount(0)

      // Unchecking hides the whole row — both branches are gated on includeMic.
      await micBox.uncheck()
      await expect(micBox).not.toBeChecked()
      await expect(micWarning).toHaveCount(0)
      await expect(micSelect).toHaveCount(0)

      // And re-checking brings it back, so this is a live toggle rather than
      // a one-way reveal.
      await micBox.check()
      await expect(micWarning).toBeVisible()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('webcam checkbox with no camera warns exactly like the mic, and offers no Corner (T-42)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('cam')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)

      const camBox = window.getByRole('checkbox').nth(1)
      const camSelect = window.locator('select[aria-label="Webcam"]')
      const cornerRow = window.getByText('Corner', { exact: true })
      const camWarning = window.getByText(CAM_WARNING)

      // Off by default: no select, no Corner row, and no warning either —
      // an unticked box makes no promise, so it needs no correction.
      await expect(camBox).not.toBeChecked()
      await expect(camSelect).toHaveCount(0)
      await expect(cornerRow).toHaveCount(0)
      await expect(camWarning).toHaveCount(0)

      await camBox.check()

      // T-42 (was T-27 FINDING B): the ticked-with-no-camera state now
      // mirrors the Audio card's, in the same place the device <select>
      // would have been. Both warnings are on screen at once here, which is
      // what makes "mirrors" checkable rather than a claim.
      await expect(camWarning).toBeVisible()
      await expect(camWarning).toHaveClass(/text-warn/)
      await expect(window.getByText(MIC_WARNING)).toBeVisible()

      // No device select, and — the other half of the fix — no Corner picker
      // for a corner nothing can be put in. The old build showed one, which
      // is what made the ticked box read as a promise.
      await expect(camSelect).toHaveCount(0)
      await expect(cornerRow).toHaveCount(0)

      // A live toggle in both directions, not a one-way reveal.
      await camBox.uncheck()
      await expect(camWarning).toHaveCount(0)
      await camBox.check()
      await expect(camWarning).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-09-nocamera.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('with a camera attached the webcam select and the Corner picker both appear (T-42)', async () => {
    test.setTimeout(120_000)
    ensureScreenshots()
    const root = makeRoot('camyes')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await stubCameras(window)
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })

      const camBox = window.getByRole('checkbox').nth(1)
      const camSelect = window.locator('select[aria-label="Webcam"]')

      // Still gated on the checkbox: devices alone reveal nothing.
      await expect(camSelect).toHaveCount(0)
      await expect(window.getByText(CAM_WARNING)).toHaveCount(0)

      await camBox.check()

      // The device select — the row the ledger carried as headless-limited
      // because no videoinput exists in a container. Both devices are listed
      // by their real labels, and the first is the value the select shows
      // (which is the `selectedCamId ?? cams[0]` fallback startRecording
      // uses, so what is displayed is what would be recorded).
      await expect(camSelect).toBeVisible()
      await expect(camSelect.locator('option')).toHaveText(['Fake Cam A', 'Fake Cam B'])
      await expect(camSelect).toHaveValue('fake-cam-1')
      await camSelect.selectOption('fake-cam-2')
      await expect(camSelect).toHaveValue('fake-cam-2')

      // No warning, because there IS a camera.
      await expect(window.getByText(CAM_WARNING)).toHaveCount(0)

      // T-88: and the microphone that is NOT there says so on its own card —
      // the camera is listed anyway. The old combined `{ audio, video }`
      // probe rejected for the missing mic and blanked this select too.
      await expect(window.getByText(MIC_WARNING)).toBeVisible()

      // ...and now the Corner picker, with its four exact labels. A renamed
      // option is a user-visible change and fails here.
      const corner = window.locator('select').filter({ hasText: 'Bottom-right' })
      await expect(corner).toBeVisible()
      await expect(corner.locator('option')).toHaveText([
        'Top-left',
        'Top-right',
        'Bottom-left',
        'Bottom-right'
      ])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-10-camera.png') })

      // Unchecking takes both rows away again.
      await camBox.uncheck()
      await expect(camSelect).toHaveCount(0)
      await expect(window.getByText('Corner', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Start with the webcam ticked and no camera says so, instead of silently recording screen-only (T-42)', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('nocam')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // Cancelled save: this take exists to be started, not kept.
      await stubSaveDialog(app, null)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      // Mic off — there is no microphone either, and its failure would abort
      // the whole start before the webcam branch is reached.
      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(1).check()
      await expect(window.getByRole('checkbox').nth(1)).toBeChecked()
      await expect(window.getByText(CAM_WARNING)).toBeVisible()

      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()

      // T-42: the existing webcam-failure toast, raised for the case that
      // used to raise nothing. It names the fault AND what the recording
      // will be instead, so the ticked box and the file agree.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 30_000,
          intervals: [200]
        })
        .toContain('No camera found. Recording screen only.')

      // And it is a warning, not an abort: the screen half of the take is
      // still what the user asked for, so it runs.
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:00/)).toBeVisible()
      // Let a real second of chunks land — stopping at 00:00 finalizes an
      // empty session, which is a different (already-covered) path.
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 15_000 })

      // T-121: and the camera that is not in the take has no thumbnail. The box was drawn from the checkbox,
      // so a failed camera left an empty accent-bordered rectangle over the screen preview for the whole take.
      await expect(window.locator('video.max-h-\\[60vh\\]')).toHaveCount(1)
      await expect(window.locator('video.border-accent'), 'no empty camera box over the screen preview').toHaveCount(0)

      await window.getByRole('button', { name: 'Stop' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 60_000,
          intervals: [200]
        })
        .toContain('Recording discarded')
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 30_000
      })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // ------------------------------------------------------------------
  // T-88: the device hints point at a button that has to work
  // ------------------------------------------------------------------

  test('Refresh sources re-scans the microphone and camera, not just the screens (T-88)', async () => {
    test.setTimeout(150_000)
    const root = makeRoot('rescan')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      // Installed BEFORE the route mounts, so the mount scan is counted too.
      await spyOnDeviceScans(window)
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })

      // The scan the route runs on arrival. An enumeration is the LAST thing a
      // scan does, so once it has happened the scan is over and the click
      // below cannot overlap it.
      await expect.poll(async () => (await readDeviceScans(window)).enumerations).toBe(1)
      const mount = await readDeviceScans(window)
      // Two probes, one per kind of device — never one call that needs both.
      expect([...mount.gum].sort()).toEqual(['{"audio":true}', '{"video":true}'])

      // The container has no microphone and no camera, so this is the state the
      // hints exist for. Both name the real recovery and the button.
      await window.getByRole('checkbox').nth(1).check()
      await expect(window.getByText(MIC_WARNING)).toBeVisible()
      await expect(window.getByText(CAM_WARNING)).toBeVisible()

      // ── the click re-runs the scan (red against a Refresh that only re-lists
      //    screens and windows: nothing here would move) ──
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect.poll(async () => (await readDeviceScans(window)).enumerations).toBe(2)
      const after = await readDeviceScans(window)
      expect([...after.gum.slice(mount.gum.length)].sort()).toEqual([
        '{"audio":true}',
        '{"video":true}'
      ])
      // ...and it still re-lists the screens, which is what it always did.
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })

      // ── plug a camera in, click Refresh: it is listed, and the mic that is
      //    still missing still says so ──
      await stubCameras(window)
      const camSelect = window.locator('select[aria-label="Webcam"]')
      await expect(camSelect).toHaveCount(0)
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(camSelect).toBeVisible({ timeout: 15_000 })
      await expect(camSelect.locator('option')).toHaveText(['Fake Cam A', 'Fake Cam B'])
      await expect(window.getByText(CAM_WARNING)).toHaveCount(0)
      await expect(window.getByText(MIC_WARNING)).toBeVisible()

      // ── unplug it: Refresh takes the stale list away rather than keeping it ──
      await camSelect.selectOption('fake-cam-2')
      await unstubDevices(window)
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.getByText(CAM_WARNING)).toBeVisible({ timeout: 15_000 })
      await expect(camSelect).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-11-rescan.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a microphone and NO camera: the mic is listed and only the camera warns (T-88)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('micnocam')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await stubMicrophones(window)
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })

      // The headline case of the ticket. The old build probed both kinds in
      // one call; with no camera that call rejected, the rejection was
      // swallowed, and a streamer with a perfectly good microphone read
      // "No microphone found".
      const micSelect = window.locator('select[aria-label="Microphone"]')
      await expect(micSelect).toBeVisible({ timeout: 15_000 })
      await expect(micSelect.locator('option')).toHaveText(['Fake Mic A', 'Fake Mic B'])
      await expect(window.getByText(MIC_WARNING)).toHaveCount(0)

      // The camera is genuinely absent, and the Webcam card says so.
      await window.getByRole('checkbox').nth(1).check()
      await expect(window.getByText(CAM_WARNING)).toBeVisible()
      await expect(window.locator('select[aria-label="Webcam"]')).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-12-micnocam.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Corner select writes record.webcamCorner to config.json and a relaunch restores it', async () => {
    test.setTimeout(150_000)
    ensureScreenshots()
    const root = makeRoot('corner')
    const userDataDir = path.join(root, 'userData')
    // Deliberately seeded WITHOUT record.webcamCorner so the first write is
    // observable as a key appearing on disk.
    seedUserData(userDataDir, SEED)
    expect(readConfig(userDataDir).record).toBeUndefined()

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // T-42 gated the Corner picker on there being a camera to put in a
      // corner, so this test — which is about the corner's PERSISTENCE —
      // stubs one in rather than losing the element's coverage.
      await waitForHome(window)
      await stubCameras(window)
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })

      // T-43 (was T-27 FINDING D): arriving on /record writes NOTHING. The
      // old persist effect ran on mount with no user-touched guard and
      // stamped the default corner over an absent key, which made navigation
      // alone a settings write; the effect is gone and the select writes its
      // own choice instead. The settle wait is longer than the write ever
      // took (it was observable inside 200 ms).
      await window.waitForTimeout(2000)
      expect(readConfig(userDataDir).record).toBeUndefined()

      await window.getByRole('checkbox').nth(1).check()
      const corner = window.locator('select').filter({ hasText: 'Bottom-right' })
      await corner.selectOption('top-left')
      await expect(corner).toHaveValue('top-left')

      // The choice is on DISK, not just in React state.
      await expect
        .poll(() => readConfig(userDataDir).record?.webcamCorner, { timeout: 15_000, intervals: [200] })
        .toBe('top-left')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-02-corner.png') })
    } finally {
      await app.close()
    }

    // Second launch on the SAME userData: the restore effect reads the stored
    // key back and the select comes up on the user's corner, not the default.
    const app2 = await launchApp(userDataDir)
    try {
      const window = await app2.firstWindow()
      await waitForHome(window)
      await stubCameras(window)
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await window.getByRole('checkbox').nth(1).check()
      const corner = window.locator('select').filter({ hasText: 'Bottom-right' })
      await expect(corner).toHaveValue('top-left')
      // Restoring must not rewrite a different value over the stored one.
      expect(readConfig(userDataDir).record?.webcamCorner).toBe('top-left')
    } finally {
      await app2.close()
      cleanup(root)
    }
  })

  test('MP4 checkbox persists like the corner, and an untouched visit writes nothing (T-43)', async () => {
    test.setTimeout(150_000)
    const root = makeRoot('mp4')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)
    const configFile = path.join(userDataDir, 'config.json')

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // Snapshot AFTER the app has settled on Home: electron-store stamps its
      // own `theme` default at construction, so the file is legitimately
      // rewritten once per launch. What must not happen is a write caused by
      // walking into a route.
      await waitForHome(window)
      await window.waitForTimeout(1000)
      const bytesBefore = readFileSync(configFile, 'utf8')
      const mtimeBefore = statSync(configFile).mtimeMs

      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await window.waitForTimeout(2000)

      // T-43 (was T-27 FINDING D), the sharp version: mounting the route and
      // touching nothing leaves config.json byte-identical, down to its mtime.
      // The old build's mount-write landed within 200 ms of arrival.
      expect(readFileSync(configFile, 'utf8')).toBe(bytesBefore)
      expect(statSync(configFile).mtimeMs).toBe(mtimeBefore)
      expect(readConfig(userDataDir).record).toBeUndefined()

      const mp4Box = window.getByRole('checkbox').nth(2)
      await expect(mp4Box).toBeChecked()
      await expect(
        window.getByText("Off = save as WebM (quick, but some apps don't accept WebM).")
      ).toBeVisible()
      // T-120: 8 Mbps is about 1 MB a second, and the hint says what that costs in disk.
      await expect(
        window.getByText('A take can use about 3.6 GB of disk per hour, and saving needs room for a second copy of it.')
      ).toBeVisible()

      // T-43 (was T-27 FINDING C): the choice is a setting now, written the
      // moment it is made — the same mechanism as the corner select, which is
      // what the finding said it should have been all along.
      await mp4Box.uncheck()
      await expect(mp4Box).not.toBeChecked()
      await expect
        .poll(() => readConfig(userDataDir).record?.convertToMp4, {
          timeout: 15_000,
          intervals: [200]
        })
        .toBe(false)

      // A round trip to Home and back keeps it: the remount reads the stored
      // value instead of springing back to its `useState(true)` default.
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByRole('checkbox').nth(2)).not.toBeChecked()
    } finally {
      await app.close()
    }

    // Second launch on the SAME userData — the relaunch the finding was
    // written about: a user who wants WebM used to re-tick this on every
    // single visit.
    const app2 = await launchApp(userDataDir)
    try {
      const window = await app2.firstWindow()
      await gotoRecordFromHome(window)
      await expect(window.getByRole('checkbox').nth(2)).not.toBeChecked()
      // And restoring does not rewrite a different value over the stored one.
      expect(readConfig(userDataDir).record?.convertToMp4).toBe(false)

      // Re-ticking goes back to disk as true, so the setting is a live
      // two-way binding rather than a one-shot opt-out.
      await window.getByRole('checkbox').nth(2).check()
      await expect
        .poll(() => readConfig(userDataDir).record?.convertToMp4, {
          timeout: 15_000,
          intervals: [200]
        })
        .toBe(true)
    } finally {
      await app2.close()
      cleanup(root)
    }
  })

  // ------------------------------------------------------------------
  // 2. Source discovery — the empty branch and the real one
  // ------------------------------------------------------------------

  /** T-41's empty-state copy, the twin of the mic and camera warnings. */
  const NO_SOURCES_WARNING =
    'No screens or windows found. Click "Refresh sources" after granting screen-recording permission.'
  const SEARCHING_COPY = 'Looking for screens and windows…'

  test('zero capture sources says so: never-searched, searching and found-nothing all render differently (T-41)', async () => {
    test.setTimeout(120_000)
    ensureScreenshots()
    const root = makeRoot('nosources')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // Held back by 1.5 s so the in-flight state is observable — see
      // stubEmptySources. Every other byte of the path is real: the click,
      // the IPC round trip, main's own handler.
      await stubEmptySources(app, 1500)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      const pick = window.getByRole('button', { name: 'Pick a screen or window' })
      const warning = window.getByText(NO_SOURCES_WARNING)
      const searching = window.getByText(SEARCHING_COPY)

      // ── state 1, never searched: the invitation and nothing else. An
      //    untouched panel makes no claim about what is out there. ──
      await expect(pick).toBeEnabled()
      await expect(searching).toHaveCount(0)
      await expect(warning).toHaveCount(0)

      await pick.click()

      // ── state 2, in flight: the card says it is looking, and the button
      //    it was clicked with cannot be clicked again. ──
      await expect(searching).toBeVisible()
      await expect(pick).toBeDisabled()
      await expect(warning).toHaveCount(0)

      // ── state 3, the answer: T-41 (was T-27 FINDING A). The search really
      //    ran and really came back empty — and now says so, in the Audio
      //    card's own words, naming the control that retries and the
      //    permission that is usually the cause. The old build put the
      //    placeholder button back verbatim, so a user on a blocked system
      //    (Wayland without a portal, macOS screen recording denied) saw a
      //    button that appeared to do nothing at all. ──
      await expect(warning).toBeVisible({ timeout: 20_000 })
      await expect(warning).toHaveClass(/text-warn/)
      await expect(searching).toHaveCount(0)
      await expect(pick).toBeEnabled()
      await expect(window.locator('img[alt]')).toHaveCount(0)
      // Nothing was found, but nothing went wrong either: an empty answer is
      // reported in the card, not as an error toast. (`[role="status"]` is
      // react-hot-toast's own aria wrapper — this route renders no other.)
      await expect(window.locator('[role="status"]')).toHaveCount(0)
      // The page is intact and Start is still correctly refused: no source
      // id was ever set.
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible()
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeDisabled()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-03-no-sources.png') })

      // ── Refresh sources takes the same path and lands in the same state,
      //    rather than dropping back to the never-searched invitation. ──
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(searching).toBeVisible()
      await expect(warning).toBeVisible({ timeout: 20_000 })
      await expect(window.locator('[role="status"]')).toHaveCount(0)

      // ── the other way capture fails: refused outright, not empty. The
      //    studio says so in its own sentence (T-117: it showed main's string
      //    as written, envelope stripped, until then) and leaves the
      //    in-flight state instead of waiting forever. ──
      await stubFailingSources(app, 'Screen recording permission denied')
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 30_000,
          intervals: [200]
        })
        .toContain(LIST_FAILED)
      expect((await readToastLog(window)).join(' | ')).not.toMatch(
        /permission denied|Error invoking remote method/
      )
      // A cause the helper knows is named in plain words, and the path it came with is not shown.
      await stubFailingSources(
        app,
        "EPERM: operation not permitted, open 'C:\\Users\\maken\\AppData\\Roaming\\imagii\\sources.json'"
      )
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 30_000,
          intervals: [200]
        })
        .toContain(`${LIST_FAILED} Windows blocked access to a file. Close any app using it, or check your antivirus.`)
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/EPERM|maken|AppData|sources\.json/)
      await expect(searching).toHaveCount(0)
      await expect(warning).toBeVisible()
      await expect(pick).toBeEnabled()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-128 (1): a source tile shows an OS window's own title, which is as long as the program makes it, cut with an ellipsis at the tile's
  // width - and nothing else on the screen says the rest (the thumbnail's alt is not drawn). The tile's name carries it as its title.
  test('a long window title on a source tile is cut with an ellipsis and carries its whole self as the title (T-128 (1))', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('sourcetitle')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)
      const longTitle = 'imagii - Stream highlights season finale, the whole run from the first clip to the last - Visual Studio Code [Administrator]'
      await stubSourceList(app, [longTitle, 'Entire screen'])
      await window.getByRole('button', { name: 'Refresh sources' }).click()

      const name = window.locator('button.card div.truncate', { hasText: longTitle })
      await expect(name).toBeVisible({ timeout: 20_000 })
      expect(await name.evaluate((n) => n.scrollWidth > n.clientWidth), 'the title is really cut here, so the tooltip is what reads the rest').toBe(true)
      await expect(name).toHaveAttribute('title', longTitle)
      // A short name is whole and carries the same tooltip (a rule with no exceptions is one nobody has to remember).
      await expect(window.locator('button.card div.truncate', { hasText: 'Entire screen' })).toHaveAttribute('title', 'Entire screen')
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('Refresh sources lists the real screen, auto-selects the first, and enables Start', async () => {
    test.setTimeout(120_000)
    ensureScreenshots()
    const root = makeRoot('sources')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)

      await expect(window.getByRole('button', { name: /Start recording/ })).toBeDisabled()
      await window.getByRole('button', { name: 'Refresh sources' }).click()

      // A real desktopCapturer source, with a real thumbnail: the grid
      // replaces the placeholder and the card carries the source's own name
      // and type straight from main.
      const cards = window.locator('img[alt]')
      await expect(cards.first()).toBeVisible({ timeout: 20_000 })
      const alt = await cards.first().getAttribute('alt')
      expect(alt && alt.length > 0).toBe(true)
      const src = await cards.first().getAttribute('src')
      expect(src?.startsWith('data:image/png;base64,')).toBe(true)
      // A non-empty thumbnail, not a 1-px placeholder.
      expect((src ?? '').length).toBeGreaterThan(500)
      await expect(window.getByText('screen', { exact: true }).first()).toBeVisible()

      // chooseSource auto-selects the first entry when nothing is selected,
      // which is what un-disables Start.
      const sourceButton = window.locator('button.card').filter({ has: cards.first() })
      await expect(sourceButton).toHaveClass(/border-accent/)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeEnabled()

      // Clicking the thumbnail keeps it selected (the selection handler is
      // the only thing that writes selectedSourceId after the auto-pick).
      await sourceButton.click()
      await expect(sourceButton).toHaveClass(/ring-accent/)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeEnabled()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-04-sources.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('T-69: a refresh reconciles the selection — dropped when the list empties, moved when it changes', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('stale-source')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)
      await installToastLog(window)
      const start = window.getByRole('button', { name: /Start recording/ })
      const refresh = window.getByRole('button', { name: 'Refresh sources' })
      const cards = window.locator('img[alt]')
      const warning = window.getByText(NO_SOURCES_WARNING)

      // ── a real selection first: the box's own screen, auto-picked ──
      await refresh.click()
      await expect(cards.first()).toBeVisible({ timeout: 20_000 })
      await expect(start).toBeEnabled()

      // ── refresh into nothing. The selection is the id of a source that no
      //    longer exists, so keeping it leaves Start inviting a capture that
      //    can only fail at getUserMedia — with the card underneath saying
      //    there is nothing to record. ──
      await stubEmptySources(app, 0)
      await refresh.click()
      await expect(warning).toBeVisible({ timeout: 20_000 })
      await expect(cards).toHaveCount(0)
      await expect(start).toBeDisabled()

      // ── a list with something in it selects the first again ──
      await stubSourceList(app, ['Fake Window A', 'Fake Window B'])
      await refresh.click()
      await expect(cards).toHaveCount(2, { timeout: 20_000 })
      await expect(warning).toHaveCount(0)
      const cardA = window.locator('button.card').filter({ has: window.locator('img[alt="Fake Window A"]') })
      const cardB = window.locator('button.card').filter({ has: window.locator('img[alt="Fake Window B"]') })
      await expect(cardA).toHaveClass(/border-accent/)
      await expect(start).toBeEnabled()
      // T-114: the selected card says so to assistive tech, not only by its border and ring.
      await expect(cardA).toHaveAttribute('aria-pressed', 'true')
      await expect(cardB).toHaveAttribute('aria-pressed', 'false')

      // ── the changed-list case: pick B, then refresh into a list that no
      //    longer has it. Start stays enabled, but pointing at a source that
      //    IS in the new list — the selection moves rather than lingering on
      //    a window the user closed. ──
      await cardB.click()
      await expect(cardB).toHaveClass(/ring-accent/)
      await expect(cardB).toHaveAttribute('aria-pressed', 'true')
      await expect(cardA).toHaveAttribute('aria-pressed', 'false')
      await stubSourceList(app, ['Fake Window A'])
      await refresh.click()
      await expect(cards).toHaveCount(1, { timeout: 20_000 })
      await expect(cardA).toHaveClass(/border-accent/)
      await expect(start).toBeEnabled()

      // ── and the other way a refresh comes back with nothing usable: a
      //    refusal. Same reconcile — the list is empty, so the selection is
      //    too, and the failure is said rather than swallowed (T-59, T-117: in
      //    the studio's sentence, not main's string). ──
      await stubFailingSources(app, 'Screen recording permission denied')
      await refresh.click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 30_000,
          intervals: [200]
        })
        .toContain(LIST_FAILED)
      await expect(cards).toHaveCount(0)
      await expect(start).toBeDisabled()
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // ------------------------------------------------------------------
  // 3. Negative: Start with a microphone that is not there
  // ------------------------------------------------------------------

  test('Start with mic enabled and no microphone refuses, names the fault, and leaves no temp file', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('nomic')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })

      // Mic checkbox stays ON. The screen grab succeeds; the mic getUserMedia
      // is what throws.
      await expect(window.getByRole('checkbox').nth(0)).toBeChecked()
      await window.getByRole('button', { name: /Start recording/ }).click()

      // The fault is named — which device class, and what to do — in the
      // app's words. T-84: the browser's own "Requested device not found" /
      // "NotFoundError" is for the console; the user reads a sentence, and
      // the context line ("Couldn't start recording.") leads it so the toast
      // still says what failed.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 20_000,
          intervals: [200]
        })
        .toContain(
          "Couldn't start recording. That device wasn't found. Check it's plugged in, then try again."
        )
      expect((await readToastLog(window)).join(' | ')).not.toMatch(
        /Requested device not found|NotFoundError/
      )

      // And the app stayed idle: no REC header, no Stop button, the option
      // cards are still on screen.
      await expect(window.getByRole('button', { name: 'Stop' })).toHaveCount(0)
      await expect(window.getByText(/REC \d\d:\d\d/)).toHaveCount(0)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible()

      // T-119 (2): a refused start can be tried again. The guard that stops a double press is released in the
      // start's `finally`, so the same press a second time runs the whole start again and refuses again: two
      // toasts, not one (the log keeps one entry per toast even when the sentence is the same).
      const refusals = async (): Promise<number> =>
        (await readToastLog(window)).filter((t) => t.includes("That device wasn't found")).length
      expect(await refusals()).toBe(1)
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect.poll(refusals, { timeout: 20_000, intervals: [200] }).toBe(2)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible()

      // stopAllStreams + abandon ran on the failure path, so no partial
      // session file is orphaned under userData/recordings. (This failure
      // happens before recording:begin, so the directory is not even created;
      // either way the assertion is "nothing left behind".)
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-119 (2): Start was re-entrant. `phase` only changes once the capture and the main-process session are
  // open, and the button was gated by the source alone, so a second press during that wait began a second
  // capture over the first one's refs - the first take was orphaned with its temp webm still growing. The
  // desktop capture is held open here (the way a slow permission prompt or a busy GPU holds it), so the
  // state the person is looking at is a state the test creates.
  test('Start while the capture is still opening says "Starting…", cannot be pressed again, and opens exactly one take (T-119)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('starting')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })

      // Hold the DESKTOP capture (and only it) until the test lets go; count how many times it is asked.
      await window.evaluate(() => {
        const md = navigator.mediaDevices
        const realGum = md.getUserMedia.bind(md)
        const w = window as unknown as { __desktopGum: number; __letGo: () => void }
        w.__desktopGum = 0
        const gate = new Promise<void>((resolve) => {
          w.__letGo = resolve
        })
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          if (JSON.stringify(c ?? {}).includes('chromeMediaSource')) {
            w.__desktopGum += 1
            await gate
          }
          return realGum(c)
        }
      })

      await window.getByRole('button', { name: /Start recording/ }).click()

      // What the person sees while it opens: the button says so and cannot be pressed.
      const starting = window.getByRole('button', { name: /Starting…/ })
      await expect(starting).toBeDisabled()
      await expect(window.getByRole('button', { name: /Start recording/ })).toHaveCount(0)
      // ...and what the handler itself does if it is called again in the same breath (a path that does not go
      // through the disabled button): React's own props for the live button, invoked twice in one tick, so no
      // render can come between the two calls.
      const asked = await window.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /Starting/.test(b.textContent ?? ''))
        if (!btn) throw new Error('no Starting button')
        const key = Object.keys(btn).find((k) => k.startsWith('__reactProps'))
        if (!key) throw new Error('no React props on the button')
        const props = (btn as unknown as Record<string, { onClick: () => void }>)[key]
        if (!props) throw new Error('no React props on the button')
        props.onClick()
        props.onClick()
        return (window as unknown as { __desktopGum: number }).__desktopGum
      })
      expect(asked, 'the capture was asked for once, however many presses').toBe(1)

      await window.evaluate(() => (window as unknown as { __letGo: () => void }).__letGo())
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      expect(await window.evaluate(() => (window as unknown as { __desktopGum: number }).__desktopGum)).toBe(1)
      // One take, one temp file: the first capture was never orphaned.
      expect(leftoverTemps(userDataDir).length).toBe(1)

      // Stop, and decline the save: the take is thrown away and nothing is left on disk.
      await window.getByRole('button', { name: 'Stop' }).click()
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => leftoverTemps(userDataDir), { timeout: 15_000, intervals: [200] }).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-120 (9): leaving Record while "Starting…" is still waiting on the capture. The unmount cleanup runs before
  // any of the awaits in `startRecording` lands, so it found nothing to stop; the start then carried on in a
  // component nobody could see, opened a main-process session, began a MediaRecorder and left the screen
  // capture live (the OS's "being shared" indicator) with a temp webm growing. The Home link is not
  // intercepted during "Starting…" (the guard asks for phase 'recording'), so this is a reachable path.
  test('leaving Record while the capture is still opening lets go of it: the stream ends and no take is opened (T-120)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('leftstarting')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await gotoRecordFromHome(window)
      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })

      // The desktop capture is REAL, then held: the stream exists (and so can be orphaned) while the start waits.
      await window.evaluate(() => {
        const md = navigator.mediaDevices
        const realGum = md.getUserMedia.bind(md)
        const w = window as unknown as { __held: { streams: MediaStream[]; asked: number; letGo: () => void } }
        let letGo: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          letGo = resolve
        })
        w.__held = { streams: [], asked: 0, letGo }
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          const stream = await realGum(c)
          if (JSON.stringify(c ?? {}).includes('chromeMediaSource')) {
            w.__held.asked += 1
            w.__held.streams.push(stream)
            await gate
          }
          return stream
        }
      })

      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: /Starting…/ })).toBeDisabled()
      await expect
        .poll(() => window.evaluate(() => (window as unknown as { __held: { asked: number } }).__held.asked))
        .toBe(1)

      // Leave: the Home link is not intercepted while the phase is not 'recording'.
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      const live = (): Promise<number> =>
        window.evaluate(
          () =>
            (window as unknown as { __held: { streams: MediaStream[] } }).__held.streams
              .flatMap((s) => s.getTracks())
              .filter((t) => t.readyState === 'live').length
        )
      expect(await live(), 'the capture is open while the start waits').toBeGreaterThan(0)

      // The capture lands in a studio that is gone: everything it opened is let go, and no session is begun.
      await window.evaluate(() => (window as unknown as { __held: { letGo: () => void } }).__held.letGo())
      await expect.poll(live, { timeout: 15_000, intervals: [200], message: 'the capture was left running' }).toBe(0)
      // Time for a start that did carry on to open its session (begin, then the first chunk a second later).
      await window.waitForTimeout(2500)
      expect(leftoverTemps(userDataDir), 'a take was opened for a studio nobody is in').toEqual([])
      // `recording:begin` makes the recordings folder before it opens anything: it was never asked, because the
      // check after the capture ended the start there (the check after `begin` would clean up, but a session
      // would have been opened and thrown away).
      expect(existsSync(recordingsDir(userDataDir)), 'recording:begin was asked for a take nobody will see').toBe(false)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-120 (5): the webcam composite is a requestAnimationFrame loop into canvas.captureStream, and Chromium stops
  // rAF in a hidden document unless the window opts out. A recorder is minimized for the whole of a take, so the
  // composite froze. A window manager is what makes a minimized window hidden to the page, and this box has
  // none (the page stays "visible" however it is hidden), so the minimized behavior itself is a hand-check on
  // the win32 release run; what this reads is the live setting on the live window.
  test('the window opts out of background throttling, so a minimized recorder keeps compositing (T-120)', async () => {
    test.setTimeout(60_000)
    const root = makeRoot('throttle')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)
    const app = await launchApp(userDataDir)
    try {
      await app.firstWindow()
      const throttled = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) throw new Error('no window')
        return win.webContents.getBackgroundThrottling()
      })
      expect(throttled, 'webContents.getBackgroundThrottling()').toBe(false)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-120 (3): both previews were assigned inside `startRecording`, while the phase was 'idle' and neither <video>
  // existed, so the recording view was a black box and the webcam thumbnail an empty border. The camera is faked
  // (this container has none) with a canvas stream, so the compositor really runs and the thumbnail has a real
  // picture to show.
  test('the recording view shows the take: the screen preview and, with a camera in the take, its thumbnail (T-120)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('previews')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await waitForHome(window)
      await stubCameras(window)
      // A camera that opens: a 320x240 canvas that repaints, captured as a stream.
      await window.evaluate(() => {
        const md = navigator.mediaDevices
        const previous = md.getUserMedia.bind(md)
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          const v = c?.video
          if (v && typeof v === 'object' && 'deviceId' in v) {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 240
            const ctx = canvas.getContext('2d')
            let n = 0
            window.setInterval(() => {
              if (!ctx) return
              ctx.fillStyle = `hsl(${(n++ * 9) % 360}, 80%, 50%)`
              ctx.fillRect(0, 0, 320, 240)
            }, 33)
            return canvas.captureStream(30)
          }
          return previous(c)
        }
      })
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })

      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('checkbox').nth(1).check() // include the webcam
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })

      // The screen preview, and the camera thumbnail over it (the compositor keeps two more, off screen, so the
      // two on screen are found by what they are: the preview is the tall black box, the thumbnail wears the
      // accent border).
      const PREVIEW = 'video.max-h-\\[60vh\\]'
      const THUMB = 'video.border-accent'
      await expect(window.locator(PREVIEW)).toHaveCount(1)
      await expect(window.locator(THUMB)).toHaveCount(1)
      const width = (selector: string): Promise<number> =>
        window.evaluate((sel) => (document.querySelector(sel) as HTMLVideoElement | null)?.videoWidth ?? 0, selector)
      await expect.poll(() => width(PREVIEW), { timeout: 15_000, intervals: [200], message: 'the screen preview showed nothing' }).toBeGreaterThan(0)
      await expect.poll(() => width(THUMB), { timeout: 15_000, intervals: [200], message: 'the camera thumbnail showed nothing' }).toBe(320)
      // The preview is the stream that is being recorded, not a still: its time moves.
      await expect
        .poll(() => window.evaluate((sel) => (document.querySelector(sel) as HTMLVideoElement | null)?.currentTime ?? 0, PREVIEW), { timeout: 15_000 })
        .toBeGreaterThan(0)

      // Stop and decline the save: nothing is kept, and the previews let go of their streams.
      await window.getByRole('button', { name: 'Stop' }).click()
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 60_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-121 (3): the webcam fallback. The camera OPENS and the compositor cannot start, so the take carries on
  // as the screen alone - and the camera used to stay live for all of it (QA measured the track "live" the whole
  // take: the camera's light on during a screen-only recording) with an empty bordered box over the preview. The
  // camera is faked with a canvas stream (this container has none); the compositor is made to fail the way a
  // camera that opens and never plays does, by refusing `play()` on the one element that holds that stream.
  test('a camera that opens and a compositor that cannot start: the camera is let go and no empty box is left (T-121)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('camfallback')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await waitForHome(window)
      await stubCameras(window)
      await window.evaluate(() => {
        const w = window as unknown as { __fakeCam?: MediaStream }
        const md = navigator.mediaDevices
        const previous = md.getUserMedia.bind(md)
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          const v = c?.video
          if (v && typeof v === 'object' && 'deviceId' in v) {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 240
            const ctx = canvas.getContext('2d')
            let n = 0
            window.setInterval(() => {
              if (!ctx) return
              ctx.fillStyle = `hsl(${(n++ * 9) % 360}, 80%, 50%)`
              ctx.fillRect(0, 0, 320, 240)
            }, 33)
            w.__fakeCam = canvas.captureStream(30)
            return w.__fakeCam
          }
          return previous(c)
        }
        const play = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          if (w.__fakeCam && this.srcObject === w.__fakeCam) {
            return Promise.reject(new DOMException('The camera feed cannot play.', 'NotAllowedError'))
          }
          return play.call(this)
        }
      })
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('checkbox').nth(1).check() // include the webcam
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()

      // The fallback is announced, and the take carries on as the screen alone.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 30_000, intervals: [200] })
        .toContain('Recording screen only.')
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 15_000 })

      // The camera that was opened is let go: every track of it has ended while the take is still rolling.
      const camStates = (): Promise<string[]> =>
        window.evaluate(
          () =>
            (window as unknown as { __fakeCam?: MediaStream }).__fakeCam?.getTracks().map((t) => t.readyState) ?? ['no camera was opened']
        )
      await expect
        .poll(camStates, { timeout: 10_000, intervals: [200], message: 'the camera stayed live through a screen-only take' })
        .toEqual(['ended'])
      // ...and nothing is drawn for it: the screen preview is there, the camera's box is not.
      await expect(window.locator('video.max-h-\\[60vh\\]')).toHaveCount(1)
      await expect(window.locator('video.border-accent'), 'no empty camera box over the screen preview').toHaveCount(0)

      await window.getByRole('button', { name: 'Stop' }).click()
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 60_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-121 (3), the other half: the camera's own failure path is an await-and-catch like its siblings, and the
  // catch did not ask whether the studio was still there. Leaving Record while the camera opens and then having
  // the compositor refuse it toasted "Recording screen only." into a screen nobody was on, and the start went on
  // to open a session (`recording:begin` made the recordings folder) before the next check cleaned it up.
  test('leaving Record while the camera is opening, then the camera failing, ends the start silently (T-121)', async () => {
    test.setTimeout(120_000)
    const root = makeRoot('leftcamfail')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await waitForHome(window)
      await stubCameras(window)
      await window.evaluate(() => {
        type Held = { cam?: MediaStream; playAsked: number; fail: () => void }
        const w = window as unknown as { __held: Held }
        let fail: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          fail = resolve
        })
        w.__held = { playAsked: 0, fail }
        const md = navigator.mediaDevices
        const previous = md.getUserMedia.bind(md)
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          const v = c?.video
          if (v && typeof v === 'object' && 'deviceId' in v) {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 240
            canvas.getContext('2d')?.fillRect(0, 0, 320, 240)
            w.__held.cam = canvas.captureStream(30)
            return w.__held.cam
          }
          return previous(c)
        }
        // The compositor plays the camera's element before anything else: hold that, then refuse it.
        const play = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          if (w.__held.cam && this.srcObject === w.__held.cam) {
            w.__held.playAsked += 1
            return gate.then(() => Promise.reject(new DOMException('The camera feed cannot play.', 'NotAllowedError')))
          }
          return play.call(this)
        }
      })
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await installToastLog(window)
      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('checkbox').nth(1).check() // include the webcam
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: /Starting…/ })).toBeDisabled()
      await expect
        .poll(() => window.evaluate(() => (window as unknown as { __held: { playAsked: number } }).__held.playAsked), {
          timeout: 20_000,
          message: 'the compositor asked the camera element to play'
        })
        .toBeGreaterThan(0)

      // Leave while the camera is opening (the Home link is not intercepted before the phase is 'recording').
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })

      // The camera now fails, in a studio that is gone.
      await window.evaluate(() => (window as unknown as { __held: { fail: () => void } }).__held.fail())
      await window.waitForTimeout(2500)
      expect(
        (await readToastLog(window)).join(' | '),
        'a failure toast for a screen nobody is on'
      ).not.toContain('Recording screen only.')
      expect(leftoverTemps(userDataDir), 'a take was opened for a studio nobody is in').toEqual([])
      expect(existsSync(recordingsDir(userDataDir)), 'recording:begin was asked for a take nobody will see').toBe(false)
      const camTracks = await window.evaluate(
        () => (window as unknown as { __held: { cam?: MediaStream } }).__held.cam?.getTracks().map((t) => t.readyState) ?? []
      )
      expect(camTracks, 'the camera is let go').toEqual(['ended'])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // ------------------------------------------------------------------
  // 4. The full capture loop
  // ------------------------------------------------------------------

  test('record -> Stop -> save as WebM writes real bytes, toasts, and joins recent videos', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('webm')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.webm')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath)
      await stubShellReveal(app)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      // Screen-only: no mic in this container, and WebM so the assertion
      // lands on the recorder's own output rather than on ffmpeg's.
      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(2).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()

      // Recording phase: the header swaps in, the elapsed clock runs, and the
      // live preview element is mounted.
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:00/)).toBeVisible()
      await expect(window.locator('video')).toHaveCount(1)
      // The option cards are gone — the layout really switched phase.
      await expect(window.getByRole('button', { name: /Start recording/ })).toHaveCount(0)
      // The clock is driven by a real interval, not a static render.
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      // T-120: the live preview is attached. `srcObject` used to be assigned while the phase was still 'idle',
      // before the <video> existed, so this element was a black box: no stream, no picture, width 0.
      await expect
        .poll(() => window.evaluate(() => document.querySelector('video')?.videoWidth ?? 0), {
          timeout: 15_000,
          intervals: [200],
          message: 'the recording view\'s <video> never showed the capture'
        })
        .toBeGreaterThan(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-05-recording.png') })

      // A session temp file exists WHILE recording — the streaming save path
      // is writing chunks as they arrive rather than buffering in the renderer.
      expect(leftoverTemps(userDataDir).length).toBe(1)

      await window.getByRole('button', { name: 'Stop' }).click()

      // The saved file is the end state, not the toast.
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), {
          timeout: 60_000,
          intervals: [250]
        })
        .toBeGreaterThan(1000)

      const probe = await probeFile(outPath)
      expect(probe.format?.format_name).toContain('webm')
      const video = probe.streams?.find((s) => s.codec_type === 'video')
      expect(video).toBeDefined()
      expect(video?.width).toBeGreaterThan(0)
      // Screen-only was requested, so there must be no audio stream.
      expect(probe.streams?.some((s) => s.codec_type === 'audio')).toBe(false)
      // T-120: the saved take has a duration in its header. MediaRecorder streams its webm, so the file it
      // writes says `N/A` and Video Studio's probe refused it ("Re-export it as MP4"); the save remuxes it.
      const seconds = Number(probe.format?.duration)
      expect(Number.isFinite(seconds), `format.duration was ${String(probe.format?.duration)}`).toBe(true)
      expect(seconds).toBeGreaterThan(0.5)

      // Toast names the size and offers both actions.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 30_000, intervals: [200] })
        .toMatch(/Saved \d+\.\d MB/)

      // The Show action reaches the shell with the file that was just written.
      await window.getByRole('button', { name: 'Show in folder', exact: true }).click()
      await expect.poll(() => readRevealCalls(app), { timeout: 15_000, intervals: [200] }).toEqual([outPath])

      // Back to idle, and the recording is in the same recent-videos bucket
      // the Video Studio importer reads.
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => readConfig(userDataDir).recentFiles?.video ?? [], {
          timeout: 15_000,
          intervals: [200]
        })
        .toContain(outPath)

      // The streaming session's temp file was reaped by finalize.
      expect(leftoverTemps(userDataDir)).toEqual([])

      // T-120: and the WebM take OPENS. This path used to end at "the file exists"; the toast's second button
      // was only ever driven for an MP4, so a take saved with Convert off, which Video Studio could not probe,
      // was never found out. The button loads the file and the studio comes up with a clip in it.
      await window.getByRole('button', { name: 'Edit in Video Studio' }).click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('take.webm').first()).toBeVisible({ timeout: 20_000 })
      await expect(window.getByRole('button', { name: 'Export 1' })).toBeVisible({ timeout: 20_000 })
      await expect(window.locator('video')).toHaveCount(1)
      // The step the old take died at: the studio's own refusal of a file with no duration.
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/re-export|couldn't open/i)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('record -> Esc -> save as MP4 runs the real convert and "Edit in Video Studio" hands the file over', async () => {
    test.setTimeout(240_000)
    ensureScreenshots()
    const root = makeRoot('mp4save')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      // MP4 stays checked — this run exercises the ffmpeg conversion branch.
      await expect(window.getByRole('checkbox').nth(2)).toBeChecked()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })

      // T-72 rider: Escape-to-stop is a window-level binding and so is the
      // app-wide HotkeyOverlay's `?` — and /record's own shortcut table
      // advertises BOTH. Opening the overlay mid-take and pressing Escape
      // must dismiss the overlay only; on the unguarded build the same
      // keypress also ended the recording, so a user who opened the
      // shortcut list to check something lost the take to closing it.
      await window.keyboard.press('?')
      await expect(window.getByText('Press Esc or ? to close.')).toBeVisible({ timeout: 10_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByRole('dialog')).toHaveCount(0)
      // Still recording: the phase never changed.
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible()
      await expect(window.getByText(/Finishing up/)).toHaveCount(0)

      // Round 18 C's Esc binding — the only way the documented "Esc: Stop
      // recording" hotkey is proven to be wired.
      await window.keyboard.press('Escape')

      // The saving card is the conversion's own UI: progress bar + abort.
      await expect(window.getByText('Finishing up — converting to MP4…')).toBeVisible({
        timeout: 20_000
      })
      // T-88: Convert to MP4 is on, so the convert is the thing that can be
      // stopped — Discard is a live button here (and not in the WebM take).
      await expect(window.getByRole('button', { name: 'Discard recording' })).toBeEnabled()
      // T-113: the convert bar is a named progressbar, not a colored width.
      const convertBar = window.getByRole('progressbar', { name: 'Converting the recording to MP4' })
      await expect(convertBar).toBeVisible()
      await expect(convertBar).toHaveAttribute('aria-valuemin', '0')
      await expect(convertBar).toHaveAttribute('aria-valuemax', '100')
      await expect(convertBar).toHaveAttribute('aria-valuenow', /^\d+$/)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-06-saving.png') })

      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), {
          timeout: 120_000,
          intervals: [500]
        })
        .toBeGreaterThan(1000)

      // ffmpeg really ran: h264 in an mp4 container, not a renamed webm.
      const probe = await probeFile(outPath)
      expect(probe.format?.format_name).toContain('mp4')
      const video = probe.streams?.find((s) => s.codec_type === 'video')
      expect(video?.codec_name).toBe('h264')

      // Edit in Video Studio: load into the video store, then navigate. The
      // record -> clip handoff is the whole point of the button.
      await window.getByRole('button', { name: 'Edit in Video Studio' }).click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('take.mp4').first()).toBeVisible({ timeout: 20_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-07-handoff.png') })

      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-119 (3): the save toast's "Edit in Video Studio" replaced whatever Video Studio held with no question,
  // while Video Studio's own Close and T-112's Clean audio both ask first. Two real takes, converted to MP4:
  // the first goes to an empty studio (nothing to lose, nothing asked), the second finds that take open.
  test('"Edit in Video Studio" asks before it replaces the video being edited, and asks nothing when nothing is open (T-119)', async () => {
    test.setTimeout(300_000)
    const root = makeRoot('replace')
    const userDataDir = path.join(root, 'userData')
    const firstTake = path.join(root, 'first-take.mp4')
    const secondTake = path.join(root, 'second-take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      const messages: string[] = []
      let answer: 'accept' | 'dismiss' = 'dismiss'
      window.on('dialog', async (dialog) => {
        messages.push(dialog.message())
        if (answer === 'accept') await dialog.accept()
        else await dialog.dismiss()
      })

      /** One short take, converted to MP4, to the file the stubbed Save dialog names; ends on the saved toast. */
      const recordTake = async (outPath: string): Promise<void> => {
        await stubSaveDialog(app, outPath)
        await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
        await window.getByRole('button', { name: 'Refresh sources' }).click()
        await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
        await window.getByRole('button', { name: /Start recording/ }).click()
        await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
        await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
        await window.getByRole('button', { name: 'Stop' }).click()
        await expect(window.getByRole('button', { name: 'Edit in Video Studio' })).toBeVisible({ timeout: 120_000 })
      }

      // Nothing is open in Video Studio: the button hands the take over without a question.
      await gotoRecordFromHome(window)
      await recordTake(firstTake)
      await window.getByRole('button', { name: 'Edit in Video Studio' }).click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('first-take.mp4').first()).toBeVisible({ timeout: 20_000 })
      expect(messages, 'an empty studio has nothing to lose').toEqual([])

      // A toast the pointer rests on never leaves (react-hot-toast pauses a hovered one), and the first take's
      // "Edit in Video Studio" is still under it: move off, and wait for it to go, so the button found after
      // the second take is the second take's.
      await window.mouse.move(2, 2)
      await expect(window.locator('[data-rht-toaster] [role="status"]')).toHaveCount(0, { timeout: 15_000 })

      // A second take, with the first one open: now there is a clip and its edits to lose.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoRecordFromHome(window)
      await recordTake(secondTake)
      await window.getByRole('button', { name: 'Edit in Video Studio' }).click()
      await expect.poll(() => messages.length, { timeout: 10_000 }).toBe(1)
      expect(messages[0]).toBe("Replace the video you're editing? 1 clip and its edits will be discarded.")
      // Declined: still on Record, the toast's button is still there, and the first take is still the open video.
      await window.waitForTimeout(800)
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Edit in Video Studio' })).toBeVisible()

      // Accepted: the second take replaces it.
      answer = 'accept'
      await window.getByRole('button', { name: 'Edit in Video Studio' }).click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('second-take.mp4').first()).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText('first-take.mp4')).toHaveCount(0)
      expect(messages).toHaveLength(2)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-132 (1): Clean audio's extraction (minutes, on a long VOD) ended with `navigate('/audio')` wherever the person was. `navigate` still works
  // from a studio that unmounted, and landing on /audio unmounts RecordStudio, whose cleanup stops the tracks: a LIVE TAKE was cut short and the
  // save dialog opened over Audio Studio. The extraction here is held 14 s (the take is started meanwhile), so it ends in the middle of the take:
  // the person stays on Record, the clock keeps running, the take is saved whole, and the sound is waiting in Audio Studio with a toast that
  // offers the way there.
  test('Clean audio finishing during a live take does not move the person or cut the take short (T-132 (1))', async () => {
    test.setTimeout(300_000)
    const root = makeRoot('cleanduring')
    const userDataDir = path.join(root, 'userData')
    const take = path.join(root, 'take.mp4')
    const clip = path.join(root, 'tour.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)
    const made = await runBinary(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip
    ])
    if (made.code !== 0) throw new Error(`fixture ffmpeg exit ${made.code}: ${made.stderr.slice(-800)}`)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await waitForHome(window)
      await installToastLog(window)
      // A video with sound in Video Studio.
      await window.locator('a', { hasText: 'Video Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
      await window.evaluate((file) => {
        const zone = document.querySelector('[data-tutorial="video-import"] .card')
        if (!zone) throw new Error('Video Studio drop zone not found')
        const f = new File([new Uint8Array([0])], 'tour.mp4', { type: '' })
        Object.defineProperty(f, 'path', { value: file })
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: { files: [f] } })
        zone.dispatchEvent(event)
      }, clip)
      // The hook badge's own ffmpeg has run (it asks once the clip is on screen); the next ffmpeg is the extraction, held for 14 s.
      await expect(window.getByText(/^(Strong|OK|Weak) hook$/)).toBeVisible({ timeout: 30_000 })
      await installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 14_000 }])
      await window.getByRole('button', { name: 'Clean audio' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Extracting audio…')

      // Meanwhile: Record, and a live take.
      await window.getByRole('link', { name: 'Home' }).click()
      await gotoRecordFromHome(window)
      await stubSaveDialog(app, take)
      await window.getByRole('checkbox').nth(0).uncheck() // no microphone in this container
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })

      // The extraction ends in the middle of the take.
      await expect.poll(() => readToastLog(window), { timeout: 60_000, intervals: [250] }).toEqual(
        expect.arrayContaining([expect.stringContaining('Extracted the sound from tour.mp4')])
      )
      const log = await readToastLog(window)
      expect(log, 'nothing took the person to Audio Studio').not.toContain('Opening Audio Studio')
      expect(log.find((t) => t.includes('Extracted the sound from tour.mp4')), 'the toast carries the way there').toContain('Open Audio Studio')
      await expect(window.locator('h1', { hasText: 'Record' }), 'still on Record').toBeVisible()
      await expect(window.getByRole('button', { name: 'Stop' }), 'the take is still running').toBeVisible()
      const clock = async (): Promise<number> => {
        const text = (await window.getByText(/REC \d\d:\d\d/).first().textContent()) ?? ''
        const m = /REC (\d\d):(\d\d)/.exec(text)
        return m ? Number(m[1]) * 60 + Number(m[2]) : -1
      }
      const at = await clock()
      expect(at).toBeGreaterThanOrEqual(1)
      await expect.poll(clock, { timeout: 15_000, intervals: [250], message: 'the clock keeps counting after the extraction ended' }).toBeGreaterThan(at)

      // Stop: the save goes ahead on Record, and the take is a whole file with a picture.
      await window.getByRole('button', { name: 'Stop' }).click()
      await expect(window.getByRole('button', { name: 'Edit in Video Studio' })).toBeVisible({ timeout: 120_000 })
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible()
      expect(existsSync(take), 'the take was saved').toBe(true)
      const probe = await probeFile(take)
      expect(probe.streams?.some((st) => st.codec_type === 'video')).toBe(true)
      expect(Number(probe.format?.duration), 'and it is as long as the clock said (not cut at the extraction)').toBeGreaterThanOrEqual(at)

      // The sound is waiting for them in Audio Studio, loaded while they were elsewhere.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.locator('a', { hasText: 'Audio Studio' }).first().click()
      await expect(window.locator('h1', { hasText: 'Audio Studio' })).toBeVisible({ timeout: 30_000 })
      await expect(window.locator('header').getByText('tour.mp4', { exact: true })).toBeVisible({ timeout: 30_000 })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('the convert bar draws what main reports: the percent it measured, or a sliding bar when it has none (T-115)', async () => {
    test.setTimeout(240_000)
    const root = makeRoot('convertbar')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      // MP4 stays checked: the save card only has a convert bar when there is a convert.
      await expect(window.getByRole('checkbox').nth(2)).toBeChecked()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })

      // finalize stands in for the real convert so the bar can be driven deterministically: a real
      // convert reports every half second and would overwrite what this test sent. It holds the save
      // card open until the test lets go, then answers "nothing saved" (the calm discard line).
      // Everything before it (begin, the chunks) and the progress channel are the real ones.
      await app.evaluate(({ ipcMain }) => {
        const g = globalThis as unknown as { __open: () => void }
        const gate = new Promise<void>((resolve) => {
          g.__open = resolve
        })
        ipcMain.removeHandler('recording:finalize')
        ipcMain.handle('recording:finalize', async () => {
          await gate
          return null
        })
      })
      const send = (info: { percent?: number }): Promise<void> =>
        app.evaluate(({ BrowserWindow }, payload) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('recording:progress', payload)
        }, info)

      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      const bar = window.getByRole('progressbar', { name: 'Converting the recording to MP4' })
      await expect(bar).toBeVisible({ timeout: 20_000 })
      const fill = bar.locator('div')
      const sliding = bar.locator('.progress-indeterminate')

      // Before main has said anything the bar is a measurement of nothing yet: 0.
      await expect(bar).toHaveAttribute('aria-valuenow', '0')
      await expect(sliding).toHaveCount(0)

      // A percent main measured is drawn as that percent.
      await send({ percent: 40 })
      await expect(bar).toHaveAttribute('aria-valuenow', '40')
      await expect(fill).toHaveAttribute('style', /width:\s*40%/)
      await expect(sliding).toHaveCount(0)

      // Progress with no percent is "working, no measurement": the sliding segment, no number.
      await send({})
      await expect(bar).not.toHaveAttribute('aria-valuenow', /.*/)
      await expect(sliding).toHaveCount(1)
      await expect(bar).toHaveAttribute('aria-valuemin', '0')
      await expect(bar).toHaveAttribute('aria-valuemax', '100')

      // And a measurement after that takes the bar back to a number (never a stuck slider).
      await send({ percent: 99 })
      await expect(bar).toHaveAttribute('aria-valuenow', '99')
      await expect(sliding).toHaveCount(0)

      // Let the save end: the card goes, the calm line is said.
      await app.evaluate(() => (globalThis as unknown as { __open: () => void }).__open())
      await expect(bar).toHaveCount(0, { timeout: 20_000 })
      await expect.poll(() => readToastLog(window), { timeout: 15_000 }).toContain('Recording discarded')
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('"Discard recording" kills the running convert, says so calmly, and leaves no file behind', async () => {
    test.setTimeout(240_000)
    ensureScreenshots()
    const root = makeRoot('abortsave')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'aborted.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })

      // Long enough that the h264 encode of it is still running when the
      // Discard click lands. A 1 s take converts faster than Playwright can
      // click, which would make this test a coin flip.
      await expect(window.getByText(/REC 00:0[89]/)).toBeVisible({ timeout: 30_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      const bar = window.locator('div.bg-accent').first()
      await expect(window.getByText('Finishing up — converting to MP4…')).toBeVisible({
        timeout: 20_000
      })

      // Wait for the progress bar to leave its 2% floor. ffmpeg only emits
      // `out_time` while it is actually encoding, so a moving bar is proof
      // the child process is alive and there is something to cancel — that
      // is what makes the click deterministic rather than a race.
      await expect
        .poll(
          async () => {
            const style = (await bar.getAttribute('style')) ?? ''
            const m = /width:\s*(\d+)%/.exec(style)
            return m?.[1] ? Number(m[1]) : 0
          },
          { timeout: 60_000, intervals: [100] }
        )
        .toBeGreaterThan(2)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-08-discard.png') })

      await window.getByRole('button', { name: 'Discard recording' }).click()

      // T-44: the calm copy, and the trash icon that proves it came through
      // the neutral `toast(...)` branch rather than `toast.error` — the
      // error variant renders react-hot-toast's own <div> icon, never this
      // path. Asserted live, before the toast auto-dismisses.
      await expect(
        window
          .locator('div:has(> [role="status"])')
          .filter({ hasText: 'Recording discarded' })
          .locator('path[d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"]')
      ).toBeVisible({ timeout: 60_000 })

      // The convert really died: the phase returns to idle, the streaming
      // temp file is reaped, and nothing joins recents.
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 60_000
      })
      expect(leftoverTemps(userDataDir)).toEqual([])
      expect(readConfig(userDataDir).recentFiles?.video ?? []).toEqual([])

      // T-44: the half-written mp4 ffmpeg was killed midway through is GONE
      // from the path the user picked in the save dialog. It was never
      // playable — the kill lands long before the moov atom — so leaving it
      // there handed the user a file with their chosen name that no player
      // could open.
      expect(existsSync(outPath)).toBe(false)

      // And the message is the discard branch's own copy, with none of the
      // raw IPC / ffmpeg vocabulary the rejected invoke used to leak
      // ("Error invoking remote method 'recording:finalize': ...
      // convert-to-mp4 exit signal SIGKILL: <stderr tail>"). A deliberate
      // cancel is not a crash, and it must not read like one.
      const toasts = (await readToastLog(window)).join(' | ')
      expect(toasts).toContain('Recording discarded')
      expect(toasts).not.toMatch(/Error invoking remote method|convert-to-mp4 exit|SIGKILL/)
      expect(toasts).not.toMatch(/Save failed/)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('cancelling the save dialog discards the take, says so, and reaps the temp file', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('cancel')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(2).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      // The discard branch has its own copy — it must not read as a failure.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 60_000, intervals: [200] })
        .toContain('Recording discarded')

      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 20_000 })
      // Nothing was pushed to recents, and the partial webm is gone.
      expect(readConfig(userDataDir).recentFiles?.video ?? []).toEqual([])
      expect(leftoverTemps(userDataDir)).toEqual([])

      // T-88: the dialog whose Cancel just threw the take away said so up
      // front. The OS chrome is HL-dialog; the title it is opened with is not.
      expect(await readSaveDialogTitles(app)).toEqual(['Save recording (Cancel discards it)'])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a WebM take: the card says "saving", has nothing to stop, and the dialog title warns that Cancel discards (T-88)', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('webmcard')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.webm')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // The "dialog" stays open for 6 s, the way it does while a person reads
      // it — and the saving card is on screen for exactly that long.
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(2).uncheck() // WebM: nothing converts
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      const card = window.locator('div.card', { hasText: 'Finishing up' })
      // It says what is happening — saving — and never "converting": with
      // Convert to MP4 off nothing converts (the old line said "converting and
      // writing to disk…" regardless).
      await expect(card.getByText('Finishing up — saving to disk…')).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText(/convert/i)).toHaveCount(0)
      // The one step that reports progress is the convert, so there is no bar
      // to sit on its 2% floor.
      await expect(card.locator('div.bg-accent')).toHaveCount(0)
      // "Discard recording" used to be live here and do nothing at all. It is
      // off, with the reason on screen.
      await expect(card.getByRole('button', { name: 'Discard recording' })).toBeDisabled()
      await expect(
        card.getByText('Saving a WebM is a quick copy, so there is nothing to stop.')
      ).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-13-webm-saving.png') })

      // The dialog the card is waiting behind told the user Cancel discards.
      expect(await readSaveDialogTitles(app)).toEqual(['Save recording (Cancel discards it)'])

      // And the save still completes: the dialog "returns", the file lands.
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), {
          timeout: 60_000,
          intervals: [250]
        })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 20_000
      })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a take that ends ITSELF (the captured window closed: every track ends) shows the saving card at once, not a live REC screen with a dead Stop (T-123 (5))', async () => {
    // Only the Stop BUTTON set the phase to 'saving'. A captured window that closes ends every track, MediaRecorder stops on its
    // own, `onstop` runs `finalizeRecording`, and the whole save (the save dialog, the convert, which can take minutes) ran under
    // "REC 00:05" with a Stop button that did nothing and no way to discard. The phase is set where the save begins now.
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('self-ended')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // The "dialog" stays open for 6 s, the way it does while a person reads it: the card is on screen for exactly that long.
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck() // microphone off
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      // Every stream the page asks the browser for is kept, so the test can end them the way a closed window does.
      await window.evaluate(() => {
        const md = navigator.mediaDevices
        const real = md.getUserMedia.bind(md)
        ;(window as unknown as { __streams: MediaStream[] }).__streams = []
        md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
          const stream = await real(constraints)
          ;(window as unknown as { __streams: MediaStream[] }).__streams.push(stream)
          return stream
        }
      })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })

      // The captured window goes away: every track of the capture ends by itself. Nothing presses Stop.
      await window.evaluate(() => {
        for (const stream of (window as unknown as { __streams: MediaStream[] }).__streams) {
          stream.getTracks().forEach((track) => track.stop())
        }
      })

      const card = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(card.getByText('Finishing up — converting to MP4…')).toBeVisible({ timeout: 20_000 })
      // The save is on screen as a save: no clock still running, no Stop that does nothing.
      await expect(window.getByText(/REC \d\d:\d\d/)).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      // And it can be abandoned like any other save: Discard is there (a MP4 convert is the step it can stop).
      await expect(card.getByRole('button', { name: 'Discard recording' })).toBeEnabled()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-14-self-ended-saving.png') })
      // The dialog the card is waiting behind is the one every take gets.
      expect(await readSaveDialogTitles(app)).toEqual(['Save recording (Cancel discards it)'])

      // The take is still saved: the dialog "returns", the convert runs, the file lands, and Record is idle again.
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), { timeout: 90_000, intervals: [250] })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-124 (1): `combined` is the screen's video track plus the microphone's audio track, and MediaRecorder stops by itself only when
  // EVERY track has ended. With the default microphone ON a crashed game or a closed captured window ended the picture and left
  // the sound, so REC kept counting over a frozen frame while USER_GUIDE says the take "ends on its own and saves". Nothing
  // listened for the end of a track. The two cases below end ONLY the screen's video track, the way the OS ends it when the
  // window goes (`stop()` alone does not fire `ended`, which is the event a source that went away fires, so the test fires both),
  // with a live microphone track beside it: the plain path, and the webcam path, where the recorder's own video track is the
  // compositor's canvas capture (it never ends) and the track that does end is the compositor's source.
  async function holdStreamsWithMic(window: Page, holdMic = false): Promise<void> {
    await window.evaluate((hold) => {
      type Held = { screen: MediaStream[]; all: MediaStream[]; micAsked: number; release: () => void }
      const w = window as unknown as { __held: Held }
      let release: () => void = () => undefined
      const gate = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
      w.__held = { screen: [], all: [], micAsked: 0, release }
      const md = navigator.mediaDevices
      const previous = md.getUserMedia.bind(md)
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        // The microphone: this container has none, so a live audio track from an oscillator stands in for it.
        if (c && c.audio && !c.video) {
          w.__held.micAsked += 1
          await gate
          const ctx = new AudioContext()
          const dest = ctx.createMediaStreamDestination()
          const osc = ctx.createOscillator()
          osc.connect(dest)
          osc.start()
          w.__held.all.push(dest.stream)
          return dest.stream
        }
        const stream = await previous(c)
        w.__held.all.push(stream)
        const v = c?.video as unknown as { mandatory?: { chromeMediaSource?: string } } | undefined
        if (v && typeof v === 'object' && v.mandatory?.chromeMediaSource === 'desktop') w.__held.screen.push(stream)
        return stream
      }
    }, holdMic)
  }

  async function endScreenTrackOnly(window: Page): Promise<string[]> {
    return window.evaluate(() => {
      const held = (window as unknown as { __held: { screen: MediaStream[]; all: MediaStream[] } }).__held
      for (const stream of held.screen) {
        for (const track of stream.getVideoTracks()) {
          track.stop()
          // What the browser fires when the source goes away (stop() from script does not fire it).
          track.dispatchEvent(new Event('ended'))
        }
      }
      return held.all.flatMap((s) => s.getTracks().map((t) => `${t.kind}:${t.readyState}`))
    })
  }

  test('the captured window closing ends a take that has the microphone on, and saves it (T-124 (1))', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('screen-ended-mic')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)
      await holdStreamsWithMic(window)

      await expect(window.getByRole('checkbox').nth(0)).toBeChecked() // the microphone is ON: the default
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })

      // The window goes away: the picture's track ends, the microphone's does not.
      const states = await endScreenTrackOnly(window)
      expect(states, 'the fixture ends the picture and leaves the sound live').toEqual(expect.arrayContaining(['video:ended', 'audio:live']))

      const card = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(
        card.getByText('Finishing up — converting to MP4…'),
        'the take ended itself and began its save (REC kept counting over a frozen frame)'
      ).toBeVisible({ timeout: 20_000 })
      await expect(window.getByText(/REC \d\d:\d\d/)).toHaveCount(0)
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), { timeout: 90_000, intervals: [250] })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
      // The saved file carries the sound the microphone made.
      const probe = await probeFile(outPath)
      expect((probe.streams ?? []).map((s) => s.codec_type).sort()).toEqual(['audio', 'video'])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // T-125 (25): the mirror of the screen's end. A microphone that goes away mid-take (a headset pulled, a Bluetooth one out of range)
  // ends its audio track and nothing else: the screen keeps recording and REC keeps counting over a take that is now silent, and
  // nothing said so until the file was played back. The take is NOT ended (the picture is worth keeping); the person is told, once.
  async function endMicTrackOnly(window: Page): Promise<string[]> {
    return window.evaluate(() => {
      const held = (window as unknown as { __held: { screen: MediaStream[]; all: MediaStream[] } }).__held
      for (const stream of held.all) {
        if (held.screen.includes(stream)) continue
        for (const track of stream.getAudioTracks()) {
          track.stop()
          // What the browser fires when a device goes away (stop() from script does not fire it).
          track.dispatchEvent(new Event('ended'))
        }
      }
      return held.all.flatMap((s) => s.getTracks().map((t) => `${t.kind}:${t.readyState}`))
    })
  }

  const MIC_STOPPED = 'The microphone stopped. The rest of this recording has no sound from it.'
  // T-126 (2): the toast is gone in 8 s, so the loss is also a line that stays - on the REC header, on the saving card, and as the
  // second sentence of the saved toast - on the same clock the REC header counts.
  const MIC_LOST_LINE = /^Microphone stopped at \d\d:\d\d — no sound after that$/

  test('a microphone that drops mid-take is announced once, the take carries on, and it still saves (T-125 (25))', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('mic-ended')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)
      await holdStreamsWithMic(window)

      await expect(window.getByRole('checkbox').nth(0)).toBeChecked() // the microphone is ON: the default
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      expect(await readToastLog(window), 'nothing is said while the microphone is fine').not.toContain(MIC_STOPPED)

      // The microphone goes away; the screen does not.
      const states = await endMicTrackOnly(window)
      expect(states, 'the fixture ends the sound and leaves the picture live').toEqual(expect.arrayContaining(['audio:ended', 'video:live']))
      await expect
        .poll(async () => (await readToastLog(window)).filter((t) => t === MIC_STOPPED).length, { timeout: 15_000, intervals: [200] })
        .toBe(1)

      // The take carries on: still recording, still counting, no save begun.
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible()
      await expect(window.locator('div.card', { hasText: 'Finishing up' })).toHaveCount(0)
      await expect(window.getByText(/REC 00:0[2-9]|REC 00:[1-5]\d/)).toBeVisible({ timeout: 10_000 })

      // T-126 (2): the REC header keeps the record after the toast has gone - when it stopped, and what that cost.
      const headerLine = window.getByText(MIC_LOST_LINE)
      await expect(headerLine, 'one line on the REC header, not repeated').toHaveCount(1)
      await expect(headerLine).toBeVisible()
      await expect(headerLine).toHaveClass(/text-danger/)

      // Stopping it saves what was recorded, and says nothing more about the microphone (as a TOAST; the card and the saved
      // toast repeat the line - the person looked away for the 8 s of the first one).
      await window.getByRole('button', { name: 'Stop' }).click()
      const card = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(card.getByText(MIC_LOST_LINE), 'the saving card repeats the loss').toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), { timeout: 90_000, intervals: [250] })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      expect((await readToastLog(window)).filter((t) => t === MIC_STOPPED), 'told once, not again by the save').toHaveLength(1)
      // T-126 (2): and the saved toast carries the loss as its second sentence, beside the buttons it always had.
      const savedToasts = (await readToastLog(window)).filter((t) => /^Saved [\d.]+ MB/.test(t))
      expect(savedToasts, 'one saved toast').toHaveLength(1)
      expect(savedToasts[0], 'the saved toast names the loss').toMatch(/^Saved [\d.]+ MB\. Microphone stopped at \d\d:\d\d — no sound after that\. Show in folder/)
      // The line goes with the take: the next studio view has none of it.
      await expect(window.getByText(MIC_LOST_LINE)).toHaveCount(0)
      const probe = await probeFile(outPath)
      expect((probe.streams ?? []).map((s) => s.codec_type)).toContain('video')
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a take with a working microphone that is stopped by the person says nothing about the microphone (T-125 (25))', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('mic-fine')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)
      await holdStreamsWithMic(window)

      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      // T-126 (2), the negative: a clean take shows none of the three - not on the REC header, not on the saving card, not in the toast.
      await expect(window.getByText(/Microphone stopped at/)).toHaveCount(0)
      // T-126 (4): the REC clock is the shared clock, hour-scale too: two hours in reads "REC 2:00:0x", not "REC 120:0x". The take is
      // really seconds long; the renderer's clock is moved two hours on for the read and given back before Stop.
      await window.evaluate(() => {
        const w = window as unknown as { __realNow?: () => number }
        const real = Date.now.bind(Date)
        w.__realNow = real
        Date.now = () => real() + 7_200_000
      })
      await expect(window.getByText(/REC 2:00:0\d/), 'two hours in: h:mm:ss').toBeVisible({ timeout: 10_000 })
      await expect(window.getByText(/REC 12\d:/), 'not 120 minutes').toHaveCount(0)
      await window.evaluate(() => {
        const w = window as unknown as { __realNow?: () => number }
        if (w.__realNow) Date.now = w.__realNow
      })
      await window.getByRole('button', { name: 'Stop' }).click()
      const cleanCard = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(cleanCard).toBeVisible({ timeout: 20_000 })
      await expect(cleanCard.getByText(/Microphone stopped/)).toHaveCount(0)
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), { timeout: 90_000, intervals: [250] })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      // The streams were stopped on the way out (a stopped track does not fire `ended`, and the listener was taken off besides).
      expect((await readToastLog(window)).filter((t) => /microphone/i.test(t))).toEqual([])
      const cleanSaved = (await readToastLog(window)).filter((t) => /^Saved [\d.]+ MB/.test(t))
      expect(cleanSaved, 'one saved toast').toHaveLength(1)
      expect(cleanSaved[0], 'a clean take\'s saved toast is the one sentence it always was').toMatch(/^Saved [\d.]+ MB Show in folder/)
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('with the webcam in the take, the captured window closing still ends it: the listener is on the screen the compositor draws, not on its canvas (T-124 (1))', async () => {
    test.setTimeout(180_000)
    ensureScreenshots()
    const root = makeRoot('screen-ended-cam')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath, 6_000)
      await waitForHome(window)
      await stubCameras(window)
      await holdStreamsWithMic(window)
      // A camera that opens: a canvas that repaints, captured as a stream (the T-120 recipe).
      await window.evaluate(() => {
        const md = navigator.mediaDevices
        const previous = md.getUserMedia.bind(md)
        md.getUserMedia = async (c?: MediaStreamConstraints) => {
          const v = c?.video
          if (v && typeof v === 'object' && 'deviceId' in v) {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 240
            const ctx = canvas.getContext('2d')
            let n = 0
            window.setInterval(() => {
              if (!ctx) return
              ctx.fillStyle = `hsl(${(n++ * 9) % 360}, 80%, 50%)`
              ctx.fillRect(0, 0, 320, 240)
            }, 33)
            return canvas.captureStream(30)
          }
          return previous(c)
        }
      })
      await window.getByRole('link', { name: /Record/ }).first().click()
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible({ timeout: 15_000 })
      await installToastLog(window)

      await expect(window.getByRole('checkbox').nth(0)).toBeChecked() // the microphone is ON
      await window.getByRole('checkbox').nth(1).check() // include the webcam
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await expect(window.locator('video.border-accent'), 'the camera is IN the take').toHaveCount(1)

      const states = await endScreenTrackOnly(window)
      expect(states).toEqual(expect.arrayContaining(['video:ended', 'audio:live']))

      const card = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(
        card.getByText('Finishing up — converting to MP4…'),
        'the take ended itself and began its save'
      ).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => (existsSync(outPath) ? statSync(outPath).size : 0), { timeout: 90_000, intervals: [250] })
        .toBeGreaterThan(1000)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a window that closed while the start was still opening ends the take the moment it begins (T-124 (1))', async () => {
    // The listener is added once the recorder is running, and the awaits before that (the microphone, the camera, the
    // compositor, `recording:begin`) can take seconds: a track that ended in them fired its event with nobody listening. The
    // track's own state is asked when the listener goes on.
    test.setTimeout(180_000)
    const root = makeRoot('screen-ended-early')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath, 6_000)
      await gotoRecordFromHome(window)
      await installToastLog(window)
      await holdStreamsWithMic(window, true)

      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: /Starting…/ })).toBeDisabled()
      await expect
        .poll(() => window.evaluate(() => (window as unknown as { __held: { micAsked: number } }).__held.micAsked), {
          timeout: 20_000,
          message: 'the start reached the microphone, after the screen was captured'
        })
        .toBeGreaterThan(0)

      // The captured window goes away while the start is waiting for the microphone, and only then does the start finish.
      await endScreenTrackOnly(window)
      await window.evaluate(() => (window as unknown as { __held: { release: () => void } }).__held.release())

      const card = window.locator('div.card', { hasText: 'Finishing up' })
      await expect(
        card.getByText('Finishing up — converting to MP4…'),
        'a picture that was already gone when the take began ends it at once'
      ).toBeVisible({ timeout: 30_000 })
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 90_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a save that comes back as the cancel sentinel is a discard, not "Save failed" (T-88)', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('sentinel')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      // Main answers a discard with null today (T-44), so the rejection form of
      // the same fact cannot be reached by clicking. Replace the handler IN
      // MAIN with one that rejects the way the runners do — the shared
      // sentinel message — and let the renderer's real catch decide. Electron
      // wraps the rejection in "Error invoking remote method …" on the way
      // across, exactly as it would for the real thing.
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('recording:finalize')
        ipcMain.handle('recording:finalize', async () => {
          throw new Error('imagii:cancelled')
        })
      })
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      // The calm line, in the neutral kind (the trash icon is the discard
      // branch's own; a toast.error draws react-hot-toast's red cross instead).
      await expect(
        window
          .locator('div:has(> [role="status"])')
          .filter({ hasText: 'Recording discarded' })
          .locator('path[d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"]')
      ).toBeVisible({ timeout: 60_000 })
      const toasts = (await readToastLog(window)).join(' | ')
      expect(toasts).not.toMatch(/imagii:cancelled|Save failed|Error invoking remote method/)

      // Back to idle, and the session the stubbed handler never finalized was
      // abandoned by the catch, so nothing is stranded on disk.
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 20_000
      })
      await expect.poll(() => leftoverTemps(userDataDir), { timeout: 15_000 }).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('a convert that really crashes says so in plain words and leaves nothing behind', async () => {
    test.setTimeout(240_000)
    const root = makeRoot('convertcrash')
    const userDataDir = path.join(root, 'userData')
    // A folder that does not exist. ffmpeg cannot open the output, exits
    // non-zero, and the crash branch runs for real — no fault injection, no
    // mocked convert: the same rejection a corrupt take or a full disk
    // produces. (The half-written-file half of T-59 is driven at the unit
    // layer, in src/main/ipc/recordingCancel.test.ts, where the convert can
    // be made to write bytes and THEN fail.)
    const outPath = path.join(root, 'nope', 'crashed.mp4')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath)
      await gotoRecordFromHome(window)
      await installToastLog(window)

      await window.getByRole('checkbox').nth(0).uncheck()
      // MP4 stays ticked — the convert is the thing under test.
      await expect(window.getByRole('checkbox').nth(2)).toBeChecked()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()

      // T-59: the studio's own sentence. It names what failed, what happened
      // to the take, and the setting that gets the user a file anyway.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 90_000,
          intervals: [200]
        })
        .toContain('Converting the recording to MP4 failed')

      const toasts = (await readToastLog(window)).join(' | ')
      expect(toasts).toContain('Nothing was saved')
      expect(toasts).toContain('Convert to MP4 after recording')
      // T-116: a box is checked and unchecked, never ticked; the label is quoted exactly.
      expect(toasts).toContain('uncheck "Convert to MP4 after recording"')
      expect(toasts).not.toMatch(/tick/i)
      // None of what used to arrive instead: Electron's invoke envelope
      // wrapped around ffmpeg's own vocabulary.
      expect(toasts).not.toMatch(/Error invoking remote method/)
      expect(toasts).not.toMatch(/convert-to-mp4 exit/)
      expect(toasts).not.toMatch(/libx264|yuv420p|movflags|No such file or directory/)
      // And it is a failure, not the calm discard — those two must never
      // read alike (T-44's copy is the contrast).
      expect(toasts).not.toContain('Recording discarded')
      expect(toasts).not.toMatch(/Saved \d/)

      // Back to idle with nothing left over: no file at the chosen path, no
      // streaming temp, nothing in recents.
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 60_000
      })
      expect(existsSync(outPath)).toBe(false)
      expect(leftoverTemps(userDataDir)).toEqual([])
      expect(readConfig(userDataDir).recentFiles?.video ?? []).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test("the take's suggested name is stamped from the person's clock, not UTC (T-117)", async () => {
    test.setTimeout(180_000)
    // The name was `recording-${new Date().toISOString()...}`: UTC, so an evening take in Pacific time was
    // named for the day after it was made, beside an export panel whose {date} said today. On a clock whose
    // day is never the UTC day (skewedClock.ts) the old name cannot match; in UTC both readings agree.
    const restoreClock = skewTimeZone()
    expect(localDay(), 'the skewed clock is on another day than UTC').not.toBe(utcDay())
    const root = makeRoot('stamp')
    const userDataDir = path.join(root, 'userData')
    const outPath = path.join(root, 'take.webm')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const dayBefore = localDay()
    const app = await launchApp(userDataDir).catch((err: unknown) => {
      restoreClock()
      throw err
    })
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, outPath)
      await gotoRecordFromHome(window)
      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(2).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
      await window.getByRole('button', { name: 'Stop' }).click()
      await expect
        .poll(() => readSaveDialogDefaults(app), { timeout: 60_000, intervals: [250] })
        .toHaveLength(1)

      const [suggested] = await readSaveDialogDefaults(app)
      const dayAfter = localDay()
      const m = /^recording-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.webm$/.exec(suggested ?? '')
      expect(m, `the suggested name ${suggested} is recording-<local date>T<HH-MM-SS>.webm`).not.toBeNull()
      // The date is the clock's day (either side of a midnight that fell during the run), never UTC's.
      expect([dayBefore, dayAfter]).toContain(m?.[1])
      expect(m?.[1]).not.toBe(utcDay())
      // A name Windows accepts: no colon, and no trailing Z claiming the time is UTC.
      expect(suggested).not.toMatch(/[:Z]/)

      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 20_000 })
    } finally {
      await app.close()
      restoreClock()
      cleanup(root)
    }
  })

  test('a save that fails for a reason Windows gives says so in a sentence, with no path and no channel (T-117)', async () => {
    test.setTimeout(240_000)
    // The catch only stripped the IPC envelope, so main's raw string reached the toast: a copyfile EPERM
    // with both full paths, an ENOSPC from the write stream. Main's rejection is replaced with the exact
    // string Node raises (a stubbed handler is the only way to reach a disk that is full or a folder that
    // refuses, in a container), and the renderer's real catch decides what a person reads. Electron wraps
    // it in "Error invoking remote method ..." on the way across, as it would for the real thing.
    const root = makeRoot('finalizefail')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await app.evaluate(({ ipcMain }) => {
        const failures = [
          "EPERM: operation not permitted, copyfile 'C:\\Users\\maken\\AppData\\Roaming\\imagii\\recordings\\V1StGXR8_Z.webm' -> 'D:\\Videos\\Stream take.webm'",
          'ENOSPC: no space left on device, write'
        ]
        ipcMain.removeHandler('recording:finalize')
        ipcMain.handle('recording:finalize', async () => {
          throw new Error(failures.shift() ?? 'unexpected third save')
        })
      })
      await gotoRecordFromHome(window)
      await installToastLog(window)
      await window.getByRole('checkbox').nth(0).uncheck()

      const takeAndStop = async (): Promise<void> => {
        await window.getByRole('button', { name: 'Refresh sources' }).click()
        await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
        await window.getByRole('button', { name: /Start recording/ }).click()
        await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
        await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 10_000 })
        await window.getByRole('button', { name: 'Stop' }).click()
      }
      const FAILED = 'Saving the recording failed.'

      await takeAndStop()
      const eperm = `${FAILED} Windows blocked access to a file. Close any app using it, or check your antivirus.`
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 60_000, intervals: [200] })
        .toContain(eperm)
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })

      await takeAndStop()
      const enospc = `${FAILED} Your disk is full. Free up some space and try again.`
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 60_000, intervals: [200] })
        .toContain(enospc)

      const entries = await readToastEntries(window)
      const shown = entries.map((e) => e.text)
      // Each failure is its own red toast carrying exactly the sentence (an icon is the red cross).
      expect(shown.filter((t) => t === eperm)).toHaveLength(1)
      expect(shown.filter((t) => t === enospc)).toHaveLength(1)
      expect(entries.filter((e) => e.text === eperm || e.text === enospc).every((e) => e.hasIcon)).toBe(true)
      // None of what used to arrive instead: the paths, the errno, the channel, the old fallback.
      const all = shown.join(' | ')
      expect(all).not.toMatch(/EPERM|ENOSPC|copyfile|maken|AppData|Videos|V1StGXR8_Z|\.webm|D:|C:/)
      expect(all).not.toMatch(/Error invoking remote method|recording:finalize/)
      expect(all).not.toContain('Save failed')
      // And it is a failure, not the calm discard.
      expect(all).not.toContain('Recording discarded')

      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  test('an empty take is refused in a sentence of its own, through the real IPC (T-117)', async () => {
    test.setTimeout(120_000)
    // No capture needed: a session that never received a chunk is exactly what Stop-before-the-first-chunk
    // leaves. The real handler refuses it; the sentence crosses the bridge in Electron's envelope and
    // `userFacingError` (the renderer's catch) shows it as written. The unit layer holds the sentence and
    // the helper (recordingStream.test.ts); this holds the bridge in between.
    const root = makeRoot('emptytake')
    const userDataDir = path.join(root, 'userData')
    mkdirSync(root, { recursive: true })
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await gotoRecordFromHome(window)
      const refusal = await window.evaluate(async () => {
        const api = (window as unknown as {
          api: {
            recording: {
              begin: () => Promise<{ id: string }>
              finalize: (id: string, spec: { filename: string; convertToMp4: boolean }) => Promise<unknown>
            }
          }
        }).api
        const { id } = await api.recording.begin()
        try {
          await api.recording.finalize(id, { filename: 'empty.webm', convertToMp4: false })
          return null
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      })
      expect(refusal).toBe(
        "Error invoking remote method 'recording:finalize': Error: Nothing was recorded, so there is nothing to save. Start the recording again."
      )
      // The temp file the session opened is reaped, as it was before the sentence changed.
      expect(leftoverTemps(userDataDir)).toEqual([])
    } finally {
      await app.close()
      cleanup(root)
    }
  })

  // ------------------------------------------------------------------
  // 5. The capture-phase HomeLink intercept
  // ------------------------------------------------------------------

  test('leaving mid-recording is intercepted: dismissing the confirm keeps the take rolling', async () => {
    test.setTimeout(180_000)
    const root = makeRoot('homelink')
    const userDataDir = path.join(root, 'userData')
    seedUserData(userDataDir, SEED)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await stubSaveDialog(app, null)
      await gotoRecordFromHome(window)

      // Capture the confirm's own copy AND answer it. Playwright auto-dismisses
      // when no handler is registered, which is the "Cancel keeps recording"
      // branch — registering explicitly makes the copy assertable.
      const dialogMessages: string[] = []
      window.on('dialog', (d) => {
        dialogMessages.push(d.message())
        void d.dismiss()
      })

      await window.getByRole('checkbox').nth(0).uncheck()
      await window.getByRole('checkbox').nth(2).uncheck()
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect(window.locator('img[alt]').first()).toBeVisible({ timeout: 20_000 })
      await window.getByRole('button', { name: /Start recording/ }).click()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })

      // Click Home WHILE recording. The capture-phase handler must swallow the
      // router Link's click before it navigates.
      await window.getByRole('link', { name: 'Home' }).click()

      await expect
        .poll(() => dialogMessages.join(' | '), { timeout: 15_000, intervals: [200] })
        .toBe(
          'A recording is in progress. Stop and save it before leaving? (Cancel keeps recording.)'
        )

      // Dismissed -> still on /record, still recording, take intact.
      await expect(window.locator('h1', { hasText: 'Record' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible()
      await expect(window.getByText(/REC \d\d:\d\d/)).toBeVisible()
      await expect(window.locator('h1', { hasText: 'imagii' })).toHaveCount(0)

      // Stop it properly so the app closes cleanly.
      await window.getByRole('button', { name: 'Stop' }).click()
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 60_000 })

      // And the intercept is recording-phase only: back at idle the same link
      // navigates without a confirm.
      const before = dialogMessages.length
      await window.getByRole('link', { name: 'Home' }).click()
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      expect(dialogMessages.length).toBe(before)
    } finally {
      await app.close()
      cleanup(root)
    }
  })
})
