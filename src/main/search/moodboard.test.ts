import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MoodBoardCollection, SearchResult } from '../../shared/search'

// Round 18: cover the per-collection write lock. Two concurrent
// addToCollection calls used to read the same pre-write JSON and the second
// write clobbered the first — one saved item silently vanished.
let TMP = ''
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP
  },
  net: {
    // cacheThumb must fail gracefully in tests — no network.
    fetch: async () => {
      throw new Error('no network in tests')
    }
  }
}))

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-moodboard-'))
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

function makeResult(n: number): SearchResult {
  return {
    id: `result-${n}`,
    title: `Result ${n}`,
    thumbnail: `https://example.invalid/thumb-${n}.jpg`,
    fullUrl: `https://example.invalid/full-${n}.jpg`,
    source: 'example.invalid',
    width: 100,
    height: 100
  }
}

describe('moodboard concurrent mutation safety (round 18)', () => {
  it('two concurrent saves both land in the collection', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Board')
    const [a, b] = await Promise.all([
      m.addToCollection(board.id, makeResult(1)),
      m.addToCollection(board.id, makeResult(2))
    ])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(2)
  })

  it('a burst of concurrent saves loses nothing', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Burst')
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => m.addToCollection(board.id, makeResult(i)))
    )
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(8)
  })

  it('concurrent add + remove serialize without dropping the surviving item', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Mixed')
    const withOne = await m.addToCollection(board.id, makeResult(1))
    const firstId = withOne?.items[0]?.id
    expect(firstId).toBeTruthy()
    await Promise.all([
      m.addToCollection(board.id, makeResult(2)),
      m.removeFromCollection(board.id, firstId as string)
    ])
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(1)
    expect(saved?.items[0]?.fullUrl).toBe(makeResult(2).fullUrl)
  })
})

// ── T-58: the disk half of the references undo history ───────────────────

const boardsDir = (): string => path.join(TMP, 'moodboards')
const thumbsDir = (): string => path.join(TMP, 'cache', 'thumbs')

function seedThumb(name: string): string {
  mkdirSync(thumbsDir(), { recursive: true })
  const file = path.join(thumbsDir(), name)
  writeFileSync(file, 'jpeg-bytes')
  return file
}

function seedBoard(collection: MoodBoardCollection): void {
  mkdirSync(boardsDir(), { recursive: true })
  writeFileSync(
    path.join(boardsDir(), `${collection.id}.json`),
    JSON.stringify(collection, null, 2),
    'utf8'
  )
}

function boardOnDisk(id: string): MoodBoardCollection | null {
  const file = path.join(boardsDir(), `${id}.json`)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as MoodBoardCollection
}

function withThumb(id: string, name: string, thumbPath: string): MoodBoardCollection {
  return {
    id,
    name,
    createdAt: 1700000000000,
    items: [
      {
        id: `${id}item`,
        collectionId: id,
        thumbnail: 'https://example.invalid/thumb.jpg',
        fullUrl: 'https://example.invalid/full.jpg',
        source: 'example.invalid',
        title: 'Seeded reference',
        cachedThumbPath: thumbPath,
        addedAt: 1700000000000
      }
    ]
  }
}

