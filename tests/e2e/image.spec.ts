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
import { ACCENT, BG_BASE, INK_BASE } from '../../src/renderer/src/styles/tokens'
import { READABLE_CONTRAST, surfacesUnder, worstContrast } from '../../src/shared/newText'
import { dragThrough, dragTo } from './drag'
import {
  DEFAULT_WINDOW,
  MIN_WINDOW,
  expectControlsWhole,
  expectInViewport,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  expectOneLine,
  setWindowSize as resizeAndSettle
} from './layout'
import { leave, retype } from './typing'
import { installToastLog, readToastEntries, readToastLog } from './toastLog'
import { ATOMIC_TMP, withoutAtomicTmp } from './atomicTmp'
import { heldRenameCount, holdAtomicRenames, releaseAtomicRenames } from './slowWrites'

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
 * 1. The Konva stage. `window.__imagiiStage` (Canvas.tsx:431) is the ledger's
 *    own hook. `stageShapes()` reads the document layer's children — class +
 *    attrs — which is the rendered end state of `doc.layers`: React re-renders
 *    every node from the store, so a value read back off a node is the value
 *    the store holds. Invisible layers render `null`, which is what makes the
 *    eye toggle assertable at the stage.
 *
 * 2. Mouse work is in DOC coordinates. The stage is scaled to fit its
 *    container (Canvas.tsx:184-193), so every screen point is computed from the
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

/**
 * File names currently in the save folder, sorted (a folder has no order to promise). T-139 (1): the FINISHED files - a save writes `<name>.<8 hex>.tmp` and
 * renames it over, so the folder holds the tmp for the length of the write, and a wait on a count (`waitForDownloads`) must not count it (`atomicTmp.ts`).
 */
function savedNames(studio: Studio): string[] {
  return withoutAtomicTmp(readdirSync(studio.downloadDir)).sort()
}

function clearDownloads(studio: Studio): void {
  // A write in flight is not ours to remove (its rename would then fail): only the finished files go.
  for (const name of withoutAtomicTmp(readdirSync(studio.downloadDir))) {
    rmSync(path.join(studio.downloadDir, name), { force: true })
  }
}

/**
 * The save folder as the OS lists it, tmp and all. Only for a test ABOUT the tmp (`atomicWrites.test.ts` lets this one name read the folder raw and nothing else):
 * a test that asks "which files are saved?" uses `savedNames`.
 */
function rawNames(studio: Studio): string[] {
  return readdirSync(studio.downloadDir)
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

      // The uppercase bindings are the same rows in ImageStudio.tsx:69-78.
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
      // The Line tool's layer is "Line" and the Pencil's is "Pencil" (canvasStore.ts:391; round 123 Track A: both used to be "Line").
      expect(await layerNames(window)).toEqual([
        'Pencil',
        'Line',
        'Ellipse',
        'Rectangle',
        'Rectangle',
        'Text'
      ])

      // ── a drag under the 4px floor commits nothing (Canvas.tsx:267) ──
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
      const size = toolbar.getByLabel('Grid size (px)')

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
      // (canvasStore rule read off Canvas.tsx:179-182). At the DEFAULT grid of
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
      const grid = toolbar.getByLabel('Grid size (px)')

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
      // The number fields are the store's own readout (PropertiesPanel.tsx:51).
      await expect(field(window, 'X (px)')).toHaveValue(String(Math.round(start.x)))
      await expect(field(window, 'Y (px)')).toHaveValue(String(Math.round(start.y)))

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
      await expect(field(window, 'X (px)')).toHaveValue(String(Math.round(dragged.x)))
      await expect(field(window, 'Y (px)')).toHaveValue(String(Math.round(dragged.y)))

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
      // Removing the selected layer clears the selection (canvasStore.ts:197).
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

      // A shape's panel (Fill, Stroke, Stroke (px)) at the same width, then both at the smallest window.
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
      await field(window, 'X (px)').fill('123')
      await field(window, 'Y (px)').fill('456')
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
      await field(window, 'Stroke (px)').fill('7')
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
      await expect(field(window, 'Stroke (px)')).toHaveCount(0)
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
      await expect(field(window, 'Stroke (px)')).toHaveCount(0)
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
      // Under the 800px cap, and on a document it fits, the fixture keeps its natural size (`placementFor`, called at ImportPanel.tsx:81).
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
      // T-140 (2): on the default 1200x800 page a new text layer is 60 px in from the corner, as a picture is (it was a fixed (120, 120)), at the 32 px it has always been.
      expect(text.x).toBe(60)
      expect(text.y).toBe(60)
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

// T-133 (2): react-hot-toast styles a toast's message `white-space: pre-line` in a 350 px card with no overflow-wrap, so a file name with no break
// opportunity (an underscores-only name, a hash) ran OUTSIDE the card in a real render, by as much as the name was long (81 px for one name, 228
// px for the 90-underscore one below). Six `Saved ${basename}` sites, T-132's "Extracted
// the sound from" and this panel's `Added ${file.name}` quote a name the person chose. The card's `overflow-wrap: anywhere` breaks it inside.
test.describe('Image Studio — a toast that quotes a long file name (T-133 (2))', () => {
  test('a name with no break in it wraps inside the toast card instead of running out of it', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('toast-wrap')
    const { window } = studio
    try {
      const png = readFileSync(studio.fixturePng).toString('base64')
      const name = `${'_'.repeat(90)}.png`
      await dropPng(window, png, name)
      // Measured as soon as the card is on screen (a success toast is gone in about 2 s): the message's box against its card's.
      const box = await window.evaluate(async () => {
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
          const message = document.querySelector('[data-rht-toaster] [role="status"]')
          const card = message?.parentElement
          if (message && card && (message.textContent ?? '').startsWith('Added ')) {
            const m = message.getBoundingClientRect()
            const c = card.getBoundingClientRect()
            return { text: message.textContent ?? '', mLeft: m.left, mRight: m.right, cLeft: c.left, cRight: c.right, cWidth: c.width }
          }
          await new Promise((r) => setTimeout(r, 20))
        }
        return null
      })
      expect(box, 'the toast was on screen').not.toBeNull()
      expect(box?.text).toBe(`Added ${name}`)
      expect(box?.mRight as number, `the text ends inside the card (card ${box?.cLeft}-${box?.cRight}, text ${box?.mLeft}-${box?.mRight})`).toBeLessThanOrEqual((box?.cRight as number) + 0.5)
      expect(box?.mLeft as number).toBeGreaterThanOrEqual((box?.cLeft as number) - 0.5)
      expect(box?.cWidth as number, 'and the card kept its 350 px ceiling').toBeLessThanOrEqual(351)
    } finally {
      await closeStudio(studio)
    }
  })
})

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
      // stage is a fit-to-container render (Canvas.tsx:184-193) and is NOT the
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
      // This doc sits at the 4x zoom cap (Canvas.tsx:193) — 112 document px
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
      const size = toolbar.getByLabel('Grid size (px)')
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
      await expect(field(window, 'X (px)')).toHaveValue('100')
      await expect(field(window, 'Y (px)')).toHaveValue('100')
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
      const x = field(window, 'X (px)')
      const y = field(window, 'Y (px)')
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

      // A new action after an undo drops the redo branch (canvasStore.ts:130).
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

