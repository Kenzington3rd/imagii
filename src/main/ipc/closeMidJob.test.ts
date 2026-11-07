import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

/**
 * T-123 (1): closing the window in the middle of a job must not raise Electron's blocking
 * "A JavaScript error occurred in the main process" dialog.
 *
 * Every job-progress callback in main is a function a child's stdout handler (or the runner's
 * own awaits) calls, and each of them used to be a bare `e.sender.send(...)` or
 * `win.webContents.send(...)`. The window's WebContents dies 1-106 ms before `before-quit`
 * kills the child, and a chunk the child had already written still dispatches in between:
 * `send` on a destroyed WebContents THROWS ("Object has been destroyed"), nothing above a
 * stdout listener catches it, and Electron shows the dialog (reproduced on 3 of 40 real closes
 * during an export). Main has no `uncaughtException` handler, so the guard is at the send.
 *
 * Driven through each real handler, with the runner standing in for the child: it reports
 * progress the way a stdout listener does (a bare call, nothing around it) and the sender it
 * was handed is already dead. The handler must still answer. Two shapes of dead, because the
 * window can die between the check and the send: `isDestroyed()` true, and `isDestroyed()`
 * false with a `send` that throws.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const SOURCE = path.join(tmpdir(), 'in.mp4')
// The recording handler's userData (its folder of temp takes) and the place Save "chose".
let TMP = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(TMP, 'take.mp4') }) },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin]
  },
  desktopCapturer: { getSources: vi.fn() },
  shell: {},
  app: { getPath: () => TMP }
}))
// What the window's WebContents looks like to the recording handler; set per case.
let fakeWin: { webContents: Sender } = { webContents: { isDestroyed: () => false, send: vi.fn() } }

vi.mock('../ffmpeg/export', () => ({
  runExportJob: async (
    job: { jobId: string },
    onProgress: (p: unknown) => void
  ): Promise<{ jobId: string; outputPath: string }> => {
    onProgress({ jobId: job.jobId, percent: 10 })
    return { jobId: job.jobId, outputPath: path.join(tmpdir(), 'a.mp4') }
  },
  cancelAllExportJobs: vi.fn(),
  beginExportBatch: () => ({ check: () => undefined, end: () => undefined })
}))
vi.mock('../ffmpeg/reframe', () => ({
  runReframe: async (
    spec: { outputPath: string },
    onProgress: (p: unknown) => void
  ): Promise<{ outputPath: string }> => {
    onProgress({ phase: 'encoding', percent: 10 })
    return { outputPath: spec.outputPath }
  },
  cancelReframeJob: vi.fn()
}))
vi.mock('../ffmpeg/highlights', () => ({
  findHighlights: async (_id: string, _path: string, onProgress: (p: unknown) => void) => {
    onProgress({ percent: 10 })
    return []
  },
  analyzeClipHook: vi.fn(),
  cancelActiveHighlightScan: vi.fn()
}))
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelTranscribe: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: vi.fn(),
  installWhisperModel: async (onProgress: (p: unknown) => void) => {
    onProgress({ percent: 10 })
    return { ok: true }
  },
  runBurnIn: async (_req: unknown, onProgress: (p: unknown) => void) => {
    onProgress({ phase: 'burning', percent: 10 })
    return { outputPath: path.join(tmpdir(), 'out.mp4'), captioned: true }
  },
  runTranscribe: async (_req: unknown, onProgress: (p: unknown) => void) => {
    onProgress({ phase: 'transcribing' })
    return { srtPath: path.join(tmpdir(), 'a.srt') }
  }
}))
vi.mock('../audio/process', () => ({
  runAudioExport: async (spec: { outputPath: string }, onProgress: (p: unknown) => void) => {
    onProgress({ jobId: 'a1', percent: 10 })
    return { outputPath: spec.outputPath }
  },
  runAudioReattach: async (spec: { outputPath: string }, onProgress: (p: unknown) => void) => {
    onProgress({ jobId: 'a1', percent: 10 })
    return { outputPath: spec.outputPath }
  },
  cancelAudioJob: vi.fn()
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async () => ({ duration: 8, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))
vi.mock('../ffmpeg/convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ffmpeg/convert')>()
  return {
    ...actual,
    convertToMp4: async (
      _owner: string,
      _input: string,
      output: string,
      onProgress?: (p: { percent?: number }) => void
    ): Promise<void> => {
      onProgress?.({ percent: 10 })
      writeFileSync(output, 'mp4')
    }
  }
})

interface Sender {
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
}
const DEAD_BY_FLAG = (): Sender & { attempts: number } => {
  const s = {
    attempts: 0,
    isDestroyed: () => true,
    send: (): void => {
      s.attempts++
      throw new Error('Object has been destroyed')
    }
  }
  return s
}
const DEAD_AFTER_CHECK = (): Sender & { attempts: number } => {
  const s = {
    attempts: 0,
    isDestroyed: () => false,
    send: (): void => {
      s.attempts++
      throw new Error('Object has been destroyed')
    }
  }
  return s
}

const { registerVideoIpc } = await import('./video')
const { registerCaptionsIpc } = await import('./captions')
const { registerAudioIpc } = await import('./audio')
const { registerRecordingIpc } = await import('./recording')

const job = {
  jobId: 'j1',
  sourcePath: SOURCE,
  outDir: tmpdir(),
  clip: {
    id: 'c1',
    name: 'Clip',
    startSec: 0,
    endSec: 5,
    cropRect: null,
    textOverlays: [],
    selectedPresets: ['youtube']
  },
  preset: 'youtube',
  outputFilename: 'a.mp4'
}
const reframe = {
  jobId: 'r1',
  sourcePath: SOURCE,
  outDir: tmpdir(),
  position: 'center',
  startSec: 0,
  endSec: 5,
  targetWidth: 1080,
  targetHeight: 1920
}
const audioExport = {
  jobId: 'a1',
  sourcePath: path.join(tmpdir(), 'voice.wav'),
  outputPath: path.join(tmpdir(), 'out.wav'),
  chain: DEFAULT_CHAIN_SPEC,
  format: 'wav'
}
const audioMux = {
  jobId: 'a1',
  videoPath: SOURCE,
  sourcePath: path.join(tmpdir(), 'voice.wav'),
  outputPath: path.join(tmpdir(), 'out.mp4'),
  chain: DEFAULT_CHAIN_SPEC
}
const transcribe = { jobId: 't1', sourcePath: SOURCE }
const burnIn = {
  jobId: 'b1',
  videoPath: SOURCE,
  srtPath: path.join(tmpdir(), 'in.srt'),
  outputPath: path.join(tmpdir(), 'out.mp4'),
  fontSizePct: 4
}

/** [name, channel, args]: one row per callback the ticket listed, plus the one it said to grep for. */
const SITES: Array<[string, string, unknown[]]> = [
  ['video:progress and video:jobComplete (the export batch)', 'video:exportBatch', [[job]]],
  ['video:reframeProgress', 'video:reframe', [reframe]],
  ['video:highlightProgress', 'video:findHighlights', [SOURCE]],
  ['captions:progress (transcribe)', 'captions:transcribe', [transcribe]],
  ['captions:progress (burn-in)', 'captions:burnIn', [burnIn]],
  ['captions:modelProgress', 'captions:installModel', []],
  ['audio:progress (export)', 'audio:export', [audioExport]],
  ['audio:progress (re-attach)', 'audio:mux', [audioMux]]
]

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-closemid-'))
  handlers.clear()
  registerVideoIpc()
  registerCaptionsIpc()
  registerAudioIpc()
  registerRecordingIpc()
})
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// Two shapes of dead, and each one is what a different half of the guard is for: the flag is what
// `isDestroyed()` answers, and the throw is what a window that dies in between leaves.
const SHAPES = [
  ['its WebContents is already destroyed', DEAD_BY_FLAG, 0],
  ['it is destroyed between the check and the send', DEAD_AFTER_CHECK, 1]
] as const

