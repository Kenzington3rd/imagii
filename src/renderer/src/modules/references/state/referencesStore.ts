import { create } from 'zustand'
import type { MoodBoardCollection, SearchResponse, SearchResult } from '@shared/search'
import type { ReferencesTab } from '@shared/workspace'

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
 * Every disk write undo/redo issues, chained.
 *
 * The three other studios undo pure renderer state; this one owns files. The
 * undo itself has to stay synchronous (Home calls it through the same
 * `() => void` the others expose), so the write is fired rather than awaited
 * — and `refreshCollections` waits on this chain before re-reading, or a
 * panel mounting right after a Ctrl+Z could read the pre-undo directory and
 * quietly put the undone change back on screen.
 */
let diskWrites: Promise<unknown> = Promise.resolve()

interface ReferencesStudioState {
  tab: ReferencesTab
  searchResponse: SearchResponse | null
  searchLoading: boolean
  searchError: string | null
  collections: MoodBoardCollection[]
  selectedCollectionId: string | null
  /** T-58. Board create/rename/delete and item add/remove all push a step;
   *  the tab, the selection and search results do not — they are where the
   *  user is looking, not what they changed. */
  history: History

  setTab: (t: ReferencesTab) => void

  search: (query: string) => Promise<void>

  refreshCollections: () => Promise<void>
  createCollection: (name: string) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  selectCollection: (id: string) => void
  addToCollection: (collectionId: string, result: SearchResult) => Promise<void>
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
  function snapshot(): BoardsSnapshot {
    const { collections, selectedCollectionId } = get()
    return { collections, selectedCollectionId }
  }

  /** Make the boards on disk match the step we just moved to. On failure,
   *  adopt what the disk really says rather than leaving the UI showing an
   *  undo that never landed. */
  function writeThrough(collections: MoodBoardCollection[]): void {
    const run = async (): Promise<void> => {
      try {
        await window.api.moodboard.restore(collections)
      } catch {
        set({ collections: await window.api.moodboard.list() })
      }
    }
    diskWrites = diskWrites.then(run, run)
  }

  return {
    tab: 'reference',
    searchResponse: null,
    searchLoading: false,
    searchError: null,
    collections: [],
    selectedCollectionId: null,
    history: EMPTY_HISTORY,

    setTab: (t) => set({ tab: t }),

    search: async (query: string) => {
      set({ searchLoading: true, searchError: null })
      try {
        const response = await window.api.search.images(query)
        set({ searchResponse: response })
      } catch (err) {
        set({
          searchError: err instanceof Error ? err.message : 'Search failed',
          searchResponse: null
        })
      } finally {
        set({ searchLoading: false })
      }
    },

    refreshCollections: async () => {
      await diskWrites
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
    createCollection: async (name: string) => {
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
    },
    deleteCollection: async (id: string) => {
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
    },
    renameCollection: async (id: string, name: string) => {
      const before = snapshot()
      await window.api.moodboard.rename(id, name)
      const collections = await window.api.moodboard.list()
      set({ collections, history: pushHistory(get().history, before) })
    },
    selectCollection: (id) => set({ selectedCollectionId: id }),
    addToCollection: async (collectionId, result) => {
      const before = snapshot()
      await window.api.moodboard.addItem(collectionId, result)
      const collections = await window.api.moodboard.list()
      set({ collections, history: pushHistory(get().history, before) })
    },
    removeFromCollection: async (collectionId, itemId) => {
      const before = snapshot()
      await window.api.moodboard.removeItem(collectionId, itemId)
      const collections = await window.api.moodboard.list()
      set({ collections, history: pushHistory(get().history, before) })
    },

    undo: () => {
      const { history, collections, selectedCollectionId } = get()
      if (history.past.length === 0) return
      const last = history.past[history.past.length - 1]!
      set({
        collections: last.collections,
        selectedCollectionId: last.selectedCollectionId,
        history: {
          past: history.past.slice(0, -1),
          future: [{ collections, selectedCollectionId }, ...history.future]
        }
      })
      writeThrough(last.collections)
    },
    redo: () => {
      const { history, collections, selectedCollectionId } = get()
      if (history.future.length === 0) return
      const next = history.future[0]!
      set({
        collections: next.collections,
        selectedCollectionId: next.selectedCollectionId,
        history: {
          past: [...history.past, { collections, selectedCollectionId }],
          future: history.future.slice(1)
        }
      })
      writeThrough(next.collections)
    },
    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0,
    resetHistory: () => set({ history: EMPTY_HISTORY })
  }
})
