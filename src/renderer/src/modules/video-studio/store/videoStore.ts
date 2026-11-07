import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { VideoProbe } from '@shared/api'
import { DEFAULT_COLOR_GRADE, MIN_CLIP_SEC, clipSpeed, floorRange } from '@shared/clip'
import type { Clip, ColorGrade, CropRect, PlatformId, TextOverlay } from '@shared/clip'
import { newTextOverlay, normalizeOverlayPatch } from '@shared/textOverlay'
import type { CaptionSegment } from '@shared/captions'
import type { ChatPeak } from '@shared/chatPeaks'
import type { AudioCandidate } from '@shared/highlights'
import { countOf } from '@shared/plural'
import { joinList } from '../../audio-studio/audioClose'

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
 * T-172 (2): ONE identity for "the same video" - the original file the person opened (`convertedFrom ?? filePath`), the name `fileName` shows and the
 * path a saved project stores. NOT `filePath`: a converted import's working copy is `<base>-<nanoid8>.mp4`, new on every open, so stream.flv closed and
 * opened again is a different `filePath` and the same video. Every "is this job's video the open one" question asks this; `filePath` stays for what
 * goes to main (a job reads the working copy).
 */
export function videoKey(source: Pick<VideoSource, 'filePath' | 'convertedFrom'>): string {
  return source.convertedFrom ?? source.filePath
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

/**
 * T-173 (4): each video's transcript - the `.srt` path, the segments the Captions panel previews, and the probe duration they were made at - kept by `videoKey`
 * for the session (module-level: it outlives `clearSource`, which is the point, and is gone with the renderer). Close does not ask about a transcript because it
 * is not a loss, and it is not a loss because `loadSource` gives it back to the same video (same key, duration within `SAME_FILE_SEC`); a saved project, or the
 * autosave, keeps the path across a restart. Written by whatever stores either value for the OPEN video; emptied by Clear transcripts, which deletes the files.
 * simplification: unbounded for the session (a transcript is a few hundred KB at three hours); a cap with eviction is the upgrade if that ever shows.
 */
const heldTranscripts = new Map<string, { srtPath: string | null; transcript: DerivedResults['transcript']; duration: number }>()

/** The probe of one file can differ by a few frames between reads; a replaced file differs by far more. */
const SAME_FILE_SEC = 0.5

function heldFor(source: Pick<VideoSource, 'filePath' | 'convertedFrom'>, duration: number): { srtPath: string | null; transcript: DerivedResults['transcript'] } | null {
  const held = heldTranscripts.get(videoKey(source))
  return held && Math.abs(held.duration - duration) <= SAME_FILE_SEC ? held : null
}

/** Write-through for the open video: merge a changed `srtPath` and/or `transcript` into what is held for it. Nothing left (no path, no segments) removes the entry. */
function holdTranscript(source: VideoSource | null, patch: { srtPath?: string | null; transcript?: DerivedResults['transcript'] }): void {
  if (source === null || (patch.srtPath === undefined && patch.transcript === undefined)) return
  const held = heldFor(source, source.probe.duration)
  const srtPath = patch.srtPath !== undefined ? patch.srtPath : (held?.srtPath ?? null)
  const transcript = patch.transcript !== undefined ? patch.transcript : (held?.transcript ?? null)
  if (srtPath === null && transcript === null) heldTranscripts.delete(videoKey(source))
  else heldTranscripts.set(videoKey(source), { srtPath, transcript, duration: source.probe.duration })
}

/**
 * T-174 (5): hold a transcript for a video that is NOT the open one - a run that finished after its video was closed or replaced. Written straight into
 * `heldTranscripts` (the same entry shape, so `loadSource` gives it back under the same duration rule): `duration` is the probe duration the run STARTED on,
 * read before the minutes of whisper, because the open video's probe is not the one that was transcribed. Replaces what was held for that key (the newest run wins,
 * as for the open video); a run with no path and no segments is not an entry.
 */
export function holdTranscriptFor(key: string, entry: { srtPath: string | null; transcript: DerivedResults['transcript']; duration: number }): void {
  if (entry.srtPath === null && entry.transcript === null) heldTranscripts.delete(key)
  else heldTranscripts.set(key, entry)
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
  /** T-173 (4): Clear transcripts deleted every transcript file, so none comes back with its video any more. Leaves the open video's own state to `setSrtPathFor` / `setDerived`. */
  forgetHeldTranscripts: () => void
  /** T-112 — apply a transcription's SRT to the video it was made from, and only
   *  to it. `videoKey` is the `videoKey(source)` the job started on (T-172 (2): the original the person opened, so a converted import re-opened
   *  meanwhile is still that video); if the studio holds anything else by the time the job finishes (another video opened, or none)
   *  nothing is stored and the answer is false. `null` forgets the transcript (T-128 (3): "Clear
   *  saved transcripts" deleted the file), under the same rule. */
  setSrtPathFor: (videoKey: string, srtPath: string | null) => boolean
  /** T-135 (2) - play a converted copy of the open video in the preview. Like `setSrtPathFor`, the copy belongs to the video it was made for: if
   *  that file is no longer the open one nothing is stored and the answer is false. `source` is not replaced (see `previewUrl`). */
  setPreviewCopyFor: (videoKey: string, copyPath: string, resumeAt?: number) => boolean
  /** T-136 (6): the Player reports whether the element can draw the picture. */
  setNoPicture: (noPicture: boolean) => void
  /** T-136 (2): the playhead to put the new preview element back at - once. Null when nothing is waiting. */
  takePreviewResume: () => number | null
  /** T-135 (4) - patch the derived results of the open video (typing in a chat box). */
  setDerived: (patch: Partial<DerivedResults>) => void
  /** T-135 (4) - patch them with a RESULT, for the video the job started on and only that one (T-112's rule): false, and nothing stored, when it is no
   *  longer the open video (`videoKey`, as `setSrtPathFor`: the same original re-opened is still it). A scan that finishes after the video was replaced is for a video that is gone. */
  setDerivedFor: (videoKey: string, patch: Partial<DerivedResults>) => boolean

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

/** What `videoSessionHasLoss` and `videoDiscardMessage` read: the slice of the store that says what Close or a replace would throw away. */
type VideoSessionView = Pick<VideoStudioState, 'source' | 'clips' | 'history' | 'derived'>

/**
 * T-147 (3): is there anything in the open video that Close (or a replace) would throw away and that took the person time? `clearSource` / `loadSource` empty
 * these, so this is the list of what counts:
 *  - clips beyond the one `loadSource` made, or that one clip changed from the whole-video clip (`isPristineWholeVideoClip`: a trim, a rename, a crop, an
 *    overlay, a grade, speed, auto zoom, hype shake, a platform choice);
 *  - an undo history with a step in it (`history.past`): edits made and undone back to the start are still a session, and the steps go too;
 *  - a highlight scan's candidates (`derived.scanCandidates`, minutes of work), a chat log pasted into either finder (`highlightChat`, `spikeChat`) and the
 *    spikes found in one (`derived.spikes`).
 * What does NOT count: the transcript (`derived.transcript`, `srtPath`) - `loadSource` gives it back to the same video (`heldTranscripts`; a saved project or the
 * autosave keeps it across a restart) - the output preview (`previewUrl`,
 * a render a button makes again) and the playhead. A video nobody touched has none of the above, so closing it is no loss and asks nothing (T-119 (3)'s own
 * "asking nothing when there is nothing to lose": it was implemented as "zero clips", a state a loaded video never has).
 */
export function videoSessionHasLoss(state: VideoSessionView): boolean {
  const { source, clips, history, derived } = state
  if (source === null || clips.length === 0) return false
  if (clips.length > 1 || !isPristineWholeVideoClip(clips[0]!, source.probe.duration)) return true
  if (history.past.length > 0) return true
  return derived.scanCandidates !== null || derived.spikes !== null || derived.highlightChat !== '' || derived.spikeChat !== ''
}

/**
 * T-119: the question asked before the video being edited goes away, or null when there is nothing to ask. Close asks it
 * (`'close'`, since round 18); Record's "Edit in Video Studio" asks it before it replaces the open video
 * (`'replace'`: nothing is being closed when a button on a recording loads another file, T-113's
 * lead-in for Clean audio). The same list in both so neither studio can say less than the other. `jobsNote` (T-144) is the one sentence Close adds while
 * a long job is running; Record's replace passes none (the new video's own panels draw the running job).
 *
 * T-147 (3): it asks about what is lost (`videoSessionHasLoss`), not about whether a video is open: a video nobody touched has nothing to lose and Close
 * just closes it. A running job is a question by itself then - the lead-in and the one sentence, the shape Audio Studio's Close has (T-146). No video open
 * (no clips) is asked nothing.
 */
export function videoDiscardMessage(state: VideoSessionView, lead: 'close' | 'replace' = 'close', jobsNote: string | null = null): string | null {
  const clipCount = state.clips.length
  if (clipCount <= 0) return null
  const leadIn = lead === 'close' ? 'Close this video?' : "Replace the video you're editing?"
  if (!videoSessionHasLoss(state)) return jobsNote ? `${leadIn} ${jobsNote}` : null
  // T-161 (5): name what is lost, as Audio Studio's Close does. The clips and their edits are named only when the clips are not the one untouched whole-video clip
  // (a person who ran the highlight scan and edited nothing was told their edits go); then the scan, the log, the spikes; the undo history only when it is the one loss.
  const { source, clips, history, derived } = state
  const parts: string[] = []
  if (clips.length > 1 || !isPristineWholeVideoClip(clips[0]!, source!.probe.duration)) {
    // T-120: "1 clip and their edits" read wrong at one. The possessive agrees with the count, like the noun.
    parts.push(`${countOf(clipCount, 'clip')} and ${clipCount === 1 ? 'its' : 'their'} edits`)
  }
  if (derived.scanCandidates !== null) parts.push("the scan's results")
  if (derived.highlightChat !== '' || derived.spikeChat !== '') parts.push('the pasted chat log')
  if (derived.spikes !== null) parts.push('the chat spikes found')
  if (parts.length === 0 && history.past.length > 0) parts.push('your undo history')
  const list = joinList(parts)
  const base = `${leadIn} ${list.charAt(0).toUpperCase()}${list.slice(1)} will be discarded.`
  // T-144: Close takes the panels away and leaves the jobs running; `jobsNote` is the sentence that says so (null when nothing is running).
  return jobsNote ? `${base} ${jobsNote}` : base
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

/** The shortest clip any range edit makes (s): a scanner add with less than this left in the video is refused (T-131 (3)), and applyRange keeps it between In and Out (T-152 (4)). */
const MIN_SCANNED_CLIP_SEC = MIN_CLIP_SEC

/** What `addScannedClip` did (T-94). 'duplicate' (T-150 (3)): a clip with exactly this range is already in the list, so nothing was added. */
export type ScannedClipResult = 'refused' | 'duplicate' | 'added' | 'added-dropped-whole-video'

/** The toast a scanner shows when `addScannedClip` answers 'duplicate' (T-150 (3)). */
export const ALREADY_IN_CLIPS_MESSAGE = 'Already in the Clips list'

/** The toast a scanner shows when `addScannedClip` answers
 *  'added-dropped-whole-video'. Neutral on purpose — nothing was lost, and the
 *  last clause is how to say "no, keep it". */
export const WHOLE_VIDEO_DROPPED_MESSAGE =
  'Removed the whole-video clip now that you have added a clip. Press Ctrl+Z to keep it.'

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
    // T-152 (4): the I and O keys (setClipStart / setClipEnd) reach here with the playhead at the very start or end, which made a clip of
    // no length that every output then refused. The floor is the Timeline drag's own 0.1 s; a source shorter than that keeps the plain clamp
    // (`floorRange`, T-153 (8): the same rule the project restore applies to a saved clip).
    const { startSec: safeStart, endSec: safeEnd } = floorRange(startSec, endSec, duration)
    // T-166 (3): a range the clip already has (I at the mark's own position, a drag that ended where it began) is not an edit, so it pushes no step -
    // removeClip's guard (T-149 (4)) for the same class. An unknown id returns the same way.
    const clip = get().clips.find((c) => c.id === id)
    if (!clip || (clip.startSec === safeStart && clip.endSec === safeEnd)) return
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
    // T-150 (3): the same range twice is one clip. A double-click or a held Enter on "+ Clip" appended identical clips, each with a toast and an undo
    // step. ANY clip with this exact (clamped) range counts, not only one a scan made: clips carry no origin, and a second copy of a clip the person
    // already has is never what "+ Clip" on a candidate means. The untouched whole-video clip is not compared (it is about to be retired).
    if (kept.some((c) => c.startSec === safeStart && c.endSec === safeEnd)) return 'duplicate'
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
      const held = heldFor({ filePath, convertedFrom }, probe.duration)
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
        historyKey: null,
        // T-173 (4): ...except the same video's own transcript, which comes back (`heldTranscripts`): nothing else of `derived`.
        ...(held ? { srtPath: held.srtPath, derived: { ...EMPTY_DERIVED, transcript: held.transcript } } : {})
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
    setSrtPath: (p: string | null) => {
      holdTranscript(get().source, { srtPath: p })
      set({ srtPath: p })
    },
    forgetHeldTranscripts: () => heldTranscripts.clear(),
    setSrtPathFor: (key, srtPath) => {
      const open = get().source
      if (open === null || videoKey(open) !== key) return false
      holdTranscript(open, { srtPath })
      set({ srtPath })
      return true
    },
    setDerived: (patch) => {
      holdTranscript(get().source, { transcript: patch.transcript })
      set({ derived: { ...get().derived, ...patch } })
    },
    setDerivedFor: (key, patch) => {
      const open = get().source
      if (open === null || videoKey(open) !== key) return false
      holdTranscript(open, { transcript: patch.transcript })
      set({ derived: { ...get().derived, ...patch } })
      return true
    },
    setPreviewCopyFor: (key, copyPath, resumeAt) => {
      const open = get().source
      if (open === null || videoKey(open) !== key) return false
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
    setClipSpeed: (id, speedMultiplier) => {
      // T-166 (3): Reset to 1x on a clip at normal speed stores nothing new. "No speed" and 1 are the same speed (`clipSpeed`), so they compare equal.
      const clip = get().clips.find((c) => c.id === id)
      if (!clip || clipSpeed(clip) === clipSpeed({ speedMultiplier })) return
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
      })
    },
    setClipColorGrade: (id, grade) => {
      // T-166 (3): "no grade" (`colorGrade` undefined) is the default grade, so Reset color on an untouched clip compares equal and pushes nothing.
      const clip = get().clips.find((c) => c.id === id)
      if (!clip) return
      const current: ColorGrade = clip.colorGrade ?? DEFAULT_COLOR_GRADE
      if ((Object.keys(current) as Array<keyof ColorGrade>).every((k) => grade[k] === current[k])) return
      // Fired continuously by the grade sliders — coalesce.
      set({
        ...snapshot(`grade:${id}`),
        clips: get().clips.map((c) => (c.id === id ? { ...c, colorGrade: grade } : c))
      })
    },
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
    setClipCrop: (id, cropRect) => {
      // T-166 (3): clearing a crop that is not there (Crop ticked then unticked, Reset with no crop) or storing the rectangle already stored pushes nothing.
      const clip = get().clips.find((c) => c.id === id)
      if (!clip) return
      const had = clip.cropRect
      if (had === cropRect || (had && cropRect && had.x === cropRect.x && had.y === cropRect.y && had.w === cropRect.w && had.h === cropRect.h)) return
      // Fired per mousemove while dragging the reframe rectangle — coalesce.
      set({
        ...snapshot(`crop:${id}`),
        clips: get().clips.map((c) => (c.id === id ? { ...c, cropRect } : c))
      })
    },
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
      // T-166 (3): a commit that stores what the overlay already holds (the Color box retyped as "white" over #ffffff) pushes nothing.
      const current = get().clips.find((c) => c.id === clipId)?.textOverlays.find((o) => o.id === overlayId)
      if (!current || (Object.keys(safe) as Array<keyof TextOverlay>).every((k) => current[k] === safe[k])) return
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
