import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { VideoProbe } from '@shared/api'
import { DEFAULT_COLOR_GRADE, clipSpeed } from '@shared/clip'
import type { Clip, ColorGrade, CropRect, PlatformId, TextOverlay } from '@shared/clip'
import { newTextOverlay, normalizeOverlayPatch } from '@shared/textOverlay'
import type { CaptionSegment } from '@shared/captions'
import type { ChatPeak } from '@shared/chatPeaks'
import type { AudioCandidate } from '@shared/highlights'
import { countOf } from '@shared/plural'
import { NON_TEXT_INPUT_TYPES } from '../../../lib/keyOwnership'

export interface VideoSource {
  /** The file the app plays and ffmpeg reads — for a converted import, the mp4 working copy. */
  filePath: string
  /** What the person calls it: the name of the file they dropped, not of the working copy. */
  fileName: string
  url: string
  probe: VideoProbe
  /** T-107: the ORIGINAL file `filePath` was converted from on import, when it was. The
   *  working copy lives under the OS temp folder, which a later launch prunes, so a saved
   *  project stores this path instead and converts again on open. */
  convertedFrom?: string
}

/**
 * What the panels derive from the open video (T-135 (4)): the loud moments a scan found, the chat logs pasted into the two finders and the spikes
 * found in one, and the transcript the Captions panel previews. They were each panel's `useState`, so leaving the studio - or pressing Clean audio,
 * which navigates - threw away a scan that took minutes. They belong to the open video: `loadSource` and `clearSource` empty them, which is exactly
 * the lifetime they need (a different video starts clean, the same one keeps them across any number of visits), so no panel resets them on mount.
 */
export interface DerivedResults {
  /** The highlight scan's candidates; null until a scan has finished for this video. */
  scanCandidates: AudioCandidate[] | null
  /** The chat log pasted into the highlight finder. */
  highlightChat: string
  /** The chat log pasted into the chat spike finder, and the spikes found in it (null: not analyzed). */
  spikeChat: string
  spikes: ChatPeak[] | null
  /** The transcript the Captions panel previews (the file itself is `srtPath`); null until a transcription finished for this video. */
  transcript: CaptionSegment[] | null
}

const EMPTY_DERIVED: DerivedResults = { scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null }

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

/**
 * What the Player lends the rest of the studio (T-120), registered while it is mounted. The Player owns the
 * `<video>`; the Timeline's keys need two things only the element knows.
 */
export interface PlayerTransport {
  /**
   * The element's own `currentTime`, in seconds, or null when there is no element. The store's `currentTime`
   * is written on `timeupdate` (about every 250 ms during playback) and on seeks, so a marker set from it
   * during playback lands up to a quarter second behind the frame on screen; the Player's I / O read the
   * element, and the Timeline's now read it through this.
   */
  readTime: () => number | null
  /** Play if paused, pause if playing: the Player's own toggle, so the two surfaces cannot disagree. */
  togglePlay: () => void
}

/**
 * The playhead as the picture shows it right now (T-120): the Player's element when one is mounted, else the
 * store's `currentTime`, the number the track draws. Both Timeline markers (I / O) read it.
 */
export function playheadNow(state: Pick<VideoStudioState, 'transport' | 'currentTime'>): number {
  return state.transport?.readTime() ?? state.currentTime
}