// ── T-137 (6): a picture is stored as a bounded copy ─────────────────────────────────────────────────────────────────────────────────────
//
// ImportPanel kept every picture's full-size data URL in the document though the layer is drawn at most 800 px wide, so four 11 MB PNGs put a project
// over the 50 MiB size limit (executed: autosave stopped, Save wrote 56.9 MiB, Open refused it). The document keeps a copy bounded to a size that fits the
// document (T-138 (2): twice its longer side and never under 1600 px - this case runs on the default blank canvas, 1200x800, so the bound is 2400 px; the
// templates' are the next block's): PNG, which keeps transparency, unless the picture came as a JPEG, which stays one. A picture already within the bound is
// kept as it came. The Konva node's own `<img>` is the stored src, decoded.
test.describe('Image Studio — an imported picture is stored as a bounded copy (T-137 (6))', () => {
  /** A still made by the repo's own ffmpeg: `args` are the lavfi input and the codec options; `out` the file. */
  async function makeStill(out: string, lavfi: string, extra: string[] = []): Promise<void> {
    const result = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', lavfi, '-frames:v', '1', ...extra, out])
    if (result.code !== 0) throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }

  /** A `drop` carrying a File of `type` with REAL bytes (dropPng's shape, for a type other than PNG). */
  async function dropImage(window: Page, base64: string, fileName: string, type: string): Promise<void> {
    await window.evaluate(
      ({ base64, fileName, type }) => {
        const host = document.querySelector('[data-tutorial="image-import"]')
        if (!host) throw new Error('image import zone not found')
        const zone = host.classList.contains('card') ? host : host.querySelector('div.card')
        if (!zone) throw new Error('image drop zone not found')
        const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const file = new File([bin], fileName, { type })
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
        zone.dispatchEvent(event)
      },
      { base64, fileName, type }
    )
  }

  interface Stored {
    prefix: string
    naturalWidth: number
    naturalHeight: number
    drawnWidth: number
    drawnHeight: number
    /** The alpha of a pixel near the picture's top-left corner, read back from the stored copy. */
    cornerAlpha: number
    srcLength: number
  }

  /** The last picture on the canvas as the document stores it: the node's decoded `<img>` is the layer's `src`. */
  function lastStored(window: Page): Promise<Stored> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as
        | { children: Array<{ children: Array<{ attrs: { name?: string }; width(): number; height(): number; image(): HTMLImageElement }> }> }
        | undefined
      if (!stage) throw new Error('__imagiiStage is not set')
      const nodes = (stage.children[0]?.children ?? []).filter((n) => n.attrs.name !== 'background')
      const node = nodes[nodes.length - 1]
      if (!node) throw new Error('no picture on the canvas')
      const img = node.image()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(img, 0, 0)
      return {
        prefix: img.src.slice(0, img.src.indexOf(',')),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        drawnWidth: node.width(),
        drawnHeight: node.height(),
        cornerAlpha: ctx.getImageData(3, 3, 1, 1).data[3] ?? -1,
        srcLength: img.src.length
      }
    })
  }

  test('on the default 1200x800 canvas a 4000x3000 PNG is kept at 2400x1800 and drawn at 800x600; a JPEG stays a JPEG; a transparent PNG keeps its transparency; a small PNG is kept exactly as it came', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t137-bounded')
    const { window } = studio
    try {
      const big = path.join(studio.root, 'huge.png')
      const photo = path.join(studio.root, 'photo.jpg')
      const ghost = path.join(studio.root, 'ghost.png')
      await makeStill(big, 'testsrc2=size=4000x3000:rate=1')
      await makeStill(photo, 'testsrc2=size=3000x2000:rate=1', ['-q:v', '3'])
      // (3000x2000, not the 2400x1600 it was: that fits the 2400 px bound of this document and would be kept as it came, which is the control below.)
      await makeStill(ghost, 'color=c=0xFF0000@0.5:size=3000x2000:rate=1,format=rgba')

      // ── a 4000x3000 PNG ──
      await dropPng(window, readFileSync(big).toString('base64'), 'huge.png')
      await expectLayerCount(window, 1)
      await expectShapeCount(window, 1)
      const huge = await lastStored(window)
      expect(huge.prefix).toBe('data:image/png;base64')
      expect.soft({ w: huge.naturalWidth, h: huge.naturalHeight }, 'the stored copy, not the 4000 px file').toEqual({ w: 2400, h: 1800 })
      expect({ w: huge.drawnWidth, h: huge.drawnHeight }, 'the layer is still placed at 800 px').toEqual({ w: 800, h: 600 })
      expect.soft(huge.srcLength, 'and its bytes are the copy\'s (a 4000x3000 PNG\'s data URL is several times this)').toBeLessThan(readFileSync(big).length * 1.33)

      // ── a JPEG stays a JPEG (opaque, a tenth of the PNG's bytes) ──
      await dropImage(window, readFileSync(photo).toString('base64'), 'photo.jpg', 'image/jpeg')
      await expectLayerCount(window, 2)
      await expectShapeCount(window, 2)
      const jpeg = await lastStored(window)
      expect(jpeg.prefix).toBe('data:image/jpeg;base64')
      expect.soft({ w: jpeg.naturalWidth, h: jpeg.naturalHeight }, 'a JPEG is bounded too').toEqual({ w: 2400, h: 1600 })
      expect(jpeg.drawnWidth).toBe(800)
      expect(jpeg.cornerAlpha, 'a JPEG has no transparency to lose').toBe(255)

      // ── a PNG with a transparent picture keeps it: a JPEG copy would paint it black ──
      await dropPng(window, readFileSync(ghost).toString('base64'), 'ghost.png')
      await expectLayerCount(window, 3)
      await expectShapeCount(window, 3)
      const alpha = await lastStored(window)
      expect.soft(alpha.naturalWidth, 'and so is a transparent PNG').toBe(2400)
      expect(alpha.prefix, 'PNG, not JPEG').toBe('data:image/png;base64')
      expect.soft(alpha.naturalHeight).toBe(1600)
      expect(alpha.cornerAlpha, 'half transparent, as it was dropped').toBeGreaterThan(100)
      expect(alpha.cornerAlpha).toBeLessThan(155)

      // ── control: a picture already within the bound is kept exactly as it came ──
      const small = readFileSync(studio.fixturePng).toString('base64')
      await dropPng(window, small, 'small.png')
      await expectLayerCount(window, 4)
      await expectShapeCount(window, 4)
      const kept = await lastStored(window)
      expect(kept.naturalWidth).toBe(FIXTURE_PNG_W)
      expect(kept.srcLength).toBe(`data:image/png;base64,${small}`.length)
      expect({ w: kept.drawnWidth, h: kept.drawnHeight }).toEqual({ w: FIXTURE_PNG_W, h: FIXTURE_PNG_H })
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-138 (2): the stored copy is sized to the document the picture is placed on ─────────────────────────────────────────────────────────────
//
// The copy was bounded to a fixed 1600 px though a layer is freely resizable and the templates are 1280 to 3840 px documents: a 1920x1080 frame (or a 4K
// background) enlarged to fill a 1920 / 2560 / 3840 px overlay exported 1.2x to 2.4x upscaled, worse at the HiDPI 2x default, and importing the file again
// bounded it again. The bound is twice the document's longer side (what a picture that fills the document is exported at in a default HiDPI export) and never
// under 1600 px; a picture within it is kept as it came. The picture is still PLACED at most 800 px wide, whatever the document.
test.describe('Image Studio — a stored picture is sized to the document it is placed on (T-138 (2))', () => {
  async function makeStillPng(out: string, size: string): Promise<void> {
    const result = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=1`, '-frames:v', '1', out])
    if (result.code !== 0) throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }

  interface PlacedPicture {
    naturalWidth: number
    naturalHeight: number
    drawnWidth: number
    drawnHeight: number
  }

  /** Every picture on the canvas, bottom to top: the node's decoded `<img>` is the layer's stored `src`, and the node's own size is where it was placed. */
  function pictures(window: Page): Promise<PlacedPicture[]> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as
        | { children: Array<{ children: Array<{ attrs: { name?: string }; width(): number; height(): number; image?: () => HTMLImageElement }> }> }
        | undefined
      if (!stage) throw new Error('__imagiiStage is not set')
      return (stage.children[0]?.children ?? [])
        .filter((n) => n.attrs.name !== 'background' && typeof n.image === 'function')
        .map((n) => {
          const img = (n.image as () => HTMLImageElement)()
          return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, drawnWidth: Math.round(n.width()), drawnHeight: Math.round(n.height()) }
        })
    })
  }

  test('on the 1920x1080 overlay a 1920x1080 picture is kept whole and a 4000x3000 one is stored at 3840x2880; both are still placed at 800 px', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t138-overlay')
    const { window } = studio
    try {
      const frame = path.join(studio.root, 'frame.png')
      const huge = path.join(studio.root, 'huge.png')
      await makeStillPng(frame, '1920x1080')
      await makeStillPng(huge, '4000x3000')
      const overlay = templateById('tw-overlay-streamer')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)
      expect(overlay.doc.width, 'the document these numbers are for').toBe(1920)

      await dropPng(window, readFileSync(frame).toString('base64'), 'frame.png')
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(1)
      await dropPng(window, readFileSync(huge).toString('base64'), 'huge.png')
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(2)

      const [kept, bounded] = await pictures(window)
      expect.soft({ w: kept?.naturalWidth, h: kept?.naturalHeight }, 'a full-HD frame on a full-HD document is stored as it came, not at 1600x900').toEqual({ w: 1920, h: 1080 })
      expect.soft({ w: bounded?.naturalWidth, h: bounded?.naturalHeight }, 'a 4000x3000 picture is stored at twice the overlay\'s width, not at 1600x1200').toEqual({ w: 3840, h: 2880 })
      expect({ w: kept?.drawnWidth, h: kept?.drawnHeight }, 'placed at 800 px wide, as before').toEqual({ w: 800, h: 450 })
      expect({ w: bounded?.drawnWidth, h: bounded?.drawnHeight }).toEqual({ w: 800, h: 600 })
    } finally {
      await closeStudio(studio)
    }
  })

  test('on the 1280x720 thumbnail the same 4000x3000 picture is stored at 2560x1920, and a 1920x1080 one, inside that, is kept whole', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t138-thumb')
    const { window } = studio
    try {
      const frame = path.join(studio.root, 'frame.png')
      const huge = path.join(studio.root, 'huge.png')
      await makeStillPng(frame, '1920x1080')
      await makeStillPng(huge, '4000x3000')
      const thumbnail = templateById('yt-thumb-bold')
      await templateCard(window, thumbnail).click()
      await expectTemplateApplied(window, thumbnail)
      expect(thumbnail.doc.width, 'the document these numbers are for').toBe(1280)

      await dropPng(window, readFileSync(huge).toString('base64'), 'huge.png')
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(1)
      await dropPng(window, readFileSync(frame).toString('base64'), 'frame.png')
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(2)

      const [bounded, kept] = await pictures(window)
      expect.soft({ w: bounded?.naturalWidth, h: bounded?.naturalHeight }, 'the bound follows the document: 2 x 1280').toEqual({ w: 2560, h: 1920 })
      expect.soft({ w: kept?.naturalWidth, h: kept?.naturalHeight }, 'inside the bound: kept as it came').toEqual({ w: 1920, h: 1080 })
      expect({ w: bounded?.drawnWidth, h: bounded?.drawnHeight }).toEqual({ w: 800, h: 600 })
    } finally {
      await closeStudio(studio)
    }
  })

  test('a paste and a chosen file are sized to the document that is open when the picture lands, not the one the studio opened with', async () => {
    test.setTimeout(240_000)
    // The paste listener is registered when the panel mounts (empty canvas, the default 1200x800), long before a template is picked: a bound read from what the panel
    // saw at mount would be 2400 there. The 1920x1080 overlay is what is open when these land.
    const studio = await openStudio('t138-paths')
    const { window } = studio
    try {
      const huge = path.join(studio.root, 'huge.png')
      await makeStillPng(huge, '4000x3000')
      const overlay = templateById('tw-overlay-streamer')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)

      // ── paste: a REAL image on Electron's clipboard + a real Ctrl+V ──
      await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
        clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
      }, `data:image/png;base64,${readFileSync(huge).toString('base64')}`)
      await window.keyboard.press('Control+v')
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(1)

      // ── + Import image: the real <input type=file> click path ──
      const chooserPromise = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await (await chooserPromise).setFiles(huge)
      await expect.poll(async () => (await pictures(window)).length, { timeout: 30_000 }).toBe(2)

      const [pasted, chosen] = await pictures(window)
      expect.soft({ w: pasted?.naturalWidth, h: pasted?.naturalHeight }, 'the pasted picture: twice the overlay\'s width').toEqual({ w: 3840, h: 2880 })
      expect.soft({ w: chosen?.naturalWidth, h: chosen?.naturalHeight }, 'the chosen file: the same').toEqual({ w: 3840, h: 2880 })
    } finally {
      await closeStudio(studio)
    }
  })
})


// ── T-139 (2): the first placement of a picture is wholly on the canvas it lands on ──────────────────────────────────────────────────────────
//
// A picture was placed at min(its size, 800 px) at (60, 60) whatever the document: a 512x512 file on the 112x112 emote showed a 52 px corner of itself, every other
// handle was off the stage, and there is no size field to bring it back (executed). The drawn size is now also bounded by the document and the position kept inside
// it (`placementFor`), for a drop, the file chooser, a paste and "-> Canvas" (references.spec.ts); a template's own layers are untouched. The Konva node's own
// attributes are the placed layer: `x`, `y`, `width`, `height` (a first placement has scale 1).
test.describe('Image Studio — a picture is first placed wholly on the canvas it lands on (T-139 (2))', () => {
  async function makeStillPng(out: string, size: string): Promise<void> {
    const result = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=1`, '-frames:v', '1', out])
    if (result.code !== 0) throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }

  interface Box {
    x: number
    y: number
    width: number
    height: number
  }

  /** Every picture on the stage, bottom to top, as the node is drawn (position, and size times scale). */
  async function pictureBoxes(window: Page): Promise<Box[]> {
    return (await stageShapes(window))
      .filter((s) => s.cls === 'Image')
      .map((s) => ({ x: s.x, y: s.y, width: (s.width ?? 0) * s.scaleX, height: (s.height ?? 0) * s.scaleY }))
  }

  /** The Nth picture's box once the stage has drawn `count` of them. */
  async function boxAfter(window: Page, count: number): Promise<Box> {
    await expect.poll(async () => (await pictureBoxes(window)).length, { timeout: 30_000, intervals: [100] }).toBe(count)
    const boxes = await pictureBoxes(window)
    return boxes[count - 1] as Box
  }

  function expectWhollyOn(box: Box, doc: { width: number; height: number }, what: string): void {
    expect.soft(box.x, `${what}: left edge on the canvas`).toBeGreaterThanOrEqual(0)
    expect.soft(box.y, `${what}: top edge on the canvas`).toBeGreaterThanOrEqual(0)
    expect.soft(box.x + box.width, `${what}: right edge on the canvas (${JSON.stringify(box)})`).toBeLessThanOrEqual(doc.width + 0.01)
    expect.soft(box.y + box.height, `${what}: bottom edge on the canvas (${JSON.stringify(box)})`).toBeLessThanOrEqual(doc.height + 0.01)
  }

  function expectBox(box: Box, want: Box, what: string): void {
    expect.soft(box.x, `${what}: x`).toBeCloseTo(want.x, 1)
    expect.soft(box.y, `${what}: y`).toBeCloseTo(want.y, 1)
    expect.soft(box.width, `${what}: width`).toBeCloseTo(want.width, 1)
    expect.soft(box.height, `${what}: height`).toBeCloseTo(want.height, 1)
  }

  test('on the 112x112 emote a dropped 512x512 picture, a chosen 300x900 one and a pasted 512x256 one each land wholly on the canvas', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t139-emote')
    const { window } = studio
    try {
      const square = path.join(studio.root, 'square.png')
      const tall = path.join(studio.root, 'tall.png')
      const wide = path.join(studio.root, 'wide.png')
      await makeStillPng(square, '512x512')
      await makeStillPng(tall, '300x900')
      await makeStillPng(wide, '512x256')
      const emote = templateById('emote-blank-112')
      await templateCard(window, emote).click()
      await expectTemplateApplied(window, emote)
      expect(emote.doc.width, 'the document these numbers are for').toBe(112)
      const doc = emote.doc

      // ── a drop: the whole emote, not a 52 px corner of a 512 px square ──
      await dropPng(window, readFileSync(square).toString('base64'), 'square.png')
      expectBox(await boxAfter(window, 1), { x: 0, y: 0, width: 112, height: 112 }, 'a dropped 512x512')
      expectWhollyOn((await pictureBoxes(window))[0] as Box, doc, 'a dropped 512x512')

      // ── + Import image: the real <input type=file> click path; a tall picture is as tall as the emote and still 60 px in ──
      const chooserPromise = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await (await chooserPromise).setFiles(tall)
      const chosen = await boxAfter(window, 2)
      expectBox(chosen, { x: 60, y: 0, width: 112 / 3, height: 112 }, 'a chosen 300x900')
      expectWhollyOn(chosen, doc, 'a chosen 300x900')

      // ── paste: a REAL image on Electron's clipboard + a real Ctrl+V; a wide picture is as wide as the emote and sits as low as it can ──
      await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
        clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
      }, `data:image/png;base64,${readFileSync(wide).toString('base64')}`)
      await window.keyboard.press('Control+v')
      const pasted = await boxAfter(window, 3)
      expectBox(pasted, { x: 0, y: 56, width: 112, height: 56 }, 'a pasted 512x256')
      expectWhollyOn(pasted, doc, 'a pasted 512x256')
    } finally {
      await closeStudio(studio)
    }
  })

  test('on the 1200x480 banner a tall 400x1600 picture is as tall as the banner (120x480) and wholly inside it', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t139-banner')
    const { window } = studio
    try {
      const tall = path.join(studio.root, 'tall.png')
      await makeStillPng(tall, '400x1600')
      const banner = templateById('tw-banner-videoplayer')
      await templateCard(window, banner).click()
      await expectTemplateApplied(window, banner)
      expect({ w: banner.doc.width, h: banner.doc.height }, 'the document these numbers are for').toEqual({ w: 1200, h: 480 })

      await dropPng(window, readFileSync(tall).toString('base64'), 'tall.png')
      const box = await boxAfter(window, 1)
      expectBox(box, { x: 60, y: 0, width: 120, height: 480 }, 'a dropped 400x1600')
      expectWhollyOn(box, banner.doc, 'a dropped 400x1600')
    } finally {
      await closeStudio(studio)
    }
  })

  test('on the 1920x1080 overlay the placement is what it was: 800 px on the long side, 60 px in from the corner', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t139-overlay')
    const { window } = studio
    try {
      const frame = path.join(studio.root, 'frame.png')
      const huge = path.join(studio.root, 'huge.png')
      const exact = path.join(studio.root, 'exact.png')
      await makeStillPng(frame, '1920x1080')
      await makeStillPng(huge, '4000x3000')
      await makeStillPng(exact, '800x600')
      const overlay = templateById('tw-overlay-streamer')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)
      expect(overlay.doc.width, 'the document these numbers are for').toBe(1920)

      await dropPng(window, readFileSync(exact).toString('base64'), 'exact.png')
      expectBox(await boxAfter(window, 1), { x: 60, y: 60, width: 800, height: 600 }, 'an 800x600 picture')
      await dropPng(window, readFileSync(frame).toString('base64'), 'frame.png')
      expectBox(await boxAfter(window, 2), { x: 60, y: 60, width: 800, height: 450 }, 'a 1920x1080 picture')
      await dropPng(window, readFileSync(huge).toString('base64'), 'huge.png')
      expectBox(await boxAfter(window, 3), { x: 60, y: 60, width: 800, height: 600 }, 'a 4000x3000 picture')
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-139 (4): a byte budget for the copy the document keeps ────────────────────────────────────────────────────────────────────────────────
//
// T-138 (2) bounded the stored copy's PIXELS, not its bytes, and re-encoded only a JPEG source as a JPEG: a 9000x6000 PNG on the 4K overlay became a 54 MB data URL and
// paused autosave at once, on a project of one picture (executed). The copy now has a budget (`STORED_IMAGE_MAX_BYTES`, 16 MiB of data URL): over it, an opaque picture
// is a JPEG at the same bound, and a copy still over (or a transparent one) steps the bound down by a quarter until it fits; a picture within the pixel bound is
// re-encoded too when its FILE is over the budget. The pictures here are noise (a 4000x3000 PNG of it is 35 MB, 47 MB as a data URL), which no encoder shrinks by
// much; two of them are 101 MB of project on the unchanged build, which is over the 50 MiB limit.
test.describe('Image Studio — an incompressible picture is stored within the byte budget (T-139 (4))', () => {
  /** `STORED_IMAGE_MAX_BYTES` in src/shared/imageBounds.ts (docClaims.test.ts holds the two together: a spec that imports it cannot load on the build it is proven red against). */
  const STORED_IMAGE_MAX_BYTES = 16 * 1024 * 1024

  /** A 4000x3000 PNG of uniform noise (compression level 1: it does not shrink anyway). `transparentCorner` makes a 100x100 corner fully transparent. */
  async function makeNoisePng(out: string, transparentCorner: boolean): Promise<void> {
    const noise = 'color=c=gray:s=4000x3000:r=1,noise=alls=100:allf=u'
    const graph = transparentCorner
      ? `${noise},format=rgba[n];color=c=white:s=4000x3000:r=1,drawbox=x=0:y=0:w=100:h=100:color=black:t=fill,format=gray[m];[n][m]alphamerge`
      : `${noise},format=rgb24`
    const result = await runBinary(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', graph, '-frames:v', '1', '-compression_level', '1', out])
    if (result.code !== 0) throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }

  interface Kept {
    prefix: string
    naturalWidth: number
    srcLength: number
    /** The alpha of a pixel near the picture's top-left corner, read back from the stored copy. */
    cornerAlpha: number
  }

  /** The pictures on the canvas as the document stores them: the node's decoded `<img>` is the layer's `src`. */
  function keptPictures(window: Page): Promise<Kept[]> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as
        | { children: Array<{ children: Array<{ attrs: { name?: string }; getClassName(): string; image?: () => HTMLImageElement }> }> }
        | undefined
      if (!stage) return []
      return (stage.children[0]?.children ?? [])
        .filter((n) => n.attrs.name !== 'background' && n.getClassName() === 'Image' && n.image)
        .map((n) => {
          const img = (n.image as () => HTMLImageElement)()
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0)
          return {
            prefix: img.src.slice(0, img.src.indexOf(',')),
            naturalWidth: img.naturalWidth,
            srcLength: img.src.length,
            cornerAlpha: ctx?.getImageData(3, 3, 1, 1).data[3] ?? -1
          }
        })
    })
  }

  /** The image layers in the autosave file on disk, or null while there is none (main writes it whole: a temp file, then a rename). */
  function autosavedPictures(userDataDir: string): number | null {
    const file = path.join(userDataDir, 'autosave', 'autosave.json')
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { imageCanvas?: { doc?: { layers?: Array<{ type?: string }> } } }
      return (parsed.imageCanvas?.doc?.layers ?? []).filter((l) => l.type === 'image').length
    } catch {
      return null
    }
  }

  test('a 4000x3000 noise PNG on the 4K overlay is stored as a JPEG under the budget, a transparent one stays a PNG stepped down under it, and autosave is never paused', async () => {
    test.setTimeout(480_000)
    const studio = await openStudio('t139-budget')
    const { window } = studio
    try {
      const noise = path.join(studio.root, 'noise.png')
      const ghost = path.join(studio.root, 'ghost.png')
      await makeNoisePng(noise, false)
      await makeNoisePng(ghost, true)
      expect(readFileSync(noise).length * (4 / 3), 'the fixture really is over the budget as a data URL (the premise)').toBeGreaterThan(STORED_IMAGE_MAX_BYTES)
      const overlay = templateById('tw-overlay-streamer-4k')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)
      expect(overlay.doc.width, 'the document these numbers are for').toBe(3840)

      // ── the opaque picture, through the real chooser ──
      let chooserPromise = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await (await chooserPromise).setFiles(noise)
      await expect.poll(async () => (await keptPictures(window)).length, { timeout: 120_000, intervals: [250] }).toBe(1)
      const [opaque] = await keptPictures(window)
      expect.soft(opaque?.srcLength, 'the stored copy fits the budget').toBeLessThanOrEqual(STORED_IMAGE_MAX_BYTES)
      expect.soft(opaque?.prefix, 'an opaque picture over the budget is a JPEG').toBe('data:image/jpeg;base64')
      // (A JPEG of this noise at the file's own size fits: the step-down is the transparent picture's below, and chooseStoredCopy's unit cases.)
      expect.soft(opaque?.naturalWidth, 'never larger than the file').toBeLessThanOrEqual(4000)

      // ── the transparent one: PNG, because a JPEG would paint the transparent corner black ──
      chooserPromise = window.waitForEvent('filechooser', { timeout: 15_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await (await chooserPromise).setFiles(ghost)
      await expect.poll(async () => (await keptPictures(window)).length, { timeout: 180_000, intervals: [250] }).toBe(2)
      const [, transparent] = await keptPictures(window)
      expect.soft(transparent?.srcLength, 'the stored copy fits the budget').toBeLessThanOrEqual(STORED_IMAGE_MAX_BYTES)
      expect.soft(transparent?.prefix, 'a transparent picture stays a PNG').toBe('data:image/png;base64')
      expect.soft(transparent?.naturalWidth, 'and the bound stepped down until it fitted').toBeLessThan(4000)
      test.info().annotations.push({ type: 'stored copies', description: `opaque ${opaque?.naturalWidth}px ${opaque?.srcLength} chars; transparent ${transparent?.naturalWidth}px ${transparent?.srcLength} chars` })
      expect(transparent?.cornerAlpha, 'its transparent corner is still transparent').toBe(0)

      // ── autosave runs: the project (two copies under the budget, 32 MiB at the most) is written; on the unchanged build it is 101 MB and is never ──
      await expect
        .poll(() => autosavedPictures(path.join(studio.root, 'userData')), { timeout: 90_000, intervals: [500], message: 'autosave wrote the project with both pictures' })
        .toBe(2)
      await window.waitForTimeout(3000)
      expect((await readToastLog(window)).filter((t) => /^Autosave is paused/.test(t)), 'and it never said it was paused').toEqual([])
    } finally {
      await closeStudio(studio)
    }
  })
})
// T-139 (1): the save is a tmp and a rename now, so the folder a test lists can hold the tmp. The full run of Track A's first landing failed once on exactly this
// ("the document background lands in the bytes": `waitForDownloads` polls a COUNT of names, saw 1 while that one was the tmp, then read the name it had counted
// and the rename had taken it). This holds the rename so the tmp is in the folder for as long as the test wants, and asks the helpers the questions that race asks.
test.describe('Image Studio — a save in flight leaves a tmp in the folder (T-139 (1))', () => {
  test('Export PNG: while the rename is held the folder holds the tmp and the helpers see NO saved file; once it lands they see exactly one, whole', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t139-tmp-png')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')

      await holdAtomicRenames(studio.app)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()

      // The window is really open: the writer's tmp is in the folder, and the rename is parked at the gate.
      await expect
        .poll(() => rawNames(studio).filter((n) => ATOMIC_TMP.test(n)), { timeout: 30_000, intervals: [100] })
        .toHaveLength(1)
      expect(await heldRenameCount(studio.app)).toBe(1)
      const raw = rawNames(studio)
      expect(raw).toHaveLength(1)
      expect(raw[0]).toMatch(/^imagii-\d+\.png\.[0-9a-f]{8}\.tmp$/)

      // What a test is asking when it lists the folder is "which files has the save finished?": none yet.
      expect(savedNames(studio), 'the tmp is not a saved file').toEqual([])
      // …and the wait for the first file does not come back on the tmp's account (it used to: the count was 1).
      let returned = false
      const waiting = waitForDownloads(studio, 1).then((files) => {
        returned = true
        return files
      })
      await new Promise((resolve) => setTimeout(resolve, 800))
      expect(returned, 'waitForDownloads(1) did not count the tmp').toBe(false)
      expect(await readToastLog(window), 'and the app has not said "saved": the write is not done').toEqual([])

      await releaseAtomicRenames(studio.app)
      const [png] = await waiting
      expect(pngSize(png as Buffer)).toEqual({ w: 1280, h: 720 })
      expect(savedNames(studio)).toHaveLength(1)
      expect(savedNames(studio)[0]).toMatch(/^imagii-\d+\.png$/)
      expect(rawNames(studio), 'the folder holds the file and nothing else: no tmp is left').toEqual(savedNames(studio))
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('PNG saved')
    } finally {
      await closeStudio(studio)
    }
  })

  test('Emote pack: the tmp of the file being written is not one of the three, and the three are whole when the wait returns', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t139-tmp-pack')
    const { window } = studio
    try {
      const t = templateById('emote-blank-112')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const exportPanel = window.locator(EXPORT)

      await holdAtomicRenames(studio.app)
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      await expect
        .poll(() => rawNames(studio).filter((n) => ATOMIC_TMP.test(n)), { timeout: 30_000, intervals: [100] })
        .toHaveLength(1)
      // The pack writes its files one after another, so only the FIRST is in flight; none is finished.
      expect(savedNames(studio)).toEqual([])
      expect(rawNames(studio)).toHaveLength(1)

      await releaseAtomicRenames(studio.app)
      const files = await waitForDownloads(studio, 3)
      expect(files).toHaveLength(3)
      for (const bytes of files) expect(bytes.subarray(0, 8).toString('hex'), 'each is a whole PNG, starting with the signature').toBe('89504e470d0a1a0a')
      expect(rawNames(studio).filter((n) => ATOMIC_TMP.test(n)), 'no tmp is left').toEqual([])
      expect(savedNames(studio).map((n) => n.replace(/\d{10,}/, 'STAMP')).sort()).toEqual([
        'imagii-emote-112-STAMP.png',
        'imagii-emote-28-STAMP.png',
        'imagii-emote-56-STAMP.png'
      ])
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-140 (2): "+ Add text" on the document that is open ───────────────────────────────────────────────────────────────────────────────────
//
// `addLayer(makeTextLayer(120, 120))` put 32 px text in `BG_BASE` (#120c0c) at a fixed point whatever the document: on the 112x112 emote it started at (120, 120), wholly
// off the canvas (selected and invisible); every template background is #120c0c, #241614 or transparent, so the text was 1.00 to 1.11:1 against it; on a 3840 px overlay it
// was a speck. The layer is now sized to the document, placed inside it by the rule a picture follows, and inked against what the document shows (`textLayerFor`).
test.describe('Image Studio — "+ Add text" lands wholly on the document and can be read against it (T-140 (2))', () => {
  /** WCAG 2 contrast between two #rrggbb colors, written out here and not imported: the case must load on the unchanged build, and it must not use the rule it checks. */
  function contrastOf(a: string, b: string): number {
    const lum = (hex: string): number => {
      const { r, g, b: blue } = hexRgb(hex)
      const lin = (c: number): number => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue)
    }
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return ((hi as number) + 0.05) / ((lo as number) + 0.05)
  }

  interface TextBox {
    x: number
    y: number
    width: number
    height: number
    fill: string
    fontSize: number
  }

  /** The newest Text node on the stage: its box in DOCUMENT units (as drawn, with the stage's zoom taken out), its color and its size. */
  function newestText(window: Page): Promise<TextBox> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        children: Array<{
          find(sel: string): Array<{
            getClientRect(o: { relativeTo: unknown }): { x: number; y: number; width: number; height: number }
            fill(): string
            fontSize(): number
          }>
        }>
      }
      const layer = stage.children[0]
      const texts = layer ? layer.find('Text') : []
      const t = texts[texts.length - 1]
      if (!layer || !t) throw new Error('no Text node on the stage')
      const r = t.getClientRect({ relativeTo: layer })
      return { x: r.x, y: r.y, width: r.width, height: r.height, fill: t.fill(), fontSize: t.fontSize() }
    })
  }

  function expectInsideDocument(box: TextBox, doc: { width: number; height: number }, what: string): void {
    expect.soft(box.x, `${what}: left edge on the document (${JSON.stringify(box)})`).toBeGreaterThanOrEqual(-0.01)
    expect.soft(box.y, `${what}: top edge on the document (${JSON.stringify(box)})`).toBeGreaterThanOrEqual(-0.01)
    expect.soft(box.x + box.width, `${what}: right edge on the document (${JSON.stringify(box)})`).toBeLessThanOrEqual(doc.width + 0.01)
    expect.soft(box.y + box.height, `${what}: bottom edge on the document (${JSON.stringify(box)})`).toBeLessThanOrEqual(doc.height + 0.01)
  }

  test('on the emote, the dark thumbnails, the banner and the 4K overlay the new word is wholly inside the document, a token ink, and not a speck (what it is read against is held on rendered pixels by T-141 (2) below)', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t140-text')
    const { window } = studio
    try {
      const ids = ['emote-blank-112', 'yt-thumb-bold', 'yt-thumb-clean', 'tw-banner-videoplayer', 'tw-overlay-streamer-4k']
      const dialog = window.locator('[role="dialog"]')
      for (const [i, id] of ids.entries()) {
        const t = templateById(id)
        if (i === 0) {
          await templateCard(window, t).click()
        } else {
          await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
          await dialog.locator('button.card').filter({ has: window.getByText(t.name, { exact: true }) }).click()
          await expect(dialog).toHaveCount(0)
        }
        await expectTemplateApplied(window, t)

        await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
        await expectLayerCount(window, t.doc.layers.length + 1)
        const box = await newestText(window)
        const what = `${t.name} (${t.doc.width}x${t.doc.height}, ${t.doc.background})`
        expectInsideDocument(box, t.doc, what)
        // T-141 (2): this case held the ink to the DOCUMENT's background (a transparent one is the dark workspace behind it), which is the premise that was wrong: on the emote the word
        // sits on a disc, and the light ink that suited the document was 2.9:1 on it. What the ink must clear is what is drawn UNDER the word, measured on rendered pixels for every
        // template in "'+ Add text' is readable against what is drawn under it" below; here the ink is one of the two tokens the rule chooses between.
        expect.soft([BG_BASE, INK_BASE].map((c) => c.toLowerCase()), `${what}: a token ink`).toContain(box.fill.toLowerCase())
        // Readable: not a speck beside the document (a 32 px line on 2160 px is 1.5% of its height).
        expect.soft(box.fontSize, `${what}: the size grows with the document`).toBeGreaterThanOrEqual(t.doc.height / 60)
        if (id === 'tw-overlay-streamer-4k') expect.soft(box.fontSize, `${what}: more than the 32 px it was`).toBeGreaterThan(32)
        if (id === 'emote-blank-112') {
          // The word is in the emote with room to spare, and the Transformer has it (the selected layer is the new one).
          expect.soft(box.width, `${what}: a word that fits the 112 px canvas`).toBeLessThan(112 / 2)
          await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Text'])
        }
      }
    } finally {
      await closeStudio(studio)
    }
  })

  test('on the blank white page the new word keeps its dark ink, 32 px, 60 px in from the corner; both "Start with text" and "+ Add text"', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t140-text-blank')
    const { window } = studio
    try {
      const doc = { width: 1200, height: 800 }
      await window.getByRole('button', { name: 'Start with text' }).click()
      await expectLayerCount(window, 1)
      await expect(window.getByText(`${doc.width} × ${doc.height}`)).toBeVisible()
      const first = await newestText(window)
      expectInsideDocument(first, doc, 'Start with text')
      expect(first.fill.toLowerCase(), 'the ink is the near-black token').toBe(BG_BASE.toLowerCase())
      expect(contrastOf(first.fill, '#ffffff'), 'against white').toBeGreaterThanOrEqual(4.5)
      expect(first.fontSize).toBe(32)
      expect([first.x, first.y], 'the corner rule a picture follows').toEqual([60, 60])

      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 2)
      const second = await newestText(window)
      expect(second.fill.toLowerCase()).toBe(BG_BASE.toLowerCase())
      // T-141 (2): the first word is drawn at (60, 60) and a second one exactly on it is unreadable (dark letters on dark letters), so it takes the next place the rule tries - the same margin
      // in from the top-right corner - and is still 32 px, in the dark ink, wholly on the page.
      expect(second.fontSize).toBe(32)
      expect(second.x, 'beside the first word, not on it').toBeGreaterThan(first.x + first.width)
      expectInsideDocument(second, doc, 'the second word')
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-140 (3): a corner drag keeps a picture's proportions ─────────────────────────────────────────────────────────────────────────────────
//
// `keepRatio={false}` for every layer: dragging a picture's corner distorted it, the distortion was exported (scaleX / scaleY are stored) and Shift, Konva's key for the other
// behavior, was documented nowhere. A picture and a word have proportions of their own (a stretched logo, stretched glyphs); a rectangle's, ellipse's or line's width and height
// are the point of resizing it. So a corner drag keeps the ratio of a picture and of text, and Shift frees it (`shiftBehavior="inverted"`); a shape's corner drag stretches, and
// Shift keeps ITS ratio (Konva's own default, unchanged). Side handles stretch every layer, as they always did.
test.describe('Image Studio — a corner drag keeps a picture\'s and a word\'s proportions; Shift frees them; a shape still stretches (T-140 (3))', () => {
  async function makeFlatPng(out: string, size: string): Promise<void> {
    const result = await runBinary(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `color=c=red:s=${size}`, '-frames:v', '1', out])
    if (result.code !== 0) throw new Error(`fixture ffmpeg exit ${result.code}: ${result.stderr.slice(-800)}`)
  }

  /** The size of the red box in an exported PNG: the picture as the file shows it (a red pixel is r > 200, g < 60, b < 60; the page is white). */
  async function redSize(studio: Studio, bytes: Buffer): Promise<{ w: number; h: number }> {
    const { w, h } = pngSize(bytes)
    const source = path.join(studio.root, 'red-bounds.png')
    const raw = path.join(studio.root, 'red-bounds.raw')
    writeFileSync(source, bytes)
    const result = await runBinary(ffmpegPath, ['-y', '-i', source, '-vf', 'format=rgba', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw])
    if (result.code !== 0) throw new Error(`red-bounds probe exit ${result.code}: ${result.stderr.slice(-800)}`)
    const px = readFileSync(raw)
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if ((px[i] as number) > 200 && (px[i + 1] as number) < 60 && (px[i + 2] as number) < 60) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) throw new Error('no red pixel in the export')
    return { w: maxX - minX + 1, h: maxY - minY + 1 }
  }

  /**
   * The newest layer's scale of this Konva class, as the node has it - and for a word, its DRAWN scale against the 32 px it started at: T-141 (6) folds a resize into the font size, so a
   * word's node scale is 1 after a drag and the size is what carries it (a word dragged to 1.4x is 45 px at scale 1, and 45 / 32 is the 1.4 this case has always read).
   */
  async function scaleOf(window: Page, cls: string): Promise<{ x: number; y: number }> {
    const shapes = (await stageShapes(window)).filter((sh) => sh.cls === cls)
    const last = shapes[shapes.length - 1]
    if (!last) throw new Error(`no ${cls} on the stage`)
    const drawnAgainstStart = cls === 'Text' ? (last.fontSize ?? 32) / 32 : 1
    return { x: last.scaleX * drawnAgainstStart, y: last.scaleY * drawnAgainstStart }
  }

  /** A real drag of the bottom-right corner handle by (dx, dy) document px, with Shift held for the whole gesture when asked. */
  async function dragCorner(window: Page, cls: string, by: Point, shift = false): Promise<void> {
    const before = await scaleOf(window, cls)
    const g = await stageGeom(window)
    const anchor = await anchorPoint(window, 'bottom-right')
    if (shift) await window.keyboard.down('Shift')
    try {
      await dragTo(window, anchor, { x: anchor.x + by.x * g.scale, y: anchor.y + by.y * g.scale }, {
        extent: {
          label: `${cls} corner drag by ${by.x},${by.y}${shift ? ' with Shift' : ''}`,
          read: async () => (await scaleOf(window, cls)).x,
          settled: (scaleX) => Math.abs(scaleX - before.x) > 0.05
        }
      })
    } finally {
      if (shift) await window.keyboard.up('Shift')
    }
  }

  test('a picture: a corner drag keeps its ratio and the exported picture is not stretched; Shift frees the ratio', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t140-keep-ratio-pic')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      const flat = path.join(studio.root, 'flat.png')
      await makeFlatPng(flat, '200x100')
      await dropPng(window, readFileSync(flat).toString('base64'), 'flat.png')
      await expectLayerCount(window, 1)
      await expectShapeCount(window, 1)
      await expect.poll(() => transformerClasses(window), { timeout: 15_000, message: 'the picture has no handles' }).toEqual(['Image'])
      expect(await scaleOf(window, 'Image')).toEqual({ x: 1, y: 1 })

      // ── a corner drag far more across than down: a free resize would make this 1.5 x 1.1 ──
      await dragCorner(window, 'Image', { x: 100, y: 10 })
      await expect.poll(async () => (await scaleOf(window, 'Image')).x, { timeout: 10_000 }).toBeGreaterThan(1.2)
      const kept = await scaleOf(window, 'Image')
      expect(Math.abs(kept.x - kept.y), `scaleX ${kept.x} and scaleY ${kept.y} are one scale`).toBeLessThan(0.01)

      // ── the file: export at 1x and measure the red box. 200x100 is 2:1; stretched, it would not be ──
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const [png] = await waitForDownloads(studio, 1)
      expect(pngSize(png as Buffer)).toEqual({ w: 1200, h: 800 })
      const red = await redSize(studio, png as Buffer)
      expect(red.w, 'the picture is drawn larger in the file').toBeGreaterThan(260)
      expect(Math.abs(red.w / red.h - 2), `the exported picture is ${red.w} x ${red.h}, not 2:1`).toBeLessThan(0.03)

      // ── Shift frees it: the same gesture with Shift held changes the width alone ──
      await dragCorner(window, 'Image', { x: 60, y: 0 }, true)
      await expect.poll(async () => (await scaleOf(window, 'Image')).x, { timeout: 10_000 }).toBeGreaterThan(kept.x + 0.1)
      const freed = await scaleOf(window, 'Image')
      expect(freed.y, 'the height did not move').toBeCloseTo(kept.y, 2)
      expect(freed.x - freed.y, 'width and height are no longer one scale').toBeGreaterThan(0.15)
    } finally {
      await closeStudio(studio)
    }
  })

  test('text keeps its ratio on a corner drag and Shift frees it; a rectangle still stretches, and Shift keeps its ratio', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t140-keep-ratio-shapes')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      await startBlank(window)
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Text'])

      // ── text: one scale, then Shift frees it ──
      await dragCorner(window, 'Text', { x: 80, y: 4 })
      await expect.poll(async () => (await scaleOf(window, 'Text')).x, { timeout: 10_000 }).toBeGreaterThan(1.2)
      const word = await scaleOf(window, 'Text')
      expect(Math.abs(word.x - word.y), `text scaleX ${word.x} and scaleY ${word.y} are one scale`).toBeLessThan(0.01)
      await dragCorner(window, 'Text', { x: 60, y: 0 }, true)
      await expect.poll(async () => (await scaleOf(window, 'Text')).x, { timeout: 10_000 }).toBeGreaterThan(word.x + 0.1)
      const wide = await scaleOf(window, 'Text')
      expect(wide.y, 'the text kept its height').toBeCloseTo(word.y, 2)

      // ── a rectangle: a corner drag stretches it ──
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Rect'])
      await dragCorner(window, 'Rect', { x: 150, y: 10 })
      await expect.poll(async () => (await scaleOf(window, 'Rect')).x, { timeout: 10_000 }).toBeGreaterThan(1.3)
      const stretched = await scaleOf(window, 'Rect')
      expect(stretched.x - stretched.y, `a rectangle's corner drag still stretches it (${stretched.x} x ${stretched.y})`).toBeGreaterThan(0.2)

      // ── Shift on a rectangle keeps its proportions (Konva's own, unchanged): both scales grow by the same factor ──
      await dragCorner(window, 'Rect', { x: 60, y: 0 }, true)
      await expect.poll(async () => (await scaleOf(window, 'Rect')).x, { timeout: 10_000 }).toBeGreaterThan(stretched.x + 0.05)
      const kept = await scaleOf(window, 'Rect')
      expect(kept.x / kept.y, 'Shift kept the rectangle\'s ratio').toBeCloseTo(stretched.x / stretched.y, 1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the shortcuts dialog on Stream Graphics documents Shift+drag', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t140-shift-row')
    const { window } = studio
    try {
      await startBlank(window)
      await window.keyboard.press('?')
      const shortcuts = window.locator('[role="dialog"]')
      await expect(shortcuts).toBeVisible()
      const row = shortcuts.locator('li').filter({ hasText: 'Shift+drag' })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Corner handle: resize a picture or text freely; keep a shape\'s proportions')
      await window.keyboard.press('Escape')
      await expect(shortcuts).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-140 (4): "start blank" is the blank page ──────────────────────────────────────────────────────────────────────────────────────────────
//
// The empty screen says "Pick a template to start ... or start blank below". The store kept the template's width, height and background when its last layer was removed, so an
// import from that screen landed on the 112x112 emote, and Export wrote the emote pack. An empty document IS the blank page (1200x800, white); Undo of the removal brings the
// template back whole.
test.describe('Image Studio — "start blank" after a template\'s last layer is removed is the blank page (T-140 (4))', () => {
  async function removeEveryLayer(window: Page, count: number): Promise<void> {
    for (let i = count; i > 0; i -= 1) {
      await window.locator(`${LAYERS} li`).first().getByRole('button', { name: 'Remove layer' }).click()
    }
    await expect(window.getByText('Pick a template to start')).toBeVisible()
  }

  test('apply the emote, remove its layer, import from the empty screen: the document is 1200x800 white and Export writes ONE png of it; Undo walks back to the emote', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t140-blank-import')
    const { window } = studio
    try {
      const emote = templateById('emote-blank-112')
      await templateCard(window, emote).click()
      await expectTemplateApplied(window, emote)
      await removeEveryLayer(window, emote.doc.layers.length)

      // Undo of the last removal brings the template's document back whole; Redo takes the layer away again.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expectTemplateApplied(window, emote)
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(window.getByText('Pick a template to start')).toBeVisible()

      // "Start blank": a picture dropped on the empty screen lands on the blank page.
      const png = readFileSync(studio.fixturePng).toString('base64')
      await dropPng(window, png, 'blank-start.png')
      await expectLayerCount(window, 1)
      await expectShapeCount(window, 1)
      await expect(window.getByText('1200 × 800')).toBeVisible()
      await expect(window.getByTestId('export-output-size')).toHaveText('Output: 1200×800')

      // Export writes that page: one PNG, 1200x800, white where the picture is not (the emote would be transparent, and a pack of three).
      const exportPanel = window.locator(EXPORT)
      await exportPanel.getByLabel('Scale').selectOption('1')
      await exportPanel.getByRole('button', { name: 'Export', exact: true }).click()
      const [file] = await waitForDownloads(studio, 1)
      expect(pngSize(file as Buffer)).toEqual({ w: 1200, h: 800 })
      expect(await samplePixel(studio, file as Buffer, 'png', 1190, 790)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
      expect(savedNames(studio)).toHaveLength(1)

      // Undo walks back through the history: the picture, then the removal.
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(window.getByText('Pick a template to start')).toBeVisible()
      await window.getByRole('button', { name: 'Undo' }).click()
      await expectTemplateApplied(window, emote)
    } finally {
      await closeStudio(studio)
    }
  })

  test('"Start with text" on that screen is the blank page too: 1200x800, white, dark 32 px text', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t140-blank-text')
    const { window } = studio
    try {
      const emote = templateById('emote-blank-112')
      await templateCard(window, emote).click()
      await expectTemplateApplied(window, emote)
      await removeEveryLayer(window, emote.doc.layers.length)

      await window.getByRole('button', { name: 'Start with text' }).click()
      await expectLayerCount(window, 1)
      await expect(window.getByText('1200 × 800')).toBeVisible()
      await expect(window.getByTestId('export-output-size')).toHaveText('Output: 1200×800')
      const text = await lastShape(window)
      expect(text.cls).toBe('Text')
      expect([text.x, text.y, text.fontSize, text.fill?.toLowerCase()]).toEqual([60, 60, 32, BG_BASE.toLowerCase()])
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-140 (5): Stream Graphics fits the smallest window ─────────────────────────────────────────────────────────────────────────────────────
//
// At 1024x640 (MIN_WINDOW) the Export bar sat at y = 640-694, past the window: the root was `overflow-hidden` (its four sibling studios are `overflow-auto`) and the canvas had
// `min-h-[400px]`; and the canvas column had no `min-w-0`, so a wide document's fixed-pixel Stage held the `1fr` track open and pushed the Layers card off the right edge (wholly off
// screen after a 1632 -> 1024 shrink). Every older case reached those controls with `click()`, which scrolls the element into view first; these read the geometry, with no click
// between the resize and the measurement.
test.describe('Image Studio — the Export bar and the Layers card are on screen at the smallest window, without a scroll (T-140 (5))', () => {
  const SIZES: Array<[{ width: number; height: number }, string]> = [
    [MIN_WINDOW, '1024x640 (the minimum)'],
    [{ width: 1280, height: 728 }, '1280x728'],
    [{ width: 1366, height: 768 }, '1366x768'],
    [DEFAULT_WINDOW, '1632x918 (the default)']
  ]

  /** The Export button, the whole Export bar, the Layers card and the stage: on screen, and the stage inside the box that holds it. */
  async function expectStudioOnScreen(window: Page, what: string): Promise<void> {
    await expectInViewport(window.locator(EXPORT).getByRole('button', { name: 'Export', exact: true }), `the Export button ${what}`)
    await expectInViewport(window.locator(EXPORT), `the Export bar ${what}`)
    await expectInViewport(window.locator(LAYERS), `the Layers card ${what}`)
    const fit = await window.locator('.konvajs-content canvas').first().evaluate((canvas) => {
      const box = canvas.getBoundingClientRect()
      const holder = (canvas.closest('.relative') as HTMLElement).getBoundingClientRect()
      return { right: box.right - holder.right, bottom: box.bottom - holder.bottom, left: holder.left - box.left, top: holder.top - box.top }
    })
    for (const [side, over] of Object.entries(fit)) expect(over, `the stage ${what} sticks out of its box on the ${side} by ${over} px`).toBeLessThanOrEqual(1)
    // And the page itself has no sideways scroll: nothing in it is wider than the window (the root is `overflow-auto` now, so a too-wide child would show a scrollbar, not hide).
    const root = window.locator('h1', { hasText: 'Stream Graphics' }).locator('xpath=ancestor::div[contains(@class, "h-full")][1]')
    await expectNoHorizontalOverflow(root, `the Stream Graphics page ${what}`)
  }

  test('on the blank page, a thumbnail, the emote and the Twitch banner, at four window sizes', async () => {
    test.setTimeout(300_000)
    const studio = await openStudio('t140-fit')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, MIN_WINDOW)
      await startBlank(window)
      const dialog = window.locator('[role="dialog"]')
      const docs: Array<[string, string | null]> = [
        ['the blank page', null],
        ['the Bold thumbnail', 'yt-thumb-bold'],
        ['the emote', 'emote-blank-112'],
        ['the Twitch banner', 'tw-banner-videoplayer']
      ]
      for (const [name, id] of docs) {
        if (id) {
          const t = templateById(id)
          await resizeAndSettle(app, window, MIN_WINDOW)
          await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
          await dialog.locator('button.card').filter({ has: window.getByText(t.name, { exact: true }) }).click()
          await expect(dialog).toHaveCount(0)
          await expectTemplateApplied(window, t)
        }
        for (const [size, label] of SIZES) {
          await resizeAndSettle(app, window, size)
          // No click, no scroll: the controls are where a person who just opened the studio at this size finds them.
          await expectStudioOnScreen(window, `with ${name} at ${label}`)
        }
      }
    } finally {
      await closeStudio(studio)
    }
  })

  test('a fresh open at 1024x640 with the Twitch banner as the first canvas: the Layers card is inside the window', async () => {
    // The Stage mounts at its 800 px starting size (Canvas.tsx) and a wide document is limited by its width, so the container reads the 800 px the track was held open at
    // and keeps it: the card sat at x = 840-1100 of 1024. A canvas that was already mounted (the case above switches documents) never gets stuck, which is why this is its own launch.
    test.setTimeout(150_000)
    const studio = await openStudio('t140-fresh-banner')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, MIN_WINDOW)
      const banner = templateById('tw-banner-videoplayer')
      await templateCard(window, banner).click()
      await expectTemplateApplied(window, banner)
      await expectStudioOnScreen(window, 'with the banner opened first at 1024x640')
      expect((await stageGeom(window)).stageW, 'the stage was fitted to the column, not left at the 800 px it started at').toBeLessThan(760)
    } finally {
      await closeStudio(studio)
    }
  })

  test('after a 1632x918 -> 1024x640 resize with the banner open, and back', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t140-shrink')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      const banner = templateById('tw-banner-videoplayer')
      await templateCard(window, banner).click()
      await expectTemplateApplied(window, banner)
      const wide = (await stageGeom(window)).stageW
      await expectStudioOnScreen(window, 'with the banner at 1632x918')

      await resizeAndSettle(app, window, MIN_WINDOW)
      await expectStudioOnScreen(window, 'with the banner after the shrink to 1024x640')
      expect((await stageGeom(window)).stageW, 'the stage followed the window down').toBeLessThan(wide)

      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      await expectStudioOnScreen(window, 'with the banner after growing back to 1632x918')
      expect((await stageGeom(window)).stageW, 'and back up').toBeGreaterThan(900)
    } finally {
      await closeStudio(studio)
    }
  })

  test('below the minimum the studio scrolls (the backstop): the wheel brings the Export bar into view', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t140-backstop')
    const { app, window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      // Shorter than the minimum window can be (a person cannot drag it there; a larger system text size or zoom gets the same box): the bar is off the page.
      await resizeAndSettle(app, window, { width: 1024, height: 500 })
      const off = await window.locator(EXPORT).boundingBox()
      expect(off && off.y + off.height, 'the bar starts below the window, so the wheel is what has to reach it').toBeGreaterThan(500)
      await window.mouse.move(500, 40)
      await window.mouse.wheel(0, 600)
      // (Chromium's wheel scroll animates: wait for the bar to arrive, then measure it as a person sees it.)
      await expect
        .poll(async () => {
          const box = await window.locator(EXPORT).boundingBox()
          return box ? box.y + box.height <= 500.5 : false
        }, { timeout: 10_000, message: 'the wheel never brought the Export bar up: the studio does not scroll' })
        .toBe(true)
      await expectInViewport(window.locator(EXPORT).getByRole('button', { name: 'Export', exact: true }), 'the Export button after a wheel')
      await expectInViewport(window.locator(EXPORT), 'the Export bar after a wheel')
      // The canvas gave way no further than its floor (CANVAS_MIN_H, 240 px) before the studio started to scroll: a drawing squeezed to nothing is not a fit.
      const canvasBox = await window.locator('.konvajs-content').locator('xpath=..').boundingBox()
      expect(canvasBox?.height ?? 0, 'the canvas keeps its floor').toBeGreaterThanOrEqual(239.5)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the measurement itself discriminates: an element hanging past the edge, and one a dialog covers, are both refused', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t140-helper')
    const { app, window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      await resizeAndSettle(app, window, MIN_WINDOW)
      const bar = window.locator(EXPORT)
      await expectInViewport(bar, 'the Export bar (the control: it is on screen)')
      // Hanging 50 px past the right edge.
      await window.evaluate(() => {
        const box = document.createElement('div')
        box.id = 'probe-edge'
        box.textContent = 'probe'
        box.style.cssText = `position:fixed;top:100px;height:30px;width:120px;left:${window.innerWidth - 70}px;background:#fff;z-index:100`
        document.body.appendChild(box)
      })
      await expect(expectInViewport(window.locator('#probe-edge'), 'a box past the right edge')).rejects.toThrow(/right of the window/)
      // Under the Templates dialog's scrim: in the window by its box, not there to a person.
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      await expect(window.locator('[role="dialog"]')).toBeVisible()
      await expect(expectInViewport(bar, 'the Export bar under a dialog')).rejects.toThrow(/clipped or covered/)
    } finally {
      await closeStudio(studio)
    }
  })
})


