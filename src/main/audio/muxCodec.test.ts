import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { isCancelledError } from '../../shared/cancel'
import type { AudioJobProgress } from '../../shared/audio'

/**
 * T-111 — "Re-attach to video" copies the picture only when an mp4 can carry it.
 *
 * A reopened project points at the ORIGINAL video (a session that imported a .wmv
 * muxed onto the h264 working copy it had made; the saved project holds the .wmv),
 * so the re-attach handed `-c:v copy -> .mp4` a wmv2 stream: "Could not find tag for
 * codec wmv2 in stream #0, codec not currently supported in container", every time.
 * The mux now probes the picture first and re-encodes it (libx264, as a cut picture
 * already is) when its codec is not one an mp4 holds. Only the child process and the
 * two probes are faked; the real runner builds the real command. Layer 5
 * (media.spec.ts) builds a real wmv2 file and plays what comes out.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 on both pipes */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  kill(): boolean {
    return true
  }
}
interface Spawned {
  args: string[]
  child: FakeChild
}
let spawned: Spawned[] = []
let videoProbes: string[] = []
let codec: string | Error = 'h264'
/** T-131 (2): the lengths the two probes answer, in seconds (the picture's, then the cleaned sound's). */
let pictureSec = 10
let soundSec = 10
let onSpawn: (s: Spawned) => void = () => undefined

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const entry = { args, child: new FakeChild() }
    spawned.push(entry)
    queueMicrotask(() => onSpawn(entry))
    return entry.child
  }
}))
vi.mock('../ffmpeg/probe', () => ({
  probeVideo: async (file: string) => {
    videoProbes.push(file)
    if (codec instanceof Error) throw codec
    return { duration: pictureSec, width: 640, height: 360, fps: 30, videoCodec: codec, audioCodec: 'aac', bitrate: 0, sizeBytes: 0 }
  }
}))
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: soundSec, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))

const { runAudioMux, cancelAudioJob } = await import('./process')

const EVEN = 'crop=trunc(iw/2)*2:trunc(ih/2)*2'
const finish = (s: Spawned): void => {
  s.child.emit('close', 0, null)
}
const flag = (s: Spawned, name: string): string | undefined => s.args[s.args.indexOf(name) + 1]
const mux = (cutRegions: Array<{ startSec: number; endSec: number }> = [], onProgress: (p: AudioJobProgress) => void = () => undefined) =>
  runAudioMux('mux1', '/in/original.wmv', '/tmp/cleaned.wav', '/out/video.mp4', onProgress, cutRegions)

beforeEach(() => {
  spawned = []
  videoProbes = []
  codec = 'h264'
  pictureSec = 10
  soundSec = 10
  onSpawn = finish
})

