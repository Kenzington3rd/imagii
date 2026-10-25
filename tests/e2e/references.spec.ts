import {
  test,
  expect,
  _electron as electron,
  type Dialog,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { pathToImagiiFileUrl } from '../../src/shared/fileUrl'
import { ffmpegPath } from '../../src/main/ffmpeg/paths'
import { ASSET_CATALOG } from '../../src/renderer/src/modules/references/assetCatalog'
import type { MoodBoardCollection } from '../../src/shared/search'
import { installToastLog, readToastLog } from './toastLog'

// ESM-friendly __dirname (Playwright loads specs as ESM under our setup).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T-26: the References studio driven through the REAL built app.
 *
 * Everything the ledger lists under References(20) that a headless Linux
 * box can reach: the three tabs, the whole mood-board lifecycle, the
 * ->Canvas cross-studio bridge, the Asset Library's canvas replacement,
 * and the search error path. Live DuckDuckGo is HL-network and is
 * dispositioned rather than faked — see the search test's header.
 *
 * This file used to carry `defect:` tests — pins on behavior that was
 * wrong, kept because a silent regression in a broken control is still a
 * regression. All of them have since been flipped to positives by the
 * ticket that fixed them (T-28's rename and first-save dialogs in round 46,
 * T-29's "Clear thumbnail cache" here), which is the shape a new one should
 * follow: pin both directions, then rewrite the assertions rather than the
 * test.
 *
 * Hermetic on three axes:
 *   - userData is a throwaway temp dir per test (`--user-data-dir=`),
 *     pre-seeded past the Welcome screen and all four tutorial flags.
 *   - mood-board state is seeded as JSON in `<userData>/moodboards`
 *     with its thumbnail in `<userData>/cache/thumbs` — the exact file
 *     layout src/main/sidecars/paths.ts hands to moodboard.ts, so the
 *     store's own reader parses it.
 *   - the network is not merely "expected to be down": the search test
 *     launches Electron behind a local proxy socket it owns, so the
 *     failure is produced by the test, not by the container.
 */

const SCREENSHOTS = path.join(__dirname, 'screenshots')

/**
 * 8x6 red PNG (95 bytes). Small enough to inline, and non-square so the
 * ->Canvas assertion can tell width from height if it ever needs to.
 */
const PNG_8x6 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR42mM4oaGBFTEMpAQAgPc0gTglveMAAAAASUVORK5CYII='

interface Fixture {
  root: string
  userDataDir: string
  boardsDir: string
  thumbsDir: string
}

/**
 * One pixel of a PNG, decoded by the repo's own bundled ffmpeg (the same
 * technique image.spec.ts uses): `format=rgba` first so the crop is a legal
 * 1x1, then a 4-byte raw dump.
 */
function pngPixel(file: string, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const raw = `${file}.${x}-${y}.raw`
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-y', '-i', file, '-vf', `format=rgba,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw
    ])
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`pixel probe exit ${code}: ${stderr.slice(-400)}`))
      const px = readFileSync(raw)
      resolve({ r: px[0] ?? -1, g: px[1] ?? -1, b: px[2] ?? -1, a: px[3] ?? -1 })
    })
  })
}

/** Hermetic userData dir with every overlay flag pre-seeded (smoke.spec shape). */
function makeFixture(label: string): Fixture {
  const root = path.join(os.tmpdir(), `imagii-e2e-${label}-${Date.now().toString(36)}`)
  const userDataDir = path.join(root, 'userData')
  const boardsDir = path.join(userDataDir, 'moodboards')
  const thumbsDir = path.join(userDataDir, 'cache', 'thumbs')
  mkdirSync(boardsDir, { recursive: true })
  mkdirSync(thumbsDir, { recursive: true })
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
  return { root, userDataDir, boardsDir, thumbsDir }
}

async function launchApp(
  userDataDir: string,
  extraArgs: string[] = []
): Promise<ElectronApplication> {
  const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
  if (!existsSync(mainEntry)) {
    throw new Error(
      `out/main/index.js missing. Run \`npm run build\` before \`npm run test:e2e\`. Checked: ${mainEntry}`
    )
  }
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, ...extraArgs],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
}

/**
 * Make `search:images` answer the way DuckDuckGo answers a query it has
 * nothing for: a normal response, zero results, NO notice
 * (`duckduckgo.test.ts` — "returns an empty result set with no notice when
 * DuckDuckGo has no hits" — pins that the parser really produces this).
 *
 * It is the one response shape that should print "No results.", and it needs
 * a live provider with a genuinely empty index to reach for real. Replacing
 * the handler in MAIN is the same technique record.spec.ts uses for the
 * zero-sources branch: only the upstream answer is synthetic — the invoke,
 * the store write and everything the panel renders are real.
 */
async function stubEmptySearchResults(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain }) => {
    ipcMain.removeHandler('search:images')
    ipcMain.handle('search:images', (_e, query: unknown) => ({
      query: typeof query === 'string' ? query : '',
      provider: 'duckduckgo',
      results: []
    }))
  })
}

/**
 * One synthetic result, answered in MAIN — same technique as
 * `stubEmptySearchResults`, and for the same reason: live DuckDuckGo is
 * HL-network. The thumbnail URL is a socket the calling test owns, so the
 * cache write that follows a Save is a real `net.fetch` over a real
 * connection rather than a stub.
 */
async function stubOneSearchResult(app: ElectronApplication, thumbnailUrl: string): Promise<void> {
  await app.evaluate(async ({ ipcMain }, url) => {
    ipcMain.removeHandler('search:images')
    ipcMain.handle('search:images', (_e, query: unknown) => ({
      query: typeof query === 'string' ? query : '',
      provider: 'duckduckgo',
      results: [
        {
          id: 'stubresult',
          thumbnail: url,
          fullUrl: url,
          source: '127.0.0.1',
          title: 'Stubbed reference'
        }
      ]
    }))
  }, thumbnailUrl)
}

async function openReferences(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 30_000 })
  await window.locator('a', { hasText: 'References' }).first().click()
  await expect(window.locator('h1', { hasText: 'References' })).toBeVisible({ timeout: 30_000 })
}

/** Home chip -> References again. The studio remembers its last tab. */
async function backToReferences(window: Page): Promise<void> {
  await window.locator('a[href="/home"], a[href="#/home"]').first().click({ force: true })
  await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
  await window.locator('a', { hasText: 'References' }).first().click()
  await expect(window.locator('h1', { hasText: 'References' })).toBeVisible({ timeout: 15_000 })
}

/** Every board JSON on disk, parsed — the store's own persistence format. */
function readBoardsFromDisk(boardsDir: string): MoodBoardCollection[] {
  return readdirSync(boardsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(boardsDir, f), 'utf8')) as MoodBoardCollection)
}

/** Locators shared by several tests. */
const searchPlaceholder = 'Search for inspiration'
/** MoodBoardPanel's delete toast, verbatim — it names the undo path (T-66). */
const DELETED_TOAST = 'Deleted — press Ctrl+Z to undo'
const boardsHeading = /^Boards \(\d+\)$/

/**
 * A board whose items point at `names` inside `thumbsDir`. Ownership is what
 * T-58's launch sweep checks before it reclaims a cached file, so a thumbnail
 * fixture that must survive to be acted on has to belong to a board.
 */
function boardOwning(
  id: string,
  name: string,
  thumbsDir: string,
  names: string[]
): MoodBoardCollection {
  return {
    id,
    name,
    createdAt: 1700000000000,
    items: names.map((file, i) => ({
      id: `${id}item${i}`,
      collectionId: id,
      thumbnail: `https://example.invalid/${file}`,
      fullUrl: `https://example.invalid/full-${file}`,
      source: 'example.invalid',
      title: `Cached ${file}`,
      cachedThumbPath: path.join(thumbsDir, file),
      addedAt: 1700000000000 + i
    }))
  }
}

function moodBoardTab(window: Page) {
  return window.getByRole('button', { name: 'Mood Boards', exact: true })
}

function layerRows(window: Page) {
  // The NAME of each row. (Since T-91 a row can also carry a "won't export"
  // tag; `span.truncate` is the name alone, as image.spec.ts reads it.)
  return window.locator('[data-tutorial="image-layers"] li span.truncate')
}

