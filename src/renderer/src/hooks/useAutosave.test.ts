import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CanvasLayer } from '@shared/canvas'
import type { ImagiiProject } from '@shared/workspace'
import { MAX_SCHEMA_VERSION } from '@shared/projectValidation'
import { pathToImagiiFileUrl } from '@shared/fileUrl'
import {
  AUDIO_PLAYHEAD_KEYS,
  AUTOSAVE_MAX_WAIT_MS,
  VIDEO_PLAYHEAD_KEYS,
  applyProjectHeld,
  autosaveSuppressed,
  captureForQuit,
  createSaveScheduler,
  noteSuppressedChange,
  onAutosaveResume,
  playheadOnlyChange,
  startAutosave,
  suppressAutosave
} from './useAutosave'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'

/**
 * T-113 (11e) — autosave is held for exactly as long as a project is being put back, and no longer.
 *
 * Open project and the autosave Restore held autosave from before the file dialog until 1.5 s
 * AFTER the apply finished (`setTimeout(release, 1500)`), and while it was held both the timer
 * and the quit flush dropped what they were asked to save. The apply can wait minutes (a
 * converted import is converted again, a video's sound is extracted again) and the app is not
 * locked meanwhile: work done in another studio during that wait, then a quit in the 1.5 s
 * after it, was written nowhere. Two rules, both pinned here:
 *   - no capture while the apply is in flight (the stores hold half a project; writing that
 *     over the autosave being restored would lose the only copy of the rest), and
 *   - none of it held afterwards: the moment the apply is over, a quit saves everything,
 *     including what was done during the wait.
 */

const VIDEO_PROBE = {
  duration: 120,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  bitrate: 8_000_000,
  sizeBytes: 120_000_000
}
const AUDIO_PROBE = {
  duration: 120,
  sampleRate: 48_000,
  channels: 2,
  codec: 'pcm_s16le',
  bitrate: 1_536_000,
  format: 'wav',
  sizeBytes: 23_000_000
}
const ORIGINAL = '/home/user/Videos/stream.flv'
const COPY = '/tmp/imagii-import/stream-kQ9rS1tU.mp4'

function gate<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const textLayer = (id: string, text: string): CanvasLayer => ({
  id,
  type: 'text',
  name: id,
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  text,
  fontSize: 40,
  fontFamily: 'Inter',
  fill: '#ffffff'
})

const project = (): ImagiiProject => ({
  schemaVersion: MAX_SCHEMA_VERSION,
  savedAt: 1,
  appVersion: '1.0.0',
  videoStudio: {
    sourcePath: ORIGINAL,
    convertedForImport: true,
    clips: [],
    selectedClipId: null,
    watermark: null
  }
})

let converting = gate<string>()
beforeEach(() => {
  converting = gate<string>()
  vi.stubGlobal('window', {
    api: {
      video: {
        probe: () => Promise.resolve(VIDEO_PROBE),
        fileUrl: (p: string) => pathToImagiiFileUrl(p),
        convertForImport: () => converting.promise
      },
      audio: { probe: () => Promise.resolve(AUDIO_PROBE) }
    }
  })
  useVideoStore.getState().clearSource()
  useAudioStore.getState().clearSource()
  useCanvasStore.getState().resetDocument()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureForQuit — the quit flush (T-113)', () => {
  it('captures what is open when nothing is being applied', () => {
    useCanvasStore.getState().addLayer(textLayer('open-layer', 'hello'))
    const quit = captureForQuit()
    expect(quit?.imageCanvas?.doc.layers.map((l) => l.id)).toEqual(['open-layer'])
  })

  it('captures NOTHING while a project is being applied: the stores hold half of it', async () => {
    await useVideoStore.getState().loadSource('/home/user/Videos/open.mp4')
    const pending = applyProjectHeld(project())
    await tick()
    expect(autosaveSuppressed()).toBe(true)
    expect(captureForQuit()).toBeNull()
    converting.resolve(COPY)
    await pending
  })

  it('a quit the moment the apply is over saves the work done DURING the wait', async () => {
    const pending = applyProjectHeld(project())
    await tick()
    // The person works in the canvas while the video converts.
    const before = useCanvasStore.getState().doc.layers.length
    useCanvasStore.getState().addLayer(textLayer('made-meanwhile', 'typed during the wait'))
    expect(useCanvasStore.getState().doc.layers.length).toBe(before + 1)
    converting.resolve(COPY)
    await pending

    // Released at once — not 1.5 s later — so this quit is answered with the whole session.
    expect(autosaveSuppressed()).toBe(false)
    const quit = captureForQuit()
    expect(quit?.imageCanvas?.doc.layers.map((l) => l.id)).toContain('made-meanwhile')
    expect(quit?.videoStudio?.sourcePath).toBe(ORIGINAL)
  })
})