describe('runAudioMux — stream-copy only what an mp4 can carry (T-111)', () => {
  it.each(['h264', 'hevc', 'av1', 'mpeg4', 'mjpeg'])('%s is copied, untouched', async (c) => {
    codec = c
    await mux()
    const s = spawned[0] as Spawned
    expect(flag(s, '-c:v')).toBe('copy')
    expect(s.args).not.toContain('libx264')
    expect(s.args).not.toContain('-vf')
    expect(videoProbes).toEqual(['/in/original.wmv'])
  })

  // T-126 (24): a copy of HEVC into an mp4 is written with ffmpeg's default tag, `hev1`, which QuickTime, Safari and iOS refuse; `hvc1` is the
  // tag they read. Only HEVC carries it: the other copyable codecs keep the tag ffmpeg gives them (h264's `avc1`, av1's `av01`, ...).
  it('hevc is copied WITH the hvc1 tag, so a Mac or an iPhone plays the file', async () => {
    codec = 'hevc'
    await mux()
    const s = spawned[0] as Spawned
    expect(flag(s, '-c:v')).toBe('copy')
    expect(flag(s, '-tag:v')).toBe('hvc1')
    // right behind the copy, and before the audio options: `-c:v copy -tag:v hvc1 -c:a aac`
    expect(s.args.slice(s.args.indexOf('-c:v'), s.args.indexOf('-c:v') + 4)).toEqual(['-c:v', 'copy', '-tag:v', 'hvc1'])
  })

  it.each(['HEVC', 'Hevc'])('the codec name is read case-blind (%s)', async (c) => {
    codec = c
    await mux()
    expect(flag(spawned[0] as Spawned, '-tag:v')).toBe('hvc1')
  })

  it.each(['h264', 'av1', 'mpeg4', 'mjpeg'])('%s is copied with no tag of ours', async (c) => {
    codec = c
    await mux()
    expect((spawned[0] as Spawned).args).not.toContain('-tag:v')
  })

  it('a picture that is re-encoded (a cut, or a codec an mp4 cannot hold) is not tagged: libx264 writes avc1', async () => {
    codec = 'hevc'
    await mux([{ startSec: 1, endSec: 2 }])
    expect((spawned[0] as Spawned).args).not.toContain('-tag:v')
    spawned = []
    codec = 'vp9'
    await mux()
    expect((spawned[0] as Spawned).args).not.toContain('-tag:v')
  })

  it.each(['wmv2', 'wmv3', 'vp8', 'vp9', 'theora', 'mpeg2video', 'prores', 'flv1'])(
    '%s is re-encoded to h264 in the same step, never copied into the mp4',
    async (c) => {
      codec = c
      await mux()
      const s = spawned[0] as Spawned
      expect(flag(s, '-c:v')).toBe('libx264')
      expect(flag(s, '-pix_fmt')).toBe('yuv420p')
      expect(flag(s, '-fps_mode')).toBe('passthrough')
      expect(s.args).not.toContain('copy')
      // No cut, so no select: the picture is the whole picture. The one stage is the
      // even-size crop (T-113, T-115): libx264 refuses an odd width or height.
      expect(flag(s, '-vf')).toBe(EVEN)
      // Everything else about the command is the copy path's.
      expect(flag(s, '-c:a')).toBe('aac')
      expect(s.args).toContain('-shortest')
      expect(flag(s, '-movflags')).toBe('+faststart')
      expect(s.args[s.args.length - 1]).toBe('/out/video.mp4')
    }
  )

  // T-122 (1): the cut re-attach retimes each survivor by the time the cuts removed, which is almost never a whole
  // number of frames. On the shipped ffmpeg major (6.1.1) a constant-rate source gets an encoder time base of 1/fps,
  // so every retimed stamp was rounded onto the frame grid and the first survivor after a cut landed on the frame
  // before it (one `pts_time` written twice, "non-strictly-monotonic PTS"). `-enc_time_base:v filter` keeps the
  // graph's own time base, so the stamps land where `setpts` put them. A string cannot say ffmpeg accepts it or
  // that the stamps come out exact - Layer 5 ("a cut that is not a whole number of frames long ...", run on 6.1.1)
  // does - but it can say the option is still there, on every command that re-encodes the picture.
  describe('a re-encoded picture keeps the filter graph\'s own time base (T-122)', () => {
    const BESIDE = '-fps_mode passthrough -enc_time_base:v filter'
    /** The two options as the command carries them, as one string: back to back, passthrough first. */
    const timing = (s: Spawned): string => {
      const at = s.args.indexOf('-fps_mode')
      return s.args.slice(at, at + 4).join(' ')
    }

    it('a cut re-attach asks for it, beside passthrough', async () => {
      await mux([{ startSec: 3.3, endSec: 5.7 }])
      expect(timing(spawned[0] as Spawned)).toBe(BESIDE)
    })

    it.each(['wmv2', 'vp9', 'mpeg2video'])('so does a %s picture re-encoded only to fit an mp4 (no cut)', async (c) => {
      codec = c
      await mux()
      expect(timing(spawned[0] as Spawned)).toBe(BESIDE)
    })

    it('a picture that is copied has no encoder, so no time base to choose', async () => {
      codec = 'h264'
      await mux()
      expect(spawned[0]?.args).not.toContain('-enc_time_base:v')
      expect(spawned[0]?.args).not.toContain('-fps_mode')
    })
  })

  it('a video that cannot be probed is re-encoded: a copy of an unknown picture is the one thing that can write an unplayable file', async () => {
    codec = new Error('ffprobe returned no usable duration for the video')
    await mux()
    expect(flag(spawned[0] as Spawned, '-c:v')).toBe('libx264')
  })

  it('a cut re-encodes whatever the codec, with the cut, and probes the picture once, for its length (T-131 (2))', async () => {
    codec = 'h264'
    await mux([{ startSec: 2, endSec: 4 }])
    const s = spawned[0] as Spawned
    expect(flag(s, '-c:v')).toBe('libx264')
    // T-113: the even-size crop runs AHEAD of the cut, so `select` and `setpts` see the
    // size the encoder will get.
    expect(flag(s, '-vf')).toMatch(new RegExp(`^${EVEN.replace(/[()*/]/g, '\\$&')},select=`))
    // T-131 (2): the probe is no longer the copy decision alone - the pad is the picture's length, whichever branch runs - so a cut asks it too.
    expect(videoProbes).toEqual(['/in/original.wmv'])
  })

  it('a re-encoded picture has a bar that measures (against the length of the cleaned audio); a copy has none', async () => {
    codec = 'wmv2'
    onSpawn = (s) => {
      s.child.stdout.emit('data', 'out_time=00:00:05.000000\nprogress=continue\n')
      finish(s)
    }
    const seen: AudioJobProgress[] = []
    await mux([], (p) => seen.push(p))
    expect(seen.filter((p) => p.percent === 50).map((p) => p.pass)).toEqual(['mux'])
    expect(seen[seen.length - 1]).toMatchObject({ pass: 'mux', percent: 100 })

    codec = 'h264'
    spawned = []
    const copied: AudioJobProgress[] = []
    await mux([], (p) => copied.push(p))
    expect(copied.map((p) => p.percent)).toEqual([100])
  })

  it('a Cancel in the probe ends the wait at once: the job is refused and nothing is spawned', async () => {
    codec = 'wmv2'
    const probes = await import('../ffmpeg/probe')
    const real = probes.probeVideo
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(probes, 'probeVideo').mockImplementation(async (file: string) => {
      await held
      return real(file)
    })
    try {
      const outcome = mux().then(
        () => null,
        (err: unknown) => err
      )
      await vi.waitFor(() => expect(cancelAudioJob('mux1')).toBe(true))
      expect(isCancelledError(await outcome)).toBe(true)
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(spawned).toHaveLength(0)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

// T-131 (2): `-shortest` ended the re-attach where a SHORTER sound ended. A Record take whose microphone dropped at 5 s of 12 came out
// 5.0 s long, the picture cut off with it (measured; the stream-copy branch too: 6.0 s). The sound is padded with silence to the picture's
// length - FINITE (`whole_dur`), because a bare `apad` hangs `-c:v copy` - and `-shortest` stays, so the output ends at the PICTURE whichever
// stream is shorter and a music bed longer than the picture is still trimmed. Layer 5 (media.spec.ts, T-131 (2)) proves ffmpeg accepts it and
// what comes out, on both majors; this is the argument it depends on, and what the runner does when the picture's length is not known.
describe('runAudioMux — the sound reaches the picture\'s length, and -shortest stays (T-131 (2))', () => {
  const afOf = (s: Spawned): string | undefined => (s.args.includes('-af') ? flag(s, '-af') : undefined)

  it.each(['h264', 'wmv2'])('a %s picture (copied, re-encoded) pads the sound to its whole length, finite, just ahead of -shortest', async (c) => {
    codec = c
    pictureSec = 12
    soundSec = 5
    await mux()
    const s = spawned[0] as Spawned
    expect(afOf(s)).toBe('apad=whole_dur=12.000')
    expect(s.args.indexOf('-af'), 'the pad sits beside the audio options, ahead of -shortest').toBeLessThan(s.args.indexOf('-shortest'))
    expect(s.args.filter((a) => a === '-shortest')).toHaveLength(1)
    // Never a bare apad: it is endless, and hangs a stream-copied picture.
    expect(s.args.join(' ')).not.toMatch(/apad(?!=whole_dur=\d)/)
  })

  it('the length is the picture\'s AFTER the cuts (merged, so an overlap is counted once)', async () => {
    pictureSec = 12
    soundSec = 5
    await mux([{ startSec: 2, endSec: 4 }])
    expect(afOf(spawned[0] as Spawned)).toBe('apad=whole_dur=10.000')
    spawned = []
    await mux([{ startSec: 1, endSec: 3 }, { startSec: 2, endSec: 4 }])
    expect(afOf(spawned[0] as Spawned)).toBe('apad=whole_dur=9.000')
  })

  it('a picture whose length cannot be read is re-encoded and NOT padded: it ends where the sound does, as it always did', async () => {
    codec = new Error('ffprobe returned no usable duration for the video')
    await mux()
    const s = spawned[0] as Spawned
    expect(flag(s, '-c:v')).toBe('libx264')
    expect(s.args).not.toContain('-af')
    expect(s.args).toContain('-shortest')
  })

  it('the bar measures against the picture\'s length (the output is that long), and falls back to the cleaned sound when the picture\'s is unknown', async () => {
    codec = 'wmv2'
    pictureSec = 12
    soundSec = 5
    const half = (p: AudioJobProgress): boolean => p.percent === 50
    onSpawn = (s) => {
      s.child.stdout.emit('data', 'out_time=00:00:06.000000\nprogress=continue\n')
      finish(s)
    }
    const seen: AudioJobProgress[] = []
    await mux([], (p) => seen.push(p))
    expect(seen.filter(half), '6 s of 12 s').toHaveLength(1)
    spawned = []
    codec = new Error('no usable duration')
    onSpawn = (s) => {
      s.child.stdout.emit('data', 'out_time=00:00:02.500000\nprogress=continue\n')
      finish(s)
    }
    const fallback: AudioJobProgress[] = []
    await mux([], (p) => fallback.push(p))
    expect(fallback.filter(half), '2.5 s of the 5 s cleaned sound').toHaveLength(1)
  })
})