test.describe('imagii References studio', () => {
  test('the three tabs swap panels, and the tutorial target resolves', async () => {
    test.setTimeout(120_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
    const fx = makeFixture('refs-tabs')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)

      const searchInput = window.getByPlaceholder(searchPlaceholder, { exact: false })
      const boardsPanel = window.getByRole('heading', { name: boardsHeading })
      const assetsPanel = window.getByRole('heading', { name: 'Overlay frames', exact: true })

      // aiTutorial's only targetSelector (tutorials/aiTutorial.ts step 2)
      // must resolve to exactly one node, and it must be the tab strip —
      // T-16's fix is what makes the coachmark land on something.
      const tabStrip = window.locator('[data-tutorial="ai-tabs"]')
      await expect(tabStrip).toHaveCount(1)
      for (const label of ['Reference Search', 'Mood Boards', 'Asset Library']) {
        await expect(tabStrip.getByRole('button', { name: label, exact: true })).toHaveCount(1)
      }

      // Default tab: Reference Search — and the strip says which tab is open (T-113: it was an
      // underline and nothing else).
      await expect(searchInput).toBeVisible()
      await expect(tabStrip.getByRole('button', { name: 'Reference Search', exact: true })).toHaveAttribute('aria-current', 'true')
      await expect(tabStrip.getByRole('button', { name: 'Mood Boards', exact: true })).not.toHaveAttribute('aria-current', /.*/)
      // T-85: the panel says WHO filters (DuckDuckGo's SafeSearch — imagii
      // screens nothing itself). T-89: and that search goes online while the
      // saved boards stay on this computer — it is NOT "the one feature that
      // goes online" (the caption-model download is online too).
      await expect(
        window.getByText(
          "SafeSearch is always on (strict) — DuckDuckGo does the filtering; imagii doesn't scan images itself. Reference Search goes online; your saved boards stay on your computer."
        )
      ).toBeVisible()
      await expect(window.getByText(/the one feature that goes online/)).toHaveCount(0)
      await expect(window.getByText(/screened locally/)).toHaveCount(0)
      await expect(boardsPanel).toHaveCount(0)
      await expect(assetsPanel).toHaveCount(0)

      // -> Mood Boards.
      await moodBoardTab(window).click()
      await expect(boardsPanel).toBeVisible()
      await expect(tabStrip.getByRole('button', { name: 'Mood Boards', exact: true })).toHaveAttribute('aria-current', 'true')
      await expect(tabStrip.getByRole('button', { name: 'Reference Search', exact: true })).not.toHaveAttribute('aria-current', /.*/)
      await expect(
        window.getByText('Create a mood board on the left to get started.')
      ).toBeVisible()
      await expect(searchInput).toHaveCount(0)
      await expect(assetsPanel).toHaveCount(0)

      // -> Asset Library. Its own landmark is the first category header,
      // and the footer count is derived from the catalog module itself so
      // a catalog edit can't silently drift the panel.
      await window.getByRole('button', { name: 'Asset Library', exact: true }).click()
      await expect(assetsPanel).toBeVisible()
      await expect(
        window.getByText(
          `${ASSET_CATALOG.length} assets · drops replace the current Stream Graphics canvas.`
        )
      ).toBeVisible()
      await expect(searchInput).toHaveCount(0)
      await expect(boardsPanel).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-01-assets-tab.png') })

      // -> back to Reference Search.
      await window.getByRole('button', { name: 'Reference Search', exact: true }).click()
      await expect(searchInput).toBeVisible()
      await expect(assetsPanel).toHaveCount(0)

      // ── the coachmark actually lands on the tab strip ──
      // Counting the data-tutorial attribute only proves it exists. Running
      // the tour proves Tutorial.tsx resolves the selector and cuts its
      // highlight over the real element — the failure mode T-16 fixed was a
      // step pointing at a selector that rendered nowhere, which degrades
      // silently to a centered tooltip over a dimmed screen.
      await window.getByRole('button', { name: 'Show tutorial' }).click()
      const coachmark = window.getByRole('dialog')
      await expect(coachmark).toHaveAttribute(
        'aria-label',
        'References tutorial — step 1 of 4: Welcome to References'
      )
      await coachmark.getByRole('button', { name: 'Next' }).click()
      await expect(coachmark).toHaveAttribute(
        'aria-label',
        'References tutorial — step 2 of 4: The three tabs'
      )
      const highlight = window.locator('svg rect[stroke]')
      await expect(highlight).toHaveCount(1)
      const box = await tabStrip.boundingBox()
      expect(box).toBeTruthy()
      const CUTOUT_PAD = 8
      const attr = async (name: string): Promise<number> =>
        Number(await highlight.getAttribute(name))
      expect(await attr('x')).toBeCloseTo((box?.x ?? 0) - CUTOUT_PAD, 0)
      expect(await attr('y')).toBeCloseTo((box?.y ?? 0) - CUTOUT_PAD, 0)
      expect(await attr('width')).toBeCloseTo((box?.width ?? 0) + CUTOUT_PAD * 2, 0)
      expect(await attr('height')).toBeCloseTo((box?.height ?? 0) + CUTOUT_PAD * 2, 0)

      await window.keyboard.press('Escape')
      await expect(coachmark).toHaveCount(0)
      await expect(searchInput).toBeVisible()
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('mood boards: create by button and by Enter, select, delete (dismiss then accept)', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-crud')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      const nameInput = window.getByPlaceholder('New board name', { exact: false })
      const addButton = window.getByRole('button', { name: 'Create board', exact: true })
      const detailTitle = window.locator('h3.text-lg')

      await expect(window.getByRole('heading', { name: 'Boards (0)' })).toBeVisible()
      await expect(readBoardsFromDisk(fx.boardsDir)).toHaveLength(0)

      // ── create #1 via Enter on the name input ──
      await nameInput.fill('Alpha board')
      await nameInput.press('Enter')
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(detailTitle).toHaveText('Alpha board')
      // The input clears itself so the next name doesn't append.
      await expect(nameInput).toHaveValue('')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Alpha board'])

      // ── create #2 via the "+" button ──
      await nameInput.fill('Beta board')
      await addButton.click()
      await expect(window.getByRole('heading', { name: 'Boards (2)' })).toBeVisible()
      // A fresh board is auto-selected (referencesStore.createCollection).
      await expect(detailTitle).toHaveText('Beta board')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name).sort())
        .toEqual(['Alpha board', 'Beta board'])

      // A blank name is refused without touching disk (MoodBoardPanel.onCreate).
      await nameInput.fill('   ')
      await addButton.click()
      await expect(window.getByRole('heading', { name: 'Boards (2)' })).toBeVisible()
      expect(readBoardsFromDisk(fx.boardsDir)).toHaveLength(2)
      await nameInput.fill('')

      // ── select the other board ──
      const alphaRow = window.locator('li', { hasText: 'Alpha board' })
      await alphaRow.click()
      await expect(detailTitle).toHaveText('Alpha board')
      // Selection is visible, not just internal: the row carries the accent border.
      await expect(alphaRow).toHaveClass(/border-accent/)
      await expect(window.locator('li', { hasText: 'Beta board' })).not.toHaveClass(/border-accent/)

      // T-114: ...and it is said to assistive tech too, and reachable by keyboard. A board row was a
      // clickable <li> with only the border to say which: no tab stop, no Enter, no state.
      const betaRow = window.locator('li', { hasText: 'Beta board' })
      await expect(alphaRow).toHaveAttribute('aria-current', 'true')
      await expect(alphaRow.getByRole('button')).toHaveAttribute('aria-current', 'true')
      await expect(betaRow).not.toHaveAttribute('aria-current', /.*/)
      await betaRow.getByRole('button').focus()
      await window.keyboard.press('Enter')
      await expect(detailTitle).toHaveText('Beta board')
      await expect(betaRow).toHaveClass(/border-accent/)
      await expect(betaRow).toHaveAttribute('aria-current', 'true')
      await expect(alphaRow).not.toHaveAttribute('aria-current', /.*/)
      await alphaRow.getByRole('button').focus()
      await window.keyboard.press('Space')
      await expect(detailTitle).toHaveText('Alpha board')
      await expect(alphaRow).toHaveAttribute('aria-current', 'true')
      await expect(betaRow).not.toHaveAttribute('aria-current', /.*/)
      // A name a screen reader can use: the board and how much is on it.
      await expect(alphaRow.getByRole('button', { name: 'Alpha board, 0 items' })).toBeVisible()

      // ── delete, dismissed ──
      // Handler registered BEFORE the click: an unhandled dialog blocks the
      // renderer, and Playwright's auto-dismiss would give us nothing to
      // assert the confirm copy against.
      const dialogs: string[] = []
      const dismisser = (d: Dialog): void => {
        dialogs.push(`${d.type()}: ${d.message()}`)
        void d.dismiss()
      }
      window.once('dialog', dismisser)
      await window.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(() => dialogs).toEqual(['confirm: Delete "Alpha board" and all 0 items?'])
      // Cancel means cancel: still two boards, still selected, still on disk.
      await expect(window.getByRole('heading', { name: 'Boards (2)' })).toBeVisible()
      await expect(detailTitle).toHaveText('Alpha board')
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name).sort()).toEqual([
        'Alpha board',
        'Beta board'
      ])
      expect(await readToastLog(window)).not.toContain(DELETED_TOAST)

      // ── delete, accepted ──
      dialogs.length = 0
      const accepter = (d: Dialog): void => {
        dialogs.push(`${d.type()}: ${d.message()}`)
        void d.accept()
      }
      window.once('dialog', accepter)
      await window.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(() => dialogs).toEqual(['confirm: Delete "Alpha board" and all 0 items?'])
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(window.locator('li', { hasText: 'Alpha board' })).toHaveCount(0)
      // Selection falls back to the surviving board rather than emptying out.
      await expect(detailTitle).toHaveText('Beta board')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Beta board'])
      // T-66: the delete is reversible (T-58 gave this studio real undo), so
      // the toast says how — the header's Undo button is not where anyone is
      // looking at the moment a board disappears.
      await expect.poll(() => readToastLog(window)).toContain(DELETED_TOAST)
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  // T-128 (1): a board name the layout cuts with an ellipsis is readable by hovering. The list row's name and the detail card's heading
  // were two of the spans the T-127 (15) ledger listed as still without a title (the post checklist, the variant labels, Record's sources,
  // the layer names and the highlight lines were the rest; `a11ySweep.test.ts` rule 6 holds all of them in source, this reads the built page).
  test('a long board name is cut with an ellipsis and carries its whole self as the title, in the list and in the heading (T-128 (1))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-longname')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      const name = 'Stream highlights season finale, the whole run from the first clip to the last, every platform, 2026 edition'
      const nameInput = window.getByPlaceholder('New board name', { exact: false })
      await nameInput.fill(name)
      await nameInput.press('Enter')

      const heading = window.locator('h3.text-lg')
      await expect(heading).toHaveText(name)
      const rowName = window.locator('li button span.truncate').first()
      await expect(rowName).toHaveText(name)
      for (const [label, el] of [['the list row', rowName], ['the heading', heading]] as const) {
        const cut = await el.evaluate((n) => n.scrollWidth > n.clientWidth)
        expect(cut, `${label}: the name really is cut with an ellipsis here, so the title is what reads the rest`).toBe(true)
        await expect(el, `${label} carries the whole name as its title`).toHaveAttribute('title', name)
      }
    } finally {
      await app.close()
    }
  })

  /**
   * T-58 — the References studio can undo, like the other three.
   *
   * Every assertion here is made twice: once against the screen and once
   * against `<userData>/moodboards`. A history that only rewinds the renderer
   * would pass the first half and leave the user with a board that is back on
   * screen and gone from disk — until the next `moodboard:list` quietly took
   * it away again.
   *
   * The thumbnail is the other half of "the delete never happened": the
   * delete leaves the cached file alone precisely so the undo can put a board
   * back with its pictures rather than grey squares (`sweepOrphanThumbs`
   * reclaims it on the next launch instead).
   */
  test('a deleted mood board comes back whole — items, thumbnail and file — on Undo', async () => {
    test.setTimeout(180_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
    const fx = makeFixture('refs-undo')

    const thumbPath = path.join(fx.thumbsDir, 'undo-thumb.png')
    writeFileSync(thumbPath, Buffer.from(PNG_8x6, 'base64'))
    const boardFile = path.join(fx.boardsDir, 'undoboard.json')
    const seeded = {
      id: 'undoboard',
      name: 'Undo board',
      createdAt: 1700000000000,
      items: [
        {
          id: 'undoitem',
          collectionId: 'undoboard',
          thumbnail: 'https://example.invalid/thumb.png',
          fullUrl: 'https://example.invalid/full.png',
          source: 'example.invalid',
          title: 'Undoable reference',
          cachedThumbPath: thumbPath,
          addedAt: 1700000000000
        }
      ]
    }
    writeFileSync(boardFile, JSON.stringify(seeded), 'utf8')

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()

      // T-114: exact. A board row is a named button now ("Undo board, 1 item") and this fixture's
      // board is called "Undo board", so the substring "Undo" names two buttons.
      const undo = window.getByRole('button', { name: 'Undo', exact: true })
      const redo = window.getByRole('button', { name: 'Redo', exact: true })
      const detailTitle = window.locator('h3.text-lg')
      const thumb = window.locator('img[alt="Undoable reference"]')
      const decoded = (): Promise<number> =>
        thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth)

      await expect(detailTitle).toHaveText('Undo board')
      await expect.poll(decoded, { timeout: 15_000 }).toBe(8)
      // Nothing done yet: both controls are dark.
      await expect(undo).toBeDisabled()
      await expect(redo).toBeDisabled()

      // ── delete, confirmed ──
      const dialogs: string[] = []
      const accepter = (d: Dialog): void => {
        dialogs.push(`${d.type()}: ${d.message()}`)
        void d.accept()
      }
      window.once('dialog', accepter)
      await window.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(() => dialogs)
        .toEqual(['confirm: Delete "Undo board" and all 1 item?'])
      await expect(window.getByRole('heading', { name: 'Boards (0)' })).toBeVisible()
      await expect.poll(() => readBoardsFromDisk(fx.boardsDir)).toEqual([])
      // The confirm still guards a real deletion — but not the picture.
      expect(existsSync(thumbPath)).toBe(true)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-06-board-deleted.png') })

      // ── Undo: the same board, not a new one that looks like it ──
      await expect(undo).toBeEnabled()
      await undo.click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(detailTitle).toHaveText('Undo board')
      await expect(window.locator('li', { hasText: 'Undo board' })).toContainText('1')
      await expect(thumb).toHaveAttribute('src', pathToImagiiFileUrl(thumbPath))
      await expect.poll(decoded, { timeout: 15_000 }).toBe(8)
      // Byte-for-byte the file that was deleted: same id, same createdAt,
      // same item — restored through moodboard:restore, not re-created.
      await expect
        .poll(() => (existsSync(boardFile) ? readBoardsFromDisk(fx.boardsDir) : []))
        .toEqual([seeded])
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-07-board-restored.png') })

      // ── Redo takes it away again, on screen and on disk ──
      await expect(redo).toBeEnabled()
      await redo.click()
      await expect(window.getByRole('heading', { name: 'Boards (0)' })).toBeVisible()
      await expect.poll(() => readBoardsFromDisk(fx.boardsDir)).toEqual([])

      // ── and the keyboard reaches the same history (T-15's shared hook) ──
      await window.keyboard.press('Control+z')
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(detailTitle).toHaveText('Undo board')
      await expect.poll(() => readBoardsFromDisk(fx.boardsDir)).toEqual([seeded])
      await expect(undo).toBeDisabled()
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * T-28 — Rename, through the app's own dialog. WAS a defect pin.
   *
   * MoodBoardPanel.onRename called `prompt()`, which Electron does not
   * implement: the renderer threw "prompt() is and will not be supported.",
   * no dialog reached Playwright (so no dialog handler could rescue it), no
   * toast, no error surfaced to the user, and the board kept its old name on
   * disk. It is a `<NameDialog>` now — the create-board field's pattern,
   * inside a Modal — and this test drives every way in and out of it.
   *
   * The `pageerror` recorder stays: it is what catches the whole class of
   * "this control throws in the renderer and nothing happens", and it has to
   * be empty on the way through.
   */
  // T-123 (7): Chromium dispatches a click to the COMMON ANCESTOR of where the button went down and where it came up. Press in the
  // dialog's text box (to select a word of the name) and let go a little outside the card, and that ancestor is the scrim: the
  // scrim's click handler closed the dialog and threw the typed name away. A click is a press AND a release on the scrim.
  test('a drag that starts inside the dialog and is released on the scrim neither closes it nor loses the typed name; a plain click on the scrim still does (T-123 (7))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-scrim-drag')
    const boardFile = path.join(fx.boardsDir, 'dragboard.json')
    writeFileSync(
      boardFile,
      JSON.stringify({ id: 'dragboard', name: 'Original name', createdAt: 1700000000000, items: [] }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      const detailTitle = window.locator('h3.text-lg')
      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')
      await window.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(dialog).toBeVisible()
      await field.fill('A name I have typed')

      const box = async (locator: typeof dialog): Promise<{ x: number; y: number; width: number; height: number }> => {
        const b = await locator.boundingBox()
        if (!b) throw new Error('no bounding box')
        return b
      }
      const inField = await box(field)
      const card = await box(dialog)
      // The scrim is the whole window around the card: the top-left corner is far from it.
      expect(card.x).toBeGreaterThan(40)
      expect(card.y).toBeGreaterThan(40)

      // ── press in the text box, release on the scrim: the dialog stays and the name survives ──
      await window.mouse.move(inField.x + 24, inField.y + inField.height / 2)
      await window.mouse.down()
      await window.mouse.move(inField.x + 8, inField.y + inField.height / 2, { steps: 3 })
      await window.mouse.move(12, 12, { steps: 12 })
      await window.mouse.up()
      await expect(dialog, 'a drag out of the card is not a click on the scrim').toBeVisible()
      await expect(field).toHaveValue('A name I have typed')

      // ── press on the card's padding, release on the scrim: the same ──
      await window.mouse.move(card.x + 4, card.y + 4)
      await window.mouse.down()
      await window.mouse.move(12, 12, { steps: 8 })
      await window.mouse.up()
      await expect(dialog).toBeVisible()
      await expect(field).toHaveValue('A name I have typed')

      // ── press on the scrim, release inside the card: not a click on the scrim either ──
      await window.mouse.move(12, 12)
      await window.mouse.down()
      await window.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 12 })
      await window.mouse.up()
      await expect(dialog).toBeVisible()
      await expect(field).toHaveValue('A name I have typed')

      // ── a click inside the card does nothing to it, and does not leave a stale press behind ──
      await dialog.locator('h2.text-lg').click()
      await expect(dialog).toBeVisible()

      // ── the control: a plain click on the scrim (press and release both there) closes it, and the board is untouched ──
      await window.mouse.click(12, 12)
      await expect(dialog).toHaveCount(0)
      await expect(detailTitle).toHaveText('Original name')
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Original name'])
    } finally {
      await app.close()
    }
  })

  test('the Rename dialog renames on Enter and on the button, and both cancels leave disk alone', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-rename')
    const boardFile = path.join(fx.boardsDir, 'renameboard.json')
    writeFileSync(
      boardFile,
      JSON.stringify({
        id: 'renameboard',
        name: 'Original name',
        createdAt: 1700000000000,
        items: []
      }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      // A native-dialog spy: nothing here may reach one. The old code's
      // failure was that this stayed empty AND nothing happened; the new
      // code's contract is that it stays empty and the rename lands.
      const nativeDialogs: string[] = []
      window.on('dialog', (d: Dialog) => {
        nativeDialogs.push(`${d.type()}: ${d.message()}`)
        void d.dismiss()
      })
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      const detailTitle = window.locator('h3.text-lg')
      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')
      // Safe to address unscoped ONLY while the dialog is shut — its confirm
      // button carries the same name.
      const openRename = window.getByRole('button', { name: 'Rename', exact: true })
      await expect(detailTitle).toHaveText('Original name')

      // ── the dialog opens pre-filled with the name it is about to change ──
      await openRename.click()
      await expect(dialog).toBeVisible()
      await expect(field).toHaveValue('Original name')
      // Focus is in the field with the old name selected, so typing replaces
      // rather than appends — the reason a rename dialog pre-fills at all.
      expect(
        await window.evaluate(() => {
          const el = document.activeElement as HTMLInputElement | null
          return el?.tagName === 'INPUT' ? (el.selectionEnd ?? 0) - (el.selectionStart ?? 0) : -1
        })
      ).toBe('Original name'.length)

      // ── Escape abandons it: on screen and on disk ──
      await field.fill('Abandoned by Escape')
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(detailTitle).toHaveText('Original name')
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Original name'])

      // ── Cancel abandons it too, and the field comes back clean ──
      await openRename.click()
      await expect(field).toHaveValue('Original name')
      await field.fill('Abandoned by Cancel')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(detailTitle).toHaveText('Original name')
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Original name'])

      // ── a blank name cannot be confirmed (the create-board field's rule) ──
      await openRename.click()
      await field.fill('   ')
      await expect(dialog.getByRole('button', { name: 'Rename' })).toBeDisabled()
      await field.press('Enter')
      await expect(dialog).toBeVisible()
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Original name'])

      // ── Enter renames, everywhere the name is shown and in the file ──
      await field.fill('Renamed board')
      await field.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect(detailTitle).toHaveText('Renamed board')
      await expect(window.locator('li', { hasText: 'Renamed board' })).toHaveCount(1)
      await expect(window.locator('li', { hasText: 'Original name' })).toHaveCount(0)
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Renamed board'])
      // Same board, not a new one wearing the name: id and createdAt survive.
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => [b.id, b.createdAt])).toEqual([
        ['renameboard', 1700000000000]
      ])

      // ── and it went through the store, so it is undoable like every other
      //    board edit (T-58 / round 38) ──
      const undo = window.getByRole('button', { name: 'Undo' })
      await expect(undo).toBeEnabled()
      await undo.click()
      await expect(detailTitle).toHaveText('Original name')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Original name'])
      await window.getByRole('button', { name: 'Redo' }).click()
      await expect(detailTitle).toHaveText('Renamed board')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Renamed board'])

      // ── the confirm BUTTON is a second way in, not decoration ──
      await openRename.click()
      await field.fill('Renamed by button')
      await dialog.getByRole('button', { name: 'Rename' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(detailTitle).toHaveText('Renamed by button')
      await expect
        .poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name))
        .toEqual(['Renamed by button'])

      // Nothing threw on any of those paths, and no native dialog was asked
      // for — the two halves of the defect this test used to pin.
      expect(pageErrors).toEqual([])
      expect(nativeDialogs).toEqual([])
      // The rename speaks for itself on screen; it raises no toast.
      expect(await readToastLog(window)).toEqual([])
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * T-28 — the FIRST save: no board yet, and Save has to make one.
   *
   * `ReferencePanel.ensureCollection` asked for the board name with
   * `prompt()` too, so a brand-new user's first Save threw in the renderer.
   * Worse, the button was disabled whenever there were no boards, which is
   * the state that branch exists for — the flow was unreachable AND broken,
   * and the disabled button is why nobody noticed.
   *
   * Hermetic: `search:images` is answered in MAIN with one synthetic result
   * (the technique the empty-results test above documents), and its
   * thumbnail is served by an HTTP server this test owns — so the
   * thumbnail cache really is written by a real `net.fetch`, and the
   * mood-board tile that comes back is bytes off this machine.
   */
  test('saving a result with no board yet names one, creates it, and saves into it', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-firstsave')
    const png = Buffer.from(PNG_8x6, 'base64')
    const thumbServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      res.end(png)
    })
    await new Promise<void>((resolve) => thumbServer.listen(0, '127.0.0.1', resolve))
    const thumbUrl = `http://127.0.0.1:${(thumbServer.address() as net.AddressInfo).port}/thumb.png`

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      await stubOneSearchResult(app, thumbUrl)
      await openReferences(window)
      await installToastLog(window)

      // No boards at all — the state the old build refused to serve.
      expect(readBoardsFromDisk(fx.boardsDir)).toHaveLength(0)

      const input = window.getByPlaceholder(searchPlaceholder, { exact: false })
      await input.fill('minimalist mountain photography')
      await input.press('Enter')
      const save = window.getByRole('button', { name: 'Save', exact: false })
      await expect(save).toHaveCount(1)
      // Enabled with zero boards: having none is a reason to ask for one.
      await expect(save).toBeEnabled()

      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')

      // ── T-115/T-116: Save lives in an overlay that is drawn only on hover - and on KEYBOARD focus ──
      // Tab reaches the button, and a button drawn at opacity 0 is one a keyboard user presses
      // blind. Parked mouse, so only the keyboard can be what shows it. The Search button sits
      // right before the first tile, so one Tab from it is the real route to Save.
      const overlay = save.locator('xpath=..')
      const searchButton = window.getByRole('button', { name: 'Search', exact: true })
      await window.mouse.move(0, 0)
      await expect(overlay, 'at rest the tile shows only its picture').toHaveCSS('opacity', '0')
      await searchButton.focus()
      await window.keyboard.press('Tab')
      await expect(save, 'Tab from Search lands on Save').toBeFocused()
      await expect(overlay, 'a Tab-focused Save is visible').toHaveCSS('opacity', '1')
      await window.keyboard.press('Shift+Tab')
      await expect(save).not.toBeFocused()
      await expect(overlay, 'and goes back when focus leaves').toHaveCSS('opacity', '0')

      // ── canceling writes nothing at all ── (opened from the keyboard: Tab, then Enter)
      await window.keyboard.press('Tab')
      await expect(save).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Name your first mood board').first()).toBeVisible()
      await expect(field).toHaveValue('')
      await expect(dialog.getByRole('button', { name: 'Create & save' })).toBeDisabled()
      await field.fill('Abandoned board')
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(readBoardsFromDisk(fx.boardsDir)).toHaveLength(0)
      expect(await readToastLog(window)).toEqual([])

      // ── and the real thing: one continuation creates the board AND saves ──
      await save.click()
      await expect(field).toHaveValue('')
      await field.fill('Inspiration')
      await field.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => readToastLog(window)).toContain('Saved to "Inspiration"')

      await expect.poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual([
        'Inspiration'
      ])
      const [board] = readBoardsFromDisk(fx.boardsDir)
      expect(board?.items).toHaveLength(1)
      const item = board?.items[0]
      expect(item?.title).toBe('Stubbed reference')
      expect(item?.fullUrl).toBe(thumbUrl)
      // The thumbnail was cached into <userData>/cache/thumbs by the main
      // process's own fetch, and the file holds the bytes this test served.
      expect(item?.cachedThumbPath).toBeTruthy()
      expect(path.dirname(item?.cachedThumbPath ?? '')).toBe(fx.thumbsDir)
      expect(readFileSync(item?.cachedThumbPath ?? '')).toEqual(png)

      // ── the board is real in the UI too, with the picture decoded ──
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(window.locator('h3.text-lg')).toHaveText('Inspiration')
      const thumb = window.locator('img[alt="Stubbed reference"]')
      await expect(thumb).toHaveAttribute(
        'src',
        pathToImagiiFileUrl(item?.cachedThumbPath ?? '')
      )
      await expect
        .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          timeout: 15_000
        })
        .toBe(8)

      // ── with a board selected, Save no longer asks — it just saves ──
      await window.getByRole('button', { name: 'Reference Search', exact: true }).click()
      await input.fill('a second look')
      await input.press('Enter')
      await save.click()
      // Same fullUrl, so the store de-duplicates rather than adding a twin —
      // but the toast still names where it went, and no dialog appears.
      await expect(dialog).toHaveCount(0)
      await expect
        .poll(() => readToastLog(window).then((l) => l.filter((t) => t.includes('Inspiration'))))
        .toHaveLength(2)

      // ── T-116: a MOUSE click is not keyboard focus ──
      // The click left Save focused, and the overlay used to stay lit (focus-within) until focus
      // moved on: a scrim stuck over the picture after the pointer had left. Under the pointer
      // the tile is lit; once the pointer leaves, it is not - with Save still the focused element.
      await expect(overlay, 'under the pointer the tile is lit').toHaveCSS('opacity', '1')
      await window.mouse.move(0, 0)
      await expect(save, 'the click left Save focused').toBeFocused()
      await expect(overlay, 'a clicked Save lets go when the pointer leaves').toHaveCSS('opacity', '0')

      expect(pageErrors).toEqual([])
    } finally {
      thumbServer.close()
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('a saved item goes to the canvas as a 40% overlay, and Remove is undoable', async () => {
    test.setTimeout(120_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
    const fx = makeFixture('refs-item')

    // Seed one board holding one item whose thumbnail is a real PNG inside
    // <userData>/cache/thumbs — the only directory moodboard.ts's
    // confineThumbPath will let a cachedThumbPath point at.
    const thumbPath = path.join(fx.thumbsDir, 'seeded-thumb.png')
    writeFileSync(thumbPath, Buffer.from(PNG_8x6, 'base64'))
    const boardFile = path.join(fx.boardsDir, 'seededboard.json')
    writeFileSync(
      boardFile,
      JSON.stringify({
        id: 'seededboard',
        name: 'Seeded board',
        createdAt: 1700000000000,
        items: [
          {
            id: 'seededitem',
            collectionId: 'seededboard',
            thumbnail: 'https://example.invalid/thumb.png',
            fullUrl: 'https://example.invalid/full.png',
            source: 'example.invalid',
            title: 'Seeded reference',
            cachedThumbPath: thumbPath,
            addedAt: 1700000000000
          }
        ]
      }),
      'utf8'
    )

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await expect(window.locator('h3.text-lg')).toHaveText('Seeded board')
      // The row's count badge and the item tile both come from the seeded JSON.
      await expect(window.locator('li', { hasText: 'Seeded board' })).toContainText('1')

      // The thumbnail is served through imagii-file:// and really decodes —
      // src is the shared builder's output, and naturalWidth proves the
      // protocol handler returned the bytes rather than a 403.
      const thumb = window.locator('img[alt="Seeded reference"]')
      await expect(thumb).toHaveAttribute('src', pathToImagiiFileUrl(thumbPath))
      await expect
        .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          timeout: 15_000
        })
        .toBe(8)

      // ── -> Canvas bridge ──
      // T-115/T-116: the button sits in an overlay drawn only on hover - and on KEYBOARD focus.
      const toCanvas = window.getByRole('button', { name: /Canvas/ })
      const tileOverlay = toCanvas.locator('xpath=..')
      await window.mouse.move(0, 0)
      await expect(tileOverlay, 'at rest the tile shows only its picture').toHaveCSS('opacity', '0')
      // A mouse press focuses the button but is not keyboard focus: press it, drag off the tile
      // and let go elsewhere (so the click never fires and the studio stays put). The button keeps
      // focus and the scrim must not - this is the stuck overlay a click used to leave.
      await toCanvas.hover()
      await expect(tileOverlay, 'under the pointer the tile is lit').toHaveCSS('opacity', '1')
      await window.mouse.down()
      await window.mouse.move(0, 0)
      await window.mouse.up()
      await expect(toCanvas, 'the press left "→ Canvas" focused').toBeFocused()
      await expect(tileOverlay, 'a pressed "→ Canvas" lets go when the pointer leaves').toHaveCSS('opacity', '0')
      expect(window.url()).not.toContain('#/image')
      // Reached from the keyboard with the mouse parked: it must be visible, and Enter must do the
      // whole job. Delete is the control before the tile's in tab order.
      await window.getByRole('button', { name: 'Delete', exact: true }).focus()
      await window.keyboard.press('Tab')
      await expect(toCanvas, 'Tab from Delete lands on "→ Canvas"').toBeFocused()
      await expect(tileOverlay, 'a Tab-focused "→ Canvas" is visible').toHaveCSS('opacity', '1')
      await window.keyboard.press('Enter')
      await expect
        .poll(() => readToastLog(window))
        .toContain("Added to canvas as a reference \u2014 it won't be in your export")
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({
        timeout: 15_000
      })
      expect(window.url()).toContain('#/image')
      // T-125 (19): the toast says what the reference is NOT (it won't be in the export), and the studio changes under it as it
      // appears, so it is held as long as an action toast: still up 4.5 s on (a success toast is taken down at about 3 s).
      await window.mouse.move(2, 2)
      await window.waitForTimeout(4_500)
      await expect(
        window.getByText("Added to canvas as a reference \u2014 it won't be in your export"),
        'the reference note outlives a success toast\'s default'
      ).toBeVisible()

      // canvasStore gained exactly one image layer, named from the item
      // title, and PropertiesPanel shows it selected at 40% opacity.
      await expect(window.getByRole('heading', { name: 'Layers (1)' })).toBeVisible()
      await expect(layerRows(window)).toHaveText(['Seeded reference'])
      const opacity = window.locator('input[aria-label="Layer opacity"]')
      await expect(opacity).toHaveValue('0.4')
      await expect(opacity).toHaveAttribute('aria-valuetext', '40 percent')
      // T-91: the layer says, where it is listed, that it is a guide…
      await expect(window.locator('[data-tutorial="image-layers"] li')).toContainText(
        "reference \u2014 won't export"
      )
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-02-canvas-overlay.png') })

      // …and an export proves it: the faded red picture sits at (60, 60) on a
      // white page, and the file has white there, not a 40% pink.
      const exportsDir = path.join(fx.root, 'exports')
      mkdirSync(exportsDir, { recursive: true })
      await app.evaluate(({ dialog }, dir) => {
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
          _w: unknown,
          o: { defaultPath?: string }
        ) => ({
          canceled: false,
          filePath: `${dir}/${(o.defaultPath ?? 'out.png').split(/[\\/]/).pop()}`
        })
      }, exportsDir)
      await window.getByLabel('Scale').selectOption('1')
      await window.getByRole('button', { name: 'Export', exact: true }).click()
      await expect.poll(() => readdirSync(exportsDir).length, { timeout: 30_000 }).toBe(1)
      const exported = path.join(exportsDir, readdirSync(exportsDir)[0] as string)
      expect(await pngPixel(exported, 62, 62), 'the reference is not in the export').toEqual({
        r: 255,
        g: 255,
        b: 255,
        a: 255
      })

      // ── back to the board; Remove the item ──
      await backToReferences(window)
      // The studio reopens on the tab it was left on.
      await expect(window.locator('h3.text-lg')).toHaveText('Seeded board')
      expect(existsSync(thumbPath)).toBe(true)

      await window.getByRole('button', { name: 'Remove item' }).click()
      await expect(
        window.getByText('Empty. Switch to Reference Search and click Save to add inspiration here.')
      ).toBeVisible()
      await expect(window.locator('img[alt="Seeded reference"]')).toHaveCount(0)
      await expect(window.locator('li', { hasText: 'Seeded board' })).toContainText('0')
      // Removal is durable in the board file…
      await expect
        .poll(() => (JSON.parse(readFileSync(boardFile, 'utf8')) as MoodBoardCollection).items)
        .toEqual([])
      // …and T-58 leaves the cached thumbnail where it is, because the very
      // next thing the user may do is take the removal back. (The orphan is
      // reclaimed by sweepOrphanThumbs on the next launch — moodboard.test.ts
      // pins both halves.)
      expect(existsSync(thumbPath)).toBe(true)

      // ── Undo puts the item back, picture and all ──
      await window.getByRole('button', { name: 'Undo' }).click()
      await expect(window.locator('li', { hasText: 'Seeded board' })).toContainText('1')
      const restoredThumb = window.locator('img[alt="Seeded reference"]')
      await expect(restoredThumb).toHaveAttribute('src', pathToImagiiFileUrl(thumbPath))
      await expect
        .poll(() => restoredThumb.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          timeout: 15_000
        })
        .toBe(8)
      await expect
        .poll(() =>
          (JSON.parse(readFileSync(boardFile, 'utf8')) as MoodBoardCollection).items.map(
            (i) => i.id
          )
        )
        .toEqual(['seededitem'])
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * T-29 — "Clear thumbnail cache" clears the thumbnail cache.
   *
   * It used to be a defect pin, in both directions: the button was wired to
   * `moodboard:prune`, whose handler called `pruneThumbCache()` with its
   * DEFAULT 500 MB budget — an LRU trim, not a clear — so for every user
   * whose cache was under 500 MB (essentially every user) it deleted nothing
   * while the toast said "Thumbnail cache cleared". The channel is
   * `moodboard:clearThumbs` now and the call under it takes no budget at
   * all — the name and the operation are the same thing.
   *
   * The board that owns these thumbs is not decoration: T-58's startup sweep
   * reclaims cached files no board refers to, so a fixture of free-floating
   * thumbs would be gone before the first click and an empty directory would
   * prove nothing about the button.
   *
   * (T-79 removed the budgeted trim entirely; the clear is all that is left
   * of the function, and the tiles it empties out from under heal — the test
   * below.)
   */
  test('Clear thumbnail cache empties the cache under the budget too', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-clear')

    const owned = ['old-a.jpg', 'old-b.jpg']
    owned.forEach((name, i) => {
      const file = path.join(fx.thumbsDir, name)
      writeFileSync(file, Buffer.alloc(1024))
      const t = 1_700_000_000 + i
      utimesSync(file, t, t)
    })
    writeFileSync(
      path.join(fx.boardsDir, 'pruneboard.json'),
      JSON.stringify(boardOwning('pruneboard', 'Prune board', fx.thumbsDir, owned)),
      'utf8'
    )

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      // 2 KB against the 500 MB budget the old wiring measured itself by — a
      // quarter of a million times under it, and the whole cache, which is
      // what the button asked for.
      expect(readdirSync(fx.thumbsDir).sort()).toEqual(owned)
      // T-123 (33): the tooltip says the verb the button, the toast and BRANDING's Destruction verbs say. It said "Drop",
      // the app's drag-and-drop verb, for the one control that empties a folder.
      await expect(window.getByRole('button', { name: 'Clear thumbnail cache' })).toHaveAttribute(
        'title',
        'Clear the on-disk thumbnail cache for mood boards'
      )
      await window.getByRole('button', { name: 'Clear thumbnail cache' }).click()
      await expect.poll(() => readToastLog(window)).toContain('Thumbnail cache cleared')
      await expect.poll(() => readdirSync(fx.thumbsDir), { timeout: 30_000 }).toEqual([])

      // The boards themselves are untouched: this frees pictures that
      // re-download, not the user's references.
      expect(readBoardsFromDisk(fx.boardsDir).map((c) => c.id)).toEqual(['pruneboard'])
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * T-79 — a cleared cache heals; it does not leave a board of broken tiles.
   *
   * The board file keeps its `cachedThumbPath` after a clear (the button
   * frees disk, it does not edit the user's references), so the tile asks
   * `imagii-file://` for a file that is no longer there. Before the fallback
   * that was a permanently broken image: the one control on the panel that
   * IS supposed to delete something took every picture with it. The item's
   * own `thumbnail` URL is the picture's origin and never went anywhere, so
   * a failed load swaps to it and the tile comes back.
   *
   * The remote here is a `data:` URL carrying the same real PNG bytes the
   * rest of this file serves over HTTP. The renderer's CSP allows `https:`
   * and `data:` for images but not `http:`, so the local HTTP server the
   * first-save test uses — the right harness for a MAIN-process fetch —
   * cannot stand in for a picture the RENDERER loads. Live https thumbnails
   * stay HL-network; what is under test is the swap and that the bytes it
   * lands on decode.
   */
  test('a tile whose cached file was cleared falls back to its source image (T-79)', async () => {
    test.setTimeout(180_000)
    const fx = makeFixture('refs-fallback')
    const remote = `data:image/png;base64,${PNG_8x6}`

    const cachedThumbPath = path.join(fx.thumbsDir, 'cached-thumb.png')
    writeFileSync(cachedThumbPath, Buffer.from(PNG_8x6, 'base64'))
    writeFileSync(
      path.join(fx.boardsDir, 'healboard.json'),
      JSON.stringify({
        id: 'healboard',
        name: 'Heal board',
        createdAt: 1700000000000,
        items: [
          {
            id: 'healitem',
            collectionId: 'healboard',
            thumbnail: remote,
            fullUrl: 'https://example.invalid/full.png',
            source: 'example.invalid',
            title: 'Healing reference',
            cachedThumbPath,
            addedAt: 1700000000000
          }
        ]
      }),
      'utf8'
    )

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      // ── before: the tile is the cached file, decoded from disk ──
      const tile = window.locator('img[alt="Healing reference"]')
      await expect(tile).toHaveAttribute('src', pathToImagiiFileUrl(cachedThumbPath))
      await expect
        .poll(() => tile.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          timeout: 15_000
        })
        .toBe(8)

      await window.getByRole('button', { name: 'Clear thumbnail cache' }).click()
      await expect.poll(() => readToastLog(window)).toContain('Thumbnail cache cleared')
      await expect.poll(() => readdirSync(fx.thumbsDir), { timeout: 30_000 }).toEqual([])
      // The reference itself is untouched — which is exactly why the tile
      // still asks for a file that is gone.
      expect(readBoardsFromDisk(fx.boardsDir)[0]?.items[0]?.cachedThumbPath).toBe(cachedThumbPath)
    } finally {
      await app.close()
    }

    // ── after: the next visit finds the picture, not a hole ──
    // A fresh launch rather than a re-render: the decoded image is already
    // in the tile that cleared the cache, and a user meets the empty cache
    // the next time they open the app.
    const again = await launchApp(fx.userDataDir)
    try {
      const window = await again.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      const tile = window.locator('img[alt="Healing reference"]')
      await expect(tile).toHaveAttribute('src', remote, { timeout: 15_000 })
      await expect
        .poll(() => tile.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
          timeout: 15_000
        })
        .toBe(8)
    } finally {
      await again.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * T-79 — launch maintenance never eats a picture a board still points at.
   *
   * This test is the round-47 launch-LRU test, flipped. Round 47 chained the
   * 500 MB `pruneThumbCache` after the orphan sweep so the budget would have
   * an automatic caller. But the sweep runs first and removes every orphan,
   * so by the time an LRU runs, every surviving file is one a board REFERS
   * TO: past the budget it could only ever delete a user's own references,
   * silently, with the board still pointing at the hole. The chain is the
   * sweep alone now, and this pins that the pictures survive a launch far
   * over any plausible budget.
   *
   * Nothing is clicked: launching the app IS the action. The unowned orphan
   * is the proof the maintenance chain really ran — without it, a green here
   * could just as well mean nothing happened at all. The over-cap files are
   * sparse (ftruncate writes no blocks), so 600 MB of fixture costs bytes of
   * real disk.
   */
  test('launching far over any budget deletes no board-owned thumbnail (T-79)', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-lru')
    const MB = 1024 * 1024
    const old = 1_700_000_000

    // Owned by a board, and old: the two properties a doomed file needed
    // under the LRU, so if a budget still ran these are the first to go.
    const small = ['old-a.jpg', 'old-b.jpg']
    small.forEach((name, i) => {
      const file = path.join(fx.thumbsDir, name)
      writeFileSync(file, Buffer.alloc(1024))
      utimesSync(file, old + i, old + i)
    })
    const big = ['big-1.jpg', 'big-2.jpg']
    big.forEach((name, i) => {
      const file = path.join(fx.thumbsDir, name)
      const fd = openSync(file, 'w')
      ftruncateSync(fd, 300 * MB)
      closeSync(fd)
      utimesSync(file, old + 100 + i, old + 100 + i)
    })
    const owned = [...small, ...big].sort()
    // Referred to by nothing: the sweep's own work, and this test's signal
    // that the launch chain reached the disk at all.
    const orphan = path.join(fx.thumbsDir, 'orphan.jpg')
    writeFileSync(orphan, Buffer.alloc(1024))
    utimesSync(orphan, old, old)
    writeFileSync(
      path.join(fx.boardsDir, 'lruboard.json'),
      JSON.stringify(boardOwning('lruboard', 'LRU board', fx.thumbsDir, owned)),
      'utf8'
    )

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      // The sweep ran — so anything that was going to delete has had its turn.
      await expect.poll(() => existsSync(orphan), { timeout: 30_000 }).toBe(false)
      expect(readdirSync(fx.thumbsDir).sort()).toEqual(owned)
      // And the board is whole on screen: four items, none of them a hole.
      await expect(window.locator('li', { hasText: 'LRU board' })).toContainText('4')
      await expect(window.locator('img[alt^="Cached "]')).toHaveCount(4)

      // Closing the app is the last moment the launch chain could still be
      // unlinking; the files outlive it.
      await app.close()
      expect(readdirSync(fx.thumbsDir).sort()).toEqual(owned)

      // A second launch on the same over-budget cache is no hungrier.
      const again = await launchApp(fx.userDataDir)
      try {
        await again.firstWindow()
        await expect.poll(() => readdirSync(fx.thumbsDir).sort(), { timeout: 30_000 }).toEqual(owned)
      } finally {
        await again.close()
      }
      expect(readdirSync(fx.thumbsDir).sort()).toEqual(owned)
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('Asset Library: cards from two categories each replace the canvas document', async () => {
    test.setTimeout(120_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
    const fx = makeFixture('refs-assets')

    // Expectations derived from the catalog module, not transcribed from
    // it: a catalog edit that changes these assets fails the test loudly
    // instead of leaving a stale hardcoded list passing.
    const sceneCard = ASSET_CATALOG.find((a) => a.id === 'scene-brb')
    const socialCard = ASSET_CATALOG.find((a) => a.id === 'social-square-clip')
    expect(sceneCard, 'catalog asset scene-brb').toBeTruthy()
    expect(socialCard, 'catalog asset social-square-clip').toBeTruthy()
    if (!sceneCard || !socialCard) return
    // LayerPanel renders top layer first, i.e. the doc order reversed.
    const rowsFor = (a: typeof sceneCard): string[] =>
      [...a.doc.layers].reverse().map((l) => l.name)

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await window.getByRole('button', { name: 'Asset Library', exact: true }).click()

      // ── card 1: a scene card ──
      await window.getByRole('button', { name: new RegExp(sceneCard.name) }).click()
      await expect
        .poll(() => readToastLog(window))
        .toContain(`Dropped "${sceneCard.name}" into the editor`)
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({
        timeout: 15_000
      })
      expect(window.url()).toContain('#/image')
      await expect(
        window.getByRole('heading', { name: `Layers (${sceneCard.doc.layers.length})` })
      ).toBeVisible()
      await expect(layerRows(window)).toHaveText(rowsFor(sceneCard))
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-03-asset-scene-card.png') })

      // ── card 2: a different category REPLACES, never appends ──
      await backToReferences(window)
      await window.getByRole('button', { name: new RegExp(socialCard.name) }).click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({
        timeout: 15_000
      })
      await expect(
        window.getByRole('heading', { name: `Layers (${socialCard.doc.layers.length})` })
      ).toBeVisible()
      await expect(layerRows(window)).toHaveText(rowsFor(socialCard))
      // Nothing from the first asset survived the swap.
      for (const gone of rowsFor(sceneCard)) {
        if (rowsFor(socialCard).includes(gone)) continue
        await expect(layerRows(window).filter({ hasText: gone })).toHaveCount(0)
      }
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  // T-133 (8): the Search button is disabled while a request is out and the input's Enter was not, so a second press (or a held key) sent a second
  // request, and whichever answered LAST owned the grid. T-134 (3): the guard it landed refused EVERY press while a request was out, which threw
  // away a corrected query (type, Enter, spot the typo, fix it, Enter) and left the typo's answer on a grid no query on the page named. Now a press
  // of the query that is already out sends nothing (a held Enter is one request), a DIFFERENT query goes out at once, and an answer is drawn only if
  // it belongs to the newest request. Main's handler holds the first request open (and counts its calls), so "while a request is out" is a state the
  // test creates; every result is a one-pixel data: image titled with the query it answers (no network), so the grid says whose answer it is.
  test('Reference Search: a held Enter is one request, a corrected query is answered, and the typo\'s late answer never replaces it (T-133 (8), T-134 (3))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-search-once')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await app.evaluate(async ({ ipcMain }) => {
        const g = globalThis as unknown as { __searchCalls: string[]; __releaseSearch: () => void }
        g.__searchCalls = []
        const gate = new Promise<void>((resolve) => {
          g.__releaseSearch = resolve
        })
        const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        ipcMain.removeHandler('search:images')
        ipcMain.handle('search:images', async (_e, query: unknown) => {
          g.__searchCalls.push(String(query))
          // Only the FIRST request (the typo) is held open; everything after it answers at once.
          if (g.__searchCalls.length === 1) await gate
          return {
            query: String(query),
            provider: 'duckduckgo',
            results: [{ id: 'r1', thumbnail: PIXEL, fullUrl: PIXEL, source: 'local', title: `answer to ${String(query)}` }]
          }
        })
      })
      const calls = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { __searchCalls: string[] }).__searchCalls)
      const input = window.getByPlaceholder(searchPlaceholder, { exact: false })
      const searchButton = window.locator('.card', { has: input }).getByRole('button')

      // A typo, Enter, and the key held: ONE request for three presses of one query.
      await input.fill('minimalist mountian photography')
      await input.press('Enter')
      await expect(searchButton).toHaveText('Searching…')
      await input.press('Enter')
      await input.press('Enter')
      await window.waitForTimeout(400)
      expect(await calls(), 'one request for three presses of one query').toEqual(['minimalist mountian photography'])

      // The person sees the typo, corrects it, presses Enter: that is a different question, and it is asked now.
      await input.fill('minimalist mountain photography')
      await input.press('Enter')
      await expect.poll(calls, { timeout: 10_000 }).toEqual(['minimalist mountian photography', 'minimalist mountain photography'])
      // ... and its answer is on the grid, the panel idle, while the typo's request is STILL out.
      await expect(window.locator('img[alt="answer to minimalist mountain photography"]')).toBeVisible({ timeout: 10_000 })
      await expect(searchButton).toHaveText('Search')

      // The typo's answer arrives late: it must not take the grid back.
      await app.evaluate(() => (globalThis as unknown as { __releaseSearch: () => void }).__releaseSearch())
      await window.waitForTimeout(700)
      await expect(window.locator('img[alt="answer to minimalist mountian photography"]'), 'the late answer to the typo was drawn').toHaveCount(0)
      await expect(window.locator('img[alt="answer to minimalist mountain photography"]')).toBeVisible()
      await expect(searchButton).toHaveText('Search')

      // Once nothing is out, the next Enter is a search like any other.
      await input.press('Enter')
      await expect.poll(calls, { timeout: 10_000 }).toHaveLength(3)
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  // T-135 (5): T-134 (3) made a corrected query go out, but only on Enter: the Search button was `disabled={loading}`, so a pointer or voice-control
  // user could not send the correction. It is off now only for the question that is already out (typed text equals the in-flight query), and a
  // click on it sends the correction exactly as Enter does. And the input was the panel's own state while the grid is the store's: a trip to Mood
  // Boards and back drew the grid over a blank box (the state STYLE_GUIDE calls a defect). The input is seeded from the store's query on mount.
  // Same stand-in handler as the case above: the first request is held, every other one answers at once, one-pixel data: images named for the query.
  test('Reference Search: a corrected query is sent BY CLICK while the typo is out, and the box names the grid after a trip to another tab (T-135 (5))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-search-click')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await app.evaluate(async ({ ipcMain }) => {
        const g = globalThis as unknown as { __searchCalls: string[]; __releaseSearch: () => void }
        g.__searchCalls = []
        const gate = new Promise<void>((resolve) => {
          g.__releaseSearch = resolve
        })
        const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        ipcMain.removeHandler('search:images')
        ipcMain.handle('search:images', async (_e, query: unknown) => {
          g.__searchCalls.push(String(query))
          if (g.__searchCalls.length === 1) await gate
          return {
            query: String(query),
            provider: 'duckduckgo',
            results: [{ id: 'r1', thumbnail: PIXEL, fullUrl: PIXEL, source: 'local', title: `answer to ${String(query)}` }]
          }
        })
      })
      const calls = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { __searchCalls: string[] }).__searchCalls)
      const input = window.getByPlaceholder(searchPlaceholder, { exact: false })
      const searchButton = window.locator('.card', { has: input }).getByRole('button')
      const referenceTab = window.getByRole('button', { name: 'Reference Search', exact: true })

      // The typo goes out by CLICK and is held: the button says so and is off - for this question.
      await input.fill('minimalist mountian photography')
      await searchButton.click()
      await expect(searchButton).toHaveText('Searching…')
      await expect(searchButton).toBeDisabled()
      await searchButton.click({ force: true }) // a second press of the same question is not sent
      await window.waitForTimeout(300)
      expect(await calls(), 'one request for the typo').toEqual(['minimalist mountian photography'])

      // A trip to Mood Boards and back while the typo is out: the box still says what was asked, and the button still says it is out.
      await moodBoardTab(window).click()
      await expect(input).toHaveCount(0)
      await referenceTab.click()
      await expect(input, 'the box names the question that is out').toHaveValue('minimalist mountian photography')
      await expect(searchButton).toHaveText('Searching…')
      await expect(searchButton).toBeDisabled()

      // The correction: the button is a button again the moment the text differs, and a click sends it.
      await input.fill('minimalist mountain photography')
      await expect(searchButton).toBeEnabled()
      await expect(searchButton).toHaveText('Search')
      await searchButton.click()
      await expect.poll(calls, { timeout: 10_000 }).toEqual(['minimalist mountian photography', 'minimalist mountain photography'])
      await expect(window.locator('img[alt="answer to minimalist mountain photography"]')).toBeVisible({ timeout: 10_000 })

      // The typo's late answer is dropped, as it is for Enter.
      await app.evaluate(() => (globalThis as unknown as { __releaseSearch: () => void }).__releaseSearch())
      await window.waitForTimeout(500)
      await expect(window.locator('img[alt="answer to minimalist mountian photography"]')).toHaveCount(0)
      await expect(searchButton).toHaveText('Search')

      // Away and back with the grid on screen: the box names it (it was blank over the grid).
      await input.fill('something half typed')
      await moodBoardTab(window).click()
      await referenceTab.click()
      await expect(window.locator('img[alt="answer to minimalist mountain photography"]'), 'the grid is the store\'s and is still there').toBeVisible()
      await expect(input, 'and the box says which search it is').toHaveValue('minimalist mountain photography')
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  // T-135 (13): "→ Canvas" awaits the picture's load before it adds the layer, and the load can be a NETWORK fetch (a tile whose cached thumbnail is gone
  // falls back to the URL it came from). `navigate('/image')` ran after that wait wherever the person was: the T-134 (1) class at one more site, blessed
  // by the same click-time premise ("the person is on References, pressing a button on the screen"). The layer is added and the toast reports it
  // either way; the person is taken to the canvas only if they are still on References when the picture arrives. The renderer's content policy allows
  // images from https only, so a held network fetch cannot be served from here; the test holds the bridge's own `new Image()` instead (the page's
  // `HTMLImageElement.src` setter parks the assignment for a file named "slow" until the test releases it), which is exactly the wait the premise
  // missed: the load is started by the press and ends whenever the test says.
  test('→ Canvas that finishes after the person went to another screen adds the layer and leaves them where they are; one they waited for still opens the canvas (T-135 (13))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-tocanvas-away')
    const thumbPath = path.join(fx.thumbsDir, 'slow-thumb.png')
    writeFileSync(thumbPath, Buffer.from(PNG_8x6, 'base64'))
    writeFileSync(
      path.join(fx.boardsDir, 'slowboard.json'),
      JSON.stringify({
        id: 'slowboard',
        name: 'Slow board',
        createdAt: 1700000000000,
        items: [
          {
            id: 'slowitem',
            collectionId: 'slowboard',
            thumbnail: 'https://example.invalid/slow-thumb.png',
            fullUrl: 'https://example.invalid/full.png',
            source: 'example.invalid',
            title: 'Slow reference',
            cachedThumbPath: thumbPath,
            addedAt: 1700000000000
          }
        ]
      }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      const toCanvas = window.getByRole('button', { name: /Canvas/ })
      const ADDED = "Added to canvas as a reference \u2014 it won't be in your export"
      // Park every `img.src = <a slow-thumb file>` until released (the load starts when the assignment lands).
      await window.evaluate(() => {
        const w = window as unknown as { __parked: Array<() => void>; __holdSlow: boolean }
        w.__parked = []
        w.__holdSlow = true
        const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
        if (!desc || !desc.set || !desc.get) throw new Error('no src accessor')
        const { get, set } = desc
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          configurable: true,
          enumerable: true,
          get() {
            return get.call(this)
          },
          set(value: string) {
            if (w.__holdSlow && String(value).includes('slow-thumb')) w.__parked.push(() => set.call(this, value))
            else set.call(this, value)
          }
        })
      })
      const parked = (): Promise<number> => window.evaluate(() => (window as unknown as { __parked: unknown[] }).__parked.length)
      const release = (): Promise<void> =>
        window.evaluate(() => {
          const w = window as unknown as { __parked: Array<() => void>; __holdSlow: boolean }
          w.__holdSlow = false
          for (const go of w.__parked.splice(0)) go()
        })

      // ── away: press → Canvas, go Home while the picture is loading, then let it arrive ──
      await toCanvas.focus()
      await window.keyboard.press('Enter')
      await expect.poll(parked, { timeout: 10_000 }).toBe(1)
      await window.locator('a[href="/home"], a[href="#/home"]').first().click({ force: true })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      expect(window.url()).toContain('#/home')
      await release()
      await expect.poll(() => readToastLog(window), { timeout: 15_000 }).toContain(ADDED)
      await window.waitForTimeout(700)
      expect(window.url(), 'the person was not taken to Stream Graphics from the screen they went to').toContain('#/home')
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toHaveCount(0)
      // The add itself happened: the canvas holds the reference layer.
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByRole('heading', { name: 'Layers (1)' })).toBeVisible()

      // ── control: a person who waits on References gets the canvas, as before ──
      await window.locator('a[href="/home"], a[href="#/home"]').first().click({ force: true })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.locator('a', { hasText: 'References' }).first().click()
      await expect(window.locator('h1', { hasText: 'References' })).toBeVisible({ timeout: 15_000 })
      await moodBoardTab(window).click()
      await window.evaluate(() => {
        ;(window as unknown as { __holdSlow: boolean }).__holdSlow = true
      })
      await toCanvas.focus()
      await window.keyboard.press('Enter')
      await expect.poll(parked, { timeout: 10_000 }).toBe(1)
      await expect(window.locator('h1', { hasText: 'References' }), 'still here while the picture loads').toBeVisible()
      await release()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 15_000 })
      expect(window.url()).toContain('#/image')
      await expect(window.getByRole('heading', { name: 'Layers (2)' })).toBeVisible()
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  // T-135 (8): a board's name is capped at 200 in main (it THROWS past that), and neither name box had a cap; create / rename / delete had no catch, and the
  // first-save flow closed its dialog BEFORE the create landed, so a refused first save dropped the picture being saved without a word. The boxes take
  // at most 200 characters now; a write main still refuses (the test puts a 201-character name past the cap with `fill`, which a person cannot do by typing
  // or pasting) is reported in a sentence, and the dialog keeps what the person typed and the picture they were saving until the write has landed.
  const LONG_BOARD_NAME = 'B'.repeat(201)
  // `fill` goes through the browser's text insertion, which honors `maxlength`; assigning `.value` (as a script, a drop or an autofill does) does not.
  // The box's cap stops a person typing or pasting past it; this is the name that gets past it anyway.
  const setValuePastCap = (field: Locator, value: string): Promise<void> =>
    field.evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!set) throw new Error('no value setter')
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)

  test('the board-name boxes take at most 200 characters (T-135 (8))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-name-cap')
    writeFileSync(
      path.join(fx.boardsDir, 'capboard.json'),
      JSON.stringify({ id: 'capboard', name: 'Cap board', createdAt: 1700000000000, items: [] }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      const create = window.getByPlaceholder('New board name…')
      await expect(create).toHaveAttribute('maxlength', '200')
      await create.pressSequentially('c'.repeat(205))
      await expect(create, 'typing stops at the cap').toHaveValue('c'.repeat(200))
      await window.getByRole('button', { name: 'Rename', exact: true }).click()
      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')
      await expect(field).toHaveAttribute('maxlength', '200')
      await field.press('Control+a')
      await field.pressSequentially('r'.repeat(205))
      await expect(field, 'the rename box stops at the cap too').toHaveValue('r'.repeat(200))
      await window.keyboard.press('Escape')
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('a refused first save says so, keeps the dialog with the name that was typed and the picture being saved, and the retry saves it (T-135 (8))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-firstsave-refused')
    const png = Buffer.from(PNG_8x6, 'base64')
    const thumbServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      res.end(png)
    })
    await new Promise<void>((resolve) => thumbServer.listen(0, '127.0.0.1', resolve))
    const thumbUrl = `http://127.0.0.1:${(thumbServer.address() as net.AddressInfo).port}/thumb.png`
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      await stubOneSearchResult(app, thumbUrl)
      await openReferences(window)
      await installToastLog(window)
      const input = window.getByPlaceholder(searchPlaceholder, { exact: false })
      await input.fill('minimalist mountain photography')
      await input.press('Enter')
      const save = window.getByRole('button', { name: 'Save', exact: false })
      await expect(save).toHaveCount(1)
      await save.click()
      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')
      await expect(field).toHaveAttribute('maxlength', '200')

      // main refuses a name past 200: the person cannot type one, so the test sets it.
      await setValuePastCap(field, LONG_BOARD_NAME)
      await expect(field).toHaveValue(LONG_BOARD_NAME)
      await dialog.getByRole('button', { name: 'Create & save' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 15_000 }).toContain("Couldn't create that board.")
      await expect(dialog, 'the dialog is still there').toBeVisible()
      await expect(field, 'with the name that was typed').toHaveValue(LONG_BOARD_NAME)
      expect(readBoardsFromDisk(fx.boardsDir), 'no board was made').toHaveLength(0)
      expect((await readToastLog(window)).some((t) => t.includes('Saved to')), 'and no success was claimed').toBe(false)

      // The retry, with a name main takes, saves the SAME picture the first press was holding.
      await field.fill('Inspiration')
      await field.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => readToastLog(window)).toContain('Saved to "Inspiration"')
      await expect.poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Inspiration'])
      expect(readBoardsFromDisk(fx.boardsDir)[0]?.items.map((i) => i.title)).toEqual(['Stubbed reference'])
      expect(pageErrors, 'no unhandled rejection reached the page').toEqual([])
    } finally {
      thumbServer.close()
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('a refused Create and a refused Rename are reported, and keep what was typed (T-135 (8))', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-name-refused')
    writeFileSync(
      path.join(fx.boardsDir, 'keepboard.json'),
      JSON.stringify({ id: 'keepboard', name: 'Keep me', createdAt: 1700000000000, items: [] }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()

      // ── Create (the + beside the box) ──
      const create = window.getByPlaceholder('New board name…')
      await setValuePastCap(create, LONG_BOARD_NAME)
      await expect(create).toHaveValue(LONG_BOARD_NAME)
      await window.getByRole('button', { name: 'Create board' }).click()
      await expect.poll(() => readToastLog(window), { timeout: 15_000 }).toContain("Couldn't create that board.")
      await expect(create, 'the box keeps the name for the retry').toHaveValue(LONG_BOARD_NAME)
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await create.fill('Second board')
      await window.getByRole('button', { name: 'Create board' }).click()
      await expect(window.getByRole('heading', { name: 'Boards (2)' })).toBeVisible({ timeout: 15_000 })
      await expect(create, 'a board that was made empties the box').toHaveValue('')

      // ── Rename ──
      await window.getByRole('button', { name: /^Keep me/ }).click()
      await window.getByRole('button', { name: 'Rename', exact: true }).click()
      const dialog = window.getByRole('dialog')
      const field = dialog.getByRole('textbox')
      await setValuePastCap(field, LONG_BOARD_NAME)
      await expect(field).toHaveValue(LONG_BOARD_NAME)
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect.poll(() => readToastLog(window), { timeout: 15_000 }).toContain("Couldn't rename that board.")
      await expect(dialog, 'the rename dialog is still there').toBeVisible()
      await expect(field, 'with the name that was typed').toHaveValue(LONG_BOARD_NAME)
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name).sort(), 'nothing was renamed on disk').toEqual(['Keep me', 'Second board'])
      await field.fill('Kept and renamed')
      await field.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => readBoardsFromDisk(fx.boardsDir).map((b) => b.name).sort()).toEqual(['Kept and renamed', 'Second board'])
      expect(pageErrors, 'no unhandled rejection reached the page').toEqual([])
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  /**
   * Reference Search's failure path, with the network removed by the test
   * itself rather than assumed absent.
   *
   * Electron is launched behind `--proxy-server` pointing at a socket this
   * test owns. Phase 1 keeps the CONNECT hanging, which holds the panel in
   * its in-flight state long enough to assert it. Phase 2 closes the proxy
   * entirely, so the next attempt fails immediately and deterministically —
   * on any machine, online or not.
   *
   * The happy path (real DuckDuckGo results, result Save, remote thumbs) is
   * HL-network and stays dispositioned; duckduckgo.test.ts covers the
   * parser on fixtures instead.
   */
  test('Reference Search surfaces the friendly notice when the network is unreachable', async () => {
    test.setTimeout(120_000)
    if (!existsSync(SCREENSHOTS)) mkdirSync(SCREENSHOTS, { recursive: true })
    const fx = makeFixture('refs-search')

    const sockets: net.Socket[] = []
    const proxy = net.createServer((s) => sockets.push(s))
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = (proxy.address() as net.AddressInfo).port
    let proxyClosed = false
    const killProxy = (): void => {
      if (proxyClosed) return
      proxyClosed = true
      for (const s of sockets) s.destroy()
      proxy.close()
    }

    const app = await launchApp(fx.userDataDir, [`--proxy-server=127.0.0.1:${port}`])
    try {
      const window = await app.firstWindow()
      await openReferences(window)

      const input = window.getByPlaceholder(searchPlaceholder, { exact: false })
      // The search button is the only button in the card that holds the input.
      const searchButton = window.locator('.card', { has: input }).getByRole('button')
      // T-30: the danger card renders `searchError` — a REJECTED invoke, i.e.
      // Electron's raw "Error invoking remote method …" preamble. The warn
      // card renders a `notice` carried on a normal response. A search that
      // could not run must land on the warn one whichever hop died.
      // (T-71 renamed both borders off the raw rose/amber palette classes;
      // the values on screen are unchanged.)
      const errorCard = window.locator('.border-danger-strong\\/40')
      const noticeCard = window.locator('.border-ember\\/40')

      await expect(searchButton).toHaveText('Search')
      await expect(searchButton).toBeEnabled()

      // An empty query never leaves the renderer (ReferencePanel.submit).
      await searchButton.click()
      await expect(errorCard).toHaveCount(0)
      await expect(noticeCard).toHaveCount(0)
      await expect(window.getByText('No results.')).toHaveCount(0)

      // ── phase 1: in-flight wiring, held open by the hanging proxy ──
      // Submitted with Enter — the input's own keydown branch, a separate
      // ledger row from the button (which phase 3 drives).
      await input.fill('minimalist mountain photography')
      await input.press('Enter')
      await expect(searchButton).toHaveText('Searching…')
      await expect(searchButton).toBeDisabled()
      // The query stays in the box while the request is out.
      await expect(input).toHaveValue('minimalist mountain photography')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-04-search-inflight.png') })

      // ── phase 2: the proxy dies; the panel lands on the notice card ──
      killProxy()
      await expect(searchButton).toHaveText('Search', { timeout: 60_000 })
      await expect(searchButton).toBeEnabled()
      await expect(noticeCard).toBeVisible()

      // T-30: this outage kills the FIRST hop (the vqd page), which used to
      // reject the invoke and print Electron's channel-naming preamble —
      // "Error invoking remote method 'search:images': Error: net::ERR_…" —
      // while the identical outage one request later produced this sentence.
      // Chromium supplies the net:: code, and which code depends on whether
      // the socket died mid-CONNECT or the port was already refusing, so the
      // code alone is matched by shape.
      //
      // T-84: and it is one plain sentence — what happened, what to do, and
      // the reassurance that matters offline. Chromium's net:: code is for
      // the console; the card used to print it ("DuckDuckGo search failed:
      // net::ERR_PROXY_CONNECTION_FAILED"), and the other hop's copy told
      // the user to "switch provider", which no screen offers.
      const UNREACHABLE =
        "Couldn't reach DuckDuckGo. Check your internet connection and try again. " +
        'Your saved boards still work offline.'
      const text = (await noticeCard.innerText()).trim()
      expect(text).toBe(UNREACHABLE)
      expect(text).not.toMatch(/net::|DuckDuckGo search failed|provider/)
      // …and nothing rejected, so the raw-IPC card never appears.
      await expect(errorCard).toHaveCount(0)
      // T-66: the notice IS the answer. "No results." underneath it said the
      // search ran and found nothing — the opposite of what happened, and
      // since T-30 routed the first hop here too this is the common failure
      // view, not a corner of one.
      await expect(window.getByText('No results.')).toHaveCount(0)
      // No grid: a failed search returns no results to draw.
      await expect(window.locator('img[referrerpolicy="no-referrer"]')).toHaveCount(0)
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-05-search-error.png') })

      // ── phase 3: the button re-runs it against the now-refusing proxy —
      // reproducing the failure rather than wedging the panel, and the card
      // is replaced rather than stacked.
      await searchButton.click()
      await expect(searchButton).toHaveText('Search', { timeout: 60_000 })
      await expect(noticeCard).toHaveCount(1)
      await expect(errorCard).toHaveCount(0)
      expect((await noticeCard.innerText()).trim()).toBe(UNREACHABLE)
      // Still one message, not two (T-66) — a re-run lands on the same view.
      await expect(window.getByText('No results.')).toHaveCount(0)

      // ── phase 4: the search RAN and found nothing — the one state that
      // does print "No results." (T-66) ──
      // Without this the notice assertions above would pass just as happily
      // against a panel that had lost the copy altogether.
      await stubEmptySearchResults(app)
      await input.fill('a query nothing matches')
      await input.press('Enter')
      await expect(window.getByText('No results.')).toBeVisible()
      await expect(noticeCard).toHaveCount(0)
      await expect(errorCard).toHaveCount(0)
    } finally {
      killProxy()
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })
})

