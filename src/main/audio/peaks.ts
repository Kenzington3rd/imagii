import { spawn, type ChildProcess } from 'node:child_process'
import { ffmpegPath } from '../ffmpeg/paths'
import { cancelledOr, killAsCancelled } from '../ffmpeg/cancelMark'
import { CancelLatch } from '../ffmpeg/cancelLatch'
import { probeAudio } from './probe'
import { PEAK_BUCKETS, WAVEFORM_READ_FAILED, type WaveformPeaks, type WaveformPeaksProgress } from '../../shared/audio'
import { assertAlways } from '../../shared/assert'
import { isCancelledError } from '../../shared/cancel'

/**
 * T-129 (T-110 (ao)): the waveform's picture of the sound, computed HERE.
 *
 * Audio Studio used to hand wavesurfer the file's address and let it fetch the whole file and decode it with WebAudio in the
 * renderer: a 1 h WAV took 3.25 GB of the renderer's memory and a 2 h one 6.5 GB (sweep 12), so T-123 refused anything over two
 * hours. Now ffmpeg decodes the sound as a STREAM, mono, at `PEAKS_SAMPLE_RATE`, into a pipe, and every chunk that arrives is
 * folded into `PEAK_BUCKETS` highest/lowest pairs and dropped: neither this process nor the renderer ever holds the file or its
 * decoded sound, whatever its length. The renderer passes the pairs and the length to wavesurfer, and the media element streams
 * the file for playback over the Range-capable imagii-file protocol, as it always did.
 */

/**
 * The rate the sound is decoded at for the picture. A bucket of a 2-hour file is 1.8 s of sound, so the rate only matters for
 * short files and for what a resampler's low-pass takes off the top: 8 kHz keeps everything under 4 kHz (a voice's and a mix's
 * peaks), is a sixth of the PCM a 48 kHz decode would pipe (a 3 h file is 173 MB through the pipe, not 1 GB), and is still 2
 * samples per bucket for a file of one second.
 */
export const PEAKS_SAMPLE_RATE = 8000

/** The ffmpeg arguments of a peaks job: the first sound stream, mono, `PEAKS_SAMPLE_RATE`, raw 16-bit little-endian on stdout. */
export function peaksArgs(filePath: string): string[] {
  return [
    '-v',
    'error',
    '-i',
    filePath,
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(PEAKS_SAMPLE_RATE),
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    'pipe:1'
  ]
}

/** How many buckets a file of `duration` seconds gets: `PEAK_BUCKETS`, or one per sample for a file shorter than that. */
export function bucketCount(duration: number): number {
  assertAlways(Number.isFinite(duration) && duration > 0, 'bucketCount needs a positive duration')
  return Math.max(1, Math.min(PEAK_BUCKETS, Math.round(duration * PEAKS_SAMPLE_RATE)))
}

export interface PeakFolder {
  /** Fold one chunk of s16le PCM. A chunk may end in the middle of a sample; the odd byte waits for the next one. */
  push(chunk: Buffer): void
  /** Samples folded so far. */
  readonly samples: number
  /** The pairs, rounded to 4 decimals: `[highest, lowest]` per bucket, 0 for a bucket no sample reached. */
  peaks(): [number[], number[]]
}

/**
 * The fold, pure: `expectedSamples` (the probed length times the rate) spreads the samples over `buckets` buckets by position,
 * so a sample at time t lands in bucket floor(t / duration * buckets). A decode that runs past the probed length (a length
 * estimated from a bitrate) lands its extra samples in the last bucket; one that falls short leaves its tail buckets at 0.
 * Holds two arrays of `buckets` numbers and at most one byte between chunks, nothing else.
 */
