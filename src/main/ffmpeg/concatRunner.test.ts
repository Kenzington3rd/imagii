import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-125 (1) - the command lines of a compilation: what each SEGMENT is written as, and how the join writes the file.
 *
 * `tests/integration/media.spec.ts` (Layer 5) is the proof that the sound stays on its picture across eight joins; this file
 * is the shape of the two commands, for the half of the change no decode can see. The segment extension is not behavior-bearing
 * for the drift (PCM in an MP4 joins clean too, measured on both majors), so only a pin on the command keeps the intermediate
 * Matroska; the join's `-c:v copy` / `-c:a aac` is behavior-bearing and is pinned here AND measured there.
 *
 * The real runner runs; only the child and the probe are faked, and the child succeeds so the join is reached.
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

let spawned: string[][] = []
/** What the join's list file held at the moment the join was spawned (the runner removes it afterwards). */
let listText = ''
/** What the fake ffmpeg prints on its stderr before it exits 0, by command: null is silence. T-131 (1): ffmpeg says things and still exits 0. */
let says: ((args: string[]) => string | null) | null = null
/** The join writes its output file (as ffmpeg does) so a test can see whether the runner took it away again. */
let joinWrites = false
/** What the probe answers: the picture's length in seconds, or an Error (a recording whose header has no duration). T-131 (2). */
let probedSec: number | Error = 60
/** The exit code the fake ffmpeg closes with, by command: null is 0 (T-136 (15): the concat demuxer exits 254 when it cannot open its FIRST input). */
let exitsWith: ((args: string[]) => number) | null = null
/** Every child the runner spawned, in order, so a test can mark one as killed on the user's behalf. */
let children: FakeChild[] = []

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    children.push(child)
    spawned.push(args)
    const isJoin = args.includes('concat')
    if (isJoin) listText = readFileSync(args[args.indexOf('-i') + 1] as string, 'utf8')
    if (isJoin && joinWrites) writeFileSync(args[args.length - 1] as string, 'half a compilation')
    setImmediate(() => {
      const text = says?.(args) ?? null
      if (text !== null) child.stderr.emit('data', text)
      child.emit('close', exitsWith?.(args) ?? 0, null)
    })
    return child
  }
}))
/** The frame rate the faked probe reports (T-130 (q)): 0 is "the file does not say". */
let probedFps = 30
vi.mock('./probe', () => ({
  probeVideo: async () => {
    if (probedSec instanceof Error) throw probedSec
    return {
      duration: probedSec,
      width: 1920,
      height: 1080,
      fps: probedFps,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 0,
      sizeBytes: 0
    }
  }
}))

