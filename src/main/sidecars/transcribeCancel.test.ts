import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CANCELLED_MESSAGE, isCancelledError } from '../../shared/cancel'
import type { CaptionsProgress } from '../../shared/captions'

/**
 * T-113 (10) — this file's temp folder is its own. The extractor writes `tmpdir()/imagii-audio`,
 * and `tempCleanup.test.ts` used to empty that exact real folder (recursively, with exact-count
 * assertions) while this file's WAVs were being made — vitest runs files in parallel. The
 * extractor and this file now see a private `tmpdir()`; the folder goes with the file.
 */
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const sandbox = mkdtempSync(join(actual.tmpdir(), 'imagii-t108-sandbox-'))
  const tmpdir = (): string => sandbox
  return { ...actual, tmpdir, default: { ...actual, tmpdir } }
})

afterAll(() => {
  rmSync(tmpdir(), { recursive: true, force: true })
})

/**
 * T-108 (e) — transcription joins the cancel registry and the latch, like the burn-in.
 *
 * Transcription was the one long caption job nobody could stop: the Cancel button was
 * drawn for the burn-in phase only, no IPC reached `cancelTranscribe`, and the runner
 * had no run — so even the exported function (the quit sweep's) found nothing to mark
 * while the job was still extracting the sound. Most of a transcription of a long VOD
 * is spent in that first child, before the speech engine exists.
 *
 * Unlike `cancelSentinel.test.ts` (which mocks the extractor to hold it), this file
 * runs the REAL `extractAudioFromVideo` against a fake `spawn`, because the claim is
 * about its child: a Cancel kills the extraction's ffmpeg, the half-written WAV goes
 * with it, and the speech engine is never started. Layer 5 (media.spec.ts) proves the
 * same extractor against a real ffmpeg.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runners set utf8 on both pipes */
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}

const WHISPER = '/x/whisper-cli.exe'
let scratch = ''
interface Spawned {
  cmd: string
  args: string[]
  child: FakeChild
}
let spawned: Spawned[] = []
/** What a spawned child does once the runner has attached its listeners. */
let onSpawn: (s: Spawned) => void = () => undefined

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    const child = new FakeChild()
    const entry = { cmd, args, child }
    spawned.push(entry)
    queueMicrotask(() => onSpawn(entry))
    return child
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => scratch, isPackaged: false },
  net: { request: () => ({}) }
}))
vi.mock('./paths', () => ({
  whisperExePath: () => ({ path: WHISPER, exists: true, sizeBytes: 1 }),
  whisperModelPath: () => ({ path: '/x/model.bin', exists: true, sizeBytes: 1 }),
  captionsOutputDir: () => path.join(scratch, 'captions'),
  modelsDir: () => path.join(scratch, 'models')
}))

const { runTranscribe, cancelTranscribe } = await import('./whisperManager')

const SRT = '1\n00:00:00,000 --> 00:00:03,000\nhello there\n'
const request = { jobId: 'j1', sourcePath: '/tmp/in.mp4' }

/** The WAV the extractor's ffmpeg was asked to write: the last argument of its argv. */
function wavOf(s: Spawned): string {
  return s.args[s.args.length - 1] as string
}

/** What ffmpeg does the moment it starts writing: a file appears. */
function startWriting(s: Spawned): void {
  mkdirSync(path.dirname(wavOf(s)), { recursive: true })
  writeFileSync(wavOf(s), 'RIFF....partial')
}

/** A SIGKILL'd child closes (Windows: code 1; POSIX: code null + SIGKILL). */
function dies(s: Spawned): void {
  s.child.emit('close', null, 'SIGKILL')
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t108-'))
  mkdirSync(path.join(scratch, 'captions'), { recursive: true })
  spawned = []
  onSpawn = () => undefined
  cancelTranscribe() // nothing in flight between cases
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function settle(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )
}

