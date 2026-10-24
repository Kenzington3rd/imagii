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
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import {
  CANVAS_TEMPLATES,
  type CanvasTemplate
} from '../../src/renderer/src/modules/image-studio/templates'
import { ASSET_CATALOG } from '../../src/renderer/src/modules/references/assetCatalog'
import { dragThrough, dragTo } from './drag'
import {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  expectControlsWhole,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  expectOneLine,
  setWindowSize as resizeAndSettle
} from './layout'
import { leave, retype } from './typing'
import { installToastLog, readToastLog } from './toastLog'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-25: the Image Studio ("Stream Graphics") surface — ledger Image(66) —
 * driven through the REAL built app.
 *
 * House patterns from export.spec.ts / audio.spec.ts: a hermetic per-test
 * userData dir seeded on disk BEFORE launch, the MutationObserver toast log,
 * a dialog spy installed before the first click so "no dialog at all" is
 * assertable, and end states asserted on what the user can see (LayerPanel
 * rows, PropertiesPanel readouts, the canvas readout) or on the BYTES that
 * land on disk.
 *
 * Expectations are DERIVED, never transcribed: `CANVAS_TEMPLATES` is imported
 * from the same module the UI renders, so a template edited in `src/` moves
 * this spec's expectations with it.
 *
 * ── Three mechanisms worth explaining ──────────────────────────────────
 *
 * 1. The Konva stage. `window.__imagiiStage` (Canvas.tsx:411) is the ledger's
 *    own hook. `stageShapes()` reads the document layer's children — class +
 *    attrs — which is the rendered end state of `doc.layers`: React re-renders
 *    every node from the store, so a value read back off a node is the value
 *    the store holds. Invisible layers render `null`, which is what makes the
 *    eye toggle assertable at the stage.
 *
 * 2. Mouse work is in DOC coordinates. The stage is scaled to fit its
 *    container (Canvas.tsx:170-179), so every screen point is computed from the
 *    live `stage.scaleX()` and the canvas rect (`stageGeom`). Transformer
 *    anchors are Konva nodes, not DOM: their screen position comes from
 *    `getAbsolutePosition()`, which already includes the stage scale.
 *
 * 3. Saves. Since T-91 an export does not click a hidden `<a download>`: it
 *    asks MAIN to save (`image:save` / `image:saveMany`), which opens a native
 *    dialog and writes the file. The dialogs are the OS boundary, so
 *    `installSaveStub` replaces `dialog.showSaveDialog` / `showOpenDialog` IN
 *    MAIN and answers them — with a path in a temp dir (saved) or with
 *    "canceled" — and records every call. Everything else is real: the click,
 *    the capture, the IPC, the validation, the bytes written. So every export
 *    assertion below lands on a real file, and "the user canceled" is a state
 *    the tests can put the app in (the old `<a download>` could not be
 *    canceled from here, which is how it got to toast "saved" for one).
 *
 * ── Product findings ───────────────────────────────────────────────────
 *
 * BUG-EXPORT-ZOOM and BUG-EMOTE-SIZES were raised here as defect pins —
 * exports came out at the size of the on-screen stage (`doc.width *
 * fit-to-container zoom`), so a 1280x720 template wrote 956x537 at "1x" and
 * the 112x112 emote doc, pinned to the 4x zoom cap, wrote 112/224/448 under
 * filenames promising 28/56/112. FIXED in T-45 (ExportDialog.tsx
 * `captureDocument`); the pins are now the positive assertions in `PNG and
 * JPG export real bytes…`, `emote pack…` and `the export is the document, not
 * the window…`, which is the window-resize invariance proof.
 *
 * T-53 was raised here too and is FIXED: Konva's `Stage._toKonvaCanvas` draws
 * every visible layer, and Canvas.tsx keeps the Transformer and the grid in
 * stage layers, so exporting with a shape selected or Grid checked baked the
 * editor's own chrome into the PNG. `captureDocument` now hides the layers
 * named `chrome` for the capture; the proof is `editor chrome stays out of the
 * file…`, which exports the same document four ways and compares bytes.
 *
 * BUG-VARIANTS-STALE is FIXED in T-46: the variants dialog kept its previews
 * across a close AND across every edit, so reopening it offered renders of a
 * canvas that no longer existed with no Generate button in sight. The previews
 * now belong to the document they were rendered from — `variants: …` drives
 * both halves (untouched canvas keeps them, changed canvas offers Generate).
 * The same ticket routed the variant capture through `captureDocument`, so a
 * saved variant is the document (1280x720) rather than the window (956x537).
 *
 * T-54 is FIXED: `doc.background` was a CSS style on the stage element, which
 * Konva cannot see, so no export carried it — PNGs came out transparent and
 * JPGs composited onto black while the canvas showed the template's fill. It
 * is now the first NODE of the document layer (Canvas.tsx), so screen and
 * export are one render. `the document background lands in the bytes…` samples
 * a real pixel out of the exported PNG and JPG, and out of an emote pack that
 * must stay transparent.
 *
 * ── Mutation proofs (run by hand, restored byte-identical afterwards) ───
 *
 * Assertions here that could have passed vacuously. Each was proven to
 * discriminate by mutating the TEST (A-E) or `src/` (F-G) and watching it fail;
 * every mutation was reverted and the file md5-checked afterwards:
 *   A. snap: dropping `snap.check()` made the exact `x === 120` read 132.37.
 *   B. locked drag: dropping the lock click moved the shape 200 -> 260.4, so
 *      "x unchanged" is a real refusal and not a gesture that does nothing.
 *   C. INPUT guard: moving focus off the name field before the SAME Delete
 *      press dropped the layer count 3 -> 2.
 *   D. template application: asserting a different template's layers failed on
 *      the derived row-name list, so `expectTemplateApplied` really compares.
 *   E. paste: dropping the `clipboard.writeImage` call left Ctrl+V adding
 *      nothing, so the pasted layer really comes from the clipboard image.
 *   F. T-54 (src): deleting the background Rect from Canvas.tsx put the
 *      exported PNG's probe pixel back to rgba(0,0,0,0) and the JPG's to
 *      black — the two halves of the defect this test exists for.
 *   G. T-46 (src): putting the raw `stage.toDataURL` back in the variants
 *      capture wrote 956x537 again; dropping the `previews.doc === doc`
 *      check put four tiles of the dead canvas back on the reopen.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

// ── fixtures ───────────────────────────────────────────────────────────────

function runBinary(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** A real 64x48 PNG, made by the repo's own bundled ffmpeg (export.spec pattern). */
const FIXTURE_PNG_W = 64
const FIXTURE_PNG_H = 48

async function makeFixturePng(outPath: string): Promise<void> {
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=red:s=${FIXTURE_PNG_W}x${FIXTURE_PNG_H}`,
    '-frames:v',
    '1',
    outPath
  ])
  if (result.code !== 0) {
    throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }
}

/** Hermetic userData with every overlay flag pre-seeded (smoke.spec shape). */
function seedUserData(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify(
      { welcomeSeen: true, tutorialSeen: { video: true, audio: true, image: true, ai: true } },
      null,
      2
    ),
    'utf8'
  )
}

// ── image byte probes (no dependency needed for either header) ──────────────

interface Size {
  w: number
  h: number
}

function pngSize(buf: Buffer): Size {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

/**
 * A 6-digit hex colour as channels, so a background expectation is DERIVED
 * from the template module rather than transcribed into this spec.
 */
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = Number.parseInt(match[1] as string, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** JPEG is lossy; a flat area round-trips within a channel or two. */
const JPEG_TOL = 4

function jpegSize(buf: Buffer): Size {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG')
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = buf[i + 1] as number
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = buf.readUInt16BE(i + 2)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('no JPEG SOF marker')
}

// ── the studio harness ─────────────────────────────────────────────────────

interface DialogSpy {
  messages: string[]
  action: 'accept' | 'dismiss'
}

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
  root: string
  /** The generated PNG — dropped, picked through the file chooser, pasted. */
  fixturePng: string
  /** Where the stubbed Save dialog and folder picker put files. */
  downloadDir: string
  dialogs: DialogSpy
}

interface SaveCalls {
  /** `showSaveDialog` options, in call order. */
  save: Array<{ title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }>
  /** `showOpenDialog` options (the folder picker), in call order. */
  open: Array<{ title?: string; properties?: string[] }>
}

/**
 * Stand in for the OS dialogs, in the MAIN process. Nothing in `src/` changes:
 * `dialog` is Electron's own object and the `image:save*` handlers read it at
 * call time. `answer: 'save'` picks `dir` (the Save dialog returns
 * `dir/<default name>`, the folder picker returns `dir`); `'cancel'` is the
 * user dismissing it; `'unwritable'` picks a folder that does not exist, so
 * the write itself fails. Every call is recorded.
 */
async function installSaveStub(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, outDir) => {
    const g = globalThis as unknown as {
      __imgSave: { answer: 'save' | 'cancel' | 'unwritable'; dir: string; calls: SaveCalls; delayMs: number }
    }
    g.__imgSave = { answer: 'save', dir: outDir, calls: { save: [], open: [] }, delayMs: 0 }
    const target = dialog as unknown as { showSaveDialog: unknown; showOpenDialog: unknown }
    target.showSaveDialog = async (_win: unknown, options: SaveCalls['save'][number]) => {
      g.__imgSave.calls.save.push(options)
      // T-127 (11): a real chooser answers after a moment, and that moment is where a second press lands (0 = immediately).
      if (g.__imgSave.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, g.__imgSave.delayMs))
      if (g.__imgSave.answer === 'cancel') return { canceled: true, filePath: undefined }
      const leaf = (options.defaultPath ?? 'out').split(/[\\/]/).pop()
      // 'unwritable': the user picked a place the write then cannot reach
      // (a folder that is gone) — the one honest way for a save to FAIL.
      const folder = g.__imgSave.answer === 'unwritable' ? `${g.__imgSave.dir}/no-such-folder` : g.__imgSave.dir
      return { canceled: false, filePath: `${folder}/${leaf}` }
    }
    target.showOpenDialog = async (_win: unknown, options: SaveCalls['open'][number]) => {
      g.__imgSave.calls.open.push(options)
      if (g.__imgSave.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, g.__imgSave.delayMs))
      if (g.__imgSave.answer === 'cancel') return { canceled: true, filePaths: [] }
      return { canceled: false, filePaths: [g.__imgSave.dir] }
    }
  }, dir)
}

/** The user's answer to the next dialogs: save where the stub says, or cancel. */
async function answerDialogs(
  app: ElectronApplication,
  answer: 'save' | 'cancel' | 'unwritable'
): Promise<void> {
  await app.evaluate((_electron, a) => {
    ;(globalThis as unknown as { __imgSave: { answer: string } }).__imgSave.answer = a
  }, answer)
}

/** T-127 (11): the dialogs answer after `ms` (a person takes a moment; a double-click's second press lands inside it). */
async function setDialogDelay(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, delayMs) => {
    ;(globalThis as unknown as { __imgSave: { delayMs: number } }).__imgSave.delayMs = delayMs
  }, ms)
}

function saveCalls(app: ElectronApplication): Promise<SaveCalls> {
  return app.evaluate(
    () => (globalThis as unknown as { __imgSave: { calls: SaveCalls } }).__imgSave.calls
  )
}

/**
 * Resize the REAL OS window. Playwright's viewport controls do nothing to an
 * Electron window, so this goes through `BrowserWindow` in the main process —
 * the same resize a user dragging the window corner performs, which is what
 * moves Canvas.tsx's fit-to-container zoom.
 */
async function setWindowSize(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('no BrowserWindow to resize')
    win.setSize(size.width, size.height)
  }, { width, height })
}

/** File names currently in the save folder, sorted (a folder has no order to promise). */
function savedNames(studio: Studio): string[] {
  return readdirSync(studio.downloadDir).sort()
}

function clearDownloads(studio: Studio): void {
  for (const name of readdirSync(studio.downloadDir)) {
    rmSync(path.join(studio.downloadDir, name), { force: true })
  }
}

/** Wait until exactly `n` files have been saved, then read their bytes (name order). */
async function waitForDownloads(studio: Studio, n: number): Promise<Buffer[]> {
  await expect
    .poll(() => savedNames(studio).length, { timeout: 30_000, intervals: [200] })
    .toBe(n)
  return savedNames(studio).map((name) => readFileSync(path.join(studio.downloadDir, name)))
}

/** The bytes of the one saved file whose name matches `pattern`. */
function savedFile(studio: Studio, pattern: RegExp): Buffer {
  const hits = savedNames(studio).filter((n) => pattern.test(n))
  if (hits.length !== 1) throw new Error(`expected one saved file like ${pattern}, got ${JSON.stringify(savedNames(studio))}`)
  return readFileSync(path.join(studio.downloadDir, hits[0] as string))
}

/** Let any toast the click was going to raise raise it, then read the log. */
async function toastsAfterSettling(studio: Studio): Promise<string[]> {
  await studio.window.waitForTimeout(1_000)
  return readToastLog(studio.window)
}

/**
 * One pixel out of exported bytes, decoded by the repo's OWN bundled ffmpeg —
 * the same binary the fixtures come from, so no new dependency and no
 * hand-rolled PNG/JPEG decoder. `crop=1:1:x:y` into a 4-byte `rawvideo`/`rgba`
 * dump: a PNG round-trips exactly (probed), a JPEG lands within `JPEG_TOL`.
 *
 * T-54 needs this because dimensions are blind to content — the same lesson
 * T-53 wrote down. A PNG can be exactly 1280x720 with every pixel of the
 * document's background missing.
 *
 * `format=rgba` runs BEFORE the crop deliberately: a JPEG decodes to
 * subsampled yuvj420p, and `crop` rounds a 1x1 box down to the chroma grid —
 * i.e. to 0x0, which ffmpeg rejects outright ("positive size for width '0'").
 * Converting first makes the frame 4:4:4 so one pixel is a legal crop, and
 * makes both formats take the identical path.
 */
async function samplePixel(
  studio: Studio,
  bytes: Buffer,
  ext: 'png' | 'jpg',
  x: number,
  y: number
): Promise<{ r: number; g: number; b: number; a: number }> {
  const source = path.join(studio.root, `probe.${ext}`)
  const raw = path.join(studio.root, 'probe.raw')
  writeFileSync(source, bytes)
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-i',
    source,
    '-vf',
    `format=rgba,crop=1:1:${x}:${y}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    raw
  ])
  if (result.code !== 0) {
    throw new Error(
      `pixel probe exit ${result.code} on ${bytes.length} ${ext} bytes ` +
        `(${bytes.subarray(0, 4).toString('hex')}): ${result.stderr.slice(-800)}`
    )
  }
  const px = readFileSync(raw)
  if (px.length < 4) throw new Error(`pixel probe wrote ${px.length} bytes, wanted 4`)
  return { r: px[0] as number, g: px[1] as number, b: px[2] as number, a: px[3] as number }
}

/**
 * How many pixels of a rectangle of an exported PNG are NOT the plain
 * background color (T-103). One pixel cannot say whether a line of text is in
 * the file — glyphs have gaps — so the whole box is decoded (`rgba`, same
 * ffmpeg path as `samplePixel`) and counted. A pixel counts when any channel
 * is more than `tol` away from the background, so anti-aliased glyph edges
 * count and PNG's exact round-trip of flat color does not.
 */