// ── T-141 (2): "+ Add text" is inked against what it lands on ──────────────────────────────────────────────────────────────────────────────
//
// T-140 (2) chose the ink against the DOCUMENT's background. On both emote templates that is a transparent document with a disc filling it, so the light ink landed on the disc:
// 1.33:1 on the gold POG disc, 2.92:1 on the red one; and on the Bold thumbnail and the Twitch Profile banner the new word's box reaches a different colour than the page around it. The
// ink is now chosen against what is DRAWN under the word's box (the document, the shapes and the words it overlaps), and the word moves to a place where one ink reaches 4.5:1 when its
// first place has none. The proof is on rendered pixels, never on the rule: the document drawn at 1:1 without the word and without the editor's chrome, every pixel under the word's
// box laid over the workspace the way the canvas shows it, against the word's ink, by a luminance written out in this file.
test.describe('Image Studio — "+ Add text" is readable against what is drawn under it, on every template (T-141 (2))', () => {
  interface Underneath {
    /** The lowest WCAG contrast between the word's ink and any pixel under its box. */
    worst: number
    /** Where in the document that pixel is. */
    at: { x: number; y: number }
    ink: string
    /** The word's box as drawn (document px) and the document's size. */
    box: { x: number; y: number; width: number; height: number }
    doc: { width: number; height: number }
    pixels: number
  }

  /**
   * Hide the newest Text node and the editor's chrome layers, draw the document layer at 1:1 (the stage's zoom out of it, as an export does), and measure the pixels in the node's box
   * against its fill. Everything is put back before it returns. A pixel's alpha is laid over `behind` (the workspace colour a transparent document shows), so a transparent corner
   * is judged as the dark it is on screen.
   */
  function worstUnderNewestWord(window: Page, behind: string): Promise<Underneath> {
    return window.evaluate((behindHex) => {
      interface Node {
        visible(): boolean
        visible(v: boolean): void
        fill(): string
        getClientRect(o: { relativeTo: unknown }): { x: number; y: number; width: number; height: number }
      }
      interface Stage {
        children: Array<{ find(sel: string): Node[] }>
        getLayers(): Array<{ visible(): boolean; visible(v: boolean): void; hasName(n: string): boolean }>
        scaleX(): number
        width(): number
        height(): number
        scale(v: { x: number; y: number }): void
        toCanvas(o: { x: number; y: number; width: number; height: number; pixelRatio: number }): HTMLCanvasElement
      }
      const stage = (window as unknown as { __imagiiStage?: Stage }).__imagiiStage
      if (!stage) throw new Error('__imagiiStage is not set')
      const layer = stage.children[0]
      const words = layer ? layer.find('Text') : []
      const word = words[words.length - 1]
      if (!layer || !word) throw new Error('no Text node on the stage')
      const box = word.getClientRect({ relativeTo: layer })
      const zoom = stage.scaleX()
      const doc = { width: Math.round(stage.width() / zoom), height: Math.round(stage.height() / zoom) }
      const chrome = stage.getLayers().filter((l) => l.hasName('chrome'))
      const chromeWas = chrome.map((l) => l.visible())
      const wordWas = word.visible()
      let canvas: HTMLCanvasElement
      try {
        stage.scale({ x: 1, y: 1 })
        for (const l of chrome) l.visible(false)
        word.visible(false)
        canvas = stage.toCanvas({ x: 0, y: 0, width: doc.width, height: doc.height, pixelRatio: 1 })
      } finally {
        chrome.forEach((l, i) => l.visible(chromeWas[i] as boolean))
        word.visible(wordWas)
        stage.scale({ x: zoom, y: zoom })
      }
      const lin = (c: number): number => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      const lum = (r: number, g: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const channels = (hex: string): [number, number, number] => {
        const n = parseInt(hex.slice(1), 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      }
      const ink = word.fill()
      const inkL = lum(...channels(ink))
      const back = channels(behindHex)
      const x0 = Math.max(0, Math.floor(box.x))
      const y0 = Math.max(0, Math.floor(box.y))
      const x1 = Math.min(canvas.width, Math.ceil(box.x + box.width))
      const y1 = Math.min(canvas.height, Math.ceil(box.y + box.height))
      const w = x1 - x0
      const data = canvas.getContext('2d')?.getImageData(x0, y0, w, y1 - y0).data
      if (!data || w <= 0) throw new Error(`no pixels under the word's box ${JSON.stringify(box)}`)
      let worst = Infinity
      let at = { x: x0, y: y0 }
      for (let i = 0; i < data.length; i += 4) {
        const a = (data[i + 3] as number) / 255
        const l = lum(
          (data[i] as number) * a + back[0] * (1 - a),
          (data[i + 1] as number) * a + back[1] * (1 - a),
          (data[i + 2] as number) * a + back[2] * (1 - a)
        )
        const ratio = (Math.max(inkL, l) + 0.05) / (Math.min(inkL, l) + 0.05)
        if (ratio < worst) {
          worst = ratio
          at = { x: x0 + ((i / 4) % w), y: y0 + Math.floor(i / 4 / w) }
        }
      }
      return { worst, at, ink, box, doc, pixels: data.length / 4 }
    }, behind)
  }

  function describeRow(name: string, r: Underneath): string {
    return `${name}: ink ${r.ink}, worst ${r.worst.toFixed(2)}:1 at (${r.at.x}, ${r.at.y}), box ${JSON.stringify(r.box)} of ${r.doc.width}x${r.doc.height}`
  }

  test('on every template and the blank page, no pixel under the new word is under 4.5:1 against its ink, and the word is wholly on the document', async () => {
    test.setTimeout(540_000)
    const studio = await openStudio('t141-ink-pixels')
    const { window } = studio
    try {
      expect(CANVAS_TEMPLATES.length, 'the twelve templates').toBeGreaterThanOrEqual(12)
      const rows: string[] = []
      const dialog = window.locator('[role="dialog"]')

      // The blank page: "Start with text" is the first word on a white page.
      await startBlank(window)
      const blank = await worstUnderNewestWord(window, BG_BASE)
      rows.push(describeRow('the blank page', blank))
      expect.soft(blank.worst, describeRow('the blank page', blank)).toBeGreaterThanOrEqual(4.5)

      for (const t of CANVAS_TEMPLATES) {
        await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
        await dialog.locator('button.card').filter({ has: window.getByText(t.name, { exact: true }) }).click()
        await expect(dialog).toHaveCount(0)
        await expectTemplateApplied(window, t)
        await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
        await expectLayerCount(window, t.doc.layers.length + 1)
        const word = await newestTextBox(window)
        const r = await worstUnderNewestWord(window, BG_BASE)
        const what = describeRow(t.name, r)
        rows.push(what)
        expect.soft(r.worst, what).toBeGreaterThanOrEqual(4.5)
        expect.soft(word.x, `${t.name}: left edge on the document`).toBeGreaterThanOrEqual(-0.01)
        expect.soft(word.y, `${t.name}: top edge on the document`).toBeGreaterThanOrEqual(-0.01)
        expect.soft(word.x + word.width, `${t.name}: right edge on the document`).toBeLessThanOrEqual(t.doc.width + 0.01)
        expect.soft(word.y + word.height, `${t.name}: bottom edge on the document`).toBeLessThanOrEqual(t.doc.height + 0.01)
      }
      console.log(`T-141 (2) rows:\n${rows.join('\n')}`)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a second word on the blank page is not drawn on the first', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t141-ink-second')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 2)
      const second = await worstUnderNewestWord(window, BG_BASE)
      expect(second.worst, describeRow('the second word', second)).toBeGreaterThanOrEqual(4.5)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 3)
      const third = await worstUnderNewestWord(window, BG_BASE)
      expect(third.worst, describeRow('the third word', third)).toBeGreaterThanOrEqual(4.5)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the emote and the POG emote take the dark ink: the word sits on a disc, and the light ink was 2.9:1 and 1.3:1 there', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t141-ink-discs')
    const { window } = studio
    try {
      const dialog = window.locator('[role="dialog"]')
      for (const [i, id] of ['emote-blank-112', 'emote-text'].entries()) {
        const t = templateById(id)
        if (i === 0) {
          await templateCard(window, t).click()
        } else {
          await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
          await dialog.locator('button.card').filter({ has: window.getByText(t.name, { exact: true }) }).click()
          await expect(dialog).toHaveCount(0)
        }
        await expectTemplateApplied(window, t)
        await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
        await expectLayerCount(window, t.doc.layers.length + 1)
        const r = await worstUnderNewestWord(window, BG_BASE)
        expect(r.ink.toLowerCase(), describeRow(t.name, r)).toBe(BG_BASE.toLowerCase())
        expect(r.worst, describeRow(t.name, r)).toBeGreaterThanOrEqual(4.5)
      }
    } finally {
      await closeStudio(studio)
    }
  })

  /** The newest Text node's box in document units (as the T-140 (2) case reads it). */
  function newestTextBox(window: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        children: Array<{
          find(sel: string): Array<{ getClientRect(o: { relativeTo: unknown }): { x: number; y: number; width: number; height: number } }>
        }>
      }
      const layer = stage.children[0]
      const texts = layer ? layer.find('Text') : []
      const t = texts[texts.length - 1]
      if (!layer || !t) throw new Error('no Text node on the stage')
      return t.getClientRect({ relativeTo: layer })
    })
  }
})