describe('the hold (T-113)', () => {
  it('is released when the apply throws, too', async () => {
    // Nothing to read `imageCanvas` off: `applyProject` throws before it opens anything.
    await expect(applyProjectHeld(null as unknown as ImagiiProject)).rejects.toThrow()
    expect(autosaveSuppressed()).toBe(false)
  })

  it('two holds are two holds: the first release does not lift the second', () => {
    const a = suppressAutosave()
    const b = suppressAutosave()
    a()
    expect(autosaveSuppressed()).toBe(true)
    b()
    expect(autosaveSuppressed()).toBe(false)
  })

  it('a release called twice does not release someone else\'s hold', () => {
    const a = suppressAutosave()
    const b = suppressAutosave()
    a()
    a()
    expect(autosaveSuppressed()).toBe(true)
    b()
    expect(autosaveSuppressed()).toBe(false)
  })
})

describe('a change made while autosave was held is saved when it lets go (T-113)', () => {
  it('re-arms the save once, on the last release, and only if something changed', () => {
    const resume = vi.fn()
    const off = onAutosaveResume(resume)
    try {
      const quiet = suppressAutosave()
      quiet()
      expect(resume, 'nothing changed, nothing to save').not.toHaveBeenCalled()

      const a = suppressAutosave()
      const b = suppressAutosave()
      noteSuppressedChange()
      a()
      expect(resume, 'still held by b').not.toHaveBeenCalled()
      b()
      expect(resume).toHaveBeenCalledTimes(1)

      const again = suppressAutosave()
      again()
      expect(resume, 'the change was reported once').toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('stops calling a handler that was unregistered', () => {
    const resume = vi.fn()
    onAutosaveResume(resume)()
    const hold = suppressAutosave()
    noteSuppressedChange()
    hold()
    expect(resume).not.toHaveBeenCalled()
  })
})

/**
 * T-136 (3) - autosave never fired while anything played.
 *
 * `useAutosave` subscribed its debounce to whole stores, and the Player writes `currentTime` on every `timeupdate` (about four a second) and the
 * waveform on every `audioprocess`, so each tick re-armed the 5 s timer and it never elapsed: clips marked during a long review were not on disk
 * until playback stopped for 5 s - against the guide's and the crash screen's "every few seconds". Two rules, both pinned here through the real stores
 * and a fake clock (`startAutosave` is the hook's whole effect as a function): a change to nothing but the playhead is not an edit, and a pending
 * change is written no later than 30 s after it was first scheduled, so no future high-frequency field can starve it again.
 */
describe('playheadOnlyChange - which store changes are not edits (T-136 (3))', () => {
  it('is true when only the listed fields differ, false when anything else does', () => {
    const before = { currentTime: 1, transport: null, clips: [1], name: 'a' }
    expect(playheadOnlyChange({ ...before, currentTime: 1.25 }, before, ['currentTime', 'transport'])).toBe(true)
    expect(playheadOnlyChange({ ...before, currentTime: 2, transport: {} as never }, before, ['currentTime', 'transport'])).toBe(true)
    expect(playheadOnlyChange({ ...before, clips: [1, 2] }, before, ['currentTime', 'transport'])).toBe(false)
    expect(playheadOnlyChange({ ...before, currentTime: 9, name: 'b' }, before, ['currentTime', 'transport']), 'a playhead move beside a real edit is an edit').toBe(false)
  })

  it('compares by identity, as a store does: the same array is unchanged, an equal copy is a change', () => {
    const clips = [1]
    const before = { currentTime: 0, clips }
    expect(playheadOnlyChange({ currentTime: 1, clips }, before, ['currentTime'])).toBe(true)
    expect(playheadOnlyChange({ currentTime: 1, clips: [...clips] }, before, ['currentTime'])).toBe(false)
  })

  it('a change that touched no field at all is nothing to save', () => {
    const before = { currentTime: 3, clips: [] }
    expect(playheadOnlyChange({ ...before }, before, ['currentTime'])).toBe(true)
  })

  it('the video store\'s playhead fields are the position, the Player\'s transport and a seek request; the audio store\'s is the position', () => {
    expect([...VIDEO_PLAYHEAD_KEYS].sort()).toEqual(['currentTime', 'seekRequest', 'transport'])
    expect([...AUDIO_PLAYHEAD_KEYS]).toEqual(['currentTime'])
    // ...and every one of them is a field those stores really have (a renamed field would silently stop being a playhead).
    for (const key of VIDEO_PLAYHEAD_KEYS) expect(Object.keys(useVideoStore.getState()), key).toContain(key)
    for (const key of AUDIO_PLAYHEAD_KEYS) expect(Object.keys(useAudioStore.getState()), key).toContain(key)
  })
})

describe('createSaveScheduler - a debounce with a ceiling (T-136 (3))', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a burst is one run, 5 s after its last change (the debounce is unchanged)', () => {
    const run = vi.fn()
    const scheduler = createSaveScheduler(run)
    scheduler.schedule()
    vi.advanceTimersByTime(3000)
    scheduler.schedule()
    vi.advanceTimersByTime(4999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a change that keeps coming faster than the debounce still runs 30 s after the first one', () => {
    const run = vi.fn()
    let ranAt = -1
    const t0 = Date.now()
    const scheduler = createSaveScheduler(() => {
      ranAt = Date.now() - t0
      run()
    })
    for (let t = 0; t < 29_000; t += 250) {
      scheduler.schedule()
      vi.advanceTimersByTime(250)
    }
    expect(run, 'still waiting at 29 s').not.toHaveBeenCalled()
    scheduler.schedule()
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(ranAt, 'exactly at the ceiling').toBe(AUTOSAVE_MAX_WAIT_MS)
  })

  it('the clock restarts after a run: the next burst has its own 30 s', () => {
    const ranAt: number[] = []
    const t0 = Date.now()
    const scheduler = createSaveScheduler(() => ranAt.push(Date.now() - t0))
    for (let t = 0; t < 70_000; t += 250) {
      scheduler.schedule()
      vi.advanceTimersByTime(250)
    }
    expect(ranAt.slice(0, 2)).toEqual([30_000, 60_000])
  })

  it('cancel drops what is pending and the ceiling with it', () => {
    const run = vi.fn()
    const scheduler = createSaveScheduler(run)
    for (let t = 0; t < 20_000; t += 250) {
      scheduler.schedule()
      vi.advanceTimersByTime(250)
    }
    scheduler.cancel()
    vi.advanceTimersByTime(60_000)
    expect(run).not.toHaveBeenCalled()
    // A schedule after the cancel starts a fresh window: the 5 s debounce, not an immediate run on an old ceiling that has long passed.
    scheduler.schedule()
    vi.advanceTimersByTime(4999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('startAutosave - the stores, the playhead rule and the ceiling together (T-136 (3))', () => {
  let writes: number[]
  let stop: () => void
  let t0 = 0

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    t0 = Date.now()
    writes = []
    vi.stubGlobal('window', {
      api: {
        autosave: {
          write: vi.fn(async () => {
            writes.push(Date.now() - t0)
            return { ok: true as const }
          })
        }
      }
    })
    useVideoStore.getState().clearSource()
    useAudioStore.getState().clearSource()
    useCanvasStore.getState().resetDocument()
    stop = startAutosave({ lastWriteTime: 0, lastHash: '' })
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  /** Advance the clock in 250 ms steps, calling `each` before every step (a `timeupdate` is about this often). */
  async function run(ms: number, each: (elapsedMs: number) => void): Promise<void> {
    for (let t = 0; t < ms; t += 250) {
      each(t)
      await vi.advanceTimersByTimeAsync(250)
    }
  }

  it('an edit followed by 60 s of playhead updates is written within 6 s, not when the playback stops', async () => {
    useCanvasStore.getState().addLayer(textLayer('marked', 'a clip marked during the review'))
    await run(60_000, (t) => useVideoStore.getState().setCurrentTime(1 + t / 1000))
    expect(writes.length, 'written while the playhead was still moving').toBeGreaterThanOrEqual(1)
    expect(writes[0], 'the first write is the debounce after the edit').toBeLessThanOrEqual(6000)
    expect(writes.length, 'and the playhead alone wrote nothing more').toBe(1)
  })

  it('the Player\'s other writes while a video plays (its transport, a seek request) are not edits either', async () => {
    // Longer than the 30 s ceiling: a subscription that took these for edits would write at 30 s, and nothing else would stop it.
    await run(40_000, (t) => {
      useVideoStore.getState().setCurrentTime(t / 1000)
      useVideoStore.getState().registerTransport(t % 1000 === 0 ? null : { readTime: () => 0, togglePlay: () => undefined })
      useVideoStore.setState({ seekRequest: t % 500 === 0 ? { seconds: t / 1000 } : null })
    })
    expect(writes, 'nothing but the playhead moved').toEqual([])
  })

  it('the waveform\'s position while a sound plays is not an edit', async () => {
    await run(40_000, (t) => useAudioStore.getState().setCurrentTime(t / 1000))
    expect(writes).toEqual([])
  })

  it('churn on a field that IS work still writes by 30 s, however fast it changes', async () => {
    useCanvasStore.getState().addLayer(textLayer('typing', 'x'))
    await run(100_000, (t) => useCanvasStore.getState().updateLayer('typing', { text: `typed ${t}` } as never))
    expect(writes.length).toBeGreaterThanOrEqual(3)
    expect(writes[0], 'no later than 30 s after the first change').toBeLessThanOrEqual(AUTOSAVE_MAX_WAIT_MS)
    expect(writes[0], 'and not at the first tick: the debounce is still being extended by the churn').toBeGreaterThanOrEqual(25_000)
    // The ceiling holds for the next burst too (the window restarts after a write), and writes stay 5 s apart or more.
    for (let i = 1; i < writes.length; i++) expect((writes[i] as number) - (writes[i - 1] as number)).toBeGreaterThanOrEqual(5000)
  })

  it('a single edit with the playhead still is written 5 s later, as before', async () => {
    useCanvasStore.getState().addLayer(textLayer('once', 'one edit'))
    await vi.advanceTimersByTimeAsync(4999)
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([5000])
  })

  it('a hold still defers the write, and letting go still saves what changed meanwhile', async () => {
    const release = suppressAutosave()
    useCanvasStore.getState().addLayer(textLayer('held', 'during the hold'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes, 'nothing is written while a project is being applied').toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(5000)
    expect(writes.length, 'the release saved it').toBe(1)
  })

  it('stopping unsubscribes and drops the pending write', async () => {
    useCanvasStore.getState().addLayer(textLayer('gone', 'edited, then the hook unmounted'))
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes).toEqual([])
    useCanvasStore.getState().addLayer(textLayer('after', 'nobody is listening'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes).toEqual([])
  })
})
