import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'
import { isCancelledError } from '../../shared/cancel'
import { drainRuns } from '../ffmpeg/cancelLatch'

/**
 * T-114 - the delete in `runAudioReattach` is aimed only at a file the job made.
 *
 * Re-attach renders the cleaned sound to `<output>.cleaned.wav` and removes it in a `finally`,
 * success or failure. If a file the person already has sits at that exact name AND is one of
 * the job's inputs (the sound being cleaned, or the video), the delete would destroy it - so a
 * guard refuses before anything runs. That guard was the soft `assert()`: it throws in dev and
 * LOGS AND CONTINUES under NODE_ENV=production, so with that variable set the job ran to the end
 * and the `finally` deleted the user's source (shown by execution). It is `assertAlways` now;
 * these tests force production on and use real files, with only the child process and the two
 * probes faked.
 *
 * T-127 (3): and the same delete has to HAPPEN when the app is quit mid-job, not only when the person presses Cancel: the last describe
 * holds a mux child until it is killed, slows the unlink down, and asks the question the before-quit handler asks.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 */
  }
}
/** T-127 (3): when set, the Nth spawn (1-based) closes only once it has been killed, as a real ffmpeg does ~ms after the signal. */
let holdSpawn: number | null = null
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  held = false
  kill(): boolean {
    if (this.held) setTimeout(() => this.emit('close', null, 'SIGKILL'), 5)
    return true
  }
}
const spawned: string[][] = []
/** T-127 (3): when set, removing the scratch WAV takes this long (a slow disk, an antivirus scan). */
let slowUnlinkMs = 0

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    if (holdSpawn === spawned.length) child.held = true
    else setImmediate(() => child.emit('close', 0, null))
    return child
  }
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    unlink: async (file: Parameters<typeof real.unlink>[0]) => {
      if (slowUnlinkMs > 0 && String(file).endsWith('.cleaned.wav')) await new Promise((resolve) => setTimeout(resolve, slowUnlinkMs))
      return real.unlink(file)
    }
  }
})
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: 8, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))
vi.mock('../ffmpeg/probe', () => ({
  probeVideo: async () => ({ duration: 8, width: 640, height: 480, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { runAudioReattach, cancelAllAudioJobs } = await import('./process')

const PRECIOUS = 'the only copy of the streamer\'s recording'
let dir = ''
const prevEnv = process.env.NODE_ENV

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-reattach-collision-'))
  spawned.length = 0
  holdSpawn = null
  slowUnlinkMs = 0
  process.env.NODE_ENV = 'production'
})
afterEach(() => {
  process.env.NODE_ENV = prevEnv
  rmSync(dir, { recursive: true, force: true })
})

describe('runAudioReattach never deletes a file it reads, whatever NODE_ENV is (T-114)', () => {
  const spec = (over: { sourcePath: string; videoPath: string }) => ({
    jobId: 'reattach-collision',
    outputPath: path.join(dir, 'out.mp4'),
    chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] },
    ...over
  })

  it('the sound being cleaned sits where the scratch WAV would go: refused, file intact, nothing run', async () => {
    const wav = path.join(dir, 'out.cleaned.wav')
    writeFileSync(wav, PRECIOUS)
    await expect(
      runAudioReattach(spec({ sourcePath: wav, videoPath: path.join(dir, 'video.mp4') }), () => undefined)
    ).rejects.toThrow(/would overwrite a file this job reads/)
    expect(existsSync(wav), 'the file is still there').toBe(true)
    expect(readFileSync(wav, 'utf8')).toBe(PRECIOUS)
    expect(spawned, 'ffmpeg was never started').toEqual([])
  })

  it('the video sits where the scratch WAV would go: refused, file intact, nothing run', async () => {
    const wav = path.join(dir, 'out.cleaned.wav')
    writeFileSync(wav, PRECIOUS)
    await expect(
      runAudioReattach(spec({ sourcePath: path.join(dir, 'voice.wav'), videoPath: wav }), () => undefined)
    ).rejects.toThrow(/would overwrite a file this job reads/)
    expect(readFileSync(wav, 'utf8')).toBe(PRECIOUS)
    expect(spawned).toEqual([])
  })

  it('the control: no collision runs both passes and removes only its own scratch WAV', async () => {
    const wav = path.join(dir, 'out.cleaned.wav')
    const voice = path.join(dir, 'voice.wav')
    writeFileSync(voice, PRECIOUS)
    writeFileSync(wav, 'scratch from this job') // the fake export "wrote" it
    await runAudioReattach(spec({ sourcePath: voice, videoPath: path.join(dir, 'video.mp4') }), () => undefined)
    expect(spawned.length, 'export pass + mux pass').toBe(2)
    expect(existsSync(wav), 'the scratch WAV went').toBe(false)
    expect(readFileSync(voice, 'utf8'), 'the source is untouched').toBe(PRECIOUS)
  })
})

describe('a quit in the middle of a re-attach waits for the scratch WAV to go (T-127 (3))', () => {
  it('the mux pass is killed, the scratch WAV takes 150 ms to remove, and the quit is released only after it is gone', async () => {
    const wav = path.join(dir, 'out.cleaned.wav')
    const voice = path.join(dir, 'voice.wav')
    writeFileSync(voice, PRECIOUS)
    writeFileSync(wav, 'scratch from the export pass') // the fake export pass "wrote" it
    holdSpawn = 2 // the mux pass: running until it is killed
    slowUnlinkMs = 150
    const running = runAudioReattach(
      { jobId: 'reattach-quit', outputPath: path.join(dir, 'out.mp4'), sourcePath: voice, videoPath: path.join(dir, 'video.mp4'), chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] } },
      () => undefined
    ).then(
      () => null,
      (err: unknown) => err
    )
    for (let i = 0; i < 200 && spawned.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(spawned.length, 'the export pass finished and the mux pass is running').toBe(2)
    expect(existsSync(wav), 'the scratch WAV exists while the mux reads it').toBe(true)

    // What the before-quit handler does: kill everything, then wait (bounded) for the cleanup the kills start.
    cancelAllAudioJobs()
    await expect(drainRuns(2000)).resolves.toBe('drained')
    expect(existsSync(wav), 'the quit is released only when the scratch WAV is gone (the delete takes 150 ms)').toBe(false)
    expect(isCancelledError(await running), 'and the job ended as a cancel').toBe(true)
    expect(readFileSync(voice, 'utf8'), 'the source is untouched').toBe(PRECIOUS)
  })

  it('the export pass killed first leaves no scratch WAV either (the delete of a partial render)', async () => {
    const voice = path.join(dir, 'voice.wav')
    writeFileSync(voice, PRECIOUS)
    holdSpawn = 1 // the export pass itself is the one running
    const running = runAudioReattach(
      { jobId: 'reattach-quit-1', outputPath: path.join(dir, 'out.mp4'), sourcePath: voice, videoPath: path.join(dir, 'video.mp4'), chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] } },
      () => undefined
    ).then(
      () => null,
      (err: unknown) => err
    )
    for (let i = 0; i < 200 && spawned.length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    const wav = path.join(dir, 'out.cleaned.wav')
    writeFileSync(wav, 'half a render') // ffmpeg opened it
    slowUnlinkMs = 150
    cancelAllAudioJobs()
    await expect(drainRuns(2000)).resolves.toBe('drained')
    expect(existsSync(wav)).toBe(false)
    expect(isCancelledError(await running)).toBe(true)
    expect(spawned.length, 'the mux pass never started').toBe(1)
  })
})
