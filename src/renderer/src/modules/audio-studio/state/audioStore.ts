import { create } from 'zustand'
import type {
  AudioProbe,
  ChainSpec,
  CutRegion,
  SecondaryTrack
} from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'

export interface AudioSource {
  filePath: string
  fileName: string
  url: string
  probe: AudioProbe
  fromVideo: { videoPath: string } | null
}

interface History {
  past: ChainSpec[]
  future: ChainSpec[]
}

interface AudioStudioState {
  source: AudioSource | null
  chain: ChainSpec
  history: History
  currentTime: number
  loading: boolean

  loadSource: (filePath: string, fromVideoPath?: string) => Promise<void>
  clearSource: () => void
  setCurrentTime: (t: number) => void

  patchChain: (patch: Partial<ChainSpec>) => void
  resetChain: () => void
  addCutRegion: (region: CutRegion) => void
  removeCutRegion: (index: number) => void
  updateCutRegion: (index: number, region: CutRegion) => void
  setSecondaryTrack: (track: SecondaryTrack | null) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

function fileNameFromPath(p: string): string {
  const cleaned = p.replace(/\\/g, '/')
  return cleaned.substring(cleaned.lastIndexOf('/') + 1)
}

const HISTORY_LIMIT = 50

function pushHistory(history: History, spec: ChainSpec): History {
  const past = [...history.past, spec]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: []
  }
}

export const useAudioStore = create<AudioStudioState>((set, get) => ({
  source: null,
  chain: DEFAULT_CHAIN_SPEC,
  history: { past: [], future: [] },
  currentTime: 0,
  loading: false,

  loadSource: async (filePath, fromVideoPath) => {
    set({ loading: true })
    try {
      const probe = await window.api.audio.probe(filePath)
      const url = window.api.video.fileUrl(filePath)
      set({
        source: {
          filePath,
          fileName: fileNameFromPath(filePath),
          url,
          probe,
          fromVideo: fromVideoPath ? { videoPath: fromVideoPath } : null
        },
        chain: DEFAULT_CHAIN_SPEC,
        history: { past: [], future: [] },
        currentTime: 0
      })
    } finally {
      set({ loading: false })
    }
  },
  clearSource: () =>
    set({
      source: null,
      chain: DEFAULT_CHAIN_SPEC,
      history: { past: [], future: [] },
      currentTime: 0
    }),
  setCurrentTime: (t) => set({ currentTime: t }),

  patchChain: (patch) => {
    const prev = get().chain
    const next = { ...prev, ...patch }
    set({ chain: next, history: pushHistory(get().history, prev) })
  },
  resetChain: () => {
    const prev = get().chain
    set({ chain: DEFAULT_CHAIN_SPEC, history: pushHistory(get().history, prev) })
  },
  addCutRegion: (region) => {
    const prev = get().chain
    set({
      chain: { ...prev, cutRegions: [...prev.cutRegions, region] },
      history: pushHistory(get().history, prev)
    })
  },
  removeCutRegion: (index) => {
    const prev = get().chain
    set({
      chain: { ...prev, cutRegions: prev.cutRegions.filter((_, i) => i !== index) },
      history: pushHistory(get().history, prev)
    })
  },
  updateCutRegion: (index, region) => {
    const prev = get().chain
    set({
      chain: {
        ...prev,
        cutRegions: prev.cutRegions.map((r, i) => (i === index ? region : r))
      },
      history: pushHistory(get().history, prev)
    })
  },
  setSecondaryTrack: (track) => {
    const prev = get().chain
    set({
      chain: { ...prev, secondaryTrack: track },
      history: pushHistory(get().history, prev)
    })
  },

  undo: () => {
    const { history, chain } = get()
    if (history.past.length === 0) return
    const last = history.past[history.past.length - 1]!
    set({
      chain: last,
      history: {
        past: history.past.slice(0, -1),
        future: [chain, ...history.future]
      }
    })
  },
  redo: () => {
    const { history, chain } = get()
    if (history.future.length === 0) return
    const next = history.future[0]!
    set({
      chain: next,
      history: {
        past: [...history.past, chain],
        future: history.future.slice(1)
      }
    })
  },
  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0
}))
