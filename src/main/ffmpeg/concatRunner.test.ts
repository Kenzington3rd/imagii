import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    if (args.includes('concat')) listText = readFileSync(args[args.indexOf('-i') + 1] as string, 'utf8')
    setImmediate(() => child.emit('close', 0, null))
    return child
  }
}))
/** The frame rate the faked probe reports (T-130 (q)): 0 is "the file does not say". */
let probedFps = 30
vi.mock('./probe', () => ({
  probeVideo: async () => ({
    duration: 60,
    width: 1920,
    height: 1080,
    fps: probedFps,
    videoCodec: 'h264',
    audioCodec: 'aac',
    bitrate: 0,
    sizeBytes: 0
  })
}))

const { runConcat, SEGMENT_EXTENSION, SEGMENT_AUDIO_CODEC } = await import('./concat')
const { outputFolderRefusal } = await import('./outputPath')

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-concat-runner-'))
  spawned = []
  listText = ''
  probedFps = 30
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
