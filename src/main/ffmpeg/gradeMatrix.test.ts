import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-118 (6) - the probe's color space reaches the temperature stage from EVERY runner that
 * grades a clip.
 *
 * `filters.test.ts` proves the builder appends `scale=out_color_matrix=bt709` for a bt709
 * source and (T-119) the tag alone, `setparams=colorspace=<tag>`, for a bt601 one
 * (smpte170m, bt470bg); this file proves the two runners that build a graph with the grade in it
 * (`runExportJob`, which Clip Kit also drives, and `runConcat`, the compilation) hand the
 * builder what `probeVideo` said. It has to be a unit test and not only a Layer 5 one: on the
 * bundled 7.0.2 the stage changes nothing a decode can see (7.0.2's colorbalance keeps the
 * matrix and the tag), so a runner that dropped the argument would pass the real-binary case
 * there and fail only on the shipped 6.1.1.
 *
 * The real runners run; only the child and the probe are faked. The GIF export carries no
 * grade (T-110(e)) and so no `colorSpace`.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runners set utf8 on both pipes */
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
let probed: { colorSpace?: string } = {}

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    // The command line is what is under test; the child dies the moment it exists.
    setImmediate(() => child.emit('close', 1, null))
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    bitrate: 0,
    sizeBytes: 0,
    ...probed
  })
}))

const { runExportJob } = await import('./export')
const { runConcat } = await import('./concat')
const { runReframe } = await import('./reframe')

const MATRIX = 'scale=out_color_matrix=bt709'
const RETAG = 'setparams=colorspace=bt709'
const GRADE = { brightness: 0, contrast: 1, saturation: 1, temperature: 0.5 }

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-grade-matrix-'))
  spawned = []
  probed = {}
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** The `-vf` of the first ffmpeg the runner spawned. */
function firstVf(): string {
  const args = spawned[0]
  if (!args) throw new Error('the runner never spawned ffmpeg')
  const at = args.indexOf('-vf')
  const vf = args[at + 1]
  if (at < 0 || vf === undefined) throw new Error(`no -vf in ${args.join(' ')}`)
  return vf
}

async function exportClip(colorGrade: typeof GRADE | undefined): Promise<string> {
  await expect(
    runExportJob(
      {
        jobId: 'gm-export',
        sourcePath: '/tmp/in.mp4',
        outDir: scratch,
        clip: {
          id: 'c1',
          name: 'Clip',
          startSec: 0,
          endSec: 5,
          cropRect: null,
          textOverlays: [],
          selectedPresets: ['youtube'],
          colorGrade
        },
        preset: 'youtube'
      },
      () => undefined
    )
  ).rejects.toThrow(/FFmpeg exit 1/)
  return firstVf()
}

async function compileSegment(colorGrade: typeof GRADE | undefined): Promise<string> {
  await expect(
    runConcat({
      jobId: 'gm-concat',
      sourcePath: '/tmp/in.mp4',
      outDir: scratch,
      segments: [{ startSec: 0, endSec: 2, name: 'a', colorGrade }],
      fadeMs: 0,
      width: 1920,
      height: 1080
    })
  ).rejects.toThrow(/segment 0 exit 1/)
  return firstVf()
}

describe("the source's color space reaches the temperature stage from the export (and so Clip Kit)", () => {
  it('appends the matrix stage right after colorbalance when the probe says bt709', async () => {
    probed = { colorSpace: 'bt709' }
    expect(await exportClip(GRADE)).toMatch(/,colorbalance=[^,]+,scale=out_color_matrix=bt709,setparams=colorspace=bt709(?:,|$)/)
  })

  it('an untagged source gets no matrix stage and no tag', async () => {
    probed = {}
    const vf = await exportClip(GRADE)
    expect(vf).toContain('colorbalance=')
    expect(vf).not.toContain(MATRIX)
    expect(vf).not.toContain('setparams')
  })

  // T-119 (4): a bt601-tagged source has its own tag written back, right after colorbalance, and is not rescaled.
  it.each([
    ['a bt601 source (PAL)', 'bt470bg'],
    ['a bt601 source (NTSC)', 'smpte170m']
  ])('%s gets its tag back right after colorbalance, and no matrix stage', async (_label, colorSpace) => {
    probed = { colorSpace }
    const vf = await exportClip(GRADE)
    expect(vf).toMatch(new RegExp(`,colorbalance=[^,]+,setparams=colorspace=${colorSpace}(?:,|$)`))
    expect(vf).not.toContain('out_color_matrix')
    expect(vf).not.toContain(RETAG)
  })

  it('a tagged source with no temperature in the grade gets none either', async () => {
    for (const colorSpace of ['bt709', 'smpte170m', 'bt470bg']) {
      probed = { colorSpace }
      expect(await exportClip({ ...GRADE, temperature: 0 }), colorSpace).not.toContain('setparams')
      expect(await exportClip(undefined), colorSpace).not.toContain('setparams')
    }
  })
})

