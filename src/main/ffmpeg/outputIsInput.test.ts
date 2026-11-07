import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'
import { isCancelledError } from '../../shared/cancel'
import { userFacingError } from '../../shared/userFacingError'
import { openRunCount } from './cancelLatch'
import { OUTPUT_IS_AN_INPUT_MESSAGE } from './sameFile'

/**
 * T-141 (1) - a Save-dialog output that is a file the job READS is refused before anything runs.
 *
 * T-140 (1) hands ffmpeg a partial, which is never its input, so ffmpeg's own refusal at open ("FFmpeg cannot edit existing files in-place", exit 234, for an
 * output equal to an input) stopped happening, and a chosen output equal to the source was rendered and renamed over it (executed: `runAudioExport` with
 * outputPath === sourcePath, `runAudioMux` with outputPath === videoPath, a ranged burn-in over its own VOD). Every runner that writes a person's file asks
 * `refuseOutputOverInputs` FIRST, ahead of its probes and its run: the audio export (the source, the second track), the mux (the video, the sound), the re-attach
 * (the source, the video, the second track, and the scratch WAV it makes and deletes), and the burn-in (the video, the .srt).
 *
 * The real runners and the real IPC handlers run here on real files in a temp folder; only the child process and the probes are fakes, and the fake child is
 * what COUNTS: a refusal is "no child was spawned, the inputs are byte for byte what they were, and the folder holds what it held". The same rows run the other
 * way as controls (a different name still exports), so a guard that refuses everything cannot pass. Layer 5 (media.spec.ts) holds the same on the real binary.
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
const spawned: string[][] = []
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let scratch = ''

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    setImmediate(() => {
      // A pass that exits 0 has written its output: the partial the runner gave it, which the runner swaps in.
      writeFileSync(args[args.length - 1] as string, 'what ffmpeg wrote')
      child.stdout.emit('data', 'frame=30\nout_time=00:00:02.000000\nprogress=end\n')
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => void handlers.set(channel, fn) },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  net: { request: () => ({}) },
  app: { getPath: () => scratch, isPackaged: false }
}))
vi.mock('../sidecars/paths', () => ({
  whisperExePath: () => ({ path: '/x/whisper-cli.exe', exists: true, sizeBytes: 1 }),
  whisperModelPath: () => ({ path: '/x/model.bin', exists: true, sizeBytes: 1 }),
  captionsOutputDir: () => path.join(scratch, 'captions'),
  modelsDir: () => path.join(scratch, 'models')
}))
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: async () => ({ wavPath: '/tmp/imagii-t141.wav', cleanup: async () => undefined }),
  cancelAllExtractions: () => undefined
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async () => ({ duration: 8, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 }),
  // T-173 (2): a mix asks for both files' channel counts.
  probeAudioChannels: async () => 2
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({ duration: 8, width: 640, height: 480, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { runAudioExport, runAudioMux, runAudioReattach, cancelAudioJob } = await import('../audio/process')
const { runBurnIn, cancelBurnIn } = await import('../sidecars/whisperManager')
const { registerAudioIpc } = await import('../ipc/audio')
const { registerCaptionsIpc } = await import('../ipc/captions')
registerAudioIpc()
registerCaptionsIpc()

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const MINE = "the streamer's own file: the only copy"
const sender = { isDestroyed: () => false, send: vi.fn() }
const noProgress = (): void => undefined

const canSymlink = ((): boolean => {
  const probe = mkdtempSync(path.join(tmpdir(), 'imagii-t141-probe-'))
  try {
    writeFileSync(path.join(probe, 'a'), 'a')
    symlinkSync(path.join(probe, 'a'), path.join(probe, 'b'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t141-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
  spawned.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

/** A file of the person's, at `name` in the scratch folder. */
function mine(name: string): string {
  const file = path.join(scratch, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, MINE)
  return file
}

