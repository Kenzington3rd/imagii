import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CANCELLED_MESSAGE, isCancelledError } from '../../shared/cancel'
import { TRANSCRIPTION_AUDIO } from '../../shared/captions'

/**
 * T-113 (10) — this file's temp folder is its own. The extractor writes `tmpdir()/imagii-audio`,
 * and `tempCleanup.test.ts` used to empty that exact real folder (recursively, with exact-count
 * assertions) while this file's WAVs were being made — vitest runs files in parallel. The
 * extractor and this file now see a private `tmpdir()`; the folder goes with the file.
 */
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const sandbox = mkdtempSync(join(actual.tmpdir(), 'imagii-extract-sandbox-'))
  const tmpdir = (): string => sandbox
  return { ...actual, tmpdir, default: { ...actual, tmpdir } }
})

afterAll(() => {
  rmSync(tmpdir(), { recursive: true, force: true })
})

/**
 * T-111 — the extraction ffmpeg (the sound pulled out of a recording) has a
 * registry, and a format.
 *
 * REGISTRY. Transcription kept its copy of the child in `activeTranscribe` for a
 * per-job Cancel, but Audio Studio's own extraction (`audio:extractFromVideo`, the
 * import of a stream's sound) had none: a quit in the middle of a long VOD's
 * extraction left an ffmpeg.exe writing a scratch WAV after the window was gone.
 * Every extraction child now joins a module-level registry from its spawn to its
 * close or error, and `cancelAllExtractions` (what the quit sweep and
 * `cancelAllAudioJobs` call) kills what is in it. A fake `spawn` holds the child.
 *
 * FORMAT. Audio Studio loads 48 kHz stereo (~690 MB an hour); the speech engine
 * only needs 16 kHz mono and older `whisper.exe` builds refuse anything else.
 * The extractor takes the format as an argument; the default is Audio Studio's.
 * (Layer 5 asks a real ffmpeg for both and ffprobes the files.)
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* not used by the extractor */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}
interface Spawned {
  args: string[]
  child: FakeChild
}
let spawned: Spawned[] = []

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    spawned.push({ args, child })
    return child
  }
}))

const { extractAudioFromVideo, cancelAllExtractions, __extractTesting__, EXTRACT_CLOCK_FILTER } = await import('./extract')

