import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-183 (2): the names main builds from a person's (or a file's) name plus a DESCRIPTIVE tail keep the whole tail when the base is too long. The tail ("_480px_15fps",
 * "_<preset>") is what tells the person which file is which, so the BASE is cut, with room left for `nextFreePath`'s " (N)": a second run of the same name keeps its tail too.
 * The real runners run; only the child (it writes its output and exits 0) and the probe are faked. Layer 5 (media.spec.ts, T-183) holds the same names on the real binary.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runners set utf8 */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  kill(): boolean {
    return true
  }
}
vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    setImmediate(() => {
      writeFileSync(args[args.length - 1] as string, 'what ffmpeg wrote')
      child.stdout.emit('data', 'frame=10\nprogress=end\n')
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({ duration: 60, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { runGifExport } = await import('./gif')
const { runExportJob } = await import('./export')

let out = ''
beforeEach(() => {
  out = mkdtempSync(path.join(tmpdir(), 'imagii-tails-'))
})
afterEach(() => {
  rmSync(out, { recursive: true, force: true })
})
const bytes = (p: string): number => Buffer.byteLength(path.basename(p), 'utf8')

describe('the GIF keeps `_<width>px_<fps>fps` when the video\'s name is long (T-183 (2))', () => {
  const gif = (jobId: string, sourceName: string): ReturnType<typeof runGifExport> =>
    runGifExport({ jobId, sourcePath: '/tmp/in.mp4', outDir: out, startSec: 0, endSec: 3, width: 480, fps: 15, speed: 1, sourceName })

  it('a 250-character base: the first run and the second (taken) both end in the whole tail, and fit', async () => {
    const base = 'g'.repeat(250)
    const first = (await gif('tg-1', base)).outputPath
    const second = (await gif('tg-2', base)).outputPath
    expect(path.basename(first)).toMatch(/^g{200,}_480px_15fps\.gif$/)
    expect(path.basename(second)).toMatch(/^g{200,}_480px_15fps \(2\)\.gif$/)
    expect(bytes(first)).toBeLessThanOrEqual(255)
    expect(bytes(second)).toBeLessThanOrEqual(255)
    expect(readdirSync(out).sort()).toEqual([path.basename(first), path.basename(second)].sort())
  })

  it('a base that fits is the name it always was', async () => {
    expect(path.basename((await gif('tg-3', 'stream')).outputPath)).toBe('stream_480px_15fps.gif')
  })
})

describe('Export\'s default name keeps `_<preset>.mp4` when the source and clip names are long (T-183 (2))', () => {
  const job = (jobId: string, clipName: string): Parameters<typeof runExportJob>[0] => ({
    jobId,
    sourcePath: `/tmp/${'s'.repeat(100)}.mp4`,
    outDir: out,
    clip: { id: 'c', name: clipName, startSec: 1, endSec: 4, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] },
    preset: 'youtube'
  })

  it('a 250-character clip name: the first run and the second both end in `_youtube`, and fit', async () => {
    const first = (await runExportJob(job('te-1', 'c'.repeat(250)), () => undefined)).outputPath
    const second = (await runExportJob(job('te-2', 'c'.repeat(250)), () => undefined)).outputPath
    expect(path.basename(first)).toMatch(/^s{100}_c{100,}_youtube\.mp4$/)
    expect(path.basename(second)).toMatch(/^s{100}_c{100,}_youtube \(2\)\.mp4$/)
    expect(bytes(first)).toBeLessThanOrEqual(255)
    expect(bytes(second)).toBeLessThanOrEqual(255)
  })

  it('names that fit are the name they always were', async () => {
    const res = await runExportJob({ ...job('te-3', 'Cold open'), sourcePath: '/tmp/stream.mp4' }, () => undefined)
    expect(path.basename(res.outputPath)).toBe('stream_Cold open_youtube.mp4')
  })
})

/**
 * T-187 (3): the default name (`<source>_<clip>_<preset>.mp4`, which main builds when a job carries no `outputFilename`) turns a control character in the clip's or the
 * custom preset's name into `_`, as `safeNamePart` does. `safeFileBase` was a second copy of the reserved-only class, so a tab stayed in the file's name.
 */
describe('Export\'s default name has no control character in it (T-187 (3))', () => {
  const job = (jobId: string, clipName: string, custom?: { name: string }): Parameters<typeof runExportJob>[0] => ({
    jobId,
    sourcePath: '/tmp/stream.mp4',
    outDir: out,
    clip: { id: 'c', name: clipName, startSec: 1, endSec: 4, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] },
    preset: 'youtube',
    ...(custom ? { customPreset: { id: 'cp', basePlatformId: 'youtube' as const, width: 1280, height: 720, fps: 30, videoBitrate: '4M', audioBitrate: '128k', ...custom } } : {})
  })

  it('a tab, U+0001 and DEL in the clip name are underscores in the written name', async () => {
    const res = await runExportJob(job('tc-1', 'Clutch\tplay\u0001x\u007fy'), () => undefined)
    expect(path.basename(res.outputPath)).toBe('stream_Clutch_play_x_y_youtube.mp4')
    expect(readdirSync(out)).toEqual(['stream_Clutch_play_x_y_youtube.mp4'])
  })

  it('a tab in a custom preset\'s name is an underscore in its tag', async () => {
    const res = await runExportJob(job('tc-2', 'Cold open', { name: 'My\tpreset' }), () => undefined)
    expect(path.basename(res.outputPath)).toBe('stream_Cold open_My_preset.mp4')
  })

  it('a clip named only with control characters is underscores, and the whole name has none', async () => {
    const res = await runExportJob(job('tc-3', '\t\t'), () => undefined)
    expect(path.basename(res.outputPath)).toBe('stream____youtube.mp4')
    expect(/[\u0000-\u001f\u007f]/.test(path.basename(res.outputPath))).toBe(false)
  })
})