async function pixelsOtherThanBackground(
  studio: Studio,
  bytes: Buffer,
  box: { x: number; y: number; w: number; h: number },
  bg: { r: number; g: number; b: number },
  tol = 12
): Promise<number> {
  const source = path.join(studio.root, 'region.png')
  const raw = path.join(studio.root, 'region.raw')
  writeFileSync(source, bytes)
  const result = await runBinary(ffmpegPath, [
    '-y',
    '-i',
    source,
    '-vf',
    `format=rgba,crop=${box.w}:${box.h}:${box.x}:${box.y}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    raw
  ])
  if (result.code !== 0) throw new Error(`region probe exit ${result.code}: ${result.stderr.slice(-800)}`)
  const px = readFileSync(raw)
  if (px.length !== box.w * box.h * 4) {
    throw new Error(`region probe wrote ${px.length} bytes, wanted ${box.w * box.h * 4}`)
  }
  let count = 0
  for (let i = 0; i < px.length; i += 4) {
    const off =
      Math.abs((px[i] as number) - bg.r) > tol ||
      Math.abs((px[i + 1] as number) - bg.g) > tol ||
      Math.abs((px[i + 2] as number) - bg.b) > tol
    if (off) count += 1
  }
  return count
}

async function openStudio(label: string): Promise<Studio> {
  if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
  const root = path.join(os.tmpdir(), `imagii-e2e-image-${label}-${Date.now().toString(36)}`)
  const userDataDir = path.join(root, 'userData')
  const sourceDir = path.join(root, 'source')
  const downloadDir = path.join(root, 'downloads')
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(downloadDir, { recursive: true })
  const fixturePng = path.join(sourceDir, 'e2e-red.png')
  await makeFixturePng(fixturePng)
  seedUserData(userDataDir)

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
  await installSaveStub(app, downloadDir)
  const window = await app.firstWindow()
  const dialogs = installDialogSpy(window)

  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
  await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 30_000 })
  await expect(window.getByText('Pick a template to start')).toBeVisible({ timeout: 15_000 })
  await installToastLog(window)

  return { app, window, root, fixturePng, downloadDir, dialogs }
}

async function closeStudio(studio: Studio): Promise<void> {
  await studio.app.close()
  try {
    rmSync(studio.root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

// ── stage readers ──────────────────────────────────────────────────────────

interface ShapeInfo {
  cls: string
  x: number
  y: number
  rotation: number
  opacity: number
  scaleX: number
  scaleY: number
  draggable: boolean
  width?: number
  height?: number
  radiusX?: number
  radiusY?: number
  points?: number[]
  text?: string
  fontSize?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}

/**
 * Every USER node in the stage's DOCUMENT layer (children[0]) — the render of
 * `doc.layers`, in doc order. Invisible layers are absent by design
 * (Canvas.tsx returns null for them).
 *
 * T-54 put one node in that layer which is not a user layer: the background
 * rect, drawn first and named `background`, which is how `doc.background`
 * reaches the exported bytes. It is skipped by name — no user layer carries a
 * Konva `name` at all (Canvas.tsx's `baseProps` never sets one), so the skip
 * cannot swallow a real shape.
 */
function stageShapes(window: Page): Promise<ShapeInfo[]> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as
      | {
          children: Array<{
            children: Array<{ getClassName(): string; attrs: { name?: string } }>
          }>
        }
      | undefined
    if (!stage) throw new Error('__imagiiStage is not set')
    const doc = stage.children[0]
    if (!doc) return []
    return doc.children
      .filter((n) => n.attrs.name !== 'background')
      .map((n) => ({ cls: n.getClassName(), ...n.attrs })) as ShapeInfo[]
  })
}

async function lastShape(window: Page): Promise<ShapeInfo> {
  const shapes = await stageShapes(window)
  const last = shapes[shapes.length - 1]
  if (!last) throw new Error('stage has no shapes')
  return last
}

/** Image layers only render once `use-image` has decoded the data URL. */
function expectShapeCount(window: Page, n: number): Promise<void> {
  return expect
    .poll(async () => (await stageShapes(window)).length, { timeout: 20_000, intervals: [100] })
    .toBe(n)
}

/**
 * Pointer coordinates reach the app as whole screen pixels, which is up to
 * ~1.5 document pixels at the fit-to-container zoom. Every expectation that
 * comes out of a GESTURE carries that tolerance; values the app computed
 * itself (snapped coordinates, duplicate offsets, field edits) are exact.
 */
const MOUSE_TOL = 2

function expectNear(actual: number | undefined, expected: number, what: string): void {
  expect(actual, `${what} ≈ ${expected}`).toBeGreaterThan(expected - MOUSE_TOL)
  expect(actual, `${what} ≈ ${expected}`).toBeLessThan(expected + MOUSE_TOL)
}

interface StageGeom {
  /** Viewport coordinates of the stage canvas's top-left corner. */
  left: number
  top: number
  /** Fit-to-container zoom — doc px * scale = screen px. */
  scale: number
  /** The stage's own pixel size, which is what an export renders. */
  stageW: number
  stageH: number
  /** Number of Konva layers: document, [grid], overlay. */
  layers: number
}

function stageGeom(window: Page): Promise<StageGeom> {
  return window.evaluate(() => {
    const stage = (
      window as unknown as {
        __imagiiStage?: { scaleX(): number; width(): number; height(): number; children: unknown[] }
      }
    ).__imagiiStage
    if (!stage) throw new Error('__imagiiStage is not set')
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('stage canvas not found')
    const r = canvas.getBoundingClientRect()
    return {
      left: r.left,
      top: r.top,
      scale: stage.scaleX(),
      stageW: stage.width(),
      stageH: stage.height(),
      layers: stage.children.length
    }
  })
}

/** How many Line nodes the grid overlay layer is drawing (0 when absent). */
function gridLineCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      children: Array<{ children: Array<{ children?: unknown[]; getClassName(): string }> }>
    }
    // The grid, when shown, is the middle layer: [document, grid, overlay].
    if (stage.children.length < 3) return 0
    const grid = stage.children[1]
    const group = grid?.children[0]
    return group && Array.isArray(group.children) ? group.children.length : 0
  })
}

/**
 * Stage layers that are currently switched off. Always 0 between captures:
 * `captureDocument` hides the chrome layers only for the duration of one
 * synchronous `toDataURL` and restores each one's prior flag in a `finally`.
 */
function hiddenLayerCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      getLayers(): Array<{ visible(): boolean }>
    }
    if (!stage) throw new Error('__imagiiStage is not set')
    return stage.getLayers().filter((l) => !l.visible()).length
  })
}

/** How many nodes the Transformer currently has attached (0 or 1 here). */
function transformerNodeCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      findOne(sel: string): { nodes(): unknown[] } | undefined
    }
    const tr = stage.findOne('Transformer')
    return tr ? tr.nodes().length : 0
  })
}

/** The Konva class of every node the Transformer has attached ('Image', 'Text', ...): which layer the handles are on. */
function transformerClasses(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      findOne(sel: string): { nodes(): Array<{ getClassName(): string }> } | undefined
    }
    const tr = stage.findOne('Transformer')
    return tr ? tr.nodes().map((n) => n.getClassName()) : []
  })
}

/** Viewport position of a named Transformer anchor ('bottom-right', …). */
async function anchorPoint(window: Page, name: string): Promise<{ x: number; y: number }> {
  const geom = await stageGeom(window)
  const local = await window.evaluate((anchor) => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      findOne(sel: string): { findOne(s: string): { getAbsolutePosition(): { x: number; y: number } } | undefined } | undefined
    }
    const tr = stage.findOne('Transformer')
    if (!tr) throw new Error('no Transformer on the stage')
    const a = tr.findOne(`.${anchor}`)
    if (!a) throw new Error(`transformer anchor ${anchor} not found`)
    return a.getAbsolutePosition()
  }, name)
  // getAbsolutePosition() is already in stage pixels (scale applied).
  return { x: geom.left + local.x, y: geom.top + local.y }
}

// ── mouse helpers, in DOC coordinates ──────────────────────────────────────

interface Point {
  x: number
  y: number
}

async function toScreen(window: Page, p: Point): Promise<Point> {
  const g = await stageGeom(window)
  return { x: g.left + p.x * g.scale, y: g.top + p.y * g.scale }
}

/**
 * Width, in DOC units, of whatever the draw tools are previewing on the
 * `overlay chrome` layer right now — 0 when nothing is being drawn. This is
 * what `dragOnStage` waits for before releasing the button.
 */
function drawPreviewWidth(window: Page): Promise<number> {
  return window.evaluate(() => {
    const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
      scaleX(): number
      getLayers(): Array<{
        name(): string
        getChildren(): Array<{ getClassName(): string; getClientRect(): { width: number } }>
      }>
    }
    if (!stage) throw new Error('__imagiiStage is not set')
    const overlay = stage.getLayers().find((l) => l.name() === 'overlay chrome')
    const preview = overlay?.getChildren().find((c) => c.getClassName() !== 'Transformer')
    if (!preview) return 0
    return preview.getClientRect().width / stage.scaleX()
  })
}

/**
 * The draw gesture: press, one move to the far corner, release once the
 * preview the tool draws has reached that size. One mouse round trip inside
 * the button-down window — see tests/e2e/drag.ts for the crossing-event race
 * that makes the extra `steps` a liability rather than insurance (T-55).
 *
 * `expectPreview: false` is for the deliberately sub-threshold drags, whose
 * whole point is that nothing lands. `via` is for the pencil, whose stroke is
 * literally one point per move — it needs intermediate positions to be a
 * polyline rather than a segment.
 */
async function dragOnStage(
  window: Page,
  from: Point,
  to: Point,
  options: { expectPreview?: boolean; via?: Point[] } = {}
): Promise<void> {
  const docWidth = Math.abs(to.x - from.x)
  const start = await toScreen(window, from)
  const through = [...(options.via ?? []), to]
  const screen: Point[] = []
  for (const p of through) screen.push(await toScreen(window, p))
  await dragThrough(window, start, screen, async (_point, i) => {
    if (i !== screen.length - 1 || options.expectPreview === false) return
    await expect
      .poll(() => drawPreviewWidth(window), {
        timeout: 10_000,
        message: `draw ${from.x},${from.y} -> ${to.x},${to.y}: preview never reached ${docWidth} doc px`
      })
      // getClientRect() includes the 2 px dashed preview stroke, so the
      // preview reads a hair WIDER than the drag once it has all landed.
      .toBeGreaterThan(docWidth - MOUSE_TOL)
  })
}

/** A click at a doc coordinate (used to hit a shape and select it). */
async function clickDoc(window: Page, p: Point): Promise<void> {
  const s = await toScreen(window, p)
  await window.mouse.click(s.x, s.y)
}

// ── panel locators ─────────────────────────────────────────────────────────

const LAYERS = '[data-tutorial="image-layers"]'
const TOOLBAR = '[data-tutorial="image-toolbar"]'
const IMPORT = '[data-tutorial="image-import"]'
const EXPORT = '[data-tutorial="image-export"]'

function propsCard(window: Page): Locator {
  return window.locator('.card').filter({ has: window.locator('h3', { hasText: 'Properties' }) })
}

/** The input inside the PropertiesPanel label whose caption is exactly `label`. */
function field(window: Page, label: string): Locator {
  return propsCard(window)
    .locator('label')
    .filter({ has: window.getByText(label, { exact: true }) })
    .locator('input, textarea')
}

/** LayerPanel row names, top row first (the panel renders doc order reversed). */
function layerNames(window: Page): Promise<string[]> {
  return window.locator(`${LAYERS} li span.truncate`).allInnerTexts()
}

function layerRow(window: Page, name: string): Locator {
  return window
    .locator(`${LAYERS} li`)
    .filter({ has: window.getByText(name, { exact: true }) })
}

function expectLayerCount(window: Page, n: number): Promise<void> {
  return expect(window.locator(LAYERS)).toContainText(`Layers (${n})`)
}

// ── template helpers ───────────────────────────────────────────────────────

function templateById(id: string): CanvasTemplate {
  const t = CANVAS_TEMPLATES.find((c) => c.id === id)
  if (!t) throw new Error(`template ${id} is gone from templates.ts`)
  return t
}

/** The card for a template, pinned by its exact name (names share prefixes). */
function templateCard(window: Page, t: CanvasTemplate): Locator {
  return window
    .locator('button.card')
    .filter({ has: window.getByText(t.name, { exact: true }) })
}

const KONVA_CLASS: Record<string, string> = {
  rect: 'Rect',
  ellipse: 'Ellipse',
  line: 'Line',
  text: 'Text',
  image: 'Image'
}

/**
 * The template really landed: LayerPanel rows, canvas size readout, and every
 * Konva node's class and position, all derived from the template module.
 */
async function expectTemplateApplied(window: Page, t: CanvasTemplate): Promise<void> {
  await expectLayerCount(window, t.doc.layers.length)
  await expect(window.getByText(`${t.doc.width} × ${t.doc.height}`)).toBeVisible()
  expect(await layerNames(window)).toEqual([...t.doc.layers].reverse().map((l) => l.name))
  const shapes = await stageShapes(window)
  expect(shapes.map((s) => s.cls)).toEqual(t.doc.layers.map((l) => KONVA_CLASS[l.type]))
  expect(shapes.map((s) => [s.x, s.y])).toEqual(t.doc.layers.map((l) => [l.x, l.y]))
}

/** Get to the loaded state with one text layer on the default 1200x800 doc. */
async function startBlank(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Start with text' }).click()
  await expectLayerCount(window, 1)
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe('Image Studio — templates', () => {
  test('an empty-state template card applies that template document', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('tmpl-empty')
    const { window } = studio
    try {
      // Every template in the module is offered, grouped under its category.
      await expect(window.locator('button.card')).toHaveCount(CANVAS_TEMPLATES.length)
      for (const label of ['Thumbnails', 'Stream overlays', 'Banners', 'Emotes']) {
        await expect(window.locator('h3', { hasText: label })).toBeVisible()
      }

      const t = templateById('yt-thumb-clean')
      await expect(templateCard(window, t)).toContainText(t.description)
      await templateCard(window, t).click()

      // The empty state is gone and the editor is up.
      await expect(window.getByText('Pick a template to start')).toHaveCount(0)
      await expect(window.locator(TOOLBAR)).toBeVisible()
      await expectTemplateApplied(window, t)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-01-template.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('the Templates dialog applies, and closes four ways without applying', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('tmpl-dialog')
    const { window } = studio
    try {
      const first = templateById('yt-thumb-clean')
      const second = templateById('emote-blank-112')
      await templateCard(window, first).click()
      await expectTemplateApplied(window, first)

      const openDialog = window.locator(IMPORT).getByRole('button', { name: 'Templates' })
      const dialog = window.locator('[role="dialog"]')

      // ── open + apply ──
      await openDialog.click()
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(
        `${CANVAS_TEMPLATES.length} templates · clicking one replaces the current canvas.`
      )
      await expect(dialog.locator('button.card')).toHaveCount(CANVAS_TEMPLATES.length)
      await dialog.locator('button.card').filter({ has: window.getByText(second.name, { exact: true }) }).click()
      await expect(dialog).toHaveCount(0)
      await expectTemplateApplied(window, second)

      // ── the three dismissals, each proven not to change the document ──
      const dismissals: Array<[string, () => Promise<void>]> = [
        [
          'close button',
          async () => dialog.getByRole('button', { name: 'Close', exact: true }).click()
        ],
        ['Escape', async () => window.keyboard.press('Escape')],
        ['scrim', async () => window.mouse.click(8, 8)]
      ]
      for (const [label, dismiss] of dismissals) {
        await openDialog.click()
        await expect(dialog, `${label}: dialog opens`).toBeVisible()
        await dismiss()
        await expect(dialog, `${label}: dialog closes`).toHaveCount(0)
        // Still the emote doc — no dismissal is allowed to apply anything.
        await expectTemplateApplied(window, second)
      }
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — tools and drawing', () => {
  // T-124 (29): ImageStudio computed `ctrl` and only `v` honored it, so Ctrl+R, Ctrl+O, Ctrl+L and Ctrl+P (and Alt+ or Meta+ any of
  // them) switched tools: a chord that belongs to the window or the browser changed what the next drag would draw. The keydown is
  // dispatched, not pressed: a real Ctrl+R is the app menu's Reload, which would take the studio with it before the assertion looked.
  test('Ctrl, Alt or Meta held makes a tool key a chord, not a tool switch: Ctrl+R, Ctrl+O, Ctrl+L, Ctrl+P, Alt+R and Meta+O leave the tool alone, and the bare letters still switch it (T-124 (29))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('chords')
    const { window } = studio
    try {
      await startBlank(window)
      await expect(window.getByText('Tool: Select')).toBeVisible()
      const chord = (key: string, modifier: 'ctrlKey' | 'altKey' | 'metaKey'): Promise<void> =>
        window.evaluate(
          ([k, m]) => {
            const target = document.querySelector('canvas') ?? document.body
            target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, [m]: true }))
          },
          [key, modifier] as const
        )
      for (const [key, modifier] of [
        ['r', 'ctrlKey'],
        ['o', 'ctrlKey'],
        ['l', 'ctrlKey'],
        ['p', 'ctrlKey'],
        ['R', 'ctrlKey'],
        ['r', 'altKey'],
        ['o', 'metaKey']
      ] as const) {
        await chord(key, modifier)
        await window.waitForTimeout(250)
        await expect(window.getByText('Tool: Select'), `${modifier} + ${key} left the tool alone`).toBeVisible()
      }
      // The control: the bare letter is the shortcut it always was.
      await window.keyboard.press('r')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })

  test('all five tools switch by button and by keyboard, +More discloses two', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('tools')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)

      // Line and Pencil are behind the disclosure to start with.
      await expect(toolbar.getByRole('button', { name: 'Line' })).toHaveCount(0)
      await expect(toolbar.getByRole('button', { name: 'Pencil' })).toHaveCount(0)
      await expect(window.getByText('Tool: Select')).toBeVisible()

      // ── buttons ──
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
      await expect(toolbar.getByRole('button', { name: 'Rectangle' })).toHaveClass(/bg-accent/)
      // T-113: the active tool is told to assistive tech too, not only drawn in the accent fill.
      await expect(toolbar.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true')
      await expect(toolbar.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false')
      await toolbar.getByRole('button', { name: 'Ellipse' }).click()
      await expect(window.getByText('Tool: Ellipse')).toBeVisible()
      await expect(toolbar.getByRole('button', { name: 'Rectangle' })).not.toHaveClass(/bg-accent/)
      await expect(toolbar.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'false')
      await expect(toolbar.getByRole('button', { name: 'Ellipse' })).toHaveAttribute('aria-pressed', 'true')

      // ── + More ──
      await toolbar.getByRole('button', { name: '+ More' }).click()
      await expect(toolbar.getByRole('button', { name: '+ More' })).toHaveCount(0)
      await toolbar.getByRole('button', { name: 'Line' }).click()
      await expect(window.getByText('Tool: Line')).toBeVisible()
      await toolbar.getByRole('button', { name: 'Pencil' }).click()
      await expect(window.getByText('Tool: Pencil')).toBeVisible()
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await expect(window.getByText('Tool: Select')).toBeVisible()

      // ── keyboard, including the advanced pair that stays visible while active ──
      for (const [key, label] of [
        ['r', 'Rectangle'],
        ['o', 'Ellipse'],
        ['l', 'Line'],
        ['p', 'Pencil'],
        ['v', 'Select']
      ] as const) {
        await window.keyboard.press(key)
        await expect(window.getByText(`Tool: ${label}`)).toBeVisible()
        await expect(
          toolbar.getByRole('button', { name: label })
        ).toHaveClass(/bg-accent/)
      }

      // The uppercase bindings are the same rows in ImageStudio.tsx:67-76.
      await window.keyboard.press('Shift+R')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()

      // Ctrl+V is the paste path, not the Select shortcut: any chord is left alone (ImageStudio.tsx:61).
      await window.keyboard.press('Control+v')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()

      // ── the header's TutorialButton replays the image tutorial ──
      // The seed marks it seen, so the only way a coachmark appears is the
      // button. (Skip writes the flag — T-86 — but it is already true here.)
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const coachmark = window.locator('[role="dialog"]')
      await expect(coachmark).toContainText('Welcome to Stream Graphics')
      await coachmark.getByRole('button', { name: 'Next' }).click()
      await expect(coachmark).toContainText('Start your canvas')
      await coachmark.getByRole('button', { name: 'Skip' }).click()
      await expect(coachmark).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('rect, ellipse, line and pencil each commit a layer from one drag', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('draw')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: '+ More' }).click()

      // ── rect: x/y is the top-left of the drag, w/h its extent ──
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 150 }, { x: 400, y: 300 })
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).toEqual(['Rectangle', 'Text'])
      const rect = await lastShape(window)
      expect(rect.cls).toBe('Rect')
      expectNear(rect.x, 200, 'rect x')
      expectNear(rect.y, 150, 'rect y')
      expectNear(rect.width, 200, 'rect width')
      expectNear(rect.height, 150, 'rect height')
      expect(rect.fill).toBe('rgba(255, 49, 49, 0.4)')

      // A drag that ends up-and-left of its start still commits a positive box.
      await dragOnStage(window, { x: 700, y: 500 }, { x: 600, y: 400 })
      await expectLayerCount(window, 3)
      const backwards = await lastShape(window)
      expectNear(backwards.x, 600, 'backwards x')
      expectNear(backwards.y, 400, 'backwards y')
      expectNear(backwards.width, 100, 'backwards width')
      expectNear(backwards.height, 100, 'backwards height')

      // ── ellipse: centred on the drag box, radii are half of it ──
      await toolbar.getByRole('button', { name: 'Ellipse' }).click()
      await dragOnStage(window, { x: 200, y: 400 }, { x: 400, y: 500 })
      await expectLayerCount(window, 4)
      const ellipse = await lastShape(window)
      expect(ellipse.cls).toBe('Ellipse')
      expectNear(ellipse.x, 300, 'ellipse centre x')
      expectNear(ellipse.y, 450, 'ellipse centre y')
      expectNear(ellipse.radiusX, 100, 'ellipse radiusX')
      expectNear(ellipse.radiusY, 50, 'ellipse radiusY')

      // ── line: two points, start and end ──
      await toolbar.getByRole('button', { name: 'Line' }).click()
      await dragOnStage(window, { x: 800, y: 200 }, { x: 1000, y: 350 })
      await expectLayerCount(window, 5)
      const line = await lastShape(window)
      expect(line.cls).toBe('Line')
      expect(line.points).toHaveLength(4)
      const pts = line.points as number[]
      expectNear(pts[0], 800, 'line x1')
      expectNear(pts[1], 200, 'line y1')
      expectNear(pts[2], 1000, 'line x2')
      expectNear(pts[3], 350, 'line y2')

      // ── pencil: a freehand polyline, one point per mousemove ──
      // The only gesture here whose intermediate positions are the content, so
      // it names them instead of taking the one-move path.
      await toolbar.getByRole('button', { name: 'Pencil' }).click()
      await dragOnStage(
        window,
        { x: 500, y: 600 },
        { x: 900, y: 700 },
        {
          via: [
            { x: 600, y: 625 },
            { x: 700, y: 650 },
            { x: 800, y: 675 }
          ]
        }
      )
      await expectLayerCount(window, 6)
      const pencil = await lastShape(window)
      expect(pencil.cls).toBe('Line')
      expect((pencil.points as number[]).length).toBeGreaterThan(4)
      // Both drawing tools that produce a Line name it "Line" (canvasStore.ts:325).
      expect(await layerNames(window)).toEqual([
        'Line',
        'Line',
        'Ellipse',
        'Rectangle',
        'Rectangle',
        'Text'
      ])

      // ── a drag under the 4px floor commits nothing (Canvas.tsx:253) ──
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 100, y: 700 }, { x: 102, y: 702 }, { expectPreview: false })
      await expectLayerCount(window, 6)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-02-drawn.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('the grid renders, and snap quantizes a committed draw to the grid size', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('grid')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      const grid = toolbar.getByLabel('Grid', { exact: true })
      const snap = toolbar.getByLabel('Snap', { exact: true })
      const size = toolbar.getByLabel('Grid size in pixels')

      // ── the grid overlay is a real third Konva layer of real lines ──
      expect((await stageGeom(window)).layers).toBe(2)
      await grid.check()
      await expect
        .poll(async () => (await stageGeom(window)).layers, { timeout: 10_000 })
        .toBe(3)
      // 1200x800 doc at the default 20px grid: 61 verticals + 41 horizontals.
      expect(await gridLineCount(window)).toBe(1200 / 20 + 1 + (800 / 20 + 1))
      await size.fill('40')
      await expect.poll(() => gridLineCount(window), { timeout: 10_000 }).toBe(31 + 21)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-03-grid.png') })

      // ── snap OFF: the draw lands where the mouse was ──
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 133, y: 93 }, { x: 333, y: 253 })
      await expectLayerCount(window, 2)
      const free = await lastShape(window)
      expectNear(free.x, 133, 'unsnapped x')
      expectNear(free.y, 93, 'unsnapped y')
      // Not on the grid — which is what makes the snapped draw below a proof.
      expect(free.x % 40).not.toBe(0)
      expect(free.y % 40).not.toBe(0)

      // ── snap ON: the same gesture quantizes to multiples of 40 ──
      // Math.round(133/40)*40 = 120 and Math.round(93/40)*40 = 80
      // (canvasStore rule read off Canvas.tsx:165-168). At the DEFAULT grid of
      // 20 the same gesture would land on 140/100, so this also proves the
      // grid-size field feeds the snap.
      await snap.check()
      await dragOnStage(window, { x: 133, y: 93 }, { x: 333, y: 253 })
      await expectLayerCount(window, 3)
      const snapped = await lastShape(window)
      expect(snapped.x).toBe(120)
      expect(snapped.y).toBe(80)
      expect(snapped.width).toBe(200)
      expect(snapped.height).toBe(160)

      // ── unchecking really turns both back off ──
      await grid.uncheck()
      await expect
        .poll(async () => (await stageGeom(window)).layers, { timeout: 10_000 })
        .toBe(2)
      await snap.uncheck()
      await dragOnStage(window, { x: 133, y: 93 }, { x: 333, y: 253 })
      await expectLayerCount(window, 4)
      expectNear((await lastShape(window)).x, 133, 'unsnapped again x')
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — typed numbers (T-123 (4))', () => {
  // The grid size box and a text layer's Size box snapped an emptied value to a default (`|| 2`, `|| 4`), so the digits typed
  // after emptying them appended to it: a grid of "2" then "4" and "0" was 2 -> 24 -> 240. `fill` replaces the value in one step.
  test('the grid size and a text layer\'s Size take typed digits, and are held to their range when typing ends', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('typed-numbers')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      const grid = toolbar.getByLabel('Grid size in pixels')

      // ── the grid size: 2 to 200 ──
      await expect(grid).toHaveValue('20')
      await grid.click()
      await grid.press('Control+a')
      await grid.press('Backspace')
      await expect(grid, 'emptied: nothing snaps back into it').toHaveValue('')
      await grid.press('4')
      await grid.press('0')
      await expect(grid).toHaveValue('40')
      await leave(grid)
      await expect(grid).toHaveValue('40')
      // The store followed what was typed: with the grid on, 40 px is the 31 + 21 lines of a 1200x800 page.
      await toolbar.getByLabel('Grid', { exact: true }).check()
      await expect.poll(() => gridLineCount(window), { timeout: 10_000 }).toBe(1200 / 40 + 1 + (800 / 40 + 1))
      await retype(grid, '1')
      await leave(grid)
      await expect(grid).toHaveValue('2')
      await retype(grid, '500')
      await leave(grid)
      await expect(grid).toHaveValue('200')
      await grid.click()
      await grid.press('Control+a')
      await grid.press('Backspace')
      await leave(grid)
      await expect(grid, 'an emptied box goes back to what it was').toHaveValue('200')

      // ── a text layer's Size: 4 and up ──
      await window.locator(LAYERS).getByText('Text', { exact: true }).first().click()
      await expect(propsCard(window)).toBeVisible()
      // T-125 (16): "Size" counted pixels without saying so (the Picture-in-picture boxes and the preset manager say "(px)"), and the
      // longer word still fits its column on one line.
      await expectOneLine(propsCard(window).getByText('Size (px)', { exact: true }), 'the text layer\'s Size label')
      const size = field(window, 'Size (px)')
      await retype(size, '72')
      await expect(size).toHaveValue('72')
      await leave(size)
      await expect(size).toHaveValue('72')
      await retype(size, '2')
      await leave(size)
      await expect(size, 'the smallest a text layer takes is 4').toHaveValue('4')
      await retype(size, '120')
      await leave(size)
      await expect(size).toHaveValue('120')
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — selection', () => {
  test('clicking a shape attaches the Transformer and fills the properties panel', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('select')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await expectLayerCount(window, 2)
      // Drawing selects what it just drew (canvasStore.addLayer).
      await expect(propsCard(window)).toBeVisible()
      await expect(field(window, 'Name')).toHaveValue('Rectangle')

      // Clicking empty canvas with the Select tool clears the selection.
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await clickDoc(window, { x: 900, y: 700 })
      await expect(propsCard(window)).toHaveCount(0)
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(0)

      // Clicking the shape selects it: Transformer attaches AND the panel fills.
      await clickDoc(window, { x: 450, y: 400 })
      await expect(propsCard(window)).toBeVisible()
      await expect(field(window, 'Name')).toHaveValue('Rectangle')
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(1)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-04-selected.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('drag-end and a Transformer handle drag both persist into the document', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('geometry')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await clickDoc(window, { x: 450, y: 400 })
      const start = await lastShape(window)
      // The number fields are the store's own readout (PropertiesPanel.tsx:47).
      await expect(field(window, 'x')).toHaveValue(String(Math.round(start.x)))
      await expect(field(window, 'y')).toHaveValue(String(Math.round(start.y)))

      // ── drag the shape: onDragEnd writes x/y through updateLayer ──
      // T-62: through drag.ts, like every other gesture in this directory —
      // Konva moves the node live, so `x` is the extent to wait for before
      // the button comes up (see tests/e2e/drag.ts for the crossing-event
      // race that makes the wait load-bearing).
      const g = await stageGeom(window)
      const from = await toScreen(window, { x: 450, y: 400 })
      await dragTo(
        window,
        from,
        { x: from.x + 80 * g.scale, y: from.y + 60 * g.scale },
        {
          extent: {
            label: 'shape drag to +80,+60 doc px',
            read: async () => (await lastShape(window)).x,
            settled: (x) => x > start.x + 80 - MOUSE_TOL
          }
        }
      )
      await expect
        .poll(async () => (await lastShape(window)).x, { timeout: 10_000 })
        .toBeGreaterThan(start.x + 70)
      const dragged = await lastShape(window)
      expectNear(dragged.x, start.x + 80, 'dragged x')
      expectNear(dragged.y, start.y + 60, 'dragged y')
      await expect(field(window, 'x')).toHaveValue(String(Math.round(dragged.x)))
      await expect(field(window, 'y')).toHaveValue(String(Math.round(dragged.y)))

      // ── drag a corner anchor: onTransformEnd writes scale + position ──
      // The Transformer scales the node while the button is down, so the
      // scale IS the drawn state this drag waits on (T-62).
      const before = await lastShape(window)
      const anchor = await anchorPoint(window, 'bottom-right')
      await dragTo(
        window,
        anchor,
        { x: anchor.x + 60 * g.scale, y: anchor.y + 40 * g.scale },
        {
          extent: {
            label: 'bottom-right anchor drag',
            read: async () => (await lastShape(window)).scaleX,
            settled: (scaleX) => scaleX > before.scaleX + 0.1
          }
        }
      )
      await expect
        .poll(async () => (await lastShape(window)).scaleX, { timeout: 10_000 })
        .toBeGreaterThan(before.scaleX + 0.1)
      const scaled = await lastShape(window)
      expect(scaled.scaleY).toBeGreaterThan(before.scaleY + 0.05)
      expect(scaled.width).toBe(before.width) // scale, not a resize of the box

      // It went through the STORE, not just the Konva node: one Undo reverses
      // the transform and Redo restores it.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect
        .poll(async () => (await lastShape(window)).scaleX, { timeout: 10_000 })
        .toBeCloseTo(before.scaleX, 3)
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect
        .poll(async () => (await lastShape(window)).scaleX, { timeout: 10_000 })
        .toBeCloseTo(scaled.scaleX, 3)
    } finally {
      await closeStudio(studio)
    }
  })

  test('Delete and Backspace remove the selected layer; typing in a field does not', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('delete-keys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await dragOnStage(window, { x: 500, y: 200 }, { x: 700, y: 350 })
      await expectLayerCount(window, 3)

      // ── the INPUT guard first (ImageStudio.tsx:58): typing in the name
      //    field and pressing Delete edits TEXT, it does not delete the layer.
      const name = field(window, 'Name')
      await name.click()
      await name.fill('Keep me')
      await window.keyboard.press('End')
      await window.keyboard.press('Backspace')
      await window.keyboard.press('Delete')
      await expect(name).toHaveValue('Keep m')
      await expectLayerCount(window, 3)
      expect(await layerNames(window)).toContain('Keep m')

      // ── Delete, with focus off the field ──
      await window.locator(LAYERS).getByText('Keep m', { exact: true }).click()
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).not.toContain('Keep m')
      // Removing the selected layer clears the selection (canvasStore.ts:148).
      await expect(propsCard(window)).toHaveCount(0)

      // ── Backspace, the other binding ──
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).click()
      await expect(propsCard(window)).toBeVisible()
      await window.keyboard.press('Backspace')
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(['Text'])

      // Neither key raised a confirm — deletion here is undo-backed by design.
      expect(studio.dialogs.messages).toEqual([])
      await window.getByRole('button', { name: 'Undo' }).click()
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-119 (9): the shortcut guard stood down for INPUT and TEXTAREA only. The Export card's format and Scale
  // selects are inline panels, not Modals, so a person typing `p` to reach "PNG" switched the tool to Pencil,
  // and Delete (or Backspace) over one removed the selected layer behind it.
  test('a focused select owns the keys: typing in the Export format neither switches the tool nor deletes the layer (T-119)', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('select-keys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).first().click()
      await expect(propsCard(window)).toBeVisible()
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await expectLayerCount(window, 2)

      // The select is focused and the keys go to it: `j` is its type-ahead for JPG (the select took the key)...
      const format = window.locator(EXPORT).getByRole('combobox', { name: 'Export format' })
      await format.focus()
      await expect(format).toBeFocused()
      await window.keyboard.press('j')
      await expect(format).toHaveValue('jpg')
      // ...and the studio's own bindings stayed out of it: `p` / `r` would be Pencil / Rectangle, Delete and
      // Backspace would remove the selected layer.
      for (const key of ['p', 'r', 'o', 'l']) {
        await window.keyboard.press(key)
        await expect(window.getByText('Tool: Select')).toBeVisible()
      }
      await window.keyboard.press('Delete')
      await window.keyboard.press('Backspace')
      await window.waitForTimeout(300)
      await expectLayerCount(window, 2)
      await expect(propsCard(window)).toBeVisible()

      // The Scale select is the same rule.
      const scale = window.locator(EXPORT).getByLabel('Scale')
      await scale.focus()
      await window.keyboard.press('p')
      await window.keyboard.press('Delete')
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await expectLayerCount(window, 2)

      // Control: with focus back on the page the same keys work, so the pins above are about the select and
      // not about a dead handler.
      await scale.blur()
      await window.keyboard.press('p')
      await expect(window.getByText('Tool: Pencil')).toBeVisible()
      await window.keyboard.press('v')
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 1)
    } finally {
      await closeStudio(studio)
    }
  })

  // T-123 (2): the same guard stood down for ANY <input>, and a Snap box that has just been ticked (or an Opacity slider that
  // has just been moved) is the focused element: tick Snap, press R, and the tool stayed where it was; press Delete and the
  // selected layer stayed. A checkbox and a range have no use for the tool keys, Delete or Backspace.
  test('tick Snap and R still switches the tool, Delete still removes the layer, Ctrl+Z still brings it back (T-123 (2))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('checkbox-keys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).first().click()
      await expect(propsCard(window)).toBeVisible()
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await expectLayerCount(window, 2)

      const focusedType = (): Promise<string | null> =>
        window.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type ?? null)

      // ── a ticked checkbox is the focused element ──
      const snap = toolbar.getByLabel('Snap', { exact: true })
      await snap.check()
      await expect(snap).toBeChecked()
      expect(await focusedType(), 'the trap is real: focus is on the box that was just ticked').toBe('checkbox')
      await window.keyboard.press('r')
      await expect(window.getByText('Tool: Rectangle'), 'R from the focused checkbox switches the tool').toBeVisible()
      await window.keyboard.press('p')
      await expect(window.getByText('Tool: Pencil')).toBeVisible()
      await window.keyboard.press('v')
      await expect(window.getByText('Tool: Select')).toBeVisible()
      // Space is the checkbox's own: it toggles Snap and nothing else.
      await snap.focus()
      await window.keyboard.press(' ')
      await expect(snap).not.toBeChecked()
      await window.keyboard.press(' ')
      await expect(snap).toBeChecked()
      await expect(window.getByText('Tool: Select')).toBeVisible()
      // Delete from the checkbox removes the selected layer; Ctrl+Z from the checkbox brings it back.
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 1)
      await snap.focus()
      expect(await focusedType()).toBe('checkbox')
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 2)

      // ── a range slider: moved with its own keys, and the tool keys are still the studio's ──
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).first().click()
      const opacity = propsCard(window).getByRole('slider')
      await opacity.focus()
      await window.keyboard.press('ArrowLeft')
      expect(await focusedType()).toBe('range')
      await window.keyboard.press('o')
      await expect(window.getByText('Tool: Ellipse'), 'O from the focused slider switches the tool').toBeVisible()
      await window.keyboard.press('v')
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await opacity.focus()
      await window.keyboard.press('Backspace')
      await expectLayerCount(window, 1)
      expect(studio.dialogs.messages).toEqual([])
    } finally {
      await closeStudio(studio)
    }
  })

  test('T-68: every studio hotkey is inert behind an open dialog, and works again after it closes', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('modal-hotkeys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await dragOnStage(window, { x: 500, y: 200 }, { x: 700, y: 350 })
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await expectLayerCount(window, 3)
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).first().click()
      await expect(propsCard(window)).toBeVisible()
      await expect(window.getByText('Tool: Select')).toBeVisible()
      const names = await layerNames(window)

      // The Variants dialog, over a canvas with a selected layer behind it.
      await window.locator(EXPORT).getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // ── the destructive one: Delete and Backspace reach the layer behind
      //    the scrim on the old build, and the user's only clue is a row
      //    that has vanished by the time they close the dialog. ──
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 3)
      await window.keyboard.press('Backspace')
      await expectLayerCount(window, 3)
      expect(await layerNames(window)).toEqual(names)

      // ── the tool switches: R/O/L/P retarget the canvas underneath ──
      for (const key of ['r', 'o', 'l', 'p']) {
        await window.keyboard.press(key)
        await expect(window.getByText('Tool: Select')).toBeVisible()
      }

      // ── the shared undo hook is the same hole (useUndoRedoHotkeys guards
      //    INPUT/TEXTAREA only), so Ctrl+Z used to roll the document back
      //    while the dialog that was rendered FROM that document stayed up. ──
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 3)
      expect(await layerNames(window)).toEqual(names)

      // ── T-72: `?` is a window-level binding too, and the app-wide
      //    HotkeyOverlay renders its OWN Modal — so on the old build it
      //    stacked a second dialog on top of the one the user was in,
      //    covering the dialog they had opened on purpose. ──
      await window.keyboard.press('?')
      await expect(window.locator('[role="dialog"]')).toHaveCount(1)
      await expect(window.getByText('Press Esc or ? to close.')).toHaveCount(0)
      // …and the one dialog still up is the one the user opened.
      await expect(dialog.getByRole('button', { name: 'Generate 3 variants' })).toBeVisible()

      // ── and the dialog itself is unharmed: its own keys still work ──
      await expect(dialog).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      // ── with the dialog gone every binding is live again. The fix is
      //    "not while a Modal is open", not "hotkeys off". ──
      await window.keyboard.press('r')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await window.locator(LAYERS).getByText('Rectangle', { exact: true }).first().click()
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 2)
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 3)

      // ── T-72's other half: `?` is inert BEHIND a dialog, not disabled.
      //    With nothing open it still toggles, and it can still close the
      //    overlay it opened — the self-exemption. A blanket isModalOpen()
      //    guard would have trapped the overlay open forever. ──
      await window.keyboard.press('?')
      await expect(window.getByText('Press Esc or ? to close.')).toBeVisible()
      await window.keyboard.press('?')
      await expect(window.locator('[role="dialog"]')).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — layer panel', () => {
  test('every per-row control reaches its end state, and delete asks nothing', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('layers')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await toolbar.getByRole('button', { name: 'Ellipse' }).click()
      await dragOnStage(window, { x: 600, y: 200 }, { x: 800, y: 350 })
      await expectLayerCount(window, 3)
      // Doc order is [Text, Rectangle, Ellipse]; the panel shows it reversed.
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])

      const rectRow = layerRow(window, 'Rectangle')

      // ── select ──
      await rectRow.click()
      await expect(field(window, 'Name')).toHaveValue('Rectangle')
      await expect(rectRow).toHaveClass(/border-accent/)

      // ── T-114: and it is selectable from the keyboard, with the state said to assistive tech ──
      // The row was a clickable <li>: no tab stop, no Enter, no state. Its name is a real button now.
      const select = (name: string): Locator => layerRow(window, name).getByRole('button', { name, exact: true })
      await expect(rectRow).toHaveAttribute('aria-current', 'true')
      await expect(select('Rectangle')).toHaveAttribute('aria-current', 'true')
      await expect(layerRow(window, 'Ellipse')).not.toHaveAttribute('aria-current', /.*/)
      await select('Ellipse').focus()
      await window.keyboard.press('Enter')
      await expect(field(window, 'Name')).toHaveValue('Ellipse')
      await expect(layerRow(window, 'Ellipse')).toHaveAttribute('aria-current', 'true')
      await expect(layerRow(window, 'Ellipse')).toHaveClass(/border-accent/)
      await expect(rectRow).not.toHaveAttribute('aria-current', /.*/)
      await select('Text').focus()
      await window.keyboard.press('Space')
      await expect(field(window, 'Name')).toHaveValue('Text')
      await expect(layerRow(window, 'Text')).toHaveAttribute('aria-current', 'true')
      await expect(layerRow(window, 'Ellipse')).not.toHaveAttribute('aria-current', /.*/)
      // Tab reaches it from the row's own eye and lock buttons: it is in the page's tab order.
      await layerRow(window, 'Rectangle').getByRole('button', { name: 'Lock layer' }).focus()
      await window.keyboard.press('Tab')
      await expect(select('Rectangle')).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(field(window, 'Name')).toHaveValue('Rectangle')

      // ── eye: an invisible layer stops rendering on the stage ──
      // T-114: a toggle that says its state. It was a constant title, "Show/hide": an icon swap was the
      // only sign of which, and nothing a screen reader reads.
      const eye = rectRow.getByRole('button', { name: 'Layer visible' })
      await expect(eye).toHaveAttribute('aria-pressed', 'true')
      await expect(eye).toHaveAccessibleDescription('Hide layer')
      expect(await stageShapes(window)).toHaveLength(3)
      await eye.click()
      await expect.poll(async () => (await stageShapes(window)).length, { timeout: 10_000 }).toBe(2)
      expect((await stageShapes(window)).map((s) => s.cls)).toEqual(['Text', 'Ellipse'])
      await expect(eye).toHaveAttribute('aria-pressed', 'false')
      await expect(eye).toHaveAccessibleDescription('Show layer')
      await eye.click()
      await expect.poll(async () => (await stageShapes(window)).length, { timeout: 10_000 }).toBe(3)
      await expect(eye).toHaveAttribute('aria-pressed', 'true')

      // ── lock: the shape refuses to be dragged ──
      await expect(rectRow.getByRole('button', { name: 'Lock layer' })).toBeVisible()
      const beforeLock = (await stageShapes(window))[1]
      await rectRow.getByRole('button', { name: 'Lock layer' }).click()
      await expect(rectRow.getByRole('button', { name: 'Unlock layer' })).toBeVisible()
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await expect
        .poll(async () => (await stageShapes(window))[1]?.draggable, { timeout: 10_000 })
        .toBe(false)
      const g = await stageGeom(window)
      const grab = await toScreen(window, { x: 300, y: 275 })
      // T-62: through drag.ts, with no `extent` — a gesture that must commit
      // NOTHING has no drawn state to wait for, which is exactly the case
      // drag.ts documents as the one legitimate omission.
      await dragTo(window, grab, { x: grab.x + 60 * g.scale, y: grab.y + 40 * g.scale })
      const afterLock = (await stageShapes(window))[1]
      expect(afterLock?.x).toBe(beforeLock?.x)
      expect(afterLock?.y).toBe(beforeLock?.y)
      await rectRow.getByRole('button', { name: 'Unlock layer' }).click()
      await expect(rectRow.getByRole('button', { name: 'Lock layer' })).toBeVisible()

      // ── up / down reorder the document ──
      await rectRow.getByRole('button', { name: 'Move layer up' }).click()
      expect(await layerNames(window)).toEqual(['Rectangle', 'Ellipse', 'Text'])
      expect((await stageShapes(window)).map((s) => s.cls)).toEqual(['Text', 'Ellipse', 'Rect'])
      await rectRow.getByRole('button', { name: 'Move layer down' }).click()
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])
      expect((await stageShapes(window)).map((s) => s.cls)).toEqual(['Text', 'Rect', 'Ellipse'])
      // The bottom row cannot go further down, the top row no further up.
      await layerRow(window, 'Text').getByRole('button', { name: 'Move layer down' }).click()
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])
      await layerRow(window, 'Ellipse').getByRole('button', { name: 'Move layer up' }).click()
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])

      // ── duplicate: a copy offset by 20px, selected, on top ──
      await rectRow.getByRole('button', { name: 'Duplicate layer' }).click()
      await expectLayerCount(window, 4)
      expect(await layerNames(window)).toEqual([
        'Rectangle copy',
        'Ellipse',
        'Rectangle',
        'Text'
      ])
      await expect(field(window, 'Name')).toHaveValue('Rectangle copy')
      // The +20 offset is the app's own arithmetic, so it is exact against the
      // layer it was copied from. The nominal 220 is not: the source rect's
      // own coordinate came out of a DRAG, so it carries MOUSE_TOL like every
      // other gesture-derived expectation in this file. T-62 —
      // `toBeCloseTo(220, 0)` (< 0.5 doc px) was deterministically red at
      // 1600x1200, where one screen pixel is ~1.3 doc px at the fit zoom.
      const source = (await stageShapes(window))[1]
      const copy = await lastShape(window)
      expect(copy.x).toBeCloseTo((source?.x ?? 0) + 20, 5)
      expect(copy.y).toBeCloseTo((source?.y ?? 0) + 20, 5)
      expectNear(copy.x, 220, 'duplicate x')
      expectNear(copy.y, 220, 'duplicate y')

      // ── delete: no confirm dialog (the documented design), row gone ──
      await layerRow(window, 'Rectangle copy').getByRole('button', { name: 'Remove layer' }).click()
      await expectLayerCount(window, 3)
      expect(studio.dialogs.messages).toEqual([])
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-05-layers.png') })
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — layers panel layout (T-124 (12))', () => {
  // T-124 (12) [MED]: T-114 turned the layer name's <span> into a <button> (for the keyboard), and the `truncate` span inside that
  // column-flex button kept its max-content width: a layer called "Rectangle" painted 22 px over "Move layer up" at the 1024 px
  // minimum, and "hint — won't export" wrapped onto three lines beside its name. Nothing was clipped and nothing left the panel,
  // so the overflow checks pass; what fails is one control drawn over another, and a tag that takes three lines.
  test('a layer name is cut with an ellipsis inside its button, never painted over the row\'s buttons, and the hint tag takes at most two lines (T-124 (12))', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('layer-rows')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      // The facecam overlay card: three layers carry the "hint" tag.
      await window.locator(IMPORT).getByRole('button', { name: /Bold thumbnail|Facecam/ }).first().click()
      await expect(window.locator(LAYERS)).toContainText('Layers (')
      // A long name, and a short one, on top of the template's.
      const png = readFileSync(studio.fixturePng).toString('base64')
      await dropPng(window, png, 'a-very-long-image-file-name-for-a-logo-final-v2.png')
      await expect(window.locator(LAYERS)).toContainText('a-very-long-image-file-name')
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await resizeAndSettle(app, window, size)
        const rows = window.locator(`${LAYERS} li`)
        const n = await rows.count()
        expect(n, 'the template and the picture give several rows').toBeGreaterThan(3)
        for (let i = 0; i < n; i++) {
          const row = rows.nth(i)
          const name = (await row.locator('span.truncate').innerText()).trim()
          await expectNoOverlap(row.locator('button, span.truncate'), `the row "${name}" at ${where}`)
          // The name stays inside its own button: its right edge is not past the button's.
          const geometry = await row.evaluate((li) => {
            const span = li.querySelector('span.truncate') as HTMLElement
            const button = span.closest('button') as HTMLElement
            const tag = button.querySelector('span:not(.truncate)') as HTMLElement | null
            const cs = tag ? getComputedStyle(tag) : null
            return {
              nameRight: span.getBoundingClientRect().right,
              buttonRight: button.getBoundingClientRect().right,
              tagLines: tag && cs ? Math.round(tag.getBoundingClientRect().height / (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25)) : 0
            }
          })
          expect(geometry.nameRight, `"${name}" at ${where} is painted ${Math.round(geometry.nameRight - geometry.buttonRight)} px past its button`).toBeLessThanOrEqual(geometry.buttonRight + 0.5)
          expect(geometry.tagLines, `the hint tag of "${name}" at ${where} wraps onto ${geometry.tagLines} lines`).toBeLessThanOrEqual(2)
        }
      }
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-layers-layout-min.png') })
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — properties panel', () => {
  // T-123 (24) [HIGH]: the Rotation row (a w-16 label, a w-20 box and seven no-wrap presets: 406 px) sat in a 260 px column and was
  // clipped behind the column's HIDDEN horizontal scrollbar at every window size: only "0" and "15" showed at the default window,
  // though the README and FOR_MIKE promise the presets. Every case in this file clicks a preset with `click()`, which scrolls the
  // button into view first, so ten sweeps drove "all seven presets" green over a row nobody could see. This reads the geometry.
  test('the Properties column has no sideways overflow and all seven rotation presets are on screen, at the default window and the minimum (T-123 (24))', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('props-layout')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      await startBlank(window) // a text layer: the tallest Properties panel (Text, Size, Color rows)
      const column = propsCard(window).locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]')
      const presets = propsCard(window).locator('button').filter({ hasText: /^(0|15|30|45|90|180|270)$/ })
      await expect(presets).toHaveCount(7)

      const check = async (where: string): Promise<void> => {
        await expectNoHorizontalOverflow(column, `the layers and Properties column at ${where}`)
        await expectNoHorizontalOverflow(propsCard(window), `the Properties card at ${where}`)
        await expectControlsWhole(column, presets, `the seven rotation presets at ${where}`)
        // The row's own box is on screen too, and the last preset is the one that was off the edge.
        await expectControlsWhole(column, propsCard(window).getByRole('button', { name: 'Rotate 270 degrees', exact: true }), `the 270 preset at ${where}`)
      }
      await check('the default 1632 px window (a text layer)')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-11-properties-default.png') })

      // A shape's panel (Fill, Stroke, Stroke px) at the same width, then both at the smallest window.
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)
      await check('the default 1632 px window (a rectangle)')
      await resizeAndSettle(app, window, MIN_WINDOW)
      await check('the 1024 px minimum (a rectangle)')
      // Still a working row after it wrapped: the last preset sets the angle.
      await propsCard(window).getByRole('button', { name: 'Rotate 270 degrees', exact: true }).click()
      await expect(field(window, 'Rotation')).toHaveValue('270')
    } finally {
      await closeStudio(studio)
    }
  })

  test('every shape field, all seven rotation presets, and the opacity readout', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('props-shape')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)

      // ── name ──
      await field(window, 'Name').fill('Face box')
      expect(await layerNames(window)).toEqual(['Face box', 'Text'])

      // ── x / y ──
      await field(window, 'x').fill('123')
      await field(window, 'y').fill('456')
      await expect
        .poll(async () => (await lastShape(window)).x, { timeout: 10_000 })
        .toBe(123)
      expect((await lastShape(window)).y).toBe(456)

      // ── rotation field, then all seven presets ──
      await field(window, 'Rotation').fill('33.5')
      await expect.poll(async () => (await lastShape(window)).rotation, { timeout: 10_000 }).toBe(33.5)
      for (const preset of [0, 15, 30, 45, 90, 180, 270]) {
        // T-124 (30): announced as what it does ("Rotate 45 degrees", not "45"), while the visible text stays the bare number.
        const button = propsCard(window).getByRole('button', { name: `Rotate ${preset} degrees`, exact: true })
        await expect(button).toHaveText(String(preset))
        await button.click()
        await expect(field(window, 'Rotation')).toHaveValue(String(preset))
        await expect
          .poll(async () => (await lastShape(window)).rotation, { timeout: 10_000 })
          .toBe(preset)
      }

      // ── opacity slider + its percent readout ──
      const opacity = window.getByRole('slider', { name: 'Layer opacity' })
      await expect(propsCard(window)).toContainText('100%')
      await opacity.fill('0.4')
      await expect(propsCard(window)).toContainText('40%')
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBe(0.4)
      await opacity.fill('0')
      await expect(propsCard(window)).toContainText('0%')

      // ── fill / stroke / stroke px ──
      await field(window, 'Fill').fill('#00ff88')
      await field(window, 'Stroke').fill('#123456')
      await field(window, 'Stroke px').fill('7')
      await expect.poll(async () => (await lastShape(window)).fill, { timeout: 10_000 }).toBe('#00ff88')
      const styled = await lastShape(window)
      expect(styled.stroke).toBe('#123456')
      expect(styled.strokeWidth).toBe(7)

      // An ellipse gets the same three fields; a line layer gets none of them.
      await window.locator(TOOLBAR).getByRole('button', { name: 'Ellipse' }).click()
      await dragOnStage(window, { x: 700, y: 250 }, { x: 900, y: 400 })
      await expect(field(window, 'Fill')).toHaveValue('rgba(245, 46, 46, 0.4)')
      await window.locator(TOOLBAR).getByRole('button', { name: '+ More' }).click()
      await window.locator(TOOLBAR).getByRole('button', { name: 'Line' }).click()
      await dragOnStage(window, { x: 200, y: 600 }, { x: 500, y: 700 })
      await expect(field(window, 'Name')).toHaveValue('Line')
      await expect(field(window, 'Fill')).toHaveCount(0)
      await expect(field(window, 'Stroke px')).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-06-properties.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('a text layer gets its own text, size and color fields', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('props-text')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(LAYERS).getByText('Text', { exact: true }).click()
      await expect(field(window, 'Name')).toHaveValue('Text')

      const textarea = field(window, 'Text')
      await expect(textarea).toHaveValue('Text')
      await textarea.fill('SUBSCRIBE\nNOW')
      await expect
        .poll(async () => (await lastShape(window)).text, { timeout: 10_000 })
        .toBe('SUBSCRIBE\nNOW')

      await field(window, 'Size (px)').fill('72')
      await expect.poll(async () => (await lastShape(window)).fontSize, { timeout: 10_000 }).toBe(72)

      await field(window, 'Color').fill('#ff3131')
      await expect.poll(async () => (await lastShape(window)).fill, { timeout: 10_000 }).toBe('#ff3131')

      // The text layer never offers the shape-only fields.
      await expect(field(window, 'Stroke')).toHaveCount(0)
      await expect(field(window, 'Stroke px')).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — import', () => {
  test('drop, file chooser, +Add text and paste all add a layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('import')
    const { window } = studio
    try {
      const png = readFileSync(studio.fixturePng).toString('base64')

      // ── drop on the EMPTY state's "or start blank" zone ──
      await dropPng(window, png, 'dropped-empty.png')
      await expectLayerCount(window, 1)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Added dropped-empty.png')
      // The layer exists before its bitmap does — `use-image` decodes the data
      // URL asynchronously and Canvas.tsx's `useImage` (:49) renders nothing until it resolves.
      await expectShapeCount(window, 1)
      const first = await lastShape(window)
      expect(first.cls).toBe('Image')
      // Under the 800px cap the fixture keeps its natural size (ImportPanel.tsx:71).
      expect(first.x).toBe(60)
      expect(first.y).toBe(60)
      expect(await layerNames(window)).toEqual(['dropped-empty.png'])

      // ── drop again, now on the LOADED state's import row ──
      await dropPng(window, png, 'dropped-loaded.png')
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).toEqual(['dropped-loaded.png', 'dropped-empty.png'])

      // ── a non-image is refused by name, with its own copy ──
      await dropPng(window, png, 'stream-notes.txt')
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Unsupported file type')
      await expectLayerCount(window, 2)

      // ── + Import image: the real <input type=file> click path ──
      const chooserPromise = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      const chooser = await chooserPromise
      expect(chooser.isMultiple()).toBe(false)
      await chooser.setFiles(studio.fixturePng)
      await expectLayerCount(window, 3)
      expect((await layerNames(window))[0]).toBe('e2e-red.png')

      // ── + Add text ──
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 4)
      await expectShapeCount(window, 4)
      const text = await lastShape(window)
      expect(text.cls).toBe('Text')
      expect(text.x).toBe(120)
      expect(text.y).toBe(120)
      expect(text.fontSize).toBe(32)

      // ── paste: a REAL image on Electron's clipboard + a real Ctrl+V ──
      // The ledger lists this row as HL-clipboard; it turns out to be fully
      // drivable, so it is covered rather than dispositioned.
      await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
        clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
      }, `data:image/png;base64,${png}`)
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 5)
      await expectShapeCount(window, 5)
      const pasted = await lastShape(window)
      expect(pasted.cls).toBe('Image')
      expect(pasted.width).toBe(FIXTURE_PNG_W)
      expect(pasted.height).toBe(FIXTURE_PNG_H)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-07-imported.png') })

      // ── emptying the canvas returns the templates-first empty state, whose
      //    own primary CTA drives the same picker ──
      for (let i = 5; i > 0; i -= 1) {
        await window.locator(`${LAYERS} li`).first().getByRole('button', { name: 'Remove layer' }).click()
      }
      await expect(window.getByText('Pick a template to start')).toBeVisible()
      await expect(window.locator(TOOLBAR)).toHaveCount(0)
      const emptyChooser = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.getByRole('button', { name: 'Import image', exact: true }).click()
      await (await emptyChooser).setFiles(studio.fixturePng)
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(['e2e-red.png'])
    } finally {
      await closeStudio(studio)
    }
  })
})

/**
 * Dispatch a `drop` carrying a File with REAL PNG bytes. ImportPanel reads the
 * bytes through FileReader + Image decode (unlike Video/Audio, which read the
 * Electron `path` expando), so a placeholder file would not survive the flow.
 * Finds whichever drop zone the current state renders: the loaded state's own
 * card carries the tutorial id, the empty state nests it under "Or start blank".
 */
async function dropPng(window: Page, base64: string, fileName: string): Promise<void> {
  await window.evaluate(
    ({ base64, fileName }) => {
      const host = document.querySelector('[data-tutorial="image-import"]')
      if (!host) throw new Error('image import zone not found')
      const zone = host.classList.contains('card') ? host : host.querySelector('div.card')
      if (!zone) throw new Error('image drop zone not found')
      const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const file = new File([bin], fileName, { type: 'image/png' })
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
      zone.dispatchEvent(event)
    },
    { base64, fileName }
  )
}

test.describe('Image Studio — export', () => {
  test('PNG and JPG export real bytes, and the scale select changes their size', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('export')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      const geom = await stageGeom(window)

      const output = exportPanel.getByTestId('export-output-size')

      // ── PNG at 1x ──
      await exportPanel.getByLabel('Scale').selectOption('1')
      // T-91: the readout beside Scale says what the file will be BEFORE the
      // click — from the document and the scale, the same arithmetic the
      // capture uses. 1x of a 1280x720 thumbnail is YouTube's own size, so
      // there is nothing to add.
      await expect(output).toHaveText('Output: 1280×720')
      await expect(exportPanel).not.toContainText("Bigger than YouTube's thumbnail size")
      await exportButton.click()
      const [png1] = await waitForDownloads(studio, 1)
      const size1 = pngSize(png1 as Buffer)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('PNG saved')
      expect(savedNames(studio)[0]).toMatch(/^imagii-\d+\.png$/)
      // The native Save dialog was really asked, for a .png, once.
      const calls1 = await saveCalls(studio.app)
      expect(calls1.save).toHaveLength(1)
      expect(calls1.save[0]?.defaultPath).toMatch(/^imagii-\d+\.png$/)
      expect(calls1.save[0]?.filters).toEqual([{ name: 'PNG image', extensions: ['png'] }])

      // T-45: "1×" means one document pixel per exported pixel. The on-screen
      // stage is a fit-to-container render (Canvas.tsx:170-179) and is NOT the
      // document size here — asserted first, so every dimension below is a
      // claim about the export math and not an accident of this window.
      expect(geom.stageW, 'the stage is zoomed, not 1:1').not.toBe(t.doc.width)
      expect(size1).toEqual({ w: t.doc.width, h: t.doc.height })

      // ── scale 2x: same click, exactly twice the document ──
      await clearDownloads(studio)
      await exportPanel.getByLabel('Scale').selectOption('2')
      // The default scale on a HiDPI screen is 2x, which makes a thumbnail
      // YouTube will not take at face value — the readout and the soft note
      // say so before the file exists, and the file then matches the readout.
      await expect(output).toHaveText('Output: 2560×1440')
      await expect(exportPanel).toContainText("Bigger than YouTube's thumbnail size (1280×720).")
      await exportButton.click()
      const [png2] = await waitForDownloads(studio, 1)
      const size2 = pngSize(png2 as Buffer)
      expect(size2).toEqual({ w: t.doc.width * 2, h: t.doc.height * 2 })

      // ── scale 0.5x, the other end of the picker ──
      await clearDownloads(studio)
      await exportPanel.getByLabel('Scale').selectOption('0.5')
      await expect(output).toHaveText('Output: 640×360')
      await expect(exportPanel).not.toContainText("Bigger than YouTube's thumbnail size")
      await exportButton.click()
      const [pngHalf] = await waitForDownloads(studio, 1)
      expect(pngSize(pngHalf as Buffer)).toEqual({
        w: t.doc.width * 0.5,
        h: t.doc.height * 0.5
      })

      // ── JPG: format select swaps the encoder and reveals the quality slider ──
      await clearDownloads(studio)
      await expect(window.getByRole('slider', { name: 'JPG export quality' })).toHaveCount(0)
      // T-115: the format select is named; it used to be found as "the first combobox".
      const formatSelect = exportPanel.getByRole('combobox', { name: 'Export format' })
      await expect(formatSelect).toHaveCount(1)
      await expect(formatSelect.locator('option')).toHaveText(['PNG', 'JPG'])
      await formatSelect.selectOption('jpg')
      const quality = window.getByRole('slider', { name: 'JPG export quality' })
      await expect(quality).toBeVisible()
      await expect(exportPanel).toContainText('92%')
      await exportPanel.getByLabel('Scale').selectOption('1')

      await quality.fill('1')
      await expect(exportPanel).toContainText('100%')
      await exportButton.click()
      const [jpgHigh] = await waitForDownloads(studio, 1)
      expect(savedNames(studio)[0]).toMatch(/^imagii-\d+\.jpg$/)
      expect((await saveCalls(studio.app)).save.at(-1)?.filters).toEqual([
        { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }
      ])
      expect(jpegSize(jpgHigh as Buffer)).toEqual(size1)

      await clearDownloads(studio)
      await quality.fill('0.5')
      await expect(exportPanel).toContainText('50%')
      await exportButton.click()
      const [jpgLow] = await waitForDownloads(studio, 1)
      // The slider reached the encoder: same pixels, materially fewer bytes.
      expect(jpegSize(jpgLow as Buffer)).toEqual(size1)
      expect((jpgLow as Buffer).length).toBeLessThan((jpgHigh as Buffer).length * 0.9)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('JPG saved')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-08-export.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('emote pack: a 112x112 PNG export writes three files through ONE folder dialog', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('emote')
    const { window } = studio
    try {
      const t = templateById('emote-blank-112')
      expect([t.doc.width, t.doc.height]).toEqual([112, 112])
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const geom = await stageGeom(window)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      // T-91: the readout tells the truth for the pack — three sizes, not
      // whatever Scale says — and Scale steps aside with the reason on it.
      await expect(exportPanel.getByTestId('export-output-size')).toHaveText(
        'Output: 3 PNGs — 28×28, 56×56, 112×112'
      )
      await expect(exportPanel.getByLabel('Scale')).toBeDisabled()

      // ── the user cancels the folder picker: nothing is written, nothing is said ──
      await answerDialogs(studio.app, 'cancel')
      await exportButton.click()
      await expect(exportButton).toBeEnabled({ timeout: 15_000 })
      expect(await toastsAfterSettling(studio)).toEqual([])
      expect(savedNames(studio)).toEqual([])
      const afterCancel = await saveCalls(studio.app)
      expect(afterCancel.open).toHaveLength(1)

      // ── …then saves ──
      await answerDialogs(studio.app, 'save')
      await exportButton.click()
      const files = await waitForDownloads(studio, 3)
      const names = savedNames(studio)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Emote pack saved (3 PNGs: 28, 56, 112)')

      // ONE folder dialog for the pack (the cancel above was the first), and
      // not one Save dialog among them: three files, one question.
      const calls = await saveCalls(studio.app)
      expect(calls.open).toHaveLength(2)
      expect(calls.save).toHaveLength(0)
      expect(calls.open[1]?.properties).toEqual(['openDirectory', 'createDirectory'])
      expect(calls.open[1]?.title).toMatch(/emote pack/i)

      // One click, three files, named for the trio Twitch expects.
      expect(names.map((n) => n.replace(/\d{10,}/, 'STAMP')).sort()).toEqual([
        'imagii-emote-112-STAMP.png',
        'imagii-emote-28-STAMP.png',
        'imagii-emote-56-STAMP.png'
      ])
      const bySize = (n: number): Buffer => savedFile(studio, new RegExp(`^imagii-emote-${n}-\\d+\\.png$`))
      const sizes = [28, 56, 112].map((n) => pngSize(bySize(n)))

      // T-45: the bytes carry the sizes the filenames and the toast promise.
      // This doc sits at the 4x zoom cap (Canvas.tsx:179) — 112 document px
      // are drawn as 448 screen px — which is exactly the zoom that used to
      // leak into the capture and write 112/224/448. Asserting the cap is
      // really engaged first is what makes the trio below a claim about the
      // export math rather than a coincidence of window size.
      expect(geom.stageW, 'the on-screen stage really is magnified').toBeGreaterThan(t.doc.width)
      expect(sizes.map((s) => s.w)).toEqual([28, 56, 112])
      expect(sizes.map((s) => s.h)).toEqual([28, 56, 112])
      // Three distinct renders, not one file written three times.
      expect(new Set(files.map((f) => (f as Buffer).length)).size).toBe(3)

      // JPG on the same doc takes the ordinary single-file path (a Save dialog).
      await clearDownloads(studio)
      await exportPanel.getByRole('combobox', { name: 'Export format' }).selectOption('jpg')
      await expect(exportPanel.getByLabel('Scale')).toBeEnabled()
      await exportPanel.getByLabel('Scale').selectOption('2')
      await expect(exportPanel.getByTestId('export-output-size')).toHaveText('Output: 224×224')
      await exportButton.click()
      const single = await waitForDownloads(studio, 1)
      expect(single).toHaveLength(1)
      expect(savedNames(studio)[0]).toMatch(/^imagii-\d+\.jpg$/)
      expect((await saveCalls(studio.app)).save).toHaveLength(1)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-09-emote.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('the export is the document, not the window: two window sizes, same bytes', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('export-resize')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await exportPanel.getByLabel('Scale').selectOption('1')

      /** Resize, wait for the stage to re-fit, export, return bytes + zoom. */
      async function exportAtWindowSize(
        w: number,
        h: number
      ): Promise<{ bytes: Buffer; stageW: number }> {
        const previous = (await stageGeom(window)).stageW
        await setWindowSize(studio.app, w, h)
        // The ResizeObserver in Canvas.tsx re-fits the stage asynchronously;
        // waiting for the zoom to actually MOVE is what makes this a real
        // second window size rather than the same one measured twice.
        await expect
          .poll(async () => (await stageGeom(window)).stageW, { timeout: 20_000, intervals: [100] })
          .not.toBe(previous)
        await clearDownloads(studio)
        await exportButton.click()
        const [bytes] = await waitForDownloads(studio, 1)
        return { bytes: bytes as Buffer, stageW: (await stageGeom(window)).stageW }
      }

      // Both sizes clear the 1024x640 window minimum (src/main/index.ts:123-124).
      const narrow = await exportAtWindowSize(1100, 700)
      const wide = await exportAtWindowSize(1560, 980)

      // The window really is showing the canvas at two different zooms…
      expect(wide.stageW).toBeGreaterThan(narrow.stageW)
      expect(narrow.stageW).not.toBe(t.doc.width)
      expect(wide.stageW).not.toBe(t.doc.width)

      // …and neither zoom reaches the file. Same dimensions, byte for byte
      // the same PNG: the capture never sees the on-screen scale at all.
      expect(pngSize(narrow.bytes)).toEqual({ w: t.doc.width, h: t.doc.height })
      expect(pngSize(wide.bytes)).toEqual({ w: t.doc.width, h: t.doc.height })
      expect(
        wide.bytes.equals(narrow.bytes),
        'same document, same pixels, regardless of window size'
      ).toBe(true)
    } finally {
      await closeStudio(studio)
    }
  })

  test('editor chrome stays out of the file: selection and grid leave the bytes alone', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('export-chrome')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      await exportPanel.getByLabel('Scale').selectOption('1')
      const gridToggle = window.locator(TOOLBAR).getByLabel('Grid', { exact: true })
      // The layer this test selects: a box well inside the document, so its
      // Transformer border and all eight anchors would land INSIDE the exported
      // area if they leaked — an edge shape's handles could clip out of frame
      // and hide the bug. Derived from the template module, not transcribed.
      const target = t.doc.layers[2]
      if (!target) throw new Error('yt-thumb-bold lost the layer this test selects')

      async function exportOnce(): Promise<Buffer> {
        await clearDownloads(studio)
        await exportButton.click()
        const [bytes] = await waitForDownloads(studio, 1)
        return bytes as Buffer
      }

      // ── 1. baseline: nothing selected, no grid ──
      expect(await transformerNodeCount(window)).toBe(0)
      expect((await stageGeom(window)).layers).toBe(2)
      const baseline = await exportOnce()
      expect(pngSize(baseline)).toEqual({ w: t.doc.width, h: t.doc.height })
      // Two identical clicks already produce identical bytes. Without this,
      // a difference further down would not prove anything about chrome.
      expect(
        (await exportOnce()).equals(baseline),
        'the same canvas exports deterministically'
      ).toBe(true)

      // ── 2. Grid on — a real third Konva layer of real lines ──
      await gridToggle.check()
      await expect.poll(async () => (await stageGeom(window)).layers, { timeout: 10_000 }).toBe(3)
      expect(await gridLineCount(window)).toBeGreaterThan(0)
      const withGrid = await exportOnce()

      // ── 3. Grid on AND a layer selected — handles drawn over the artwork ──
      await layerRow(window, target.name).click()
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(1)
      const withBoth = await exportOnce()

      // The capture put every chrome layer back exactly as it found it: the
      // grid is still drawing and the handles are still on the user's shape.
      expect((await stageGeom(window)).layers).toBe(3)
      expect(await gridLineCount(window)).toBeGreaterThan(0)
      expect(await transformerNodeCount(window)).toBe(1)
      expect(await hiddenLayerCount(window)).toBe(0)

      // ── 4. selection only ──
      await gridToggle.uncheck()
      await expect.poll(async () => (await stageGeom(window)).layers, { timeout: 10_000 }).toBe(2)
      expect(await transformerNodeCount(window)).toBe(1)
      const withSelection = await exportOnce()

      // T-53: the file is the document the user made. Selection handles and the
      // grid are editor chrome — on the canvas, absent from every byte. Named
      // and compared as one list so a red run says WHICH chrome leaked rather
      // than stopping at the first case.
      const leaked = (
        [
          ['grid on', withGrid],
          ['grid on + selected', withBoth],
          ['selected', withSelection]
        ] as Array<[string, Buffer]>
      )
        .filter(([, bytes]) => !bytes.equals(baseline))
        .map(([label]) => label)
      expect(leaked, 'exports that differ from the deselected/grid-off export').toEqual([])
      expect(await hiddenLayerCount(window)).toBe(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-11-export-chrome.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('the document background lands in the bytes, and a transparent doc stays transparent', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('export-background')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      const bg = hexRgb(t.doc.background)
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })
      const format = exportPanel.getByRole('combobox', { name: 'Export format' })
      await exportPanel.getByLabel('Scale').selectOption('1')

      // A document point no layer covers, so whatever is there is the
      // BACKGROUND and nothing else. Guarded against the template rather than
      // trusted: rects are checked against their own box, and text (which
      // renders right and down from its origin) against its origin.
      const BG_X = 10
      const BG_Y = 500
      for (const layer of t.doc.layers) {
        if (layer.type === 'rect') {
          const hit =
            BG_X >= layer.x &&
            BG_X < layer.x + layer.width &&
            BG_Y >= layer.y &&
            BG_Y < layer.y + layer.height
          expect(hit, `background probe must miss "${layer.name}"`).toBe(false)
        } else if (layer.type === 'text') {
          expect(
            BG_X < layer.x || BG_Y < layer.y,
            `background probe must miss "${layer.name}"`
          ).toBe(true)
        }
      }

      // ── PNG: the canvas shows the template's dark fill, so the file must ──
      await exportButton.click()
      const [png] = await waitForDownloads(studio, 1)
      expect(pngSize(png as Buffer)).toEqual({ w: t.doc.width, h: t.doc.height })
      expect(
        await samplePixel(studio, png as Buffer, 'png', BG_X, BG_Y),
        'T-54: the exported PNG carries doc.background, opaque'
      ).toEqual({ ...bg, a: 255 })

      // ── JPG: no alpha channel at all, so a dropped background is BLACK ──
      await clearDownloads(studio)
      await format.selectOption('jpg')
      await exportButton.click()
      const [jpg] = await waitForDownloads(studio, 1)
      const jpgPx = await samplePixel(studio, jpg as Buffer, 'jpg', BG_X, BG_Y)
      for (const channel of ['r', 'g', 'b'] as const) {
        expect(
          Math.abs(jpgPx[channel] - bg[channel]),
          `T-54: exported JPG ${channel}=${jpgPx[channel]} near ${bg[channel]}`
        ).toBeLessThanOrEqual(JPEG_TOL)
      }

      // ── the emote template WANTS transparency — that is the point of an
      //    emote — and keeps it. Same click, opposite expectation. ──
      const emote = templateById('emote-blank-112')
      expect(emote.doc.background, 'the emote template is a transparent doc').toBe('transparent')
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      const dialog = window.locator('[role="dialog"]')
      await dialog
        .locator('button.card')
        .filter({ has: window.getByText(emote.name, { exact: true }) })
        .click()
      await expect(dialog).toHaveCount(0)
      await expectTemplateApplied(window, emote)

      await clearDownloads(studio)
      await format.selectOption('png')
      await exportButton.click()
      await waitForDownloads(studio, 3)
      const full = savedFile(studio, /^imagii-emote-112-\d+\.png$/)
      expect(pngSize(full)).toEqual({ w: emote.doc.width, h: emote.doc.height })
      // The corner: outside the base circle (centre 56,56 r 50), so the only
      // thing that could be there is a background that should not exist.
      expect(
        (await samplePixel(studio, full, 'png', 2, 2)).a,
        'T-54: an emote exports with a real alpha channel'
      ).toBe(0)
      // Positive control: the middle of the same PNG is the circle's fill, so
      // "transparent corner" is a claim about the background and not about an
      // export that came out empty.
      const centre = await samplePixel(studio, full, 'png', emote.doc.width / 2, emote.doc.height / 2)
      const circle = emote.doc.layers[0]
      if (!circle || circle.type !== 'ellipse') throw new Error('emote template lost its circle')
      expect(centre).toEqual({ ...hexRgb(circle.fill), a: 255 })
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-12-export-background.png') })
    } finally {
      await closeStudio(studio)
    }
  })

  test('variants: generate four tiles, save one, regenerate, save all', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      // The on-screen stage is a fit-to-container render and is NOT the
      // document size — asserted first, so the dimension claims below are
      // claims about the capture math and not accidents of this window (the
      // T-45 pattern, now that variants share `captureDocument`).
      expect((await stageGeom(window)).stageW, 'the stage is zoomed, not 1:1').not.toBe(t.doc.width)

      const variantsButton = window.locator(EXPORT).getByRole('button', { name: 'Variants' })
      await variantsButton.click()
      const dialog = window.locator('[role="dialog"]')
      const generate = dialog.getByRole('button', { name: 'Generate 3 variants' })
      const tiles = dialog.locator('img')
      const tileUrls = (): Promise<string[]> =>
        tiles.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src))
      await expect(dialog).toContainText('Generate three color-graded variants')

      // ── generate: original + punchy + warm + cool ──
      await generate.click()
      await expect(tiles).toHaveCount(4, { timeout: 30_000 })
      // T-119 (8): Generate is swapped for the previews, and the button that had focus went with it; keyboard
      // focus lands on the next thing a person does (Save all) instead of dropping to the page behind the dialog.
      await expect(dialog.getByRole('button', { name: /^Save all/ })).toBeFocused()
      for (const label of [
        'Original (unchanged)',
        'Punchy (more contrast + saturation)',
        'Warm (golden hour vibe)',
        'Cool (blue-shifted)'
      ]) {
        await expect(dialog.getByText(label, { exact: true })).toBeVisible()
      }
      // The three grades really differ from the original render.
      const urls = await tileUrls()
      expect(new Set(urls).size).toBe(4)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-10-variants.png') })

      // ── save one tile: T-46, the saved bytes are the DOCUMENT ──
      const saveWarm = dialog.locator('.card').filter({ hasText: 'Warm' }).getByRole('button', { name: 'Save' })
      // A canceled dialog writes nothing and says nothing (T-91).
      await answerDialogs(studio.app, 'cancel')
      await saveWarm.click()
      await expect.poll(async () => (await saveCalls(studio.app)).save.length).toBe(1)
      expect(await toastsAfterSettling(studio)).toEqual([])
      expect(savedNames(studio)).toEqual([])
      await answerDialogs(studio.app, 'save')
      await saveWarm.click()
      const [warm] = await waitForDownloads(studio, 1)
      expect(savedNames(studio)[0]).toMatch(/^imagii-variant-warm-\d+\.png$/)
      // T-123 (9): a single Save says so once the file is on disk (saveAll and Export both did; this one discarded the
      // answer), in the name the person gave it; the canceled dialog above said nothing.
      const singleSaveToast = `Saved ${savedNames(studio)[0]}`
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain(singleSaveToast)
      expect(
        pngSize(warm as Buffer),
        'T-46: a saved variant is the document, not the window'
      ).toEqual({ w: t.doc.width, h: t.doc.height })

      // ── T-46: reopening an UNTOUCHED canvas keeps the work it just did ──
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await variantsButton.click()
      await expect(tiles).toHaveCount(4)
      expect(await tileUrls(), 'nothing changed, so nothing was thrown away').toEqual(urls)
      await expect(generate).toHaveCount(0)

      // ── …but a canvas that CHANGED underneath gets the Generate button back.
      //    T-25 finding BUG-VARIANTS-STALE, fixed in T-46: the previews used to
      //    be plain component state that only early-returned on `!open`, so the
      //    user reopened onto four renders of a canvas that no longer existed
      //    with no Generate button in sight. They now belong to the document
      //    they were rendered from. ──
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await layerRow(window, 'Accent bar').getByRole('button', { name: 'Layer visible' }).click()
      await expectShapeCount(window, 3)
      await variantsButton.click()
      await expect(tiles).toHaveCount(0)
      await expect(generate).toBeVisible()
      await expect(dialog).toContainText('Generate three color-graded variants')

      // ── generating now really re-reads the canvas ──
      await generate.click()
      await expect(tiles).toHaveCount(4, { timeout: 30_000 })
      const withHidden = await tileUrls()
      expect(withHidden[0]).not.toBe(urls[0])

      // ── Regenerate: previews are current, so re-rendering the same canvas
      //    must reproduce it byte for byte. That it re-READS the canvas is the
      //    step above — Regenerate and Generate are literally the same handler,
      //    pinned in tests/unit/interactionWiring.test.ts. ──
      await dialog.getByRole('button', { name: 'Regenerate' }).click()
      await expect(tiles).toHaveCount(4, { timeout: 30_000 })
      await expect.poll(() => tileUrls(), { timeout: 30_000 }).toEqual(withHidden)

      // ── T-120 (10): a KEYBOARD Regenerate keeps focus in the dialog. The button disables itself while it renders
      //    and Chromium blurs a focused button that becomes disabled; the new previews replace the old with the
      //    list still non-empty, so the focus effect, keyed on "are there any", never ran again and focus stayed on
      //    the page behind the dialog. It lands on Save all, as it does after the first Generate. ──
      const regenerate = dialog.getByRole('button', { name: 'Regenerate' })
      await regenerate.focus()
      await expect(regenerate).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(dialog.getByRole('button', { name: 'Generating…' })).toHaveCount(0, { timeout: 30_000 })
      await expect(regenerate).toBeVisible()
      await expect(dialog.getByRole('button', { name: /^Save all/ })).toBeFocused()
      expect(
        await window.evaluate(() => document.activeElement === document.body),
        'focus fell to the page behind the dialog'
      ).toBe(false)
      await expect.poll(() => tileUrls(), { timeout: 30_000 }).toEqual(withHidden)

      // …and the hidden layer is the reason the render changed: put it back,
      // generate again, and the original returns byte for byte.
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await layerRow(window, 'Accent bar').getByRole('button', { name: 'Layer visible' }).click()
      await expectShapeCount(window, 4)
      await variantsButton.click()
      await expect(generate).toBeVisible()
      await generate.click()
      await expect
        .poll(async () => (await tileUrls())[0], { timeout: 30_000 })
        .toBe(urls[0])

      // ── save all four: ONE folder dialog, and the toast comes after ──
      clearDownloads(studio)
      const before = await saveCalls(studio.app)
      const saveAll = dialog.getByRole('button', { name: 'Save all (3 + original)' })
      await expect(saveAll).toBeVisible()
      // Canceled first: no files, no toast, and the picker was really asked.
      await answerDialogs(studio.app, 'cancel')
      await saveAll.click()
      await expect
        .poll(async () => (await saveCalls(studio.app)).open.length)
        .toBe(before.open.length + 1)
      // (the log is cumulative: the single Save's toast above is the only one in it)
      expect(await toastsAfterSettling(studio)).toEqual([singleSaveToast])
      expect(savedNames(studio)).toEqual([])
      // Then saved.
      await answerDialogs(studio.app, 'save')
      await saveAll.click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Saved 4 thumbnails')
      // The old "Saving 4 variants…" promise, made before anything was saved.
      expect(await readToastLog(window)).not.toContain('Saving 4 variants…')
      const all = await waitForDownloads(studio, 4)
      const calls = await saveCalls(studio.app)
      expect(calls.open).toHaveLength(before.open.length + 2)
      expect(calls.open.at(-1)?.title).toBe('Choose a folder for the thumbnail variants')
      expect(savedNames(studio).map((n) => n.replace(/\d{10,}/, 'STAMP'))).toEqual([
        'imagii-variant-cool-STAMP.png',
        'imagii-variant-original-STAMP.png',
        'imagii-variant-punchy-STAMP.png',
        'imagii-variant-warm-STAMP.png'
      ])
      for (const buf of all) {
        expect(pngSize(buf as Buffer)).toEqual({ w: t.doc.width, h: t.doc.height })
      }

      // ── the dialog's own Close ──
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio - the variants dialog saves once per press (T-127 (11))', () => {
  // `saveOne` and `saveAll` went straight to a native dialog with no claim, so a double-click ran two of them: two folder choosers
  // and, answered twice, the whole set written twice (executed: "Save all" = two choosers and 8 files). The dialogs here answer after
  // 300 ms, as a real one does, and that is the window the second press lands in.
  test('a double-click on Save all opens ONE folder dialog and writes ONE set; a double-click on a variant\'s Save opens ONE dialog and writes ONE file', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-dbl')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      await window.locator(EXPORT).getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
      await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
      await setDialogDelay(studio.app, 300)
      await answerDialogs(studio.app, 'save')

      // ── Save all, pressed twice ──
      clearDownloads(studio)
      const before = await saveCalls(studio.app)
      await dialog.getByRole('button', { name: 'Save all (3 + original)' }).dblclick()
      await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Saved 4 thumbnails')
      await window.waitForTimeout(1_000)
      const afterAll = await saveCalls(studio.app)
      expect(afterAll.open.length - before.open.length, 'one folder chooser, not two').toBe(1)
      expect(savedNames(studio), 'one set of four files, not two').toHaveLength(4)
      expect((await readToastLog(window)).filter((m) => m === 'Saved 4 thumbnails'), 'said once').toHaveLength(1)

      // ── one variant's Save, pressed twice ──
      clearDownloads(studio)
      const saveWarm = dialog.locator('.card').filter({ hasText: 'Warm' }).getByRole('button', { name: 'Save' })
      await saveWarm.dblclick()
      await expect.poll(() => savedNames(studio).length, { timeout: 15_000, intervals: [200] }).toBe(1)
      await window.waitForTimeout(1_000)
      const afterOne = await saveCalls(studio.app)
      expect(afterOne.save.length - afterAll.save.length, 'one save dialog, not two').toBe(1)
      expect(savedNames(studio), 'one file, not two').toHaveLength(1)
      expect(savedNames(studio)[0]).toMatch(/^imagii-variant-warm-\d+\.png$/)
      // And the claim is given back: a later press works (nothing is stuck busy).
      await saveWarm.click()
      await expect.poll(() => savedNames(studio).length, { timeout: 15_000, intervals: [200] }).toBe(2)
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — a success toast follows a real save (T-91)', () => {
  test('a canceled Save dialog writes nothing and says nothing; a saved one says so after the file exists', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('save-cancel')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-clean')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      // ── canceled: the dialog opened, the user said no ──
      // This is the state the old `<a download>` could not be put in from a
      // test, and the one it got wrong: the toast was raised on the click,
      // before any dialog had answered.
      await answerDialogs(studio.app, 'cancel')
      await exportButton.click()
      await expect.poll(async () => (await saveCalls(studio.app)).save.length).toBe(1)
      await expect(exportButton).toBeEnabled({ timeout: 15_000 })
      const toasts = await toastsAfterSettling(studio)
      expect(toasts, 'a canceled save is neither a success nor an error').toEqual([])
      expect(savedNames(studio)).toEqual([])

      // ── saved: the toast arrives, and the file is already there ──
      await answerDialogs(studio.app, 'save')
      await exportButton.click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [100] })
        .toContain('PNG saved')
      expect(savedNames(studio), 'the toast came after the write').toHaveLength(1)
      expect(pngSize(readFileSync(path.join(studio.downloadDir, savedNames(studio)[0] as string)))).toEqual({
        w: t.doc.width * 1,
        h: t.doc.height * 1
      })
    } finally {
      await closeStudio(studio)
    }
  })

  test('a save that fails says so in plain words, and is never reported as saved', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('save-fail')
    const { window } = studio
    try {
      await templateCard(window, templateById('yt-thumb-clean')).click()
      const exportButton = window.locator(EXPORT).getByRole('button', { name: 'Export', exact: true })
      await answerDialogs(studio.app, 'unwritable')
      await exportButton.click()
      const FAILED =
        "Export failed. A file imagii needs isn't there. It may have been moved or deleted."
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain(FAILED)
      const toasts = await readToastLog(window)
      expect(toasts.join(' | ')).not.toMatch(/saved|Error invoking remote method|image:save|ENOENT/)
      await expect(exportButton).toBeEnabled({ timeout: 15_000 })
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — hint layers stay on the canvas and out of the file (T-91)', () => {
  test('the face guide shows on the canvas and in the Layers panel, and is not in the exported pixels', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('hint-export')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      const bg = hexRgb(t.doc.background)
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')

      const guide = t.doc.layers.find((l) => l.name === 'Face placeholder')
      if (!guide || guide.type !== 'rect') throw new Error('yt-thumb-bold lost its face guide')
      // A point well inside the guide and clear of every other layer, from the
      // template itself. The guide draws a translucent red over the background
      // there, so a leak is a pixel that is NOT the background.
      const px = guide.x + 40
      const py = guide.y + 400
      for (const l of t.doc.layers) {
        if (l === guide) continue
        if (l.type === 'rect') {
          expect(
            px >= l.x && px < l.x + l.width && py >= l.y && py < l.y + l.height,
            `probe must miss "${l.name}"`
          ).toBe(false)
        } else if (l.type === 'text') {
          // Text draws right and down from its origin; a generous line box.
          const lines = l.text.split('\n').length
          expect(
            px < l.x || py < l.y || py > l.y + lines * l.fontSize * 1.5,
            `probe must miss "${l.name}"`
          ).toBe(true)
        }
      }

      // The guide is on the canvas for the person editing…
      expect((await stageShapes(window)).map((sh) => sh.cls)).toEqual(
        t.doc.layers.map((l) => KONVA_CLASS[l.type])
      )
      // …and says in the Layers panel, in words, that it will not export.
      await expect(layerRow(window, 'Face placeholder')).toContainText("hint — won't export")
      await expect(layerRow(window, 'Face hint')).toContainText("hint — won't export")
      // T-103: the sample title is a stand-in too, so it carries the tag; the
      // accent bar is design and does not.
      await expect(layerRow(window, 'Title')).toContainText("hint — won't export")
      await expect(layerRow(window, 'Accent bar')).not.toContainText("won't export")

      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const [png] = await waitForDownloads(studio, 1)
      expect(pngSize(png as Buffer)).toEqual({ w: t.doc.width, h: t.doc.height })
      expect(
        await samplePixel(studio, png as Buffer, 'png', px, py),
        'T-91: the face guide is not in the file — this is the plain background'
      ).toEqual({ ...bg, a: 255 })

      // Positive control: layers that are NOT hints are in the same file. The
      // accent bar's red is there, so "background at the probe" is a claim
      // about the guide and not about an export that came out empty.
      const bar = t.doc.layers.find((l) => l.name === 'Accent bar')
      if (!bar || bar.type !== 'rect') throw new Error('yt-thumb-bold lost its accent bar')
      expect(await samplePixel(studio, png as Buffer, 'png', bar.x + 600, bar.y + 90)).toEqual({
        ...hexRgb(bar.fill),
        a: 255
      })

      // Exporting hid the nodes for the capture only: every one is drawing again.
      expect(
        await window.evaluate(() => {
          const stage = (window as unknown as { __imagiiStage: { find(s: string): Array<{ visible(): boolean }> } })
            .__imagiiStage
          const hints = stage.find('.hint')
          return { count: hints.length, allVisible: hints.every((n) => n.visible()) }
        })
      ).toEqual({ count: 3, allVisible: true })
    } finally {
      await closeStudio(studio)
    }
  })

  test('an overlay exports transparent where the facecam hole was, and keeps the design around it', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('hint-overlay')
    const { window } = studio
    try {
      const t = templateById('tw-overlay-streamer')
      expect(t.doc.background).toBe('transparent')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      // Not a thumbnail: no YouTube note on a transparent overlay.
      await expect(exportPanel.getByTestId('export-output-size')).toHaveText('Output: 1920×1080')
      await expect(exportPanel).not.toContainText("Bigger than YouTube's")

      // Layers panel: the hole, its label and both placeholders are tagged;
      // the lower-third plate (design) is not.
      for (const name of ['Facecam hole', 'Facecam hint', 'Handle', 'Now playing']) {
        await expect(layerRow(window, name)).toContainText("hint — won't export")
      }
      await expect(layerRow(window, 'Lower third')).not.toContainText("won't export")

      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const [png] = await waitForDownloads(studio, 1)
      const hole = t.doc.layers.find((l) => l.name === 'Facecam hole')
      const plate = t.doc.layers.find((l) => l.name === 'Lower third')
      if (hole?.type !== 'rect' || plate?.type !== 'rect') throw new Error('overlay lost its hole or plate')
      // Inside the hole: nothing at all — alpha 0, not a 10% red tint.
      expect((await samplePixel(studio, png as Buffer, 'png', hole.x + 30, hole.y + 30)).a).toBe(0)
      // On the plate's border-free interior: the design is there, opaque-ish.
      expect((await samplePixel(studio, png as Buffer, 'png', plate.x + 650, plate.y + 40)).a).toBeGreaterThan(200)
    } finally {
      await closeStudio(studio)
    }
  })

  test('typing your own words over a placeholder makes them part of the export', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('hint-retype')
    const { window } = studio
    try {
      const t = templateById('tw-overlay-minimal')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      const handle = layerRow(window, 'Handle corner')
      await expect(handle).toContainText("hint — won't export")
      await exportButton.click()
      const [placeholderExport] = await waitForDownloads(studio, 1)

      // The user types their own handle over "@yourhandle".
      await handle.click()
      await field(window, 'Text').fill('@makenah')
      // It is theirs now: the tag is gone…
      await expect(handle).not.toContainText("won't export")
      clearDownloads(studio)
      await exportButton.click()
      const [typedExport] = await waitForDownloads(studio, 1)
      // …and the export is no longer the one with the placeholder stripped:
      // their handle is in the pixels.
      expect(
        typedExport?.equals(placeholderExport as Buffer),
        'the typed handle must reach the file'
      ).toBe(false)
    } finally {
      await closeStudio(studio)
    }
  })

  test('sample words stay out of the export until you type your own (T-103)', async () => {
    test.setTimeout(180_000)
    // "YOUR TITLE HERE" used to ship in a posted thumbnail when the person
    // forgot to change it. Every template's sample text is a hint now; this
    // drives both halves of the rule through the real export: the unedited
    // sample is NOT in the pixels, and the words typed over it ARE.
    const studio = await openStudio('hint-sample')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      const bg = hexRgb(t.doc.background)
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      const exportButton = exportPanel.getByRole('button', { name: 'Export', exact: true })

      const title = t.doc.layers.find((l) => l.name === 'Title')
      if (title?.type !== 'text') throw new Error('yt-thumb-bold lost its sample title')
      expect(title.text).toBe('YOUR TITLE\nHERE')
      // The box the title draws in: right and down from its origin, two lines,
      // and clear of every other layer (the accent bar starts at y=540, the
      // face guide at x=760). Both are checked against the template, not trusted.
      const box = { x: title.x, y: title.y, w: 640, h: 360 }
      for (const l of t.doc.layers) {
        if (l === title || l.type !== 'rect') continue
        const overlaps =
          l.x < box.x + box.w && l.x + l.width > box.x && l.y < box.y + box.h && l.y + l.height > box.y
        expect(overlaps, `the title's box must miss "${l.name}"`).toBe(false)
      }

      await expect(layerRow(window, 'Title')).toContainText("hint — won't export")
      // On the canvas it is still there for the person editing.
      expect((await stageShapes(window)).map((sh) => sh.cls)).toEqual(
        t.doc.layers.map((l) => KONVA_CLASS[l.type])
      )
      // T-112: ...and drawn DIMMED (40%), so the canvas says what the Layers tag says — these
      // words are not in the file. Only text: the guide shapes and the design draw as they were.
      const textNodes = (): Promise<Array<{ text: string; hint: boolean; opacity: number }>> =>
        window.evaluate(() => {
          const stage = (
            window as unknown as {
              __imagiiStage: {
                find(s: string): Array<{ attrs: { text?: string; name?: string }; opacity(): number }>
              }
            }
          ).__imagiiStage
          return stage.find('Text').map((n) => ({
            text: n.attrs.text ?? '',
            hint: (n.attrs.name ?? '').split(' ').includes('hint'),
            opacity: n.opacity()
          }))
        })
      const dimmed = await textNodes()
      expect(dimmed.filter((n) => n.hint).map((n) => n.text).sort()).toEqual(['Drop face here', 'YOUR TITLE\nHERE'])
      for (const n of dimmed) expect(n.opacity, `"${n.text}"`).toBe(n.hint ? 0.4 : 1)

      // ── half one: the unedited sample is not in the file ──
      await exportButton.click()
      const [sampleExport] = await waitForDownloads(studio, 1)
      expect(
        await pixelsOtherThanBackground(studio, sampleExport as Buffer, box, bg),
        'T-103: "YOUR TITLE HERE" is not in the export — the box is plain background'
      ).toBe(0)
      // Positive control, same file: the design around it IS there.
      const bar = t.doc.layers.find((l) => l.name === 'Accent bar')
      if (bar?.type !== 'rect') throw new Error('yt-thumb-bold lost its accent bar')
      expect(await samplePixel(studio, sampleExport as Buffer, 'png', bar.x + 600, bar.y + 90)).toEqual({
        ...hexRgb(bar.fill),
        a: 255
      })

      // ── half two: type your own words, and they ship ──
      await layerRow(window, 'Title').click()
      await field(window, 'Text').fill('MY TITLE')
      await expect(layerRow(window, 'Title')).not.toContainText("won't export")
      // T-112: what the person typed is theirs — full strength on the canvas, nothing to undo.
      const afterTyping = await textNodes()
      expect(afterTyping.find((n) => n.text === 'MY TITLE')?.opacity).toBe(1)
      expect(afterTyping.find((n) => n.text === 'Drop face here')?.opacity).toBe(0.4)
      await clearDownloads(studio)
      await exportButton.click()
      const [typedExport] = await waitForDownloads(studio, 1)
      expect(
        await pixelsOtherThanBackground(studio, typedExport as Buffer, box, bg),
        'T-103: the typed title is in the export — white glyphs fill part of the box'
      ).toBeGreaterThan(3_000)
    } finally {
      await closeStudio(studio)
    }
  })

  test('text that IS the card\'s deliverable exports: the BRB screen has its words, and only the handle stays out (T-103)', async () => {
    test.setTimeout(180_000)
    // The inverse of the test above. "BE RIGHT BACK" is not a stand-in for the person's own
    // words — it is what the card says — so a BRB screen exported without touching it must
    // have its words; the handle beside it is the person's own and stays a hint.
    const studio = await openStudio('hint-content')
    const { window } = studio
    try {
      const asset = ASSET_CATALOG.find((a) => a.id === 'scene-brb')
      if (!asset) throw new Error('the scene-brb asset is gone from the catalog')
      const bg = hexRgb(asset.doc.background)
      const brb = asset.doc.layers.find((l) => l.name === 'Brb')
      const handle = asset.doc.layers.find((l) => l.name === 'Handle')
      if (brb?.type !== 'text' || handle?.type !== 'text') throw new Error('scene-brb lost its words or its handle')
      expect(brb.text).toBe('BE RIGHT BACK')

      // Home -> References -> Asset Library -> the BRB card: the document opens in Stream Graphics.
      await window.locator('a[href="#/home"]').first().click()
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(window.locator('h1', { hasText: 'References' })).toBeVisible({ timeout: 15_000 })
      await window.getByRole('button', { name: 'Asset Library', exact: true }).click()
      await window.getByRole('button', { name: new RegExp(asset.name) }).click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 15_000 })
      await expectLayerCount(window, asset.doc.layers.length)

      // The words are tagged nowhere; the handle is.
      await expect(layerRow(window, 'Brb')).not.toContainText("won't export")
      await expect(layerRow(window, 'Sub')).not.toContainText("won't export")
      await expect(layerRow(window, 'Handle')).toContainText("hint — won't export")

      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const [png] = await waitForDownloads(studio, 1)
      expect(pngSize(png as Buffer)).toEqual({ w: asset.doc.width, h: asset.doc.height })

      // The headline's box (one line of 140 px type, clear of every other layer) is full of glyphs...
      const headline = { x: brb.x, y: brb.y, w: 1100, h: 160 }
      expect(
        await pixelsOtherThanBackground(studio, png as Buffer, headline, bg),
        'T-103: "BE RIGHT BACK" is in the export'
      ).toBeGreaterThan(3_000)
      // ...and the handle's box is plain background: the stand-in is the only thing left out.
      expect(
        await pixelsOtherThanBackground(studio, png as Buffer, { x: handle.x, y: handle.y, w: 300, h: 40 }, bg),
        'T-103: "@yourhandle" is not'
      ).toBe(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// T-124 (8)-(11), (13)-(15): the canvas's selection handles, its draw gestures, its lock and its snap, and the last number boxes that ate a
// minus sign or a leading decimal. Each case was written against the round-73 build first (the scratch specs of the thirteenth sweep
// were the starting point and are not trusted: every assertion here is on the live stage and the store's own readouts).
test.describe('Image Studio — handles, draw gestures, lock, snap and typed numbers (T-124 (8)-(15))', () => {
  test('an imported picture gets resize handles, and in a mixed canvas the handles follow what is selected (T-124 (8))', async () => {
    // Canvas.tsx handed every image layer a throwaway ref object (`{ ...ref, current: ... }`), so the picture's node never reached
    // the table the Transformer attaches from: no handles at all (and, in a canvas with other layers, the Transformer stayed on the
    // previous node). The picture mounts only after `use-image` has decoded it, so the attach also has to hear that.
    test.setTimeout(150_000)
    const studio = await openStudio('image-handles')
    const { window } = studio
    try {
      await startBlank(window)
      const png = readFileSync(studio.fixturePng).toString('base64')
      await dropPng(window, png, 'logo.png')
      await expectLayerCount(window, 2)
      await expectShapeCount(window, 2)
      // Importing selects the new layer; its handles are on the picture once it has drawn.
      await expect.poll(() => transformerClasses(window), { timeout: 15_000, message: 'the picture has no handles' }).toEqual(['Image'])

      // The handles follow the selection both ways, never sticking to the previous node.
      await layerRow(window, 'Text').click()
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Text'])
      await layerRow(window, 'logo.png').click()
      await expect
        .poll(() => transformerClasses(window), { timeout: 10_000, message: 'the handles stayed on the text layer' })
        .toEqual(['Image'])

      // And they resize it: a corner drag changes the picture's scale in the store (undo reverses it).
      const shapes = await stageShapes(window)
      const before = shapes.find((sh) => sh.cls === 'Image')
      if (!before) throw new Error('no image node on the stage')
      const g = await stageGeom(window)
      const anchor = await anchorPoint(window, 'bottom-right')
      await dragTo(
        window,
        anchor,
        { x: anchor.x + 60 * g.scale, y: anchor.y + 40 * g.scale },
        {
          extent: {
            label: 'picture corner drag',
            read: async () => (await stageShapes(window)).find((sh) => sh.cls === 'Image')?.scaleX ?? 0,
            settled: (scaleX) => scaleX > before.scaleX + 0.1
          }
        }
      )
      const after = (await stageShapes(window)).find((sh) => sh.cls === 'Image')
      expect(after?.scaleX ?? 0).toBeGreaterThan(before.scaleX + 0.1)
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect
        .poll(async () => (await stageShapes(window)).find((sh) => sh.cls === 'Image')?.scaleX, { timeout: 10_000 })
        .toBeCloseTo(before.scaleX, 3)
    } finally {
      await closeStudio(studio)
    }
  })

  test('draw a shape, then press Select: its handles are on it without another click (T-124 (9))', async () => {
    // The attach ran when the selection or the layers changed. Drawing selects what was drawn while the tool is Rectangle (no
    // Transformer is mounted then), and pressing Select mounts one that nothing attached.
    test.setTimeout(120_000)
    const studio = await openStudio('draw-then-select')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await expectLayerCount(window, 2)
      await expect(field(window, 'Name')).toHaveValue('Rectangle')
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await expect
        .poll(() => transformerClasses(window), { timeout: 10_000, message: 'no handles on the shape that was just drawn' })
        .toEqual(['Rect'])
    } finally {
      await closeStudio(studio)
    }
  })

  test('releasing the button outside the canvas finishes the draw: the shape is kept and the preview is gone (T-124 (10))', async () => {
    // `onMouseUp` was on the Stage alone, so a release outside it (the pointer left the canvas on the way) never ended the draw: the
    // shape was lost and the dashed preview followed the cursor back in with no button down.
    test.setTimeout(120_000)
    const studio = await openStudio('release-outside')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      const g = await stageGeom(window)
      const start = await toScreen(window, { x: 600, y: 300 })
      const nearEdge = await toScreen(window, { x: 1150, y: 500 })
      const outside = { x: g.left + g.stageW + 25, y: nearEdge.y }
      const viewport = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      expect(outside.x, 'the release point is inside the app window, outside the canvas').toBeLessThan(viewport.w)
      await dragThrough(window, start, [nearEdge, outside], async (_p, i) => {
        if (i === 0) await expect.poll(() => drawPreviewWidth(window), { timeout: 10_000 }).toBeGreaterThan(500)
      })
      await expectLayerCount(window, 2)
      const kept = await lastShape(window)
      expect(kept.cls).toBe('Rect')
      expect(kept.width ?? 0).toBeGreaterThan(500)
      // No button is down: the preview does not follow the pointer back onto the canvas.
      const back = await toScreen(window, { x: 300, y: 200 })
      await window.mouse.move(back.x, back.y)
      await window.mouse.move(back.x + 40, back.y + 40)
      await window.waitForTimeout(300)
      expect(await drawPreviewWidth(window), 'the dashed preview followed the pointer with the button up').toBe(0)
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the Line tool draws a horizontal and a vertical line, and still refuses a click (T-124 (11))', async () => {
    // Every draw tool gated on `absW > 4 && absH > 4`, which a straight line fails by construction (and Snap makes dy = 0 certain).
    test.setTimeout(150_000)
    const studio = await openStudio('straight-lines')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: '+ More' }).click()
      await toolbar.getByRole('button', { name: 'Line' }).click()
      await dragOnStage(window, { x: 300, y: 400 }, { x: 700, y: 400 })
      await expectLayerCount(window, 2)
      const horizontal = await lastShape(window)
      expect(horizontal.cls).toBe('Line')
      expect(horizontal.points?.[1]).toBe(horizontal.points?.[3])
      await dragOnStage(window, { x: 900, y: 200 }, { x: 900, y: 600 })
      await expectLayerCount(window, 3)
      const vertical = await lastShape(window)
      expect(vertical.points?.[0]).toBe(vertical.points?.[2])
      // A click (a 2 px wobble) is still not a line.
      await dragOnStage(window, { x: 500, y: 300 }, { x: 502, y: 301 }, { expectPreview: false })
      await window.waitForTimeout(300)
      await expectLayerCount(window, 3)
      // A rectangle is still refused when it is flat: only the line tool changed its rule.
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 600 }, { x: 600, y: 600 }, { expectPreview: false })
      await window.waitForTimeout(300)
      await expectLayerCount(window, 3)
      // A straight line is a layer like the others: selectable, with handles that resize it. (The Transformer refuses a box under
      // 5 px on either side, and a horizontal line is as thin as its stroke: the refusal must not also freeze a line that is
      // already thin, or the first line this change lets through could not be resized at all.)
      await toolbar.getByRole('button', { name: 'Select' }).click()
      const rows = window.locator(`${LAYERS} li`).filter({ has: window.getByText('Line', { exact: true }) })
      await rows.nth(1).click() // the older of the two lines: the horizontal one
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Line'])
      const thin = (await stageShapes(window)).filter((sh) => sh.cls === 'Line')[0]
      if (!thin) throw new Error('no line on the stage')
      const g = await stageGeom(window)
      const handle = await anchorPoint(window, 'middle-right')
      await dragTo(
        window,
        handle,
        { x: handle.x + 100 * g.scale, y: handle.y },
        {
          extent: {
            label: 'horizontal line stretched by its right handle',
            read: async () => (await stageShapes(window)).filter((sh) => sh.cls === 'Line')[0]?.scaleX ?? 0,
            settled: (scaleX) => scaleX > thin.scaleX + 0.1
          }
        }
      )
      expect(((await stageShapes(window)).filter((sh) => sh.cls === 'Line')[0]?.scaleX ?? 0) > thin.scaleX + 0.1).toBe(true)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a locked layer has no handles to resize or rotate it with; unlocking brings them back (T-124 (13))', async () => {
    // `draggable` honors the lock and the Transformer did not: a locked layer still resized and rotated by its handles.
    test.setTimeout(120_000)
    const studio = await openStudio('locked-handles')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Rect'])
      const row = layerRow(window, 'Rectangle')
      await row.getByRole('button', { name: 'Lock layer' }).click()
      await expect
        .poll(() => transformerClasses(window), { timeout: 10_000, message: 'a locked layer still has handles' })
        .toEqual([])
      const locked = await lastShape(window)
      expect(locked.draggable).toBe(false)
      // Nothing to grab: the anchors are not on the stage (a drag from just inside where the corner was moves nothing, and the
      // layer stays selected - the press is on the shape, not on the empty canvas).
      const g = await stageGeom(window)
      const corner = await toScreen(window, { x: 592, y: 492 })
      await dragTo(window, corner, { x: corner.x + 60 * g.scale, y: corner.y + 40 * g.scale })
      const after = await lastShape(window)
      expect(after.scaleX).toBe(locked.scaleX)
      expect(after.scaleY).toBe(locked.scaleY)
      expect(after.rotation).toBe(locked.rotation)
      expect(after.x).toBe(locked.x)
      // Unlock: the handles are back, on the same layer.
      await row.getByRole('button', { name: 'Unlock layer' }).click()
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Rect'])
    } finally {
      await closeStudio(studio)
    }
  })

  test('Snap quantizes a dragged picture the way it does a dragged shape, and a drag shorter than half a cell snaps back (T-124 (14))', async () => {
    // ImageNode.onDragEnd never called `snap()`: with Snap on a text layer landed on the grid and a picture at (115.2, 94.3).
    test.setTimeout(150_000)
    const studio = await openStudio('snap-picture')
    const { window } = studio
    try {
      await startBlank(window)
      const png = readFileSync(studio.fixturePng).toString('base64')
      await dropPng(window, png, 'logo.png')
      await expectLayerCount(window, 2)
      await expectShapeCount(window, 2)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByLabel('Snap', { exact: true }).check()
      const size = toolbar.getByLabel('Grid size in pixels')
      await retype(size, '50')
      await leave(size)
      await expect(size).toHaveValue('50')

      const g = await stageGeom(window)
      const imageNow = async (): Promise<ShapeInfo> => {
        const sh = (await stageShapes(window)).find((x) => x.cls === 'Image')
        if (!sh) throw new Error('no image node')
        return sh
      }
      const start = await imageNow() // placed at (60, 60), 64 x 48
      const from = await toScreen(window, { x: start.x + 32, y: start.y + 24 })
      // A drag of (+37, +23) doc px lands at (97, 83): grid 50 puts it at (100, 100).
      await dragTo(
        window,
        from,
        { x: from.x + 37 * g.scale, y: from.y + 23 * g.scale },
        { extent: { label: 'picture drag', read: async () => (await imageNow()).x, settled: (x) => x > start.x + 30 } }
      )
      await expect.poll(async () => (await imageNow()).x, { timeout: 10_000, message: 'the picture was not snapped' }).toBe(100)
      expect((await imageNow()).y).toBe(100)

      // A drag shorter than half a cell: the store's x does not change (snapped to where it was), and the node must not be left
      // where the pointer let go of it.
      const second = await toScreen(window, { x: 100 + 32, y: 100 + 24 })
      await dragTo(window, second, { x: second.x + 8 * g.scale, y: second.y + 6 * g.scale }, {
        extent: { label: 'picture nudge', read: async () => (await imageNow()).x, settled: (x) => x > 104 }
      })
      await expect.poll(async () => (await imageNow()).x, { timeout: 10_000, message: 'the node stayed where the pointer left it' }).toBe(100)
      expect((await imageNow()).y).toBe(100)
      // Properties says the same thing the stage does.
      await expect(field(window, 'x')).toHaveValue('100')
      await expect(field(window, 'y')).toHaveValue('100')
    } finally {
      await closeStudio(studio)
    }
  })

  test('the x, y and rotation boxes take a minus sign and keep what is typed (T-124 (15))', async () => {
    // `Number(e.target.value)` per keystroke: a number input reports "" for a lone "-", which became 0 and rewrote the box, so "-50"
    // was 50 and "-15" was +15.
    test.setTimeout(120_000)
    const studio = await openStudio('negative-numbers')
    const { window } = studio
    try {
      await startBlank(window)
      await layerRow(window, 'Text').click()
      const x = field(window, 'x')
      const y = field(window, 'y')
      const rotation = field(window, 'Rotation')
      const layerX = async (): Promise<number> => (await lastShape(window)).x

      await x.click()
      await x.press('Control+a')
      await x.press('Backspace')
      await expect(x, 'emptied: nothing snaps back into it').toHaveValue('')
      await x.pressSequentially('-')
      await x.pressSequentially('5')
      await expect(x).toHaveValue('-5')
      await x.pressSequentially('0')
      await expect(x, 'the minus sign survives the digits').toHaveValue('-50')
      expect(await layerX(), 'the layer is at -50, not 50').toBe(-50)
      await leave(x)
      await expect(x).toHaveValue('-50')
      expect(await layerX()).toBe(-50)

      await retype(y, '-30')
      await leave(y)
      await expect(y).toHaveValue('-30')
      expect((await lastShape(window)).y).toBe(-30)

      await retype(rotation, '-15')
      await expect(rotation).toHaveValue('-15')
      await leave(rotation)
      await expect(rotation).toHaveValue('-15')
      expect((await lastShape(window)).rotation).toBe(-15)

      // T-125 (8): a "-0" is a number in range, so it went straight to the layer and the box was swapped for the stored "0": the sign
      // was gone before the digits arrived, and "-0.5" was +0.5 (or 5). The box keeps what is typed while it has focus.
      await rotation.click()
      await rotation.press('Control+a')
      await rotation.press('Backspace')
      for (const [key, shown] of [['-', '-'], ['0', '-0'], ['.', '-0.'], ['5', '-0.5']] as const) {
        await rotation.pressSequentially(key)
        // A number input reports "" for an unfinished "-" or "-0."; the text on screen is what the person typed.
        if (shown === '-0.5') await expect(rotation, 'the sign and the point survive the digit').toHaveValue('-0.5')
      }
      expect((await lastShape(window)).rotation, 'the layer is at -0.5, not 0.5 and not 5').toBe(-0.5)
      await leave(rotation)
      await expect(rotation).toHaveValue('-0.5')
      expect((await lastShape(window)).rotation).toBe(-0.5)

      // The sanity bounds: far past the page is held to one page beyond each edge, and a turn past a full circle to 360.
      await retype(x, '999999')
      await leave(x)
      await expect(x).toHaveValue('2400')
      await retype(rotation, '720')
      await leave(rotation)
      await expect(rotation).toHaveValue('360')
      await retype(x, '-5000')
      await leave(x)
      await expect(x).toHaveValue('-1200')
      // An emptied box commits nothing: it shows what the layer has.
      await x.click()
      await x.press('Control+a')
      await x.press('Backspace')
      await leave(x)
      await expect(x).toHaveValue('-1200')
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — history', () => {
  test('undo and redo cross a draw and a delete, by button and by hotkey', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('undo')
    const { window } = studio
    try {
      await startBlank(window)
      const undo = window.getByRole('button', { name: 'Undo' })
      const redo = window.getByRole('button', { name: 'Redo' })
      await expect(redo).toBeDisabled()

      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 250, y: 250 }, { x: 550, y: 450 })
      await expectLayerCount(window, 2)
      await expect(undo).toBeEnabled()

      await layerRow(window, 'Text').getByRole('button', { name: 'Remove layer' }).click()
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(['Rectangle'])

      // ── buttons walk back through delete, then through the draw ──
      await undo.click()
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).toEqual(['Rectangle', 'Text'])
      await undo.click()
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(['Text'])
      await expect(redo).toBeEnabled()

      // ── Ctrl+Y walks forward again ──
      await window.keyboard.press('Control+y')
      await expectLayerCount(window, 2)
      expect((await lastShape(window)).cls).toBe('Rect')
      await window.keyboard.press('Control+y')
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(['Rectangle'])
      await expect(redo).toBeDisabled()

      // ── Ctrl+Z back, and Ctrl+Shift+Z forward ──
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 2)
      await window.keyboard.press('Control+Shift+z')
      await expectLayerCount(window, 1)

      // A new action after an undo drops the redo branch (canvasStore.ts:107).
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 2)
      await layerRow(window, 'Rectangle').getByRole('button', { name: 'Duplicate layer' }).click()
      await expectLayerCount(window, 3)
      await expect(redo).toBeDisabled()

      // Ctrl+Z inside a field is the FIELD's undo, never the canvas's
      // (useUndoRedoHotkeys' INPUT/TEXTAREA guard). The layer the duplicate
      // added must still be there afterwards.
      const name = field(window, 'Name')
      await name.fill('Renamed')
      expect(await layerNames(window)).toContain('Renamed')
      await name.press('Control+z')
      await expectLayerCount(window, 3)
      expect(await layerNames(window)).toEqual(
        expect.arrayContaining(['Rectangle', 'Text'])
      )
    } finally {
      await closeStudio(studio)
    }
  })
})