describe('restoreCollections — the single inverse the undo history steps through', () => {
  it('re-creates a deleted board with its id, items and createdAt intact', async () => {
    const m = await import('./moodboard')
    const thumb = seedThumb('restored.jpg')
    const original = withThumb('keepers', 'Keepers', thumb)
    seedBoard(original)

    const before = await m.listCollections()
    await m.deleteCollection('keepers')
    expect(await m.listCollections()).toEqual([])

    await m.restoreCollections(before)

    // Not "a board that looks similar" — the same board.
    expect(await m.listCollections()).toEqual(before)
    expect(boardOnDisk('keepers')).toEqual(original)
  })

  it('deletes every board the snapshot does not contain', async () => {
    const m = await import('./moodboard')
    const keep = await m.createCollection('Keep')
    await m.createCollection('Drop')

    await m.restoreCollections([keep])

    expect((await m.listCollections()).map((c) => c.name)).toEqual(['Keep'])
    expect(existsSync(path.join(boardsDir(), `${keep.id}.json`))).toBe(true)
  })

  it('normalizes what it writes the same way the reader would accept it', async () => {
    const m = await import('./moodboard')
    const good = withThumb('normalize', 'Normalize', path.join(thumbsDir(), 'ok.jpg'))
    await m.restoreCollections([
      {
        ...good,
        items: [
          ...good.items,
          // Malformed: no id. Dropped rather than written.
          { collectionId: 'normalize' } as unknown as MoodBoardCollection['items'][number],
          // A thumbnail path outside the cache dir: kept as an item, but the
          // path is unset so the protocol handler is never asked to serve it.
          {
            ...good.items[0]!,
            id: 'escaped',
            cachedThumbPath: path.join(TMP, 'not-the-cache', 'secret.jpg')
          }
        ]
      }
    ])

    const written = boardOnDisk('normalize')
    expect(written?.items.map((i) => i.id)).toEqual(['normalizeitem', 'escaped'])
    expect(written?.items[0]?.cachedThumbPath).toBe(path.join(thumbsDir(), 'ok.jpg'))
    expect(written?.items[1]?.cachedThumbPath).toBeUndefined()
  })
})

describe('destructive edits leave the thumbnail cache alone (T-58)', () => {
  it('deleting a board keeps its cached thumbs, so an undo can restore it whole', async () => {
    const m = await import('./moodboard')
    const thumb = seedThumb('board-thumb.jpg')
    seedBoard(withThumb('deleteme', 'Delete me', thumb))

    await m.deleteCollection('deleteme')

    expect(existsSync(path.join(boardsDir(), 'deleteme.json'))).toBe(false)
    // The picture survives the record that pointed at it — that is what makes
    // the undo an undo rather than a board of grey squares.
    expect(existsSync(thumb)).toBe(true)
  })

  it('removing an item keeps its cached thumb for the same reason', async () => {
    const m = await import('./moodboard')
    const thumb = seedThumb('item-thumb.jpg')
    seedBoard(withThumb('board', 'Board', thumb))

    await m.removeFromCollection('board', 'boarditem')

    expect(boardOnDisk('board')?.items).toEqual([])
    expect(existsSync(thumb)).toBe(true)
  })
})

describe('sweepOrphanThumbs — the reap moved to a point undo cannot reach', () => {
  it('removes thumbs no board refers to and keeps the ones in use', async () => {
    const m = await import('./moodboard')
    const used = seedThumb('in-use.jpg')
    const orphan = seedThumb('orphan.jpg')
    seedBoard(withThumb('live', 'Live board', used))

    const removed = await m.sweepOrphanThumbs()

    expect(removed).toBe(1)
    expect(existsSync(used)).toBe(true)
    expect(existsSync(orphan)).toBe(false)
  })

  it('reclaims what a board delete deferred', async () => {
    const m = await import('./moodboard')
    const thumb = seedThumb('deferred.jpg')
    seedBoard(withThumb('gone', 'Gone', thumb))

    await m.deleteCollection('gone')
    expect(existsSync(thumb)).toBe(true)

    await m.sweepOrphanThumbs()
    expect(existsSync(thumb)).toBe(false)
  })

  it('refuses to sweep at all when a board file cannot be read', async () => {
    const m = await import('./moodboard')
    const used = seedThumb('still-referenced.jpg')
    const unknown = seedThumb('unknown.jpg')
    seedBoard(withThumb('ok', 'Fine', used))
    mkdirSync(boardsDir(), { recursive: true })
    writeFileSync(path.join(boardsDir(), 'corrupt.json'), '{ "id": "corrupt",', 'utf8')

    const removed = await m.sweepOrphanThumbs()

    // One unreadable board could own any of these; deleting on a partial
    // picture is how a corrupt file costs a user their whole cache.
    expect(removed).toBe(0)
    expect(existsSync(used)).toBe(true)
    expect(existsSync(unknown)).toBe(true)
  })

  it('does nothing when there is no cache directory yet', async () => {
    const m = await import('./moodboard')
    expect(await m.sweepOrphanThumbs()).toBe(0)
  })
})
