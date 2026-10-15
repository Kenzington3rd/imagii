import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { waveformCeilingRefusal, type AudioProbe } from '@shared/audio'
import { pathToImagiiFileUrl } from '@shared/fileUrl'
import { useAudioStore, isPicture } from './audioStore'

/**
 * T-126 (7): `fromVideo` is what turns Re-attach on, and it was decided by the EXTENSION of the file a sound was taken from. An `.mkv`
 * or `.mp4` that holds sound alone is sent down the video road: its over-ceiling refusal told the person to use Video Studio (which
 * refuses a file with no picture), and Re-attach is on by default for it and fails on `-map 0:v:0`. The extraction's probe reads the
 * streams; `loadSource` takes what it found, and the extension decides only when the probe could not say.
 */
const WAV = '/tmp/imagii-audio/aB3dE5fG7h.wav'
const probeOf = (duration: number): AudioProbe => ({ duration, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
let duration = 60

beforeEach(() => {
  duration = 60
  vi.stubGlobal('window', {
    api: {
      audio: { probe: () => Promise.resolve(probeOf(duration)) },
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

  it('the 2-hour refusal at the backstop gate names the remedy for what the file is: audio-only .mkv is told to split it elsewhere', async () => {
    duration = 3 * 3600
    await expect(useAudioStore.getState().loadSource(WAV, '/v/podcast.mkv', undefined, false)).rejects.toThrow(waveformCeilingRefusal(duration, 'audio') ?? '')
    await expect(useAudioStore.getState().loadSource(WAV, '/v/stream.mkv', undefined, true)).rejects.toThrow(waveformCeilingRefusal(duration, 'video') ?? '')
    expect(useAudioStore.getState().source, 'nothing was loaded').toBeNull()
  })
})
