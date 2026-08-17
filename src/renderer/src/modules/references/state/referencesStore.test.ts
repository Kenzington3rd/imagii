import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MoodBoardCollection, MoodBoardItem, SearchResult } from '@shared/search'
import { useReferencesStore } from './referencesStore'

/**
 * T-58 — the references history.
 *
 * The store is plain zustand and only reaches outward through
 * `window.api.moodboard`, so the whole thing runs in the node environment
 * against an in-memory stand-in for the boards directory. That stand-in is
 * the point of most of these tests: this is the one studio whose undo has to
 * move FILES, and a step that reverts the screen while leaving disk on the
 * other side of the change would look correct in every renderer-only
 * assertion.
 *
 * The cross-studio ordering this store now takes part in lives in
 * `hooks/useGlobalUndo.test.ts`; the real app is driven in
 * `tests/e2e/references.spec.ts`.
 */

let disk: MoodBoardCollection[] = []
const restoreCalls: MoodBoardCollection[][] = []
let nextId = 0

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function makeItem(n: number): MoodBoardItem {
  return {
    id: `item-${n}`,
    collectionId: '',
    thumbnail: `https://example.invalid/thumb-${n}.jpg`,
    fullUrl: `https://example.invalid/full-${n}.jpg`,
    source: 'example.invalid',
    title: `Reference ${n}`,
    cachedThumbPath: `/cache/thumbs/thumb-${n}.jpg`,
    addedAt: 1700000000000 + n
  }
}

function makeResult(n: number): SearchResult {
  return {
    id: `result-${n}`,
    thumbnail: `https://example.invalid/thumb-${n}.jpg`,
    fullUrl: `https://example.invalid/full-${n}.jpg`,
    source: 'example.invalid',
    title: `Reference ${n}`
  }
}

function board(id: string, name: string, items: MoodBoardItem[] = []): MoodBoardCollection {
  return { id, name, items, createdAt: 1700000000000 }
}

/** The moodboard half of the preload bridge, backed by `disk`. */
const moodboardApi = {
  list: () => Promise.resolve(clone(disk)),
  create: (name: string) => {
    const created = board(`board-${++nextId}`, name)
    disk.push(created)
    return Promise.resolve(clone(created))
  },
  delete: (id: string) => {
    disk = disk.filter((c) => c.id !== id)
    return Promise.resolve()
  },
  rename: (id: string, name: string) => {
    const found = disk.find((c) => c.id === id)
    if (found) found.name = name
    return Promise.resolve(found ? clone(found) : null)
  },
  addItem: (collectionId: string, result: SearchResult) => {
    const found = disk.find((c) => c.id === collectionId)
    if (!found) return Promise.resolve(null)
    found.items.push({ ...makeItem(found.items.length + 1), collectionId, title: result.title })
    return Promise.resolve(clone(found))
  },
  removeItem: (collectionId: string, itemId: string) => {
    const found = disk.find((c) => c.id === collectionId)
    if (!found) return Promise.resolve(null)
    found.items = found.items.filter((i) => i.id !== itemId)
    return Promise.resolve(clone(found))
  },
  restore: (collections: MoodBoardCollection[]) => {
    restoreCalls.push(clone(collections))
    disk = clone(collections)
    return Promise.resolve()
  },
  prune: () => Promise.resolve()
}

const store = (): ReturnType<typeof useReferencesStore.getState> => useReferencesStore.getState()
const names = (): string[] => store().collections.map((c) => c.name)
const diskNames = (): string[] => disk.map((c) => c.name)

/** Undo/redo fire their disk write rather than awaiting it (the signature is
 *  shared with the other studios). Everything on that chain is drained by a
 *  read, which is exactly how the panels see it. */
async function settle(): Promise<void> {
  await store().refreshCollections()
}

