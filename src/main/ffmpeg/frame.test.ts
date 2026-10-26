import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-130 (t) - the command of a Clip Kit thumbnail: what `extractFrame` asks ffmpeg for.
 *
 * Layer 5 ("a Clip Kit thumbnail is the cropped picture", media.spec.ts) is the proof that the pixels come out as the crop; this file is the
 * shape of the command, and the half no decode can see: that a clip WITHOUT a crop runs the very command it always ran (no probe, no `-vf`),
 * that a crop's stage is the one every other runner builds (`cropToFrame`), and where in the argv it sits.
 *
 * The real `extractFrame` runs; only the child and the probe are faked.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 on stderr */
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

let spawned: string[][] = []
vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    // T-132 (4): a thumbnail is not done until the file is there (`-ss` past the last frame exits 0 and writes none), so the fake ffmpeg
    // writes its JPEG, as the real one does, before it exits.
    setImmediate(() => {
      writeFileSync(args[args.length - 1] as string, 'jpeg')
      child.emit('close', 0, null)
    })
    return child
  }
}))

/** What the faked probe reports (the source's size is all the crop needs) and how often it was asked. */
let probedSize = { width: 1920, height: 1080 }
let probeCalls = 0
vi.mock('./probe', () => ({
  probeVideo: async () => {
    probeCalls += 1
    return { duration: 60, ...probedSize, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 }
  }
}))

const { extractFrame } = await import('./frame')
const { cropToFrame } = await import('./filters')

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-frame-'))
  spawned = []
  probeCalls = 0
  probedSize = { width: 1920, height: 1080 }
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]
const OUT = (): string => path.join(scratch, 'thumbs', 'thumb.jpg')

// A centered 9:16 strip of a 16:9 frame: the crop a streamer draws to make a vertical clip (0.3167 of the width, the whole height). Rounded the way
// the editor's rects are (never an exact pixel), so the pixel counts below are the even-rounding's work and not a lucky division.
const NINE_SIXTEEN = { x: 0.3417, y: 0, w: 0.3167, h: 1 }

describe('a thumbnail of a clip with no crop is the command it always was (T-130 (t))', () => {
  it('no crop, a null crop: the same argv, no probe, no filter', async () => {
    for (const [i, crop] of [undefined, null].entries()) {
      spawned = []
      // T-133 (5): a thumbnail goes to a path nothing is at (the kit's folder is fresh), so each call has its own.
      const out = path.join(scratch, 'thumbs', `thumb-${i}.jpg`)
      await extractFrame('/tmp/in.mp4', 1.5, out, crop)
      // T-140 (1): the output is a partial beside the thumbnail (its `.jpg` last, so the image2 muxer is the same); the rest of the argv is as it was.
      const argv = spawned[0] as string[]
      expect(argv.slice(0, -1)).toEqual(['-y', '-ss', '1.500', '-i', '/tmp/in.mp4', '-frames:v', '1', '-q:v', '2', '-update', '1'])
      expect(argv[argv.length - 1]).toMatch(new RegExp(`^${path.join(scratch, 'thumbs', `thumb-${i}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]{8}\\.partial\\.jpg$`))
      expect(spawned).toHaveLength(1)
    }
    expect(probeCalls, 'the source was never probed: there is nothing to read its size for').toBe(0)
  })
})

describe('a thumbnail of a cropped clip is the crop (T-130 (t))', () => {
  it('asks for the clip\'s crop in a -vf, the stage a platform export builds, as an output option ahead of the frame count', async () => {
    await extractFrame('/tmp/in.mp4', 2, OUT(), NINE_SIXTEEN)
    expect(spawned).toHaveLength(1)
    const args = spawned[0] as string[]
    const stage = cropToFrame(NINE_SIXTEEN, { width: 1920, height: 1080 }, null)
    expect(stage, 'the crop is one stage').toHaveLength(1)
    expect(after(args, '-vf')).toBe(stage.join(','))
    expect(args.filter((a) => a === '-vf'), 'one filter option').toHaveLength(1)
    expect(args.indexOf('-vf'), 'an output option: after the input').toBeGreaterThan(args.indexOf('-i'))
    expect(args.indexOf('-vf'), 'and ahead of the frame count').toBeLessThan(args.indexOf('-frames:v'))
    expect(args.indexOf('-ss'), 'the seek stays an input option, before -i').toBeLessThan(args.indexOf('-i'))
    expect(probeCalls, 'the frame\'s pixels were read once').toBe(1)
  })

  it('the numbers are whole even pixels of the SOURCE\'s frame: 9:16 of 1920x1080 is 608x1080 at x=656', async () => {
    await extractFrame('/tmp/in.mp4', 2, OUT(), NINE_SIXTEEN)
    expect(after(spawned[0] as string[], '-vf')).toBe('crop=608:1080:656:0')
  })

  it('reads the size of the file it is given, not a size it assumes', async () => {
    probedSize = { width: 3840, height: 2160 }
    await extractFrame('/tmp/in.mp4', 2, OUT(), NINE_SIXTEEN)
    expect(after(spawned[0] as string[], '-vf')).toBe('crop=1216:2160:1312:0')
  })

  it('a crop that lands on odd pixels is rounded to even ones, the way every other runner rounds it (yuv420p, libx264)', async () => {
    probedSize = { width: 1919, height: 1079 }
    const awkward = { x: 0.2501, y: 0.1003, w: 0.2819, h: 0.5001 }
    await extractFrame('/tmp/in.mp4', 2, OUT(), awkward)
    const stage = after(spawned[0] as string[], '-vf') as string
    const numbers = stage.replace('crop=', '').split(':').map(Number)
    expect(numbers.every((n) => Number.isInteger(n) && n % 2 === 0), stage).toBe(true)
    expect(stage).toBe(cropToFrame(awkward, probedSize, null).join(','))
  })

  it('a rectangle that overshoots the frame by the editor\'s rounding stays inside it', async () => {
    // T-123 (13): the stored rect is offsetWidth / pictureWidth, and a browser rounds a box to whole pixels.
    await extractFrame('/tmp/in.mp4', 2, OUT(), { x: 0.5, y: 0, w: 0.505, h: 1 })
    const [w, h, x, y] = (after(spawned[0] as string[], '-vf') as string).replace('crop=', '').split(':').map(Number) as [number, number, number, number]
    expect(x + w, 'inside the width').toBeLessThanOrEqual(1920)
    expect(y + h, 'inside the height').toBeLessThanOrEqual(1080)
  })

  it('the thumbnail is the crop alone: no scale, no pad, nothing between the crop and the JPEG', async () => {
    await extractFrame('/tmp/in.mp4', 2, OUT(), NINE_SIXTEEN)
    const chain = (after(spawned[0] as string[], '-vf') as string).split(',')
    expect(chain).toHaveLength(1)
    expect(chain[0]).toMatch(/^crop=/)
  })
})
