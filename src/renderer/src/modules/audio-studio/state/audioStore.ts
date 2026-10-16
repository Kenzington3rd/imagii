import { create } from 'zustand'
import type {
  AudioProbe,
  ChainSpec,
  CutRegion,
  SecondaryTrack
} from '@shared/audio'
import { DEFAULT_CHAIN_SPEC, waveformCeilingRefusal } from '@shared/audio'
import { isVideoFilename } from '@shared/mediaFormats'

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

interface AudioStudioState {
  source: AudioSource | null
  chain: ChainSpec
  history: History
  currentTime: number
  loading: boolean

  /** `extractedFromPath`: the file `filePath` (a scratch WAV) was extracted from. A VIDEO makes it `fromVideo`; anything else
   *  (an AIFF, a WMA) makes it `extractedFrom` (T-125 (7)) - the one decision, `isPicture`, made here for every caller.
   *  `hasVideo` (T-126 (7)) is what the extraction's probe found in the file's STREAMS: true or false decides, and only null or
   *  undefined (the probe could not read the file, or nobody asked) leaves it to the extension. */
  loadSource: (filePath: string, extractedFromPath?: string, convertedFrom?: string, hasVideo?: boolean | null) => Promise<void>
  clearSource: () => void
  setCurrentTime: (t: number) => void

  patchChain: (patch: Partial<ChainSpec>) => void
  addCutRegion: (region: CutRegion) => void
  removeCutRegion: (index: number) => void
  setSecondaryTrack: (track: SecondaryTrack | null) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/** Does the file a sound was taken from have a picture to put it back on? The probe's reading of its streams, else its extension. */
export function isPicture(extractedFromPath: string, hasVideo: boolean | null | undefined): boolean {
  return hasVideo ?? isVideoFilename(extractedFromPath)
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
      // T-123 (14): refused here, before the studio holds the file, so the importer, Clean audio and a restored project
      // all say it in the same sentence and none of them is left holding a source it cannot draw.
      // T-124 (7): a sound that came out of a video is a video's problem (cut it down in Video Studio); a file that was only
      // ever sound is not (Video Studio refuses it), and is told to split it elsewhere.
      const tooLong = waveformCeilingRefusal(probe.duration, fromVideoPath ? 'video' : 'audio')
      if (tooLong) throw new Error(tooLong)
      const url = window.api.video.fileUrl(filePath)
      set({
        source: {
          filePath,
          fileName: fileNameFromPath(convertedFrom ?? fromVideoPath ?? extractedFrom ?? filePath),
          url,
          probe,
          fromVideo: fromVideoPath
            ? { videoPath: fromVideoPath, ...(convertedFrom ? { convertedFrom } : {}) }
            : null,
          extractedFrom
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