interface VideoStudioState {
  source: VideoSource | null
  currentTime: number
  /** The Player's handle on its `<video>`, or null when no Player is mounted (T-120). */
  transport: PlayerTransport | null
  /** T-135 (2): the address of a playable COPY of the open video, when the preview cannot decode its picture (ProRes, 10-bit HEVC) and the person
   *  asked for one; null while the element plays the source itself. It replaces only what the `<video>` plays: `source` (the object, the path every
   *  export reads, the probe) is untouched, so the saved project and the exports stay on the original. Cleared with the source. */
  previewUrl: string | null
  /** T-136 (6): the Player's verdict that the preview cannot draw the open video's picture (ProRes, 10-bit HEVC: see `PREVIEW_UNAVAILABLE_MESSAGE`).
   *  The Player owns the `<video>` and hears the element; the Output preview, which mirrors that element onto a canvas, needs the same fact to say why
   *  its canvas is black instead of captioning a black box "Live snapshot". Reset by `loadSource` / `clearSource`; the Player sets it as the element speaks. */
  noPicture: boolean
  /** T-136 (2): where the playhead was when `previewUrl` was swapped in. The new element starts at 0 and its `loadedmetadata` puts it back - and the
   *  Player that hears that event can be a different instance from the one that was mounted when the copy was asked for, so the position cannot be a
   *  ref in the component. Taken (and emptied) by the first element that reads it. */
  previewResumeAt: number | null
  /** T-135 (4): scan results, pasted chat logs and spikes, and the transcript preview - kept with the open video (see `DerivedResults`). */
  derived: DerivedResults
  /** The media element's OWN duration, published by the Player on
   *  `durationchange`. ffprobe reports the container's rounded number and the
   *  decoder has the real one (the E2E fixture probes 2.000 s and decodes
   *  2.020136 s), so anything built on the probe stops ~20 ms short of the end
   *  of the file — which is where the Timeline's right edge used to sit,
   *  leaving the last frames unreachable by click or End (T-56). null until an
   *  element has spoken; every consumer falls back to the probe until then. */
  mediaDuration: number | null
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
   *  actions, undo/redo and `endGesture` reset it to null. */
  historyKey: string | null

  /** `convertedFrom`: the original of a file the importer converted (T-107). */
  loadSource: (filePath: string, convertedFrom?: string) => Promise<void>
  clearSource: () => void
  setCurrentTime: (t: number) => void
  /** The Player registers itself on mount and passes null on unmount (T-120). */
  registerTransport: (transport: PlayerTransport | null) => void
  /** Trust boundary: the element reports NaN before metadata and Infinity for
   *  a live stream, and neither is a duration. Both land as null. */
  setMediaDuration: (seconds: number) => void
  requestSeek: (seconds: number) => void
  setSrtPath: (p: string | null) => void
  /** T-112 — apply a transcription's SRT to the video it was made from, and only
   *  to it. `sourcePath` is the file the job started on; if the studio holds
   *  anything else by the time the job finishes (another video opened, or none)
   *  nothing is stored and the answer is false. `null` forgets the transcript (T-128 (3): "Clear
   *  saved transcripts" deleted the file), under the same rule. */
  setSrtPathFor: (sourcePath: string, srtPath: string | null) => boolean
  /** T-135 (2) - play a converted copy of the open video in the preview. Like `setSrtPathFor`, the copy belongs to the video it was made for: if
   *  that file is no longer the open one nothing is stored and the answer is false. `source` is not replaced (see `previewUrl`). */
  setPreviewCopyFor: (sourcePath: string, copyPath: string, resumeAt?: number) => boolean
  /** T-136 (6): the Player reports whether the element can draw the picture. */
  setNoPicture: (noPicture: boolean) => void
  /** T-136 (2): the playhead to put the new preview element back at - once. Null when nothing is waiting. */
  takePreviewResume: () => number | null
  /** T-135 (4) - patch the derived results of the open video (typing in a chat box). */
  setDerived: (patch: Partial<DerivedResults>) => void
  /** T-135 (4) - patch them with a RESULT, for the video the job started on and only that one (T-112's rule): false, and nothing stored, when it is no
   *  longer the open video. A scan that finishes after the video was replaced is for a video that is gone. */
  setDerivedFor: (sourcePath: string, patch: Partial<DerivedResults>) => boolean

  addClip: () => void
  /** The ONE add-a-clip-from-a-range action (T-101 deleted its manual twin,
   *  `addClipFromRange`, which nothing in the renderer ever called).
   *
   *  T-94 — the highlight scanners' add. If the untouched whole-video clip
   *  that `loadSource` created is still in the list, it steps aside IN THE SAME
   *  ACTION. Someone who scans a VOD for highlights and presses "+ Clip" wants
   *  those excerpts, not the 3-hour original re-encoded beside them in every
   *  export. The answer says which of the three things happened so the caller
   *  can tell the user: 'refused' (nothing changed — no source, non-finite,
   *  reversed, or collapsed after clamping; the caller must not report success
   *  for it, T-48), 'added', or 'added-dropped-whole-video'. One Ctrl+Z restores
   *  the whole-video clip and removes the highlight together. */
  addScannedClip: (name: string, startSec: number, endSec: number) => ScannedClipResult
  removeClip: (id: string) => void
  selectClip: (id: string) => void
  renameClip: (id: string, name: string) => void
  setClipRange: (id: string, startSec: number, endSec: number) => void
  setClipStart: (id: string, startSec: number) => void
  setClipEnd: (id: string, endSec: number) => void
  togglePreset: (id: string, preset: PlatformId) => void
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

