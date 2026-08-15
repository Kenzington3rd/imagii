import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { PLATFORM_PRESETS } from '../../src/main/ffmpeg/presets'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-03: one import -> export pass through the REAL built app.
 *
 * docs/TESTING.md Layer 2 was navigate-and-screenshot only, so both the
 * PiP validator bug and the imagii-file:// round-trip bug shipped green.
 * This spec closes that hole: it puts a real generated mp4 into Video
 * Studio through the renderer's own import path, runs an export from the
 * Export panel, and then asserts on the BYTES that land on disk via the
 * bundled ffprobe.
 *
 * How the import is driven: real OS drag-and-drop can't be synthesized in
 * Playwright + Electron, and contextBridge objects are read-only so
 * window.api.video.pickFile can't be stubbed from page context. Route (2)
 * from the ticket is used instead — a synthetic `drop` event carrying a
 * File decorated with the absolute `path` expando exactly the way Electron
 * decorates a real dropped file. That runs Importer.onDrop -> handleFile
 * -> videoStore.loadSource -> window.api.video.probe, i.e. the whole
 * renderer import flow including the IPC boundary. Nothing calls a
 * main-process function directly.
 *
 * The negative case is the other half of the contract: a .txt dropped on
 * the same zone must be refused with the app's own copy and must not reach
 * a loaded state. Its discrimination was proven by mutation — see the
 * 2026-08-14 note in the report for this ticket.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

// Tiny on purpose: 320x240 for ~2 s encodes and re-encodes in about a
// second, so the whole spec stays far inside the timeouts below.
const FIXTURE_SECONDS = 2
const FIXTURE_WIDTH = 320
const FIXTURE_HEIGHT = 240

interface ProbeStream {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
}

