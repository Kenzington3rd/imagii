import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CANCELLED_MESSAGE, CancelledError, isCancelledError } from '../../shared/cancel'

/**
 * T-84 — every runner a user can Cancel rejects with the SENTINEL, and only
 * when the cancel function asked for the kill.
 *
 * Why this is a table. The bug was one bug in a dozen places: a cancel kills
 * the child, the child exits non-zero, and each runner's close handler wrote
 * its own "<name> exit <code>" error — so Cancel reached the user as a red
 * failure in ffmpeg's words, and the only way for the renderer to tell the
 * two apart would have been to string-match twelve different sentences. The
 * fix is main marking the cancel (cancelMark.ts) and every runner's close
 * handler reading the mark; the row below is the proof for one runner, and a
 * runner added to the product without a row here is the one that regresses.
 *
 * Three claims per runner, because each one catches a different mistake:
 *   1. every way the app can ask it to stop (the per-job cancel the panel's
 *      button calls, and the before-quit sweep) rejects with the sentinel —
 *      under BOTH exit shapes a SIGKILL produces (Windows: code 1; POSIX:
 *      code null + signal SIGKILL);
 *   2. the control: the same non-zero exit with NO cancel keeps the runner's
 *      own failure — a sentinel that fires on a real crash would hide
 *      failures behind a friendly "canceled";
 *   3. a cancel aimed at a different job leaves this one's failure alone
 *      (for the runners that key on a job id).
 *
 * Only the child is faked (convertCancel.test.ts's technique): the real
 * runners, their real cancel functions and their real close handlers run.
 * Layer 5 runs the real binary; this file is about who decided the child
 * died.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runners set utf8 on both pipes */
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitCode: number | null = null
  /** The argv the runner spawned it with (T-106 reads the output path off it). */
  args: string[] = []
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}

let children: FakeChild[] = []
let scratch = ''

/**
 * T-98: a probe the test can hold. Every runner that waits on ffprobe (or on
 * the audio probe) before it spawns awaits the gate here, so "a Cancel pressed
 * during the probe" is a state the test creates rather than a race it hopes to
 * win. `probeCalls` says a runner has actually reached the wait.
 */
let probeGate: Promise<void> | null = null
let probeCalls = 0
function holdProbes(): { release: () => void; fail: (message: string) => void } {
  let release: () => void = () => undefined
  let fail: (message: string) => void = () => undefined
  probeGate = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = (message) => reject(new Error(message))
  })
  // The runner under test may be canceled and never look at the gate again.
  probeGate.catch(() => undefined)
  return { release, fail }
}

/**
 * T-106: choosing the output's name is a wait before the spawn (an `lstat` walk),
 * so a Cancel can land in it exactly as it lands in the probe. The test cannot
 * make a real `lstat` slow; it holds the choice instead. `nameCalls` says a
 * runner has reached the wait.
 */
let nameGate: Promise<void> | null = null
let nameCalls = 0
function holdNames(): { release: () => void } {
  let release: () => void = () => undefined
  nameGate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release }
}
vi.mock('./outputPath', async () => {
  const real = await vi.importActual<typeof import('./outputPath')>('./outputPath')
  return {
    ...real,
    nextFreePath: async (...args: Parameters<typeof real.nextFreePath>) => {
      nameCalls += 1
      if (nameGate) await nameGate
      return real.nextFreePath(...args)
    }
  }
})

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    child.args = args
    children.push(child)
    return child
  }
}))

// The probes spawn ffprobe; the runners under test only need their answer.
vi.mock('./probe', () => ({
  probeVideo: async () => {
    probeCalls += 1
    if (probeGate) await probeGate
    return {
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 0,
      sizeBytes: 0
    }
  }
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async () => {
    probeCalls += 1
    if (probeGate) await probeGate
    return {
      duration: 60,
      sampleRate: 48000,
      channels: 2,
      codec: 'pcm_s16le',
      bitrate: 0,
      format: 'wav',
      sizeBytes: 0
    }
  }
}))

// whisperManager reads electron (`net`, `app`) and the sidecar paths; neither
// matters to a child-exit test, but the module has to load and runTranscribe
// has to believe whisper is installed.
vi.mock('electron', () => ({
  app: { getPath: () => scratch, isPackaged: false },
  net: { request: () => installRequest }
}))
vi.mock('../sidecars/paths', () => ({
  whisperExePath: () => ({ path: '/x/whisper.exe', exists: true, sizeBytes: 1 }),
  whisperModelPath: () => ({ path: '/x/model.bin', exists: true, sizeBytes: 1 }),
  captionsOutputDir: () => path.join(scratch, 'captions'),
  modelsDir: () => path.join(scratch, 'models')
}))
// T-108: transcription's first wait is the audio extraction, so a test can hold it the
// way it holds a probe. `extractCalls` says the runner has reached the wait.
let extractGate: Promise<void> | null = null
let extractCalls = 0
function holdExtraction(): { release: () => void; fail: (message: string) => void } {
  let release: () => void = () => undefined
  let fail: (message: string) => void = () => undefined
  extractGate = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = (message) => reject(new Error(message))
  })
  extractGate.catch(() => undefined)
  return { release, fail }
}
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: async () => {
    extractCalls += 1
    if (extractGate) await extractGate
    return { wavPath: '/tmp/imagii-t84.wav', cleanup: async () => undefined }
  },
  // T-111: `cancelAllAudioJobs` also sweeps the extraction registry (extract.test.ts has the real one).
  cancelAllExtractions: () => undefined
}))