// ── T-141 (6): a text layer's "Size (px)" is what is drawn ─────────────────────────────────────────────────────────────────────────────────
//
// T-140 (3) made the corner drag the natural way to size a word, and it stored scaleX / scaleY on transform end while Properties shows `fontSize`: after a drag "Size (px)" said 32 over
// a word drawn at 44, and a size typed afterwards was multiplied by the kept scale. A word is sized by its font size, so the resize folds the scale into it: the size is the drawn size, the
// scale is 1 again, and typing a size draws at exactly that size. A Shift-freed stretch keeps what is left of it in scaleX.
test.describe('Image Studio — a word dragged to a size says that size in Properties, and a typed size draws at exactly it (T-141 (6))', () => {
  interface Word {
    fontSize: number
    scaleX: number
    scaleY: number
    /** The box the word is drawn in (document px): the glyph run's width by the line's height. */
    width: number
    height: number
  }

  function wordNow(window: Page): Promise<Word> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        children: Array<{
          find(sel: string): Array<{
            fontSize(): number
            scaleX(): number
            scaleY(): number
            getClientRect(o: { relativeTo: unknown }): { width: number; height: number }
          }>
        }>
      }
      const layer = stage.children[0]
      const texts = layer ? layer.find('Text') : []
      const t = texts[texts.length - 1]
      if (!layer || !t) throw new Error('no Text node on the stage')
      const r = t.getClientRect({ relativeTo: layer })
      return { fontSize: t.fontSize(), scaleX: t.scaleX(), scaleY: t.scaleY(), width: r.width, height: r.height }
    })
  }

  /** A real drag of the bottom-right corner handle by (dx, dy) document px, Shift held through the whole gesture when asked; waits until the drawn height or width has moved. */
  async function dragCorner(window: Page, by: Point, shift = false): Promise<void> {
    const before = await wordNow(window)
    const g = await stageGeom(window)
    const anchor = await anchorPoint(window, 'bottom-right')
    if (shift) await window.keyboard.down('Shift')
    try {
      await dragTo(window, anchor, { x: anchor.x + by.x * g.scale, y: anchor.y + by.y * g.scale }, {
        extent: {
          label: `word corner drag by ${by.x},${by.y}${shift ? ' with Shift' : ''}`,
          read: async () => {
            const w = await wordNow(window)
            return Math.max(Math.abs(w.height - before.height), Math.abs(w.width - before.width))
          },
          settled: (moved) => moved > 2
        }
      })
    } finally {
      if (shift) await window.keyboard.up('Shift')
    }
  }

  test('a corner drag: the size field shows the drawn size, the scale is 1 again, and a typed size draws at exactly that size', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t141-size-fold')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      await startBlank(window)
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Text'])
      const size = field(window, 'Size (px)')
      await expect(size).toHaveValue('32')
      const start = await wordNow(window)
      expect(start.height, 'a word 32 px high is drawn 32 px high').toBeCloseTo(32, 1)

      // ── a corner drag far more across than down ──
      await dragCorner(window, { x: 80, y: 4 })
      const dragged = await wordNow(window)
      expect(dragged.height, 'the word was made larger').toBeGreaterThan(40)
      // The size IS the drawn size: the drawn height is the font size (a line is one em high), and the field says it.
      expect(dragged.scaleX, 'the scale is folded into the size').toBe(1)
      expect(dragged.scaleY).toBe(1)
      expect(dragged.height, 'drawn at the size the node has').toBeCloseTo(dragged.fontSize, 1)
      await expect(size, 'Properties says the size it is drawn at').toHaveValue(String(dragged.fontSize))
      expect(Number.isInteger(dragged.fontSize), 'a whole pixel, the Size field\'s step').toBe(true)
      // Proportions kept: the glyph run is as much wider than it is tall as it was.
      expect(dragged.width / dragged.height, 'a corner drag does not stretch the word').toBeCloseTo(start.width / start.height, 1)

      // ── a typed size draws at exactly that size (it was multiplied by the kept scale) ──
      await retype(size, '100')
      await leave(size)
      await expect(size).toHaveValue('100')
      await expect.poll(async () => (await wordNow(window)).fontSize, { timeout: 10_000 }).toBe(100)
      const typed = await wordNow(window)
      expect(typed.height, 'drawn exactly 100 px high').toBeCloseTo(100, 1)
      expect(typed.scaleX).toBe(1)
      expect(typed.width / typed.height).toBeCloseTo(start.width / start.height, 1)

      // ── and a second drag works from the new size, not from the first drag's scale ──
      await dragCorner(window, { x: -40, y: 0 })
      const smaller = await wordNow(window)
      expect(smaller.height).toBeLessThan(100)
      expect(smaller.scaleX).toBe(1)
      await expect(size).toHaveValue(String(smaller.fontSize))
      expect(smaller.height).toBeCloseTo(smaller.fontSize, 1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a Shift-freed stretch folds its height into the size and keeps the remaining width ratio in scaleX; the drawn width is what was dragged', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t141-size-fold-free')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, DEFAULT_WINDOW)
      await startBlank(window)
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Text'])
      const size = field(window, 'Size (px)')
      const start = await wordNow(window)

      // Shift frees the ratio (T-140 (3)): a drag across alone changes the width and leaves the height, so the size stays and the width ratio is kept.
      await dragCorner(window, { x: 70, y: 0 }, true)
      const wide = await wordNow(window)
      expect(wide.width, 'wider').toBeGreaterThan(start.width + 20)
      expect(wide.fontSize, 'the height did not move, so neither did the size').toBe(32)
      expect(wide.scaleY).toBe(1)
      expect(wide.scaleX, 'the width stretch stays in scaleX').toBeGreaterThan(1.1)
      await expect(size).toHaveValue('32')

      // Now a drag down alone with Shift: the height is folded into the size and the width stays what it was drawn at.
      const widthBefore = wide.width
      await dragCorner(window, { x: 0, y: 40 }, true)
      const tall = await wordNow(window)
      expect(tall.fontSize, 'the height went into the size').toBeGreaterThan(40)
      expect(tall.scaleY).toBe(1)
      await expect(size).toHaveValue(String(tall.fontSize))
      expect(tall.height).toBeCloseTo(tall.fontSize, 1)
      expect(tall.width, 'the width is what it was drawn at, not what the new size would make it').toBeCloseTo(widthBefore, 0)
      expect(tall.scaleX, 'so the stretch is now a squeeze against the bigger size').toBeLessThan(wide.scaleX)

      // A typed size after a stretch is drawn at exactly that height; the width keeps its ratio.
      await retype(size, '50')
      await leave(size)
      await expect.poll(async () => (await wordNow(window)).fontSize, { timeout: 10_000 }).toBe(50)
      const typed = await wordNow(window)
      expect(typed.height).toBeCloseTo(50, 1)
      expect(typed.scaleX, 'the stretch is kept').toBeCloseTo(tall.scaleX, 5)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-141 (8): Delete after an Undo is not a step ──────────────────────────────────────────────────────────────────────────────────────────
//
// `removeLayer` had no unknown-id guard and Undo kept the selection, so after Ctrl+Z took away the word it had selected, Delete recorded a step that changed nothing and cleared Redo:
// Ctrl+Y then did nothing and the word was gone for good.
test.describe('Image Studio — Delete after an Undo records nothing, and Redo brings the word back (T-141 (8))', () => {
  test('Add text, Ctrl+Z, Delete, Ctrl+Y: the word is back, and Redo was never lost', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t141-delete-after-undo')
    const { window } = studio
    try {
      await startBlank(window)
      const redo = window.getByRole('button', { name: 'Redo' })
      await expect(redo).toBeDisabled()

      await window.keyboard.press('Control+z')
      await expect(window.getByText('Pick a template to start')).toBeVisible()
      await expect(redo, 'the word is in Redo').toBeEnabled()

      // Delete with nothing selected: no layer, so no step, and the Redo branch stays.
      await window.keyboard.press('Delete')
      await expect(redo, 'Delete after an Undo did not clear Redo').toBeEnabled()
      await window.keyboard.press('Backspace')
      await expect(redo, 'nor did Backspace').toBeEnabled()

      await window.keyboard.press('Control+y')
      await expectLayerCount(window, 1)
      await expectShapeCount(window, 1)
      expect((await lastShape(window)).cls).toBe('Text')
      await expect(redo).toBeDisabled()
    } finally {
      await closeStudio(studio)
    }
  })

  test('the same on a template: Undo of an added word leaves nothing selected, and Delete takes no layer of the template', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t141-delete-after-undo-template')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-clean')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, t.doc.layers.length + 1)
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, t.doc.layers.length)
      await expect(propsCard(window), 'nothing is selected: the added word was the selection').toHaveCount(0)
      await window.keyboard.press('Delete')
      await expectLayerCount(window, t.doc.layers.length)
      await expect(window.getByRole('button', { name: 'Redo' })).toBeEnabled()
      await window.keyboard.press('Control+y')
      await expectLayerCount(window, t.doc.layers.length + 1)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-147 (4): a transparent document exported as JPG says it will come out black