/** The ways one output can be spelled so it is a file the job reads: the same path, a `..` detour, and (where the platform allows) a symlink to it. */
function aliasesOf(file: string): Array<[string, string]> {
  // Spelled by hand: `path.join` would normalise the detour away. The folder it goes through is real, as a person's would be.
  mkdirSync(path.join(path.dirname(file), 'detour'), { recursive: true })
  const rows: Array<[string, string]> = [
    ['the same path', file],
    ['a path with a detour in it', `${path.dirname(file)}${path.sep}detour${path.sep}..${path.sep}${path.basename(file)}`]
  ]
  if (canSymlink) {
    const link = path.join(path.dirname(file), `link-to-${path.basename(file)}`)
    symlinkSync(file, link)
    rows.push(['a symlink to it', link])
  }
  return rows
}

/** What a refusal must leave: nothing spawned, every input byte for byte what it was, and no new file anywhere in the folder. */
async function expectRefused(run: () => Promise<unknown>, inputs: string[], before: string[]): Promise<void> {
  const shas = inputs.map(sha)
  const err = await run().then(
    () => null,
    (e: unknown) => e as Error
  )
  expect(err, 'refused').not.toBeNull()
  expect(err?.message, 'in the one sentence').toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
  expect(spawned, 'no ffmpeg (and no ffprobe) was started').toEqual([])
  expect(openRunCount(), 'and no run was left open: the quit waits for every open run, so one left behind by a refusal would hold it for its whole timeout').toBe(0)
  expect(inputs.map(sha), 'the inputs are byte for byte what they were').toEqual(shas)
  expect(listing(), 'and nothing was added to or removed from the folder').toEqual(before)
}

/** Every file under the scratch folder, relative, sorted: symlinks and the captions folder are part of "the folder". */
function listing(): string[] {
  const out: string[] = []
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(scratch, full))
    }
  }
  walk(scratch)
  return out.sort()
}

describe('audio export (runAudioExport)', () => {
  const spec = (sourcePath: string, outputPath: string, secondTrack?: string): Parameters<typeof runAudioExport>[0] => ({
    jobId: 't141-export',
    sourcePath,
    outputPath,
    format: 'wav',
    chain: {
      ...DEFAULT_CHAIN_SPEC,
      cutRegions: [],
      ...(secondTrack ? { secondaryTrack: { filePath: secondTrack, fileName: path.basename(secondTrack), role: 'music' as const, gainDb: -12, duckUnderPrimary: false } } : {})
    }
  })

  it.each(['the same path', 'a path with a detour in it', 'a symlink to it'])('an output that is the source (%s) is refused before any child', async (which) => {
    const source = mine('voice.wav')
    const out = aliasesOf(source).find(([name]) => name === which)?.[1]
    if (out === undefined) return // no symlink on this platform
    await expectRefused(() => runAudioExport(spec(source, out), noProgress), [source], listing())
  })

  it('an output that is the second track is refused too: the mix would be written over the music', async () => {
    const source = mine('voice.wav')
    const music = mine('bed.wav')
    await expectRefused(() => runAudioExport(spec(source, music, music), noProgress), [source, music], listing())
  })

  it('the control: a different name exports, with the source and the second track untouched', async () => {
    const source = mine('voice.wav')
    const music = mine('bed.wav')
    const out = path.join(scratch, 'voice-cleaned.wav')
    const result = await runAudioExport(spec(source, out, music), noProgress)
    expect(result.outputPath).toBe(out)
    expect(spawned.length, 'ffmpeg ran').toBeGreaterThan(0)
    expect(readFileSync(out, 'utf8')).toBe('what ffmpeg wrote')
    expect(sha(source)).toBe(createHash('sha256').update(MINE).digest('hex'))
    expect(sha(music)).toBe(createHash('sha256').update(MINE).digest('hex'))
  })
})

