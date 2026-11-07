import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CaptionsProgress } from '../../shared/captions'
import { EVEN_PICTURE } from '../ffmpeg/filters'

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
    queueMicrotask(() => {
      // T-140 (1): the burn-in's ffmpeg writes a partial beside the file the person named and the runner swaps it in when the run is whole, so a
      // child that exits 0 has written it (the transcription's whisper writes its .srt where `-of` says, and no row here reads it).
      if (!args.includes('-osrt')) writeFileSync(args[args.length - 1] as string, 'a burned mp4')
      onSpawn(child, cmd, args)
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
  extractAudioFromVideo: async () => ({
    wavPath: '/tmp/imagii-t89.wav',
    cleanup: async () => undefined
  })
}))
// T-111: a burn probes its video for the frame it draws on and the length it runs.
let probeResult: { duration: number; width: number; height: number } | null = {
  duration: 100,
  width: 1920,
  height: 1080
}
vi.mock('../ffmpeg/probe', () => ({
  probeVideo: async () => {
    if (probeResult === null) throw new Error('ffprobe exit 1: could not read the file')
    return { ...probeResult, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 }
  }
}))

const { runTranscribe, runBurnIn } = await import('./whisperManager')

const SRT =
  '1\n00:00:00,000 --> 00:00:03,000\nhello there\n\n2\n00:00:03,000 --> 00:00:06,000\nsecond line\n'

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t89-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
  spawned.length = 0
  probeResult = { duration: 100, width: 1920, height: 1080 }
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
    // The same fact from the other side: no `subtitles` stage in the argv. T-114: the chain is
    // still the even-size stage alone - libx264 dies at exit 187 on an odd frame whether or not
    // a caption is drawn on it.
    const args = spawned[0]?.args ?? []
    expect(args[args.indexOf('-vf') + 1]).toBe(EVEN_PICTURE)
    expect(args.join(' ')).not.toContain('subtitles')
  })

  it('the subtitle stage follows the even-size stage, joined by one comma outside the quoted style (T-114)', async () => {
    succeed()
    await runBurnIn(base(writeSrt()), () => undefined)
    const args = spawned[0]?.args ?? []
    const chain = args[args.indexOf('-vf') + 1] ?? ''
    expect(chain.startsWith(`${EVEN_PICTURE},subtitles=`)).toBe(true)
    // The only commas outside the quotes are the one the join wrote.
    const outsideQuotes = chain.replace(/'[^']*'/g, "''")
    expect(outsideQuotes.match(/,/g)).toHaveLength(1)
  })

  it('a range that ends just before the only cue starts is not captioned', async () => {
    succeed()
    const res = await runBurnIn({ ...base(writeSrt()), startSec: 5, endSec: 10 }, () => undefined)
    expect(res.captioned).toBe(false)
  })
})

/**
 * T-111 — the burn-in percent is ffmpeg's own position over the length of the file
 * being written. It was `5 + 0.5 per second encoded`: 10% after 10 s of a two-hour
 * VOD, 99% an hour in, and the same on a 20-second clip. Only the child (and the
 * probe that says how long the video is) is faked; the real runner parses what the
 * real `-progress` prints.
 */