// The model download is an HTTP request, not a child process: a fake with the
// two methods the installer drives. Electron's abort() fires 'abort'.
class FakeRequest extends EventEmitter {
  end(): void {
    /* nothing is ever sent */
  }
  abort(): void {
    this.emit('abort')
  }
}
let installRequest = new FakeRequest()

const { runExportJob, cancelAllExportJobs } = await import('./export')
const { runGifExport, cancelGifJob, cancelAllGifJobs } = await import('./gif')
const { runConcat, runPipComposite, cancelConcatJob, cancelAllConcatJobs } = await import(
  './concat'
)
const { runReframe, cancelReframeJob, cancelAllReframeJobs } = await import('./reframe')
const {
  findHighlights,
  analyzeClipHook,
  cancelActiveHighlightScan,
  cancelAllHighlightJobs
} = await import('./highlights')
const { extractFrame, cancelAllFrameJobs } = await import('./frame')
const { convertToMp4, remuxWebm, cancelConverts, cancelAllConverts, ConvertCancelledError } = await import(
  './convert'
)
const { runAudioExport, runAudioMux, runAudioReattach, cancelAudioJob, cancelAllAudioJobs } = await import(
  '../audio/process'
)
const {
  runBurnIn,
  runTranscribe,
  cancelBurnIn,
  cancelTranscribe,
  installWhisperModel,
  cancelWhisperModelInstall
} = await import('../sidecars/whisperManager')

interface Case {
  name: string
  start: (jobId: string) => Promise<unknown>
  /** Every way the app can ask this runner to stop. */
  cancels: Array<{ via: string; run: (jobId: string) => void }>
  /** What an exit nobody asked for says — the control. */
  failure: RegExp
  /** True when the cancel function is keyed on the job id. */
  perJob: boolean
  /** T-100: the file the spawned child is writing, when the runner has one to remove. */
  output?: () => string
  /**
   * T-106: true when the runner names its own output from its settings and so
   * must write BESIDE a file that is already there (the frame extract is given
   * its exact path by the kit and is not one of these).
   */
  choosesName?: boolean
  /**
   * True when the file is the runner's own scratch (the re-attach WAV): it is
   * removed on every path, success included, and whatever sits at that path is
   * the job's to delete — so neither the control nor the stale-file rule applies.
   */
  outputIsScratch?: boolean
  /**
   * T-133 (5): true when the runner is given its exact path and REFUSES one that already exists, before it spawns anything (the frame
   * extract: its folder is the kit's fresh one). The "left alone" row below needs a spawn to cancel, so it does not apply; the refusal
   * (and that the old file is untouched) is noPicture.test.ts's "a file already at the path is refused before ffmpeg runs".
   */
  refusesExistingOutput?: boolean
}

const CLIP = {
  id: 'c1',
  name: 'Clip',
  startSec: 0,
  endSec: 5,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube' as const]
}

const PLAIN_CHAIN = {
  denoise: 'off' as const,
  hum60: false,
  rumbleHighpass: false,
  deEss: false,
  compressor: 'off' as const,
  loudnorm: false,
  loudnormTargetLufs: -16,
  gainDb: 0,
  cutRegions: [],
  secondaryTrack: null
}