beforeEach(() => {
  disk = []
  restoreCalls.length = 0
  nextId = 0
  vi.stubGlobal('window', { api: { moodboard: moodboardApi } })
  useReferencesStore.setState({
    collections: [],
    selectedCollectionId: null,
    history: { past: [], future: [] },
    searchResponse: null,
    searchError: null,
    tab: 'reference'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what does and does not record a step', () => {
  it('records board create, rename, delete and item add/remove', async () => {
    await store().createCollection('Alpha')
    expect(store().history.past).toHaveLength(1)
    await store().renameCollection('board-1', 'Alpha renamed')
    expect(store().history.past).toHaveLength(2)
    await store().addToCollection('board-1', makeResult(1))
    expect(store().history.past).toHaveLength(3)
    await store().removeFromCollection('board-1', 'item-1')
    expect(store().history.past).toHaveLength(4)
    await store().deleteCollection('board-1')
    expect(store().history.past).toHaveLength(5)
  })

  it('leaves the history OBJECT untouched for everything that is not an edit', async () => {
    await store().createCollection('Alpha')
    await store().createCollection('Beta')
    const before = store().history

    store().setTab('moodboards')
    store().selectCollection('board-1')
    await store().refreshCollections()

    // Identity, not length: useGlobalUndo treats a new `history` object as
    // proof that a step happened, so a no-op that rebuilt it would put a
    // phantom entry in Home's cross-studio queue.
    expect(store().history).toBe(before)
  })

  it('caps at 50 steps, dropping the oldest', async () => {
    for (let i = 0; i < 55; i++) await store().createCollection(`Board ${i}`)
    expect(store().history.past).toHaveLength(50)
    // The oldest surviving step is the one taken with 5 boards already made.
    expect(store().history.past[0]?.collections).toHaveLength(5)
  })

  it('records nothing when the write is refused', async () => {
    vi.stubGlobal('window', {
      api: {
        moodboard: { ...moodboardApi, create: () => Promise.reject(new Error('name too long')) }
      }
    })
    await expect(store().createCollection('x'.repeat(500))).rejects.toThrow('name too long')
    expect(store().canUndo()).toBe(false)
  })
})

describe('undo puts the boards back on screen AND on disk', () => {
  it('restores a deleted board with its items and its selection', async () => {
    await store().createCollection('Keepers')
    await store().addToCollection('board-1', makeResult(1))
    await store().addToCollection('board-1', makeResult(2))
    await store().createCollection('Other')
    store().selectCollection('board-1')

    await store().deleteCollection('board-1')
    expect(names()).toEqual(['Other'])
    expect(diskNames()).toEqual(['Other'])
    expect(store().selectedCollectionId).toBe('board-2')

    store().undo()

    expect(names().sort()).toEqual(['Keepers', 'Other'])
    const restored = store().collections.find((c) => c.id === 'board-1')
    expect(restored?.items.map((i) => i.id)).toEqual(['item-1', 'item-2'])
    // The board the user was looking at is the board they get back.
    expect(store().selectedCollectionId).toBe('board-1')

    // …and the same is true of the directory, not just the screen.
    await settle()
    expect(diskNames().sort()).toEqual(['Keepers', 'Other'])
    expect(disk.find((c) => c.id === 'board-1')?.items).toHaveLength(2)
  })

  it('keeps the restored board byte-identical, thumbnail paths included', async () => {
    disk = [board('seeded', 'Seeded', [makeItem(1)])]
    await store().refreshCollections()
    const original = clone(store().collections)

    await store().deleteCollection('seeded')
    store().undo()
    await settle()

    expect(store().collections).toEqual(original)
    expect(disk).toEqual(original)
    expect(disk[0]?.items[0]?.cachedThumbPath).toBe('/cache/thumbs/thumb-1.jpg')
  })

  it('un-creates a board — the undo of a create deletes it from disk too', async () => {
    await store().createCollection('Accident')
    expect(diskNames()).toEqual(['Accident'])

    store().undo()
    await settle()

    expect(names()).toEqual([])
    expect(diskNames()).toEqual([])
  })

  it('walks back a rename and an item removal', async () => {
    disk = [board('b', 'Original', [makeItem(1), makeItem(2)])]
    await store().refreshCollections()

    await store().renameCollection('b', 'Renamed')
    await store().removeFromCollection('b', 'item-1')
    expect(disk[0]?.items).toHaveLength(1)

    store().undo()
    await settle()
    expect(disk[0]?.items.map((i) => i.id)).toEqual(['item-1', 'item-2'])
    expect(diskNames()).toEqual(['Renamed'])

    store().undo()
    await settle()
    expect(diskNames()).toEqual(['Original'])
  })

  it('redoes in the mirror order, disk included', async () => {
    await store().createCollection('Alpha')
    await store().createCollection('Beta')
    store().undo()
    store().undo()
    await settle()
    expect(diskNames()).toEqual([])

    store().redo()
    await settle()
    expect(diskNames()).toEqual(['Alpha'])
    store().redo()
    await settle()
    expect(diskNames()).toEqual(['Alpha', 'Beta'])
    expect(store().canRedo()).toBe(false)
  })

  it('does nothing, and writes nothing, when there is nothing to undo', () => {
    store().undo()
    store().redo()
    expect(restoreCalls).toEqual([])
    expect(store().canUndo()).toBe(false)
    expect(store().canRedo()).toBe(false)
  })

  it('adopts what the disk really says when the write fails', async () => {
    await store().createCollection('Alpha')
    vi.stubGlobal('window', {
      api: {
        moodboard: {
          ...moodboardApi,
          restore: () => Promise.reject(new Error('EACCES'))
        }
      }
    })

    store().undo()
    // The optimistic state said "gone"; the failed write means it is not.
    await settle()

    expect(names()).toEqual(['Alpha'])
    expect(diskNames()).toEqual(['Alpha'])
  })

  it('makes a re-read wait for the undo it would otherwise overtake', async () => {
    await store().createCollection('Alpha')
    store().undo()
    // No awaiting of the undo's write here — refreshCollections has to be the
    // thing that serializes, because a panel mounting after a Ctrl+Z is
    // exactly this call arriving with the write still in flight.
    await store().refreshCollections()
    expect(names()).toEqual([])
  })
})

describe('the T-47 post-restore contract', () => {
  it('resetHistory empties both stacks', async () => {
    await store().createCollection('Alpha')
    store().undo()
    expect(store().canRedo()).toBe(true)

    store().resetHistory()

    expect(store().canUndo()).toBe(false)
    expect(store().canRedo()).toBe(false)
  })
})
