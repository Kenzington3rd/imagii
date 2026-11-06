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

const { useAudioStore, isPicture, waveformArrived } = await import('./audioStore')

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

/**
 * T-132 (11): `loadSource` resolves once the file is OPEN, and its waveform is read after that (T-129). The importer said "Loaded" and put
 * the file in Recent the moment `loadSource` resolved, so a file main then refused (an unknown WAV format, a damaged stream) flashed a
 * green "Loaded" and stayed in Recent beside the refusal. `waveformArrived` is the question the importer asks instead: did THIS file's
 * waveform come, or did the studio let go of it first (the refusal, a Close, another file opened)?
 */
describe('waveformArrived: has this file\'s waveform come, or did the studio let go of it first (T-132 (11))', () => {
  it('is true once main answers, and not before', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/long.wav')
    const source = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    let verdict: boolean | null = null
    void waveformArrived(source).then((v) => {
      verdict = v
    })
    await flush()
    expect(verdict, 'still being read: no verdict yet').toBeNull()
    peaksCalls[0]?.resolve(peaksOf(60))
    await flush()
    expect(verdict).toBe(true)
  })

  it('is true at once for a file whose waveform is already drawn', async () => {
    await useAudioStore.getState().loadSource('/a/short.wav')
    await flush()
    const source = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    expect(useAudioStore.getState().waveform).not.toBeNull()
    expect(await waveformArrived(source)).toBe(true)
  })

  it('is false when main refuses the file (the studio lets go of it)', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/odd.wav')
    const source = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    const verdict = waveformArrived(source)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      peaksCalls[0]?.reject(new Error(`Error invoking remote method 'audio:peaks': Error: ${WAVEFORM_READ_FAILED}`))
      await flush()
    } finally {
      quiet.mockRestore()
    }
    expect(await verdict).toBe(false)
  })

  it('is false when the person closes the file while it is being read', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/long.wav')
    const source = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    const verdict = waveformArrived(source)
    useAudioStore.getState().clearSource()
    expect(await verdict).toBe(false)
  })

  it('is false when another file is opened first, and true for that other file when its own waveform comes', async () => {
    autoAnswer = false
    await useAudioStore.getState().loadSource('/a/first.wav')
    const first = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    const firstVerdict = waveformArrived(first)
    await useAudioStore.getState().loadSource('/a/second.wav')
    const second = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    const secondVerdict = waveformArrived(second)
    peaksCalls[1]?.resolve(peaksOf(22))
    await flush()
    expect(await firstVerdict).toBe(false)
    expect(await secondVerdict).toBe(true)
  })

  it('is false at once for a file the studio does not hold', async () => {
    await useAudioStore.getState().loadSource('/a/short.wav')
    await flush()
    const held = useAudioStore.getState().source as NonNullable<ReturnType<typeof useAudioStore.getState>['source']>
    useAudioStore.getState().clearSource()
    expect(await waveformArrived(held)).toBe(false)
  })
})

