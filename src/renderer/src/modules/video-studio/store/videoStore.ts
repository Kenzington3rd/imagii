import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { VideoProbe } from '@shared/api'
import type { Clip, ColorGrade, CropRect, PlatformId, TextOverlay } from '@shared/clip'

export interface VideoSource {
  filePath: string
  fileName: string
  url: string
  probe: VideoProbe
}

/** One undo step: the clip-editing state as it was before a mutation.
 *  selectedClipId travels with the clips so undoing a removal also
 *  restores which clip was active — the pair is always captured
 *  atomically, so the selection can never dangle after undo/redo. */
interface ClipsSnapshot {
  clips: Clip[]
  selectedClipId: string | null
}

interface History {
  past: ClipsSnapshot[]
  future: ClipsSnapshot[]
}

interface VideoStudioState {
  source: VideoSource | null
  currentTime: number
  /** A seek asked for by a scrubbing surface (the Timeline track's click,
   *  drag, and arrow keys). The Player owns the `<video>`, so it is the one
   *  that applies it — this is the only channel between them. A FRESH object
   *  every call: identity is the signal, so two requests for the same second
   *  both reach the media element. null until something scrubs. */
  seekRequest: { seconds: number } | null
  clips: Clip[]
  selectedClipId: string | null
  /** Path to a transcribed SRT file from a prior captions run for the
   *  current source. Persisted across sessions via the project schema
   *  (videoStudio.srtPath). null when no transcription has been done. */
  srtPath: string | null
  /** Undo history for clip edits (UX round 18). Same shape and cap as
   *  audioStore/canvasStore so useGlobalUndo can treat all three studios
   *  uniformly. Source load/clear resets it rather than snapshotting. */
  history: History
  /** Coalescing marker for high-frequency actions ("<action>:<clipId>").
   *  While consecutive mutations carry the same key (a trim drag firing
   *  setClipRange per mousemove, a speed slider, typing a name), only the
   *  first pushes a snapshot — so one drag equals one undo step. Discrete
   *  actions and undo/redo reset it to null. */
  historyKey: string | null

  loadSource: (filePath: string) => Promise<void>
  clearSource: () => void
  setCurrentTime: (t: number) => void
  requestSeek: (seconds: number) => void
  setSrtPath: (p: string | null) => void

  addClip: () => void
  /** True when a clip was actually added, false when the range was refused
   *  (no source, non-finite, reversed, or collapsed after clamping). The
   *  panels that call it report success from this answer rather than
   *  assuming one — a refusal used to be silent while the caller toasted
   *  "Clip added" anyway (T-48). */
  addClipFromRange: (name: string, startSec: number, endSec: number) => boolean
  removeClip: (id: string) => void
  selectClip: (id: string) => void
  renameClip: (id: string, name: string) => void
  setClipRange: (id: string, startSec: number, endSec: number) => void
  setClipStart: (id: string, startSec: number) => void
  setClipEnd: (id: string, endSec: number) => void
  togglePreset: (id: string, preset: PlatformId) => void
  setSelectedPresets: (id: string, presets: PlatformId[]) => void
  /** T-50 — queue / unqueue a saved custom preset on one clip. Mirrors
   *  `togglePreset`; the two lists are separate because one holds platform
   *  ids and the other holds preset ids that only exist on disk. */
  toggleCustomPreset: (id: string, presetId: string) => void
  /** T-50 — drop every queued custom-preset id that is no longer on disk.
   *  Called whenever the saved list is (re)read, which is what makes a
   *  deleted preset stop being an export target on every clip at once. */
  pruneCustomPresets: (existingIds: ReadonlyArray<string>) => void
  setClipSpeed: (id: string, speedMultiplier: number) => void
  setClipColorGrade: (id: string, grade: ColorGrade) => void
  setClipAutoZoom: (id: string, on: boolean) => void
  setClipHypeShake: (id: string, on: boolean) => void
  setClipCrop: (id: string, cropRect: CropRect | null) => void
  addTextOverlay: (id: string, overlay: Omit<TextOverlay, 'id'>) => void
  updateTextOverlay: (clipId: string, overlayId: string, patch: Partial<TextOverlay>) => void
  removeTextOverlay: (clipId: string, overlayId: string) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
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

const HISTORY_LIMIT = 50

function pushHistory(history: History, snapshot: ClipsSnapshot): History {
  const past = [...history.past, snapshot]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: []
  }
}

const EMPTY_HISTORY: History = { past: [], future: [] }

