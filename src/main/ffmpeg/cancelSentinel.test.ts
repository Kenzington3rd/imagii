import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
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
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}

let children: FakeChild[] = []
let scratch = ''

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChild()
    children.push(child)
    return child
  }
}))

// The probes spawn ffprobe; the runners under test only need their answer.
vi.mock('./probe', () => ({
  probeVideo: async () => ({
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    bitrate: 0,
    sizeBytes: 0
  })
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async () => ({
    duration: 60,
    sampleRate: 48000,
    channels: 2,
    codec: 'pcm_s16le',
    bitrate: 0,
    format: 'wav',
    sizeBytes: 0
  })
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
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: async () => ({
    wavPath: '/tmp/imagii-t84.wav',
    cleanup: async () => undefined
  })
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

const { runExportJob, cancelExportJob, cancelAllExportJobs } = await import('./export')
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
const { convertToMp4, cancelConverts, cancelAllConverts, ConvertCancelledError } = await import(
  './convert'
)
const { runAudioExport, runAudioReattach, cancelAudioJob, cancelAllAudioJobs } = await import(
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

const CASES: Case[] = [
  {
    name: 'video export',
    start: (jobId) =>
      runExportJob(
        { jobId, sourcePath: '/tmp/in.mp4', outDir: '/tmp', clip: CLIP, preset: 'youtube' },
        () => undefined
      ),
    cancels: [
      { via: 'cancelExportJob', run: (id) => void cancelExportJob(id) },
      { via: 'cancelAllExportJobs', run: () => cancelAllExportJobs() }
    ],
    failure: /FFmpeg exit 1/,
    perJob: true
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
    perJob: true
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
    failure: /reframe exit 1/,
    perJob: true
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
    perJob: true
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
    perJob: true
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
    perJob: true
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
    name: 'single-frame extract (Clip Kit thumbnails)',
    start: () => extractFrame('/tmp/in.mp4', 1, path.join(scratch, 'frame.jpg')),
    cancels: [{ via: 'cancelAllFrameJobs', run: () => cancelAllFrameJobs() }],
    failure: /extractFrame exit 1/,
    perJob: false
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
