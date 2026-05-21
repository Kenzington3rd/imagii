import { spawn, type ChildProcess } from 'node:child_process'
import { ffmpegPath } from './paths'
import { probeVideo } from './probe'
import { assert, assertDefined } from '../../shared/assert'

export interface HighlightCandidate {
  startSec: number
  endSec: number
  peakDb: number
  reason: 'loud' | 'sustained-loud'
}

export interface HighlightProgress {
  jobId: string
  phase: 'scanning' | 'done'
  percent: number
}

interface LoudnessSample {
  t: number
  m: number
}

// Defensive ceiling for the ebur128 stderr parser. ffmpeg emits one M:
// frame every ~100ms; even a 24-hour source would produce ~864k samples,
// well within this cap. Hitting it means the input is pathological — fail
// loudly rather than spin forever (Power of Ten rule 2).
const PARSE_EBUR128_MAX_ITERATIONS = 2_000_000

function parseEbur128(stderr: string): LoudnessSample[] {
  const samples: LoudnessSample[] = []
  const re = /t:\s*([\d.]+).*?M:\s*(-?[\d.]+)/g
  let m: RegExpExecArray | null
  let iterations = 0
  while ((m = re.exec(stderr)) !== null) {
    iterations++
    if (iterations > PARSE_EBUR128_MAX_ITERATIONS) {
      throw new Error(
        `parseEbur128: regex iterations exceeded ${PARSE_EBUR128_MAX_ITERATIONS}; aborting on suspected runaway input`
      )
    }
    const t = Number(m[1])
    const lufs = Number(m[2])
    if (Number.isFinite(t) && Number.isFinite(lufs)) {
      samples.push({ t, m: lufs })
    }
  }
  return samples
}

// Exported only for testing. Keeps the cap visible to test cases without
// exposing it through the broader module API.
export const __testing__ = { parseEbur128, PARSE_EBUR128_MAX_ITERATIONS }

// B3 fix (round 16): track every spawned ebur128 process so before-quit can
// hard-kill them. There's only ever one of each kind at a time:
//   - activeScan = the full-source findHighlights pass
//   - activeHookProcess = the per-clip analyzeClipHook pass
// cancelAllHighlightJobs() takes both.
let activeScan: ChildProcess | null = null

export async function findHighlights(
  jobId: string,
  sourcePath: string,
  onProgress: (p: HighlightProgress) => void
): Promise<HighlightCandidate[]> {
  const probe = await probeVideo(sourcePath)
  const totalDuration = probe.duration
  onProgress({ jobId, phase: 'scanning', percent: 0 })

  const args = [
    '-i',
    sourcePath,
    '-vn',
    '-af',
    'ebur128=metadata=1:framelog=quiet:peak=true',
    '-f',
    'null',
    '-'
  ]

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeScan = child
    let buffer = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      buffer += chunk
      const m = chunk.match(/t:\s*([\d.]+)/)
      if (m && totalDuration > 0) {
        const t = Number(m[1])
        const percent = Math.min(99, (t / totalDuration) * 100)
        onProgress({ jobId, phase: 'scanning', percent })
      }
    })
    child.on('error', (err) => {
      if (activeScan === child) activeScan = null
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (activeScan === child) activeScan = null
      if (code === 0) resolve(buffer)
      else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error('highlight scan cancelled'))
      } else reject(new Error(`ebur128 exit ${code}`))
    })
  })

  const samples = parseEbur128(stderr)
  if (samples.length < 5) {
    onProgress({ jobId, phase: 'done', percent: 100 })
    return []
  }

  const meaningful = samples.filter((s) => Number.isFinite(s.m) && s.m > -70)
  if (meaningful.length === 0) {
    onProgress({ jobId, phase: 'done', percent: 100 })
    return []
  }

  const sorted = [...meaningful].map((s) => s.m).sort((a, b) => a - b)
  const median = assertDefined(sorted[Math.floor(sorted.length / 2)], 'median sample')
  const p90 = assertDefined(sorted[Math.floor(sorted.length * 0.9)], 'p90 sample')
  const threshold = Math.max(median + 6, p90 - 1)

  const candidates: HighlightCandidate[] = []
  let inPeak = false
  let peakStart = 0
  let peakMax = -100

  for (const s of meaningful) {
    if (s.m >= threshold) {
      if (!inPeak) {
        inPeak = true
        peakStart = s.t
        peakMax = s.m
      } else {
        peakMax = Math.max(peakMax, s.m)
      }
    } else if (inPeak) {
      const peakEnd = s.t
      if (peakEnd - peakStart > 0.4) {
        const padded = {
          startSec: Math.max(0, peakStart - 5),
          endSec: Math.min(totalDuration, peakEnd + 5),
          peakDb: peakMax,
          reason: peakEnd - peakStart > 2 ? ('sustained-loud' as const) : ('loud' as const)
        }
        candidates.push(padded)
      }
      inPeak = false
      peakMax = -100
    }
  }
  if (inPeak) {
    const lastSample = assertDefined(samples[samples.length - 1], 'final sample')
    const padded = {
      startSec: Math.max(0, peakStart - 5),
      endSec: Math.min(totalDuration, lastSample.t + 5),
      peakDb: peakMax,
      reason: 'sustained-loud' as const
    }
    candidates.push(padded)
  }

  const merged: HighlightCandidate[] = []
  for (const c of candidates) {
    const last = merged[merged.length - 1]
    if (last && c.startSec - last.endSec < 5) {
      last.endSec = c.endSec
      last.peakDb = Math.max(last.peakDb, c.peakDb)
    } else {
      merged.push({ ...c })
    }
  }

  const ranked = merged.sort((a, b) => b.peakDb - a.peakDb).slice(0, 20)
  ranked.sort((a, b) => a.startSec - b.startSec)

  onProgress({ jobId, phase: 'done', percent: 100 })
  return ranked
}