// T-136 (12): T-135 (8) gave the board create / rename / delete / save a catch. Two writes beside them had none: "Clear thumbnail cache" awaited its IPC call
// bare (a refusal was an unhandled rejection and the button did nothing, visibly), and the tile's ✕ called the store's `removeFromCollection` with nothing
// awaiting it at all. A refused write says so, in a sentence, and the tile stays where it is. Main's refusals cannot be produced from the UI (the clear
// removes a folder the app owns; the remove takes an id the app minted), so the handlers are replaced in main by ones that throw, as the autosave
// Clear's refusal case does.
test.describe('T-136 (12): the mood board\'s cache clear and tile remove report a refusal', () => {
  test('a refused Clear thumbnail cache never says "cleared", and a refused ✕ says so and leaves the tile', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-t136-refused')
    const owned = ['a.jpg', 'b.jpg']
    owned.forEach((name) => writeFileSync(path.join(fx.thumbsDir, name), Buffer.alloc(1024)))
    writeFileSync(path.join(fx.boardsDir, 'refusedboard.json'), JSON.stringify(boardOwning('refusedboard', 'Refused board', fx.thumbsDir, owned)), 'utf8')
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      const pageErrors: string[] = []
      window.on('pageerror', (e) => pageErrors.push(e.message))
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()
      await expect(window.locator('h3.text-lg')).toHaveText('Refused board')
      const boardItems = (): string[] => readBoardsFromDisk(fx.boardsDir).flatMap((b) => b.items.map((i) => i.id))
      expect(boardItems()).toEqual(['refusedboarditem0', 'refusedboarditem1'])

      // ── control: the same ✕ with a working main removes the tile ──
      await window.getByRole('button', { name: 'Remove item' }).first().click()
      await expect(window.locator('img[alt="Cached a.jpg"]')).toHaveCount(0)
      await expect.poll(boardItems).toEqual(['refusedboarditem1'])

      // ── main refuses both writes ──
      await app.evaluate(({ ipcMain }) => {
        for (const channel of ['moodboard:clearThumbs', 'moodboard:removeItem']) {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, () => {
            throw new Error('the write was refused by the test')
          })
        }
      })

      await window.getByRole('button', { name: 'Clear thumbnail cache' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 15_000, intervals: [200] })
        .toContain("Couldn't clear the thumbnail cache.")
      expect((await readToastLog(window)).some((t) => t.includes('Thumbnail cache cleared')), 'a refusal is never reported as a success').toBe(false)
      expect(readdirSync(fx.thumbsDir).sort(), 'and the cache is as it was').toEqual(owned)

      await window.getByRole('button', { name: 'Remove item' }).click()
      await expect
        .poll(async () => (await readToastLog(window)).join(' | '), { timeout: 15_000, intervals: [200] })
        .toContain("Couldn't remove that picture.")
      await expect(window.locator('img[alt="Cached b.jpg"]'), 'the tile is still on the board').toBeVisible()
      await expect(window.getByText('Empty. Switch to Reference Search and click Save to add inspiration here.')).toHaveCount(0)
      expect(boardItems(), 'the board file is as it was').toEqual(['refusedboarditem1'])
      // The raw cause goes to the console, never to the person.
      expect((await readToastLog(window)).join(' | ')).not.toMatch(/refused by the test|Error invoking/)
      expect(pageErrors, 'no unhandled rejection reached the page').toEqual([])
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })
})