const { runConcat, runPipComposite, SEGMENT_EXTENSION, SEGMENT_AUDIO_CODEC, FFMPEG_EMPTY_OUTPUT, FFMPEG_UNREADABLE_PART } = await import('./concat')
const { outputFolderRefusal } = await import('./outputPath')
const { killAsCancelled } = await import('./cancelMark')
const { userFacingError } = await import('../../shared/userFacingError')

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-concat-runner-'))
  spawned = []
  listText = ''
  probedFps = 30
  says = null
  joinWrites = false
  probedSec = 60
  exitsWith = null
  children = []
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function compile(fadeMs: number): Promise<{ segments: string[][]; join: string[] }> {
  await runConcat({
    jobId: 'cr-job',
    sourcePath: '/tmp/in.mp4',
    outDir: scratch,
    segments: [
      { startSec: 0, endSec: 2, name: 'a' },
      { startSec: 5, endSec: 8, name: 'b' },
      { startSec: 10, endSec: 12, name: 'c' }
    ],
    fadeMs,
    width: 1280,
    height: 720
  })
  expect(spawned, 'three segments and the join').toHaveLength(4)
  return { segments: spawned.slice(0, 3), join: spawned[3] as string[] }
}

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('a compilation segment is Matroska with PCM sound (T-125 (1))', () => {
  it('each segment is a .mkv in the compilation scratch folder, its sound uncompressed', async () => {
    const { segments } = await compile(0)
    segments.forEach((args, i) => {
      const out = args[args.length - 1] as string
      expect(path.basename(out), `segment ${i}`).toBe(`seg-cr-job-${i}.mkv`)
      expect(path.basename(path.dirname(out)), `segment ${i} is in the scratch folder`).toBe('imagii-concat')
      expect(after(args, '-c:a'), `segment ${i}'s sound`).toBe('pcm_s16le')
      expect(args, `segment ${i} has no AAC and no bitrate for it`).not.toContain('aac')
      expect(args).not.toContain('-b:a')
      expect(after(args, '-c:v'), `segment ${i}'s picture is the one H.264 encode`).toBe('libx264')
    })
    expect(SEGMENT_EXTENSION).toBe('mkv')
    expect(SEGMENT_AUDIO_CODEC).toBe('pcm_s16le')
  })

  // T-127 (4): the picture of a segment whose length is not a whole number of frames came out one or two frames longer than its sound, the
  // join laid the next segment after the picture's length, and the sound fell behind at every join (Layer 5, "fractional segments do not
  // walk the picture off its sound", measures it on real files). The option is an OUTPUT option, so its place is after `-i`, beside the
  // other output options and ahead of the path; this pins that and nothing about the join.
  it('each segment stops at its shorter stream: one -shortest, after the input and just ahead of the segment path (T-127 (4))', async () => {
    const { segments } = await compile(0)
    segments.forEach((args, i) => {
      expect(args.filter((a) => a === '-shortest'), `segment ${i} has exactly one -shortest`).toHaveLength(1)
      expect(args.indexOf('-shortest'), `segment ${i}: an output option, after -i`).toBeGreaterThan(args.indexOf('-i'))
      expect(args[args.length - 2], `segment ${i}: the last option before the path`).toBe('-shortest')
    })
  })

  it('the join copies the picture and encodes the sound ONCE, to AAC at 192 kbps', async () => {
    const { join } = await compile(0)
    expect(after(join, '-f')).toBe('concat')
    expect(after(join, '-c:v'), 'the picture is copied').toBe('copy')
    expect(after(join, '-c:a'), 'the sound is the compilation\'s one AAC encode').toBe('aac')
    expect(after(join, '-b:a')).toBe('192k')
    expect(join, 'no bare `-c copy` (it would carry the segments\' PCM into the MP4)').not.toContain('-c')
    expect(after(join, '-movflags')).toBe('+faststart')
  })

  it('the join\'s list names the segments the runner wrote, in order', async () => {
    const { segments } = await compile(0)
    const written = segments.map((a) => a[a.length - 1] as string)
    expect(listText.split('\n')).toEqual(written.map((p) => `file '${p}'`))
  })

  it('the fades are untouched: the sound\'s fades ride on the segment\'s -af, ahead of the PCM write', async () => {
    const { segments } = await compile(300)
    const first = after(segments[0] as string[], '-af') ?? ''
    const middle = after(segments[1] as string[], '-af') ?? ''
    const last = after(segments[2] as string[], '-af') ?? ''
    expect(first, 'no fade in on the first segment').not.toContain('afade=t=in')
    expect(first).toContain('afade=t=out')
    expect(middle).toContain('afade=t=in')
    expect(middle).toContain('afade=t=out')
    expect(last).toContain('afade=t=in')
    expect(last, 'no fade out on the last segment').not.toContain('afade=t=out')
  })
})

