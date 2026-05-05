import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { VideoProbe } from '@shared/api'
import type { Clip, CropRect, PlatformId, TextOverlay } from '@shared/clip'

export interface VideoSource {
  filePath: string
  fileName: string
  url: string
  probe: VideoProbe
}

interface VideoStudioState {
  source: VideoSource | null
  currentTime: number
  clips: Clip[]
  selectedClipId: string | null

  loadSource: (filePath: string) => Promise<void>
  clearSource: () => void
  setCurrentTime: (t: number) => void

  addClip: () => void
  addClipFromRange: (name: string, startSec: number, endSec: number) => void
  removeClip: (id: string) => void
  selectClip: (id: string) => void
  renameClip: (id: string, name: string) => void
  setClipRange: (id: string, startSec: number, endSec: number) => void
  setClipStart: (id: string, startSec: number) => void
  setClipEnd: (id: string, endSec: number) => void
  togglePreset: (id: string, preset: PlatformId) => void
  setSelectedPresets: (id: string, presets: PlatformId[]) => void
  setClipCrop: (id: string, cropRect: CropRect | null) => void
  addTextOverlay: (id: string, overlay: Omit<TextOverlay, 'id'>) => void
  updateTextOverlay: (clipId: string, overlayId: string, patch: Partial<TextOverlay>) => void
  removeTextOverlay: (clipId: string, overlayId: string) => void
}

function fileNameFromPath(p: string): string {
  const cleaned = p.replace(/\\/g, '/')
  return cleaned.substring(cleaned.lastIndexOf('/') + 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function makeDefaultClip(duration: number, index: number): Clip {
  return {
    id: nanoid(8),
    name: `Clip ${index}`,
    startSec: 0,
    endSec: duration,
    cropRect: null,
    textOverlays: [],
    selectedPresets: ['youtube']
  }
}

export const useVideoStore = create<VideoStudioState>((set, get) => ({
  source: null,
  currentTime: 0,
  clips: [],
  selectedClipId: null,

  loadSource: async (filePath: string) => {
    const probe = await window.api.video.probe(filePath)
    const url = window.api.video.fileUrl(filePath)
    const initial = makeDefaultClip(probe.duration, 1)
    set({
      source: {
        filePath,
        fileName: fileNameFromPath(filePath),
        url,
        probe
      },
      currentTime: 0,
      clips: [initial],
      selectedClipId: initial.id
    })
  },
  clearSource: () => set({ source: null, currentTime: 0, clips: [], selectedClipId: null }),
  setCurrentTime: (t: number) => set({ currentTime: t }),

  addClip: () => {
    const { source, clips } = get()
    if (!source) return
    const next = makeDefaultClip(source.probe.duration, clips.length + 1)
    set({ clips: [...clips, next], selectedClipId: next.id })
  },
  addClipFromRange: (name, startSec, endSec) => {
    const { source, clips } = get()
    if (!source) return
    const base = makeDefaultClip(source.probe.duration, clips.length + 1)
    const next = { ...base, name, startSec, endSec }
    set({ clips: [...clips, next], selectedClipId: next.id })
  },
  removeClip: (id) => {
    const { clips, selectedClipId } = get()
    const filtered = clips.filter((c) => c.id !== id)
    set({
      clips: filtered,
      selectedClipId:
        selectedClipId === id ? (filtered[0]?.id ?? null) : selectedClipId
    })
  },
  selectClip: (id) => set({ selectedClipId: id }),
  renameClip: (id, name) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, name } : c))
    })),
  setClipRange: (id, startSec, endSec) => {
    const duration = get().source?.probe.duration ?? endSec
    const safeStart = clamp(startSec, 0, duration)
    const safeEnd = clamp(endSec, safeStart, duration)
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === id ? { ...c, startSec: safeStart, endSec: safeEnd } : c
      )
    }))
  },
  setClipStart: (id, startSec) => {
    const clip = get().clips.find((c) => c.id === id)
    if (!clip) return
    get().setClipRange(id, startSec, Math.max(clip.endSec, startSec + 0.1))
  },
  setClipEnd: (id, endSec) => {
    const clip = get().clips.find((c) => c.id === id)
    if (!clip) return
    get().setClipRange(id, Math.min(clip.startSec, endSec - 0.1), endSec)
  },
  togglePreset: (id, preset) =>
    set((state) => ({
      clips: state.clips.map((c) => {
        if (c.id !== id) return c
        const has = c.selectedPresets.includes(preset)
        return {
          ...c,
          selectedPresets: has
            ? c.selectedPresets.filter((p) => p !== preset)
            : [...c.selectedPresets, preset]
        }
      })
    })),
  setSelectedPresets: (id, presets) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, selectedPresets: presets } : c))
    })),
  setClipCrop: (id, cropRect) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, cropRect } : c))
    })),
  addTextOverlay: (id, overlay) =>
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === id
          ? { ...c, textOverlays: [...c.textOverlays, { ...overlay, id: nanoid(8) }] }
          : c
      )
    })),
  updateTextOverlay: (clipId, overlayId, patch) =>
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              textOverlays: c.textOverlays.map((o) =>
                o.id === overlayId ? { ...o, ...patch } : o
              )
            }
          : c
      )
    })),
  removeTextOverlay: (clipId, overlayId) =>
    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === clipId
          ? { ...c, textOverlays: c.textOverlays.filter((o) => o.id !== overlayId) }
          : c
      )
    }))
}))