/**
 * Phase 4C: analyze the first N seconds of a clip range for "hook" quality.
 * Single FFmpeg pass with ebur128 over the window — fast (~200-500ms for
 * 3 seconds of audio). Returns peak momentary loudness in LUFS, suitable
 * for shared/highlights.scoreHookQuality.
 *
 * Deliberately scoped to audio only this round; motion/scene-change/face
 * signals would each add another FFmpeg pass and the audio signal alone
 * is the dominant predictor for vertical-clip hooks.
 *
 * Tech-debt fix: hook analysis is fundamentally a "show this for the
 * currently selected clip" operation — there's only ever ONE relevant
 * result at a time. When a new analysis is requested, we kill any prior
 * in-flight ffmpeg process so rapid clip-selection doesn't pile up
 * orphaned processes burning CPU on results no one will see.
 */

let activeHookProcess: ChildProcess | null = null

export async function analyzeClipHook(
  sourcePath: string,
  startSec: number,
  durationSec = 3
): Promise<{ audioEnergyDb: number }> {
  assert(typeof sourcePath === 'string' && sourcePath.length > 0, 'sourcePath required')
  assert(Number.isFinite(startSec) && startSec >= 0, 'startSec must be finite >= 0')
  assert(Number.isFinite(durationSec) && durationSec > 0 && durationSec <= 30,
    'durationSec must be in (0, 30]')

  // Cancel any prior in-flight hook analysis. Killing here is safe — the
  // renderer's effect cleanup already drops the corresponding promise via
  // its `cancelled` flag, so the killed process's rejection is ignored.
  if (activeHookProcess && activeHookProcess.exitCode === null) {
    try {
      activeHookProcess.kill()
    } catch {
      /* already dead */
    }
  }

  const args = [
    '-ss',
    startSec.toFixed(3),
    '-t',
    durationSec.toFixed(3),
    '-i',
    sourcePath,
    '-vn',
    '-af',
    'ebur128=metadata=1:peak=true',
    '-f',
    'null',
    '-'
  ]

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeHookProcess = child
    let buffer = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      buffer += chunk
    })
    child.on('error', (err) => {
      if (activeHookProcess === child) activeHookProcess = null
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (activeHookProcess === child) activeHookProcess = null
      if (code === 0) resolve(buffer)
      // SIGTERM means we killed it on a newer request — surface a typed
      // error the renderer is allowed to ignore.
      else if (signal === 'SIGTERM') reject(new Error('hook analysis cancelled'))
      else reject(new Error(`hook ebur128 exit ${code}`))
    })
  })

  // Find max momentary loudness in the window. ebur128 stderr emits
  // "M:" lines roughly every 100ms; we take the highest. If no readable
  // M: line is found (silent or very short input), report -70 LUFS as a
  // floor rather than throwing — UI will paint "low" and let the user
  // judge.
  const re = /M:\s*(-?[\d.]+)/g
  let match: RegExpExecArray | null
  let maxDb = -70
  // PoT rule 2: bound the regex loop defensively.
  const HOOK_PARSE_MAX_ITER = 100_000
  let iter = 0
  while ((match = re.exec(stderr)) !== null) {
    iter++
    if (iter > HOOK_PARSE_MAX_ITER) {
      throw new Error('analyzeClipHook: M-value parse iterations exceeded cap')
    }
    const v = Number(match[1])
    if (Number.isFinite(v) && v > maxDb) maxDb = v
  }
  return { audioEnergyDb: maxDb }
}

// B3 fix (round 16): hard-kill any in-flight highlight ebur128 process on
// app quit. Covers both findHighlights (full source pass) and analyzeClipHook
// (per-clip window pass). Pre-16, a long source scan survived app quit.
export function cancelAllHighlightJobs(): void {
  if (activeScan && activeScan.exitCode === null) {
    try {
      activeScan.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  activeScan = null
  if (activeHookProcess && activeHookProcess.exitCode === null) {
    try {
      activeHookProcess.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  activeHookProcess = null
}