// T-130 (q): the compilation was written at 30 fps whatever the recording was, so a 60 fps recording lost half its frames in a montage while a
// 60 fps platform export did not. The rate is the source's up to 60 (`compileFps`), written into the fps stage AND `-r` of every segment. The
// real files are read back in Layer 5 ("the compilation follows the source's rate"); this is the half no decode can see - that `-r` and the
// stage are the SAME derived value, on every segment, and that the probe's "no rate" falls back rather than writing `-r 0`.
describe('a compilation segment is written at the source\'s rate, up to 60 (T-130 (q))', () => {
  const rateOf = (args: string[]): { r: string | undefined; stage: string | undefined } => ({
    r: after(args, '-r'),
    stage: (after(args, '-vf') ?? '').split(',')[0]
  })

  it.each([
    [24, '24'],
    [25, '25'],
    [30, '30'],
    [50, '50'],
    [60, '60']
  ])('a %s fps source: every segment\'s -r and fps stage say %s', async (fps, text) => {
    probedFps = fps
    const { segments } = await compile(0)
    segments.forEach((args, i) => expect(rateOf(args), `segment ${i}`).toEqual({ r: text, stage: `fps=${text}` }))
  })

  it('a source faster than 60 is written at 60', async () => {
    probedFps = 120
    const { segments } = await compile(0)
    segments.forEach((args, i) => expect(rateOf(args), `segment ${i}`).toEqual({ r: '60', stage: 'fps=60' }))
  })

  it('59.94 stays 59.94 (not 60), and 29.97 stays 29.97', async () => {
    for (const fps of [60000 / 1001, 30000 / 1001]) {
      probedFps = fps
      spawned = []
      const { segments } = await compile(0)
      segments.forEach((args, i) => expect(rateOf(args), `segment ${i} of ${fps}`).toEqual({ r: String(fps), stage: `fps=${fps}` }))
    }
  })

  it('a file that states no rate (the probe\'s 0) is written at the fallback 30, never at -r 0', async () => {
    probedFps = 0
    const { segments } = await compile(0)
    segments.forEach((args, i) => expect(rateOf(args), `segment ${i}`).toEqual({ r: '30', stage: 'fps=30' }))
  })

  it('every segment of one compilation has the same rate, so the stream-copy join sees one', async () => {
    probedFps = 50
    const { segments } = await compile(300)
    expect(new Set(segments.map((a) => after(a, '-r'))).size).toBe(1)
  })
})