let scratch = ''
const ARG = (s: Spawned, flag: string): string | undefined => s.args[s.args.indexOf(flag) + 1]
const wavOf = (s: Spawned): string => s.args[s.args.length - 1] as string
const settle = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-extract-'))
  spawned = []
  cancelAllExtractions()
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('the extraction registry (T-111)', () => {
  it('holds the child from its spawn, and clears it when the child closes cleanly', async () => {
    const done = extractAudioFromVideo('/v.mp4')
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    expect(__extractTesting__.activeCount()).toBe(1)
    spawned[0]?.child.emit('close', 0, null)
    await done
    expect(__extractTesting__.activeCount()).toBe(0)
  })

  it('clears it when the child exits with an error, and the error is still a failure', async () => {
    const done = settle(extractAudioFromVideo('/v.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    expect(__extractTesting__.activeCount()).toBe(1)
    spawned[0]?.child.emit('close', 1, null)
    const err = await done
    expect(isCancelledError(err)).toBe(false)
    expect((err as Error).message).toMatch(/audio extract exit 1/)
    expect(__extractTesting__.activeCount()).toBe(0)
  })

  it('clears it when the process cannot start at all (an error event)', async () => {
    const done = settle(extractAudioFromVideo('/v.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    spawned[0]?.child.emit('error', new Error('spawn ENOENT'))
    expect(((await done) as Error).message).toBe('spawn ENOENT')
    expect(__extractTesting__.activeCount()).toBe(0)
  })

  it('holds several at once and clears each on its own', async () => {
    const a = extractAudioFromVideo('/a.mp4')
    const b = settle(extractAudioFromVideo('/b.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    expect(__extractTesting__.activeCount()).toBe(2)
    // T-113: each child is found by the file it was asked to read. Both extractions make the
    // folder before they spawn, and two concurrent mkdirs finish in either order, so
    // `spawned[0]` was sometimes B's child: closing it settled B, left `await a` waiting on a
    // child nothing would close, and the case timed out in ~1 of 10 runs under load.
    const childOf = (input: string): FakeChild => (spawned.find((s) => s.args.includes(input)) as Spawned).child
    childOf('/a.mp4').emit('close', 0, null)
    await a
    expect(__extractTesting__.activeCount()).toBe(1)
    childOf('/b.mp4').emit('close', 1, null)
    await b
    expect(__extractTesting__.activeCount()).toBe(0)
  })

  it('cancelAllExtractions kills every live child as a kill the app asked for, and empties the registry', async () => {
    const a = settle(extractAudioFromVideo('/a.mp4'))
    const b = settle(extractAudioFromVideo('/b.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(2))

    cancelAllExtractions()

    expect(spawned.map((s) => s.child.signals)).toEqual([['SIGKILL'], ['SIGKILL']])
    expect(__extractTesting__.activeCount()).toBe(0)
    // A SIGKILL'd child closes non-zero (Windows: 1; POSIX: null + SIGKILL); both are the cancel sentinel.
    spawned[0]?.child.emit('close', null, 'SIGKILL')
    spawned[1]?.child.emit('close', 1, null)
    for (const outcome of [await a, await b]) {
      expect(isCancelledError(outcome)).toBe(true)
      expect((outcome as Error).message).toBe(CANCELLED_MESSAGE)
    }
  })

  it('removes the half-written WAV of a killed extraction (the file is this call\'s own)', async () => {
    const done = settle(extractAudioFromVideo('/a.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const wav = wavOf(spawned[0] as Spawned)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(wav, 'RIFF....partial')
    cancelAllExtractions()
    spawned[0]?.child.emit('close', null, 'SIGKILL')
    await done
    expect(existsSync(wav)).toBe(false)
  })

  it('is empty and harmless when nothing is running', () => {
    expect(__extractTesting__.activeCount()).toBe(0)
    expect(() => cancelAllExtractions()).not.toThrow()
  })

  it('cancelAllAudioJobs reaches it (it is what the quit sweep calls)', async () => {
    const { cancelAllAudioJobs } = await import('./process')
    const done = settle(extractAudioFromVideo('/a.mp4'))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    cancelAllAudioJobs()
    expect(spawned[0]?.child.signals).toEqual(['SIGKILL'])
    expect(__extractTesting__.activeCount()).toBe(0)
    spawned[0]?.child.emit('close', null, 'SIGKILL')
    expect(isCancelledError(await done)).toBe(true)
  })
})

describe('the extraction format (T-111)', () => {
  it('is 48 kHz stereo by default: what Audio Studio loads', async () => {
    const done = extractAudioFromVideo('/v.mp4')
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const s = spawned[0] as Spawned
    expect(ARG(s, '-ar')).toBe('48000')
    expect(ARG(s, '-ac')).toBe('2')
    s.child.emit('close', 0, null)
    await done
  })

  it('is 16 kHz mono when asked for the transcription format', async () => {
    expect(TRANSCRIPTION_AUDIO).toEqual({ sampleRate: 16000, channels: 1 })
    const done = extractAudioFromVideo('/v.mp4', undefined, TRANSCRIPTION_AUDIO)
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const s = spawned[0] as Spawned
    expect(ARG(s, '-ar')).toBe('16000')
    expect(ARG(s, '-ac')).toBe('1')
    expect(ARG(s, '-acodec')).toBe('pcm_s16le')
    s.child.emit('close', 0, null)
    await done
  })

  it('puts the sound on the container\'s clock, in both formats: the pad stage is an output option ahead of the codec (T-125 (2))', async () => {
    // Layer 5 measures the burst of a 0.278 s late sound; this is the command line, for both consumers of the extractor.
    for (const format of [undefined, TRANSCRIPTION_AUDIO]) {
      spawned = []
      const done = extractAudioFromVideo('/v.mp4', undefined, format)
      await vi.waitFor(() => expect(spawned).toHaveLength(1))
      const s = spawned[0] as Spawned
      expect(EXTRACT_CLOCK_FILTER).toBe('aresample=async=1:first_pts=0')
      expect(ARG(s, '-af')).toBe(EXTRACT_CLOCK_FILTER)
      expect(s.args.indexOf('-af'), 'an output option: after the input, before the codec').toBeGreaterThan(s.args.indexOf('-i'))
      expect(s.args.indexOf('-af')).toBeLessThan(s.args.indexOf('-acodec'))
      s.child.emit('close', 0, null)
      await done
    }
  })

  it('refuses a format that is not a whole rate and channel count, before spawning anything', async () => {
    for (const bad of [
      { sampleRate: 0, channels: 1 },
      { sampleRate: 16000.5, channels: 1 },
      { sampleRate: 16000, channels: 0 },
      { sampleRate: Number.NaN, channels: 2 }
    ]) {
      await expect(extractAudioFromVideo('/v.mp4', undefined, bad)).rejects.toThrow(/extract format/)
    }
    expect(spawned).toHaveLength(0)
  })
})