export const useVideoStore = create<VideoStudioState>((set, get) => {
  /** Snapshot the current clip state into history before a mutation.
   *  Returns the state fields to spread into the mutating set() call.
   *  `key` null = discrete action (always pushes, resets coalescing);
   *  non-null = coalescible action (skips the push while the previous
   *  mutation carried the same key — the first event of the gesture
   *  already captured the pre-gesture state). */
  function snapshot(key: string | null): Partial<VideoStudioState> {
    const { history, historyKey, clips, selectedClipId } = get()
    if (key !== null && key === historyKey) return {}
    return {
      history: pushHistory(history, { clips, selectedClipId }),
      historyKey: key
    }
  }

  function applyRange(id: string, startSec: number, endSec: number, key: string): void {
    const duration = get().source?.probe.duration ?? endSec
    const safeStart = clamp(startSec, 0, duration)
    const safeEnd = clamp(endSec, safeStart, duration)
    set({
      ...snapshot(key),
      clips: get().clips.map((c) =>
        c.id === id ? { ...c, startSec: safeStart, endSec: safeEnd } : c
      )
    })
  }

  return {
    source: null,
    currentTime: 0,
    seekRequest: null,
    clips: [],
    selectedClipId: null,
    srtPath: null,
    history: EMPTY_HISTORY,
    historyKey: null,

    loadSource: async (filePath: string) => {
      const probe = await window.api.video.probe(filePath)
      const url = window.api.video.fileUrl(filePath)
      const initial = makeDefaultClip(probe.duration, 1)
      // Loading a new source invalidates any prior SRT — captions belong
      // to the previous video, not this one. It also resets undo history:
      // steps recorded against the old source's duration make no sense here.
      set({
        source: {
          filePath,
          fileName: fileNameFromPath(filePath),
          url,
          probe
        },
        currentTime: 0,
        seekRequest: null,
        clips: [initial],
        selectedClipId: initial.id,
        srtPath: null,
        history: EMPTY_HISTORY,
        historyKey: null
      })
    },
    clearSource: () =>
      set({
        source: null,
        currentTime: 0,
        seekRequest: null,
        clips: [],
        selectedClipId: null,
        srtPath: null,
        history: EMPTY_HISTORY,
        historyKey: null
      }),
    setCurrentTime: (t: number) => set({ currentTime: t }),
    requestSeek: (seconds: number) => {
      // Trust boundary: `seconds` comes from pointer geometry (a click x
      // against a track width that can be 0 mid-layout) and from key handlers
      // doing arithmetic on it, so NaN is reachable — never hand one to a
      // media element.
      if (!Number.isFinite(seconds)) return
      const duration = get().source?.probe.duration ?? 0
      const target = clamp(seconds, 0, duration)
      // currentTime moves with the request rather than waiting for the media
      // element's `timeupdate`: on a long recording a seek can take a moment,
      // and the marker has to stay under the cursor while it does. The next
      // timeupdate reconciles it with where the element actually landed.
      set({ currentTime: target, seekRequest: { seconds: target } })
    },
    setSrtPath: (p: string | null) => set({ srtPath: p }),

    addClip: () => {
      const { source, clips } = get()
      if (!source) return
      const next = makeDefaultClip(source.probe.duration, clips.length + 1)
      set({
        ...snapshot(null),
        clips: [...clips, next],
        selectedClipId: next.id
      })
    },
    addClipFromRange: (name, startSec, endSec) => {
      const { source, clips } = get()
      if (!source) return false
      // Bug-fix (Phase 2.12): callers (auto-highlight finder, chat-spike
      // panel, future scripts) sometimes hand us a reversed range. Reject
      // outright rather than producing a clip with negative duration that
      // breaks export math downstream.
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return false
      if (endSec <= startSec) return false
      const duration = source.probe.duration
      const safeStart = Math.max(0, Math.min(startSec, duration))
      const safeEnd = Math.max(safeStart + 0.1, Math.min(endSec, duration))
      const base = makeDefaultClip(duration, clips.length + 1)
      const next = { ...base, name, startSec: safeStart, endSec: safeEnd }
      set({
        ...snapshot(null),
        clips: [...clips, next],
        selectedClipId: next.id
      })
      return true
    },
    removeClip: (id) => {
      const { clips, selectedClipId } = get()
      const filtered = clips.filter((c) => c.id !== id)
      // Unknown id: nothing mutates, so don't record a phantom undo step.
      if (filtered.length === clips.length) return
      set({
        ...snapshot(null),
        clips: filtered,
        selectedClipId:
          selectedClipId === id ? (filtered[0]?.id ?? null) : selectedClipId
      })
    },
    // Selection is not undoable on its own, but it breaks a coalescing
    // run: after switching clips, the next gesture starts a fresh step.
    selectClip: (id) => set({ selectedClipId: id, historyKey: null }),
    renameClip: (id, name) =>
      // Fired per keystroke by the inline name input — coalesce.
      set({
        ...snapshot(`rename:${id}`),
        clips: get().clips.map((c) => (c.id === id ? { ...c, name } : c))
      }),
    // Fired per mousemove while dragging a timeline handle — coalesce so
    // one drag equals one undo step.
    setClipRange: (id, startSec, endSec) => applyRange(id, startSec, endSec, `range:${id}`),
    setClipStart: (id, startSec) => {
      const clip = get().clips.find((c) => c.id === id)
      if (!clip) return
      applyRange(id, startSec, Math.max(clip.endSec, startSec + 0.1), `start:${id}`)
    },
    setClipEnd: (id, endSec) => {
      const clip = get().clips.find((c) => c.id === id)
      if (!clip) return
      applyRange(id, Math.min(clip.startSec, endSec - 0.1), endSec, `end:${id}`)
    },
    togglePreset: (id, preset) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) => {
          if (c.id !== id) return c
          const has = c.selectedPresets.includes(preset)
          return {
            ...c,
            selectedPresets: has
              ? c.selectedPresets.filter((p) => p !== preset)
              : [...c.selectedPresets, preset]
          }
        })
      }),
    setSelectedPresets: (id, presets) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) => (c.id === id ? { ...c, selectedPresets: presets } : c))
      }),
    toggleCustomPreset: (id, presetId) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) => {
          if (c.id !== id) return c
          const current = c.customPresetIds ?? []
          return {
            ...c,
            customPresetIds: current.includes(presetId)
              ? current.filter((p) => p !== presetId)
              : [...current, presetId]
          }
        })
      }),
    pruneCustomPresets: (existingIds) => {
      const alive = new Set(existingIds)
      const { clips } = get()
      const next = clips.map((c) =>
        c.customPresetIds && c.customPresetIds.some((id) => !alive.has(id))
          ? { ...c, customPresetIds: c.customPresetIds.filter((id) => alive.has(id)) }
          : c
      )
      // Nothing to drop: return without touching state so the panel's
      // refresh-on-mount cannot churn every subscriber.
      if (next.every((c, i) => c === clips[i])) return
      // Deliberately NOT snapshotted into history. This is a reconciliation
      // with what is on disk, not an edit the user made — an undo step here
      // would offer to re-queue a preset whose file is gone, which is the
      // ghost row this prune exists to prevent.
      set({ clips: next })
    },
    setClipSpeed: (id, speedMultiplier) =>
      // Fired continuously by the speed slider — coalesce.
      set({
        ...snapshot(`speed:${id}`),
        clips: get().clips.map((c) =>
          c.id === id
            ? {
                ...c,
                speedMultiplier:
                  Number.isFinite(speedMultiplier) && speedMultiplier > 0
                    ? speedMultiplier
                    : 1
              }
            : c
        )
      }),
    setClipColorGrade: (id, grade) =>
      // Fired continuously by the grade sliders — coalesce.
      set({
        ...snapshot(`grade:${id}`),
        clips: get().clips.map((c) => (c.id === id ? { ...c, colorGrade: grade } : c))
      }),
    setClipAutoZoom: (id, on) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) => (c.id === id ? { ...c, autoZoom: on } : c))
      }),
    setClipHypeShake: (id, on) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) => (c.id === id ? { ...c, hypeShake: on } : c))
      }),
    setClipCrop: (id, cropRect) =>
      // Fired per mousemove while dragging the reframe rectangle — coalesce.
      set({
        ...snapshot(`crop:${id}`),
        clips: get().clips.map((c) => (c.id === id ? { ...c, cropRect } : c))
      }),
    addTextOverlay: (id, overlay) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) =>
          c.id === id
            ? { ...c, textOverlays: [...c.textOverlays, { ...overlay, id: nanoid(8) }] }
            : c
        )
      }),
    updateTextOverlay: (clipId, overlayId, patch) =>
      // Fired per keystroke / per drag-move by the overlay editor — coalesce.
      set({
        ...snapshot(`overlay:${clipId}:${overlayId}`),
        clips: get().clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                textOverlays: c.textOverlays.map((o) =>
                  o.id === overlayId ? { ...o, ...patch } : o
                )
              }
            : c
        )
      }),
    removeTextOverlay: (clipId, overlayId) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) =>
          c.id === clipId
            ? { ...c, textOverlays: c.textOverlays.filter((o) => o.id !== overlayId) }
            : c
        )
      }),

    undo: () => {
      const { history, clips, selectedClipId } = get()
      if (history.past.length === 0) return
      const last = history.past[history.past.length - 1]!
      set({
        clips: last.clips,
        selectedClipId: last.selectedClipId,
        history: {
          past: history.past.slice(0, -1),
          future: [{ clips, selectedClipId }, ...history.future]
        },
        historyKey: null
      })
    },
    redo: () => {
      const { history, clips, selectedClipId } = get()
      if (history.future.length === 0) return
      const next = history.future[0]!
      set({
        clips: next.clips,
        selectedClipId: next.selectedClipId,
        history: {
          past: [...history.past, { clips, selectedClipId }],
          future: history.future.slice(1)
        },
        historyKey: null
      })
    },
    canUndo: () => get().history.past.length > 0,
    canRedo: () => get().history.future.length > 0
  }
})