describe('a compilation never says Saved for a file with clips missing (T-131 (1))', () => {
  // Layer 5 ("a compilation survives a source whose sound does not cover a segment") is the proof on real files, on both majors, and
  // runs the real binary against the two patterns below. This is the half no decode can see: the commands, and what the runner does with
  // an ffmpeg that exits 0 and says it wrote nothing.
  const spec = (segments: Array<[number, number]>, extra = {}): Parameters<typeof runConcat>[0] => ({
    jobId: 'cr-loud',
    sourcePath: '/tmp/in.mp4',
    outDir: scratch,
    segments: segments.map(([startSec, endSec], i) => ({ startSec, endSec, name: `s${i}`, ...extra })),
    fadeMs: 0,
    width: 1280,
    height: 720
  })
  // T-132 (12): the clip is named by the name the person sees in the list ("s1" here; the spec names its segments s0, s1, ...), never by its
  // position in the compilation: default names are creation-numbered, so "Clip 2" could be the clip the person calls "Clip 5".
  const FAIL_SENTENCE = /^The clip "s1" has no picture in the video \(check its start and end\), so nothing was saved\.$/

  it('every segment is padded to its length in the output: the last -af stage is apad=whole_dur, with -shortest kept', async () => {
    const { segments } = await compile(0)
    const lengths = ['2.000', '3.000', '2.000']
    segments.forEach((args, i) => {
      const af = (after(args, '-af') ?? '').split(',')
      expect(af.at(-1), `segment ${i}: the pad is last`).toBe(`apad=whole_dur=${lengths[i]}`)
      expect(args, `segment ${i} still ends at its shorter stream`).toContain('-shortest')
    })
  })

  it('a clip at 2x is padded to HALF its range, the length it has in the output', async () => {
    await runConcat(spec([[10, 14]], { speedMultiplier: 2 }))
    expect(after(spawned[0] as string[], '-af')).toBe('atempo=2.0000,apad=whole_dur=2.000')
  })

  it('the two patterns are the lines ffmpeg prints (the wording Layer 5 reads off the real binary)', () => {
    expect(FFMPEG_EMPTY_OUTPUT.test('[out#0/matroska @ 0x2b90c7c0] Output file is empty, nothing was encoded(check -ss / -t / -frames parameters if used)')).toBe(true)
    expect(FFMPEG_UNREADABLE_PART.test("[concat @ 0x40dea0c0] Impossible to open '/tmp/imagii-concat/seg-x-1.mkv'")).toBe(true)
    expect(FFMPEG_EMPTY_OUTPUT.test('frame=  108 fps=0.0 q=-1.0 Lsize=     195kB')).toBe(false)
    expect(FFMPEG_UNREADABLE_PART.test("Opening '/tmp/imagii-concat/seg-x-1.mkv' for reading")).toBe(false)
  })

  it('a segment ffmpeg wrote nothing for (exit 0, the stub) fails the job there, in a sentence, with no join', async () => {
    says = (args) => (args.at(-1)?.endsWith('seg-cr-loud-1.mkv') ? '[out#0/matroska @ 0x1] Output file is empty, nothing was encoded' : null)
    const err = await runConcat(spec([[1, 3], [20, 22], [2, 4]])).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(FAIL_SENTENCE)
    expect(spawned, 'the empty segment is the last thing that ran: no third segment, no join').toHaveLength(2)
    expect(spawned.some((a) => a.includes('concat'))).toBe(false)
    // It reaches the person as it is written (a finished sentence), not as the generic fallback.
    expect(userFacingError(err, 'Compilation failed.').message).toBe(err?.message)
  })

  it('the empty-segment line is found even when later output pushes it out of the kept tail', async () => {
    const flood = 'frame=  108 fps=0.0 q=-1.0 size=    1kB time=00:00:04.00 bitrate= 2.0kbits/s speed=1x\n'.repeat(400)
    says = (args) => (args.at(-1)?.endsWith('seg-cr-loud-1.mkv') ? `Output file is empty, nothing was encoded\n${flood}` : null)
    const err = await runConcat(spec([[1, 3], [20, 22]])).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(FAIL_SENTENCE)
  })

  it('a join that cannot open a segment (exit 0, "Impossible to open") fails, in a sentence, and its short file is removed', async () => {
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 0x1] Impossible to open '/tmp/imagii-concat/seg-cr-loud-1.mkv'" : null)
    const err = await runConcat(spec([[1, 3], [20, 22]])).then(() => null, (e: Error) => e)
    // T-132 (12): it names the clip (the segment file in ffmpeg's line is seg-<job>-<index>.mkv) and says what to do next.
    expect(err?.message).toBe(
      'The compilation could not be put together because the clip "s1" could not be read, so nothing was saved. Try again, and if it keeps happening, leave that clip out.'
    )
    expect(userFacingError(err, 'Compilation failed.').message).toBe(err?.message)
    const join = spawned.find((a) => a.includes('concat')) as string[]
    expect(existsSync(join[join.length - 1] as string), 'the half a compilation the join wrote is gone').toBe(false)
  })

  it('a clip the person named is named in both refusals, as they typed it (T-132 (12))', async () => {
    says = (args) => (args.at(-1)?.endsWith('seg-cr-loud-1.mkv') ? 'Output file is empty, nothing was encoded' : null)
    const named = (name: string) => ({ ...spec([[1, 3], [20, 22]]), segments: [{ startSec: 1, endSec: 3, name: 'Intro' }, { startSec: 20, endSec: 22, name }] })
    const empty = await runConcat(named('Boss fight')).then(() => null, (e: Error) => e)
    expect(empty?.message).toBe('The clip "Boss fight" has no picture in the video (check its start and end), so nothing was saved.')
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 0x1] Impossible to open '/tmp/imagii-concat/seg-cr-loud-1.mkv'" : null)
    const lost = await runConcat(named('Boss fight')).then(() => null, (e: Error) => e)
    expect(lost?.message).toContain('the clip "Boss fight" could not be read')
  })

  it('a clip with no usable name is called by its place, and a join line that names no segment of THIS job gets the sentence that does not (T-132 (12), T-137 (12))', async () => {
    says = (args) => (args.at(-1)?.endsWith('seg-cr-loud-1.mkv') ? 'Output file is empty, nothing was encoded' : null)
    const blank = { ...spec([[1, 3], [20, 22]]), segments: [{ startSec: 1, endSec: 3, name: 'Intro' }, { startSec: 20, endSec: 22, name: '   ' }] }
    const empty = await runConcat(blank).then(() => null, (e: Error) => e)
    expect(empty?.message).toBe('Clip 2 of the compilation has no picture in the video (check its start and end), so nothing was saved.')
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 0x1] Impossible to open '/tmp/imagii-concat/seg-someone-else-1.mkv'" : null)
    const lost = await runConcat(spec([[1, 3], [4, 6]])).then(() => null, (e: Error) => e)
    expect(lost?.message).toBe(
      'The compilation could not be put together because one of its clips could not be read, so nothing was saved. Try again, and if it keeps happening, compile fewer clips at a time.'
    )
    expect(userFacingError(lost, 'Compilation failed.').message).toBe(lost?.message)
  })

  it('a long or multi-line name is shortened and kept on one line, so the refusal stays a finished sentence', async () => {
    says = (args) => (args.at(-1)?.endsWith('seg-cr-loud-1.mkv') ? 'Output file is empty, nothing was encoded' : null)
    const name = `Best of the\nweek ${'x'.repeat(200)}`
    const big = { ...spec([[1, 3], [20, 22]]), segments: [{ startSec: 1, endSec: 3, name: 'Intro' }, { startSec: 20, endSec: 22, name }] }
    const empty = await runConcat(big).then(() => null, (e: Error) => e)
    expect(empty?.message).not.toContain('\n')
    expect(empty?.message).toContain('The clip "Best of the week xxx')
    expect(empty?.message).toContain('…" has no picture')
    expect(userFacingError(empty, 'Compilation failed.').message, 'still reaches the person as written').toBe(empty?.message)
  })

  it('a join that says nothing of the kind still succeeds, and keeps its file', async () => {
    joinWrites = true
    const { outputPath } = await runConcat(spec([[1, 3], [4, 6]]))
    expect(existsSync(outputPath)).toBe(true)
  })
})

