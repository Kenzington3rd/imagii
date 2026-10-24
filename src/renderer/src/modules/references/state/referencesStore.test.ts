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
    searchLoading: false,
    searchQuery: '',
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

describe('a rejected search (T-84)', () => {
  // An outage comes back as a `notice` on a normal response (T-30); a REJECTED
  // search is a bridge fault or a bug. It still must not reach the user as
  // Electron's envelope, and the raw error must not be lost.
  function stubSearch(images: () => Promise<never>): void {
    vi.stubGlobal('window', { api: { moodboard: moodboardApi, search: { images } } })
  }

  it('stores a plain sentence, with the cause when it is a known one', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const raw = new Error("Error invoking remote method 'search:images': Error: net::ERR_PROXY_CONNECTION_FAILED")
    stubSearch(() => Promise.reject(raw))

    await store().search('mountains')

    expect(store().searchError).toBe(
      "Search failed. imagii couldn't reach the internet. Check your connection and try again."
    )
    expect(store().searchError).not.toMatch(/invoking|remote|net::|search:images/)
    expect(store().searchResponse).toBeNull()
    expect(store().searchLoading).toBe(false)
    expect(errorSpy).toHaveBeenCalledWith('[imagii] Search failed.', raw)
    errorSpy.mockRestore()
  })

  it('an unrecognised rejection becomes the generic sentence, not its text', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubSearch(() => Promise.reject(new Error('query must be a string')))

    await store().search('x')

    expect(store().searchError).toBe('Search failed.')
    errorSpy.mockRestore()
  })
})