export function createPeakFolder(buckets: number, expectedSamples: number): PeakFolder {
  assertAlways(Number.isInteger(buckets) && buckets > 0, 'createPeakFolder needs a whole number of buckets')
  assertAlways(Number.isFinite(expectedSamples) && expectedSamples > 0, 'createPeakFolder needs a positive sample count')
  const high = new Float64Array(buckets)
  const low = new Float64Array(buckets)
  const last = buckets - 1
  let samples = 0
  let carry: number | null = null
  const fold = (value: number): void => {
    const bucket = Math.min(last, Math.floor((samples * buckets) / expectedSamples))
    if (value > high[bucket]!) high[bucket] = value
    if (value < low[bucket]!) low[bucket] = value
    samples += 1
  }
  return {
    push(chunk: Buffer): void {
      let i = 0
      if (carry !== null && chunk.length > 0) {
        const joined = (chunk[0]! << 8) | carry
        fold((joined >= 0x8000 ? joined - 0x10000 : joined) / 32768)
        carry = null
        i = 1
      }
      for (; i + 1 < chunk.length; i += 2) fold(chunk.readInt16LE(i) / 32768)
      if (i < chunk.length) carry = chunk[i]!
    },
    get samples(): number {
      return samples
    },
    peaks(): [number[], number[]] {
      const round = (v: number): number => Math.round(v * 10000) / 10000
      return [Array.from(high, round), Array.from(low, round)]
    }
  }
}

/**
 * Every peaks job running, by the job id the renderer minted (the per-job Cancel names it), and the latch its runs open: a
 * Cancel that lands while the probe runs (before there is a child) still stops the job (T-98), and the quit waits for the
 * killed job's run to end (`drainRuns`, T-127 (3)).
 */
const activePeaks = new Map<string, ChildProcess>()
const latch = new CancelLatch()

export type PeaksProgressListener = (p: WaveformPeaksProgress) => void

/**
 * Read `filePath`'s sound and answer its waveform. The probe's failures pass through as they are (a missing file reads "can't
 * find that file" in the importer); a decode that fails is `WAVEFORM_READ_FAILED`, with ffmpeg's own words in the console; a
 * Cancel is the cancel sentinel.
 */
export async function readPeaks(filePath: string, jobId: string, onProgress: PeaksProgressListener): Promise<WaveformPeaks> {
  const run = latch.begin(jobId)
  try {
    const { duration } = await run.guard(probeAudio(filePath))
    const buckets = bucketCount(duration)
    const expected = duration * PEAKS_SAMPLE_RATE
    const folder = createPeakFolder(buckets, expected)
    await new Promise<void>((resolve, reject) => {
      run.check()
      const child = spawn(ffmpegPath, peaksArgs(filePath), { windowsHide: true })
      activePeaks.set(jobId, child)
      let stderr = ''
      let sent = 0
      child.stdout.on('data', (chunk: Buffer) => {
        folder.push(chunk)
        const percent = Math.min(99, Math.floor((folder.samples / expected) * 100))
        if (percent > sent) {
          sent = percent
          onProgress({ jobId, percent })
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text: string) => {
        stderr = (stderr + text).slice(-16384)
      })
      child.on('error', (err) => {
        if (activePeaks.get(jobId) === child) activePeaks.delete(jobId)
        reject(cancelledOr(child, err))
      })
      child.on('close', (code) => {
        if (activePeaks.get(jobId) === child) activePeaks.delete(jobId)
        if (code === 0) {
          resolve()
          return
        }
        const failure = cancelledOr(child, new Error(WAVEFORM_READ_FAILED))
        if (!isCancelledError(failure)) {
          console.error(`[imagii] the waveform could not read ${filePath}: ffmpeg exit ${code}: ${stderr.trim().slice(-1000)}`)
        }
        reject(failure)
      })
    })
    onProgress({ jobId, percent: 100 })
    const peaks = folder.peaks()
    return { peaks, duration }
  } finally {
    run.end()
  }
}

/** Stop the peaks job `jobId`: marks its run (a Cancel before the child exists still lands) and kills its ffmpeg. */
export function cancelPeaksJob(jobId: string): boolean {
  const marked = latch.cancel(jobId)
  const child = activePeaks.get(jobId)
  if (!child) return marked
  killAsCancelled(child)
  activePeaks.delete(jobId)
  return true
}

/** Stop every peaks job (the quit sweep, `cancelAllAudioJobs`). */
export function cancelAllPeaks(): void {
  latch.cancelAll()
  for (const child of activePeaks.values()) killAsCancelled(child)
  activePeaks.clear()
}

/** Test-only access to the registry. */
export const __peaksTesting__ = { activeCount: (): number => activePeaks.size }