describe('picture-in-picture pads the base\'s sound to the base\'s length, and -shortest stays (T-131 (2))', () => {
  // `-shortest` ended the composite where a SHORTER base sound did: a Record take whose microphone dropped at 5 s of 12 came out 5.0 s long
  // (measured; the overlay follows the base's frames, so the picture went with it). Layer 5 (T-131 (2)) proves what comes out on real files,
  // on both majors; this is the argument, and what the runner does when the base's length is not known.
  const pip = (): Promise<{ outputPath: string }> =>
    runPipComposite('pip-job', '/tmp/base.mp4', '/tmp/overlay.mp4', path.join(scratch, 'pip.mp4'), {
      overlayWidth: 360,
      position: 'bottom-right',
      margin: 32
    })

  it('the sound is padded to the base\'s whole length (finite), just ahead of -shortest, which stays', async () => {
    probedSec = 12.04
    await pip()
    expect(spawned).toHaveLength(1)
    const args = spawned[0] as string[]
    expect(after(args, '-af')).toBe('apad=whole_dur=12.040')
    expect(args.indexOf('-af'), 'an output option, ahead of -shortest').toBeLessThan(args.indexOf('-shortest'))
    expect(args.filter((a) => a === '-shortest'), 'it is also what ends the output when the overlay outlasts the base').toHaveLength(1)
    expect(args.join(' ')).not.toMatch(/apad(?!=whole_dur=\d)/)
    expect(after(args, '-map'), 'the picture still comes from the graph').toBe('[v]')
  })

  it('a base whose length cannot be read is not padded: the output ends where its sound does, as it always did', async () => {
    probedSec = new Error('ffprobe returned no usable duration for the video')
    await pip()
    const args = spawned[0] as string[]
    expect(args).not.toContain('-af')
    expect(args).toContain('-shortest')
  })
})

describe('a compilation checks its output folder before it encodes anything (T-125 (10))', () => {
  it('a folder that cannot be made is refused in a sentence that names it, and not one segment was encoded first', async () => {
    // A FILE where a parent should be: the way an unplugged drive's path fails.
    writeFileSync(path.join(scratch, 'blocker'), 'x')
    const err = await runConcat({
      jobId: 'cr-gone',
      sourcePath: '/tmp/in.mp4',
      outDir: path.join(scratch, 'blocker', 'Clips'),
      segments: [{ startSec: 0, endSec: 2, name: 'a' }, { startSec: 5, endSec: 8, name: 'b' }],
      fadeMs: 0,
      width: 1280,
      height: 720
    }).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(outputFolderRefusal('Clips'))
    expect(spawned, 'ffmpeg was never started: the whole segment encode used to run before this was found out').toEqual([])
  })
})

