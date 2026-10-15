import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CanvasLayer } from '@shared/canvas'
import type { ImagiiProject } from '@shared/workspace'
import { MAX_SCHEMA_VERSION } from '@shared/projectValidation'
import { pathToImagiiFileUrl } from '@shared/fileUrl'
import {
  applyProjectHeld,
  autosaveSuppressed,
  captureForQuit,
  noteSuppressedChange,
  onAutosaveResume,
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