describe('runBurnIn — the percent is measured (T-111)', () => {
  const srtFile = (): string => {
    const file = path.join(scratch, 'captions', 'talk.srt')
    writeFileSync(file, '1\n00:00:10,000 --> 00:00:12,000\nonly line\n', 'utf8')
    return file
  }
  const req = (extra: Record<string, unknown> = {}): Parameters<typeof runBurnIn>[0] => ({
    jobId: 'b2',
    videoPath: '/tmp/in.mp4',
    srtPath: srtFile(),
    outputPath: path.join(scratch, 'out.mp4'),
    fontSizePct: 3.2,
    ...extra
  })
  /** ffmpeg's `-progress` block, ending in the position the way the real one does. */
  const block = (outTime: string): string =>
    `frame=10\nfps=30.0\nout_time_us=0\nout_time_ms=0\nout_time=${outTime}\nspeed=2x\nprogress=continue\n`
  const run = async (
    r: Parameters<typeof runBurnIn>[0],
    positions: string[]
  ): Promise<CaptionsProgress[]> => {
    onSpawn = (child) => {
      for (const t of positions) child.stdout.emit('data', block(t))
      child.emit('close', 0)
    }
    const events: CaptionsProgress[] = []
    await runBurnIn(r, (p) => events.push(p))
    return events
  }
  /** The numbers the burn reported (an event with no `percent` — indeterminate — is not one). */
  const percents = (events: CaptionsProgress[]): number[] =>
    events.filter((e) => e.phase === 'burning-in' && typeof e.percent === 'number').map((e) => e.percent as number)

  it('opens with no number, goes determinate at 0 once the length is known, and ends at done = 100', async () => {
    const events = await run(req(), [])
    // T-113: the opening event is sent BEFORE the video is probed, so it cannot know a length — it
    // used to say 0%, and a probe that then failed left a determinate 0% standing forever.
    expect(events[0]).toMatchObject({ phase: 'burning-in' })
    expect('percent' in (events[0] as object), 'the opening event carries no percent key').toBe(false)
    // The length is known (the probe answered), so the bar becomes a real one at 0.
    expect(events[1]).toMatchObject({ phase: 'burning-in', percent: 0 })
    expect(events[events.length - 1]).toMatchObject({ phase: 'done', percent: 100 })
  })

  it('reports the encode position over the whole video\'s length', async () => {
    const events = await run(req(), ['00:00:25.000000', '00:00:50.000000', '00:01:15.500000'])
    expect(percents(events)).toEqual([0, 25, 50, 75.5])
  })

  it('a ranged burn is measured on the OUTPUT: 5 s into a 20 s range is 25%, not 5% of the source', async () => {
    const events = await run(req({ startSec: 10, endSec: 30 }), ['00:00:05.000000', '00:00:10.000000'])
    expect(percents(events)).toEqual([0, 25, 50])
  })

  it('a range that runs past the end of the source is measured on what the source has', async () => {
    // 100 s source, range 90-200: the file is 10 s long.
    const events = await run(req({ startSec: 90, endSec: 200 }), ['00:00:05.000000'])
    expect(percents(events)).toEqual([0, 50])
  })

  it('never runs ahead of the work: 10 s into a 2-hour video is a tenth of a percent', async () => {
    probeResult = { duration: 7200, width: 1920, height: 1080 }
    // 10 s of 7200 is 0.14% — under the half-percent step a new event needs, so the bar stays at
    // its 0 (T-113: the 0 is sent once the length is known, and the step counts from it) — and
    // 72 s is exactly 1%. The old formula said 5 + 0.5 x 10 = 10 at the first position.
    const events = await run(req(), ['00:00:10.000000', '00:01:12.000000'])
    expect(percents(events)).toEqual([0, 1])
  })

  it('never reports 100 while the file is still being finalized', async () => {
    const events = await run(req(), ['00:01:40.000000', '00:02:00.000000'])
    const p = percents(events)
    expect(Math.max(...p)).toBe(99)
    expect(events.filter((e) => e.percent === 100).map((e) => e.phase)).toEqual(['done'])
  })

  it('sends a percent only when it moved: a position repeated is not a new event', async () => {
    const events = await run(req(), ['00:00:25.000000', '00:00:25.000000', '00:00:25.100000'])
    expect(percents(events)).toEqual([0, 25])
  })

  it('with no length to measure against it never sends a number (an indeterminate bar, start to done)', async () => {
    probeResult = null
    const events = await run(req(), ['00:00:25.000000', '00:00:50.000000'])
    const burning = events.filter((e) => e.phase === 'burning-in')
    expect(burning.length, 'it still says it is burning in').toBeGreaterThan(0)
    for (const e of burning) expect('percent' in e, 'a burning-in event with no length has no percent key').toBe(false)
    expect(percents(events)).toEqual([])
    expect(events[events.length - 1]).toMatchObject({ phase: 'done', percent: 100 })
  })

  it('a burn that fails after an unprobeable start leaves no determinate 0% behind', async () => {
    // The frozen bar: the opening event said 0%, the probe failed, ffmpeg died. The panel's
    // last event was a determinate 0 that nothing would ever move.
    probeResult = null
    onSpawn = (child) => {
      child.stderr.emit('data', 'could not open the file')
      child.emit('close', 1)
    }
    const events: CaptionsProgress[] = []
    await expect(runBurnIn(req(), (p) => events.push(p))).rejects.toThrow(/burn-in exit 1/)
    expect(events.length).toBeGreaterThan(0)
    expect(events.filter((e) => typeof e.percent === 'number')).toEqual([])
  })

  it('with the video unprobed but a range given, the range is the length', async () => {
    probeResult = null
    const events = await run(req({ startSec: 10, endSec: 30 }), ['00:00:05.000000'])
    expect(percents(events)).toEqual([0, 25])
  })

  it('ignores the position lines that are not out_time (out_time_ms is microseconds, whatever its name)', async () => {
    onSpawn = (child) => {
      child.stdout.emit('data', 'out_time_ms=25000000\nout_time_us=25000000\nout_time=N/A\nprogress=continue\n')
      child.emit('close', 0)
    }
    const events: CaptionsProgress[] = []
    await runBurnIn(req(), (p) => events.push(p))
    expect(percents(events)).toEqual([0])
  })
})