// T-136 (15): the join's "Impossible to open" guard was `code === 0 && lostAPart`. The concat demuxer exits 0 when it cannot open a LATER input
// (it ends the file there) but 254 when it cannot open its FIRST (measured on both majors; Layer 5, "a compilation whose FIRST segment is lost at
// the join"), so a lost first segment reached the person as the raw "concat exit 254" and then as the generic missing-file or video-tool sentence,
// about the person's source. The line is the evidence, whatever the exit code: every lost part names its clip.
describe('a join that cannot open a segment names its clip whatever its exit code (T-136 (15))', () => {
  const spec = (names: string[]): Parameters<typeof runConcat>[0] => ({
    jobId: 'cr-lost',
    sourcePath: '/tmp/in.mp4',
    outDir: scratch,
    segments: names.map((name, i) => ({ startSec: i * 10, endSec: i * 10 + 2, name })),
    fadeMs: 0,
    width: 1280,
    height: 720
  })
  const lostLine = (index: number): string => `[concat @ 0x1] Impossible to open '/tmp/imagii-concat/seg-cr-lost-${index}.mkv'`
  const lostFirst = 'The compilation could not be put together because the clip "Intro" could not be read, so nothing was saved. Try again, and if it keeps happening, leave that clip out.'

  it.each([254, 1, 255, 234])('the FIRST segment lost, exit %i: the sentence names the clip and the half-written file is removed', async (code) => {
    joinWrites = true
    exitsWith = (args) => (args.includes('concat') ? code : 0)
    says = (args) => (args.includes('concat') ? lostLine(0) : null)
    const err = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(lostFirst)
    expect(err?.message, 'not the raw runner line').not.toMatch(/concat exit/)
    expect(userFacingError(err, 'Compilation failed.').message, 'reaches the person as written').toBe(lostFirst)
    const join = spawned.find((a) => a.includes('concat')) as string[]
    expect(existsSync(join[join.length - 1] as string), 'the join\'s output is gone').toBe(false)
  })

  it('a later segment lost at exit 0 and at a non-zero exit say the same thing (the guard is the line, not the code)', async () => {
    const run = async (code: number): Promise<string | undefined> => {
      joinWrites = true
      exitsWith = (args) => (args.includes('concat') ? code : 0)
      says = (args) => (args.includes('concat') ? lostLine(1) : null)
      return (await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e))?.message
    }
    const exit0 = await run(0)
    expect(exit0).toContain('the clip "Boss fight" could not be read')
    expect(await run(254)).toBe(exit0)
    expect(await run(1)).toBe(exit0)
  })

  it('control: a join that fails WITHOUT the line is still the runner\'s own failure (the guard keys on the evidence, not on any non-zero exit)', async () => {
    exitsWith = (args) => (args.includes('concat') ? 254 : 0)
    says = (args) => (args.includes('concat') ? 'Invalid data found when processing input' : null)
    const err = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(/^concat exit 254: /)
    expect(err?.message).not.toContain('could not be read')
  })

  it('control: a join that opens everything and exits 0 still succeeds', async () => {
    joinWrites = true
    const { outputPath } = await runConcat(spec(['Intro', 'Boss fight']))
    expect(existsSync(outputPath)).toBe(true)
  })

  it('a Cancel wins over the line: a join the user killed after it printed the line is a cancel, not a lost clip', async () => {
    exitsWith = (args) => (args.includes('concat') ? 254 : 0)
    says = (args) => {
      if (!args.includes('concat')) return null
      killAsCancelled(children[children.length - 1] as unknown as ChildProcess)
      return lostLine(0)
    }
    const err = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(userFacingError(err, 'Compilation failed.').cancelled).toBe(true)
  })
})

