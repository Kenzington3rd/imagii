import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PEAK_BUCKETS, WAVEFORM_READ_FAILED, type AudioProbe, type WaveformPeaks, type WaveformPeaksProgress } from '@shared/audio'
import { CancelledError } from '@shared/cancel'
import { pathToImagiiFileUrl } from '@shared/fileUrl'

const toasts: Array<{ kind: 'error' | 'plain'; text: string }> = []
vi.mock('react-hot-toast', () => {
  const plain = (text: string): string => {
    toasts.push({ kind: 'plain', text })
    return 'id'
  }
  return {
    default: Object.assign(plain, {
      error: (text: string) => {
        toasts.push({ kind: 'error', text })
        return 'id'
      }
    })
  }
})

const { useAudioStore, isPicture } = await import('./audioStore')

/**
 * T-126 (7): `fromVideo` is what turns Re-attach on, and it was decided by the EXTENSION of the file a sound was taken from. An `.mkv`
 * or `.mp4` that holds sound alone is sent down the video road: Re-attach is on by default for it and fails on `-map 0:v:0`. The
 * extraction's probe reads the streams; `loadSource` takes what it found, and the extension decides only when the probe could not say.
 *
 * T-129: and the waveform is drawn from MAIN's peaks (`audio:peaks`), never decoded here. `loadSource` opens the file and the peaks
 * job draws it after: `drawing` while it reads (the panel shows its percent), `waveform` once it answered. A file main cannot read is
 * refused (the studio lets go of it); a file closed or replaced while it was drawing has its job stopped.
 */
const WAV = '/tmp/imagii-audio/aB3dE5fG7h.wav'
const probeOf = (duration: number): AudioProbe => ({ duration, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
const peaksOf = (duration: number, n = PEAK_BUCKETS): WaveformPeaks => ({
  peaks: [Array.from({ length: n }, () => 0.5), Array.from({ length: n }, () => -0.5)],
  duration
})
let duration = 60

/** One `audio:peaks` call the test answers by hand. */
interface PeaksCall {
  filePath: string
  jobId: string
  resolve: (p: unknown) => void
  reject: (e: unknown) => void
}
let peaksCalls: PeaksCall[] = []
/** When true, `audio:peaks` answers at once with a good waveform of the probed length (most cases). */
let autoAnswer = true
let progressHandlers: Array<(p: WaveformPeaksProgress) => void> = []
const canceled: string[] = []

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  duration = 60
  autoAnswer = true
  peaksCalls = []
  progressHandlers = []
  canceled.length = 0
  toasts.length = 0
  vi.stubGlobal('window', {
    api: {
      audio: {
        probe: () => Promise.resolve(probeOf(duration)),
        peaks: (filePath: string, jobId: string) =>
          autoAnswer
            ? Promise.resolve(peaksOf(duration))
            : new Promise((resolve, reject) => peaksCalls.push({ filePath, jobId, resolve, reject })),
        onPeaksProgress: (handler: (p: WaveformPeaksProgress) => void) => {
          progressHandlers.push(handler)
          return () => {
            progressHandlers = progressHandlers.filter((h) => h !== handler)
          }
        },
        cancel: (jobId: string) => {
          canceled.push(jobId)
          return Promise.resolve(true)
        }
      },
      video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) }
    }
  })
  useAudioStore.getState().clearSource()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isPicture', () => {
  it('the probe\'s answer decides when there is one, in both directions', () => {
    expect(isPicture('/v/podcast.mkv', false)).toBe(false)
    expect(isPicture('/v/podcast.mp4', false)).toBe(false)
    expect(isPicture('/v/odd.wma', true)).toBe(true)
  })

  it('the extension decides only when the probe could not say (null) or nobody asked (undefined)', () => {
    expect(isPicture('/v/stream.mkv', null)).toBe(true)
    expect(isPicture('/v/stream.mp4', undefined)).toBe(true)
    expect(isPicture('/v/pad.aiff', null)).toBe(false)
    expect(isPicture('/v/take.wma', undefined)).toBe(false)
  })
})

describe('loadSource: Re-attach is on only for a file that really has a picture (T-126 (7))', () => {
  it('an .mkv with sound alone loads as extracted-from, with no video to re-attach to', async () => {
    await useAudioStore.getState().loadSource(WAV, '/v/podcast.mkv', undefined, false)
    const source = useAudioStore.getState().source
    expect(source?.fromVideo, 'no picture, no Re-attach').toBeNull()
    expect(source?.extractedFrom, 'the marker for naming and a project\'s re-extract stays').toBe('/v/podcast.mkv')
    expect(source?.fileName).toBe('podcast.mkv')
  })

  it('an .mkv with a picture is a video\'s sound, as it was', async () => {
    await useAudioStore.getState().loadSource(WAV, '/v/stream.mkv', undefined, true)
    const source = useAudioStore.getState().source
    expect(source?.fromVideo).toEqual({ videoPath: '/v/stream.mkv' })
    expect(source?.extractedFrom).toBeNull()
  })

  it('a probe that could not tell leaves the extension to decide, as before', async () => {
    await useAudioStore.getState().loadSource(WAV, '/v/stream.webm', undefined, null)
    expect(useAudioStore.getState().source?.fromVideo).toEqual({ videoPath: '/v/stream.webm' })
    await useAudioStore.getState().loadSource(WAV, '/v/pad.aiff', undefined, null)
    expect(useAudioStore.getState().source?.fromVideo).toBeNull()
    expect(useAudioStore.getState().source?.extractedFrom).toBe('/v/pad.aiff')
    await useAudioStore.getState().loadSource(WAV, '/v/stream.mp4')
    expect(useAudioStore.getState().source?.fromVideo).toEqual({ videoPath: '/v/stream.mp4' })
  })

  it('a converted import keeps its original beside the working copy, and the picture rule applies to the copy', async () => {
    await useAudioStore.getState().loadSource(WAV, '/tmp/imagii-import/stream-aB3dE5fG.mp4', '/v/stream.flv', true)
    const source = useAudioStore.getState().source
    expect(source?.fromVideo).toEqual({ videoPath: '/tmp/imagii-import/stream-aB3dE5fG.mp4', convertedFrom: '/v/stream.flv' })
    expect(source?.fileName).toBe('stream.flv')
  })

  it('a plain audio file loaded as it is is neither', async () => {
    await useAudioStore.getState().loadSource('/a/mic.wav')
    const source = useAudioStore.getState().source
    expect(source?.fromVideo).toBeNull()
    expect(source?.extractedFrom).toBeNull()
  })
})

