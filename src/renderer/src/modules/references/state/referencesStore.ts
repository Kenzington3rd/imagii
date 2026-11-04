import { create } from 'zustand'
import type { MoodBoardCollection, SearchResponse, SearchResult } from '@shared/search'
import type { ReferencesTab } from '@shared/workspace'
import { userFacingError } from '@shared/userFacingError'

// One definition, in shared, because a session snapshot records the tab
// (T-47) and the validator has to know the same list. Re-exported here so
// every existing `import { ReferencesTab } from '…/referencesStore'` still
// resolves.
export type { ReferencesTab }

/** One undo step: the boards as they stood before a mutation, with the
 *  selection that went with them. The pair is captured atomically, the same
 *  way videoStore pairs clips with selectedClipId, so undoing a delete also
 *  puts the user back on the board they were looking at instead of leaving
 *  the selection pointing at nothing. */
interface BoardsSnapshot {
  collections: MoodBoardCollection[]
  selectedCollectionId: string | null
}

/** Same shape and same 50-step cap as videoStore / audioStore / canvasStore —
 *  useGlobalUndo counts `past` and `future` across all four and cannot tell
 *  them apart, which is exactly what makes Home's Undo one queue. */
interface History {
  past: BoardsSnapshot[]
  future: BoardsSnapshot[]
}

const HISTORY_LIMIT = 50

function pushHistory(history: History, snapshot: BoardsSnapshot): History {
  const past = [...history.past, snapshot]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: []
  }
}

const EMPTY_HISTORY: History = { past: [], future: [] }

/**
 * T-150 (2): ONE serialised chain for everything that changes the boards - the five mutators and the disk write an undo/redo issues.
 *
 * The three other studios undo pure renderer state; this one owns files. Main serialises the writes under its board lock (an add fetches the thumbnail
 * inside it), but the store took its undo snapshot at PRESS time: saving picture A then B before A landed recorded [N, N] and one Ctrl+Z removed both.
 * Each mutation now takes its snapshot when its TURN starts, after the previous one has set its result. The undo itself has to stay synchronous (Home
 * calls it through the same `() => void` the others expose), so its write is fired rather than awaited - and `refreshCollections` waits on this chain
 * before re-reading, or a panel mounting right after a Ctrl+Z could read the pre-undo directory and quietly put the undone change back on screen.
 */
let chain: Promise<unknown> = Promise.resolve()
const noop = (): void => {}

function run<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.then(noop, noop)
  return next
}

/** Mutations queued or running. An undo/redo pressed while one is out waits its turn (it undoes what that mutation is about to record); with none out
 *  it is applied on the spot, so the other studios' synchronous contract (and the tests that read the state right after `undo()`) still holds. */
let mutating = 0

function mutate<T>(fn: () => Promise<T>): Promise<T> {
  mutating++
  return run(fn).finally(() => {
    mutating--
  })
}

interface ReferencesStudioState {
  tab: ReferencesTab
  searchResponse: SearchResponse | null
  searchLoading: boolean
  searchError: string | null
  /** T-135 (5): the query of the newest request - the one in flight, or the one that was answered. The panel's input was its own state, so a trip to
   *  Mood Boards and back drew the grid over a blank box; and its button needs it to tell "the question that is already out" (refused) from a
   *  correction (sent). */
  searchQuery: string
  collections: MoodBoardCollection[]
  selectedCollectionId: string | null
  /** T-58. Board create/rename/delete and item add/remove all push a step;
   *  the tab, the selection and search results do not — they are where the
   *  user is looking, not what they changed. */
  history: History

  setTab: (t: ReferencesTab) => void

  search: (query: string) => Promise<void>

