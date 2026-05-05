import { create } from 'zustand'
import type {
  AiInstallStatus,
  AiJobProgress,
  GeneratedImage,
  GenerationResult
} from '@shared/ai'
import type { MoodBoardCollection, SearchResponse, SearchResult } from '@shared/search'

export type AiTab = 'generate' | 'reference' | 'moodboards'

interface JobUiState {
  jobId: string
  phase: AiJobProgress['phase']
  percent: number
  message?: string
}

interface AiStudioState {
  status: AiInstallStatus | null
  loadingStatus: boolean
  tab: AiTab
  searchResponse: SearchResponse | null
  searchLoading: boolean
  searchError: string | null
  collections: MoodBoardCollection[]
  selectedCollectionId: string | null
  generations: GeneratedImage[]
  job: JobUiState | null

  refreshStatus: () => Promise<void>
  setTab: (t: AiTab) => void

  search: (query: string) => Promise<void>

  refreshCollections: () => Promise<void>
  createCollection: (name: string) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  selectCollection: (id: string) => void
  addToCollection: (collectionId: string, result: SearchResult) => Promise<void>
  removeFromCollection: (collectionId: string, itemId: string) => Promise<void>

  setJob: (job: JobUiState | null) => void
  setProgress: (p: AiJobProgress) => void
  setGenerations: (result: GenerationResult) => void
}

export const useAiStore = create<AiStudioState>((set, get) => ({
  status: null,
  loadingStatus: false,
  tab: 'reference',
  searchResponse: null,
  searchLoading: false,
  searchError: null,
  collections: [],
  selectedCollectionId: null,
  generations: [],
  job: null,

  refreshStatus: async () => {
    set({ loadingStatus: true })
    try {
      const status = await window.api.ai.status()
      set({ status })
    } finally {
      set({ loadingStatus: false })
    }
  },
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
    const collection = await window.api.moodboard.create(name)
    const collections = await window.api.moodboard.list()
    set({ collections, selectedCollectionId: collection.id })
  },
  deleteCollection: async (id: string) => {
    await window.api.moodboard.delete(id)
    const collections = await window.api.moodboard.list()
    set({
      collections,
      selectedCollectionId:
        get().selectedCollectionId === id ? (collections[0]?.id ?? null) : get().selectedCollectionId
    })
  },
  renameCollection: async (id: string, name: string) => {
    await window.api.moodboard.rename(id, name)
    const collections = await window.api.moodboard.list()
    set({ collections })
  },
  selectCollection: (id) => set({ selectedCollectionId: id }),
  addToCollection: async (collectionId, result) => {
    await window.api.moodboard.addItem(collectionId, result)
    const collections = await window.api.moodboard.list()
    set({ collections })
  },
  removeFromCollection: async (collectionId, itemId) => {
    await window.api.moodboard.removeItem(collectionId, itemId)
    const collections = await window.api.moodboard.list()
    set({ collections })
  },

  setJob: (job) => set({ job }),
  setProgress: (p) =>
    set((state) =>
      state.job && state.job.jobId === p.jobId
        ? {
            job: {
              jobId: p.jobId,
              phase: p.phase,
              percent: p.percent ?? state.job.percent,
              message: p.message
            }
          }
        : state
    ),
  setGenerations: (result) => set({ generations: result.images })
}))
