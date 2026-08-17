import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import {
  CANVAS_TEMPLATES,
  type CanvasTemplate
} from '../../src/renderer/src/modules/image-studio/templates'
import { dragThrough, dragTo } from './drag'
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
 * 1. The Konva stage. `window.__imagiiStage` (Canvas.tsx:360) is the ledger's
 *    own hook. `stageShapes()` reads the document layer's children — class +
 *    attrs — which is the rendered end state of `doc.layers`: React re-renders
 *    every node from the store, so a value read back off a node is the value
 *    the store holds. Invisible layers render `null`, which is what makes the
 *    eye toggle assertable at the stage.
 *
 * 2. Mouse work is in DOC coordinates. The stage is scaled to fit its
 *    container (Canvas.tsx:168), so every screen point is computed from the
 *    live `stage.scaleX()` and the canvas rect (`stageGeom`). Transformer
 *    anchors are Konva nodes, not DOM: their screen position comes from
 *    `getAbsolutePosition()`, which already includes the stage scale.
 *
 * 3. Downloads. Playwright's `page.on('download')` / `context.on('download')`
 *    never fire under `_electron.launch` — probed both ways, neither sees the
 *    `<a download>` click that ExportDialog.tsx:10 and ThumbnailVariants.tsx:95
 *    perform. The download is real, though: Electron's own
 *    `session.will-download` sees it. `installDownloadCapture` hooks that in
 *    the MAIN process from the test (nothing in `src/` changes) and writes each
 *    item to a temp dir, so every export assertion below lands on real bytes —
 *    a deeper end state than a download event object.
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
  /** Where `will-download` items are written. */
  downloadDir: string
  dialogs: DialogSpy
}

/**
 * Hook Electron's own download plumbing in the MAIN process. Nothing in
 * `src/` changes: `session` is Electron's object, the `<a download>` click and
 * the whole Chromium download path stay real, and every item is written to a
 * temp dir the test can read. See the header note on why Playwright's
 * download events cannot be used here.
 */
async function installDownloadCapture(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ session }, downloadDir) => {
    const g = globalThis as unknown as { __dlDir: string; __dl: string[] }
    g.__dlDir = downloadDir
    g.__dl = []
    session.defaultSession.on('will-download', (_event, item) => {
      const name = item.getFilename()
      item.setSavePath(`${g.__dlDir}/${name}`)
      item.once('done', (_e, state) => {
        if (state === 'completed') g.__dl.push(name)
      })
    })
  }, dir)
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

function completedDownloads(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __dl?: string[] }).__dl ?? [])
}

async function clearDownloads(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __dl?: string[] }
    if (g.__dl) g.__dl.length = 0
  })
}