// T-147 (fold, T-78 audio half): one slider drag was dozens of undo steps. `patchChain` pushed a history step on EVERY `input` event, so Ctrl+Z after
// pulling Manual gain across its range moved it half a decibel. The store has the video store's coalescing: a patch with a KEY is one step for as long as the
// key repeats; a patch without one is its own step; `endGesture` (pointer up, blur) closes the window; every discrete action and undo/redo/load/clear reset it.
describe('chain history coalesces a drag into one step (T-147, T-78)', () => {
  const store = () => useAudioStore.getState()
  const chainOf = (gain: number) => ({ ...store().chain, gainDb: gain })
  const SECONDARY = { filePath: '/m/bed.mp3', fileName: 'bed.mp3', role: 'music' as const, gainDb: -10, duckUnderPrimary: true }

  it('one drag - many patches with the same key - is ONE step, and one undo restores the value from before it', () => {
    for (const g of [0.5, 1, 1.5, 2, 2.5, 3]) store().patchChain({ gainDb: g }, 'gain')
    expect(store().history.past).toHaveLength(1)
    expect(store().chain.gainDb).toBe(3)
    store().undo()
    expect(store().chain.gainDb, 'the pre-drag value').toBe(0)
    expect(store().history.past).toHaveLength(0)
    store().redo()
    expect(store().chain.gainDb, 'and redo puts the end of the drag back in one step').toBe(3)
  })

  it('two drags separated by endGesture are two steps', () => {
    for (const g of [1, 2, 3]) store().patchChain({ gainDb: g }, 'gain')
    store().endGesture()
    for (const g of [4, 5, 6]) store().patchChain({ gainDb: g }, 'gain')
    expect(store().history.past).toHaveLength(2)
    store().undo()
    expect(store().chain.gainDb).toBe(3)
    store().undo()
    expect(store().chain.gainDb).toBe(0)
  })

  it('a different control\'s key is a new step without an endGesture between: the second slider does not ride the first', () => {
    store().patchChain({ gainDb: 2 }, 'gain')
    store().patchChain({ gainDb: 3 }, 'gain')
    store().patchChain({ denoiseParams: { noiseFloorDb: -40, reductionDb: 12 } }, 'denoise.nf')
    store().patchChain({ denoiseParams: { noiseFloorDb: -41, reductionDb: 12 } }, 'denoise.nf')
    expect(store().history.past).toHaveLength(2)
  })

  it('a patch with no key (a checkbox, a button) is always its own step, and it closes the window of a drag before it', () => {
    store().patchChain({ gainDb: 1 }, 'gain')
    store().patchChain({ deEss: true })
    store().patchChain({ gainDb: 2 }, 'gain')
    // gain(1), deEss, gain(2): the last gain patch is a NEW window - the discrete one between reset the key.
    expect(store().history.past).toHaveLength(3)
    store().patchChain({ hum60: true })
    store().patchChain({ hum60: false })
    expect(store().history.past).toHaveLength(5)
  })

  it('a discrete action after a drag is its own step: a cut, a removed cut, a second track', () => {
    store().patchChain({ gainDb: 1 }, 'gain')
    store().addCutRegion({ startSec: 1, endSec: 2 })
    expect(store().history.past).toHaveLength(2)
    store().patchChain({ gainDb: 2 }, 'gain')
    store().removeCutRegion(0)
    expect(store().history.past).toHaveLength(4)
    store().patchChain({ gainDb: 3 }, 'gain')
    store().setSecondaryTrack(SECONDARY)
    expect(store().history.past).toHaveLength(6)
  })

  it('cuts are discrete: two marks in a row are two steps, and so are two removals', () => {
    store().addCutRegion({ startSec: 1, endSec: 2 })
    store().addCutRegion({ startSec: 3, endSec: 4 })
    expect(store().history.past).toHaveLength(2)
    store().removeCutRegion(1)
    store().removeCutRegion(0)
    expect(store().history.past).toHaveLength(4)
    store().undo()
    expect(store().chain.cutRegions, 'the last removal is undone alone').toHaveLength(1)
  })

  it('a slider of the second track coalesces through setSecondaryTrack\'s key; the same call with no key is a step each', () => {
    store().setSecondaryTrack(SECONDARY)
    for (const g of [-9, -8, -7]) store().setSecondaryTrack({ ...SECONDARY, gainDb: g }, 'secondary.gain')
    expect(store().history.past, 'the add, and one drag').toHaveLength(2)
    store().undo()
    expect(store().chain.secondaryTrack?.gainDb).toBe(-10)
    for (const g of [-9, -8]) store().setSecondaryTrack({ ...SECONDARY, gainDb: g })
    expect(store().history.past, 'the add, then one step per keyless call').toHaveLength(3)
  })

  it('undo resets the key (redo needs none: an edit clears the redo branch, so a redo never meets an open window): the drag after an undo is a new step, not folded into the old one', () => {
    store().patchChain({ gainDb: 1 }, 'gain')
    store().patchChain({ gainDb: 2 }, 'gain')
    expect(store().historyKey).toBe('gain')
    store().undo()
    expect(store().historyKey).toBeNull()
    store().patchChain({ gainDb: 5 }, 'gain')
    expect(store().history.past, 'the undone drag left none; the new one pushed its own').toHaveLength(1)
    store().undo()
    expect(store().chain.gainDb).toBe(0)
    store().redo()
    expect(store().historyKey).toBeNull()
    store().patchChain({ gainDb: 6 }, 'gain')
    expect(store().history.past, 'the redone value is a step behind the new drag: it was not folded into it').toHaveLength(2)
    expect(store().chain).toEqual(chainOf(6))
    store().undo()
    expect(store().chain.gainDb, 'back to what the redo restored').toBe(5)
  })

  it('opening or closing a file resets the key and the history', async () => {
    store().patchChain({ gainDb: 1 }, 'gain')
    expect(store().historyKey).toBe('gain')
    await store().loadSource('/a/next.wav')
    expect(store().historyKey).toBeNull()
    expect(store().history.past).toHaveLength(0)
    store().patchChain({ gainDb: 1 }, 'gain')
    store().clearSource()
    expect(store().historyKey).toBeNull()
    store().patchChain({ gainDb: 2 }, 'gain')
    expect(store().history.past, 'a fresh window on a fresh chain').toHaveLength(1)
  })

  it('endGesture with no window open wakes nobody (it runs on every pointer-up in three panels); with one open it closes it', () => {
    let woken = 0
    const off = useAudioStore.subscribe(() => {
      woken += 1
    })
    try {
      store().endGesture()
      expect(woken, 'nothing was open').toBe(0)
      store().patchChain({ gainDb: 1 }, 'gain')
      woken = 0
      store().endGesture()
      expect(woken, 'the window was open: one write').toBe(1)
      expect(store().historyKey).toBeNull()
    } finally {
      off()
    }
  })

  it('the redo branch is dropped by the FIRST patch of a drag, and two hundred events of it are still one step', () => {
    store().patchChain({ deEss: true })
    store().undo()
    expect(store().history.future).toHaveLength(1)
    store().patchChain({ gainDb: 1 }, 'gain')
    expect(store().history.future, 'a new edit ends the redo branch').toHaveLength(0)
    for (let i = 0; i < 200; i++) store().patchChain({ gainDb: 1 + i / 100 }, 'gain')
    expect(store().history.past).toHaveLength(1)
  })
})