// T-137 (12): FFMPEG_UNREADABLE_PART was /Impossible to open/ and FFMPEG_EMPTY_OUTPUT /Output file is empty/, tested against ALL of stderr, and ffmpeg
// echoes the person's paths there at the default log level ("Output #0, mp4, to '<dir>/<name>.mp4':", "Input #0, ..., from '<source>':"). A folder or a
// source named with either phrase failed a good compilation (any exit, since T-136 (15) made the line the evidence). Each is now ffmpeg's own line.
describe('a path that contains a phrase ffmpeg uses is not ffmpeg saying it (T-137 (12))', () => {
  const spec = (outDir: string, sourcePath = '/tmp/in.mp4'): Parameters<typeof runConcat>[0] => ({
    jobId: 'cr-echo',
    sourcePath,
    outDir,
    segments: [{ startSec: 0, endSec: 2, name: 'a' }, { startSec: 5, endSec: 8, name: 'b' }],
    fadeMs: 0,
    width: 1280,
    height: 720
  })

  it('a compilation saved into a folder named "Impossible to open" succeeds: the join echoes its output path and says nothing is wrong', async () => {
    const outDir = path.join(scratch, 'Impossible to open')
    mkdirSync(outDir)
    joinWrites = true
    says = (args) => (args.includes('concat') ? `Input #0, concat, from '/tmp/imagii-concat/list-cr-echo.txt':\nOutput #0, mp4, to '${args[args.length - 1] as string}':\n` : null)
    const { outputPath } = await runConcat(spec(outDir))
    expect(path.dirname(outputPath)).toBe(outDir)
    expect(existsSync(outputPath), 'the join\'s file is the result, not wreckage').toBe(true)
  })

  it('so does a folder whose name is the whole line, and a Windows path with the phrase in it', async () => {
    const outDir = path.join(scratch, "Impossible to open 'x/seg-cr-echo-0.mkv'")
    mkdirSync(outDir, { recursive: true })
    joinWrites = true
    says = (args) => (args.includes('concat') ? `Output #0, mp4, to '${args[args.length - 1] as string}':\nOutput #0, mp4, to 'C:\\Users\\me\\Impossible to open\\seg-cr-echo-0.mkv':\n` : null)
    await expect(runConcat(spec(outDir))).resolves.toBeDefined()
  })

  it('a source in a folder named "Output file is empty" is not an empty segment: every segment echoes the source it reads', async () => {
    joinWrites = true
    says = (args) => (args.includes('concat') ? null : "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/videos/Output file is empty/in.mp4':\nOutput #0, matroska, to '/tmp/imagii-concat/seg-cr-echo-0.mkv':\n")
    await expect(runConcat(spec(scratch, '/videos/Output file is empty/in.mp4'))).resolves.toBeDefined()
  })

  it('control: ffmpeg\'s own lines still fail the job, with the folder named the same', async () => {
    const outDir = path.join(scratch, 'Impossible to open')
    mkdirSync(outDir)
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 0x1] Impossible to open '/tmp/imagii-concat/seg-cr-echo-1.mkv'" : null)
    const lost = await runConcat(spec(outDir)).then(() => null, (e: Error) => e)
    expect(lost?.message).toContain('the clip "b" could not be read')
    says = (args) => (args.at(-1)?.endsWith('seg-cr-echo-1.mkv') ? '[out#0/matroska @ 0x1] Output file is empty, nothing was encoded' : null)
    const empty = await runConcat(spec(path.join(scratch, 'Output file is empty'))).then(() => null, (e: Error) => e)
    expect(empty?.message).toMatch(/^The clip "b" has no picture/)
  })

  it('an "Impossible to open" line about a file that is not one of the runner\'s segments is not a lost part', async () => {
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 0x1] Impossible to open '/somewhere/else.mkv'" : null)
    await expect(runConcat(spec(scratch))).resolves.toBeDefined()
  })
})

