import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CaptionsProgress } from '../../shared/captions'

/**
 * T-89 — the captions progress main reports is only ever a fact.
 *
 * Transcription used to announce `15 + Math.random() * 10` every time the
 * engine printed a line, so the bar jittered between 15 and 25 for as long as
 * the engine ran, and extraction and the SRT write reported a fixed 5 and 95.
 * None of those numbers measured anything. An absent `percent` is how main
 * says "this phase has no measurable progress" (the panel draws an
 * indeterminate bar for it); a number is sent only when it is true — `done` is
 * 100, and burn-in keeps its encode position.
 *
 * Only the child process is faked (cancelSentinel.test.ts's technique): the
 * real runners run. The same fake child lets the burn-in result be checked —
 * `captioned` is false exactly when a ranged burn has no cue inside its range.
 * Layer 5 (media.spec.ts) proves that flag against a real ffmpeg render.
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

let scratch = ''
/** What each spawned child does once the runner has attached its listeners. */
let onSpawn: (child: FakeChild, cmd: string, args: string[]) => void = () => undefined
const spawned: Array<{ cmd: string; args: string[] }> = []

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    const child = new FakeChild()
    spawned.push({ cmd, args })
    // Listeners are attached synchronously after spawn returns; act next tick.
    queueMicrotask(() => onSpawn(child, cmd, args))
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
  extractAudioFromVideo: async () => ({
    wavPath: '/tmp/imagii-t89.wav',
    cleanup: async () => undefined
  })
}))

const { runTranscribe, runBurnIn } = await import('./whisperManager')

const SRT =
  '1\n00:00:00,000 --> 00:00:03,000\nhello there\n\n2\n00:00:03,000 --> 00:00:06,000\nsecond line\n'

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t89-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
  spawned.length = 0
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('runTranscribe — progress without invented numbers (T-89)', () => {
  it('sends no percent for extracting, transcribing or building the SRT; done is 100', async () => {
    // A whisper that prints several timestamped lines, then writes its SRT.
    onSpawn = (child, _cmd, args) => {
      const outputBase = args[args.indexOf('-of') + 1] as string
      child.stdout.emit('data', '[00:00:00.000 --> 00:00:03.000]  hello there\n')
      child.stdout.emit('data', '[00:00:03.000 --> 00:00:06.000]  second line\n')
      child.stdout.emit('data', '[00:00:06.000 --> 00:00:09.000]  third line\n')
      writeFileSync(`${outputBase}.srt`, SRT, 'utf8')
      child.emit('close', 0)
    }

    const events: CaptionsProgress[] = []
    const result = await runTranscribe({ jobId: 'j1', sourcePath: '/tmp/in.mp4' }, (p) =>
      events.push(p)
    )

    expect(result.segments).toHaveLength(2)
    const phases = events.map((e) => e.phase)
    expect(phases[0]).toBe('extracting')
    expect(phases).toContain('transcribing')
    expect(phases.indexOf('building-srt')).toBeGreaterThan(phases.lastIndexOf('transcribing'))
    expect(phases[phases.length - 1]).toBe('done')

    // The claim: a number only where it is true.
    const withPercent = events.filter((e) => e.percent !== undefined)
    expect(withPercent.map((e) => e.phase)).toEqual(['done'])
    expect(withPercent[0]?.percent).toBe(100)
    for (const e of events.filter((x) => x.phase !== 'done')) {
      expect('percent' in e, `${e.phase} carries no percent key`).toBe(false)
    }
  })

  it('still reports where the engine is, as a message — not as a made-up percent', async () => {
    onSpawn = (child, _cmd, args) => {
      const outputBase = args[args.indexOf('-of') + 1] as string
      child.stdout.emit('data', '[00:00:00.000 --> 00:00:03.000]  a\n[00:00:03.000 --> 00:00:07.500]  b\n')
      writeFileSync(`${outputBase}.srt`, SRT, 'utf8')
      child.emit('close', 0)
    }
    const events: CaptionsProgress[] = []
    await runTranscribe({ jobId: 'j2', sourcePath: '/tmp/in.mp4' }, (p) => events.push(p))
    const heard = events.filter((e) => e.phase === 'transcribing' && e.message !== undefined)
    expect(heard).toHaveLength(1)
    expect(heard[0]?.message).toBe('00:00:07.500')
  })

  it('across many engine lines, no transcribing event ever carries a number (the jitter is gone)', async () => {
    onSpawn = (child, _cmd, args) => {
      const outputBase = args[args.indexOf('-of') + 1] as string
      for (let i = 0; i < 60; i += 1) {
        const t = String(i).padStart(2, '0')
        child.stdout.emit('data', `[00:00:${t}.000 --> 00:00:${t}.900]  line ${i}\n`)
      }
      writeFileSync(`${outputBase}.srt`, SRT, 'utf8')
      child.emit('close', 0)
    }
    const events: CaptionsProgress[] = []
    await runTranscribe({ jobId: 'j3', sourcePath: '/tmp/in.mp4' }, (p) => events.push(p))
    const transcribing = events.filter((e) => e.phase === 'transcribing')
    expect(transcribing.length).toBeGreaterThanOrEqual(60)
    expect(transcribing.filter((e) => typeof e.percent === 'number')).toEqual([])
  })
})

describe('runBurnIn — says whether the file got captions (T-89)', () => {
  function writeSrt(): string {
    const file = path.join(scratch, 'captions', 'talk.srt')
    // One cue, 10.0-12.0 s on the SOURCE clock.
    writeFileSync(file, '1\n00:00:10,000 --> 00:00:12,000\nonly line\n', 'utf8')
    return file
  }

  function succeed(): void {
    onSpawn = (child) => {
      child.emit('close', 0)
    }
  }

  const base = (srtPath: string): Parameters<typeof runBurnIn>[0] => ({
    jobId: 'b1',
    videoPath: '/tmp/in.mp4',
    srtPath,
    outputPath: path.join(scratch, 'out.mp4'),
    fontSizePct: 3.2
  })

  it('a whole-video burn is captioned', async () => {
    succeed()
    const res = await runBurnIn(base(writeSrt()), () => undefined)
    expect(res.captioned).toBe(true)
    expect(spawned[0]?.args).toContain('-vf')
  })

  it('a ranged burn with a cue inside it is captioned', async () => {
    succeed()
    const res = await runBurnIn({ ...base(writeSrt()), startSec: 9, endSec: 14 }, () => undefined)
    expect(res.captioned).toBe(true)
    expect(spawned[0]?.args).toContain('-vf')
  })

  it('a ranged burn with NO cue inside it is not captioned — and runs with no subtitle stage', async () => {
    succeed()
    const res = await runBurnIn({ ...base(writeSrt()), startSec: 20, endSec: 25 }, () => undefined)
    expect(res.captioned).toBe(false)
    expect(res.outputPath).toBe(path.join(scratch, 'out.mp4'))
    // The same fact from the other side: the argv has no filter at all.
    expect(spawned[0]?.args).not.toContain('-vf')
  })

  it('a range that ends just before the only cue starts is not captioned', async () => {
    succeed()
    const res = await runBurnIn({ ...base(writeSrt()), startSec: 5, endSec: 10 }, () => undefined)
    expect(res.captioned).toBe(false)
  })
})
