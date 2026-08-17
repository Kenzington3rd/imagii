import {
  test,
  expect,
  _electron as electron,
  type Dialog,
  type ElectronApplication,
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
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { pathToImagiiFileUrl } from '../../src/shared/fileUrl'
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
 * Two of these tests pin DEFECTS rather than correct behavior. They are
 * named `defect:` and each carries a comment saying what the app should
 * do instead; the ticket that fixes one also rewrites its assertions.
 * Pinning beats leaving the surface untested — a silent regression in a
 * broken control is still a regression.
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
const DELETED_TOAST = 'Deleted — press Ctrl+Z to undo.'
const boardsHeading = /^Boards \(\d+\)$/

function moodBoardTab(window: Page) {
  return window.getByRole('button', { name: 'Mood Boards', exact: true })
}

function layerRows(window: Page) {
  return window.locator('[data-tutorial="image-layers"] li')
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

      // Default tab: Reference Search.
      await expect(searchInput).toBeVisible()
      await expect(window.getByText(/Powered by DuckDuckGo image search/)).toBeVisible()
      await expect(boardsPanel).toHaveCount(0)
      await expect(assetsPanel).toHaveCount(0)

      // -> Mood Boards.
      await moodBoardTab(window).click()
      await expect(boardsPanel).toBeVisible()
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
        'References tutorial — step 1 of 4: Welcome'
      )
      await coachmark.getByRole('button', { name: 'Next' }).click()
      await expect(coachmark).toHaveAttribute(
        'aria-label',
        'References tutorial — step 2 of 4: The two tabs'
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
      const addButton = window.getByRole('button', { name: '+', exact: true })
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
      await expect.poll(() => dialogs).toEqual(['confirm: Delete "Alpha board" and all 0 item(s)?'])
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
      await expect.poll(() => dialogs).toEqual(['confirm: Delete "Alpha board" and all 0 item(s)?'])
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

      const undo = window.getByRole('button', { name: 'Undo' })
      const redo = window.getByRole('button', { name: 'Redo' })
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
        .toEqual(['confirm: Delete "Undo board" and all 1 item(s)?'])
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
   * DEFECT PIN — Rename is dead in Electron.
   *
   * MoodBoardPanel.onRename calls `prompt()`, which Electron does not
   * implement: the renderer throws "prompt() is and will not be
   * supported." and the rename never runs. No dialog reaches Playwright
   * (so no dialog handler can rescue it), no toast, no error surfaced to
   * the user, and the board keeps its old name on disk. The identical
   * pattern in ReferencePanel.ensureCollection ("Name your first mood
   * board:") is broken the same way.
   *
   * What the app SHOULD do: replace the `prompt()` with the in-app Modal
   * component (an inline name input, like the create-board field right
   * next to it). When that lands, this test flips to asserting the new
   * name in the UI and in the board JSON.
   */
  test('defect: Rename throws instead of renaming (Electron has no prompt())', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-rename')
    writeFileSync(
      path.join(fx.boardsDir, 'renameboard.json'),
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
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()
      await expect(window.locator('h3.text-lg')).toHaveText('Original name')

      // A handler that WOULD rename, registered before the click. It never
      // fires, which is half the finding.
      const dialogs: string[] = []
      const renamer = (d: Dialog): void => {
        dialogs.push(`${d.type()}: ${d.message()}`)
        void d.accept('Renamed board')
      }
      window.once('dialog', renamer)
      await window.getByRole('button', { name: 'Rename', exact: true }).click()

      await expect
        .poll(() => pageErrors, { timeout: 15_000 })
        .toContain('prompt() is and will not be supported.')
      expect(dialogs).toEqual([])
      await expect(window.locator('h3.text-lg')).toHaveText('Original name')
      await expect(window.locator('li', { hasText: 'Original name' })).toHaveCount(1)
      await expect(window.locator('li', { hasText: 'Renamed board' })).toHaveCount(0)
      expect(readBoardsFromDisk(fx.boardsDir).map((b) => b.name)).toEqual(['Original name'])
      // And the user is told nothing at all — no toast, success or error.
      expect(await readToastLog(window)).toEqual([])
      window.off('dialog', renamer)
    } finally {
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
      await window.getByRole('button', { name: /Canvas/ }).click()
      await expect.poll(() => readToastLog(window)).toContain('Added to canvas as overlay')
      await expect(window.locator('h1', { hasText: 'Stream Graphics' })).toBeVisible({
        timeout: 15_000
      })
      expect(window.url()).toContain('#/image')

      // canvasStore gained exactly one image layer, named from the item
      // title, and PropertiesPanel shows it selected at 40% opacity.
      await expect(window.getByRole('heading', { name: 'Layers (1)' })).toBeVisible()
      await expect(layerRows(window)).toHaveText(['Seeded reference'])
      const opacity = window.locator('input[aria-label="Layer opacity"]')
      await expect(opacity).toHaveValue('0.4')
      await expect(opacity).toHaveAttribute('aria-valuetext', '40 percent')
      await window.screenshot({ path: path.join(SCREENSHOTS, 'refs-02-canvas-overlay.png') })

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
   * DEFECT PIN — "Clear thumbnail cache" does not clear the cache.
   *
   * The button is wired to `moodboard:prune`, whose handler calls
   * `pruneThumbCache()` with its DEFAULT 500 MB budget — an LRU trim, not
   * a clear. For every user whose cache is under 500 MB (i.e. essentially
   * every user) the button deletes nothing while the toast claims
   * "Thumbnail cache cleared".
   *
   * This test pins both halves so the fix can't be mistaken for a no-op:
   * under the cap nothing is deleted, over the cap the oldest files go
   * until the total fits. The over-cap files are sparse (ftruncate writes
   * no blocks) so the case costs bytes of real disk, not gigabytes.
   *
   * What the app SHOULD do: the button needs a real "empty it" call —
   * `pruneThumbCache(0)` via a dedicated `moodboard:clearThumbs` channel,
   * leaving the 500 MB budget for the automatic path. When that lands,
   * this test's first phase flips to asserting an empty directory.
   */
  test('defect: Clear thumbnail cache only trims above the 500 MB budget', async () => {
    test.setTimeout(120_000)
    const fx = makeFixture('refs-prune')
    const MB = 1024 * 1024

    // Two ordinary small thumbs, oldest first, owned by a board — T-58's
    // startup sweep reclaims cached files no board refers to, so a fixture of
    // free-floating thumbs would be gone before the first click. Owned ones
    // are exactly what the LRU is meant to trim.
    const small = ['old-a.jpg', 'old-b.jpg']
    small.forEach((name, i) => {
      const file = path.join(fx.thumbsDir, name)
      writeFileSync(file, Buffer.alloc(1024))
      const t = 1_700_000_000 + i
      utimesSync(file, t, t)
    })
    writeFileSync(
      path.join(fx.boardsDir, 'pruneboard.json'),
      JSON.stringify({
        id: 'pruneboard',
        name: 'Prune board',
        createdAt: 1700000000000,
        items: small.map((name, i) => ({
          id: `pruneitem${i}`,
          collectionId: 'pruneboard',
          thumbnail: `https://example.invalid/${name}`,
          fullUrl: `https://example.invalid/full-${name}`,
          source: 'example.invalid',
          title: `Cached ${name}`,
          cachedThumbPath: path.join(fx.thumbsDir, name),
          addedAt: 1700000000000 + i
        }))
      }),
      'utf8'
    )

    const app = await launchApp(fx.userDataDir)
    try {
      const window = await app.firstWindow()
      await openReferences(window)
      await installToastLog(window)
      await moodBoardTab(window).click()

      const clearButton = window.getByRole('button', { name: 'Clear thumbnail cache' })

      // ── under the cap: the toast fires, the disk is untouched ──
      await clearButton.click()
      await expect.poll(() => readToastLog(window)).toContain('Thumbnail cache cleared')
      expect(readdirSync(fx.thumbsDir).sort()).toEqual(small)

      // ── over the cap: 600 MB of sparse files pushes past the budget ──
      const big = ['big-1.jpg', 'big-2.jpg']
      big.forEach((name, i) => {
        const file = path.join(fx.thumbsDir, name)
        const fd = openSync(file, 'w')
        ftruncateSync(fd, 300 * MB)
        closeSync(fd)
        const t = 1_700_000_100 + i
        utimesSync(file, t, t)
      })

      await clearButton.click()
      // Oldest-first until the total fits: both small files, then big-1
      // (600 MB -> 300 MB). big-2, the newest, survives.
      await expect.poll(() => readdirSync(fx.thumbsDir).sort(), { timeout: 30_000 }).toEqual([
        'big-2.jpg'
      ])
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
      // T-30: the rose card renders `searchError` — a REJECTED invoke, i.e.
      // Electron's raw "Error invoking remote method …" preamble. The amber
      // card renders a `notice` carried on a normal response. A search that
      // could not run must land on the amber one whichever hop died.
      const errorCard = window.locator('.border-rose-400\\/40')
      const noticeCard = window.locator('.border-amber-400\\/40')

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
      const text = (await noticeCard.innerText()).trim()
      expect(text).toMatch(/^DuckDuckGo search failed: net::ERR_[A-Z0-9_]+$/)
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
      expect((await noticeCard.innerText()).trim()).toBe(
        'DuckDuckGo search failed: net::ERR_PROXY_CONNECTION_FAILED'
      )
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