// T-137 (10): "→ Canvas" set the layer's `src` to the address of the tile's cached thumbnail (an imagii-file: URL). Clear thumbnail cache, and the launch sweep
// after a board item is deleted, remove that file; the tile falls back to the URL it came from, but a layer has no fallback: it drew nothing (no shape, no marker)
// and saved projects carried the dead address. The layer now carries the picture itself, a copy drawn at the size the layer is drawn. The decoded node is what
// the canvas shows, read from the Konva stage the Stream Graphics studio publishes.
test.describe('References - → Canvas embeds the picture (T-137 (10))', () => {
  /** The pictures on the canvas, as the stage draws them: the src each node decoded, and its decoded size. */
  function drawnPictures(window: Page): Promise<Array<{ prefix: string; naturalWidth: number; naturalHeight: number; cornerAlpha: number }>> {
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
            prefix: img.src.slice(0, img.src.indexOf(';') > 0 && img.src.indexOf(';') < 30 ? img.src.indexOf(';') : 12),
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            cornerAlpha: ctx?.getImageData(2, 2, 1, 1).data[3] ?? -1
          }
        })
    })
  }

  test('a reference sent to the canvas still draws after Clear thumbnail cache and a fresh visit to the canvas', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('t137-embed')
    const thumbPath = path.join(fx.thumbsDir, 'embed-thumb.png')
    writeFileSync(thumbPath, Buffer.from(PNG_8x6, 'base64'))
    writeFileSync(
      path.join(fx.boardsDir, 'embedboard.json'),
      JSON.stringify({
        id: 'embedboard',
        name: 'Embed board',
        createdAt: 1700000000000,
        items: [
          {
            id: 'embeditem',
            collectionId: 'embedboard',
            thumbnail: 'https://example.invalid/embed-thumb.png',
            fullUrl: 'https://example.invalid/full.png',
            source: 'example.invalid',
            title: 'Embedded reference',
            cachedThumbPath: thumbPath,
            addedAt: 1700000000000
          }
        ]
      }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      // The tile is the cached file, decoded from disk (the control: the picture IS there when it is sent).
      await expect
        .poll(() => window.locator('img[alt="Embedded reference"]').evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
        .toBe(8)

      // ── send it: the canvas draws it from a copy it carries, not from the cache file ──
      await window.getByRole('button', { name: /Canvas/ }).focus()
      await window.keyboard.press('Enter')
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 30_000 })
      await expect(window.getByRole('heading', { name: 'Layers (1)' })).toBeVisible()
      await expect.poll(async () => (await drawnPictures(window)).length, { timeout: 15_000 }).toBe(1)
      const [sent] = await drawnPictures(window)
      expect.soft(sent?.prefix, 'the layer carries the picture, not the address of the cache file').toMatch(/^data:image\//)
      expect.soft(sent?.prefix, 'an opaque thumbnail is kept as a JPEG: a tenth of the PNG\'s bytes').toBe('data:image/jpeg')
      expect(sent?.naturalWidth).toBe(8)
      expect(sent?.naturalHeight).toBe(6)

      // ── the cache is cleared (the file is gone) ──
      await backToReferences(window)
      await moodBoardTab(window).click()
      await window.getByRole('button', { name: 'Clear thumbnail cache' }).click()
      await expect.poll(() => readToastLog(window)).toContain('Thumbnail cache cleared')
      await expect.poll(() => readdirSync(fx.thumbsDir), { timeout: 30_000 }).toEqual([])

      // ── the canvas, mounted fresh, still draws the reference ──
      await window.locator('a[href="/home"], a[href="#/home"]').first().click({ force: true })
      await expect(window.locator('h1', { hasText: 'imagii' })).toBeVisible({ timeout: 15_000 })
      await window.locator('a', { hasText: 'Stream Graphics' }).first().click()
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByRole('heading', { name: 'Layers (1)' })).toBeVisible()
      await expect
        .poll(async () => (await drawnPictures(window)).length, { timeout: 15_000, message: 'the reference layer draws after the cache it came from is gone' })
        .toBe(1)
      expect((await drawnPictures(window))[0]?.naturalWidth).toBe(8)
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })

  test('a transparent reference keeps its transparency: a PNG copy, not a JPEG that paints it black', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('t137-embed-alpha')
    const thumbPath = path.join(fx.thumbsDir, 'ghost-thumb.png')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=0xFF0000@0.5:size=16x12:rate=1,format=rgba', '-frames:v', '1', thumbPath])
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`fixture ffmpeg exit ${code}`))))
    })
    writeFileSync(
      path.join(fx.boardsDir, 'ghostboard.json'),
      JSON.stringify({
        id: 'ghostboard',
        name: 'Ghost board',
        createdAt: 1700000000000,
        items: [
          {
            id: 'ghostitem',
            collectionId: 'ghostboard',
            thumbnail: 'https://example.invalid/ghost-thumb.png',
            fullUrl: 'https://example.invalid/full.png',
            source: 'example.invalid',
            title: 'Ghost reference',
            cachedThumbPath: thumbPath,
            addedAt: 1700000000000
          }
        ]
      }),
      'utf8'
    )
    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await moodBoardTab(window).click()
      await expect(window.getByRole('heading', { name: 'Boards (1)' })).toBeVisible()
      await window.getByRole('button', { name: /Canvas/ }).focus()
      await window.keyboard.press('Enter')
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => (await drawnPictures(window)).length, { timeout: 15_000 }).toBe(1)
      const [ghost] = await drawnPictures(window)
      expect(ghost?.prefix).toBe('data:image/png')
      expect(ghost?.cornerAlpha, 'half transparent, as it was').toBeGreaterThan(100)
      expect(ghost?.cornerAlpha).toBeLessThan(155)
    } finally {
      await app.close()
      rmSync(fx.root, { recursive: true, force: true })
    }
  })
})
