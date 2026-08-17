import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffprobePath } from '../../src/main/ffmpeg/paths'

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
 *      renders as the calm "Recording discarded." A real convert failure
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
  return window.evaluate(() => (window as unknown as { __toastLog?: string[] }).__toastLog ?? [])
}

/**
 * Replace `dialog.showSaveDialog` in the MAIN process. The renderer half is
 * untouchable (contextBridge objects are frozen), and the save dialog is the
 * one thing standing between `recording:finalize` and a real file, so it is
 * stubbed exactly where Electron owns it. `filePath: null` stubs the Cancel
 * branch. Every other byte of the save path — the write stream, the
 * temp-file promotion, the ffmpeg convert, the stat — runs for real.
 */
async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(async ({ dialog }, chosen) => {
    const target = dialog as unknown as { showSaveDialog: unknown }
    target.showSaveDialog = async () =>
      chosen === null ? { canceled: true, filePath: undefined } : { canceled: false, filePath: chosen }
  }, filePath)
}

/**
 * Record every `shell.showItemInFolder` call in main. The OS file manager is
 * genuinely untestable, but "the Show button reached the shell with the right
 * path" is not — that is the deepest layer this element has.
 */
async function stubShellReveal(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ shell }) => {
    const g = globalThis as unknown as { __revealCalls: string[] }
    g.__revealCalls = []
    const target = shell as unknown as { showItemInFolder: unknown }
    target.showItemInFolder = (p: string) => {
      g.__revealCalls.push(p)
    }
  })
}

function readRevealCalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    async () => (globalThis as unknown as { __revealCalls?: string[] }).__revealCalls ?? []
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
    const realGetUserMedia = md.getUserMedia.bind(navigator.mediaDevices)
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      // refreshDevices' probe: `{ audio: true, video: true }`. Anything
      // else (the desktop-capture constraints, a specific deviceId) goes
      // to the real API.
      if (c && c.audio === true && c.video === true) return new MediaStream()
      return realGetUserMedia(c)
    }
    md.enumerateDevices = async () => [
      { deviceId: 'fake-cam-1', kind: 'videoinput', label: 'Fake Cam A', groupId: 'g1' },
      { deviceId: 'fake-cam-2', kind: 'videoinput', label: 'Fake Cam B', groupId: 'g1' }
    ]
  })
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
        window.getByText('Capture a screen, window, or webcam — saved locally as MP4 (or WebM).')
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
      await expect(window.getByText('Finishing up — converting and writing to disk…')).toHaveCount(0)

      await window.screenshot({ path: path.join(SCREENSHOTS, 'record-01-idle.png') })
    } finally {
      await app.close()
      cleanup(root)
    }
  })

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
      const micWarning = window.getByText('No microphone found. Click "Refresh sources" after granting permission.')
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

  const CAM_WARNING = 'No camera found. Click "Refresh sources" after granting permission.'
  const MIC_WARNING = 'No microphone found. Click "Refresh sources" after granting permission.'

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
      await expect(camWarning).toHaveClass(/text-amber-300/)
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
        .toMatch(/Webcam failed: No camera found\. Recording screen only\./)

      // And it is a warning, not an abort: the screen half of the take is
      // still what the user asked for, so it runs.
      await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText(/REC 00:00/)).toBeVisible()
      // Let a real second of chunks land — stopping at 00:00 finalizes an
      // empty session, which is a different (already-covered) path.
      await expect(window.getByText(/REC 00:0[1-9]/)).toBeVisible({ timeout: 15_000 })

      await window.getByRole('button', { name: 'Stop' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 60_000,
          intervals: [200]
        })
        .toContain('Recording discarded.')
      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({
        timeout: 30_000
      })
      expect(leftoverTemps(userDataDir)).toEqual([])
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
        window.getByText("Off = save as WebM (instant, but some apps don't accept WebM).")
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
      await expect(warning).toHaveClass(/text-amber-300/)
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
      //    studio names the fault (envelope stripped, T-59) and leaves the
      //    in-flight state instead of waiting forever. ──
      await stubFailingSources(app, 'Screen recording permission denied')
      await window.getByRole('button', { name: 'Refresh sources' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 30_000,
          intervals: [200]
        })
        .toMatch(/Screen recording permission denied/)
      expect((await readToastLog(window)).join(' | ')).not.toContain('Error invoking remote method')
      await expect(searching).toHaveCount(0)
      await expect(warning).toBeVisible()
      await expect(pick).toBeEnabled()
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

      // The specific device error reaches the user verbatim, not a generic
      // "Could not start recording".
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), {
          timeout: 20_000,
          intervals: [200]
        })
        .toMatch(/Requested device not found|NotFoundError|Could not start recording/)

      // And the app stayed idle: no REC header, no Stop button, the option
      // cards are still on screen.
      await expect(window.getByRole('button', { name: 'Stop' })).toHaveCount(0)
      await expect(window.getByText(/REC \d\d:\d\d/)).toHaveCount(0)
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

      // Toast names the size and offers both actions.
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 30_000, intervals: [200] })
        .toMatch(/Saved \d+\.\d MB\./)

      // The Show action reaches the shell with the file that was just written.
      await window.getByRole('button', { name: 'Show', exact: true }).click()
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

      // Round 18 C's Esc binding — the only way the documented "Esc: Stop
      // recording" hotkey is proven to be wired.
      await window.keyboard.press('Escape')

      // The saving card is the conversion's own UI: progress bar + abort.
      await expect(window.getByText('Finishing up — converting and writing to disk…')).toBeVisible({
        timeout: 20_000
      })
      await expect(window.getByRole('button', { name: 'Discard recording' })).toBeVisible()
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
      await expect(window.getByText('Finishing up — converting and writing to disk…')).toBeVisible({
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
          .filter({ hasText: 'Recording discarded.' })
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
      expect(toasts).toContain('Recording discarded.')
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
        .toContain('Recording discarded.')

      await expect(window.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 20_000 })
      // Nothing was pushed to recents, and the partial webm is gone.
      expect(readConfig(userDataDir).recentFiles?.video ?? []).toEqual([])
      expect(leftoverTemps(userDataDir)).toEqual([])
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
      // None of what used to arrive instead: Electron's invoke envelope
      // wrapped around ffmpeg's own vocabulary.
      expect(toasts).not.toMatch(/Error invoking remote method/)
      expect(toasts).not.toMatch(/convert-to-mp4 exit/)
      expect(toasts).not.toMatch(/libx264|yuv420p|movflags|No such file or directory/)
      // And it is a failure, not the calm discard — those two must never
      // read alike (T-44's copy is the contrast).
      expect(toasts).not.toContain('Recording discarded.')
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
