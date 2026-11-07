import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * T-161 (2) - the engine's .srt is rewritten clean before anything reads it. The engine itself is not installed in any test environment, so a fake
 * whisper (captionsProgress.test.ts's technique) writes the file the real one writes, tags and all, and the runner's own write-back is what runs.
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

let scratch = ''
let engineWrites = ''

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    queueMicrotask(() => {
      writeFileSync(`${args[args.indexOf('-of') + 1] as string}.srt`, engineWrites, 'utf8')
      child.emit('close', 0)
    })
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
  extractAudioFromVideo: async () => ({ wavPath: '/tmp/imagii-t161.wav', cleanup: async () => undefined })
}))

const { runTranscribe } = await import('./whisperManager')

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t161-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('runTranscribe - non-speech cues never become captions (T-161 (2))', () => {
  it('rewrites the .srt on disk without them, and the segments it returns have none', async () => {
    engineWrites =
      '1\n00:00:00,000 --> 00:00:02,000\n [BLANK_AUDIO]\n\n2\n00:00:02,000 --> 00:00:04,000\n hello there\n\n' +
      '3\n00:00:04,000 --> 00:00:06,000\n (upbeat music)\n\n4\n00:00:06,000 --> 00:00:08,000\n [laughs] that was close\n\n5\n00:00:08,000 --> 00:00:09,000\n [MUSIC]\n'
    const result = await runTranscribe({ jobId: 't1', sourcePath: '/tmp/in.mp4' }, () => undefined)
    const onDisk = readFileSync(result.srtPath as string, 'utf8')
    expect(onDisk).not.toMatch(/BLANK_AUDIO|MUSIC|upbeat/)
    expect(onDisk.startsWith('1\n00:00:02,000 --> 00:00:04,000\n hello there')).toBe(true)
    expect(result.segments.map((s) => s.text)).toEqual([' hello there', ' [laughs] that was close'])
  })

  it('a file of tags alone is an empty transcript, not a refusal (T-162 (1): and it keeps no file)', async () => {
    engineWrites = '1\n00:00:00,000 --> 00:00:30,000\n [BLANK_AUDIO]\n'
    const result = await runTranscribe({ jobId: 't2', sourcePath: '/tmp/in.mp4' }, () => undefined)
    expect(result.segments).toEqual([])
    expect(result.srtPath).toBeNull()
  })
})

describe('runTranscribe - a run with no speech leaves no transcript (T-162 (1))', () => {
  const files = (): string[] => readdirSync(path.join(scratch, 'captions'))

  it('a tag-only output answers srtPath null and segments [], and the run\'s own file is gone', async () => {
    engineWrites = '1\n00:00:00,000 --> 00:00:02,000\n [MUSIC]\n\n2\n00:00:02,000 --> 00:00:04,000\n (upbeat music)\n'
    const result = await runTranscribe({ jobId: 'n1', sourcePath: '/tmp/in.mp4' }, () => undefined)
    expect(result.srtPath).toBeNull()
    expect(result.segments).toEqual([])
    expect(files()).toEqual([])
  })

  it('an earlier transcript in the captions folder is not touched by a later empty run', async () => {
    const earlier = path.join(scratch, 'captions', 'in-1.srt')
    writeFileSync(earlier, '1\n00:00:00,000 --> 00:00:01,000\nkept\n', 'utf8')
    engineWrites = '1\n00:00:00,000 --> 00:00:30,000\n [BLANK_AUDIO]\n'
    await runTranscribe({ jobId: 'n2', sourcePath: '/tmp/in.mp4' }, () => undefined)
    expect(files()).toEqual(['in-1.srt'])
    expect(readFileSync(earlier, 'utf8')).toContain('kept')
  })

  it('a mixed output is unchanged: a path, the speech segments, the file on disk', async () => {
    engineWrites = '1\n00:00:00,000 --> 00:00:02,000\n [MUSIC]\n\n2\n00:00:02,000 --> 00:00:04,000\n hello there\n'
    const result = await runTranscribe({ jobId: 'n3', sourcePath: '/tmp/in.mp4' }, () => undefined)
    expect(typeof result.srtPath).toBe('string')
    expect(result.segments.map((x) => x.text)).toEqual([' hello there'])
    expect(readFileSync(result.srtPath as string, 'utf8')).toBe('1\n00:00:02,000 --> 00:00:04,000\n hello there\n')
  })
})
