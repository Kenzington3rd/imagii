import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  FFMPEG_EMPTY_OUTPUT,
  BURN_IN_NO_PICTURE_MESSAGE,
  FRAME_NO_PICTURE_MESSAGE,
  PictureFrames,
  REFRAME_NO_PICTURE_MESSAGE,
  clipNameForSentence,
  exportNoPictureMessage,
  wroteNoPicture
} from './noPicture'
import type { Clip } from '../../shared/clip'

/**
 * T-132 (4) - Export, Reframe and the Clip Kit's thumbnails said "Saved" for a file with no picture in it.
 *
 * ffmpeg exits 0 for a range that lies past the picture, having written either a 261-byte container with no streams ("Output file is empty",
 * a project whose recording got shorter) or an audio-only mp4 (a clip past the last frame of a file whose sound outlasts its picture); the
 * runners looked at the exit code alone. Layer 5 (media.spec.ts) is the proof on real files, on both majors; this file is what the runners do
 * with an ffmpeg that says so, and the half no decode can see: that the evidence is read whole (a chunk that ends mid-line is not a zero), that
 * an ffmpeg which said nothing is not accused, and that the half-file is the job's wreckage and goes.
 */

describe('PictureFrames - the frame count ffmpeg reports with -progress', () => {
  it('reads the last block\'s count: zero is "no picture", anything else is a picture', () => {
    const none = new PictureFrames()
    none.feed('frame=0\nfps=0.00\nprogress=end\n')
    expect(none.none).toBe(true)
    const some = new PictureFrames()
    some.feed('frame=0\nprogress=continue\nframe=1\nprogress=end\n')
    expect(some.none, 'the first block said 0, the last said 1: the last wins (6.1.1 prints a block before the first frame)').toBe(false)
  })

  it('a chunk that ends in the middle of a line is not a zero', () => {
    // "frame=" has arrived and "30" has not: read as it stands, that is frame= with nothing after it. It is held until the line is whole.
    const f = new PictureFrames()
    f.feed('fps=0.00\nframe=')
    expect(f.none).toBe(false)
    f.feed('30\nprogress=end\n')
    expect(f.none).toBe(false)
    const split = new PictureFrames()
    split.feed('frame=1')
    split.feed('2\nprogress=end\n')
    expect(split.none, '12, not 1 and not 2').toBe(false)
    const zero = new PictureFrames()
    zero.feed('fra')
    zero.feed('me=0\nprogr')
    zero.feed('ess=end\n')
    expect(zero.none).toBe(true)
  })

  it('says nothing about a stream that never said (no block seen, a line with something else, a crash before the first block)', () => {
    const f = new PictureFrames()
    expect(f.none).toBe(false)
    f.feed('out_time=00:00:02.000000\nbitrate=N/A\n')
    expect(f.none).toBe(false)
    f.feed('frame=N/A\n')
    expect(f.none, 'a non-number is not a zero').toBe(false)
  })

  it('reads CRLF output and padded numbers', () => {
    const f = new PictureFrames()
    f.feed('frame=   0\r\nprogress=end\r\n')
    expect(f.none).toBe(true)
  })
})

describe('wroteNoPicture - either fact is enough', () => {
  it('is the empty-output line OR a reported zero, and neither alone is needed', () => {
    const zero = new PictureFrames()
    zero.feed('frame=0\n')
    const some = new PictureFrames()
    some.feed('frame=3\n')
    expect(wroteNoPicture(true, new PictureFrames()), 'stderr said it, the progress stream said nothing').toBe(true)
    expect(wroteNoPicture(false, zero), 'no stderr line (the audio-only shape), the progress block says zero').toBe(true)
    expect(wroteNoPicture(false, some)).toBe(false)
    expect(wroteNoPicture(false, new PictureFrames())).toBe(false)
  })

  it('FFMPEG_EMPTY_OUTPUT is the line both majors print, and nothing in a normal run', () => {
    expect(FFMPEG_EMPTY_OUTPUT.test('[out#0/mp4 @ 0x2d457c40] Output file is empty, nothing was encoded(check -ss / -t / -frames parameters if used)')).toBe(true)
    expect(FFMPEG_EMPTY_OUTPUT.test('frame=  108 fps=0.0 q=-1.0 Lsize=     195kB')).toBe(false)
  })
})

