import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
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

// T-139 (1): the failures a disk makes, injected into the real `node:fs/promises` (everything else in it stays real). Off unless a test turns one on.
const faults = vi.hoisted(() => ({
  /** A write to a path this accepts puts the first half of its bytes on disk, then fails with ENOSPC. */
  failWhen: null as ((file: string) => boolean) | null
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (file: string, data: string | Buffer, ...rest: unknown[]) => {
      if (faults.failWhen?.(String(file))) {
        const bytes = Buffer.from(data)
        await real.writeFile(file, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw Object.assign(new Error('ENOSPC: simulated, write'), { code: 'ENOSPC' })
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    }
  }
})

beforeEach(() => {
  faults.failWhen = null
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

// T-117 (2): the thumbnail gate is the third site that asked `rel.startsWith('..')`. A cached thumbnail
// whose own name starts with two dots is in the cache; one that is not in the cache is still dropped.
describe('the thumbnail confinement reads a real parent segment (T-117)', () => {
  it('keeps a ..-named thumbnail inside the cache and still unsets one outside it', async () => {
    const m = await import('./moodboard')
    const inCache = seedThumb('..cover.jpg')
    const subCache = path.join(thumbsDir(), '..old')
    mkdirSync(subCache, { recursive: true })
    const inSub = path.join(subCache, 'a.jpg')
    writeFileSync(inSub, 'jpeg-bytes')
    const outside = path.join(TMP, 'cache', 'thumbs-evil', 'secret.jpg')
    const board = withThumb('dots', 'Dots', inCache)
    board.items.push(
      { ...board.items[0]!, id: 'sub', cachedThumbPath: inSub },
      { ...board.items[0]!, id: 'outside', cachedThumbPath: outside },
      { ...board.items[0]!, id: 'parent', cachedThumbPath: path.join(TMP, 'cache', 'secret.jpg') }
    )
    seedBoard(board)

    const [read] = await m.listCollections()
    const thumbs = Object.fromEntries((read?.items ?? []).map((i) => [i.id, i.cachedThumbPath]))
    expect(thumbs.dotsitem, 'a name that starts with two dots is in the cache').toBe(inCache)
    expect(thumbs.sub, 'so is a folder that does').toBe(inSub)
    expect(thumbs.outside, 'a sibling that starts with the cache folder\'s name is not').toBeUndefined()
    expect(thumbs.parent, 'nor is a file one level up').toBeUndefined()
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
    // Backdated: the sweep deliberately skips files newer than its own
    // start so it can never eat a thumb being written mid-sweep, and on
    // Windows Date.now()'s ~15 ms quantization can put a JUST-written
    // file's mtime ahead of the sweep's start — the v1.5.0 release run
    // caught this test racing that guard. An old orphan is the semantic
    // under test anyway.
    const aMinuteAgo = new Date(Date.now() - 60_000)
    utimesSync(used, aMinuteAgo, aMinuteAgo)
    utimesSync(orphan, aMinuteAgo, aMinuteAgo)
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

/**
 * T-29 — the "Clear thumbnail cache" button (`moodboard:clearThumbs`) empties
 * the directory. It used to call the same function with a 500 MB budget, an
 * LRU trim, so under the cap it deleted nothing while the toast claimed the
 * cache was cleared.
 *
 * T-79 — and the budget is gone entirely. Its only automatic caller ran at
 * launch, behind `sweepOrphanThumbs`, where every file left is one a board
 * refers to: a size cap there can only delete pictures the user still wants.
 * What survives is the clear, and it deletes by ASKING, not by arithmetic.
 */
describe('clearThumbCache — the button empties it, whatever it holds (T-29, T-79)', () => {
  /** Seed `name` with `size` bytes and an mtime of `age` seconds ago. */
  function seedSized(name: string, size: number, ageSec: number): string {
    mkdirSync(thumbsDir(), { recursive: true })
    const file = path.join(thumbsDir(), name)
    writeFileSync(file, Buffer.alloc(size))
    const t = Math.floor(Date.now() / 1000) - ageSec
    utimesSync(file, t, t)
    return file
  }

  function cached(): string[] {
    return readdirSync(thumbsDir()).sort()
  }

  it('empties the directory, including a zero-byte file', async () => {
    const m = await import('./moodboard')
    seedSized('a.jpg', 1024, 30)
    seedSized('b.jpg', 2048, 20)
    // A zero-byte file fits under ANY budget, so it is the one file a clear
    // written as "trim to 0 bytes" would leave behind.
    seedSized('truncated.jpg', 0, 10)

    await m.clearThumbCache()

    expect(cached()).toEqual([])
  })

  it('takes a tiny cache too — there is no threshold left to be under', async () => {
    const m = await import('./moodboard')
    // 2 KB: a quarter of a million times under the budget the old wiring
    // measured the button by, and so the exact case that did nothing.
    seedSized('small-a.jpg', 1024, 30)
    seedSized('small-b.jpg', 1024, 20)

    await m.clearThumbCache()

    expect(cached()).toEqual([])
  })

  it('leaves the boards alone — it frees pictures, not references', async () => {
    const m = await import('./moodboard')
    const thumb = seedThumb('referenced.jpg')
    seedBoard(withThumb('keeper', 'Keeper', thumb))

    await m.clearThumbCache()

    expect(cached()).toEqual([])
    // The board file and its item survive with the path still on them: the
    // tile falls back to `item.thumbnail` and re-downloads (T-79).
    expect(boardOnDisk('keeper')?.items[0]?.cachedThumbPath).toBe(thumb)
  })

  it('does nothing when there is no cache directory yet', async () => {
    const m = await import('./moodboard')
    await expect(m.clearThumbCache()).resolves.toBeUndefined()
  })
})

/**
 * T-139 (1) - a board is the old board until the new one is whole.
 *
 * Every board write was `writeFile(board.json, ...)`, which truncates the file first. A write that failed part-way (a full drive) left a truncated
 * `<id>.json`, and `readCollection` returns null for a file that does not parse, so the board silently dropped out of the list with its items. The five
 * writes (create, rename, add, remove, and the undo history's restore) go through `writeFileAtomic` now; the failing write is injected into the real
 * `node:fs/promises` and the functions, the lock and the files are real.
 */
describe('a board write that fails leaves the board as it was (T-139 (1))', () => {
  const onDisk = (id: string): Buffer => readFileSync(path.join(boardsDir(), `${id}.json`))
  const inBoards = (file: string): boolean => path.dirname(file) === boardsDir()
  const justTheBoards = (...ids: string[]): string[] => ids.map((id) => `${id}.json`).sort()

  async function boardWithOneItem(): Promise<{ m: typeof import('./moodboard'); id: string; before: Buffer }> {
    const m = await import('./moodboard')
    const board = await m.createCollection('Keepers')
    const withOne = await m.addToCollection(board.id, makeResult(1))
    expect(withOne?.items).toHaveLength(1)
    return { m, id: board.id, before: onDisk(board.id) }
  }

  it('rename: the old board is byte-identical, still listed under its old name, and no tmp is left', async () => {
    const { m, id, before } = await boardWithOneItem()
    faults.failWhen = inBoards
    await expect(m.renameCollection(id, 'A much longer name than before '.repeat(20))).rejects.toThrow('ENOSPC')
    expect(onDisk(id).equals(before)).toBe(true)
    expect(readdirSync(boardsDir())).toEqual(justTheBoards(id))
    faults.failWhen = null
    const listed = await m.listCollections()
    expect(listed.map((c) => [c.name, c.items.length])).toEqual([['Keepers', 1]])
  })

  it('add: the item is not half-saved, the board keeps its first item, and a retry then lands both', async () => {
    const { m, id, before } = await boardWithOneItem()
    faults.failWhen = inBoards
    await expect(m.addToCollection(id, makeResult(2))).rejects.toThrow('ENOSPC')
    expect(onDisk(id).equals(before)).toBe(true)
    expect(readdirSync(boardsDir())).toEqual(justTheBoards(id))
    faults.failWhen = null
    const retried = await m.addToCollection(id, makeResult(2))
    expect(retried?.items.map((i) => i.fullUrl)).toEqual([makeResult(1).fullUrl, makeResult(2).fullUrl])
  })

  it('remove: the item stays, byte-identical board, no tmp', async () => {
    const { m, id, before } = await boardWithOneItem()
    const itemId = (await m.listCollections())[0]?.items[0]?.id as string
    faults.failWhen = inBoards
    await expect(m.removeFromCollection(id, itemId)).rejects.toThrow('ENOSPC')
    expect(onDisk(id).equals(before)).toBe(true)
    expect(readdirSync(boardsDir())).toEqual(justTheBoards(id))
  })

  it('restore (the undo history): a board it could not rewrite is still the board that was there', async () => {
    const { m, id, before } = await boardWithOneItem()
    const snapshot = (await m.listCollections()).map((c) => ({ ...c, name: 'Restored name', items: [] }))
    faults.failWhen = inBoards
    await expect(m.restoreCollections(snapshot)).rejects.toThrow('ENOSPC')
    expect(onDisk(id).equals(before)).toBe(true)
    expect(readdirSync(boardsDir())).toEqual(justTheBoards(id))
  })

  it('create: a board that could not be written leaves no stub file (the list never has a board it cannot read)', async () => {
    const m = await import('./moodboard')
    expect(await m.listCollections()).toEqual([])
    faults.failWhen = inBoards
    await expect(m.createCollection('Doomed')).rejects.toThrow('ENOSPC')
    expect(readdirSync(boardsDir())).toEqual([])
  })

  it('every write that succeeds is the whole board as JSON, and leaves no tmp beside it', async () => {
    const { m, id } = await boardWithOneItem()
    const renamed = await m.renameCollection(id, 'Renamed')
    expect(onDisk(id).toString('utf8')).toBe(JSON.stringify(renamed, null, 2))
    const removed = await m.removeFromCollection(id, renamed?.items[0]?.id as string)
    expect(onDisk(id).toString('utf8')).toBe(JSON.stringify(removed, null, 2))
    await m.restoreCollections((await m.listCollections()).map((c) => ({ ...c, name: 'Back' })))
    expect(JSON.parse(onDisk(id).toString('utf8')).name).toBe('Back')
    expect(readdirSync(boardsDir())).toEqual(justTheBoards(id))
  })

  // Found by the tests above: `withCollectionLock` ended with `void next.finally(...)`, and a `finally` on a promise that REJECTED is a new promise that rejects
  // too, with nobody to hear it. Every failed board write was therefore also an unhandled rejection in main (Node's default is to raise it), on top of the
  // caller's own rejection. The clean-up now settles on either outcome and ends there.
  it('a failed board write is the caller\'s rejection only: the lock\'s clean-up raises no unhandled one', async () => {
    const { m, id } = await boardWithOneItem()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      faults.failWhen = inBoards
      await expect(m.addToCollection(id, makeResult(2))).rejects.toThrow('ENOSPC')
      await expect(m.renameCollection(id, 'x'.repeat(2000))).rejects.toThrow('ENOSPC')
      // The rejection of a dropped promise is reported on a later turn of the event loop.
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

