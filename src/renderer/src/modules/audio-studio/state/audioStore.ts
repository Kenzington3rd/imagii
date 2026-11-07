import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  AudioProbe,
  ChainSpec,
  CutRegion,
  SecondaryTrack,
  WaveformPeaks
} from '@shared/audio'
import { DEFAULT_CHAIN_SPEC, WAVEFORM_READ_FAILED, isWaveformPeaks } from '@shared/audio'
import { isVideoFilename } from '@shared/mediaFormats'
import { reportFailure } from '../../../lib/reportFailure'

export interface AudioSource {
  filePath: string
  /** What the person calls it: for a sound pulled out of a video, the VIDEO's name
   *  (T-108) — `filePath` is a scratch WAV with a random name they never chose. */
  fileName: string
  url: string
  probe: AudioProbe
  /** `videoPath` is the video the sound came from, as the app reads it this session.
   *  `convertedFrom` (T-107) is the ORIGINAL when that video is itself the mp4 working
   *  copy of an imported flv/wmv/...: the working copy is scratch, the original is not,
   *  and a saved project stores the original. */
  fromVideo: { videoPath: string; convertedFrom?: string } | null
  /** The file a scratch WAV was extracted from when that file is NOT a video (T-125 (7)): an AIFF, a WMA - audio WebAudio cannot
   *  decode, which the importer pulls through the same extraction a video's sound takes. It is not `fromVideo` (there is no picture
   *  to re-attach to, and Video Studio refuses it), but it is what the header names, what Export suggests a name from and what a
   *  saved project stores, to be extracted again. Null for a video's sound (that is `fromVideo`) and for a file loaded as it is. */
  extractedFrom: string | null
}

interface History {
  past: ChainSpec[]
  future: ChainSpec[]
}

/** T-129: the peaks job drawing the open file's waveform, while it runs: its id (what Close cancels) and how much it has read. */
export interface WaveformDrawing {
  jobId: string
  percent: number
}

interface AudioStudioState {
  source: AudioSource | null
  /** T-129: the open file's waveform, from main's peaks job; null until it is drawn (and with no file open). */
  waveform: WaveformPeaks | null
  /** T-129: the peaks job while it runs, null otherwise. The waveform panel shows its percent where the waveform will be. */
  drawing: WaveformDrawing | null
  chain: ChainSpec
  history: History
  /** T-147 (T-78): the key of the gesture (a slider drag, a run of arrow keys) whose first edit already pushed its step, or null. A coalescible edit with the SAME key
   *  pushes nothing, so one drag is one undo step; discrete edits, undo / redo, load / clear and `endGesture` reset it. The video store's `historyKey`. */
  historyKey: string | null
  currentTime: number
  loading: boolean

  /** `extractedFromPath`: the file `filePath` (a scratch WAV) was extracted from. A VIDEO makes it `fromVideo`; anything else
   *  (an AIFF, a WMA) makes it `extractedFrom` (T-125 (7)) - the one decision, `isPicture`, made here for every caller.
   *  `hasVideo` (T-126 (7)) is what the extraction's probe found in the file's STREAMS: true or false decides, and only null or
   *  undefined (the probe could not read the file, or nobody asked) leaves it to the extension.
   *  T-129: it resolves once the file is OPEN; its waveform is drawn after that, by main's peaks job (`drawing`, then `waveform`).
   *  T-132 (11): and it resolves WITH the source it opened, so a caller can ask `waveformArrived(source)` about exactly that file even if
   *  main has refused it (and the studio let go of it) by the time the caller looks. */
  loadSource: (filePath: string, extractedFromPath?: string, convertedFrom?: string, hasVideo?: boolean | null) => Promise<AudioSource>
  clearSource: () => void
  setCurrentTime: (t: number) => void