  /** T-40 — close the coalescing window. A key alone can only tell "the same
   *  kind of edit as last time" from "a different kind"; it cannot tell one
   *  gesture from the next one just like it, so two consecutive trim drags,
   *  two crop drags, or a slider nudged twice all collapsed into a single
   *  undo step (and a Reset button sharing the key vanished into the drag
   *  before it). The surfaces that own a gesture call this when it ENDS —
   *  Timeline's mouseup, the crop rectangle's drag/resize stop, a slider
   *  release or blur, an in/out marker press — so the next mutation starts a
   *  fresh step even though it carries the same key. */
  endGesture: () => void

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

/**
 * How long the loaded video actually PLAYS — the ceiling for every scrubbing
 * surface (T-56).
 *
 * The media element's own duration is the authority when it has published one
 * (the Player does, on `durationchange`); ffprobe's rounded number is the
 * stand-in until then, and for a source with no element at all. The two differ
 * by a frame or less, which is exactly the gap that made the end of a file
 * unreachable from the Timeline while the Player's own nudge could reach it.
 */
export function playableDuration(
  source: VideoSource | null,
  mediaDuration: number | null
): number {
  if (mediaDuration !== null) return mediaDuration
  return source?.probe.duration ?? 0
}

function defaultClipName(index: number): string {
  return `Clip ${index}`
}

function makeDefaultClip(duration: number, index: number): Clip {
  return {
    id: nanoid(8),
    name: defaultClipName(index),
    startSec: 0,
    endSec: duration,
    cropRect: null,
    textOverlays: [],
    selectedPresets: ['youtube']
  }
}

/**
 * T-119: the question asked before the video being edited goes away, or null when there is nothing to
 * lose. Loading a source always makes at least one clip, so "nothing loaded" is zero clips. Close asks it
 * (`'close'`, since round 18); Record's "Edit in Video Studio" asks it before it replaces the open video
 * (`'replace'`: nothing is being closed when a button on a recording loads another file, T-113's
 * lead-in for Clean audio). The same list in both so neither studio can say less than the other.
 */
export function videoDiscardMessage(clipCount: number, lead: 'close' | 'replace' = 'close'): string | null {
  if (clipCount <= 0) return null
  const leadIn = lead === 'close' ? 'Close this video?' : "Replace the video you're editing?"
  // T-120: "1 clip and their edits" read wrong at one. The possessive agrees with the count, like the noun.
  return `${leadIn} ${countOf(clipCount, 'clip')} and ${clipCount === 1 ? 'its' : 'their'} edits will be discarded.`
}

/** What the panels that need a sound track say when the loaded video has none (T-112). */
export const NO_SOUND_MESSAGE = 'This video has no sound.'

/**
 * T-112 — the loaded video has no audio stream, so cleaning its audio,
 * transcribing it and scanning it for loud moments have nothing to work on. The
 * probe says so with `audioCodec: null`. No video open is not "no sound": the
 * panels that ask are not on screen then.
 */
export function videoHasNoSound(source: Pick<VideoSource, 'probe'> | null): boolean {
  return source !== null && source.probe.audioCodec === null
}

/** The shortest clip a scanner's add makes (s): a range with less than this left in the video is refused (T-131 (3)). */
const MIN_SCANNED_CLIP_SEC = 0.1

/** What `addScannedClip` did (T-94). */
export type ScannedClipResult = 'refused' | 'added' | 'added-dropped-whole-video'

/** The toast a scanner shows when `addScannedClip` answers
 *  'added-dropped-whole-video'. Neutral on purpose — nothing was lost, and the
 *  last clause is how to say "no, keep it". */
export const WHOLE_VIDEO_DROPPED_MESSAGE =
  'Removed the whole-video clip — the highlights are your clips now. Press Ctrl+Z to keep it.'

/**
 * T-94 — is this the whole-video clip `loadSource` made, untouched since?
 *
 * "Pristine" is exact: `makeDefaultClip(duration, 1)` and nothing else. It is
 * the one clip in the list the user never chose to make — loading a file
 * creates it so the editor has something to select — which is what lets a
 * highlight scan retire it without second-guessing anyone. Every field a user
 * could have touched breaks it: a trim, a rename, a crop, an overlay, a grade,
 * speed, auto-zoom, hype-shake, or any change to the platforms it will
 * export to. A field set BACK to its default (speed dragged to 1x again, the
 * grade reset) is the default, and counts as untouched — what matters is what
 * the export would do, and it would do the same.
 */
export function isPristineWholeVideoClip(clip: Clip, durationSec: number): boolean {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false
  const grade = clip.colorGrade
  const gradeUntouched =
    grade === undefined ||
    (grade.brightness === DEFAULT_COLOR_GRADE.brightness &&
      grade.contrast === DEFAULT_COLOR_GRADE.contrast &&
      grade.saturation === DEFAULT_COLOR_GRADE.saturation &&
      grade.temperature === DEFAULT_COLOR_GRADE.temperature)
  return (
    clip.name === defaultClipName(1) &&
    clip.startSec === 0 &&
    clip.endSec === durationSec &&
    !clip.cropRect &&
    clip.textOverlays.length === 0 &&
    gradeUntouched &&
    clipSpeed(clip) === 1 &&
    !clip.autoZoom &&
    !clip.hypeShake &&
    clip.selectedPresets.length === 1 &&
    clip.selectedPresets[0] === 'youtube' &&
    (clip.customPresetIds ?? []).length === 0
  )
}

const HISTORY_LIMIT = 50

/**
 * A new overlay as the store keeps it (T-113): its color run through the same
 * normalization an edit gets — a name becomes hex, and one that is neither falls
 * back to the default — and its size clamped, so what is stored is always what
 * the overlay gates take.
 */
function newOverlay(overlay: Omit<TextOverlay, 'id'>): TextOverlay {
  const base = newTextOverlay(overlay.startSec, overlay.endSec)
  return { ...base, ...normalizeOverlayPatch(overlay), id: nanoid(8) }
}

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