describe('a progress report from a job whose window has closed is dropped, not thrown (T-123 (1))', () => {
  for (const [shape, make, tried] of SHAPES) {
    describe(`when ${shape}`, () => {
      it.each(SITES)('%s', async (_name, channel, args) => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`${channel} was not registered`)
        const sender = make()
        // The job's own answer still comes back: the report was the only thing lost.
        await expect(handler({ sender }, ...args)).resolves.toBeDefined()
        // A destroyed WebContents is never asked to send. One that dies after the check is asked
        // (once per report: the export batch reports progress and then completion) and the throw ends there.
        const reports = channel === 'video:exportBatch' ? 2 : 1
        expect(sender.attempts).toBe(tried * reports)
      })
    })
  }

  for (const [shape, make, tried] of SHAPES) {
    it(`recording:progress (the MP4 convert behind Save) when ${shape}`, async () => {
      const sender = make()
      fakeWin = { webContents: sender }
      const begin = handlers.get('recording:begin')
      const append = handlers.get('recording:appendChunk')
      const finalize = handlers.get('recording:finalize')
      if (!begin || !append || !finalize) throw new Error('recording handlers were not registered')
      const { id } = (await begin({})) as { id: string }
      await append({}, id, new Uint8Array([1, 2, 3, 4]).buffer)
      const saved = (await finalize({}, id, {
        filename: 'take.mp4',
        convertToMp4: true,
        durationMs: 3000
      })) as { outputPath: string } | null
      // The save still finished: the file is where Save chose, and only the report was dropped.
      expect(saved?.outputPath).toBe(path.join(TMP, 'take.mp4'))
      expect(sender.attempts).toBe(tried)
    })
  }
})