describe('an edit that changes nothing is not an edit (T-169 (2), the class of T-166 (3) and T-167 (2))', () => {
  const store = () => useAudioStore.getState()
  /** One real change and one undo first, so `future` holds a step Redo would play: a no-op that records a step wipes it. */
  function withRedoHeld(): void {
    store().patchChain({ deEss: true })
    store().patchChain({ rumbleHighpass: true })
    store().undo()
    expect(store().history.future).toHaveLength(1)
  }
  /** Nothing moved: the same `history` object (so `future` still holds what it held), the same key, the same chain object. */
  function expectUntouched(run: () => void): void {
    const { history, historyKey, chain } = store()
    run()
    expect(store().history, 'history is the same object: past and future as they were').toBe(history)
    expect(store().history.future).toHaveLength(1)
    expect(store().historyKey).toBe(historyKey)
    expect(store().chain).toBe(chain)
  }

  it('a primitive field patched to the value it already has pushes no step and keeps Redo', () => {
    withRedoHeld()
    expectUntouched(() => store().patchChain({ denoise: 'off' }))
    expectUntouched(() => store().patchChain({ compressor: 'off', gainDb: 0 }))
    expectUntouched(() => store().patchChain({ deEss: true }))
  })

  it('cutRegions equal by value but a new array is no change (a list of the same cuts in the same order)', () => {
    store().addCutRegion({ startSec: 1, endSec: 2 })
    store().addCutRegion({ startSec: 3, endSec: 4 })
    store().undo()
    store().redo()
    store().undo()
    expect(store().history.future).toHaveLength(1)
    expectUntouched(() => store().patchChain({ cutRegions: [{ startSec: 1, endSec: 2 }] }))
  })

  it('a list with one more or one fewer cut, or a cut with other times, is a change', () => {
    store().addCutRegion({ startSec: 1, endSec: 2 })
    store().addCutRegion({ startSec: 3, endSec: 4 })
    const steps = (): number => store().history.past.length
    let before = steps()
    store().patchChain({ cutRegions: [{ startSec: 1, endSec: 2 }] })
    expect(steps(), 'one fewer').toBe(before + 1)
    before = steps()
    store().patchChain({ cutRegions: [{ startSec: 1, endSec: 2 }, { startSec: 3, endSec: 4 }] })
    expect(steps(), 'one more').toBe(before + 1)
    before = steps()
    store().patchChain({ cutRegions: [{ startSec: 1, endSec: 2 }, { startSec: 3, endSec: 4.5 }] })
    expect(steps(), 'other times').toBe(before + 1)
    before = steps()
    store().patchChain({ cutRegions: [{ startSec: 3, endSec: 4.5 }, { startSec: 1, endSec: 2 }] })
    expect(steps(), 'the same cuts in another order is another list').toBe(before + 1)
  })

  it('denoiseParams with a key the chain\'s does not have, or the other way round, is a change', () => {
    store().patchChain({ denoiseParams: { noiseFloorDb: -25, reductionDb: 12 } })
    const before = store().history.past.length
    store().patchChain({ denoiseParams: { noiseFloorDb: -25, reductionDb: 12, sensitivity: 3 } })
    expect(store().history.past).toHaveLength(before + 1)
    store().patchChain({ denoiseParams: { noiseFloorDb: -25, reductionDb: 12 } })
    expect(store().history.past).toHaveLength(before + 2)
  })

  it('denoiseParams equal by value (a new object) is no change; one number different is a step', () => {
    store().patchChain({ denoise: 'parametric', denoiseParams: { noiseFloorDb: -25, reductionDb: 12, sensitivity: 0 } })
    store().patchChain({ deEss: true })
    store().undo()
    expect(store().history.future).toHaveLength(1)
    expectUntouched(() => store().patchChain({ denoiseParams: { noiseFloorDb: -25, reductionDb: 12, sensitivity: 0 } }))
    const before = store().history.past.length
    store().patchChain({ denoiseParams: { noiseFloorDb: -25, reductionDb: 13, sensitivity: 0 } })
    expect(store().history.past).toHaveLength(before + 1)
    expect(store().history.future, 'a real change ends the redo branch').toHaveLength(0)
  })

  it('secondaryTrack: an equal track is no change, and absent and null are the same (every reader tests `!= null`)', () => {
    const track = { filePath: '/m/bed.mp3', fileName: 'bed.mp3', role: 'music' as const, gainDb: -10, duckUnderPrimary: true }
    store().patchChain({ secondaryTrack: track })
    store().patchChain({ deEss: true })
    store().undo()
    expectUntouched(() => store().patchChain({ secondaryTrack: { ...track } }))
    store().undo()
    store().patchChain({ secondaryTrack: undefined })
    store().patchChain({ deEss: true })
    store().undo()
    expectUntouched(() => store().patchChain({ secondaryTrack: null }))
  })

  it('humHz: absent is 60 (a chain saved before 50 Hz existed), so patching 60 onto it changes nothing and 50 does', () => {
    store().patchChain({ deEss: true })
    store().undo()
    expectUntouched(() => store().patchChain({ humHz: 60 }))
    store().patchChain({ humHz: 50 })
    expect(store().chain.humHz).toBe(50)
    expect(store().history.past).toHaveLength(1)
  })

  it('a patch with one real field and one equal field still pushes ONE step and applies both', () => {
    withRedoHeld()
    store().patchChain({ denoise: 'off', gainDb: 2 })
    expect(store().chain.gainDb).toBe(2)
    expect(store().history.past).toHaveLength(2)
    expect(store().history.future).toHaveLength(0)
    store().undo()
    expect(store().chain.gainDb).toBe(0)
  })

  it('a real change still pushes a step, and undo and redo carry it', () => {
    store().patchChain({ compressor: 'voice' })
    expect(store().history.past).toHaveLength(1)
    expect(store().chain.compressor).toBe('voice')
    store().undo()
    expect(store().chain.compressor).toBe('off')
    store().redo()
    expect(store().chain.compressor).toBe('voice')
  })

  it('a keyed (coalesced) patch still coalesces, and an equal keyed patch neither pushes nor opens a window', () => {
    store().patchChain({ gainDb: 0 }, 'gain')
    expect(store().history.past, 'an equal patch is nothing').toHaveLength(0)
    expect(store().historyKey, 'and it opens no gesture window').toBeNull()
    for (const g of [1, 2, 3]) store().patchChain({ gainDb: g }, 'gain')
    expect(store().history.past).toHaveLength(1)
    expect(store().historyKey).toBe('gain')
    store().patchChain({ gainDb: 3 }, 'gain')
    expect(store().history.past, 'the repeat of the drag\'s last value changes nothing').toHaveLength(1)
    expect(store().historyKey, 'and does not close the window the drag holds').toBe('gain')
    store().undo()
    expect(store().chain.gainDb).toBe(0)
  })
})