// ═══════════════════════════════════════════════════════════════════════════
// The overlay and emote templates have no background (the canvas shows a checkerboard); a JPG has no alpha and the capture composites it onto black. The Export card
// said nothing, so the file was not what the canvas showed. One line in the note slot beside the thumbnail-size note, and only for that pair.
test.describe('Image Studio - JPG over a transparent document says so (T-147 (4))', () => {
  const NOTE = 'JPG has no transparency: the clear parts come out black. Choose PNG to keep them clear.'

  test('an overlay template: JPG shows the line, PNG removes it; a filled document shows none in either format', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t147-jpg-note')
    const { window } = studio
    try {
      const overlay = templateById('tw-overlay-streamer')
      expect(overlay.doc.background, 'the fixture is a transparent document').toBe('transparent')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)
      const exportPanel = window.locator(EXPORT)
      const format = exportPanel.getByRole('combobox', { name: 'Export format' })
      await expect(format).toHaveValue('png')
      await expect(exportPanel, 'PNG keeps the clear parts clear: nothing to say').not.toContainText('JPG has no transparency')
      await format.selectOption('jpg')
      await expect(exportPanel.getByText(NOTE, { exact: true })).toBeVisible()
      // The line is one paragraph in the card's note slot, the status region the size note uses (T-153: that region is always mounted).
      await expect(exportPanel.locator('[role="status"] p').filter({ hasText: NOTE })).toHaveCount(1)
      await format.selectOption('png')
      await expect(exportPanel.getByText(NOTE)).toHaveCount(0)

      // A filled document (the thumbnail's dark fill): the JPG is what the canvas shows, so no line.
      const filled = templateById('yt-thumb-bold')
      expect(filled.doc.background).not.toBe('transparent')
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      const dialog = window.locator('[role="dialog"]')
      await dialog.locator('button.card').filter({ has: window.getByText(filled.name, { exact: true }) }).click()
      await expect(dialog).toHaveCount(0)
      await expectTemplateApplied(window, filled)
      await format.selectOption('jpg')
      await expect(exportPanel.getByRole('slider', { name: 'JPG export quality' })).toBeVisible()
      await expect(exportPanel.getByText(NOTE)).toHaveCount(0)
      await expect(exportPanel).not.toContainText('JPG has no transparency')
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-147 (T-75): a tutorial coachmark owns the keyboard like any other dialog
// ═══════════════════════════════════════════════════════════════════════════
// The studio's window-level hotkeys asked Modal's count, which leaves the coachmark out on purpose (so `?` stays pressable during a tutorial, T-72): with a
// coachmark open, the tool letters, Delete and Ctrl+Z still acted on the canvas behind its scrim. They ask the dialog claim stack now. `?` keeps working.
test.describe('Image Studio - hotkeys under an open tutorial coachmark (T-147, T-75)', () => {
  test('R, Delete and Ctrl+Z change nothing behind the coachmark; ? still opens the shortcuts; closed, every key works again', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t75-coachmark')
    const { window } = studio
    try {
      await startBlank(window)
      // A layer is selected (Start with text selects it), so Delete has something to remove.
      await expect(propsCard(window)).toBeVisible()
      await expect(window.getByText('Tool: Select')).toBeVisible()
      const names = await layerNames(window)

      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const coachmark = window.locator('[role="dialog"]')
      await expect(coachmark).toContainText('Welcome to Stream Graphics')
      await expect(window.locator('[role="dialog"]')).toHaveCount(1)

      // ── the bare letter and Delete reach nothing behind the scrim ──
      await window.keyboard.press('r')
      await window.keyboard.press('Delete')
      await window.keyboard.press('Backspace')
      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 1)
      expect(await layerNames(window)).toEqual(names)
      await expect(window.getByText('Tool: Select'), 'R did not switch the tool').toBeVisible()
      await expect(window.getByText('Tool: Rectangle')).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Redo' }), 'Ctrl+Z did not undo').toBeDisabled()

      // ── `?` is the one key that stays live under a tutorial (T-72) ──
      await window.keyboard.press('?')
      const overlay = window.locator('[role="dialog"]').filter({ hasText: 'Press Esc or ? to close.' })
      await expect(overlay).toHaveCount(1)
      await expect(window.locator('[role="dialog"]')).toHaveCount(2)
      // ...and the keys are still inert with TWO dialogs up.
      await window.keyboard.press('o')
      await window.keyboard.press('Delete')
      await expectLayerCount(window, 1)
      await expect(window.getByText('Tool: Select')).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(overlay).toHaveCount(0)
      await window.keyboard.press('Escape')
      await expect(window.locator('[role="dialog"]')).toHaveCount(0)

      // ── the coachmark closed: the same keys act again ──
      await window.keyboard.press('r')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
      await window.keyboard.press('v')
      await window.keyboard.press('Delete')
      // The last layer gone is the blank page: the templates-first screen is back (T-140 (4)).
      await expect(window.getByText('Pick a template to start')).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-147 (T-78, image half): one drag of a Properties slider, or one run of typing, is one undo step
// ═══════════════════════════════════════════════════════════════════════════
// `updateLayer` pushed an undo step per `input` event, so one opacity drag filled the history with dozens and Ctrl+Z moved the value one notch.
test.describe('Image Studio - a Properties drag is one undo step (T-147, T-78)', () => {
  test('an opacity drag, then ONE Undo restores the value from before it; a second drag is a second step; typing a name is one step', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t78-opacity-drag')
    const { window } = studio
    try {
      await startBlank(window)
      const slider = window.getByRole('slider', { name: 'Layer opacity' })
      await expect(slider).toBeVisible()
      expect((await lastShape(window)).opacity).toBe(1)

      /** Press the thumb at `fromRatio` of the slider's width and drag through `through`, releasing at the last; the slider moves its value on every position. */
      const drag = async (fromRatio: number, through: number[]): Promise<void> => {
        const box = (await slider.boundingBox())!
        const at = (r: number): { x: number; y: number } => ({ x: box.x + 8 + (box.width - 16) * r, y: box.y + box.height / 2 })
        await dragThrough(window, at(fromRatio), through.map(at))
      }

      // ── drag 1: 100% down to about 40%, through four positions ──
      await drag(1, [0.85, 0.7, 0.55, 0.4])
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBeLessThan(0.5)
      const afterFirst = (await lastShape(window)).opacity
      expect(afterFirst).toBeGreaterThan(0.3)
      // ONE Undo: the opacity from before the drag, not one notch back.
      await window.keyboard.press('Control+z')
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBe(1)
      await expect(window.getByText('100%').first()).toBeVisible()

      // ── two drags are two steps: the second one's Undo lands on the first one's value ──
      await drag(1, [0.8, 0.6])
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBeLessThan(0.7)
      const firstOfTwo = (await lastShape(window)).opacity
      await drag(0.6, [0.45, 0.3, 0.2])
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBeLessThan(firstOfTwo)
      await window.keyboard.press('Control+z')
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBe(firstOfTwo)
      await window.keyboard.press('Control+z')
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBe(1)

      // ── typing a name is one step: the field keeps focus through the run, and the undo button takes the whole word back ──
      const name = field(window, 'Name')
      await name.click()
      await window.keyboard.press('Control+a')
      await window.keyboard.type('Headline', { delay: 20 })
      expect(await layerNames(window)).toEqual(['Headline'])
      // Leave the field (the blur ends the step), then Undo by its button: one press puts the old name back whole.
      await window.getByRole('button', { name: 'Undo' }).click()
      expect(await layerNames(window)).toEqual(['Text'])
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-148: the first Properties drag after clicking another field is one undo step
// ═══════════════════════════════════════════════════════════════════════════
// A press on the slider moves focus, and Chromium sends the slider its first `input` event BEFORE the focused field's `blur`; a panel that ended its undo window on every
// blur closed it mid-drag, so the drag's second event began a second step and ONE Undo stopped at the press value.
test.describe('Image Studio - a drag right after clicking another field is one undo step (T-148)', () => {
  test('click the Name field, then drag Opacity: ONE Undo restores 100%', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t148-opacity-after-field')
    const { window } = studio
    try {
      await startBlank(window)
      const slider = window.getByRole('slider', { name: 'Layer opacity' })
      await expect(slider).toBeVisible()
      expect((await lastShape(window)).opacity).toBe(1)

      await field(window, 'Name').click()
      await expect(field(window, 'Name')).toBeFocused()

      await slider.scrollIntoViewIfNeeded()
      const box = (await slider.boundingBox())!
      const at = (r: number): { x: number; y: number } => ({ x: box.x + 8 + (box.width - 16) * r, y: box.y + box.height / 2 })
      // The press itself lands off the thumb (at 90%), so the slider's FIRST `input` event is the press: that is the one that arrives before the Name field's blur.
      await dragThrough(window, at(0.9), [0.75, 0.6, 0.45, 0.3].map(at))
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBeLessThan(0.5)

      await window.getByRole('button', { name: 'Undo' }).click()
      await expect.poll(async () => (await lastShape(window)).opacity, { timeout: 10_000 }).toBe(1)
      await expect(window.getByText('100%').first()).toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })
})

// T-150 (5, image half): the shape panel's stroke width box is "Stroke (px)", the panel's own "Size (px)" and the T-125 (16) convention (it read "Stroke px"). The
// longer caption has to stay on ONE line in the panel's fixed label column.
test.describe('Image Studio - the stroke width box counts pixels in its label (T-150)', () => {
  test('a rectangle\'s Properties say "Stroke (px)", on one line, and the box still takes a width', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t150-stroke-px-label')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)

      await expect(propsCard(window).getByText('Stroke (px)', { exact: true })).toBeVisible()
      await expect(propsCard(window).getByText('Stroke px', { exact: true }), 'the bare-number caption is gone').toHaveCount(0)
      const lines = await propsCard(window).getByText('Stroke (px)', { exact: true }).evaluate((el) => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
        return Math.round(el.getBoundingClientRect().height / lineHeight)
      })
      expect(lines, 'the caption fits the label column without wrapping').toBe(1)
      await field(window, 'Stroke (px)').fill('9')
      await expect.poll(async () => (await lastShape(window)).strokeWidth, { timeout: 10_000 }).toBe(9)
    } finally {
      await closeStudio(studio)
    }
  })
})

// T-152 (5): "Stroke (px)" was the panel's one raw number box: `Number(typed) || 0` with only `min={0}`, which limits the spinner and not the keyboard, so a typed "-3" was stored.
// Konva's `hasStroke` takes -3 as a stroke and the canvas ignores a non-positive lineWidth and keeps the PREVIOUS shape's width, so the outline drawn and exported depended on layer
// order. The box is a DraftField now, like "Size (px)": kept until typing ends, a negative commit clamps to 0. The end state is the project on disk (the autosave file, the app's own
// save path for this studio) and the box.
test.describe('Image Studio - a negative stroke width is never stored (T-152 (5))', () => {
  /** The first rectangle's strokeWidth in the autosave file on disk, or null while there is none. */
  function savedRectStroke(userDataDir: string): number | null {
    const file = path.join(userDataDir, 'autosave', 'autosave.json')
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { imageCanvas?: { doc?: { layers?: Array<{ type?: string; strokeWidth?: number }> } } }
      const rect = (parsed.imageCanvas?.doc?.layers ?? []).find((l) => l.type === 'rect')
      return typeof rect?.strokeWidth === 'number' ? rect.strokeWidth : null
    } catch {
      return null
    }
  }

  test('a rectangle at 4 px, "-3" typed in Stroke (px) and left: the box reads 0, the canvas draws no outline, and the project on disk says strokeWidth 0', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t152-negative-stroke')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)

      const stroke = field(window, 'Stroke (px)')
      await retype(stroke, '4')
      await leave(stroke)
      await expect.poll(async () => (await lastShape(window)).strokeWidth, { timeout: 10_000 }).toBe(4)
      await expect.poll(() => savedRectStroke(path.join(studio.root, 'userData')), { timeout: 60_000, intervals: [500], message: 'autosave wrote the 4 px rectangle' }).toBe(4)

      await retype(stroke, '-3')
      await leave(stroke)
      await expect
        .poll(() => savedRectStroke(path.join(studio.root, 'userData')), { timeout: 60_000, intervals: [500], message: 'the project on disk never keeps the negative width' })
        .toBe(0)
      await expect.poll(async () => (await lastShape(window)).strokeWidth, { timeout: 10_000, message: 'the layer on the canvas' }).toBe(0)
      await expect(stroke, 'the box shows the clamped number, not the typed one').toHaveValue('0')
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-153 (1): a number typed into a Properties box is ONE undo step
// ═══════════════════════════════════════════════════════════════════════════
// The boxes are DraftFields that commit live on each in-range keystroke (T-124 (15)), and `updateLayer(id, patch)` with no key pushes a step per call: "12" typed
// into Stroke (px) was two steps, and one Undo left 1 (T-152 (5) moved the box off the keyed raw input and lost the coalescing). Each box passes its own key now, and
// leaving the box closes the window (`useGestureEnd`), so a second run of typing is a second step. The end state is the layer on the stage and the box after Undo.
test.describe('Image Studio - a typed number in Properties is one undo step (T-153 (1))', () => {
  const undo = (window: Page): Locator => window.getByRole('button', { name: 'Undo' })

  test('Stroke (px): "12" typed key by key and left is ONE step; one Undo gives the old width back, and a second run is a second step', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t153-stroke-undo')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)
      const width = async (): Promise<number | undefined> => (await lastShape(window)).strokeWidth
      const before = await width()
      expect(before, 'a drawn rectangle starts at 2 px').toBe(2)

      const stroke = field(window, 'Stroke (px)')
      await retype(stroke, '12')
      await leave(stroke)
      await expect.poll(width, { timeout: 10_000 }).toBe(12)
      await undo(window).click()
      await expect.poll(width, { timeout: 10_000, message: 'one Undo puts back the width from before the typing, not the "1" on the way to "12"' }).toBe(2)
      await expect(stroke).toHaveValue('2')

      // Two runs of typing, the box left between them: two steps, each Undo lands on the run before it.
      await retype(stroke, '8')
      await leave(stroke)
      await retype(stroke, '20')
      await leave(stroke)
      await expect.poll(width, { timeout: 10_000 }).toBe(20)
      await undo(window).click()
      await expect.poll(width, { timeout: 10_000 }).toBe(8)
      await undo(window).click()
      await expect.poll(width, { timeout: 10_000 }).toBe(2)
    } finally {
      await closeStudio(studio)
    }
  })

  test('Size (px): "72" typed key by key is ONE step; one Undo gives the old size back', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t153-size-undo')
    const { window } = studio
    try {
      await startBlank(window)
      const fontSize = async (): Promise<number | undefined> => (await lastShape(window)).fontSize
      expect(await fontSize()).toBe(32)
      const size = field(window, 'Size (px)')
      await retype(size, '72')
      await leave(size)
      await expect.poll(fontSize, { timeout: 10_000 }).toBe(72)
      await undo(window).click()
      await expect.poll(fontSize, { timeout: 10_000, message: 'one Undo puts back 32, not the "7" on the way to "72"' }).toBe(32)
      await expect(size).toHaveValue('32')
    } finally {
      await closeStudio(studio)
    }
  })

  test('X (px) and Y (px): each is typed key by key, left, and undone by ONE Undo; the two are separate steps', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t153-xy-undo')
    const { window } = studio
    try {
      await startBlank(window)
      const start = await lastShape(window)
      expect(start.x, 'the fixture is not already at the typed numbers').not.toBe(50)
      const x = field(window, 'X (px)')
      const y = field(window, 'Y (px)')
      const pos = async (): Promise<[number, number]> => {
        const s = await lastShape(window)
        return [s.x, s.y]
      }

      await retype(x, '50')
      await leave(x)
      await retype(y, '40')
      await leave(y)
      await expect.poll(pos, { timeout: 10_000 }).toEqual([50, 40])
      await undo(window).click()
      await expect.poll(pos, { timeout: 10_000, message: 'one Undo takes back the Y run only, not the "4" on the way to "40"' }).toEqual([50, start.y])
      await undo(window).click()
      await expect.poll(pos, { timeout: 10_000, message: 'and the next takes back the X run whole' }).toEqual([start.x, start.y])
      await expect(x).toHaveValue(String(Math.round(start.x)))
    } finally {
      await closeStudio(studio)
    }
  })

  test('Rotation: "45" typed key by key is ONE step; a preset is its own step, and the first typed run after it is another', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t153-rotation-undo')
    const { window } = studio
    try {
      await startBlank(window)
      const angle = async (): Promise<number> => (await lastShape(window)).rotation
      expect(await angle()).toBe(0)
      const rotation = field(window, 'Rotation')
      await retype(rotation, '45')
      await leave(rotation)
      await expect.poll(angle, { timeout: 10_000 }).toBe(45)
      await window.getByRole('button', { name: 'Rotate 90 degrees' }).click()
      await expect.poll(angle, { timeout: 10_000 }).toBe(90)
      await retype(rotation, '30')
      await leave(rotation)
      await expect.poll(angle, { timeout: 10_000 }).toBe(30)

      await undo(window).click()
      await expect.poll(angle, { timeout: 10_000, message: 'the typed run after the preset is one step' }).toBe(90)
      await undo(window).click()
      await expect.poll(angle, { timeout: 10_000, message: 'the preset is one step' }).toBe(45)
      await undo(window).click()
      await expect.poll(angle, { timeout: 10_000, message: 'the first typed run is one step, not "4" then "45"' }).toBe(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-153 (7): Properties' position boxes say what they count
// ═══════════════════════════════════════════════════════════════════════════
// "x" and "y" were bare letters beside a number (BRANDING: a bare number is not a value); they read "X (px)" and "Y (px)" like Size (px) and Stroke (px), and the
// accessible names follow. The two share one grid row, so the longer words must stay on one line at the 1024 px minimum.
test.describe('Image Studio - the position boxes are labelled in pixels (T-153 (7))', () => {
  test('Properties says "X (px)" and "Y (px)", each on one line with its box whole, at the default window and the minimum; the bare letters are gone', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t153-xy-labels')
    const { app, window } = studio
    try {
      await startBlank(window)
      const card = propsCard(window)
      await expect(window.getByRole('spinbutton', { name: 'X (px)' })).toHaveCount(1)
      await expect(window.getByRole('spinbutton', { name: 'Y (px)' })).toHaveCount(1)
      await expect(card.getByText('x', { exact: true }), 'the bare letter is gone').toHaveCount(0)
      await expect(card.getByText('y', { exact: true }), 'the bare letter is gone').toHaveCount(0)
      for (const [size, where] of [
        [DEFAULT_WINDOW, 'the default 1632 px window'],
        [MIN_WINDOW, 'the 1024 px minimum']
      ] as const) {
        await resizeAndSettle(app, window, size)
        await expectOneLine(card.getByText('X (px)', { exact: true }), `the X label at ${where}`)
        await expectOneLine(card.getByText('Y (px)', { exact: true }), `the Y label at ${where}`)
        await expectNoHorizontalOverflow(card, `the Properties card at ${where}`)
        await expectControlsWhole(card, card.getByRole('spinbutton', { name: /^[XY] \(px\)$/ }), `the position boxes at ${where}`)
      }
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-153 (fold, T-110 (l)): the Export card's notes sit in one always-mounted status region
// ═══════════════════════════════════════════════════════════════════════════
// The size note and the JPG note were conditional paragraphs: a live region that appears together with its content is not reliably read, so a screen-reader user
// who picked JPG heard nothing. They sit in ONE `role="status"` wrapper that exists before the format changes (the GIF card's shape), and while it is empty it
// takes no room (the card is no taller than it was).
test.describe('Image Studio - the Export notes are announced (T-153 fold)', () => {
  const NOTE = 'JPG has no transparency: the clear parts come out black. Choose PNG to keep them clear.'

  test('the status region is in the card before JPG is picked, empty and taking no room; picking JPG puts the note INSIDE it, and PNG empties it again', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t153-export-status')
    const { window } = studio
    try {
      const overlay = templateById('tw-overlay-streamer')
      await templateCard(window, overlay).click()
      await expectTemplateApplied(window, overlay)
      const exportPanel = window.locator(EXPORT)
      const format = exportPanel.getByRole('combobox', { name: 'Export format' })
      // By role, so a region that is display:none (and so is not in the accessibility tree) is not found.
      const status = exportPanel.getByRole('status')
      await expect(status, 'one region, mounted before the note exists').toHaveCount(1)
      await expect(status).toHaveText('')
      // Empty, it adds no row under the Export button: the card's bottom edge is its padding (12 px) below the button.
      const gapBelow = async (): Promise<number> =>
        exportPanel.evaluate((card) => {
          const button = Array.from(card.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Export')
          if (!button) throw new Error('no Export button')
          return card.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom
        })
      expect(await gapBelow(), 'the empty region leaves no hole under the button').toBeLessThanOrEqual(13)

      await format.selectOption('jpg')
      await expect(status).toHaveCount(1)
      await expect(status.getByText(NOTE, { exact: true }), 'the note arrives inside the region that was already there').toBeVisible()
      await expect(status.locator('p')).toHaveCount(1)
      await format.selectOption('png')
      await expect(status).toHaveCount(1)
      await expect(status).toHaveText('')
      expect(await gapBelow()).toBeLessThanOrEqual(13)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-154 (3), (5): a layer's ✕, a held Ctrl+V and a double-clicked Import are each one action
// ═══════════════════════════════════════════════════════════════════════════
// (3) the next layer row moves up under the pointer when the first goes, so a double-click on Remove layer removed two. (5) a `paste` event carries no `repeat`, so a held
// Ctrl+V added an image layer per key repeat; the chord's keydown knows. The chooser's double click opened two choosers (the second press lands before the OS draws the first).
// Each repeat-press test waits past the half second App swallows repeats after a route change (T-153 (3)), or the second press never arrives.
test.describe('Image Studio - one press, one action (T-154 (3), (5))', () => {
  test('a real double-click on a layer\'s Remove layer removes ONE layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t154-layer-dblclick')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 3)
      await window.waitForTimeout(800)
      await window.locator(`${LAYERS} li`).first().getByRole('button', { name: 'Remove layer' }).dblclick()
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a held Ctrl+V pastes ONE image layer; a fresh Ctrl+V pastes another', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t154-held-paste')
    const { window } = studio
    try {
      await startBlank(window)
      await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
        clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
      }, `data:image/png;base64,${readFileSync(studio.fixturePng).toString('base64')}`)
      await window.waitForTimeout(800)
      // The first down is the press, the next are the key's auto-repeats.
      await window.keyboard.down('Control')
      await window.keyboard.down('v')
      await window.keyboard.down('v')
      await window.keyboard.down('v')
      await window.keyboard.down('v')
      await window.keyboard.up('v')
      await window.keyboard.up('Control')
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
      // A paste that is not the chord (Edit > Paste, the context menu: no keydown) right after the hold is a paste too: the key's release lets go of the hold.
      await studio.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.paste()
      })
      await expectLayerCount(window, 3)
      // A deliberate second press is a second paste.
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 4)
      await window.waitForTimeout(500)
      await expectLayerCount(window, 4)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a double-click on + Import image opens ONE chooser; once it answers, the next press opens another', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t154-chooser')
    const { window } = studio
    try {
      await startBlank(window)
      const choosers: Array<Awaited<ReturnType<Page['waitForEvent']>>> = []
      window.on('filechooser', (c) => choosers.push(c))
      await window.evaluate(() => {
        const click = HTMLInputElement.prototype.click
        HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
          if (this.type === 'file') (window as unknown as { __lastFileInput?: HTMLInputElement }).__lastFileInput = this
          return click.call(this)
        }
      })
      await window.waitForTimeout(800)
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).dblclick()
      await window.waitForTimeout(800)
      expect(choosers, 'a double-click opened one chooser').toHaveLength(1)
      // Two separate presses while that chooser is still up: still one.
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await window.waitForTimeout(500)
      expect(choosers, 'a second press while the chooser is open opens nothing').toHaveLength(1)
      await (choosers[0] as unknown as { setFiles: (f: string) => Promise<void> }).setFiles(studio.fixturePng)
      await expectLayerCount(window, 2)
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await expect.poll(() => choosers.length, { timeout: 10_000, message: 'a chooser that answered gives the button back' }).toBe(2)
      // A chooser that is dismissed gives it back too: the browser fires `cancel` on the input (a stand-in for the OS dialog's Cancel, which no automation reaches).
      await window.evaluate(() => {
        const input = (window as unknown as { __lastFileInput?: HTMLInputElement }).__lastFileInput
        if (!input) throw new Error('no file input was clicked')
        input.dispatchEvent(new Event('cancel'))
      })
      await window.locator(IMPORT).getByRole('button', { name: '+ Import image' }).click()
      await expect.poll(() => choosers.length, { timeout: 10_000, message: 'a chooser that was dismissed gives the button back' }).toBe(3)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-155 (2), (3): every paste chord is one paste; every add and a layer's Duplicate are one add per press
// ═══════════════════════════════════════════════════════════════════════════
// (2) the held-paste guard (T-154 (5)) knew only the letter V: Shift+Insert, and Ctrl+V on a layout whose `key` is not "v" (Russian: `key` "м", `code` "KeyV"), still pasted once per key repeat.
// (3) "+ Add text", "Start with text" and a layer's Duplicate ran again on a double-click or a held Enter (the duplicate shifts every row, so the second press copied the copy).
// Each repeat-press test waits past the half second App swallows repeats after a route change (T-153 (3)), or the second press never arrives.
test.describe('Image Studio - one paste, one add (T-155 (2), (3))', () => {
  async function putPngOnClipboard(studio: Studio): Promise<void> {
    await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
    }, `data:image/png;base64,${readFileSync(studio.fixturePng).toString('base64')}`)
  }
  const nativePaste = (studio: Studio): Promise<void> =>
    studio.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.paste()
    })

  test('a held Shift+Insert pastes ONE image layer; a fresh Shift+Insert pastes another', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t155-shift-insert')
    const { window } = studio
    try {
      await startBlank(window)
      await putPngOnClipboard(studio)
      await window.waitForTimeout(800)
      await window.keyboard.down('Shift')
      // The first down is the press, the next are the key's auto-repeats.
      await window.keyboard.down('Insert')
      await window.keyboard.down('Insert')
      await window.keyboard.down('Insert')
      await window.keyboard.down('Insert')
      await window.keyboard.up('Insert')
      await window.keyboard.up('Shift')
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
      // A paste that is not the chord (Edit > Paste: no keydown) right after the hold is a paste too: the key's release lets go of the hold.
      await nativePaste(studio)
      await expectLayerCount(window, 3)
      // A deliberate second press is a second paste.
      await window.keyboard.press('Shift+Insert')
      await expectLayerCount(window, 4)
      await window.waitForTimeout(500)
      await expectLayerCount(window, 4)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a held Ctrl+V on a non-Latin layout (code KeyV, key "м") pastes ONE image layer; a fresh chord pastes another', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t155-cyrillic-paste')
    const { window } = studio
    try {
      await startBlank(window)
      await putPngOnClipboard(studio)
      await window.waitForTimeout(800)
      const key = (type: 'keydown' | 'keyup', repeat: boolean): Promise<void> =>
        window.evaluate(
          ([t, r]) => {
            window.dispatchEvent(new KeyboardEvent(t as string, { code: 'KeyV', key: 'м', ctrlKey: t === 'keydown', repeat: r as boolean, bubbles: true, cancelable: true }))
          },
          [type, repeat] as const
        )
      // The OS sends a keydown and, with it, a paste; the key's auto-repeats send one each.
      await key('keydown', false)
      await nativePaste(studio)
      await expectLayerCount(window, 2)
      for (let i = 0; i < 3; i++) {
        await key('keydown', true)
        await nativePaste(studio)
        await window.waitForTimeout(250)
      }
      await key('keyup', false)
      await window.waitForTimeout(500)
      await expectLayerCount(window, 2)
      // A paste with no chord (Edit > Paste) after the release is a paste.
      await nativePaste(studio)
      await expectLayerCount(window, 3)
      // A deliberate second chord is a second paste.
      await key('keydown', false)
      await nativePaste(studio)
      await expectLayerCount(window, 4)
      await key('keyup', false)
      await window.waitForTimeout(500)
      await expectLayerCount(window, 4)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a real double-click and a held Enter on + Add text each add ONE text layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t155-add-text')
    const { window } = studio
    try {
      await startBlank(window)
      await window.waitForTimeout(800)
      const add = window.locator(IMPORT).getByRole('button', { name: '+ Add text' })
      await add.dblclick()
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
      await add.focus()
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await expectLayerCount(window, 3)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 3)
      // A fresh press is still an add.
      await add.click()
      await expectLayerCount(window, 4)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a real double-click and a held Enter on Start with text each start the canvas with ONE text layer', async () => {
    test.setTimeout(150_000)
    for (const how of ['double-click', 'held Enter'] as const) {
      const studio = await openStudio(`t155-start-text-${how === 'held Enter' ? 'enter' : 'dbl'}`)
      const { window } = studio
      try {
        await window.waitForTimeout(800)
        const start = window.getByRole('button', { name: 'Start with text' })
        if (how === 'double-click') await start.dblclick()
        else {
          await start.focus()
          await window.keyboard.down('Enter')
          await window.keyboard.down('Enter')
          await window.keyboard.down('Enter')
          await window.keyboard.up('Enter')
        }
        await expectLayerCount(window, 1)
        await window.waitForTimeout(800)
        await expectLayerCount(window, 1)
      } finally {
        await closeStudio(studio)
      }
    }
  })

  test('a real double-click and a held Enter on a layer\'s Duplicate each add ONE copy', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t155-duplicate')
    const { window } = studio
    try {
      await startBlank(window)
      await window.waitForTimeout(800)
      const duplicate = (): Locator => window.locator(`${LAYERS} li`).last().getByRole('button', { name: 'Duplicate layer' })
      await duplicate().dblclick()
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
      expect(await layerNames(window), 'one copy of the original, and no copy of the copy').toHaveLength(2)
      expect((await layerNames(window)).filter((n) => /copy copy/.test(n))).toEqual([])
      // The original is the bottom row; hold Enter on its Duplicate.
      await duplicate().focus()
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.down('Enter')
      await window.keyboard.up('Enter')
      await expectLayerCount(window, 3)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 3)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a real double-click on a lower layer\'s Duplicate leaves the copy selected, not the layer the rows shifted under the pointer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t155-duplicate-selection')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      // Rows are top first: the bottom layer is the last row. Select it, then double-click its Duplicate (one locator, so both presses land on the same point).
      const bottom = window.locator(`${LAYERS} li`).last()
      await bottom.getByRole('button', { name: /^Text/ }).first().click()
      await expect(bottom).toHaveAttribute('aria-current', 'true')
      const duplicate = bottom.getByRole('button', { name: 'Duplicate layer' })
      await duplicate.dblclick()
      await expectLayerCount(window, 3)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 3)
      // The copy went on top and is selected; the second press lands on the row that shifted under the pointer and must not select it.
      const current = window.locator(`${LAYERS} li[aria-current="true"]`)
      await expect(current, 'exactly one row is selected').toHaveCount(1)
      await expect(current.locator('span.truncate')).toHaveText('Text copy')
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio - Variants follow the Export card (T-160 (4))', () => {
  // The Variants button sits in the Export card right after "Output: W×H", but it captured at 1x and saved PNG only: on the 2K thumbnail
  // template (whose copy says "export at 0.5× to match"), Scale 0.5× and JPG read "Output: 1280×720" and Save all wrote 2560×1440 PNGs.
  /** The size in a JPEG's first start-of-frame marker (baseline or progressive), or throws. */
  function jpegSize(buf: Buffer): Size {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG')
    let at = 2
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) throw new Error(`no marker at ${at}`)
      const marker = buf[at + 1] as number
      if (marker === 0xc0 || marker === 0xc2) return { w: buf.readUInt16BE(at + 7), h: buf.readUInt16BE(at + 5) }
      at += 2 + buf.readUInt16BE(at + 2)
    }
    throw new Error('no frame header')
  }

  async function saveAllVariants(studio: Studio): Promise<Buffer[]> {
    const { window } = studio
    clearDownloads(studio)
    await answerDialogs(studio.app, 'save')
    const dialog = window.locator('[role="dialog"]')
    await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
    await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
    await dialog.getByRole('button', { name: 'Save all (3 + original)' }).click()
    await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Saved 4 thumbnails')
    return waitForDownloads(studio, 4)
  }

  test('the 2K thumbnail at 0.5× and JPG: Save all writes four 1280×720 JPEGs, and the dialog says so', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-card')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold-2k')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('0.5')
      await card.getByRole('combobox', { name: 'Export format' }).selectOption('jpg')
      await expect(card.getByTestId('export-output-size')).toHaveText('Output: 1280×720')

      await card.getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      const files = await saveAllVariants(studio)
      expect(savedNames(studio).map((n) => n.replace(/\d{10,}/, 'STAMP'))).toEqual([
        'imagii-variant-cool-STAMP.jpg',
        'imagii-variant-original-STAMP.jpg',
        'imagii-variant-punchy-STAMP.jpg',
        'imagii-variant-warm-STAMP.jpg'
      ])
      for (const buf of files) expect(jpegSize(buf), 'a JPEG of the size the card says').toEqual({ w: 1280, h: 720 })
      await expect(dialog.getByTestId('variants-output')).toContainText('Output: 1280×720 JPG, as the Export card')
    } finally {
      await closeStudio(studio)
    }
  })

  test('PNG at 1× on the 1280×720 template still writes four 1280×720 PNGs, and the dialog says PNG', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-card-png')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('1')
      await card.getByRole('button', { name: 'Variants' }).click()
      const files = await saveAllVariants(studio)
      expect(savedNames(studio).every((n) => n.endsWith('.png'))).toBe(true)
      for (const buf of files) expect(pngSize(buf)).toEqual({ w: 1280, h: 720 })
      await expect(window.locator('[role="dialog"]').getByTestId('variants-output')).toContainText('Output: 1280×720 PNG, as the Export card')
    } finally {
      await closeStudio(studio)
    }
  })
})

// T-161 (7): the Variants dialog says what the Export card says. T-160 (4) added the output line but left out the card's size note, and
// claimed "as the Export card" on an emote document, whose Export button writes the 28/56/112 pack.
test.describe('Image Studio - the Variants dialog repeats the card (T-161 (7))', () => {
  const BIGGER = "Bigger than YouTube's thumbnail size (1280×720)."

  test('the 1280×720 thumbnail at Scale 2× PNG: the dialog shows the card\'s size note before and after Generate', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-sizenote')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('2')
      await expect(card.getByTestId('export-output-size')).toHaveText('Output: 2560×1440')
      await expect(card).toContainText(BIGGER)

      await card.getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog.getByTestId('variants-output')).toContainText('Output: 2560×1440 PNG, as the Export card')
      await expect(dialog.getByTestId('variants-output')).toContainText(BIGGER)
      await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
      await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
      await expect(dialog.getByTestId('variants-output')).toContainText(BIGGER)
    } finally {
      await closeStudio(studio)
    }
  })

  test('an emote document: the line names the variants\' own 112×112 PNG and does not say "as the Export card"', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-emote')
    const { window } = studio
    try {
      const t = templateById('emote-blank-112')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const card = window.locator(EXPORT)
      // The card writes the pack, so "as the Export card" would be false here.
      await expect(card.getByTestId('export-output-size')).toHaveText('Output: 3 PNGs — 28×28, 56×56, 112×112')
      await card.getByRole('button', { name: 'Variants' }).click()
      const line = window.locator('[role="dialog"]').getByTestId('variants-output')
      await expect(line).toContainText('Output: 112×112 PNG')
      await expect(line).not.toContainText('as the Export card')
    } finally {
      await closeStudio(studio)
    }
  })

  test('PNG previews stay fresh when the JPG quality is changed and PNG is chosen again before reopening', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('variants-pngkeep')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('1')
      await card.getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
      await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)

      // Through JPG and back: the quality slider only exists at JPG, and a PNG ignores it.
      await card.getByRole('combobox', { name: 'Export format' }).selectOption('jpg')
      await card.getByLabel('JPG export quality').fill('0.5')
      await expect(card.getByLabel('JPG export quality')).toHaveValue('0.5')
      await card.getByRole('combobox', { name: 'Export format' }).selectOption('png')

      await card.getByRole('button', { name: 'Variants' }).click()
      await expect(window.locator('[role="dialog"]').locator('img')).toHaveCount(4)
      await expect(window.locator('[role="dialog"]').getByRole('button', { name: 'Generate 3 variants' })).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-162 (4): the channel-art template's sample name sits inside the TV-safe frame it advertises ─────────────────────────────────────────────