describe("the source's color space reaches the temperature stage from the compilation", () => {
  it('appends the matrix stage to a graded segment when the probe says bt709', async () => {
    probed = { colorSpace: 'bt709' }
    expect(await compileSegment(GRADE)).toMatch(/,colorbalance=[^,]+,scale=out_color_matrix=bt709,setparams=colorspace=bt709(?:,|$)/)
  })

  it('an untagged source gets no matrix stage and no tag', async () => {
    probed = {}
    const vf = await compileSegment(GRADE)
    expect(vf).toContain('colorbalance=')
    expect(vf).not.toContain(MATRIX)
    expect(vf).not.toContain('setparams')
  })

  it.each([
    ['a bt601 source (NTSC)', 'smpte170m'],
    ['a bt601 source (PAL)', 'bt470bg']
  ])('%s gets its tag back right after colorbalance, and no matrix stage', async (_label, colorSpace) => {
    probed = { colorSpace }
    const vf = await compileSegment(GRADE)
    expect(vf).toMatch(new RegExp(`,colorbalance=[^,]+,setparams=colorspace=${colorSpace}(?:,|$)`))
    expect(vf).not.toContain('out_color_matrix')
    expect(vf).not.toContain(RETAG)
  })
})

// T-125 (9): Reframe builds its picture with `buildVideoFilter` now (it dropped the grade before), so it is the third runner that
// must hand the builder the probe's color space - a graded bt709 source reframed on the shipped 6.1.1 would lose its tag and shift
// its colors exactly as the export's did (T-118).
async function reframeClip(colorGrade: typeof GRADE | undefined): Promise<string> {
  await expect(
    runReframe(
      {
        jobId: 'gm-reframe',
        sourcePath: '/tmp/in.mp4',
        outputPath: path.join(scratch, 'out.mp4'),
        position: 'center',
        startSec: 0,
        endSec: 2,
        outputWidth: 1080,
        outputHeight: 1920,
        colorGrade
      },
      () => undefined
    )
  ).rejects.toThrow(/reframe exit 1/)
  return firstVf()
}

describe("the source's color space reaches the temperature stage from a reframe (T-125 (9))", () => {
  it('appends the matrix stage to a graded reframe when the probe says bt709', async () => {
    probed = { colorSpace: 'bt709' }
    expect(await reframeClip(GRADE)).toMatch(/,colorbalance=[^,]+,scale=out_color_matrix=bt709,setparams=colorspace=bt709(?:,|$)/)
  })

  it('an untagged source gets no matrix stage and no tag', async () => {
    probed = {}
    const vf = await reframeClip(GRADE)
    expect(vf).toContain('colorbalance=')
    expect(vf).not.toContain(MATRIX)
    expect(vf).not.toContain('setparams')
  })

  it.each(['smpte170m', 'bt470bg'])('a %s source gets its tag back right after colorbalance, and no matrix stage', async (colorSpace) => {
    probed = { colorSpace }
    const vf = await reframeClip(GRADE)
    expect(vf).toMatch(new RegExp(`,colorbalance=[^,]+,setparams=colorspace=${colorSpace}(?:,|$)`))
    expect(vf).not.toContain('out_color_matrix')
  })

  it('a reframe with no grade carries no tag stage, whatever the source is', async () => {
    probed = { colorSpace: 'bt709' }
    expect(await reframeClip(undefined)).not.toContain('setparams')
  })
})