const { soundKey } = await import('./audioStore')

/**
 * T-172 Track C (7): "is this the same sound" is the file the person OPENED. A video's sound and an AIFF / WMA are played from a fresh
 * `<nanoid10>.wav` extracted on every open, so `filePath` names the open, not the sound; re-opening the same file made a new "sound".
 */
describe('soundKey - the file the person opened is the sound\'s identity (T-172 Track C)', () => {
  it.each([
    ['a plain file is its own path', { filePath: '/a/voice.wav', fromVideo: null, extractedFrom: null }, '/a/voice.wav'],
    ['a video\'s sound is the video, not the scratch WAV', { filePath: '/tmp/imagii-audio/aB3dE5fG7h.wav', fromVideo: { videoPath: '/v/stream.mp4' }, extractedFrom: null }, '/v/stream.mp4'],
    [
      'a converted video\'s sound is the ORIGINAL, not the working copy',
      { filePath: '/tmp/imagii-audio/aB3dE5fG7h.wav', fromVideo: { videoPath: '/tmp/imagii-import/stream-aB3dE5fG.mp4', convertedFrom: '/v/stream.flv' }, extractedFrom: null },
      '/v/stream.flv'
    ],
    ['an AIFF / WMA is the file it was taken from', { filePath: '/tmp/imagii-audio/aB3dE5fG7h.wav', fromVideo: null, extractedFrom: '/m/take one.wma' }, '/m/take one.wma']
  ])('%s', (_name, source, key) => {
    expect(soundKey(source)).toBe(key)
  })

  it('two opens of the same file (two scratch WAVs) have one key; two different files have two', () => {
    const open = (scratch: string, from: string) => ({ filePath: scratch, fromVideo: { videoPath: from }, extractedFrom: null })
    expect(soundKey(open('/tmp/a.wav', '/v/x.mp4'))).toBe(soundKey(open('/tmp/b.wav', '/v/x.mp4')))
    expect(soundKey(open('/tmp/a.wav', '/v/x.mp4'))).not.toBe(soundKey(open('/tmp/a.wav', '/v/y.mp4')))
  })
})