interface ProbeJson {
  streams?: ProbeStream[]
  format?: { duration?: string }
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

/** Generate the import fixture with the repo's own bundled ffmpeg. */
async function makeFixtureMp4(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}:rate=15:duration=${FIXTURE_SECONDS}`,
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

/**
 * Hermetic userData dir with every overlay flag pre-seeded (same shape as
 * smoke.spec.ts — electron-store nests dotted keys). `export.lastOutputDir`
 * is seeded too so the Export panel starts with an output folder and the
 * test never has to drive a native directory dialog.
 */
function seedUserData(userDataDir: string, exportOutDir?: string): void {
  mkdirSync(userDataDir, { recursive: true })
  const config: Record<string, unknown> = {
    welcomeSeen: true,
    tutorialSeen: { video: true, audio: true, image: true, ai: true }
  }
  if (exportOutDir) config.export = { lastOutputDir: exportOutDir }
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
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
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1'
    }
  })
}

/**
 * Record the text of every node react-hot-toast mounts. Toasts auto-dismiss
 * (2 s success / 4 s default), so polling for one with a locator races the
 * timer; a MutationObserver installed before the action never misses one.
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
  return window.evaluate(
    () => (window as unknown as { __toastLog?: string[] }).__toastLog ?? []
  )
}

/**
 * Dispatch a synthetic `drop` on Video Studio's drop zone carrying a File
 * with the absolute `path` expando Electron adds to real dropped files.
 * React reads `nativeEvent.dataTransfer` off the bubbled event, so this
 * enters Importer.onDrop exactly as a hand-drop does.
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

async function openVideoStudio(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  await window.locator('a', { hasText: 'Video Studio' }).first().click()
  await expect(window.locator('h1', { hasText: 'Video Studio' })).toBeVisible({ timeout: 30_000 })
  // The drop zone is the unloaded state's only card.
  await expect(window.getByText('Drop a video here')).toBeVisible({ timeout: 15_000 })
}

test.describe('imagii Video Studio import -> export', () => {
  test('imports a generated mp4 through the drop zone and exports a real file', async () => {
    // Electron cold start + h264 encode of a 1920x1080 export. Generous on
    // purpose; a tiny clip finishes well inside it on a slow runner.
    test.setTimeout(180_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })

    const root = path.join(os.tmpdir(), `imagii-e2e-export-${Date.now().toString(36)}`)
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    const outDir = path.join(root, 'exports')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
    seedUserData(userDataDir, outDir)

    const fixture = path.join(sourceDir, 'e2e-source.mp4')
    await makeFixtureMp4(fixture)

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await openVideoStudio(window)
      await installToastLog(window)

      // ── Import through the renderer's own drop path ──
      await dropOnVideoImporter(window, fixture, 'e2e-source.mp4')

      // Loaded state: the Importer is replaced by the player + Export panel.
      const exportButton = window.getByRole('button', { name: 'Export 1' })
      await expect(exportButton).toBeVisible({ timeout: 30_000 })
      await expect(window.getByText('Drop a video here')).toHaveCount(0)
      // The header shows the imported file, and the player shows the probe
      // the main process actually returned for it.
      await expect(window.getByText('e2e-source.mp4')).toBeVisible()
      await expect(
        window.getByText(`${FIXTURE_WIDTH}×${FIXTURE_HEIGHT}`, { exact: false }).first()
      ).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'export-01-loaded.png') })

      // The output folder came from the seeded `export.lastOutputDir`.
      await expect(window.getByRole('button', { name: 'exports' })).toBeVisible()

      // ── Export through the panel ──
      await exportButton.click()
      await expect(window.getByText('Queue', { exact: true })).toBeVisible({ timeout: 30_000 })

      const expectedName = 'e2e-source_Clip 1_youtube.mp4'
      const expectedPath = path.join(outDir, expectedName)
      await expect
        .poll(() => existsSync(expectedPath), { timeout: 120_000, intervals: [500] })
        .toBe(true)
      // The renderer got video:jobComplete back — the "Show" reveal button
      // only renders once a queue row carries an outputPath. `exact` because
      // the page also carries "Show tutorial" / "Show setup instructions".
      await expect(
        window.getByRole('button', { name: 'Show', exact: true })
      ).toBeVisible({ timeout: 30_000 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'export-02-complete.png') })

      const toasts = await readToastLog(window)
      expect(toasts).toContain('Video loaded')
      expect(toasts).toContain('Exported 1 file')

      // Exactly one artifact, named by the default filename template.
      expect(readdirSync(outDir)).toEqual([expectedName])

      // ── ffprobe accepts the bytes ──
      const probe = await ffprobeJson(expectedPath)
      const video = probe.streams?.find((s) => s.codec_type === 'video')
      const audio = probe.streams?.find((s) => s.codec_type === 'audio')
      const preset = PLATFORM_PRESETS.youtube
      expect(video).toBeTruthy()
      expect(video?.codec_name).toBe('h264')
      expect(video?.width).toBe(preset.width)
      expect(video?.height).toBe(preset.height)
      expect(audio).toBeTruthy()
      expect(audio?.codec_name).toBe('aac')
      expect(Number(probe.format?.duration)).toBeGreaterThan(FIXTURE_SECONDS - 0.5)
      expect(Number(probe.format?.duration)).toBeLessThan(FIXTURE_SECONDS + 0.5)
    } finally {
      await app.close()
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  test('refuses a text file drop and never enters a loaded state', async () => {
    test.setTimeout(120_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })

    const root = path.join(os.tmpdir(), `imagii-e2e-reject-${Date.now().toString(36)}`)
    const userDataDir = path.join(root, 'userData')
    const sourceDir = path.join(root, 'source')
    mkdirSync(sourceDir, { recursive: true })
    seedUserData(userDataDir)

    // T-08: `.txt` on purpose, and it is the hard case. ffmpeg's `tty`
    // demuxer registers that extension, so ffprobe reports ANY text file as
    // a 640x400 "ansi" video, exits 0, and — until the codec floor in
    // src/main/ffmpeg/probe.ts — the app loaded a streamer's notes file
    // with a full export panel behind it. Round 21 could only assert the
    // refusal with a `.log` here, where ffprobe itself fails; this now
    // drives the guard.
    const notes = path.join(sourceDir, 'stream-notes.txt')
    writeFileSync(notes, 'this is not a video, it is a text file\n', 'utf8')

    const app = await launchApp(userDataDir)
    try {
      const window = await app.firstWindow()
      await openVideoStudio(window)
      await installToastLog(window)

      await dropOnVideoImporter(window, notes, 'stream-notes.txt')

      // 1. The extension guard's own copy (src/renderer/src/modules/
      //    video-studio/Importer.tsx) — .txt is not in VIDEO_EXTENSIONS, so
      //    the unsupported name is named back to the user first rather than
      //    silently swallowed. The import is still attempted ("trying
      //    anyway"), which is what puts the probe floor under test.
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toContain('stream-notes.txt may not be a supported video — trying anyway.')

      // 2. Then the refusal itself, visible and specific: probeVideo's codec
      //    floor, passed through describeImportError unchanged (it carries
      //    no "codec"/"no video stream" trigger word, so the user reads the
      //    sentence the guard wrote).
      //    The toast text arrives wrapped in Electron's own IPC preamble
      //    ("Error invoking remote method 'video:probe': Error: …"), so the
      //    guard's sentence is asserted as a substring — the same shape the
      //    round-21 version of this test used for the ffprobe error.
      const REFUSAL = 'This file is text, not a video — pick a video file such as MP4, MOV, or MKV.'
      await expect
        .poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] })
        .toEqual(expect.arrayContaining([expect.stringContaining(REFUSAL)]))
      await expect(window.getByText(REFUSAL).first()).toBeVisible()
      await window.screenshot({ path: path.join(SCREENSHOTS, 'export-03-refused.png') })

      // 3. And it never entered a loaded state: no success toast, the drop
      //    zone is still the only thing on the page, no player, no Export
      //    panel. Checked after the error toast so the flow has fully run.
      const toasts = await readToastLog(window)
      expect(toasts).not.toContain('Video loaded')
      await expect(window.getByText('Drop a video here')).toBeVisible()
      await expect(window.getByRole('button', { name: /^Export/ })).toHaveCount(0)
      await expect(window.locator('video')).toHaveCount(0)
      await expect(window.getByText('stream-notes.txt', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
})