describe('the refusals are finished sentences that name what is wrong', () => {
  it('Export names the clip by the name the person gave it, and what to check', () => {
    expect(exportNoPictureMessage({ name: 'Boss fight' })).toBe('The clip "Boss fight" has no picture in the video (check its start and end), so nothing was exported.')
    expect(exportNoPictureMessage({ name: '  ' })).toBe('This clip has no picture in the video (check its start and end), so nothing was exported.')
    expect(exportNoPictureMessage(undefined)).toMatch(/^This clip has no picture/)
  })

  it('every one is one line of at most 240 characters ending in a period, so userFacingError lets it stand', () => {
    for (const message of [exportNoPictureMessage({ name: 'x'.repeat(500) }), REFRAME_NO_PICTURE_MESSAGE, FRAME_NO_PICTURE_MESSAGE, BURN_IN_NO_PICTURE_MESSAGE]) {
      expect(message.length).toBeLessThanOrEqual(240)
      expect(message).not.toContain('\n')
      expect(message).toMatch(/\.$/)
    }
  })

  it('clipNameForSentence: the name as the person sees it, on one line, shortened; null when there is nothing to say', () => {
    expect(clipNameForSentence({ name: '  Boss   fight\n(2) ' })).toBe('Boss fight (2)')
    expect(clipNameForSentence({ name: 'x'.repeat(51) })).toBe(`${'x'.repeat(49)}…`)
    for (const bad of [undefined, {}, { name: '' }, { name: 5 }]) expect(clipNameForSentence(bad as never)).toBeNull()
  })

  // T-133 (3): the cut was by UTF-16 unit, so a name with a glyph outside the BMP (an emoji, a rare CJK character) could be cut between the
  // two halves of one and keep a lone high surrogate before the ellipsis: a broken glyph in the refusal. The cut is by code point.
  it('clipNameForSentence cuts by code point: an astral name is never split inside a glyph (T-133 (3))', () => {
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const name of ['\u{1F525}'.repeat(60), 'é'.repeat(48) + '\u{1F525}'.repeat(5), '\u{20BB7}'.repeat(51) + 'x']) {
      const out = clipNameForSentence({ name }) ?? ''
      expect(out, 'no half of a glyph is left before the ellipsis').not.toMatch(loneSurrogate)
      expect(Array.from(out).length, '49 glyphs and the ellipsis').toBe(50)
      expect(out.endsWith('…')).toBe(true)
    }
    expect(clipNameForSentence({ name: '\u{1F525}'.repeat(60) })).toBe(`${'\u{1F525}'.repeat(49)}…`)
    // The limit counts what the person sees as characters, not units: fifty glyphs are fifty, and stay whole.
    expect(clipNameForSentence({ name: '\u{1F525}'.repeat(50) })).toBe('\u{1F525}'.repeat(50))
    expect(clipNameForSentence({ name: 'é'.repeat(48) + '\u{1F525}\u{1F525}' })).toBe('é'.repeat(48) + '\u{1F525}\u{1F525}')
    // And the sentence built on it still fits the one line userFacingError lets stand.
    expect(exportNoPictureMessage({ name: '\u{1F525}'.repeat(60) }).length).toBeLessThanOrEqual(240)
  })
})

// ── the runners ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runners set utf8 on both pipes */
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

/** What the next spawned ffmpeg does: write its output file (or not), say things, exit. */
let onSpawn: (child: FakeChild, outputPath: string) => void = () => undefined
vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    const outputPath = args[args.length - 1] as string
    setTimeout(() => onSpawn(child, outputPath), 5)
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { runExportJob } = await import('./export')
const { runReframe } = await import('./reframe')
const { extractFrame } = await import('./frame')
const { userFacingError } = await import('../../shared/userFacingError')

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-nopic-'))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

/** An ffmpeg that wrote `bytes`, printed `stdout` and `stderr`, and exited `code`. */
function ffmpegThat(opts: { bytes?: number; stdout?: string[]; stderr?: string; code?: number }): void {
  onSpawn = (child, outputPath) => {
    if (opts.bytes !== undefined) writeFileSync(outputPath, Buffer.alloc(opts.bytes, 1))
    for (const chunk of opts.stdout ?? []) child.stdout.emit('data', chunk)
    if (opts.stderr) child.stderr.emit('data', opts.stderr)
    child.emit('close', opts.code ?? 0)
  }
}