  /** `key` names the control a slider belongs to ('gain', 'denoise.nf'): consecutive patches with the same key are ONE history step. No key (a checkbox, a select,
   *  a button) is always a step of its own. */
  patchChain: (patch: Partial<ChainSpec>, key?: string) => void
  addCutRegion: (region: CutRegion) => void
  removeCutRegion: (index: number) => void
  /** Always a step of its own, except for a slider of the second track, which passes the control's `key` as `patchChain` does. */
  setSecondaryTrack: (track: SecondaryTrack | null, key?: string) => void
  /** Close the coalescing window: the panels call it on pointer up and on blur, so the next drag (or the next run of arrow keys) is a new step. */
  endGesture: () => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/** Does the file a sound was taken from have a picture to put it back on? The probe's reading of its streams, else its extension. */
export function isPicture(extractedFromPath: string, hasVideo: boolean | null | undefined): boolean {
  return hasVideo ?? isVideoFilename(extractedFromPath)
}

/**
 * T-172 Track C (7): which sound this is - the file the person OPENED, the identity "the same sound" means. A video's sound and an AIFF / WMA are played from a
 * fresh `<nanoid10>.wav` extracted on every open (main/audio/extract.ts), so `filePath` is the open's, not the sound's: re-opening the same file is a new
 * `filePath`. The original of a converted import wins over its working copy (the name `fileName` shows and a project saves). Anything that asks "is this job's
 * sound the open one" compares this; the real scratch path stays `filePath`, for what reads the audio (the export input, the mux).
 */
export function soundKey(source: Pick<AudioSource, 'filePath' | 'fromVideo' | 'extractedFrom'>): string {
  return source.fromVideo?.convertedFrom ?? source.fromVideo?.videoPath ?? source.extractedFrom ?? source.filePath
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

/** Stop a peaks job nobody wants any more (the file was closed, or another one opened while it was drawing). */
function stopDrawing(drawing: WaveformDrawing | null): void {
  if (drawing) window.api.audio.cancel(drawing.jobId).catch(() => undefined)
}

/**
 * T-129 (T-110 (ao)): draw `source`'s waveform from main's peaks job. The renderer used to hand wavesurfer the file and let it
 * decode the WHOLE thing with WebAudio (3.25 GB of renderer memory for a 1 h WAV), which is why T-123 refused anything over two
 * hours; main now reads the sound as a stream and answers `PEAK_BUCKETS` pairs, whatever the length, and the studio is open
 * while it does (the panel shows how far it has read). A file main cannot read is REFUSED: the studio lets go of it and the
 * person reads the finished sentence (`WAVEFORM_READ_FAILED`, or the cause `userFacingError` knows, such as a file that moved).
 * A job whose file was closed or replaced meanwhile answers nobody: its cancel was the person's own Close or open.
 */
async function drawWaveform(source: AudioSource, jobId: string): Promise<void> {
  const { getState, setState } = useAudioStore
  const off = window.api.audio.onPeaksProgress((p) => {
    const drawing = getState().drawing
    if (p.jobId === jobId && drawing?.jobId === jobId && p.percent > drawing.percent) {
      setState({ drawing: { jobId, percent: p.percent } })
    }
  })
  try {
    const answer = await window.api.audio.peaks(source.filePath, jobId)
    if (!isWaveformPeaks(answer)) throw new Error(WAVEFORM_READ_FAILED)
    if (getState().source !== source) return
    setState({ waveform: answer, drawing: null })
  } catch (err) {
    if (getState().source !== source) return
    setState({ source: null, waveform: null, drawing: null, chain: DEFAULT_CHAIN_SPEC, history: { past: [], future: [] }, historyKey: null, currentTime: 0 })
    reportFailure(err, { failed: "Couldn't draw the waveform." })
  } finally {
    off()
  }
}

/**
 * The state fields to spread into an edit's `set()`: this edit's step in the history, unless it is the continuation of a gesture. `key` null is a discrete edit (always
 * a step, and it closes any window); a key that matches `historyKey` pushes nothing, because the first event of the gesture already captured the state before it.
 */
function snapshot({ history, historyKey, chain }: AudioStudioState, key: string | null): Partial<AudioStudioState> {
  if (key !== null && key === historyKey) return {}
  return { history: pushHistory(history, chain), historyKey: key }
}

/**
 * The same value for the record (T-169 (2); the model is canvasStore's T-167 `sameValue`, which handles lists only): identical, or two lists / two plain
 * objects (`denoiseParams`, a `secondaryTrack`, a `cutRegions` entry) holding the same values under the same keys. A local twin, not a shared helper:
 * the canvas store would need to import it too for it to earn a place in `shared/`.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  return [...keys].every((k) => sameValue(x[k], y[k]))
}

/** What the chain MEANS by a field, so two spellings of one meaning compare equal: no second track is `null` or absent (every reader tests `!= null`), and a chain saved
 *  before 50 Hz existed has no `humHz` and was always 60. */
function meant(field: string, value: unknown): unknown {
  if (field === 'secondaryTrack') return value ?? null
  if (field === 'humHz') return value ?? 60
  return value
}

export const useAudioStore = create<AudioStudioState>((set, get) => ({
  source: null,
  waveform: null,
  drawing: null,
  chain: DEFAULT_CHAIN_SPEC,
  history: { past: [], future: [] },
  historyKey: null,
  currentTime: 0,
  loading: false,

  loadSource: async (filePath, extractedFromPath, convertedFrom, hasVideo) => {
    set({ loading: true })
    try {
      // T-125 (7): a sound taken out of a video is "from a video"; one taken out of an AIFF or a WMA is not (nothing to re-attach to).
      // T-126 (7): and so is one taken out of an `.mkv` or `.mp4` that holds sound alone - the streams decide, the name only when the
      // probe could not say. `fromVideo` is what turns Re-attach on, and a mux onto a file with no picture fails on `-map 0:v:0`.
      const fromVideoPath =
        extractedFromPath !== undefined && isPicture(extractedFromPath, hasVideo) ? extractedFromPath : undefined
      const extractedFrom = extractedFromPath !== undefined && fromVideoPath === undefined ? extractedFromPath : null
      const probe = await window.api.audio.probe(filePath)
      // T-129: no length gate. T-123 refused a file over two hours here, in a sentence naming the limit, because the waveform was
      // decoded in this process; it is drawn from main's peaks now (`drawWaveform`), and the ceiling is retired.
      const url = window.api.video.fileUrl(filePath)
      const source: AudioSource = {
        filePath,
        fileName: fileNameFromPath(convertedFrom ?? fromVideoPath ?? extractedFrom ?? filePath),
        url,
        probe,
        fromVideo: fromVideoPath
          ? { videoPath: fromVideoPath, ...(convertedFrom ? { convertedFrom } : {}) }
          : null,
        extractedFrom
      }
      stopDrawing(get().drawing)
      const jobId = nanoid(10)
      set({
        source,
        waveform: null,
        drawing: { jobId, percent: 0 },
        chain: DEFAULT_CHAIN_SPEC,
        history: { past: [], future: [] },
        historyKey: null,
        currentTime: 0
      })
      void drawWaveform(source, jobId)
      return source
    } finally {
      set({ loading: false })
    }
  },
  clearSource: () => {
    // T-129: a file closed while its waveform is still drawing stops the job (main kills its ffmpeg).
    stopDrawing(get().drawing)
    set({
      source: null,
      waveform: null,
      drawing: null,
      chain: DEFAULT_CHAIN_SPEC,
      history: { past: [], future: [] },
      historyKey: null,
      currentTime: 0
    })
  },
  setCurrentTime: (t) => set({ currentTime: t }),

  patchChain: (patch, key) => {
    const prev = get().chain
    // T-169 (2): an edit that changes nothing is nothing to undo, and a step that changes nothing would also empty Redo (the class of `videoStore` T-166 (3) and
    // `canvasStore.updateLayer` T-167 (2)). A click on the already-pressed "Off", or a preset / Fix wizard Apply that sets what is already set, patches the chain's own
    // values back: nothing moves, not the chain, not the history, not the coalescing key (a drag's repeat of its last value must not close its window either).
    const record = prev as unknown as Record<string, unknown>
    if (Object.entries(patch).every(([field, value]) => sameValue(meant(field, value), meant(field, record[field])))) return
    set({ chain: { ...prev, ...patch }, ...snapshot(get(), key ?? null) })
  },
  addCutRegion: (region) => {
    const prev = get().chain
    set({ chain: { ...prev, cutRegions: [...prev.cutRegions, region] }, ...snapshot(get(), null) })
  },
  removeCutRegion: (index) => {
    const prev = get().chain
    set({ chain: { ...prev, cutRegions: prev.cutRegions.filter((_, i) => i !== index) }, ...snapshot(get(), null) })
  },
  setSecondaryTrack: (track, key) => {
    const prev = get().chain
    set({ chain: { ...prev, secondaryTrack: track }, ...snapshot(get(), key ?? null) })
  },
  endGesture: () => {
    // Cheap no-op with no window open: it runs on every pointer-up in three panels, and writing the same null back would wake every subscriber for nothing.
    if (get().historyKey === null) return
    set({ historyKey: null })
  },

  // `undo` closes the window; `redo` needs no such reset: an edit clears the redo branch, so a redo never meets an open one.
  undo: () => {
    const { history, chain } = get()
    if (history.past.length === 0) return
    const last = history.past[history.past.length - 1]!
    set({
      chain: last,
      history: {
        past: history.past.slice(0, -1),
        future: [chain, ...history.future]
      },
      historyKey: null
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

/**
 * T-132 (11): did `source`'s waveform come, or did the studio let go of the file first? `loadSource` resolves once the file is OPEN and
 * its waveform is read after that (T-129), so "the file opened" no longer means "main could read it": an unknown WAV format opens, then is
 * refused when the peaks job fails, and the importer's green "Loaded" and its Recent entry had already landed. Whoever celebrates a file
 * (the importer, the project open) asks this first: true when this exact source's waveform is in the store, false once the studio no
 * longer holds it (the refusal, Close, another file opened). Never rejects; resolves at once when the answer is already known.
 */
export function waveformArrived(source: AudioSource): Promise<boolean> {
  const settled = (state: AudioStudioState): boolean | null => (state.source !== source ? false : state.waveform ? true : null)
  const now = settled(useAudioStore.getState())
  if (now !== null) return Promise.resolve(now)
  return new Promise((resolve) => {
    const off = useAudioStore.subscribe((state) => {
      const verdict = settled(state)
      if (verdict === null) return
      off()
      resolve(verdict)
    })
  })
}