// T-138 (1): the two guards above (T-136 (15), T-137 (12)) hold the join's "Impossible to open" line as the Linux binaries print it, `[concat @ 0x...]`. The shipped
// Windows ffmpeg prints the pointer bare (`[concat @ 00007fffff45eb80]`, mingw-w64's %p), in CRLF lines, after a stats line ending in `\r`: the lost part was
// not seen and a join that lost a segment was "Saved" (exit 0) or reported as the raw "concat exit 254". This runs the real runner over the line as the
// Windows exe prints it, at both exit codes the demuxer uses.
describe('a join that cannot open a segment is a lost clip on the Windows binary\'s line too (T-138 (1))', () => {
  const spec = (names: string[]): Parameters<typeof runConcat>[0] => ({
    jobId: 'cr-win',
    sourcePath: '/tmp/in.mp4',
    outDir: scratch,
    segments: names.map((name, i) => ({ startSec: i * 10, endSec: i * 10 + 2, name })),
    fadeMs: 0,
    width: 1280,
    height: 720
  })
  const WINDOWS_TEMP = 'C:\\Users\\x\\AppData\\Local\\Temp\\imagii-concat'
  const STATS = 'size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x    '
  // [what the Windows exe printed, as one stderr chunk]
  const WINDOWS_SHAPES: ReadonlyArray<readonly [string, (index: number) => string]> = [
    ['mingw-w64 pointer, LF', (i) => `[concat @ 00007fffff45eb80] Impossible to open '${WINDOWS_TEMP}\\seg-cr-win-${i}.mkv'\n`],
    ['Microsoft CRT pointer (uppercase), CRLF', (i) => `[concat @ 000001A1D4A2B940] Impossible to open '${WINDOWS_TEMP}\\seg-cr-win-${i}.mkv'\r\n`],
    ['mingw-w64 pointer straight after a stats line ending in CR', (i) => `${STATS}\r[concat @ 00007fffff45eb80] Impossible to open '${WINDOWS_TEMP}\\seg-cr-win-${i}.mkv'\r\n`]
  ]
  const named = (name: string): string =>
    `The compilation could not be put together because the clip "${name}" could not be read, so nothing was saved. Try again, and if it keeps happening, leave that clip out.`

  it.each(WINDOWS_SHAPES)('%s: a LATER segment lost at exit 0 is the clip, not "Saved", and the short file is removed', async (_name, printed) => {
    joinWrites = true
    says = (args) => (args.includes('concat') ? printed(1) : null)
    const err = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(named('Boss fight'))
    const join = spawned.find((a) => a.includes('concat')) as string[]
    expect(existsSync(join[join.length - 1] as string), 'the join\'s output is gone').toBe(false)
  })

  it.each(WINDOWS_SHAPES)('%s: the FIRST segment lost at exit 254 is the clip, not "concat exit 254"', async (_name, printed) => {
    joinWrites = true
    exitsWith = (args) => (args.includes('concat') ? 254 : 0)
    says = (args) => (args.includes('concat') ? printed(0) : null)
    const err = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(err?.message).toBe(named('Intro'))
    expect(err?.message).not.toMatch(/concat exit/)
    expect(userFacingError(err, 'Compilation failed.').message, 'reaches the person as written').toBe(named('Intro'))
  })

  it('the line in a Windows log that echoes the output path first (CRLF throughout) is still found, and a good Windows log is still a success', async () => {
    joinWrites = true
    says = (args) => (args.includes('concat')
      ? `Input #0, concat, from '${WINDOWS_TEMP}\\list-cr-win.txt':\r\nOutput #0, mp4, to 'C:\\Users\\x\\Videos\\Impossible to open\\a_compilation.mp4':\r\nframe=   10 fps=0.0 Lsize=      12kB time=00:00:01.00 speed=21.1x    \r\n`
      : null)
    await expect(runConcat(spec(['Intro', 'Boss fight']))).resolves.toBeDefined()
    says = (args) => (args.includes('concat') ? `${STATS}\r[concat @ 00007fffff45eb80] Impossible to open '${WINDOWS_TEMP}\\seg-cr-win-1.mkv'\r\n` : null)
    const lost = await runConcat(spec(['Intro', 'Boss fight'])).then(() => null, (e: Error) => e)
    expect(lost?.message).toBe(named('Boss fight'))
  })

  it('a Windows "Impossible to open" line about a file that is not one of the runner\'s segments is not a lost part', async () => {
    joinWrites = true
    says = (args) => (args.includes('concat') ? "[concat @ 00007fffff45eb80] Impossible to open 'C:\\Users\\x\\Videos\\else.mkv'\r\n" : null)
    await expect(runConcat(spec(['Intro', 'Boss fight']))).resolves.toBeDefined()
  })
})