const CLIP: Clip = { id: 'c', name: 'Boss fight', startSec: 6, endSec: 8, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] }
const exportJob = (): Parameters<typeof runExportJob>[0] =>
  ({ jobId: 'np-export', sourcePath: '/tmp/in.mp4', outDir: scratch, clip: CLIP, preset: 'youtube' })
const outputOfExport = (): string => path.join(scratch, 'in_Boss fight_youtube.mp4')
const reframeJob = (): Parameters<typeof runReframe>[0] => ({
  jobId: 'np-reframe',
  sourcePath: '/tmp/in.mp4',
  outputPath: path.join(scratch, 'vertical.mp4'),
  position: 'center',
  startSec: 6,
  endSec: 8,
  outputWidth: 1080,
  outputHeight: 1920
})

describe('runExportJob never says Exported for a file with no picture (T-132 (4))', () => {
  it('the audio-only shape: ffmpeg exits 0, writes an mp4 and says frame=0 - a sentence, and the file goes', async () => {
    ffmpegThat({ bytes: 35_000, stdout: ['frame=0\nfps=0.00\nprogress=end\n'] })
    const err = await runExportJob(exportJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(err?.message).toBe('The clip "Boss fight" has no picture in the video (check its start and end), so nothing was exported.')
    expect(userFacingError(err, 'Export failed.').message, 'it reaches the person as written').toBe(err?.message)
    expect(existsSync(outputOfExport()), 'the audio-only mp4 is the job\'s wreckage, not a result').toBe(false)
  })

  it('the empty shape: ffmpeg prints "Output file is empty" and leaves a 261-byte stub - the same sentence, the stub goes', async () => {
    ffmpegThat({ bytes: 261, stderr: '[out#0/mp4 @ 0x2d457c40] Output file is empty, nothing was encoded(check -ss / -t / -frames parameters if used)\n' })
    const err = await runExportJob(exportJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/^The clip "Boss fight" has no picture/)
    expect(existsSync(outputOfExport())).toBe(false)
  })

  it('the empty-output line is found even when later output pushes it out of the kept tail of stderr', async () => {
    const flood = 'frame=  108 fps=0.0 q=-1.0 size=    1kB time=00:00:04.00 bitrate= 2.0kbits/s speed=1x\n'.repeat(400)
    ffmpegThat({ bytes: 261, stderr: `Output file is empty, nothing was encoded\n${flood}` })
    const err = await runExportJob(exportJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/has no picture/)
  })

  it('a legitimate one-frame segment is a success and keeps its file (a 10-20 ms clip)', async () => {
    ffmpegThat({ bytes: 62_000, stdout: ['frame=0\nprogress=continue\n', 'frame=1\nout_time_us=20000\nprogress=end\n'] })
    const result = await runExportJob({ ...exportJob(), clip: { ...CLIP, startSec: 1, endSec: 1.02 } }, () => undefined)
    expect(result.outputPath).toBe(outputOfExport())
    expect(existsSync(outputOfExport())).toBe(true)
  })

  it('a report that ends in the middle of the count is not a zero: the 30 frames of a normal clip stay a success', async () => {
    ffmpegThat({ bytes: 62_000, stdout: ['out_time=00:00:01.000000\nframe=', '30\nprogress=end\n'] })
    const result = await runExportJob(exportJob(), () => undefined)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it('an ffmpeg that reported no frame count at all is not accused', async () => {
    ffmpegThat({ bytes: 62_000, stdout: ['out_time=00:00:02.000000\n'] })
    const result = await runExportJob(exportJob(), () => undefined)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it('a real failure keeps its own words: the exit code still decides', async () => {
    ffmpegThat({ bytes: 100, stdout: ['frame=0\n'], stderr: 'boom', code: 1 })
    const err = await runExportJob(exportJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/^FFmpeg exit 1: boom/)
  })
})

describe('runReframe never says Saved for a vertical file with no picture (T-132 (4))', () => {
  it('frame=0 on exit 0 (the audio-only shape) and "Output file is empty" (the stub) are the same sentence, and the file goes', async () => {
    ffmpegThat({ bytes: 35_000, stdout: ['frame=0\nprogress=end\n'] })
    const audioOnly = await runReframe(reframeJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(audioOnly?.message).toBe(REFRAME_NO_PICTURE_MESSAGE)
    expect(userFacingError(audioOnly, 'Reframe failed.').message).toBe(REFRAME_NO_PICTURE_MESSAGE)
    expect(existsSync(path.join(scratch, 'vertical.mp4'))).toBe(false)
    ffmpegThat({ bytes: 261, stderr: 'Output file is empty, nothing was encoded\n' })
    const stub = await runReframe(reframeJob(), () => undefined).then(() => null, (e: Error) => e)
    expect(stub?.message).toBe(REFRAME_NO_PICTURE_MESSAGE)
    expect(existsSync(path.join(scratch, 'vertical.mp4'))).toBe(false)
  })

  it('a clip with a picture is a success and keeps its file', async () => {
    ffmpegThat({ bytes: 62_000, stdout: ['frame=1\nprogress=end\n'] })
    const result = await runReframe(reframeJob(), () => undefined)
    expect(existsSync(result.outputPath)).toBe(true)
  })
})

describe('extractFrame never resolves without a file (T-132 (4))', () => {
  const OUT = (): string => path.join(scratch, 'thumbs', 'thumb.jpg')

  it('exit 0 and no file (a time past the last frame): a sentence', async () => {
    ffmpegThat({})
    const err = await extractFrame('/tmp/in.mp4', 50, OUT()).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(FRAME_NO_PICTURE_MESSAGE)
    expect(userFacingError(err, 'Clip Kit failed.').message).toBe(FRAME_NO_PICTURE_MESSAGE)
  })

  it('exit 0 and an empty file: the same', async () => {
    ffmpegThat({ bytes: 0 })
    const err = await extractFrame('/tmp/in.mp4', 50, OUT()).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(FRAME_NO_PICTURE_MESSAGE)
    expect(existsSync(OUT()), 'an empty file is not left behind as a thumbnail').toBe(false)
  })

  // T-133 (5): the old rule judged the file by its mtime against the spawn (2 s slack), so ffmpeg writing nothing over an old file was caught
  // by the file looking OLD - and a good thumbnail on a share whose clock runs behind was refused by the same test. The two cannot both be
  // told apart by a clock. The kit's folder is fresh (`makeKitDir`), so a file already at the target is not the kit's: it is refused BEFORE
  // ffmpeg runs, left exactly as it was, and what is there afterwards is this run's.
  it('a file already at the path is refused before ffmpeg runs, and is left exactly as it was (T-133 (5))', async () => {
    mkdirSync(path.dirname(OUT()), { recursive: true })
    writeFileSync(OUT(), 'last time\'s thumbnail')
    const longAgo = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(OUT(), longAgo, longAgo)
    let spawned = 0
    onSpawn = (child) => {
      spawned += 1
      child.emit('close', 0)
    }
    const err = await extractFrame('/tmp/in.mp4', 50, OUT()).then(() => null, (e: Error) => e)
    expect(err, 'refused').not.toBeNull()
    expect(spawned, 'ffmpeg never started').toBe(0)
    expect(readFileSync(OUT(), 'utf8'), 'and the old file is not ours to touch').toBe('last time\'s thumbnail')
  })

  it('a good thumbnail whose timestamp is far behind this machine\'s clock (a share running slow) is a success (T-133 (5))', async () => {
    onSpawn = (child, outputPath) => {
      writeFileSync(outputPath, Buffer.alloc(20_000, 1))
      const behind = new Date(Date.now() - 60_000)
      utimesSync(outputPath, behind, behind)
      child.emit('close', 0)
    }
    const result = await extractFrame('/tmp/in.mp4', 1.5, OUT())
    expect(result.outputPath).toBe(OUT())
    expect(existsSync(OUT()), 'and the kit keeps it').toBe(true)
  })

  it('exit 0 and a JPEG written now: resolves with its path', async () => {
    ffmpegThat({ bytes: 20_000 })
    const result = await extractFrame('/tmp/in.mp4', 1.5, OUT())
    expect(result.outputPath).toBe(OUT())
  })
})