describe('a Cancel during the extraction (the first, and often the longest, child)', () => {
  it('kills the extraction child, removes the half-written WAV, and never starts the speech engine', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) startWriting(s)
    }
    const outcome = settle(runTranscribe(request, () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 3000 })
    const extraction = spawned[0] as Spawned
    expect(extraction.cmd).not.toBe(WHISPER)
    await vi.waitFor(() => expect(existsSync(wavOf(extraction))).toBe(true))

    expect(cancelTranscribe('j1')).toBe(true)
    // The kill reached the extraction's ffmpeg, as a kill the app asked for.
    expect(extraction.child.signals).toEqual(['SIGKILL'])
    dies(extraction)

    const err = await outcome
    expect(isCancelledError(err)).toBe(true)
    expect((err as Error).message).toBe(CANCELLED_MESSAGE)
    await vi.waitFor(() => expect(existsSync(wavOf(extraction))).toBe(false))
    expect(spawned).toHaveLength(1) // no whisper
  })

  it('the all-jobs cancel (the quit sweep) does the same', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) startWriting(s)
    }
    const outcome = settle(runTranscribe(request, () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 3000 })
    const extraction = spawned[0] as Spawned
    expect(cancelTranscribe()).toBe(true)
    expect(extraction.child.signals).toEqual(['SIGKILL'])
    dies(extraction)
    expect(isCancelledError(await outcome)).toBe(true)
    // The extractor removes its own file once its child has closed — after the job has
    // already been refused, so this waits for it instead of racing it.
    await vi.waitFor(() => expect(existsSync(wavOf(extraction))).toBe(false))
    expect(spawned).toHaveLength(1)
  })

  it('the Cancel ends the wait AT ONCE — it does not wait for the extraction to notice its kill', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) startWriting(s)
    }
    const outcome = settle(runTranscribe(request, () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 3000 })
    cancelTranscribe('j1')
    // The extraction child has NOT closed, and the job is already refused.
    const err = await outcome
    expect(isCancelledError(err)).toBe(true)
  })

  it('a Cancel that lands before the extraction child exists kills it the moment it does', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) startWriting(s)
    }
    // The first progress event is sent between the runner's own mkdir and the
    // extractor's: pressing Cancel there is a Cancel with no child to kill yet.
    const events: CaptionsProgress[] = []
    const outcome = settle(
      runTranscribe(request, (p) => {
        events.push(p)
        if (p.phase === 'extracting') cancelTranscribe('j1')
      })
    )
    const err = await outcome
    expect(isCancelledError(err)).toBe(true)
    // The extractor still starts its ffmpeg (it had no way to know) — and it is killed at once.
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 3000 })
    const extraction = spawned[0] as Spawned
    expect(extraction.child.signals).toEqual(['SIGKILL'])
    dies(extraction)
    await vi.waitFor(() => expect(existsSync(wavOf(extraction))).toBe(false))
    expect(spawned).toHaveLength(1)
    expect(events.map((e) => e.phase)).toEqual(['extracting'])
  })

  it('the arrival-kill leaves nothing registered: no entry, and a later cancel finds nothing to cancel (T-111)', async () => {
    // The Cancel ends the wait at once, whose cleanup clears the job's entry; the extractor's
    // child is only created AFTER that, and the arrival callback used to put it back before
    // killing it. A dead job's child then sat in the map: the next cancelTranscribe() found
    // it, answered "canceled something", and signaled a process that was long gone.
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) startWriting(s)
    }
    const outcome = settle(
      runTranscribe(request, (p) => {
        if (p.phase === 'extracting') cancelTranscribe('j1')
      })
    )
    expect(isCancelledError(await outcome)).toBe(true)
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: 3000 })
    const extraction = spawned[0] as Spawned
    expect(extraction.child.signals).toEqual(['SIGKILL'])
    dies(extraction)
    await vi.waitFor(() => expect(existsSync(wavOf(extraction))).toBe(false))

    // Nothing is registered under the job, nor under anything: both forms of the cancel say so,
    // and neither signals the dead child a second time.
    expect(cancelTranscribe('j1')).toBe(false)
    expect(cancelTranscribe()).toBe(false)
    expect(extraction.child.signals).toEqual(['SIGKILL'])
  })

  it('a Cancel pressed before the job starts does not reach it (the run ends with its job)', async () => {
    expect(cancelTranscribe('j1')).toBe(false)
    expect(cancelTranscribe()).toBe(false)
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) {
        startWriting(s)
        s.child.emit('close', 0, null)
        return
      }
      const base = s.args[s.args.indexOf('-of') + 1] as string
      writeFileSync(`${base}.srt`, SRT, 'utf8')
      s.child.emit('close', 0, null)
    }
    const result = await runTranscribe(request, () => undefined)
    expect(result.segments).toHaveLength(1)
    expect(spawned.map((s) => s.cmd === WHISPER)).toEqual([false, true])
  })
})

describe('a Cancel during the speech engine', () => {
  it('kills it, removes the extracted WAV, and rejects with the sentinel', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) {
        startWriting(s)
        s.child.emit('close', 0, null)
      }
    }
    const outcome = settle(runTranscribe(request, () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(2), { timeout: 3000 })
    const [extraction, engine] = spawned as [Spawned, Spawned]
    expect(engine.cmd).toBe(WHISPER)
    expect(existsSync(wavOf(extraction))).toBe(true)

    expect(cancelTranscribe('j1')).toBe(true)
    expect(engine.child.signals).toEqual(['SIGKILL'])
    dies(engine)

    const err = await outcome
    expect(isCancelledError(err)).toBe(true)
    // The sound extracted for it is not left behind in the temp folder.
    expect(existsSync(wavOf(extraction))).toBe(false)
  })

  it('a failure nobody asked for is still a failure, not a cancel', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) {
        startWriting(s)
        s.child.emit('close', 0, null)
      } else {
        s.child.emit('close', 1, null)
      }
    }
    const err = await settle(runTranscribe(request, () => undefined))
    expect(isCancelledError(err)).toBe(false)
    expect((err as Error).message).toMatch(/whisper exit 1/)
  })

  it('an extraction that fails on its own removes its WAV and reports the failure', async () => {
    onSpawn = (s) => {
      startWriting(s)
      s.child.emit('close', 1, null)
    }
    const err = await settle(runTranscribe(request, () => undefined))
    expect(isCancelledError(err)).toBe(false)
    expect((err as Error).message).toMatch(/audio extract exit 1/)
    expect(existsSync(wavOf(spawned[0] as Spawned))).toBe(false)
  })
})

describe('the sound handed to the speech engine (T-111)', () => {
  it('is extracted at 16 kHz mono, and that file is the one the engine is given', async () => {
    onSpawn = (s) => {
      if (s.cmd !== WHISPER) {
        startWriting(s)
        s.child.emit('close', 0, null)
        return
      }
      const base = s.args[s.args.indexOf('-of') + 1] as string
      writeFileSync(`${base}.srt`, SRT, 'utf8')
      s.child.emit('close', 0, null)
    }
    await runTranscribe(request, () => undefined)
    const [extraction, engine] = spawned as [Spawned, Spawned]
    const flag = (s: Spawned, name: string): string | undefined => s.args[s.args.indexOf(name) + 1]
    // ~690 MB an hour at 48 kHz stereo; the engine resamples to this anyway and older
    // whisper.exe builds refuse anything else.
    expect(flag(extraction, '-ar')).toBe('16000')
    expect(flag(extraction, '-ac')).toBe('1')
    expect(flag(extraction, '-acodec')).toBe('pcm_s16le')
    expect(flag(engine, '-f')).toBe(wavOf(extraction))
  })
})