const CASES: Case[] = [
  {
    name: 'video export',
    start: (jobId) =>
      runExportJob(
        { jobId, sourcePath: '/tmp/in.mp4', outDir: scratch, clip: CLIP, preset: 'youtube' },
        () => undefined
      ),
    // T-108: the per-job cancel (`cancelExportJob`) had no caller once `video:cancel` was gone;
    // the batch's Cancel is the only way to stop an export, so there is no by-name row here.
    cancels: [{ via: 'cancelAllExportJobs', run: () => cancelAllExportJobs() }],
    failure: /FFmpeg exit 1/,
    perJob: false,
    output: () => path.join(scratch, 'in_Clip_youtube.mp4'),
    choosesName: true
  },
  {
    name: 'GIF export',
    start: (jobId) =>
      runGifExport({
        jobId,
        sourcePath: '/tmp/in.mp4',
        outDir: scratch,
        startSec: 0,
        endSec: 3,
        width: 320,
        fps: 15,
        speed: 1
      }),
    cancels: [
      { via: 'cancelGifJob', run: (id) => void cancelGifJob(id) },
      { via: 'cancelAllGifJobs', run: () => cancelAllGifJobs() }
    ],
    failure: /gif exit 1/,
    perJob: true,
    output: () => path.join(scratch, 'in_320px_15fps.gif'),
    choosesName: true
  },
  {
    name: 'compilation (segment pass)',
    start: (jobId) =>
      runConcat({
        jobId,
        sourcePath: '/tmp/in.mp4',
        outDir: scratch,
        segments: [{ startSec: 0, endSec: 2, name: 'a' }],
        fadeMs: 0,
        width: 1920,
        height: 1080
      }),
    cancels: [
      { via: 'cancelConcatJob', run: (id) => void cancelConcatJob(id) },
      { via: 'cancelAllConcatJobs', run: () => cancelAllConcatJobs() }
    ],
    failure: /segment 0 exit 1/,
    perJob: true
  },
  {
    name: 'picture-in-picture',
    start: (jobId) =>
      runPipComposite(jobId, '/tmp/base.mp4', '/tmp/overlay.mp4', path.join(scratch, 'pip.mp4'), {
        overlayWidth: 360,
        position: 'bottom-right',
        margin: 32
      }),
    // PiP shares concat's registry: the panel's Cancel calls cancelConcatJob.
    cancels: [
      { via: 'cancelConcatJob', run: (id) => void cancelConcatJob(id) },
      { via: 'cancelAllConcatJobs', run: () => cancelAllConcatJobs() }
    ],
    failure: /pip exit 1/,
    perJob: true,
    output: () => path.join(scratch, 'pip.mp4'),
    choosesName: true
  },
  {
    name: 'reframe',
    start: (jobId) =>
      runReframe(
        {
          jobId,
          sourcePath: '/tmp/in.mp4',
          outputPath: path.join(scratch, 'rf.mp4'),
          position: 'center',
          startSec: 0,
          endSec: 4,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelReframeJob', run: (id) => void cancelReframeJob(id) },
      { via: 'cancelAllReframeJobs', run: () => cancelAllReframeJobs() }
    ],
    failure: /reframe exit 1/,
    perJob: true,
    output: () => path.join(scratch, 'rf.mp4'),
    choosesName: true
  },
  {
    name: 'highlight scan',
    start: (jobId) => findHighlights(jobId, '/tmp/in.mp4', () => undefined),
    cancels: [
      { via: 'cancelActiveHighlightScan', run: () => void cancelActiveHighlightScan() },
      { via: 'cancelAllHighlightJobs', run: () => cancelAllHighlightJobs() }
    ],
    failure: /ebur128 exit 1/,
    perJob: false
  },
  {
    name: 'audio export',
    start: (jobId) =>
      runAudioExport(
        {
          jobId,
          sourcePath: '/tmp/in.wav',
          outputPath: path.join(scratch, 'out.mp3'),
          chain: {
            denoise: 'off',
            hum60: false,
            rumbleHighpass: false,
            deEss: false,
            compressor: 'off',
            loudnorm: false,
            loudnormTargetLufs: -16,
            gainDb: 0,
            cutRegions: [],
            secondaryTrack: null
          },
          format: 'mp3'
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelAudioJob', run: (id) => void cancelAudioJob(id) },
      { via: 'cancelAllAudioJobs', run: () => cancelAllAudioJobs() }
    ],
    failure: /FFmpeg exit 1/,
    perJob: true,
    output: () => path.join(scratch, 'out.mp3')
  },
  {
    name: 'audio re-attach (render pass)',
    start: (jobId) =>
      runAudioReattach(
        {
          jobId,
          videoPath: '/tmp/in.mp4',
          sourcePath: '/tmp/in.wav',
          outputPath: path.join(scratch, 'out.mp4'),
          chain: {
            denoise: 'off',
            hum60: false,
            rumbleHighpass: false,
            deEss: false,
            compressor: 'off',
            loudnorm: false,
            loudnormTargetLufs: -16,
            gainDb: 0,
            cutRegions: [],
            secondaryTrack: null
          }
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelAudioJob', run: (id) => void cancelAudioJob(id) },
      { via: 'cancelAllAudioJobs', run: () => cancelAllAudioJobs() }
    ],
    failure: /FFmpeg exit 1/,
    perJob: true,
    // The render pass writes the intermediate WAV beside the output; it is the
    // job's own file and it dies with the job on every path, success included.
    output: () => path.join(scratch, 'out.cleaned.wav'),
    outputIsScratch: true
  },
  {
    name: 'caption burn-in',
    start: (jobId) =>
      runBurnIn(
        {
          jobId,
          videoPath: '/tmp/in.mp4',
          srtPath: '/tmp/in.srt',
          outputPath: path.join(scratch, 'burn.mp4'),
          fontSizePct: 3.5
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelBurnIn(jobId)', run: (id) => void cancelBurnIn(id) },
      { via: 'cancelBurnIn()', run: () => void cancelBurnIn() }
    ],
    failure: /burn-in exit 1/,
    perJob: true,
    output: () => path.join(scratch, 'burn.mp4')
  },
  {
    name: 'transcription',
    start: (jobId) =>
      runTranscribe({ jobId, sourcePath: '/tmp/in.mp4', language: 'en' }, () => undefined),
    cancels: [
      { via: 'cancelTranscribe(jobId)', run: (id) => void cancelTranscribe(id) },
      { via: 'cancelTranscribe()', run: () => void cancelTranscribe() }
    ],
    failure: /whisper exit 1/,
    perJob: true
  },
  {
    name: 'convert to mp4',
    start: () => convertToMp4('recording', '/tmp/in.webm', '/tmp/out.mp4', () => undefined),
    cancels: [
      { via: 'cancelConverts(owner)', run: () => void cancelConverts('recording') },
      { via: 'cancelAllConverts', run: () => void cancelAllConverts() }
    ],
    failure: /convert-to-mp4 exit 1/,
    perJob: false
  },
  {
    // T-120: the WebM save is the same child registry as the convert, with a packet copy for its argv.
    name: 'remux the recording to webm (Convert off)',
    start: () => remuxWebm('recording', '/tmp/in.webm', '/tmp/out.webm'),
    cancels: [
      { via: 'cancelConverts(owner)', run: () => void cancelConverts('recording') },
      { via: 'cancelAllConverts', run: () => void cancelAllConverts() }
    ],
    failure: /convert-to-mp4 exit 1/,
    perJob: false
  },
  {
    name: 'single-frame extract (Clip Kit thumbnails)',
    start: () => extractFrame('/tmp/in.mp4', 1, path.join(scratch, 'frame.jpg')),
    cancels: [{ via: 'cancelAllFrameJobs', run: () => cancelAllFrameJobs() }],
    failure: /extractFrame exit 1/,
    perJob: false,
    output: () => path.join(scratch, 'frame.jpg'),
    refusesExistingOutput: true
  }
]

/** Start a runner and hand back the child it spawned plus its settled outcome. */
async function begin(
  c: Case,
  jobId: string
): Promise<{ child: FakeChild; outcome: Promise<unknown> }> {
  const before = children.length
  const outcome = c.start(jobId).then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )
  await vi.waitFor(() => expect(children.length).toBeGreaterThan(before), { timeout: 3000 })
  const child = children[children.length - 1]
  if (!child) throw new Error('runner never spawned')
  return { child, outcome }
}

beforeEach(() => {
  children = []
  probeGate = null
  probeCalls = 0
  nameGate = null
  nameCalls = 0
  extractGate = null
  extractCalls = 0
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-cancel-sentinel-'))
  // Nothing in flight between cases; also proves each registry empties itself.
  cancelAllExportJobs()
  cancelAllGifJobs()
  cancelAllConcatJobs()
  cancelAllReframeJobs()
  cancelAllHighlightJobs()
  cancelAllFrameJobs()
  cancelAllConverts()
  cancelAllAudioJobs()
  cancelBurnIn()
  cancelTranscribe()
  children = []
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** The two shapes a SIGKILL'd child closes with: Windows, then POSIX. */
const KILLED_EXITS: Array<[number | null, NodeJS.Signals | null]> = [
  [1, null],
  [null, 'SIGKILL']
]

describe.each(CASES)('$name', (c) => {
  for (const cancel of c.cancels) {
    for (const [code, signal] of KILLED_EXITS) {
      it(`${cancel.via} then close(${code}, ${signal}) rejects with the sentinel`, async () => {
        const { child, outcome } = await begin(c, 'job-1')
        cancel.run('job-1')
        expect(child.signals).toContain('SIGKILL')
        child.emit('close', code, signal)
        const err = await outcome
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toBe(CANCELLED_MESSAGE)
        expect(isCancelledError(err)).toBe(true)
        expect(err).toBeInstanceOf(CancelledError)
      })
    }
  }

  it('the control: a non-zero exit nobody asked for stays a failure', async () => {
    const { child, outcome } = await begin(c, 'job-1')
    child.stderr.emit('data', 'Conversion failed!')
    child.emit('close', 1, null)
    const err = await outcome
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(c.failure)
    expect(isCancelledError(err)).toBe(false)
  })

  if (c.perJob) {
    it("a cancel aimed at another job does not mark this one's exit", async () => {
      const { child, outcome } = await begin(c, 'job-1')
      for (const cancel of c.cancels.slice(0, 1)) cancel.run('some-other-job')
      child.emit('close', 1, null)
      const err = await outcome
      expect(isCancelledError(err)).toBe(false)
      expect((err as Error).message).toMatch(c.failure)
    })
  }

  // T-100 — the job's own half-written file goes with the job.
  const output = c.output
  if (output) {
    for (const [code, signal] of KILLED_EXITS) {
      it(`a cancel (close ${code}, ${signal}) removes the half-written output`, async () => {
        const { child, outcome } = await begin(c, 'job-1')
        writeFileSync(output(), 'ffmpeg opened this and was killed before the moov atom')
        c.cancels[0]?.run('job-1')
        child.emit('close', code, signal)
        await outcome
        expect(existsSync(output())).toBe(false)
      })
    }

    it('a failure nobody asked for removes it too', async () => {
      const { child, outcome } = await begin(c, 'job-1')
      writeFileSync(output(), 'ffmpeg opened this and then hit an error')
      child.emit('close', 1, null)
      await outcome
      expect(existsSync(output())).toBe(false)
    })

    if (c.choosesName === true) {
      it('writes beside a file that is already there, never over it (T-106)', async () => {
        const wanted = output()
        const { dir, name, ext } = path.parse(wanted)
        writeFileSync(wanted, "an earlier export, somebody's")
        const { child, outcome } = await begin(c, 'job-1')
        expect(child.args, 'the earlier file is not what ffmpeg is told to write').not.toContain(wanted)
        expect(child.args[child.args.length - 1]).toBe(path.join(dir, `${name} (2)${ext}`))
        child.emit('close', 0, null)
        await outcome
        expect(readFileSync(wanted, 'utf8')).toBe("an earlier export, somebody's")
      })

      it('a Cancel on that job removes its own file and leaves the earlier export', async () => {
        const wanted = output()
        const { dir, name, ext } = path.parse(wanted)
        const beside = path.join(dir, `${name} (2)${ext}`)
        writeFileSync(wanted, "an earlier export, somebody's")
        const { child, outcome } = await begin(c, 'job-1')
        writeFileSync(beside, 'ffmpeg opened this and was killed')
        c.cancels[0]?.run('job-1')
        child.emit('close', null, 'SIGKILL')
        await outcome
        expect(existsSync(beside)).toBe(false)
        expect(readFileSync(wanted, 'utf8')).toBe("an earlier export, somebody's")
      })
    }

    // T-106: the runner no longer aims at a file that is already there, so the
    // age rule below is a second line of defense (partialOutput.test.ts holds it
    // alone, against real files) and this row is also the proof that a job
    // which was told to write beside an old export leaves the old export alone.
    if (c.outputIsScratch !== true && c.refusesExistingOutput !== true) it('a file that was already there before the spawn is left alone', async () => {
      // ffmpeg truncates its output when it OPENS it; a Cancel before that
      // leaves last week's export exactly as it was.
      const stale = new Date(Date.now() - 3 * 60 * 60 * 1000)
      writeFileSync(output(), 'last week\'s finished export')
      utimesSync(output(), stale, stale)
      const { child, outcome } = await begin(c, 'job-1')
      c.cancels[0]?.run('job-1')
      child.emit('close', null, 'SIGKILL')
      await outcome
      expect(existsSync(output())).toBe(true)
    })

    if (c.outputIsScratch !== true) {
      it('the control: a run that finishes keeps its file', async () => {
        const { child, outcome } = await begin(c, 'job-1')
        writeFileSync(output(), 'a finished file')
        child.emit('close', 0, null)
        const settled = await outcome
        expect(isCancelledError(settled)).toBe(false)
        expect(existsSync(output())).toBe(true)
      })
    }
  }
})

describe('a kill nobody asked for', () => {
  it('a highlight scan that dies on an outside SIGKILL is a failure, not a cancel', async () => {
    // Before T-84 the scan treated ANY SIGTERM/SIGKILL as "cancelled" — an
    // out-of-memory kill would have been reported to the user as a decision
    // they made.
    const c = CASES.find((x) => x.name === 'highlight scan')
    if (!c) throw new Error('case missing')
    const { child, outcome } = await begin(c, 'hl-1')
    child.emit('close', null, 'SIGKILL')
    const err = await outcome
    expect(isCancelledError(err)).toBe(false)
    expect((err as Error).message).toMatch(/ebur128 exit/)
  })
})

describe('hook analysis superseded by a newer request', () => {
  it('rejects the older one with the sentinel', async () => {
    const first = analyzeClipHook('/tmp/in.mp4', 0).then(
      () => null,
      (e: unknown) => e
    )
    await vi.waitFor(() => expect(children.length).toBe(1))
    const firstChild = children[0] as FakeChild
    // The newer request kills the older child before spawning its own.
    void analyzeClipHook('/tmp/in.mp4', 10).catch(() => undefined)
    await vi.waitFor(() => expect(children.length).toBe(2))
    expect(firstChild.signals.length).toBeGreaterThan(0)
    firstChild.emit('close', null, 'SIGTERM')
    const err = await first
    expect(isCancelledError(err)).toBe(true)
    // …and the newer one is untouched: it can still finish.
    const second = children[1] as FakeChild
    second.stderr.emit('data', 't: 0.1 TARGET:-23 LUFS    M: -12.0 S: -12.0')
    second.emit('close', 0, null)
  })
})

describe('model download cancel', () => {
  beforeEach(() => {
    installRequest = new FakeRequest()
  })

  it('resolves { ok: false } carrying the sentinel as its reason', async () => {
    const progress: Array<{ phase: string; message?: string }> = []
    const done = installWhisperModel((p) => progress.push(p))
    await vi.waitFor(() => expect(cancelWhisperModelInstall()).toBe(true), { timeout: 3000 })
    const result = await done
    expect(result).toEqual({ ok: false, reason: CANCELLED_MESSAGE })
    expect(isCancelledError((result as { reason: string }).reason)).toBe(true)
  })

  it('the control: a network error on the request is still a failure reason', async () => {
    const done = installWhisperModel(() => undefined)
    await vi.waitFor(() => expect(installRequest.listenerCount('error')).toBeGreaterThan(0), {
      timeout: 3000
    })
    installRequest.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    const result = await done
    expect(result).toEqual({ ok: false, reason: 'net::ERR_INTERNET_DISCONNECTED' })
  })
})

describe('the convert registry shares the one sentinel', () => {
  it('ConvertCancelledError IS a CancelledError carrying the same message', () => {
    const err = new ConvertCancelledError()
    expect(err).toBeInstanceOf(CancelledError)
    expect(err.name).toBe('ConvertCancelledError')
    expect(err.message).toBe(CANCELLED_MESSAGE)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-98 — a Cancel is a latch: pressed before the child exists, it still cancels.
//
// The table above proves who decided a child died. It cannot see the other half
// of the bug: the runners register their child at the spawn, and nearly every
// one waits on something first — a platform export, a compilation, a cropped GIF
// and a reframe probe the source; the next job of a batch begins with that
// probe; a frame extract creates its folder; a ranged burn-in reads its SRT. A
// Cancel that arrived in that wait found nothing to kill, returned false, and
// the job started anyway. These rows land the Cancel in the wait (a held probe,
// or a synchronous cancel straight after the call, before the first await can
// finish) and ask three things: the job is refused with the sentinel, NO child
// was ever spawned, and a cancel that was pressed at the wrong time (before the
// job, or aimed at another job) leaves it alone.
// ───────────────────────────────────────────────────────────────────────────

interface PreSpawnCase {
  name: string
  start: (jobId: string) => Promise<unknown>
  cancels: Array<{ via: string; run: (jobId: string) => void }>
  /** True when the runner waits on a probe the test can hold. */
  probe: boolean
  /** T-108: true when the runner waits on extracting the sound first (transcription). */
  extracts?: boolean
  /** True when the cancel is keyed on the job id. */
  perJob: boolean
  /** T-106: true when the runner waits on choosing its output's name before it spawns. */
  choosesName?: boolean
}

const CROP = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }

const PRE_SPAWN: PreSpawnCase[] = [
  {
    name: 'video export (the probe a batch\'s next job begins with)',
    start: (jobId) =>
      runExportJob(
        { jobId, sourcePath: '/tmp/in.mp4', outDir: scratch, clip: CLIP, preset: 'youtube' },
        () => undefined
      ),
    cancels: [{ via: 'cancelAllExportJobs', run: () => cancelAllExportJobs() }],
    probe: true,
    perJob: false,
    choosesName: true
  },
  {
    name: 'GIF export (cropped: probes first)',
    start: (jobId) =>
      runGifExport({
        jobId,
        sourcePath: '/tmp/in.mp4',
        outDir: scratch,
        startSec: 0,
        endSec: 3,
        width: 320,
        fps: 15,
        speed: 1,
        cropRect: CROP
      }),
    cancels: [
      { via: 'cancelGifJob', run: (id) => void cancelGifJob(id) },
      { via: 'cancelAllGifJobs', run: () => cancelAllGifJobs() }
    ],
    probe: true,
    perJob: true,
    choosesName: true
  },
  {
    name: 'compilation',
    start: (jobId) =>
      runConcat({
        jobId,
        sourcePath: '/tmp/in.mp4',
        outDir: scratch,
        segments: [{ startSec: 0, endSec: 2, name: 'a' }],
        fadeMs: 0,
        width: 1920,
        height: 1080
      }),
    cancels: [
      { via: 'cancelConcatJob', run: (id) => void cancelConcatJob(id) },
      { via: 'cancelAllConcatJobs', run: () => cancelAllConcatJobs() }
    ],
    probe: true,
    perJob: true
  },
  {
    name: 'reframe',
    start: (jobId) =>
      runReframe(
        {
          jobId,
          sourcePath: '/tmp/in.mp4',
          outputPath: path.join(scratch, 'rf.mp4'),
          position: 'center',
          startSec: 0,
          endSec: 4,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelReframeJob', run: (id) => void cancelReframeJob(id) },
      { via: 'cancelAllReframeJobs', run: () => cancelAllReframeJobs() }
    ],
    probe: true,
    perJob: true,
    choosesName: true
  },
  {
    name: 'picture-in-picture (chooses its output name first)',
    start: (jobId) =>
      runPipComposite(jobId, '/tmp/base.mp4', '/tmp/overlay.mp4', path.join(scratch, 'pip.mp4'), {
        overlayWidth: 360,
        position: 'bottom-right',
        margin: 32
      }),
    // PiP shares concat's registry and latch: the panel's Cancel calls cancelConcatJob.
    cancels: [
      { via: 'cancelConcatJob', run: (id) => void cancelConcatJob(id) },
      { via: 'cancelAllConcatJobs', run: () => cancelAllConcatJobs() }
    ],
    // T-131 (2): it also probes the base for the length its sound is padded to, inside `run.guard` like every other wait before a spawn.
    probe: true,
    perJob: true,
    choosesName: true
  },
  {
    // T-131 (2): the re-attach's second pass probes the PICTURE (its codec decides the copy, its length decides the pad) before its child.
    name: 'audio re-attach, the mux pass (probes the picture first)',
    start: (jobId) => runAudioMux(jobId, '/tmp/in.mp4', '/tmp/cleaned.wav', path.join(scratch, 'mux.mp4'), () => undefined),
    cancels: [
      { via: 'cancelAudioJob', run: (id) => void cancelAudioJob(id) },
      { via: 'cancelAllAudioJobs', run: () => cancelAllAudioJobs() }
    ],
    probe: true,
    perJob: true
  },
  {
    name: 'highlight scan',
    start: (jobId) => findHighlights(jobId, '/tmp/in.mp4', () => undefined),
    cancels: [
      { via: 'cancelActiveHighlightScan', run: () => void cancelActiveHighlightScan() },
      { via: 'cancelAllHighlightJobs', run: () => cancelAllHighlightJobs() }
    ],
    probe: true,
    perJob: false
  },
  {
    name: 'audio export (probes the file first)',
    start: (jobId) =>
      runAudioExport(
        {
          jobId,
          sourcePath: '/tmp/in.wav',
          outputPath: path.join(scratch, 'out.mp3'),
          chain: PLAIN_CHAIN,
          format: 'mp3'
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelAudioJob', run: (id) => void cancelAudioJob(id) },
      { via: 'cancelAllAudioJobs', run: () => cancelAllAudioJobs() }
    ],
    probe: true,
    perJob: true
  },
  {
    name: 'single-frame extract (creates its folder first)',
    start: () => extractFrame('/tmp/in.mp4', 1, path.join(scratch, 'thumbs', 'frame.jpg')),
    cancels: [{ via: 'cancelAllFrameJobs', run: () => cancelAllFrameJobs() }],
    probe: false,
    perJob: false
  },
  {
    // T-130 (t): a thumbnail of a CROPPED clip reads the source's size first (the crop is a fraction of the frame), so it has a probe to be
    // canceled in, which the uncropped extract above has not.
    name: 'single-frame extract of a cropped clip (probes the source first)',
    start: () =>
      extractFrame('/tmp/in.mp4', 1, path.join(scratch, 'thumbs', 'frame.jpg'), { x: 0.25, y: 0, w: 0.5, h: 1 }),
    cancels: [{ via: 'cancelAllFrameJobs', run: () => cancelAllFrameJobs() }],
    probe: true,
    perJob: false
  },
  {
    name: 'transcription (extracts the sound first)',
    start: (jobId) =>
      runTranscribe({ jobId, sourcePath: '/tmp/in.mp4', language: 'en' }, () => undefined),
    cancels: [
      { via: 'cancelTranscribe(jobId)', run: (id) => void cancelTranscribe(id) },
      { via: 'cancelTranscribe()', run: () => void cancelTranscribe() }
    ],
    probe: false,
    extracts: true,
    perJob: true
  },
  {
    // T-111: a burn also probes its video (the frame its captions are drawn on, the length
    // its bar measures), after the SRT read — that probe is the wait the row now holds.
    name: 'caption burn-in over a range (reads its SRT, then probes the video)',
    start: (jobId) =>
      runBurnIn(
        {
          jobId,
          videoPath: '/tmp/in.mp4',
          srtPath: path.join(scratch, 'in.srt'),
          outputPath: path.join(scratch, 'burn.mp4'),
          fontSizePct: 3.5,
          startSec: 1,
          endSec: 3
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelBurnIn(jobId)', run: (id) => void cancelBurnIn(id) },
      { via: 'cancelBurnIn()', run: () => void cancelBurnIn() }
    ],
    probe: true,
    perJob: true
  },
  {
    name: 'caption burn-in of the whole video (probes it first)',
    start: (jobId) =>
      runBurnIn(
        {
          jobId,
          videoPath: '/tmp/in.mp4',
          srtPath: path.join(scratch, 'in.srt'),
          outputPath: path.join(scratch, 'burn.mp4'),
          fontSizePct: 3.5
        },
        () => undefined
      ),
    cancels: [
      { via: 'cancelBurnIn(jobId)', run: (id) => void cancelBurnIn(id) },
      { via: 'cancelBurnIn()', run: () => void cancelBurnIn() }
    ],
    probe: true,
    perJob: true
  }
]

/** Start a runner WITHOUT waiting for its child — the whole point is that there is none. */
function startOnly(c: PreSpawnCase, jobId: string): Promise<unknown> {
  return c.start(jobId).then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )
}

/** The wait this runner has before its child, held — a probe, or (T-108) an extraction — or null. */
function holdWait(c: PreSpawnCase): { release: () => void; fail: (message: string) => void } | null {
  if (c.probe) return holdProbes()
  if (c.extracts === true) return holdExtraction()
  return null
}

/** Let the runner get as far as it can without a child, so a held wait has been asked. */
async function reachWait(c: PreSpawnCase): Promise<void> {
  if (c.probe) await vi.waitFor(() => expect(probeCalls).toBeGreaterThan(0), { timeout: 3000 })
  if (c.extracts === true) {
    await vi.waitFor(() => expect(extractCalls).toBeGreaterThan(0), { timeout: 3000 })
  }
}

describe.each(PRE_SPAWN)('a Cancel before the child exists: $name', (c) => {
  beforeEach(() => {
    // The burn-in row reads a real SRT; the frame row needs a real folder.
    writeFileSync(
      path.join(scratch, 'in.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nhello\n',
      'utf8'
    )
  })

  for (const cancel of c.cancels) {
    it(`${cancel.via} refuses the job with the sentinel and no child is ever spawned`, async () => {
      const gate = holdWait(c)
      const outcome = startOnly(c, 'job-1')
      await reachWait(c)
      cancel.run('job-1')
      // The wait is over at once — the probe has NOT been released.
      const err = await outcome
      expect(isCancelledError(err)).toBe(true)
      expect((err as Error).message).toBe(CANCELLED_MESSAGE)
      gate?.release()
      // Give a runner that would wrongly carry on every chance to spawn.
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(children).toHaveLength(0)
    })
  }

  // T-106: the second wait before a spawn — the output's name. The runner is let
  // past its probe and held at the name; the cancel must end the wait at once.
  if (c.choosesName === true) {
    for (const cancel of c.cancels) {
      it(`${cancel.via} while the output's name is being chosen refuses the job and no child is spawned`, async () => {
        const hold = holdNames()
        const outcome = startOnly(c, 'job-1')
        await vi.waitFor(() => expect(nameCalls).toBeGreaterThan(0), { timeout: 3000 })
        cancel.run('job-1')
        // Ended at once: the name has NOT been released.
        const err = await outcome
        expect(isCancelledError(err)).toBe(true)
        expect((err as Error).message).toBe(CANCELLED_MESSAGE)
        hold.release()
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(children).toHaveLength(0)
      })
    }
  }

  if (c.probe || c.extracts === true) {
    it('a wait that FAILS after the cancel still reads as the cancel', async () => {
      const gate = holdWait(c)
      if (!gate) throw new Error('this row holds no wait')
      const outcome = startOnly(c, 'job-1')
      await reachWait(c)
      c.cancels[0]?.run('job-1')
      gate.fail('No such file or directory')
      const err = await outcome
      expect(isCancelledError(err)).toBe(true)
      expect(children).toHaveLength(0)
    })
  }

  it('the control: with no Cancel the same job spawns its child', async () => {
    const gate = holdWait(c)
    const outcome = startOnly(c, 'job-1')
    await reachWait(c)
    gate?.release()
    await vi.waitFor(() => expect(children.length).toBeGreaterThan(0), { timeout: 3000 })
    children[children.length - 1]?.emit('close', 1, null)
    const err = await outcome
    expect(isCancelledError(err)).toBe(false)
  })

  it('a Cancel pressed BEFORE the job (nothing was running) does not reach it', async () => {
    // The stale click: pressed with nothing in flight, or aimed at a job that
    // has finished. A latch that outlived its run would kill the next job here.
    for (const cancel of c.cancels) cancel.run('job-1')
    const gate = holdWait(c)
    const outcome = startOnly(c, 'job-1')
    await reachWait(c)
    gate?.release()
    await vi.waitFor(() => expect(children.length).toBeGreaterThan(0), { timeout: 3000 })
    children[children.length - 1]?.emit('close', 1, null)
    const err = await outcome
    expect(isCancelledError(err)).toBe(false)
    expect((err as Error).message).not.toBe(CANCELLED_MESSAGE)
  })

  if (c.perJob) {
    it('a Cancel aimed at another job leaves this one waiting, then spawning', async () => {
      const gate = holdWait(c)
      const outcome = startOnly(c, 'job-1')
      await reachWait(c)
      // The all-jobs variant is meant to reach it, so this is the by-name one.
      c.cancels[0]?.run('some-other-job')
      gate?.release()
      await vi.waitFor(() => expect(children.length).toBeGreaterThan(0), { timeout: 3000 })
      children[children.length - 1]?.emit('close', 1, null)
      const err = await outcome
      expect(isCancelledError(err)).toBe(false)
    })
  }
})

describe('a Cancel between the compilation\'s last segment and its join', () => {
  const startCompile = (jobId: string): Promise<unknown> =>
    runConcat({
      jobId,
      sourcePath: '/tmp/in.mp4',
      outDir: scratch,
      segments: [{ startSec: 0, endSec: 2, name: 'a' }],
      fadeMs: 0,
      width: 1920,
      height: 1080
    }).then(
      (value) => ({ resolved: value }),
      (err: unknown) => err
    )

  for (const [via, cancel] of [
    ['cancelConcatJob', (id: string): unknown => cancelConcatJob(id)],
    ['cancelAllConcatJobs', (): unknown => cancelAllConcatJobs()]
  ] as const) {
    it(`${via} lands while the list file is being written: the join never starts`, async () => {
      const outcome = startCompile('job-1')
      await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
      // The segment finishes; the very next thing the runner does is an await
      // (the list file's write) — the cancel lands inside it, with no live child.
      children[0]?.emit('close', 0, null)
      cancel('job-1')
      const err = await outcome
      expect(isCancelledError(err)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(children).toHaveLength(1)
    })
  }

  for (const [via, cancel] of [
    ['cancelConcatJob', (id: string): unknown => cancelConcatJob(id)],
    ['cancelAllConcatJobs', (): unknown => cancelAllConcatJobs()]
  ] as const) {
    it(`${via} lands while the join's name is being chosen: the join never starts (T-106)`, async () => {
      const hold = holdNames()
      const outcome = startCompile('job-1')
      await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
      children[0]?.emit('close', 0, null)
      await vi.waitFor(() => expect(nameCalls).toBeGreaterThan(0), { timeout: 3000 })
      cancel('job-1')
      expect(isCancelledError(await outcome)).toBe(true)
      hold.release()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(children).toHaveLength(1)
    })
  }

  it('the join is written beside a compilation that is already there, never over it (T-106)', async () => {
    const earlier = path.join(scratch, 'in_compilation.mp4')
    writeFileSync(earlier, 'the last compilation')
    const outcome = startCompile('job-1')
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
    children[0]?.emit('close', 0, null)
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 3000 })
    expect(children[1]?.args[children[1].args.length - 1]).toBe(path.join(scratch, 'in_compilation (2).mp4'))
    children[1]?.emit('close', 0, null)
    const done = (await outcome) as { resolved: { outputPath: string } }
    expect(done.resolved.outputPath).toBe(path.join(scratch, 'in_compilation (2).mp4'))
    expect(readFileSync(earlier, 'utf8')).toBe('the last compilation')
  })

  it('the join\'s own half-written file goes when the join is canceled', async () => {
    const outcome = startCompile('job-1')
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
    children[0]?.emit('close', 0, null)
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 3000 })
    const joined = path.join(scratch, 'in_compilation.mp4')
    writeFileSync(joined, 'a join that was killed before its moov atom')
    cancelConcatJob('job-1')
    children[1]?.emit('close', null, 'SIGKILL')
    expect(isCancelledError(await outcome)).toBe(true)
    expect(existsSync(joined)).toBe(false)
  })
})
