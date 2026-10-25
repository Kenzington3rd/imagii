import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, unlink } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { ffmpegPath } from '../ffmpeg/paths'
import { cancelledOr, killAsCancelled } from '../ffmpeg/cancelMark'
import { CancelLatch, type LatchRun } from '../ffmpeg/cancelLatch'
import { assert } from '../../shared/assert'

export interface ExtractedAudio {
  wavPath: string
  cleanup: () => Promise<void>
}

/** The sound a WAV is written at. */
export interface ExtractFormat {
  sampleRate: number
  channels: number
}

/**
 * What Audio Studio loads: 48 kHz stereo, the rate and layout its whole chain,
 * the mix and the export work at. The default. Transcription asks for its own
 * (`TRANSCRIPTION_AUDIO`, shared/captions.ts, T-111).
 */
export const STUDIO_AUDIO: ExtractFormat = { sampleRate: 48000, channels: 2 }

/** The stage that puts the extracted sound on the container's clock (T-125 (2)); exported for the unit pin. */
export const EXTRACT_CLOCK_FILTER = 'aresample=async=1:first_pts=0'

/**
 * Every extraction ffmpeg that is running, from its spawn until it closes or
 * fails (T-111). The transcription's copy of this lives in `activeTranscribe`
 * for a per-job Cancel; the Audio Studio's own (`audio:extractFromVideo`, the
 * import of a recording's sound) had no registry at all, so a quit in the middle
 * of a long VOD's extraction left an ffmpeg.exe writing a scratch WAV into
 * %TEMP% after the window was gone. `cancelAllExtractions` is what the quit sweep
 * and `cancelAllAudioJobs` call.
 */
const activeExtractions = new Set<ChildProcess>()

/**
 * T-128 (5), T-127 (3)'s "not covered": an extraction is a RUN (`cancelLatch.ts`) from its call until the scratch WAV it was writing is
 * gone (or handed back). The quit sweep kills the child and then waits for every run to end; the unlink of a killed extraction's
 * half-written WAV ran AFTER the kill, on later event-loop turns, and the process was gone first - a quit in the middle of a long VOD's
 * extraction left up to gigabytes of WAV in %TEMP%\imagii-audio for the 6-hour reaper. Every caller shares it (Audio Studio's import,
 * Clean audio, a restored project, the transcription's sound); the transcription is also its own run in `whisperManager`.
 */
const extractLatch = new CancelLatch()

export function cancelAllExtractions(): void {
  extractLatch.cancelAll()
  for (const child of activeExtractions) killAsCancelled(child)
  activeExtractions.clear()
}

/** Test-only access to the registry. */
export const __extractTesting__ = { activeCount: (): number => activeExtractions.size }

/**
 * `onChild` hands the caller the ffmpeg child the moment it exists, so a job that
 * can be canceled (transcription, T-108) can kill it. An extraction that fails or
 * is killed removes the WAV it was writing: the name is fresh (`nanoid`), so the
 * file is this call's alone, and a half-written one is nobody's result. T-128 (5): and the call is a run until that removal is done.
 */
export async function extractAudioFromVideo(
  videoPath: string,
  onChild?: (child: ChildProcess) => void,
  format: ExtractFormat = STUDIO_AUDIO
): Promise<ExtractedAudio> {
  assert(
    Number.isInteger(format.sampleRate) && format.sampleRate > 0 && Number.isInteger(format.channels) && format.channels > 0,
    'extract format must be a whole sample rate and channel count'
  )
  const run = extractLatch.begin()
  try {
    return await extractUnderRun(videoPath, onChild, format, run)
  } finally {
    run.end()
  }
}

async function extractUnderRun(
  videoPath: string,
  onChild: ((child: ChildProcess) => void) | undefined,
  format: ExtractFormat,
  run: LatchRun
): Promise<ExtractedAudio> {
  const dir = path.join(tmpdir(), 'imagii-audio')
  // A Cancel that lands while the folder is made ends the wait, and no child is spawned (T-98).
  await run.guard(mkdir(dir, { recursive: true }))
  const wavPath = path.join(dir, `${nanoid(10)}.wav`)

  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        videoPath,
        '-vn',
        // T-125 (2): the WAV's clock is the CONTAINER's. A sound that starts after the picture (an MP4's `start_time` of
        // 0.278 s, a capture card's late audio) was written from its first sample, so every consumer put it at the start
        // of the file: Clean audio's Re-attach moved the sound early by exactly the offset, and the transcription timed
        // every burned caption early with it. `first_pts=0` pads the head with silence (and trims an encoder's negative
        // priming); a sound that starts at 0 comes out byte for byte as before. `async=1` corrects the start and, past
        // aresample's own 0.1 s threshold, a gap or overlap inside the stream, which is where the sound belongs anyway.
        // T-126 (22), known limitation, no cap applied: a file whose timestamps JUMP FORWARD (a +600 s `setts` jump turns a 30 s file into a
        // 630 s WAV of padded silence) extracts to the length its CONTAINER claims (ffprobe reads ~630 s on every shape of it), the same
        // duration every player and this app's own probe and UI report, so there is no truer length to cap `-t` against. And a timestamp
        // RESET silently drops real audio with no ffmpeg knob to keep it (`first_pts=0` alone behaves the same).
        '-af',
        EXTRACT_CLOCK_FILTER,
        '-acodec',
        'pcm_s16le',
        '-ar',
        String(format.sampleRate),
        '-ac',
        String(format.channels),
        wavPath
      ],
      { windowsHide: true }
    )
    activeExtractions.add(p)
    onChild?.(p)
    let stderr = ''
    // T-136 (13): the 16 KB tail every other spawn keeps (LESSONS_LEARNED, round 18). T-129 made multi-hour extractions reachable, and this one
    // held ALL of an hour-long run's stderr for the last 500 characters the failure uses. `stderrCapped.test.ts` finds the next one that forgets.
    p.stderr.on('data', (b) => {
      stderr += String(b)
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    p.on('error', (err) => {
      activeExtractions.delete(p)
      reject(cancelledOr(p, err))
    })
    p.on('close', (code) => {
      activeExtractions.delete(p)
      if (code === 0) resolve()
      else reject(cancelledOr(p, new Error(`audio extract exit ${code}: ${stderr.slice(-500)}`)))
    })
  }).catch(async (err: unknown) => {
    await unlink(wavPath).catch(() => undefined)
    throw err
  })

  return {
    wavPath,
    cleanup: async () => {
      const fs = await import('node:fs/promises')
      try {
        await fs.unlink(wavPath)
      } catch {
        /* noop */
      }
    }
  }
}