describe('the picture mux (runAudioMux)', () => {
  it.each(['the same path', 'a path with a detour in it', 'a symlink to it'])('an output that is the video (%s) is refused before any child', async (which) => {
    const video = mine('vod.mp4')
    const sound = mine('vod.cleaned.wav')
    const out = aliasesOf(video).find(([name]) => name === which)?.[1]
    if (out === undefined) return
    await expectRefused(() => runAudioMux('t141-mux', video, sound, out, noProgress), [video, sound], listing())
  })

  it('an output that is the sound it attaches is refused too', async () => {
    const video = mine('vod.mp4')
    const sound = mine('vod.cleaned.wav')
    await expectRefused(() => runAudioMux('t141-mux', video, sound, sound, noProgress), [video, sound], listing())
  })

  it('the control: a different name attaches', async () => {
    const video = mine('vod.mp4')
    const sound = mine('vod.cleaned.wav')
    const out = path.join(scratch, 'vod-cleaned.mp4')
    expect((await runAudioMux('t141-mux', video, sound, out, noProgress)).outputPath).toBe(out)
    expect(spawned.length).toBeGreaterThan(0)
  })
})

describe('Re-attach to video (runAudioReattach)', () => {
  const spec = (over: { sourcePath: string; videoPath: string; outputPath: string; secondTrack?: string }): Parameters<typeof runAudioReattach>[0] => ({
    jobId: 't141-reattach',
    sourcePath: over.sourcePath,
    videoPath: over.videoPath,
    outputPath: over.outputPath,
    chain: {
      ...DEFAULT_CHAIN_SPEC,
      cutRegions: [],
      ...(over.secondTrack ? { secondaryTrack: { filePath: over.secondTrack, fileName: path.basename(over.secondTrack), role: 'music' as const, gainDb: -12, duckUnderPrimary: false } } : {})
    }
  })

  it.each(['the same path', 'a path with a detour in it', 'a symlink to it'])('an output that is the video (%s) is refused before the first pass', async (which) => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    const out = aliasesOf(video).find(([name]) => name === which)?.[1]
    if (out === undefined) return
    await expectRefused(() => runAudioReattach(spec({ sourcePath: source, videoPath: video, outputPath: out }), noProgress), [source, video], listing())
  })

  it('an output that is the source is refused', async () => {
    const source = mine('voice.mp4')
    const video = mine('vod.mp4')
    await expectRefused(() => runAudioReattach(spec({ sourcePath: source, videoPath: video, outputPath: source }), noProgress), [source, video], listing())
  })

  it('an output that is the second track is refused', async () => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    const music = mine('bed.mp4')
    await expectRefused(
      () => runAudioReattach(spec({ sourcePath: source, videoPath: video, outputPath: music, secondTrack: music }), noProgress),
      [source, video, music],
      listing()
    )
  })

  it("the second track sits at the scratch WAV's usual name (T-142): the scratch takes a free name, the second track is read and never deleted, the job succeeds", async () => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    // `<output>.cleaned.wav` is where the intermediate used to go (and be deleted from); the person's music happens to be named that. The scratch WAV takes
    // a name nothing is at now, so there is nothing to refuse: the music is an input of the first pass, and the scratch is "out.cleaned (2).wav".
    const music = mine('out.cleaned.wav')
    const before = listing()
    const musicSha = sha(music)
    const out = path.join(scratch, 'out.mp4')
    expect((await runAudioReattach(spec({ sourcePath: source, videoPath: video, outputPath: out, secondTrack: music }), noProgress)).outputPath).toBe(out)
    expect(spawned.length, 'the render and the mux').toBe(2)
    expect(sha(music), 'the person\'s music is byte for byte what it was').toBe(musicSha)
    expect(listing(), 'and the scratch WAV went with the job: only the output is new').toEqual([...before, 'out.mp4'].sort())
  })

  it('the control: a different name runs both passes and leaves the inputs alone, with only the output new', async () => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    const before = listing()
    const out = path.join(scratch, 'out.mp4')
    expect((await runAudioReattach(spec({ sourcePath: source, videoPath: video, outputPath: out }), noProgress)).outputPath).toBe(out)
    expect(spawned.length, 'the render and the mux').toBe(2)
    expect(listing()).toEqual([...before, 'out.mp4'].sort())
  })
})