//
// "YOUR\nCHANNEL" at y 700 and 140 px on two lines ran y 700-980: below the TV-safe frame (551-889) and the all-device frame (508-931), under the
// template's own hint "TV-safe - keep load-bearing text inside". The sample is one line now, and the drawn text node (its real width at the font
// the machine resolves, not a computed one) is read against the drawn TV-safe rect.
test.describe('Image Studio — the channel-art sample name is inside its TV-safe frame (T-162 (4))', () => {
  /** A node's box in document units, by the template layer's index (the stage's children are the layers in order, after the background). */
  function layerBox(window: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
    return window.evaluate((i) => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        children: Array<{
          children: Array<{
            attrs: { name?: string }
            getClientRect(o: { relativeTo: unknown; skipStroke: boolean }): { x: number; y: number; width: number; height: number }
          }>
        }>
      }
      const layer = stage.children[0]
      if (!layer) throw new Error('no document layer on the stage')
      const node = layer.children.filter((n) => n.attrs.name !== 'background')[i]
      if (!node) throw new Error(`no node ${i} on the stage`)
      return node.getClientRect({ relativeTo: layer, skipStroke: true })
    }, index)
  }

  test('applying the template draws the sample\'s whole text box inside the TV-safe rect, below the hint line', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t162-banner')
    const { window } = studio
    try {
      const t = templateById('yt-banner-channel')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const at = (name: string): number => t.doc.layers.findIndex((l) => l.name === name)
      const tv = await layerBox(window, at('TV-safe area'))
      const hint = await layerBox(window, at('Safe area hint'))
      const sample = await layerBox(window, at('Channel name'))
      const where = `sample ${JSON.stringify(sample)} in TV-safe ${JSON.stringify(tv)}`
      expect(sample.x, `${where}: left edge`).toBeGreaterThanOrEqual(tv.x)
      expect(sample.x + sample.width, `${where}: right edge`).toBeLessThanOrEqual(tv.x + tv.width)
      expect(sample.y, `${where}: top edge`).toBeGreaterThanOrEqual(tv.y)
      expect(sample.y + sample.height, `${where}: bottom edge`).toBeLessThanOrEqual(tv.y + tv.height)
      expect(sample.y, 'clear of the hint line above it').toBeGreaterThanOrEqual(hint.y + hint.height)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-163 (4): Ctrl+V stands down for an open dialog ──────────────────────────────────────────────────────────────────────────────────────────
//
// ImportPanel's window-level `paste` listener was the one studio key that did not ask `anyDialogClaim()`: Ctrl+V with a picture on the clipboard while
// the Variants or the Templates dialog was open added a layer behind the scrim, and an open Variants dialog lost its previews (and the focused button
// with them) because the document under it had changed. The pastes below are REAL: a picture on Electron's clipboard and a real chord.
test.describe('Image Studio - Ctrl+V stands down for an open dialog (T-163 (4))', () => {
  async function putPictureOnClipboard(studio: Studio): Promise<void> {
    await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
    }, `data:image/png;base64,${readFileSync(studio.fixturePng).toString('base64')}`)
    await studio.window.waitForTimeout(800)
  }

  test('with the Variants dialog open (previews generated), Ctrl+V adds no layer, the previews stay and the focused button keeps focus', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t163-paste-variants')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      await window.locator(EXPORT).getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
      await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
      const saveAll = dialog.getByRole('button', { name: /^Save all/ })
      await expect(saveAll).toBeFocused()

      await putPictureOnClipboard(studio)
      await window.keyboard.press('Control+v')
      await window.waitForTimeout(1500)
      await expectLayerCount(window, t.doc.layers.length)
      await expect(dialog.locator('img'), 'the previews are still there').toHaveCount(4)
      await expect(saveAll, 'and the button that had focus still has it').toBeFocused()

      // The control, in the same flow: once the dialog is closed the same chord adds the picture.
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, t.doc.layers.length + 1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('with the Templates dialog open, Ctrl+V adds no layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t163-paste-templates')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      await putPictureOnClipboard(studio)
      await window.keyboard.press('Control+v')
      await window.waitForTimeout(1500)
      await expectLayerCount(window, 1)
      await expect(dialog, 'the dialog is still the one on screen').toBeVisible()
    } finally {
      await closeStudio(studio)
    }
  })

  test('control: with no dialog open, Ctrl+V still adds the picture as a layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t163-paste-control')
    const { window } = studio
    try {
      await startBlank(window)
      await expect(window.locator('[role="dialog"]')).toHaveCount(0)
      await putPictureOnClipboard(studio)
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-164 (7): Ctrl+V into a focused text field pastes the text ────────────────────────────────────────────────────────────────────────────
//
// ImportPanel's window-level `paste` listener did not ask whether a text field owns the paste (the other studio keys ask `focusOwnsKey`): with a clipboard
// that holds text AND a picture (an office app writes both), Ctrl+V in Properties' Name box added an image layer and swallowed the text. The clipboard is
// REAL (Electron's `clipboard.write` with both formats) and so is the chord.
test.describe('Image Studio - Ctrl+V into a focused text field pastes the text (T-164 (7))', () => {
  async function putTextAndPictureOnClipboard(studio: Studio): Promise<void> {
    await studio.app.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
      clipboard.write({ text: 'PASTED', image: nativeImage.createFromDataURL(dataUrl) })
    }, `data:image/png;base64,${readFileSync(studio.fixturePng).toString('base64')}`)
    await studio.window.waitForTimeout(800)
  }

  test('a mixed clipboard pasted into the Name box puts the text in the box and adds no layer; with the canvas focused it still adds the picture', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t164-paste-field')
    const { window } = studio
    try {
      await startBlank(window)
      const name = field(window, 'Name')
      await expect(name).toBeVisible()
      await putTextAndPictureOnClipboard(studio)

      await name.click()
      await window.keyboard.press('Control+a')
      await window.keyboard.press('Control+v')
      await expect(name, 'the text is what the box now holds').toHaveValue('PASTED')
      await window.waitForTimeout(1200)
      await expectLayerCount(window, 1)

      // The control, in the same flow and the same clipboard: the focus leaves the field (a click on the empty canvas) and the chord adds the picture.
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await clickDoc(window, { x: 1100, y: 750 })
      await expect(name).toHaveCount(0)
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })

  // The text layer's "Text" box is a <textarea>, the likeliest place to paste a title copied from a document: the guard covers every text-entry element, not <input> alone.
  test('a mixed clipboard pasted into the Text textarea puts the text in the box and adds no layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t164-paste-textarea')
    const { window } = studio
    try {
      await startBlank(window)
      const text = field(window, 'Text')
      await expect(text).toBeVisible()
      expect(await text.evaluate((el) => el.tagName)).toBe('TEXTAREA')
      await putTextAndPictureOnClipboard(studio)

      await text.click()
      await window.keyboard.press('Control+a')
      await window.keyboard.press('Control+v')
      await expect(text, 'the text is what the box now holds').toHaveValue('PASTED')
      await window.waitForTimeout(1200)
      await expectLayerCount(window, 1)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-164 (8): the selection handles are the palette's ─────────────────────────────────────────────────────────────────────────────────────
//
// The <Transformer> set no colours, so its border and anchors were Konva's stock rgb(0, 161, 255): a second accent beside the one BRANDING allows. The
// strokes read off the real stage are the accent token and the anchor fill is the ink token, on a white page and on a dark template.
test.describe('Image Studio - the selection handles wear the palette (T-164 (8))', () => {
  function transformerColors(window: Page): Promise<{ border: string; anchorStroke: string; anchorFill: string }> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        findOne(sel: string): { borderStroke(): string; anchorStroke(): string; anchorFill(): string } | undefined
      }
      const tr = stage.findOne('Transformer')
      if (!tr) throw new Error('no Transformer on the stage')
      return { border: tr.borderStroke(), anchorStroke: tr.anchorStroke(), anchorFill: tr.anchorFill() }
    })
  }

  test('with a layer selected on the white page, and on a dark template, the border and anchor strokes are the accent and the anchor fill is ink-base', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t164-handles')
    const { window } = studio
    try {
      await startBlank(window)
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(1)
      expect(await transformerColors(window), 'white page').toEqual({ border: ACCENT, anchorStroke: ACCENT, anchorFill: INK_BASE })

      const t = templateById('yt-thumb-bold')
      expect(t.doc.background, 'the template is dark').not.toBe('#ffffff')
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      await window.locator('[role="dialog"]').locator('button.card').filter({ has: window.getByText(t.name, { exact: true }) }).click()
      await expectTemplateApplied(window, t)
      await layerRow(window, t.doc.layers[0]!.name).click()
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(1)
      expect(await transformerColors(window), 'dark template').toEqual({ border: ACCENT, anchorStroke: ACCENT, anchorFill: INK_BASE })
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-164 (9): the template tiles lay their content from the top ───────────────────────────────────────────────────────────────────────────
//
// A <button> in a stretched grid cell centres its content, so a tile with a longer description started its preview lower than its neighbour's. In the
// empty state's grid and in the Templates dialog's, the previews of one row share a top, at the narrowest window.
test.describe('Image Studio - template tile previews line up across a row (T-164 (9))', () => {
  /** Tiles grouped into rows by their own top; each row's preview tops (client rects), read in one pass. */
  function rowsOfPreviewTops(tiles: Locator): Promise<Array<{ tileTop: number; previewTops: number[]; names: string[] }>> {
    return tiles.evaluateAll((els) => {
      const rows: Array<{ tileTop: number; previewTops: number[]; names: string[] }> = []
      for (const el of els) {
        const top = el.getBoundingClientRect().top
        const preview = el.firstElementChild as HTMLElement
        const row = rows.find((r) => Math.abs(r.tileTop - top) <= 1)
        const entry = { top: preview.getBoundingClientRect().top, name: (el.querySelector('.font-medium')?.textContent ?? '') }
        if (row) {
          row.previewTops.push(entry.top)
          row.names.push(entry.name)
        } else rows.push({ tileTop: top, previewTops: [entry.top], names: [entry.name] })
      }
      return rows
    })
  }

  function expectRowsLineUp(rows: Array<{ tileTop: number; previewTops: number[]; names: string[] }>, what: string): void {
    expect(rows.some((r) => r.previewTops.length >= 2), `${what}: the grid has a row of two or more tiles`).toBe(true)
    for (const r of rows) {
      const spread = Math.max(...r.previewTops) - Math.min(...r.previewTops)
      expect(spread, `${what}: the previews of the row [${r.names.join(' | ')}] start at ${r.previewTops.map((n) => n.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(1)
    }
  }

  test('at the narrowest window, the empty state\'s grid and the Templates dialog\'s each have previews that share a top within a row', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t164-tiles')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, MIN_WINDOW)
      const tiles = window.locator('button.card')
      await expect(tiles).toHaveCount(CANVAS_TEMPLATES.length)
      expectRowsLineUp(await rowsOfPreviewTops(tiles), 'the empty state')

      await startBlank(window)
      await window.locator(IMPORT).getByRole('button', { name: 'Templates' }).click()
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog.locator('button.card')).toHaveCount(CANVAS_TEMPLATES.length)
      expectRowsLineUp(await rowsOfPreviewTops(dialog.locator('button.card')), 'the Templates dialog')
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-165 Track A: pastes, selects and names things the way a person expects ─────────────────────────────────────────────────────────────────
//
// (1) T-164 (7)'s guard returned for ANY text-entry target before it looked at the clipboard, so a snipped picture pasted with focus in Properties' Name box
// added nothing and said nothing. (fold) A clipboard with words and no picture did nothing beside "Drop, paste (Ctrl+V), or pick a file." (6) The selection
// frame was the accent on the rectangle tool's own accent stroke. (7) An emote template's name was a description with unitless numbers. Every clipboard
// here is REAL (Electron's `clipboard`, cleared first) and so is every chord.
test.describe('Image Studio - pastes, selection frame and emote names (T-165 Track A)', () => {
  async function putOnClipboard(studio: Studio, what: 'picture' | 'words' | 'both' | 'blank'): Promise<void> {
    await studio.app.evaluate(
      async ({ clipboard, nativeImage }, { kind, dataUrl }) => {
        clipboard.clear()
        if (kind === 'picture') clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
        else if (kind === 'words') clipboard.writeText('PASTED WORDS')
        else if (kind === 'both') clipboard.write({ text: 'PASTED WORDS', image: nativeImage.createFromDataURL(dataUrl) })
        else clipboard.writeText('   \n  ')
      },
      { kind: what, dataUrl: `data:image/png;base64,${readFileSync(studio.fixturePng).toString('base64')}` }
    )
    await studio.window.waitForTimeout(800)
  }

  const WORDS = 'PASTED WORDS'
  const REFUSAL = 'Paste a picture to start from it, or pick a template to add your text to.'

  /** The canvas open with its one text layer, and the focus on the canvas (a click on empty paper) rather than in a field. */
  async function openCanvasFocusedOnPaper(window: Page): Promise<void> {
    await startBlank(window)
    await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
    await clickDoc(window, { x: 1100, y: 750 })
    await expect(field(window, 'Name')).toHaveCount(0)
  }

  test('a picture alone on the clipboard, pasted with focus in the Name box, adds the image layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-picture-field')
    const { window } = studio
    try {
      await startBlank(window)
      const name = field(window, 'Name')
      await expect(name).toBeVisible()
      await putOnClipboard(studio, 'picture')
      await name.click()
      await expect(name).toBeFocused()
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 2)
      await expectShapeCount(window, 2)
      expect((await lastShape(window)).cls).toBe('Image')
    } finally {
      await closeStudio(studio)
    }
  })

  test('control (T-164): words AND a picture pasted into the focused Name box put the words in the box and add no layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-both-field')
    const { window } = studio
    try {
      await startBlank(window)
      const name = field(window, 'Name')
      await putOnClipboard(studio, 'both')
      await name.click()
      await window.keyboard.press('Control+a')
      await window.keyboard.press('Control+v')
      await expect(name).toHaveValue(WORDS)
      await window.waitForTimeout(1200)
      await expectLayerCount(window, 1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('control: words alone pasted into the focused Name box fill the box and add no text layer', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-words-field')
    const { window } = studio
    try {
      await startBlank(window)
      const name = field(window, 'Name')
      await putOnClipboard(studio, 'words')
      await name.click()
      await window.keyboard.press('Control+a')
      await window.keyboard.press('Control+v')
      await expect(name).toHaveValue(WORDS)
      await window.waitForTimeout(1200)
      await expectLayerCount(window, 1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('words alone on the clipboard, pasted with the canvas open and no field focused, add one selected text layer holding them, and Ctrl+Z removes it', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-words')
    const { window } = studio
    try {
      await openCanvasFocusedOnPaper(window)
      await putOnClipboard(studio, 'words')
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 2)
      await expectShapeCount(window, 2)
      const shapes = await stageShapes(window)
      expect(shapes.filter((s) => s.text === WORDS), 'exactly one layer holds the pasted words').toHaveLength(1)
      expect(shapes[1]?.cls).toBe('Text')
      expect(shapes[1]?.text).toBe(WORDS)
      // Selected: the Properties card is on it and the Transformer is attached to it.
      await expect(field(window, 'Text')).toHaveValue(WORDS)
      expect(await transformerClasses(window)).toEqual(['Text'])

      await window.keyboard.press('Control+z')
      await expectLayerCount(window, 1)
      expect((await stageShapes(window)).some((s) => s.text === WORDS)).toBe(false)
      expect(await toastsAfterSettling(studio)).toEqual([])
    } finally {
      await closeStudio(studio)
    }
  })

  test('control: a whitespace-only clipboard adds nothing and raises no toast', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-blank')
    const { window } = studio
    try {
      await openCanvasFocusedOnPaper(window)
      await putOnClipboard(studio, 'blank')
      await window.keyboard.press('Control+v')
      await window.waitForTimeout(1500)
      await expectLayerCount(window, 1)
      expect(await toastsAfterSettling(studio)).toEqual([])
    } finally {
      await closeStudio(studio)
    }
  })

  test('words alone pasted on the empty start screen say what to paste instead, and nothing is added', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-words-start')
    const { window } = studio
    try {
      await putOnClipboard(studio, 'words')
      await window.keyboard.press('Control+v')
      await expect.poll(() => readToastLog(window), { timeout: 10_000 }).toEqual([REFUSAL])
      await window.waitForTimeout(800)
      await expect(window.getByText('Pick a template to start')).toBeVisible()
      await expect(window.locator('button.card')).toHaveCount(CANVAS_TEMPLATES.length)
      await expect(window.locator(LAYERS)).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })

  /** What a person sees of the selection frame: the Transformer's own props, read off the real stage. */
  function transformerFrame(window: Page): Promise<{ padding: number; borderDash: number[] }> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        findOne(sel: string): { padding(): number; borderDash(): number[] } | undefined
      }
      const tr = stage.findOne('Transformer')
      if (!tr) throw new Error('no Transformer on the stage')
      return { padding: tr.padding(), borderDash: tr.borderDash() }
    })
  }

  test('the selection frame stands 4 px off the layer and is dashed', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-frame-props')
    const { window } = studio
    try {
      await startBlank(window)
      await expect.poll(() => transformerNodeCount(window), { timeout: 10_000 }).toBe(1)
      expect(await transformerFrame(window)).toEqual({ padding: 4, borderDash: [6, 4] })
    } finally {
      await closeStudio(studio)
    }
  })

  test('a fresh rectangle selected on the white page: the page shows between its stroke and the frame, and the frame is a few pixels out', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-frame-gap')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await window.keyboard.press('r')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
      await dragOnStage(window, { x: 200, y: 150 }, { x: 400, y: 300 })
      await expectLayerCount(window, 2)
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await expect.poll(() => transformerClasses(window), { timeout: 10_000 }).toEqual(['Rect'])
      // Take the pointer off the canvas so no hover state is painted into the shot.
      await window.mouse.move(2, 2)
      await window.waitForTimeout(400)

      const rect = await lastShape(window)
      const geom = await stageGeom(window)
      // A quarter of the way along the top edge, not its middle: the middle is where the top handle and the rotation handle's stalk sit, and a corner is a handle too.
      // The span is 30 px wide so it holds a dash of the frame whatever the dash's phase.
      const x = Math.round(geom.left + (rect.x + (rect.width as number) / 4) * geom.scale) - 15
      // The stroke is centred on the box's edge: its outer edge is half a stroke above the top. Rows are counted up from there.
      const edge = Math.round(geom.top + rect.y * geom.scale - ((rect.strokeWidth ?? 0) / 2) * geom.scale)
      const shot = await window.screenshot()
      const white = hexRgb('#ffffff')
      // The gap: the three rows just outside the stroke are the page (the frame stands 4 px off the layer; on the unpadded frame it was ON the stroke).
      expect(await pixelsOtherThanBackground(studio, shot, { x, y: edge - 3, w: 30, h: 3 }, white), `rows ${edge - 3}-${edge - 1} above the stroke at x ${x}-${x + 29}: the page, no ink`).toBe(0)
      // The frame: dashes of it, 4 to 7 rows out.
      expect(await pixelsOtherThanBackground(studio, shot, { x, y: edge - 7, w: 30, h: 4 }, white), `rows ${edge - 7}-${edge - 4} above the stroke at x ${x}-${x + 29}: the frame's dashes`).toBeGreaterThan(0)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the template grid names the blank emote "Emote · Blank circle", and both emote tiles say they export the 3-PNG pack', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-emote-names')
    const { window } = studio
    try {
      const tiles = window.locator('button.card')
      const blank = tiles.filter({ has: window.getByText('Emote · Blank circle', { exact: true }) })
      const text = tiles.filter({ has: window.getByText('Emote · Text "POG"', { exact: true }) })
      await expect(blank).toHaveCount(1)
      await expect(text).toHaveCount(1)
      await expect(blank).toContainText('28, 56, and 112 px')
      await expect(text).toContainText('28, 56, and 112 px')
      await expect(window.getByText('auto-exports', { exact: false })).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })


  // The fold is a second thing a paste can do, so the held-chord guard (T-154 (5)) has to stand in front of it too: a held Ctrl+V is one text layer, not one per key repeat.
  test('a held Ctrl+V with words on the clipboard adds ONE text layer; a fresh Ctrl+V adds another', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-held-words')
    const { window } = studio
    try {
      await openCanvasFocusedOnPaper(window)
      await putOnClipboard(studio, 'words')
      // The first down is the press, the next are the key's auto-repeats.
      await window.keyboard.down('Control')
      await window.keyboard.down('v')
      await window.keyboard.down('v')
      await window.keyboard.down('v')
      await window.keyboard.up('v')
      await window.keyboard.up('Control')
      await expectLayerCount(window, 2)
      await window.waitForTimeout(800)
      await expectLayerCount(window, 2)
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 3)
      await window.waitForTimeout(500)
      await expectLayerCount(window, 3)
    } finally {
      await closeStudio(studio)
    }
  })


  // The pasted layer is the "+ Add text" layer with the person's words: sized, placed, inked and set in the face for THE OPEN document (`textLayerFor(doc)`), not a fixed look.
  // The dark "yt-thumb-bold" template is the document: its ink is decided against what is drawn there (light on dark), so a layer made for another document differs.
  // T-166 (1): the box it is placed by is the words' own, so the two layers are the same look up to the words' WIDTH: the same size, row, ink and face, and the same 60 px margin from the
  // same (top-right) corner - the pasted words' left edge is further left by exactly how much wider they are. (This case pinned the one-line "Text" box: it asserted x equal.)
  test('a pasted text layer looks like "+ Add text" on the same dark template (size, row, ink, face, and the same margin from the same corner)', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t165-paste-look')
    const { window } = studio
    try {
      const t = templateById('yt-thumb-bold')
      expect(t.doc.background, 'the document is dark').not.toBe('#ffffff')
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const n = t.doc.layers.length
      const look = (s: ShapeInfo): Record<string, unknown> => ({ cls: s.cls, x: s.x, y: s.y, fontSize: s.fontSize, fill: s.fill, rotation: s.rotation, scaleX: s.scaleX, scaleY: s.scaleY, opacity: s.opacity, fontFamily: (s as ShapeInfo & { fontFamily?: string }).fontFamily })

      await putOnClipboard(studio, 'words')
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, n + 1)
      const pasted = await lastShape(window)
      expect(pasted.text).toBe(WORDS)

      await window.keyboard.press('Control+z')
      await expectLayerCount(window, n)
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, n + 1)
      const added = await lastShape(window)
      expect(added.text).toBe('Text')
      const { x: pastedX, ...pastedLook } = look(pasted)
      const { x: addedX, ...addedLook } = look(added)
      expect(pastedLook, 'the pasted layer is the "+ Add text" layer, but for its words').toEqual(addedLook)
      // The right edges agree (by the editor's estimate, the placement's own box): both are 60 px in from the page's right edge.
      // T-167 (fold): the estimate is each character's measured advance now, so the widths are not `0.6 em * length` (7.2 em for "PASTED WORDS" and 2.4 em for "Text") but 8.19 em and 2.20 em
      // (`newText.test.ts` holds the table).
      const fontSize = pasted.fontSize as number
      expect((pastedX as number) + 8.19 * fontSize, 'the pasted words end where "Text" did').toBeCloseTo((addedX as number) + 2.2 * fontSize, 6)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-166 Track A: pasted words land whole, inside the picture and readable ──────────────────────────────────────────────────────────────────
//
// (1) T-165's words branch built `{ ...textLayerFor(doc), text: words }`, and `textLayerFor` sized, placed and inked for the word "Text": a pasted "Subscribe now for more
// streams" on the Bold thumbnail landed at x=1150 (its right edge about 70% off the 1280 page) and on a 112 px emote it was inked 1.00:1. (fold) the shortcuts overlay's
// Ctrl+V row said "Paste image from clipboard". Every clipboard is REAL (Electron's `clipboard`) and so is every chord; the box is the one Konva MEASURED, not an estimate.
test.describe('Image Studio - pasted words land whole, inside the page and readable (T-166 Track A)', () => {
  const SENTENCE = 'Subscribe now for more streams'
  const INKS = { dark: BG_BASE, light: INK_BASE, behind: BG_BASE }

  async function putTextOnClipboard(studio: Studio, text: string): Promise<void> {
    await studio.app.evaluate(({ clipboard }, t) => {
      clipboard.clear()
      clipboard.writeText(t)
    }, text)
    await studio.window.waitForTimeout(800)
  }

  /** The last text layer's box as the stage DREW it: its own x, y and the width and height Konva measured for it (not the editor's estimate). */
  function lastTextBox(window: Page): Promise<{ x: number; y: number; width: number; height: number; fontSize: number; fill: string; text: string }> {
    return window.evaluate(() => {
      const stage = (window as unknown as { __imagiiStage?: unknown }).__imagiiStage as {
        children: Array<{ children: Array<{ getClassName(): string; attrs: { name?: string; x: number; y: number; fontSize: number; fill: string; text: string }; width(): number; height(): number }> }>
      }
      const nodes = stage.children[0]!.children.filter((n) => n.attrs.name !== 'background')
      const n = nodes[nodes.length - 1]!
      if (n.getClassName() !== 'Text') throw new Error(`the last node is a ${n.getClassName()}, not a Text`)
      return { x: n.attrs.x, y: n.attrs.y, width: n.width(), height: n.height(), fontSize: n.attrs.fontSize, fill: n.attrs.fill, text: n.attrs.text }
    })
  }

  /** The template open, the canvas focused on a spot of bare paper (a click with the Select tool, no field focused), and the sentence pasted with a real Ctrl+V. */
  async function pasteOnTemplate(studio: Studio, id: string, paper: { x: number; y: number }): Promise<{ t: CanvasTemplate; box: Awaited<ReturnType<typeof lastTextBox>> }> {
    const { window } = studio
    const t = templateById(id)
    await templateCard(window, t).click()
    await expectTemplateApplied(window, t)
    await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
    await clickDoc(window, paper)
    await expect(field(window, 'Name')).toHaveCount(0)
    await putTextOnClipboard(studio, SENTENCE)
    await window.keyboard.press('Control+v')
    await expectLayerCount(window, t.doc.layers.length + 1)
    const box = await lastTextBox(window)
    expect(box.text).toBe(SENTENCE)
    test.info().annotations.push({ type: `${id} stage box`, description: JSON.stringify({ x: box.x, y: box.y, width: Math.round(box.width), height: box.height, right: Math.round(box.x + box.width), page: `${t.doc.width}x${t.doc.height}`, fontSize: box.fontSize, fill: box.fill }) })
    return { t, box }
  }

  function expectWhollyInsideAndReadable(t: CanvasTemplate, box: Awaited<ReturnType<typeof lastTextBox>>): void {
    expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
    expect(box.y, 'top edge').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `right edge ${Math.round(box.x + box.width)} of ${t.doc.width}`).toBeLessThanOrEqual(t.doc.width)
    expect(box.y + box.height, `bottom edge ${Math.round(box.y + box.height)} of ${t.doc.height}`).toBeLessThanOrEqual(t.doc.height)
    const under = surfacesUnder(t.doc, { x: box.x, y: box.y, width: box.width, height: box.height }, BG_BASE)
    expect(worstContrast(box.fill, under, INKS), `${box.fill} on ${under.join(', ')}`).toBeGreaterThanOrEqual(READABLE_CONTRAST)
  }

  test('"YouTube · Bold thumbnail": the pasted sentence is wholly inside the 1280x720 page, and readable', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t166-paste-thumb')
    try {
      const { t, box } = await pasteOnTemplate(studio, 'yt-thumb-bold', { x: 20, y: 450 })
      expect(t.name).toBe('YouTube · Bold thumbnail')
      expectWhollyInsideAndReadable(t, box)
    } finally {
      await closeStudio(studio)
    }
  })

  test('"Emote · Blank circle": the pasted sentence is wholly inside the 112x112 page, and readable (it was inked 1.00:1)', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t166-paste-emote')
    try {
      const { t, box } = await pasteOnTemplate(studio, 'emote-blank-112', { x: 3, y: 3 })
      expect(t.name).toBe('Emote · Blank circle')
      expectWhollyInsideAndReadable(t, box)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the shortcuts overlay in Stream Graphics says what Ctrl+V does: "Paste a picture, or words as a text layer"', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t166-overlay-row')
    const { window } = studio
    try {
      await window.keyboard.press('?')
      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.getByText('Paste a picture, or words as a text layer', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Paste image from clipboard')).toHaveCount(0)
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-167 Track A: a pasted text stays on the page, and a no-op edit leaves Undo's Redo alone ────────────────────────────────────────────────────────────────────────────────────────────
//
// (1) `candidatePlaces` took its home from `placementFor`, a PICTURE rule that scales a box down to 800 px first, so 25 pasted lines on the default page landed with their real bottom at 859 of
// 800. The clipboard is REAL (Electron's `clipboard`), so is the chord, and the box is the one Konva MEASURED (`getClientRect` relative to the document layer = document units), not the
// editor's estimate. (2) The "0" rotation preset on a layer already at 0, after an Undo, recorded a step and wiped Redo.
test.describe('Image Studio - a tall paste stays on the page, and a no-op rotation keeps Redo (T-167 Track A)', () => {
  /** The last Text node's rectangle as Konva MEASURED it, in document units, and the page's own size (the background node). */
  function lastTextRect(window: Page): Promise<{ x: number; y: number; width: number; height: number; fontSize: number; text: string; page: { width: number; height: number } }> {
    return window.evaluate(() => {
      type N = { getClassName(): string; attrs: { name?: string; fontSize: number; text: string }; getClientRect(o: { relativeTo: unknown }): { x: number; y: number; width: number; height: number }; getParent(): unknown; width(): number; height(): number }
      const stage = (window as unknown as { __imagiiStage?: { children: Array<{ children: N[] }> } }).__imagiiStage
      if (!stage) throw new Error('no stage')
      const kids = stage.children[0]!.children
      const background = kids.find((n) => n.attrs.name === 'background')
      const nodes = kids.filter((n) => n.attrs.name !== 'background')
      const n = nodes[nodes.length - 1]!
      if (n.getClassName() !== 'Text') throw new Error(`the last node is a ${n.getClassName()}, not a Text`)
      const r = n.getClientRect({ relativeTo: n.getParent() })
      return { x: r.x, y: r.y, width: r.width, height: r.height, fontSize: n.attrs.fontSize, text: n.attrs.text, page: { width: background!.width(), height: background!.height() } }
    })
  }

  async function putTextOnClipboard(studio: Studio, text: string): Promise<void> {
    await studio.app.evaluate(({ clipboard }, t) => {
      clipboard.clear()
      clipboard.writeText(t)
    }, text)
    await studio.window.waitForTimeout(800)
  }

  test('25 pasted lines of 45 characters on the default page land with their whole measured box inside it', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t167-tall-paste')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await clickDoc(window, { x: 1100, y: 750 })
      await expect(field(window, 'Name')).toHaveCount(0)
      // (capitals, so the box is over 800 px wide by the editor's estimate - the case the picture rule shrank - and still inside the 1200 px page as drawn)
      const script = Array.from({ length: 25 }, (_, i) => `${String(i + 1).padStart(2, '0')} ${'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG'.slice(0, 42)}`)
      expect(script.every((l) => l.length === 45)).toBe(true)
      await putTextOnClipboard(studio, script.join('\n'))
      await window.keyboard.press('Control+v')
      await expectLayerCount(window, 2)
      const box = await lastTextRect(window)
      expect(box.text).toBe(script.join('\n'))
      test.info().annotations.push({ type: 'stage box', description: JSON.stringify({ ...box, right: box.x + box.width, bottom: box.y + box.height }) })
      expect(box.page).toEqual({ width: 1200, height: 800 })
      expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
      expect(box.y, 'top edge').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, `right edge ${box.x + box.width} of ${box.page.width}`).toBeLessThanOrEqual(box.page.width)
      expect(box.y + box.height, `bottom edge ${box.y + box.height} of ${box.page.height}`).toBeLessThanOrEqual(box.page.height)
      expect(box.height, 'it is all 25 lines tall, not a shrunken box').toBeGreaterThan(700)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a rectangle rotated 45 by its preset, Undone, then given the "0" preset: Redo is still enabled (a rotation to where it already is records nothing)', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t167-noop-rotation')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 300, y: 250 }, { x: 600, y: 450 })
      await expectLayerCount(window, 2)
      const angle = async (): Promise<number> => (await lastShape(window)).rotation
      const redo = window.getByRole('button', { name: 'Redo' })
      expect(await angle()).toBe(0)

      await window.getByRole('button', { name: 'Rotate 45 degrees' }).click()
      await expect.poll(angle, { timeout: 10_000 }).toBe(45)
      await window.keyboard.press('Control+z')
      await expect.poll(angle, { timeout: 10_000, message: 'Ctrl+Z took the rotation back' }).toBe(0)
      await expect(redo, 'the rotation is in Redo').toBeEnabled()

      await window.getByRole('button', { name: 'Rotate 0 degrees' }).click()
      await expect.poll(angle, { timeout: 10_000 }).toBe(0)
      await expect(redo, 'the "0" preset on a layer already at 0 changed nothing, so Redo is kept').toBeEnabled()

      // ...and Redo still brings the 45 back.
      await redo.click()
      await expect.poll(angle, { timeout: 10_000 }).toBe(45)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// T-172 Track B (items 3 and 6): the channel banner is not told it is a thumbnail, and the template card is one component.
// ---------------------------------------------------------------------------------------------------------------------------------------
test.describe('Image Studio - the channel banner and the template card (T-172 Track B)', () => {
  const BIGGER = "Bigger than YouTube's thumbnail size"

  test('the "YouTube · Channel banner" template: no thumbnail size note on the Export card or in Variants; the 2K thumbnail template, the same size, still has it', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t172-banner')
    const { window } = studio
    try {
      const banner = templateById('yt-banner-channel')
      await templateCard(window, banner).click()
      await expectTemplateApplied(window, banner)
      const card = window.locator(EXPORT)
      for (const scale of ['1', '2', '0.5']) {
        await card.getByLabel('Scale').selectOption(scale)
        await expect(card.getByTestId('export-output-size')).toHaveText(
          `Output: ${banner.doc.width * Number(scale)}×${banner.doc.height * Number(scale)}`
        )
        await expect(card, `a banner at ${scale}x is not a thumbnail`).not.toContainText(BIGGER)
      }
      await card.getByLabel('Scale').selectOption('1')
      await card.getByRole('button', { name: 'Variants' }).click()
      const dialog = window.locator('[role="dialog"]')
      await expect(dialog.getByTestId('variants-output')).toContainText('Output: 2560×1440 PNG, as the Export card')
      await expect(dialog.getByTestId('variants-output')).not.toContainText(BIGGER)
      await dialog.getByRole('button', { name: 'Generate 3 variants' }).click()
      await expect(dialog.locator('img')).toHaveCount(4, { timeout: 30_000 })
      await expect(dialog.getByTestId('variants-output')).not.toContainText(BIGGER)
    } finally {
      await closeStudio(studio)
    }
  })

  test('control: "YouTube · Bold thumbnail (2K)", 2560×1440 like the banner, says it is bigger on the Export card and in Variants', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t172-thumb2k')
    const { window } = studio
    try {
      const thumb = templateById('yt-thumb-bold-2k')
      await templateCard(window, thumb).click()
      await expectTemplateApplied(window, thumb)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('1')
      await expect(card.getByTestId('export-output-size')).toHaveText('Output: 2560×1440')
      await expect(card).toContainText(`${BIGGER} (1280×720).`)
      await card.getByRole('button', { name: 'Variants' }).click()
      await expect(window.locator('[role="dialog"]').getByTestId('variants-output')).toContainText(`${BIGGER} (1280×720).`)
    } finally {
      await closeStudio(studio)
    }
  })

  test('a banner project saved and opened again, after another template took the canvas: the banner is back and still no note (the kind rides in the file)', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t172-banner-project')
    const { app, window } = studio
    try {
      const banner = templateById('yt-banner-channel')
      const thumb = templateById('yt-thumb-bold-2k')
      await templateCard(window, banner).click()
      await expectTemplateApplied(window, banner)

      // Save from Home: the Save dialog answers with a file of our choosing.
      const projectFile = path.join(studio.root, 'banner.imagii.json')
      await app.evaluate(({ dialog }, file) => {
        const target = dialog as unknown as { showSaveDialog: unknown; showOpenDialog: unknown }
        target.showSaveDialog = async () => ({ canceled: false, filePath: file })
        target.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      }, projectFile)
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Save project' }).click()
      await expect.poll(() => existsSync(projectFile), { timeout: 15_000 }).toBe(true)
      const saved = JSON.parse(readFileSync(projectFile, 'utf8')) as { imageCanvas: { doc: { kind?: string; width: number } } }
      expect(saved.imageCanvas.doc.kind, 'the file carries the kind').toBe('channel-art')

      // Another template takes the canvas: the 2K thumbnail, which has the note.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await window.getByRole('button', { name: 'Templates' }).click()
      await templateCard(window, thumb).click()
      await expectTemplateApplied(window, thumb)
      const card = window.locator(EXPORT)
      await card.getByLabel('Scale').selectOption('1')
      await expect(card).toContainText(`${BIGGER} (1280×720).`)

      // Open the saved project: the banner is back, and so is the quiet card.
      await window.getByRole('link', { name: 'Home' }).click()
      await window.getByRole('button', { name: 'Open project' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 30_000, intervals: [250] }).toContain('Project loaded')
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expectTemplateApplied(window, banner)
      await card.getByLabel('Scale').selectOption('1')
      await expect(card.getByTestId('export-output-size')).toHaveText('Output: 2560×1440')
      await expect(card, 'the re-opened banner is still not a thumbnail').not.toContainText(BIGGER)
    } finally {
      await closeStudio(studio)
    }
  })

  /** What each template card shows, read from the page: thumbnail (aspect ratio and whether it is the checkerboard), name, description and size line. */
  type CardRead = { name: string; description: string; size: string; aspect: string; checker: boolean; html: string }
  const readCards = (window: Page, scope: string): Promise<CardRead[]> =>
    window.evaluate((sel) => {
      return Array.from(document.querySelectorAll(`${sel} button.card`)).map((b) => {
        const thumb = b.children[0] as HTMLElement
        return {
          name: b.children[1]?.textContent ?? '',
          description: b.children[2]?.textContent ?? '',
          size: b.children[3]?.textContent ?? '',
          aspect: thumb.style.aspectRatio,
          checker: thumb.style.background.includes('repeating-conic-gradient'),
          html: b.outerHTML
        }
      })
    }, scope)

  test('the Import panel grid and the Streamer templates dialog draw every template the same way: thumbnail (checkerboard for a clear one), name, description, size line', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t172-speccard')
    const { window } = studio
    try {
      const fromPanel = await readCards(window, '[data-tutorial="image-import"]')
      expect(fromPanel).toHaveLength(CANVAS_TEMPLATES.length)
      await startBlank(window)
      await window.getByRole('button', { name: 'Templates' }).click()
      const fromDialog = await readCards(window, '[role="dialog"]')
      expect(fromDialog).toHaveLength(CANVAS_TEMPLATES.length)

      for (const t of CANVAS_TEMPLATES) {
        const expected = {
          name: t.name,
          description: t.description,
          size: `${t.doc.width} × ${t.doc.height}`,
          aspect: `${t.doc.width} / ${t.doc.height}`,
          checker: t.doc.background === 'transparent'
        }
        for (const [site, cards] of [['panel', fromPanel], ['dialog', fromDialog]] as const) {
          const { html, ...got } = cards.find((c) => c.name === t.name) ?? { name: 'MISSING', html: '' }
          expect(got, `${site}: ${t.name}`).toEqual(expected)
        }
        expect(fromDialog.find((c) => c.name === t.name)?.html, `${t.name}: the two sites draw the same markup`).toBe(
          fromPanel.find((c) => c.name === t.name)?.html
        )
      }
      expect(fromPanel.some((c) => c.checker), 'the catalog has a transparent template, so the checkerboard is exercised').toBe(true)
      expect(fromPanel.some((c) => !c.checker), 'and a filled one').toBe(true)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// round 123 Track A (T-174 item 3): a Pencil stroke's layer is named for the Pencil, a Line's for the Line.
// ---------------------------------------------------------------------------------------------------------------------------------------
test.describe('round 123 Track A - a Pencil stroke is a Pencil in the Layers panel', () => {
  test('a Pencil stroke\'s row and Name field read "Pencil", a Line\'s read "Line", and the two are told apart', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('r123-pencil-name')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: '+ More' }).click()

      await toolbar.getByRole('button', { name: 'Line' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 500, y: 320 })
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).toEqual(['Line', 'Text'])
      await expect(field(window, 'Name')).toHaveValue('Line')

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
      await expectLayerCount(window, 3)
      const stroke = await lastShape(window)
      expect(stroke.cls, 'a Pencil stroke is still a line shape on the stage').toBe('Line')
      expect(await layerNames(window), 'the Pencil\'s row says Pencil; the Line\'s row did not change').toEqual(['Pencil', 'Line', 'Text'])
      await expect(field(window, 'Name'), 'the stroke is selected after drawing: its Name field says Pencil').toHaveValue('Pencil')
      await expect(layerRow(window, 'Polygon')).toHaveCount(0)
    } finally {
      await closeStudio(studio)
    }
  })
})

// round 127 Track A (T-178 (1)): Stream Graphics was the last of the three drop zones that said nothing for a drop carrying no file (a link, selected text, a browser element):
// `Array.from(e.dataTransfer.files)` was empty, the loop ran nothing and the highlight cleared. Video and Audio Studio say the shared `examineDroppedFile` hint; this panel's
// import bar and its empty-state card share ONE handler, so one branch covers both, and both are driven here with a REAL DragEvent over a real DataTransfer.
test.describe('round 127 Track A (T-178 (1)): Stream Graphics says so for a drop that carries no file', () => {
  const SENTENCE = 'No file was dropped. Try the file picker instead.'

  /** A real drop of a link and its text on `.card` of the import zone (the bar when layers are open, the "Or start blank" card on the empty state). Returns how many files it carried. */
  async function dropLinkOnly(window: Page): Promise<number> {
    return window.evaluate(() => {
      const host = document.querySelector('[data-tutorial="image-import"]')
      if (!host) throw new Error('image import zone not found')
      const zone = host.classList.contains('card') ? host : host.querySelector('div.card')
      if (!zone) throw new Error('image drop zone not found')
      const transfer = new DataTransfer()
      transfer.setData('text/uri-list', 'https://example.com/overlay.png')
      transfer.setData('text/plain', 'https://example.com/overlay.png')
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      return transfer.files.length
    })
  }

  test('the import bar (a canvas with layers): the sentence once, as an error, no layer added, no page error; a picture dropped after it still imports', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t178-bar-nofile')
    const { window } = studio
    try {
      const pageErrors: string[] = []
      window.on('pageerror', (err) => pageErrors.push(err.message))
      await startBlank(window)
      expect(await dropLinkOnly(window), 'the transfer carries no file').toBe(0)
      await expect.poll(() => readToastLog(window), { timeout: 10_000, intervals: [100] }).toEqual([SENTENCE])
      expect((await readToastEntries(window))[0]?.hasIcon, 'an error toast, not a plain one').toBe(true)
      await expectLayerCount(window, 1)
      await window.waitForTimeout(800)
      expect(await readToastLog(window), 'one sentence, nothing after it').toEqual([SENTENCE])
      expect(pageErrors).toEqual([])

      // Control: a picture dropped on the same bar still imports, and does not say it again.
      await dropPng(window, readFileSync(studio.fixturePng).toString('base64'), 'after-link.png')
      await expectLayerCount(window, 2)
      await expect.poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] }).toContain('Added after-link.png')
      expect((await readToastLog(window)).filter((t) => t === SENTENCE), 'the picture drop does not say it again').toHaveLength(1)
    } finally {
      await closeStudio(studio)
    }
  })

  test('the empty-state card (no layers): the same sentence once, as an error, the start screen stays, no page error', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t178-empty-nofile')
    const { window } = studio
    try {
      const pageErrors: string[] = []
      window.on('pageerror', (err) => pageErrors.push(err.message))
      expect(await dropLinkOnly(window), 'the transfer carries no file').toBe(0)
      await expect.poll(() => readToastLog(window), { timeout: 10_000, intervals: [100] }).toEqual([SENTENCE])
      expect((await readToastEntries(window))[0]?.hasIcon, 'an error toast, not a plain one').toBe(true)
      await expect(window.getByText('Pick a template to start'), 'nothing was added: still the start screen').toBeVisible()
      await expect(window.locator(LAYERS)).toHaveCount(0)
      await window.waitForTimeout(800)
      expect(await readToastLog(window), 'one sentence, nothing after it').toEqual([SENTENCE])
      expect(pageErrors).toEqual([])

      // Control: a picture dropped on the card still imports.
      await dropPng(window, readFileSync(studio.fixturePng).toString('base64'), 'after-link-empty.png')
      await expectLayerCount(window, 1)
      expect((await readToastLog(window)).filter((t) => t === SENTENCE), 'the picture drop does not say it again').toHaveLength(1)
    } finally {
      await closeStudio(studio)
    }
  })
})