  refreshCollections: () => Promise<void>
  /** Resolves with the new board's id — T-28's first-save saves INTO it, and
   *  re-reading the directory to guess which one is new picked `collections[0]`,
   *  i.e. the newest board by createdAt, which is only the right answer when
   *  the create is the only thing that happened. */
  createCollection: (name: string) => Promise<string>
  deleteCollection: (id: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  selectCollection: (id: string) => void
  /** Resolves true when the picture was added and false when it was already on the board (main dedupes on `fullUrl` and hands the board back
   *  unchanged). T-76/T-147 (5): the answer comes from the item count in the list this call already re-reads, so no IPC shape changed. */
  addToCollection: (collectionId: string, result: SearchResult) => Promise<boolean>
  removeFromCollection: (collectionId: string, itemId: string) => Promise<void>

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** T-47 — a restored session is not an edit. Nothing here is captured in a
   *  project snapshot (mood boards live on disk in their own right), so the
   *  restore has no board state to put back; what it must not leave behind is
   *  an Undo lit over work that belongs to the session before it. */
  resetHistory: () => void
}

export const useReferencesStore = create<ReferencesStudioState>((set, get) => {
  // T-134 (3): which request owns the results grid. A counter, not a flag, because requests can overlap (a corrected query goes out while the
  // typo's is still in flight) and only the newest one's outcome is drawn.
  let latestRequest = 0

  function snapshot(): BoardsSnapshot {
    const { collections, selectedCollectionId } = get()
    return { collections, selectedCollectionId }
  }

  /** Make the boards on disk match the step we just moved to. On failure,
   *  adopt what the disk really says rather than leaving the UI showing an
   *  undo that never landed. */
  function writeThrough(collections: MoodBoardCollection[]): () => Promise<void> {
    return async () => {
      try {
        await window.api.moodboard.restore(collections)
      } catch {
        set({ collections: await window.api.moodboard.list() })
      }
    }
  }

  /** Move one step back (undo) or forward (redo) NOW and hand back the disk write that makes the directory match, or null when there is no step. */
  function step(direction: 'undo' | 'redo'): (() => Promise<void>) | null {
    const { history, collections, selectedCollectionId } = get()
    const here = { collections, selectedCollectionId }
    if (direction === 'undo') {
      const last = history.past[history.past.length - 1]
      if (!last) return null
      set({
        collections: last.collections,
        selectedCollectionId: last.selectedCollectionId,
        history: { past: history.past.slice(0, -1), future: [here, ...history.future] }
      })
      return writeThrough(last.collections)
    }
    const next = history.future[0]
    if (!next) return null
    set({
      collections: next.collections,
      selectedCollectionId: next.selectedCollectionId,
      history: { past: [...history.past, here], future: history.future.slice(1) }
    })
    return writeThrough(next.collections)
  }

  function stepThroughChain(direction: 'undo' | 'redo'): void {
    if (mutating > 0) {
      void mutate(async () => {
        await step(direction)?.()
      }).catch(noop)
      return
    }
    const write = step(direction)
    if (write) void run(write)
  }

  return {
    tab: 'reference',
    searchResponse: null,
    searchLoading: false,
    searchError: null,
    searchQuery: '',
    collections: [],
    selectedCollectionId: null,
    history: EMPTY_HISTORY,

    setTab: (t) => set({ tab: t }),

    search: async (query: string) => {
      // T-133 (8): one request per query. The button is disabled while a request is out and the input's Enter was not, so a second press (or a held
      // key) of the SAME query sent a second request, and whichever answered LAST owned the grid. Read from the store, not a render's closure: two
      // presses in one breath see the same render.
      if (get().searchLoading && query === get().searchQuery) return
      // T-134 (3): a DIFFERENT query is not a duplicate. T-133 (8) refused every press while a request was out, which threw away a corrected query
      // (type, Enter, spot the typo, fix it, Enter): the typo's answer then filled a grid that no query on the page named. The newest request
      // owns the grid: an answer (or a failure) that is not the newest request's is dropped, and the panel stays busy until the newest settles.
      const mine = ++latestRequest
      set({ searchLoading: true, searchError: null, searchQuery: query })
      try {
        const response = await window.api.search.images(query)
        if (mine === latestRequest) set({ searchResponse: response })
      } catch (err) {
        // T-84: a REJECTED search is a bug or a bridge fault — an outage comes
        // back as a `notice` on a normal response (T-30) — so this is the
        // generic card, in plain words, with the raw error in the console.
        const failure = userFacingError(err, 'Search failed.').message
        if (mine === latestRequest) set({ searchError: failure, searchResponse: null })
      } finally {
        if (mine === latestRequest) set({ searchLoading: false })
      }
    },

    refreshCollections: async () => {
      await chain
      const collections = await window.api.moodboard.list()
      const current = get().selectedCollectionId
      set({
        collections,
        selectedCollectionId:
          current && collections.find((c) => c.id === current)
            ? current
            : (collections[0]?.id ?? null)
      })
    },
    createCollection: (name: string) =>
      mutate(async () => {
        const before = snapshot()
        const collection = await window.api.moodboard.create(name)
        const collections = await window.api.moodboard.list()
        // The step is pushed only once the write succeeded: a refused name must
        // not leave an undo entry that would step back over nothing.
        set({
          collections,
          selectedCollectionId: collection.id,
          history: pushHistory(get().history, before)
        })
        return collection.id
      }),
    deleteCollection: (id: string) =>
      mutate(async () => {
        const before = snapshot()
        await window.api.moodboard.delete(id)
        const collections = await window.api.moodboard.list()
        set({
          collections,
          selectedCollectionId:
            get().selectedCollectionId === id
              ? (collections[0]?.id ?? null)
              : get().selectedCollectionId,
          history: pushHistory(get().history, before)
        })
      }),
    renameCollection: (id: string, name: string) =>
      mutate(async () => {
        const before = snapshot()
        await window.api.moodboard.rename(id, name)
        const collections = await window.api.moodboard.list()
        set({ collections, history: pushHistory(get().history, before) })
      }),
    selectCollection: (id) => set({ selectedCollectionId: id }),
    addToCollection: (collectionId, result) =>
      mutate(async () => {
        // T-150 (2): the snapshot is taken when this turn STARTS, so it holds the previous mutation's result (taken at press time, two quick saves both held N).
        const before = snapshot()
        // T-149 (4): main says whether IT added the picture (decided under its lock). A count compare of two re-reads could not tell two presses in flight apart:
        // both snapshots held N, both re-reads held N+1, both pushed a step.
        const { added } = await window.api.moodboard.addItem(collectionId, result)
        const collections = await window.api.moodboard.list()
        // A duplicate changed nothing on disk, so it is not a step: pushing one left an Undo that undid nothing, on top of the real steps.
        set(added ? { collections, history: pushHistory(get().history, before) } : { collections })
        return added
      }),
    removeFromCollection: (collectionId, itemId) =>
      mutate(async () => {
        const before = snapshot()
        await window.api.moodboard.removeItem(collectionId, itemId)
        const collections = await window.api.moodboard.list()
        set({ collections, history: pushHistory(get().history, before) })
      }),

    undo: () => stepThroughChain('undo'),
    redo: () => stepThroughChain('redo'),
    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0,
    resetHistory: () => set({ history: EMPTY_HISTORY })
  }
})