  /** The add-a-clip-from-a-range path behind `addScannedClip`: the guards, the
   *  clamp and the single undo step live here. */
  function appendRange(name: string, startSec: number, endSec: number): ScannedClipResult {
    const { source, clips } = get()
    if (!source) return 'refused'
    // Bug-fix (Phase 2.12): callers (auto-highlight finder, chat-spike
    // panel, future scripts) sometimes hand us a reversed range. Reject
    // outright rather than producing a clip with negative duration that
    // breaks export math downstream.
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 'refused'
    if (endSec <= startSec) return 'refused'
    const duration = source.probe.duration
    // T-131 (3): a range that begins at the end of the video, or past it, has no picture to hold. Clamping it made a clip that
    // STARTED at the duration and ended 0.1 s after it (a stale scanner row, a chat log longer than the video), and the panel said
    // "Clip added". The 0.1 s is the shortest clip this function makes, so a start with less than that left is the same refusal.
    if (duration - startSec < MIN_SCANNED_CLIP_SEC) return 'refused'
    const safeStart = Math.max(0, Math.min(startSec, duration))
    const safeEnd = Math.max(safeStart + MIN_SCANNED_CLIP_SEC, Math.min(endSec, duration))
    const base = makeDefaultClip(duration, clips.length + 1)
    const next = { ...base, name, startSec: safeStart, endSec: safeEnd }
    const kept = clips.filter((c) => !isPristineWholeVideoClip(c, duration))
    // ONE snapshot of the state before either change: the retirement and the
    // add are a single undo step, so Ctrl+Z puts the whole-video clip back and
    // takes the highlight away together (T-94).
    set({
      ...snapshot(null),
      clips: [...kept, next],
      selectedClipId: next.id
    })
    return kept.length < clips.length ? 'added-dropped-whole-video' : 'added'
  }