// round 127 Track A (T-178 (2)): an autosave write main refuses was a console line, so the safety net could be off for good with nothing on screen while the crash screen says
// "imagii saves it every few seconds". The REAL write is made to refuse with no hook in the product: a DIRECTORY named autosave.json is in the way of the rename that
// publishes the file (EISDIR on Linux, EPERM on Windows), exactly what a locked or unwritable target looks like to main. Removing it lets the next write land.
test.describe('round 127 Track A (T-178 (2)): an autosave main cannot write says so once, and again after it has worked', () => {
  const FAILED = /^Autosave couldn't save your work\./

  test('blocked: one toast (an error) however many edits follow; unblocked: the file is written and nothing is said; blocked again: told again', async () => {
    test.setTimeout(240_000)
    const studio = await openStudio('t178-autosave-failed')
    const { window } = studio
    const autosaveDir = path.join(studio.root, 'userData', 'autosave')
    const target = path.join(autosaveDir, 'autosave.json')
    const told = async (): Promise<number> => (await readToastLog(window)).filter((t) => FAILED.test(t)).length
    const written = (): boolean => {
      try {
        return readFileSync(target, 'utf8').length > 0
      } catch {
        return false
      }
    }
    const pageErrors: string[] = []
    window.on('pageerror', (err) => pageErrors.push(err.message))
    try {
      mkdirSync(target, { recursive: true })
      await startBlank(window)
      await expect.poll(told, { timeout: 60_000, intervals: [500], message: 'the refused write is told' }).toBe(1)
      const entry = (await readToastEntries(window)).find((t) => FAILED.test(t.text))
      expect(entry?.hasIcon, 'an error toast, not a plain one').toBe(true)

      // More edits while it stays blocked: still the one toast. It is let expire first (a repeat on the same id while the card is up replaces it and shows nothing new),
      // so a second toast would be a second card; and the folder is still in the way, so the premise holds.
      await expect(window.getByText(FAILED), 'the card is gone before the next attempt').toHaveCount(0, { timeout: 20_000 })
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 2)
      await window.waitForTimeout(13_000)
      expect(await told(), 'told once per episode, not once per attempt').toBe(1)
      expect(written(), 'and nothing was written').toBe(false)

      // Unblocked: the next edit writes the file, and a success says nothing.
      rmSync(target, { recursive: true, force: true })
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 3)
      await expect.poll(written, { timeout: 60_000, intervals: [500], message: 'autosave wrote the project once the way was clear' }).toBe(true)
      expect(await told(), 'a success is not announced').toBe(1)

      // Blocked again: the episode ended with the success, so this one is told.
      rmSync(target, { force: true })
      mkdirSync(target, { recursive: true })
      await window.locator(IMPORT).getByRole('button', { name: '+ Add text' }).click()
      await expectLayerCount(window, 4)
      await expect.poll(told, { timeout: 60_000, intervals: [500], message: 'a later failure is told again' }).toBe(2)
      expect(pageErrors).toEqual([])
    } finally {
      await closeStudio(studio)
    }
  })
})