/** Wait until exactly `n` downloads have completed, then read their bytes. */
async function waitForDownloads(studio: Studio, n: number): Promise<Buffer[]> {
  await expect
    .poll(() => completedDownloads(studio.app), { timeout: 30_000, intervals: [200] })
    .toHaveLength(n)
  const names = await completedDownloads(studio.app)
  return names.map((name) => readFileSync(path.join(studio.downloadDir, name)))
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
  await installDownloadCapture(app, downloadDir)
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

      // ── the four dismissals, each proven not to change the document ──
      const dismissals: Array<[string, () => Promise<void>]> = [
        ['Cancel', async () => dialog.getByRole('button', { name: 'Cancel' }).click()],
        [
          'close button',
          async () => dialog.getByRole('button', { name: 'Close templates dialog' }).click()
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
      await toolbar.getByRole('button', { name: 'Rect' }).click()
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()
      await expect(toolbar.getByRole('button', { name: 'Rect' })).toHaveClass(/bg-accent/)
      await toolbar.getByRole('button', { name: 'Ellipse' }).click()
      await expect(window.getByText('Tool: Ellipse')).toBeVisible()
      await expect(toolbar.getByRole('button', { name: 'Rect' })).not.toHaveClass(/bg-accent/)

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
          toolbar.getByRole('button', { name: label === 'Rectangle' ? 'Rect' : label })
        ).toHaveClass(/bg-accent/)
      }

      // The uppercase bindings are the same rows in ImageStudio.tsx:53-63.
      await window.keyboard.press('Shift+R')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()

      // Ctrl+V is the paste path, not the Select shortcut (ImageStudio.tsx:54).
      await window.keyboard.press('Control+v')
      await expect(window.getByText('Tool: Rectangle')).toBeVisible()

      // ── the header's TutorialButton replays the image tutorial ──
      // The seed marks it seen, so the only way a coachmark appears is the
      // button; Skip closes it without writing the flag back.
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const coachmark = window.locator('[role="dialog"]')
      await expect(coachmark).toContainText('Welcome to the Image Canvas')
      await coachmark.getByRole('button', { name: 'Next' }).click()
      await expect(coachmark).toContainText('Step 1: Get an image in')
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
      await toolbar.getByRole('button', { name: 'Rect' }).click()
      await dragOnStage(window, { x: 200, y: 150 }, { x: 400, y: 300 })
      await expectLayerCount(window, 2)
      expect(await layerNames(window)).toEqual(['Rectangle', 'Text'])
      const rect = await lastShape(window)
      expect(rect.cls).toBe('Rect')
      expectNear(rect.x, 200, 'rect x')
      expectNear(rect.y, 150, 'rect y')
      expectNear(rect.width, 200, 'rect width')
      expectNear(rect.height, 150, 'rect height')
      expect(rect.fill).toBe('rgba(255,49,49,0.4)')

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
      // Both drawing tools that produce a Line name it "Line" (canvasStore.ts:285).
      expect(await layerNames(window)).toEqual([
        'Line',
        'Line',
        'Ellipse',
        'Rectangle',
        'Rectangle',
        'Text'
      ])

      // ── a drag under the 4px floor commits nothing (Canvas.tsx:230) ──
      await toolbar.getByRole('button', { name: 'Rect' }).click()
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
      await toolbar.getByRole('button', { name: 'Rect' }).click()
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
      // (canvasStore rule read off Canvas.tsx:153-156). At the DEFAULT grid of
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

test.describe('Image Studio — selection', () => {
  test('clicking a shape attaches the Transformer and fills the properties panel', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('select')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rect' }).click()
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
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rect' }).click()
      await dragOnStage(window, { x: 300, y: 300 }, { x: 600, y: 500 })
      await window.locator(TOOLBAR).getByRole('button', { name: 'Select' }).click()
      await clickDoc(window, { x: 450, y: 400 })
      const start = await lastShape(window)
      // The number fields are the store's own readout (PropertiesPanel.tsx:35).
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
      await toolbar.getByRole('button', { name: 'Rect' }).click()
      await dragOnStage(window, { x: 200, y: 200 }, { x: 400, y: 350 })
      await dragOnStage(window, { x: 500, y: 200 }, { x: 700, y: 350 })
      await expectLayerCount(window, 3)

      // ── the INPUT guard first (ImageStudio.tsx:45-46): typing in the name
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
      // Removing the selected layer clears the selection (canvasStore.ts:113).
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

  test('T-68: every studio hotkey is inert behind an open dialog, and works again after it closes', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('modal-hotkeys')
    const { window } = studio
    try {
      await startBlank(window)
      const toolbar = window.locator(TOOLBAR)
      await toolbar.getByRole('button', { name: 'Rect' }).click()
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
      await toolbar.getByRole('button', { name: 'Rect' }).click()
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

      // ── eye: an invisible layer stops rendering on the stage ──
      expect(await stageShapes(window)).toHaveLength(3)
      await rectRow.getByTitle('Show/hide').click()
      await expect.poll(async () => (await stageShapes(window)).length, { timeout: 10_000 }).toBe(2)
      expect((await stageShapes(window)).map((s) => s.cls)).toEqual(['Text', 'Ellipse'])
      await rectRow.getByTitle('Show/hide').click()
      await expect.poll(async () => (await stageShapes(window)).length, { timeout: 10_000 }).toBe(3)

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
      await layerRow(window, 'Rectangle copy').getByRole('button', { name: 'Delete layer' }).click()
      await expectLayerCount(window, 3)
      expect(studio.dialogs.messages).toEqual([])
      expect(await layerNames(window)).toEqual(['Ellipse', 'Rectangle', 'Text'])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'image-05-layers.png') })
    } finally {
      await closeStudio(studio)
    }
  })
})