  return {
    source: null,
    currentTime: 0,
    transport: null,
    mediaDuration: null,
    seekRequest: null,
    clips: [],
    selectedClipId: null,
    srtPath: null,
    history: EMPTY_HISTORY,
    historyKey: null,
    previewUrl: null,
    noPicture: false,
    previewResumeAt: null,
    derived: EMPTY_DERIVED,

    loadSource: async (filePath: string, convertedFrom?: string) => {
      const probe = await window.api.video.probe(filePath)
      const url = window.api.video.fileUrl(filePath)
      const initial = makeDefaultClip(probe.duration, 1)
      // Loading a new source invalidates any prior SRT — captions belong
      // to the previous video, not this one. It also resets undo history:
      // steps recorded against the old source's duration make no sense here.
      set({
        source: {
          filePath,
          // T-107: a converted import is named for the file the person dropped,
          // not for the working copy ("stream-aB3dE5fG.mp4").
          fileName: fileNameFromPath(convertedFrom ?? filePath),
          url,
          probe,
          ...(convertedFrom ? { convertedFrom } : {})
        },
        currentTime: 0,
        // A new file's element duration is unknown until its element loads;
        // carrying the previous file's number over would size the track to the
        // wrong video for as long as the load takes.
        mediaDuration: null,
        seekRequest: null,
        clips: [initial],
        selectedClipId: initial.id,
        srtPath: null,
        previewUrl: null,
        noPicture: false,
        previewResumeAt: null,
        derived: EMPTY_DERIVED,
        history: EMPTY_HISTORY,
        historyKey: null
      })
    },
    clearSource: () =>
      set({
        source: null,
        currentTime: 0,
        mediaDuration: null,
        seekRequest: null,
        clips: [],
        selectedClipId: null,
        srtPath: null,
        previewUrl: null,
        noPicture: false,
        previewResumeAt: null,
        derived: EMPTY_DERIVED,
        history: EMPTY_HISTORY,
        historyKey: null
      }),
    setCurrentTime: (t: number) => set({ currentTime: t }),
    registerTransport: (transport) => set({ transport }),
    setMediaDuration: (seconds: number) =>
      set({
        mediaDuration: Number.isFinite(seconds) && seconds > 0 ? seconds : null
      }),
    requestSeek: (seconds: number) => {
      // Trust boundary: `seconds` comes from pointer geometry (a click x
      // against a track width that can be 0 mid-layout) and from key handlers
      // doing arithmetic on it, so NaN is reachable — never hand one to a
      // media element.
      if (!Number.isFinite(seconds)) return
      // The element's own duration when it has published one (T-56): the
      // probe's rounded number as the ceiling is what stopped a scrub, an End
      // press, and a restored playhead ~20 ms short of the end of the file.
      const duration = playableDuration(get().source, get().mediaDuration)
      const target = clamp(seconds, 0, duration)
      // currentTime moves with the request rather than waiting for the media
      // element's `timeupdate`: on a long recording a seek can take a moment,
      // and the marker has to stay under the cursor while it does. The next
      // timeupdate reconciles it with where the element actually landed.
      set({ currentTime: target, seekRequest: { seconds: target } })
    },
    setSrtPath: (p: string | null) => set({ srtPath: p }),
    setSrtPathFor: (sourcePath, srtPath) => {
      if (get().source?.filePath !== sourcePath) return false
      set({ srtPath })
      return true
    },
    setDerived: (patch) => set({ derived: { ...get().derived, ...patch } }),
    setDerivedFor: (sourcePath, patch) => {
      if (get().source?.filePath !== sourcePath) return false
      set({ derived: { ...get().derived, ...patch } })
      return true
    },
    setPreviewCopyFor: (sourcePath, copyPath, resumeAt) => {
      if (get().source?.filePath !== sourcePath) return false
      set({
        previewUrl: window.api.video.fileUrl(copyPath),
        previewResumeAt: resumeAt !== undefined && Number.isFinite(resumeAt) && resumeAt > 0 ? resumeAt : null
      })
      return true
    },
    setNoPicture: (noPicture) => {
      if (get().noPicture !== noPicture) set({ noPicture })
    },
    takePreviewResume: () => {
      const at = get().previewResumeAt
      if (at !== null) set({ previewResumeAt: null })
      return at
    },

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
    addScannedClip: (name, startSec, endSec) => appendRange(name, startSec, endSec),
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
      // T-137 (11): the field is read as `unknown`: the validator drops a non-list, but the prune runs on every visit to Export with whatever the clips
      // hold, and `.some` on a number threw there. A non-list is removed, and an entry that is not a live string id goes with the ids whose preset is gone.
      const next = clips.map((c) => {
        const ids: unknown = c.customPresetIds
        if (ids === undefined) return c
        if (!Array.isArray(ids)) return { ...c, customPresetIds: undefined }
        // `alive` holds strings, so a number, an object or null in the list is not alive and goes with the ids whose preset is gone.
        const keep = (id: unknown): boolean => alive.has(id as string)
        return ids.every(keep) ? c : { ...c, customPresetIds: ids.filter(keep) as string[] }
      })
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
                speedMultiplier: clipSpeed({ speedMultiplier })
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
            ? { ...c, textOverlays: [...c.textOverlays, newOverlay(overlay)] }
            : c
        )
      }),
    updateTextOverlay: (clipId, overlayId, patch) => {
      // T-113: a color name becomes its hex and a size is clamped HERE, so no
      // writer can leave an overlay the gates refuse.
      const safe = normalizeOverlayPatch(patch)
      // Fired per keystroke / per drag-move by the overlay editor — coalesce.
      set({
        ...snapshot(`overlay:${clipId}:${overlayId}`),
        clips: get().clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                textOverlays: c.textOverlays.map((o) =>
                  o.id === overlayId ? { ...o, ...safe } : o
                )
              }
            : c
        )
      })
    },
    removeTextOverlay: (clipId, overlayId) =>
      set({
        ...snapshot(null),
        clips: get().clips.map((c) =>
          c.id === clipId
            ? { ...c, textOverlays: c.textOverlays.filter((o) => o.id !== overlayId) }
            : c
        )
      }),

    endGesture: () => {
      // Cheap no-op when no window is open: gesture ends are frequent (every
      // pointerup in the studio reaches one) and writing the same null back
      // would notify every subscriber for nothing.
      if (get().historyKey === null) return
      set({ historyKey: null })
    },

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

