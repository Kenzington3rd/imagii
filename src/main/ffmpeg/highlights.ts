import { spawn } from 'node:child_process'
import { ffmpegPath } from './paths'
import { probeVideo } from './probe'

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
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(buffer)
      else reject(new Error(`ebur128 exit ${code}`))
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
  const median = sorted[Math.floor(sorted.length / 2)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
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
    const padded = {
      startSec: Math.max(0, peakStart - 5),
      endSec: Math.min(totalDuration, samples[samples.length - 1].t + 5),
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