test.describe('Image Studio — properties panel', () => {
  test('every shape field, all seven rotation presets, and the opacity readout', async () => {
    test.setTimeout(120_000)
    const studio = await openStudio('props-shape')
    const { window } = studio
    try {
      await startBlank(window)
      await window.locator(TOOLBAR).getByRole('button', { name: 'Rect' }).click()
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
        await propsCard(window).getByRole('button', { name: String(preset), exact: true }).click()
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
      await expect(field(window, 'Fill')).toHaveValue('rgba(244,63,94,0.4)')
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

      await field(window, 'Size').fill('72')
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
      // URL asynchronously and Canvas.tsx:41 renders nothing until it resolves.
      await expectShapeCount(window, 1)
      const first = await lastShape(window)
      expect(first.cls).toBe('Image')
      // Under the 800px cap the fixture keeps its natural size (ImportPanel.tsx:70).
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
        await window.locator(`${LAYERS} li`).first().getByRole('button', { name: 'Delete layer' }).click()
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

      // ── PNG at 1x ──
      await exportPanel.getByLabel('Scale').selectOption('1')
      await exportButton.click()
      const [png1] = await waitForDownloads(studio, 1)
      const size1 = pngSize(png1 as Buffer)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('PNG saved')
      expect((await completedDownloads(studio.app))[0]).toMatch(/^imagii-\d+\.png$/)

      // T-45: "1×" means one document pixel per exported pixel. The on-screen
      // stage is a fit-to-container render (Canvas.tsx:168-174) and is NOT the
      // document size here — asserted first, so every dimension below is a
      // claim about the export math and not an accident of this window.
      expect(geom.stageW, 'the stage is zoomed, not 1:1').not.toBe(t.doc.width)
      expect(size1).toEqual({ w: t.doc.width, h: t.doc.height })

      // ── scale 2x: same click, exactly twice the document ──
      await clearDownloads(studio.app)
      await exportPanel.getByLabel('Scale').selectOption('2')
      await exportButton.click()
      const [png2] = await waitForDownloads(studio, 1)
      const size2 = pngSize(png2 as Buffer)
      expect(size2).toEqual({ w: t.doc.width * 2, h: t.doc.height * 2 })

      // ── scale 0.5x, the other end of the picker ──
      await clearDownloads(studio.app)
      await exportPanel.getByLabel('Scale').selectOption('0.5')
      await exportButton.click()
      const [pngHalf] = await waitForDownloads(studio, 1)
      expect(pngSize(pngHalf as Buffer)).toEqual({
        w: t.doc.width * 0.5,
        h: t.doc.height * 0.5
      })

      // ── JPG: format select swaps the encoder and reveals the quality slider ──
      await clearDownloads(studio.app)
      await expect(window.getByRole('slider', { name: 'JPG export quality' })).toHaveCount(0)
      await exportPanel.getByRole('combobox').first().selectOption('jpg')
      const quality = window.getByRole('slider', { name: 'JPG export quality' })
      await expect(quality).toBeVisible()
      await expect(exportPanel).toContainText('92%')
      await exportPanel.getByLabel('Scale').selectOption('1')

      await quality.fill('1')
      await expect(exportPanel).toContainText('100%')
      await exportButton.click()
      const [jpgHigh] = await waitForDownloads(studio, 1)
      expect((await completedDownloads(studio.app))[0]).toMatch(/^imagii-\d+\.jpg$/)
      expect(jpegSize(jpgHigh as Buffer)).toEqual(size1)

      await clearDownloads(studio.app)
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

  test('emote pack: a 112x112 PNG export emits three files from one click', async () => {
    test.setTimeout(150_000)
    const studio = await openStudio('emote')
    const { window } = studio
    try {
      const t = templateById('emote-blank-112')
      expect([t.doc.width, t.doc.height]).toEqual([112, 112])
      await templateCard(window, t).click()
      await expectTemplateApplied(window, t)
      const geom = await stageGeom(window)

      await window.locator(EXPORT).getByRole('button', { name: 'Export', exact: true }).click()
      const files = await waitForDownloads(studio, 3)
      const names = await completedDownloads(studio.app)
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Emote pack saved (3 PNGs: 28, 56, 112)')

      // One click, three files, named for the trio Twitch expects.
      expect(names.map((n) => n.replace(/\d{10,}/, 'STAMP'))).toEqual([
        'imagii-emote-28-STAMP.png',
        'imagii-emote-56-STAMP.png',
        'imagii-emote-112-STAMP.png'
      ])
      const sizes = files.map((f) => pngSize(f as Buffer))

      // T-45: the bytes carry the sizes the filenames and the toast promise.
      // This doc sits at the 4x zoom cap (Canvas.tsx:167) — 112 document px
      // are drawn as 448 screen px — which is exactly the zoom that used to
      // leak into the capture and write 112/224/448. Asserting the cap is
      // really engaged first is what makes the trio below a claim about the
      // export math rather than a coincidence of window size.
      expect(geom.stageW, 'the on-screen stage really is magnified').toBeGreaterThan(t.doc.width)
      expect(sizes.map((s) => s.w)).toEqual([28, 56, 112])
      expect(sizes.map((s) => s.h)).toEqual([28, 56, 112])
      // Three distinct renders, not one file written three times.
      expect(new Set(files.map((f) => (f as Buffer).length)).size).toBe(3)

      // JPG on the same doc takes the ordinary single-file path.
      await clearDownloads(studio.app)
      await window.locator(EXPORT).getByRole('combobox').first().selectOption('jpg')
      await window.locator(EXPORT).getByRole('button', { name: 'Export', exact: true }).click()
      const single = await waitForDownloads(studio, 1)
      expect(single).toHaveLength(1)
      expect((await completedDownloads(studio.app))[0]).toMatch(/^imagii-\d+\.jpg$/)
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
        await clearDownloads(studio.app)
        await exportButton.click()
        const [bytes] = await waitForDownloads(studio, 1)
        return { bytes: bytes as Buffer, stageW: (await stageGeom(window)).stageW }
      }

      // Both sizes clear the 1024x640 window minimum (src/main/index.ts:68).
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
        await clearDownloads(studio.app)
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
      const format = exportPanel.getByRole('combobox').first()
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
      await clearDownloads(studio.app)
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

      await clearDownloads(studio.app)
      await format.selectOption('png')
      await exportButton.click()
      const pack = await waitForDownloads(studio, 3)
      const full = pack[2] as Buffer
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
      await dialog.locator('.card').filter({ hasText: 'Warm' }).getByRole('button', { name: 'Save' }).click()
      const [warm] = await waitForDownloads(studio, 1)
      expect((await completedDownloads(studio.app))[0]).toMatch(/^imagii-variant-warm-\d+\.png$/)
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
      await layerRow(window, 'Accent bar').getByTitle('Show/hide').click()
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

      // …and the hidden layer is the reason the render changed: put it back,
      // generate again, and the original returns byte for byte.
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await layerRow(window, 'Accent bar').getByTitle('Show/hide').click()
      await expectShapeCount(window, 4)
      await variantsButton.click()
      await expect(generate).toBeVisible()
      await generate.click()
      await expect
        .poll(async () => (await tileUrls())[0], { timeout: 30_000 })
        .toBe(urls[0])

      // ── save all four ──
      await clearDownloads(studio.app)
      await dialog.getByRole('button', { name: 'Save all 4' }).click()
      await expect
        .poll(() => readToastLog(window), { timeout: 15_000, intervals: [200] })
        .toContain('Saving 4 variants…')
      const all = await waitForDownloads(studio, 4)
      expect((await completedDownloads(studio.app)).map((n) => n.replace(/\d{10,}/, 'STAMP'))).toEqual([
        'imagii-variant-original-STAMP.png',
        'imagii-variant-punchy-STAMP.png',
        'imagii-variant-warm-STAMP.png',
        'imagii-variant-cool-STAMP.png'
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

      await window.locator(TOOLBAR).getByRole('button', { name: 'Rect' }).click()
      await dragOnStage(window, { x: 250, y: 250 }, { x: 550, y: 450 })
      await expectLayerCount(window, 2)
      await expect(undo).toBeEnabled()

      await layerRow(window, 'Text').getByRole('button', { name: 'Delete layer' }).click()
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

      // A new action after an undo drops the redo branch (canvasStore.ts:70).
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
