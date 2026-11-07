import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CaptionsProgress } from '../../shared/captions'
import { BURN_IN_NO_PICTURE_MESSAGE } from '../ffmpeg/noPicture'

/**
 * T-133 (4) - the caption burn-in said "Captions burned in" over a file with no picture.
 *
 * The ranged burn-in was the one ranged video writer left without the guard T-131 (1) and T-132 (4) gave Export, Reframe and the Clip Kit's
 * thumbnails. A range that lies past the PICTURE exits 0 having written an audio-only mp4 (the sound outlasts the picture; stderr says nothing)
 * or a stream-less stub ("Output file is empty"), and `code === 0` alone resolved. Executed on both majors (7.0.2 and 6.1.1): exit 0, frame=0
 * in the last `-progress` block, an audio-only output. Layer 5 (media.spec.ts) is the proof on real files; this is what the real `runBurnIn`
 * does with an ffmpeg that says so, and the half no decode can see: that the evidence is read whole (a chunk that ends mid-line is not a zero),
 * that an ffmpeg which said nothing is not accused, and that the half-file and the shifted SRT are the job's wreckage and go.
 *
 * Only the child process and the probe are faked; the real runner runs.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 on both pipes */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitCode: number | null = null
  kill(): boolean {
    return true
  }
}

let scratch = ''
let onSpawn: (child: FakeChild, args: string[]) => void = () => undefined

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    queueMicrotask(() => onSpawn(child, args))
    return child
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => scratch, isPackaged: false },
  net: { request: () => ({}) }
}))
vi.mock('./paths', () => ({
  whisperExePath: () => ({ path: '/x/whisper-cli.exe', exists: true, sizeBytes: 1 }),
  whisperModelPath: () => ({ path: '/x/model.bin', exists: true, sizeBytes: 1 }),
  captionsOutputDir: () => path.join(scratch, 'captions'),
  modelsDir: () => path.join(scratch, 'models')
}))
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: async () => ({ wavPath: '/tmp/imagii-t133.wav', cleanup: async () => undefined })
}))
vi.mock('../ffmpeg/probe', () => ({
  probeVideo: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { runBurnIn } = await import('./whisperManager')
const { userFacingError } = await import('../../shared/userFacingError')

const SRT = '1\n00:00:06,500 --> 00:00:07,500\na cue inside the clip\n'

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t133-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

/** An ffmpeg that wrote `bytes` to its output, printed `stdout` chunks and `stderr`, and exited `code`. */
function ffmpegThat(opts: { bytes?: number; stdout?: string[]; stderr?: string; code?: number }): void {
  onSpawn = (child, args) => {
    const outputPath = args[args.length - 1] as string
    if (opts.bytes !== undefined) writeFileSync(outputPath, Buffer.alloc(opts.bytes, 1))
    for (const chunk of opts.stdout ?? []) child.stdout.emit('data', chunk)
    if (opts.stderr) child.stderr.emit('data', opts.stderr)
    child.emit('close', opts.code ?? 0)
  }
}

function job(opts: { ranged?: boolean } = {}): Parameters<typeof runBurnIn>[0] {
  const srtPath = path.join(scratch, 'captions', 'in.srt')
  writeFileSync(srtPath, SRT, 'utf8')
  return {
    jobId: 't133-burn',
    videoPath: '/tmp/in.mp4',
    srtPath,
    outputPath: path.join(scratch, 'out-captioned.mp4'),
    fontSizePct: 4,
    ...(opts.ranged === false ? {} : { startSec: 6, endSec: 8 })
  }
}

const settle = async (req: Parameters<typeof runBurnIn>[0], events: CaptionsProgress[] = []): Promise<Error | null> =>
  runBurnIn(req, (p) => events.push(p)).then(() => null, (e: Error) => e)

describe('runBurnIn never says Captions burned in for a file with no picture (T-133 (4))', () => {
  it('the refusal is one finished line userFacingError lets stand, naming what to check', () => {
    expect(BURN_IN_NO_PICTURE_MESSAGE).toMatch(/^This part of the video has no picture \(check the clip's start and end\), so no captioned video was saved\.$/)
    expect(BURN_IN_NO_PICTURE_MESSAGE.length).toBeLessThanOrEqual(240)
  })

  it('the audio-only shape: ffmpeg exits 0, writes an mp4 and says frame=0 - a finished sentence, and the file goes', async () => {
    ffmpegThat({ bytes: 50_000, stdout: ['frame=0\nfps=0.00\nout_time=00:00:00.000000\nprogress=end\n'] })
    const req = job()
    const events: CaptionsProgress[] = []
    const err = await settle(req, events)
    expect(err, 'refused').not.toBeNull()
    expect(err?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(userFacingError(err, 'Burn-in failed.').message, 'a finished sentence stands as written').toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(existsSync(req.outputPath), 'an mp4 with a sound and no picture is not the captioned video').toBe(false)
    expect(events.some((e) => e.phase === 'done'), 'and nothing says it is done').toBe(false)
  })

  it('the empty shape: ffmpeg prints "Output file is empty" and leaves a stub - the same sentence, the stub goes', async () => {
    ffmpegThat({ bytes: 261, stderr: 'Output file is empty, nothing was encoded (check -ss / -t / -frames parameters if used)\n' })
    const req = job()
    const err = await settle(req)
    expect(err, 'refused').not.toBeNull()
    expect(err?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(existsSync(req.outputPath)).toBe(false)
  })

  it('the shifted SRT is the job\'s means, not its output: it goes with the refusal', async () => {
    ffmpegThat({ bytes: 50_000, stdout: ['frame=0\nprogress=end\n'] })
    const req = job()
    await settle(req)
    expect(readdirSync(path.join(scratch, 'captions')), 'only the person\'s own SRT is left beside it').toEqual(['in.srt'])
  })

  it('the empty-output line is found even when later output pushes it out of the kept tail of stderr', async () => {
    ffmpegThat({ bytes: 261, stderr: `Output file is empty, nothing was encoded\n${'x'.repeat(20_000)}\n` })
    const err = await settle(job())
    expect(err, 'refused').not.toBeNull()
    expect(err?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
  })

  it('a whole-video burn is held to the same fact (the guard is the runner\'s, not the range\'s)', async () => {
    ffmpegThat({ bytes: 50_000, stdout: ['frame=0\nprogress=end\n'] })
    const err = await settle(job({ ranged: false }))
    expect(err, 'refused').not.toBeNull()
    expect(err?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
  })

  it('a clip with a picture is a success: the file stays and the burn says it is done', async () => {
    ffmpegThat({ bytes: 60_000, stdout: ['frame=15\nout_time=00:00:01.000000\nprogress=continue\n', 'frame=30\nout_time=00:00:02.000000\nprogress=end\n'] })
    const req = job()
    const events: CaptionsProgress[] = []
    const err = await settle(req, events)
    expect(err).toBeNull()
    expect(existsSync(req.outputPath)).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ phase: 'done', percent: 100 })
  })

  it('a legitimate one-frame clip (a 10-20 ms range) is a success and keeps its file', async () => {
    ffmpegThat({ bytes: 12_000, stdout: ['frame=1\nprogress=end\n'] })
    const req = job()
    expect(await settle(req)).toBeNull()
    expect(existsSync(req.outputPath)).toBe(true)
  })

  it('a report that ends in the middle of the count is not a zero: the 30 frames of a normal clip stay a success', async () => {
    ffmpegThat({ bytes: 60_000, stdout: ['frame=0\nprogress=continue\nfram', 'e=30\nprogress=end\n'] })
    expect(await settle(job())).toBeNull()
  })

  it('an ffmpeg that reported no frame count at all is not accused', async () => {
    ffmpegThat({ bytes: 60_000, stdout: ['out_time=00:00:01.000000\nprogress=end\n'] })
    expect(await settle(job())).toBeNull()
  })

  it('a real failure keeps its own words: the exit code still decides', async () => {
    ffmpegThat({ bytes: 100, stderr: 'Unable to open /x/in.srt\n', code: 1 })
    const err = await settle(job())
    expect(err, 'refused').not.toBeNull()
    expect(err?.message).toMatch(/^burn-in exit 1: /)
    expect(err?.message).not.toBe(BURN_IN_NO_PICTURE_MESSAGE)
  })
})