describe('the waveform is main\'s peaks, drawn after the file opens (T-129)', () => {
  // T-123 (14) refused a file over two hours HERE (the waveform was decoded in this process); T-124 (7) chose the sentence by kind.
  // The decode is gone, and so is the gate: these lengths open, sound alone or a video's, and their waveform is drawn.
  it.each([
    ['sound alone', '/v/podcast.mkv', false],
    ['a video\'s sound', '/v/stream.mkv', true]
  ] as const)('a 3 hour file opens and is drawn: no length ceiling (%s)', async (_label, from, hasVideo) => {
    duration = 3 * 3600
    await useAudioStore.getState().loadSource(WAV, from, undefined, hasVideo)
    await flush()
    const state = useAudioStore.getState()
    expect(state.source?.probe.duration).toBe(3 * 3600)
    expect(state.waveform?.duration).toBe(3 * 3600)
    expect(state.drawing).toBeNull()
    expect(toasts).toEqual([])
  })

  it('opens the file at once, then draws it: `drawing` while main reads (its percent), `waveform` when it answers', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/long.wav')
    let state = useAudioStore.getState()
    expect(state.source?.filePath, 'the studio holds the file while it is drawn').toBe('/a/long.wav')
    expect(state.waveform).toBeNull()
    expect(state.drawing).toEqual({ jobId: peaksCalls[0]?.jobId, percent: 0 })
    expect(peaksCalls.map((c) => c.filePath), 'main is asked for the peaks of the file itself').toEqual(['/a/long.wav'])
    const jobId = peaksCalls[0]?.jobId as string
    for (const h of progressHandlers) h({ jobId, percent: 42 })
    expect(useAudioStore.getState().drawing).toEqual({ jobId, percent: 42 })
    // Another job's progress, and a step backwards, change nothing.
    for (const h of progressHandlers) h({ jobId: 'someone-else', percent: 90 })
    for (const h of progressHandlers) h({ jobId, percent: 10 })
    expect(useAudioStore.getState().drawing).toEqual({ jobId, percent: 42 })
    peaksCalls[0]?.resolve(peaksOf(60))
    await flush()
    state = useAudioStore.getState()
    expect(state.waveform?.peaks[0]).toHaveLength(PEAK_BUCKETS)
    expect(state.drawing).toBeNull()
    expect(progressHandlers, 'the progress listener is let go').toHaveLength(0)
  })

  it('a file main cannot read is refused: the studio lets go of it and the person reads the finished sentence', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/odd.wav')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      peaksCalls[0]?.reject(new Error(`Error invoking remote method 'audio:peaks': Error: ${WAVEFORM_READ_FAILED}`))
      await flush()
    } finally {
      quiet.mockRestore()
    }
    const state = useAudioStore.getState()
    expect(state.source).toBeNull()
    expect(state.waveform).toBeNull()
    expect(state.drawing).toBeNull()
    expect(toasts).toEqual([{ kind: 'error', text: WAVEFORM_READ_FAILED }])
  })

  it('an answer that is not a waveform (over the size bound, say) is refused the same way, never drawn', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/odd.wav')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      peaksCalls[0]?.resolve(peaksOf(60, PEAK_BUCKETS + 1))
      await flush()
    } finally {
      quiet.mockRestore()
    }
    expect(useAudioStore.getState().source).toBeNull()
    expect(useAudioStore.getState().waveform).toBeNull()
    expect(toasts).toEqual([{ kind: 'error', text: WAVEFORM_READ_FAILED }])
  })

  it('Close while it is drawing stops the job (main kills its ffmpeg), and the job\'s end says nothing', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/long.wav')
    const jobId = peaksCalls[0]?.jobId as string
    useAudioStore.getState().clearSource()
    expect(canceled).toEqual([jobId])
    peaksCalls[0]?.reject(new CancelledError())
    await flush()
    expect(useAudioStore.getState().source).toBeNull()
    expect(toasts, 'their own Close is not news').toEqual([])
  })

  it('a second file opened while the first is drawing stops the first job, and the first one\'s late answer is not drawn over it', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/first.wav')
    const first = peaksCalls[0] as PeaksCall
    await useAudioStore.getState().loadSource('/a/second.wav')
    const second = peaksCalls[1] as PeaksCall
    expect(canceled).toEqual([first.jobId])
    expect(useAudioStore.getState().drawing?.jobId).toBe(second.jobId)
    // The first job's answer arrives anyway (it had finished as the Cancel landed): it belongs to nobody.
    first.resolve(peaksOf(11))
    await flush()
    expect(useAudioStore.getState().waveform).toBeNull()
    expect(useAudioStore.getState().source?.filePath).toBe('/a/second.wav')
    second.resolve(peaksOf(22))
    await flush()
    expect(useAudioStore.getState().waveform?.duration).toBe(22)
  })

  it('Close with nothing drawing cancels nothing', () => {
    useAudioStore.getState().clearSource()
    expect(canceled).toEqual([])
  })
})