describe('one search at a time (T-133 (8)), and the newest query is the one that is answered (T-134 (3))', () => {
  // The Search button is disabled while a request is out; the input's Enter was not, so a second press (or a held key) sent a second request and
  // whichever answered LAST won the results grid - a slow first answer overwrote the newer search. T-133 (8) closed that by refusing every press
  // while a request was out, which also threw away a CORRECTED query (the typo's answer then filled a grid that no query on the page named).
  // Now: a press of the query that is already out sends nothing (a held Enter is one request); a different query goes out at once; and an answer
  // is drawn only if it belongs to the newest request. The guard is in the store's `search`, the one function every caller goes through.
  function stubGatedSearch(): { images: ReturnType<typeof vi.fn>; release: (query: string) => void } {
    const waiting: Array<{ query: string; resolve: (answered: string) => void }> = []
    const images = vi.fn(
      (query: string) =>
        new Promise((resolve) => {
          waiting.push({ query, resolve: (answered) => resolve({ query: answered, provider: 'duckduckgo', results: [] }) })
        })
    )
    vi.stubGlobal('window', { api: { moodboard: moodboardApi, search: { images } } })
    // `release(query)` answers the OLDEST request that was made for that query.
    return {
      images,
      release: (query) => {
        const at = waiting.findIndex((w) => w.query === query)
        if (at >= 0) waiting.splice(at, 1)[0]?.resolve(query)
      }
    }
  }
  const answersDrawn = (): Array<string | undefined> => {
    const seen: Array<string | undefined> = []
    const stop = useReferencesStore.subscribe((s) => {
      if (seen[seen.length - 1] !== s.searchResponse?.query) seen.push(s.searchResponse?.query)
    })
    return Object.assign(seen, { stop })
  }

  it('a second press of the query that is out sends nothing, and its answer is the one on screen', async () => {
    const { images, release } = stubGatedSearch()
    const first = store().search('mountains')
    expect(store().searchLoading).toBe(true)

    // Not awaited: a press that is not refused would wait on its own gate.
    const second = store().search('mountains')
    const third = store().search('mountains')
    expect(images, 'one request for three presses of one query').toHaveBeenCalledTimes(1)

    release('mountains')
    await Promise.all([first, second, third])
    expect(store().searchLoading).toBe(false)
    expect(store().searchResponse?.query).toBe('mountains')
  })

  it('a CORRECTED query typed while one is out goes out, and its answer is what the grid shows - the typo\'s late answer is never drawn', async () => {
    const { images, release } = stubGatedSearch()
    const drawn = answersDrawn() as Array<string | undefined> & { stop: () => void }
    const typo = store().search('mountians')
    const corrected = store().search('mountains')
    expect(images, 'the corrected query is asked, not dropped').toHaveBeenCalledTimes(2)
    expect(images).toHaveBeenLastCalledWith('mountains')
    expect(store().searchLoading, 'still waiting for the newest').toBe(true)

    // The newest answers first: the grid shows it, and the button is idle even though the typo's request is still out.
    release('mountains')
    await corrected
    expect(store().searchResponse?.query).toBe('mountains')
    expect(store().searchLoading).toBe(false)

    // The typo's answer arrives late: it belongs to a question nothing on the page names any more.
    release('mountians')
    await typo
    expect(store().searchResponse?.query, 'the late answer did not overwrite the newest').toBe('mountains')
    expect(store().searchLoading).toBe(false)
    expect(drawn.filter((q) => q === 'mountians'), 'the typo\'s answer was never on screen').toEqual([])
    drawn.stop()
  })

  it('the corrected query answers LAST and the typo FIRST: the typo is not drawn even for a moment, and the button stays busy until the newest is in', async () => {
    const { release } = stubGatedSearch()
    const drawn = answersDrawn() as Array<string | undefined> & { stop: () => void }
    const typo = store().search('mountians')
    const corrected = store().search('mountains')

    release('mountians')
    await typo
    expect(store().searchResponse, 'an older answer is not drawn while a newer request is out').toBeNull()
    expect(store().searchLoading, 'and the panel is still searching').toBe(true)

    release('mountains')
    await corrected
    expect(store().searchResponse?.query).toBe('mountains')
    expect(store().searchLoading).toBe(false)
    expect(drawn.filter((q) => q === 'mountians')).toEqual([])
    drawn.stop()
  })

  it('typing the query that is out back in (a correction undone) is not a second request, but a different one after a different one is', async () => {
    const { images, release } = stubGatedSearch()
    const a = store().search('rivers')
    const b = store().search('rivers') // the same: nothing
    expect(images).toHaveBeenCalledTimes(1)
    const c = store().search('lakes') // different: asked
    expect(images).toHaveBeenCalledTimes(2)
    const d = store().search('lakes') // now 'lakes' is the one that is out: nothing
    expect(images).toHaveBeenCalledTimes(2)
    release('lakes')
    release('rivers')
    await Promise.all([a, b, c, d])
    expect(store().searchResponse?.query).toBe('lakes')
  })

  // T-135 (5): the panel's input was its own state, so the store's grid outlived it. The query is the store's too, and it is what the button
  // compares the typed text with.
  it('remembers the newest request\'s query: the one in flight, then the one that was answered - so the grid always has a name', async () => {
    const { release } = stubGatedSearch()
    expect(store().searchQuery).toBe('')
    const typo = store().search('mountians')
    expect(store().searchQuery, 'named the moment the request goes out').toBe('mountians')
    const corrected = store().search('mountains')
    expect(store().searchQuery, 'a correction replaces it').toBe('mountains')
    release('mountians')
    await typo
    expect(store().searchQuery, 'an older answer arriving does not take the name back').toBe('mountains')
    release('mountains')
    await corrected
    expect(store().searchQuery, 'and the name stays after the answer is in').toBe('mountains')
    expect(store().searchResponse?.query).toBe(store().searchQuery)
  })

  it('a query the store refuses as already out does not rename anything; a failed search keeps the name of what was asked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { release } = stubGatedSearch()
    const first = store().search('rivers')
    void store().search('rivers')
    expect(store().searchQuery).toBe('rivers')
    release('rivers')
    await first
    const images = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('window', { api: { moodboard: moodboardApi, search: { images } } })
    await store().search('lakes')
    expect(store().searchError).toBe('Search failed.')
    expect(store().searchQuery, 'the box can still say what was asked').toBe('lakes')
    errorSpy.mockRestore()
  })

  it('once the answer is in, the next search goes out', async () => {
    const { images, release } = stubGatedSearch()
    const first = store().search('mountains')
    release('mountains')
    await first

    const second = store().search('rivers')
    expect(images).toHaveBeenCalledTimes(2)
    release('rivers')
    await second
    expect(store().searchResponse?.query).toBe('rivers')
  })

  it('a search that failed gives the slot back (the guard is not a latch)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const images = vi.fn().mockRejectedValueOnce(new Error('query must be a string')).mockResolvedValue({ query: 'again', provider: 'duckduckgo', results: [] })
    vi.stubGlobal('window', { api: { moodboard: moodboardApi, search: { images } } })

    await store().search('x')
    expect(store().searchError).toBe('Search failed.')
    await store().search('again')
    expect(images).toHaveBeenCalledTimes(2)
    expect(store().searchResponse?.query).toBe('again')
    errorSpy.mockRestore()
  })

  it('a typo whose request FAILS after the corrected query was asked leaves no error over the newest search', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejectors: Array<(e: Error) => void> = []
    const answers: Array<(r: unknown) => void> = []
    const images = vi.fn(
      (query: string) =>
        new Promise((resolve, reject) => {
          if (query === 'mountians') rejectors.push(reject)
          else answers.push(resolve)
        })
    )
    vi.stubGlobal('window', { api: { moodboard: moodboardApi, search: { images } } })
    const typo = store().search('mountians')
    const corrected = store().search('mountains')
    answers[0]?.({ query: 'mountains', provider: 'duckduckgo', results: [] })
    await corrected
    rejectors[0]?.(new Error('boom'))
    await typo
    expect(store().searchError, 'the newest search succeeded; the typo\'s failure is not shown over it').toBeNull()
    expect(store().searchResponse?.query).toBe('mountains')
    expect(errorSpy, 'the failure is still logged for whoever debugs it').toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