/**
 * T-111 — burned caption size. The runner probes the video, so a vertical or
 * reframed clip gets the style that brings libass's height-based scale to the
 * 16:9 picture its width would make; a landscape one is the command it always was.
 */
describe('runBurnIn — the style it hands ffmpeg follows the frame (T-111)', () => {
  const forceStyleOf = (): string => {
    const args = spawned[spawned.length - 1]?.args ?? []
    return args[args.indexOf('-vf') + 1] ?? ''
  }
  const burn = async (): Promise<void> => {
    onSpawn = (child) => child.emit('close', 0)
    const file = path.join(scratch, 'captions', 'talk.srt')
    writeFileSync(file, '1\n00:00:01,000 --> 00:00:02,000\nhello\n', 'utf8')
    await runBurnIn(
      { jobId: 'b3', videoPath: '/tmp/in.mp4', srtPath: file, outputPath: path.join(scratch, 'o.mp4'), fontSizePct: 3.2 },
      () => undefined
    )
  }

  it('a landscape video: no PlayResY, MarginV=40 — the command it always was', async () => {
    await burn()
    expect(forceStyleOf()).toContain("force_style='FontName=Arial,FontSize=32,")
    expect(forceStyleOf()).toContain('MarginV=40')
    expect(forceStyleOf()).not.toContain('PlayResY')
  })

  it('a vertical video: PlayResY=910, MarginV=126', async () => {
    probeResult = { duration: 100, width: 1080, height: 1920 }
    await burn()
    expect(forceStyleOf()).toContain('MarginV=126,PlayResY=910')
    expect(forceStyleOf()).toContain('FontSize=32')
  })

  it('a probe that answers with a frame of 0 is sized as landscape rather than refusing the burn (T-113)', async () => {
    probeResult = { duration: 100, width: 0, height: 0 }
    await expect(burn()).resolves.toBeUndefined()
    expect(spawned[spawned.length - 1]?.args).toContain('-vf')
    expect(forceStyleOf()).toContain('MarginV=40')
    expect(forceStyleOf()).not.toContain('PlayResY')
  })

  it('a video that cannot be probed is sized as landscape rather than refused', async () => {
    probeResult = null
    await burn()
    expect(spawned[spawned.length - 1]?.args).toContain('-vf')
    expect(forceStyleOf()).not.toContain('PlayResY')
  })
})

/**
 * T-114 - the runner's own check on a style color, the second line behind the IPC gate. It was
 * the soft `assert()`, which under NODE_ENV=production logs and CONTINUES: the string went
 * through to `force_style='...PrimaryColour=...'` as typed.
 */
describe('runBurnIn - a style color that is not #RRGGBB never reaches the command, whatever NODE_ENV is (T-114)', () => {
  const prevEnv = process.env.NODE_ENV
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })
  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  const burnWith = (primaryColor: string, outlineColor = '#000000'): Promise<unknown> => {
    onSpawn = (child) => child.emit('close', 0)
    const file = path.join(scratch, 'captions', 'talk.srt')
    writeFileSync(file, '1\n00:00:01,000 --> 00:00:02,000\nhello\n', 'utf8')
    return runBurnIn(
      {
        jobId: 'b9',
        videoPath: '/tmp/in.mp4',
        srtPath: file,
        outputPath: path.join(scratch, 'o.mp4'),
        fontSizePct: 3.2,
        style: { fontSize: 32, position: 'bottom', primaryColor, outlineColor }
      },
      () => undefined
    )
  }

  it.each([
    ['an override smuggled in the text color', '&H00FFFFFF&,Fontname=x'],
    ['a break-out of the quoted style', "#ffffff',FontName=x,Alpha='"],
    ['a color name', 'white']
  ])('%s: the burn is refused and ffmpeg is never started', async (_label, bad) => {
    await expect(burnWith(bad)).rejects.toThrow(/caption color must be #RRGGBB/)
    await expect(burnWith('#ffffff', bad)).rejects.toThrow(/caption color must be #RRGGBB/)
    expect(spawned, 'nothing was spawned').toEqual([])
  })

  it('a good color is still burned in production', async () => {
    await expect(burnWith('#ffcc00')).resolves.toBeDefined()
    expect(spawned.length).toBe(1)
    expect(spawned[0]?.args.join(' ')).toContain('PrimaryColour=&H0000ccff&')
  })
})