describe('the caption burn-in (runBurnIn)', () => {
  const request = (over: { videoPath: string; srtPath: string; outputPath: string; ranged?: boolean }): Parameters<typeof runBurnIn>[0] => ({
    jobId: 't141-burn',
    videoPath: over.videoPath,
    srtPath: over.srtPath,
    outputPath: over.outputPath,
    fontSizePct: 4,
    ...(over.ranged ? { startSec: 1, endSec: 3 } : {})
  })

  it.each([
    ['whole video', false],
    ['a range of it (the burn that replaced the whole VOD with the captioned range)', true]
  ])('an output that is the video is refused before any child: %s', async (_name, ranged) => {
    const video = mine('vod.mp4')
    const srt = mine('captions/vod.srt')
    for (const [, out] of aliasesOf(video)) {
      await expectRefused(() => runBurnIn(request({ videoPath: video, srtPath: srt, outputPath: out, ranged }), noProgress), [video, srt], listing())
    }
  })

  it('an output that is the .srt is refused too', async () => {
    const video = mine('vod.mp4')
    const srt = mine('captions/vod.srt')
    await expectRefused(() => runBurnIn(request({ videoPath: video, srtPath: srt, outputPath: srt, ranged: true }), noProgress), [video, srt], listing())
  })

  it('the control: a different name burns, and the video and the .srt are untouched', async () => {
    const video = mine('vod.mp4')
    const srt = mine('captions/vod.srt')
    writeFileSync(srt, '1\n00:00:01,500 --> 00:00:02,500\na cue\n')
    const shas = [sha(video), sha(srt)]
    const out = path.join(scratch, 'vod-captioned.mp4')
    expect((await runBurnIn(request({ videoPath: video, srtPath: srt, outputPath: out, ranged: true }), noProgress)).outputPath).toBe(out)
    expect(spawned.length).toBe(1)
    expect([sha(video), sha(srt)]).toEqual(shas)
  })
})

describe('the IPC handlers say it in the sentence the person reads', () => {
  const call = (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`${channel} is not registered`)
    return handler({ sender }, ...args)
  }

  it('audio:export over its own source rejects with the sentence, and userFacingError shows it as written', async () => {
    const source = mine('voice.wav')
    const err = await call('audio:export', {
      jobId: 't141-ipc-export',
      sourcePath: source,
      outputPath: source,
      format: 'wav',
      chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] }
    }).then(
      () => null,
      (e: unknown) => e as Error
    )
    expect(err?.message).toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
    expect(userFacingError(err, 'Export failed.').message).toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
    expect(spawned).toEqual([])
    expect(readFileSync(source, 'utf8')).toBe(MINE)
  })

  it('audio:mux over its own video rejects with the sentence', async () => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    const err = await call('audio:mux', {
      jobId: 't141-ipc-mux',
      sourcePath: source,
      videoPath: video,
      outputPath: video,
      chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] }
    }).then(
      () => null,
      (e: unknown) => e as Error
    )
    expect(err?.message).toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
    expect(spawned).toEqual([])
    expect(readFileSync(video, 'utf8')).toBe(MINE)
  })

  it('captions:burnIn over its own video rejects with the sentence', async () => {
    const video = mine('vod.mp4')
    const srt = mine('captions/vod.srt')
    const err = await call('captions:burnIn', request({ videoPath: video, srtPath: srt, outputPath: video })).then(
      () => null,
      (e: unknown) => e as Error
    )
    expect(err?.message).toBe(OUTPUT_IS_AN_INPUT_MESSAGE)
    expect(spawned).toEqual([])
    expect(readFileSync(video, 'utf8')).toBe(MINE)
  })

  function request(over: { videoPath: string; srtPath: string; outputPath: string }): Parameters<typeof runBurnIn>[0] {
    return { jobId: 't141-ipc-burn', fontSizePct: 4, ...over }
  }
})