// The input types whose RELEASE is the end of a gesture (a slider let go, a box ticked, a colour picked) are
// `NON_TEXT_INPUT_TYPES`; anything else - and anything unrecognized, which is also what the DOM reports for a
// missing `type` - is text entry, where the release is a caret being placed and the edit is still going. The
// list lives in `lib/keyOwnership` since T-123 (2): the shortcuts' guards ask the same question.

/**
 * T-80 — does this pointerup end the coalescing window?
 *
 * T-40 put one `onPointerUp` on each editing panel so that releasing ANY
 * control in it closes the window (the alternative was a prop on every
 * control, and a control added later would have been missed). pointerup
 * bubbles, though, and a click inside a text field you are already typing in
 * bubbles exactly the same event: repositioning the caret mid-caption, or
 * double-clicking a word to replace it, ended the edit and split one rename
 * into several undo steps. For a text field the gesture ends on BLUR — the
 * panels keep `onBlur={endGesture}` — so a release inside the focused one is
 * not an end at all.
 *
 * Focus is half the question: only the field the user is typing in is
 * mid-edit. A release over a text input that is NOT focused (a slider drag
 * that happens to finish over one) still ends the gesture it belongs to.
 *
 * Pure and DOM-free on purpose — the three things the decision needs are
 * strings and a boolean, so it is unit-testable under the node vitest config
 * while `handleGestureEndPointerUp` keeps the one line that touches the DOM.
 */
export function endsGestureOnPointerUp(
  tagName: string,
  inputType: string | null,
  isActiveElement: boolean
): boolean {
  if (!isActiveElement) return true
  const tag = tagName.toUpperCase()
  if (tag === 'TEXTAREA') return false
  if (tag !== 'INPUT') return true
  return NON_TEXT_INPUT_TYPES.has((inputType ?? 'text').toLowerCase())
}

/**
 * The panel-level `onPointerUp` for every editing panel that holds text
 * fields (ClipList, TextOverlayEditor). ColorGradePanel has only sliders,
 * checkboxes and a button, so its bare `endGesture` is already correct.
 */
export function handleGestureEndPointerUp(event: ReactPointerEvent<HTMLElement>): void {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target !== null) {
    const type = target instanceof HTMLInputElement ? target.type : null
    if (!endsGestureOnPointerUp(target.tagName, type, target === document.activeElement)) return
  }
  useVideoStore.getState().endGesture()
}