// ── T-183 (4): the grid-size box says what it is ────────────────────────────────────────────────────────────────────────────────────────────
//
// The toolbar drew `[ ] Grid [ ] Snap [ 20 ]`: the box's only name was a hover title and an aria-label, so a sighted person saw an unlabelled 20 beside "Snap" (BRANDING: a bare
// number is not a value; T-153 (7) made bare x / y "X (px)" / "Y (px)" under the same rule). The box sits in a `<label>` whose visible text is "Grid size (px)", the Properties
// panel's "Size (px)" pattern, with its aria-label kept; and the label's words must not push the toolbar onto a second line at the smallest window.
test.describe('Image Studio — the grid-size box is labelled "Grid size (px)" and the toolbar stays one line (T-183 (4))', () => {
  test('the visible text is "Grid size (px)", clicking it focuses the box, and the toolbar is one line with no sideways overflow at 1024, 1280 and 1632 (with and without the advanced tools)', async () => {
    test.setTimeout(180_000)
    const studio = await openStudio('t183-gridlabel')
    const { app, window } = studio
    try {
      await resizeAndSettle(app, window, MIN_WINDOW)
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      const box = toolbar.getByRole('spinbutton')
      await expect(box, 'the toolbar has exactly one number box').toHaveCount(1)

      // The words are on screen, beside the box (the same row, to its left), and they are the box's label.
      const words = toolbar.getByText('Grid size (px)', { exact: true })
      await expect(words, 'the visible words').toBeVisible()
      const wordsBox = await words.boundingBox()
      const boxBox = await box.boundingBox()
      expect(wordsBox && boxBox, 'both measured').toBeTruthy()
      if (wordsBox && boxBox) {
        expect(wordsBox.x + wordsBox.width, 'the words end before the box begins').toBeLessThanOrEqual(boxBox.x + 1)
        expect(Math.abs(wordsBox.y + wordsBox.height / 2 - (boxBox.y + boxBox.height / 2)), 'the words and the box share a line').toBeLessThanOrEqual(3)
      }
      // getByLabel resolves "Grid size (px)" to the box ONLY through the wrapping <label> (the box carries no aria-label of its own, which would outrank it).
      await expect(toolbar.getByLabel('Grid size (px)'), 'the visible words label the box').toHaveCount(1)
      await expect(toolbar.getByLabel('Grid size (px)')).toHaveValue('20')
      // The label is the accessible name, so the name is the visible words (WCAG 2.5.3) and the old aria-label "Grid size in pixels" names nothing.
      await expect(box).toHaveAccessibleName('Grid size (px)')
      await expect(toolbar.getByLabel('Grid size in pixels'), 'the old aria-label is gone').toHaveCount(0)
      // Pressing the words puts the caret in the box (what a label is for).
      await words.click()
      await expect(box, 'a press on the words focuses the box').toBeFocused()

      const problems: string[] = []
      for (const advanced of [false, true]) {
        if (advanced) await toolbar.getByRole('button', { name: '+ More' }).click()
        for (const [size, where] of [
          [MIN_WINDOW, '1024x640 (the minimum)'],
          [{ width: 1280, height: 728 }, '1280x728'],
          [DEFAULT_WINDOW, '1632x918 (the default)']
        ] as const) {
          await resizeAndSettle(app, window, size)
          const label = `${where}${advanced ? ' with Line and Pencil shown' : ''}`
          const m = await toolbar.evaluate((el) => {
            const bar = el.getBoundingClientRect()
            const centres: number[] = []
            for (const c of Array.from(el.querySelectorAll('button, label, input'))) {
              const r = c.getBoundingClientRect()
              if (r.width > 0 && r.height > 0) centres.push(r.top + r.height / 2)
            }
            return { height: bar.height, spread: Math.max(...centres) - Math.min(...centres), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
          })
          if (m.height > 56) problems.push(`${label}: the toolbar is ${Math.round(m.height)} px high, it wrapped`)
          if (m.spread > 6) problems.push(`${label}: the controls' centres are ${Math.round(m.spread)} px apart, they sit on more than one line`)
          if (m.scrollWidth > m.clientWidth) problems.push(`${label}: the toolbar scrolls sideways (${m.scrollWidth} px in ${m.clientWidth} px)`)
          await expectOneLine(toolbar.locator('label'), `the toolbar's labels at ${label}`)
        }
      }
      expect(problems, 'the toolbar stays one line, wrapping nothing').toEqual([])
      await expectNoHorizontalOverflow(toolbar, 'the toolbar')
    } finally {
      await closeStudio(studio)
    }
  })
})

// T-184 (1): the size / zoom readout sits at the container's bottom-right and, whenever the stage fills the container along its limiting axis (the 1024 px window, a banner in a wide column), over the
// document's corner. It was `text-ink-dim` on `bg-bg-elevated/80`: over a WHITE document the composite behind the words is rgb(73,66,66) and ink-dim on it is 3.13:1. The backing is opaque now (5.83:1
// over anything). The window is sized so the stage's aspect IS the container's, which puts the readout over the (white) blank document; "over the picture" is asserted, not assumed.
test.describe('Image Studio - the size readout stays readable over a white document (T-184 (1))', () => {
  test('at 1024 px wide, with the stage filling the container, the readout is over the white document, its backing is opaque and its words clear 4.5:1', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('t184-readout')
    const { app, window } = studio
    try {
      await startBlank(window)
      const readout = window.getByText(/^\d+ × \d+ · \d+%$/)
      await expect(readout).toBeVisible()
      const [docW, docH] = ((await readout.textContent()) ?? '').split('·')[0]!.split('×').map((n) => Number(n.trim())) as [number, number]
      const measure = (): Promise<{ container: { w: number; h: number }; stage: DOMRect; readout: DOMRect; windowH: number }> =>
        window.evaluate(() => {
          const canvas = document.querySelector('canvas') as HTMLCanvasElement
          const container = canvas.closest('div.relative') as HTMLElement
          const note = Array.from(container.querySelectorAll('div')).find((d) => /^\d+ × \d+ · \d+%$/.test((d.textContent ?? '').trim())) as HTMLElement
          const c = container.getBoundingClientRect()
          return { container: { w: c.width, h: c.height }, stage: canvas.getBoundingClientRect(), readout: note.getBoundingClientRect(), windowH: window.innerHeight }
        })
      // Fit the window so the container's aspect is the document's: the stage then fills both axes and the corner readout is over it.
      await resizeAndSettle(app, window, { width: MIN_WINDOW.width, height: MIN_WINDOW.height })
      for (let i = 0; i < 3; i++) {
        const m = await measure()
        const wantH = m.container.w * (docH / docW)
        if (Math.abs(wantH - m.container.h) <= 2) break
        await resizeAndSettle(app, window, { width: MIN_WINDOW.width, height: Math.round(m.windowH + (wantH - m.container.h)) })
      }
      const m = await measure()
      const overlaps = m.readout.left < m.stage.right && m.readout.right > m.stage.left && m.readout.top < m.stage.bottom && m.readout.bottom > m.stage.top
      expect(overlaps, `the premise: the readout (${JSON.stringify(m.readout)}) is drawn over the document (${JSON.stringify(m.stage)})`).toBe(true)

      const style = await readout.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
      const channels = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).map(Number)
      const [br = 0, bg = 0, bb = 0, ba = 1] = channels(style.background)
      expect(ba, `the backing is opaque (${style.background}): the document under it cannot lighten it`).toBe(1)
      const lum = (rgb: number[]): number => {
        const [r = 0, g = 0, b = 0] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      // What a viewer sees behind the words: the backing at its alpha over a WHITE document corner.
      const seen = [br, bg, bb].map((v) => v * ba + 255 * (1 - ba))
      const [hi, lo] = [lum(channels(style.color).slice(0, 3)), lum(seen)].sort((a, b) => b - a) as [number, number]
      expect((hi + 0.05) / (lo + 0.05), 'the words clear WCAG AA over a white document').toBeGreaterThanOrEqual(4.5)
    } finally {
      await closeStudio(studio)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T-185 (1): a shortcut is the key on any keyboard layout (events dispatched with a non-Latin `key` and the real `code`, the T-155 (2) shape)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Image Studio - the shortcuts on a non-Latin layout (T-185 (1))', () => {
  // A keydown on the document body, as the OS sends it: `key` is the layout's letter, `code` the key's position.
  const press = (window: Page, key: string, code: string, ctrl = false): Promise<void> =>
    window.evaluate(
      ([k, c, ctrlKey]) => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k as string, code: c as string, ctrlKey: ctrlKey as boolean, bubbles: true, cancelable: true }))
      },
      [key, code, ctrl] as const
    )

  test('"к" on the R key picks the rectangle tool; Ctrl+"я" (the Z key) removes the layer just added and Ctrl+"н" (the Y key) brings it back', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('t185-cyrillic-keys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rectangle' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await toolbar.getByRole('button', { name: 'Select' }).click()
      await expectLayerCount(window, 2)
      await expect(toolbar.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')

      await press(window, 'к', 'KeyR')
      await expect(toolbar.getByRole('button', { name: 'Rectangle' }), 'the key is R by position').toHaveAttribute('aria-pressed', 'true')
      await expect(toolbar.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false')
      await press(window, 'м', 'KeyV')
      await expect(toolbar.getByRole('button', { name: 'Select' }), 'and V').toHaveAttribute('aria-pressed', 'true')
      // AZERTY discriminates: its W key (code KeyZ) is not Z, so Ctrl+W changes nothing.
      await press(window, 'w', 'KeyZ', true)
      await window.waitForTimeout(300)
      await expectLayerCount(window, 2)

      await press(window, 'я', 'KeyZ', true)
      await expectLayerCount(window, 1)
      await press(window, 'н', 'KeyY', true)
      await expectLayerCount(window, 2)
    } finally {
      await closeStudio(studio)
    }
  })
})