// On Windows a case variant of an input IS the input (NTFS folds case, and the Save dialog returns what was typed). Linux cannot make two names of one file, so the
// platform rule is exercised the way `sameFile.test.ts` does it, one level up: `process.platform` reads win32 while the REAL runners run over real files whose
// names are upper case and whose outputs are spelled in lower case. The control row is the same pair on a platform that keeps case, where they are two files and
// the export runs: the refusals above are the fold's doing and not the guard refusing everything.
describe('on a case-insensitive platform, a case variant of an input is refused too (win32)', () => {
  const realPlatform = process.platform
  const setPlatform = (value: string): void => void Object.defineProperty(process, 'platform', { value, configurable: true })
  beforeEach(() => setPlatform('win32'))
  afterEach(() => setPlatform(realPlatform))
  const lower = (file: string): string => path.join(path.dirname(file), path.basename(file).toLowerCase())

  it('the audio export: over its source, and over the second track', async () => {
    const source = mine('VOICE.WAV')
    const music = mine('BED.WAV')
    const chain = { ...DEFAULT_CHAIN_SPEC, cutRegions: [], secondaryTrack: { filePath: music, fileName: 'BED.WAV', role: 'music' as const, gainDb: -12, duckUnderPrimary: false } }
    await expectRefused(() => runAudioExport({ jobId: 't141-win', sourcePath: source, outputPath: lower(source), chain, format: 'wav' }, noProgress), [source, music], listing())
    await expectRefused(() => runAudioExport({ jobId: 't141-win', sourcePath: source, outputPath: lower(music), chain, format: 'wav' }, noProgress), [source, music], listing())
  })

  it('the mux: over its video, and over its sound', async () => {
    const video = mine('VOD.MP4')
    const sound = mine('VOD.CLEANED.WAV')
    await expectRefused(() => runAudioMux('t141-win', video, sound, lower(video), noProgress), [video, sound], listing())
    await expectRefused(() => runAudioMux('t141-win', video, sound, lower(sound), noProgress), [video, sound], listing())
  })

  it('the re-attach: over its video, over its source, over the second track, and with the scratch WAV spelled in another case', async () => {
    const source = mine('VOICE.MP4')
    const video = mine('VOD.MP4')
    const music = mine('BED.MP4')
    const chain = { ...DEFAULT_CHAIN_SPEC, cutRegions: [], secondaryTrack: { filePath: music, fileName: 'BED.MP4', role: 'music' as const, gainDb: -12, duckUnderPrimary: false } }
    const reattach = (outputPath: string, withMusic = true): Promise<unknown> =>
      runAudioReattach({ jobId: 't141-win', sourcePath: source, videoPath: video, outputPath, chain: withMusic ? chain : { ...chain, secondaryTrack: null } }, noProgress)
    await expectRefused(() => reattach(lower(video)), [source, video, music], listing())
    await expectRefused(() => reattach(lower(source)), [source, video, music], listing())
    await expectRefused(() => reattach(lower(music)), [source, video, music], listing())
    const scratch = mine('OUT.CLEANED.WAV') // the job writes and deletes `out.cleaned.wav`
    await expectRefused(
      () => runAudioReattach({ jobId: 't141-win', sourcePath: source, videoPath: video, outputPath: path.join(scratch, '..', 'out.mp4'), chain: { ...chain, secondaryTrack: { ...chain.secondaryTrack, filePath: scratch } } }, noProgress),
      [source, video, scratch],
      listing()
    )
    expect(existsSync(scratch), 'the person\'s file is still there').toBe(true)
  })

  it('the burn-in: over its video, and over its .srt', async () => {
    const video = mine('VOD.MP4')
    const srt = mine('captions/VOD.SRT')
    const req = (outputPath: string): Parameters<typeof runBurnIn>[0] => ({ jobId: 't141-win', videoPath: video, srtPath: srt, outputPath, fontSizePct: 4, startSec: 1, endSec: 3 })
    await expectRefused(() => runBurnIn(req(lower(video)), noProgress), [video, srt], listing())
    await expectRefused(() => runBurnIn(req(lower(srt)), noProgress), [video, srt], listing())
  })

  it('the control: the same two names on a platform that keeps case are two files, and the export runs', async () => {
    setPlatform('linux')
    const source = mine('VOICE.WAV')
    const out = lower(source)
    const result = await runAudioExport({ jobId: 't141-win-ok', sourcePath: source, outputPath: out, chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] }, format: 'wav' }, noProgress)
    expect(result.outputPath).toBe(out)
    expect(spawned.length, 'ffmpeg ran').toBeGreaterThan(0)
    expect(readFileSync(source, 'utf8'), 'and the upper-case file is untouched').toBe(MINE)
  })
})

// T-98: a Cancel is a latch, not a call that has to land on a live child - the run opens in the call's first synchronous step, so a Cancel pressed at any moment after
// the call marks it. The check for an output that is an input resolves paths (a few milliseconds of `realpath`), and the first placement of it, ahead of `latch.begin`,
// made that window a hole: Layer 5's "audio export: a Cancel in the probe writes nothing" found it (the job started anyway and wrote the file). It is inside the run now.
describe('a Cancel pressed straight after the call, while the output is checked, is a Cancel (T-98 with T-141 (1))', () => {
  const settled = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e)

  it('the audio export: cancelled, nothing spawned, nothing written, no run left open', async () => {
    const source = mine('voice.wav')
    const out = path.join(scratch, 'voice-cleaned.wav')
    const running = settled(runAudioExport({ jobId: 't141-cancel-export', sourcePath: source, outputPath: out, chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] }, format: 'wav' }, noProgress))
    cancelAudioJob('t141-cancel-export')
    expect(isCancelledError(await running)).toBe(true)
    expect(spawned, 'no ffmpeg').toEqual([])
    expect(existsSync(out)).toBe(false)
    expect(openRunCount()).toBe(0)
  })

  it('the mux: cancelled, nothing spawned, nothing written, no run left open', async () => {
    const video = mine('vod.mp4')
    const sound = mine('vod.cleaned.wav')
    const out = path.join(scratch, 'vod-cleaned.mp4')
    const running = settled(runAudioMux('t141-cancel-mux', video, sound, out, noProgress))
    cancelAudioJob('t141-cancel-mux')
    expect(isCancelledError(await running)).toBe(true)
    expect(spawned).toEqual([])
    expect(existsSync(out)).toBe(false)
    expect(openRunCount()).toBe(0)
  })

  it('the re-attach: cancelled before its first pass, no scratch WAV, no run left open', async () => {
    const source = mine('voice.wav')
    const video = mine('vod.mp4')
    const out = path.join(scratch, 'out.mp4')
    const running = settled(
      runAudioReattach({ jobId: 't141-cancel-reattach', sourcePath: source, videoPath: video, outputPath: out, chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] } }, noProgress)
    )
    cancelAudioJob('t141-cancel-reattach')
    expect(isCancelledError(await running)).toBe(true)
    expect(spawned).toEqual([])
    expect(listing().filter((f) => f.startsWith('out')), 'neither the video nor its scratch WAV').toEqual([])
    expect(openRunCount()).toBe(0)
  })

  it('the burn-in: cancelled, nothing spawned, nothing written, no shifted .srt, no run left open', async () => {
    const video = mine('vod.mp4')
    const srt = mine('captions/vod.srt')
    const out = path.join(scratch, 'vod-captioned.mp4')
    const running = settled(runBurnIn({ jobId: 't141-cancel-burn', videoPath: video, srtPath: srt, outputPath: out, fontSizePct: 4, startSec: 1, endSec: 3 }, noProgress))
    cancelBurnIn('t141-cancel-burn')
    expect(isCancelledError(await running)).toBe(true)
    expect(spawned).toEqual([])
    expect(listing(), 'only the person\'s own files are in the folder').toEqual(['captions/vod.srt', 'vod.mp4'])
    expect(openRunCount()).toBe(0)
  })
})
