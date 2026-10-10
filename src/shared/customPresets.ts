import type { PlatformId } from './clip'

export interface CustomPreset {
  id: string
  name: string
  width: number
  height: number
  fps: number
  videoBitrate: string
  audioBitrate: string
  basePlatformId: PlatformId
}

/**
 * An FFmpeg bitrate literal: digits with an optional decimal part and an
 * optional k/M suffix — "192k", "8M", "2.5M", "5000000".
 *
 * T-50 put custom presets on the export path, which means these two strings
 * now reach `-b:v` / `-b:a` in the encoder's argv. They are checked in both
 * directions: `CustomPresetManager` refuses to SAVE a preset it could not
 * later export (a preset that cannot be used is the exact defect T-50 is
 * about), and `validateExportJob` refuses to RUN one, because the renderer
 * is a trust boundary and an on-disk preset file can be edited by hand.
 */
const BITRATE_RE = /^\d{1,9}(\.\d{1,3})?[kKmM]?$/

export function isValidBitrate(v: unknown): v is string {
  return typeof v === 'string' && BITRATE_RE.test(v)
}

export type BitrateKind = 'video' | 'audio'
export type NormalizedBitrate = { ok: true; value: string } | { ok: false; problem: string }

const BARE_NUMBER_RE = /^\d{1,9}(\.\d{1,3})?$/
/** The biggest bare number still read as kilobits per second: 100 Mbps, past
 *  anything a platform takes. Above it the user almost certainly typed bits. */
const MAX_BARE_KBPS = 100_000

/** 5 -> "5", 128.5 -> "128.5": a rate without float noise or a trailing ".0". */
function plainNumber(n: number): string {
  return String(Number(n.toFixed(3)))
}

/**
 * What the custom-preset form does with a bitrate the user typed (T-92).
 *
 * ffmpeg reads a bare number as BITS per second, so "192" saved as an audio
 * rate meant 192 bits/s and "8000" as a video rate meant 8 kbps — while the
 * label ("V bitrate") never said which unit was expected. A bare number is
 * now read the way every streaming tool reads it, as kilobits per second, and
 * saved with its `k` so what is stored says what it means; a bare number too
 * big to be kilobits is refused with the spelling that would work. A
 * lowercase `m` becomes `M`: to ffmpeg `m` is milli, so "8m" would encode at
 * 0.008 bits/s, which is never what anyone typed it for.
 *
 * The result always passes `isValidBitrate`, the gate main applies again
 * before anything reaches ffmpeg's argv.
 */
export function normalizeBitrate(raw: string, kind: BitrateKind): NormalizedBitrate {
  const noun = kind === 'video' ? 'Video bitrate' : 'Audio bitrate'
  const example = kind === 'video' ? '8M or 8000k' : '192k or 128k'
  const unreadable: NormalizedBitrate = {
    ok: false,
    problem: `${noun} needs a number and a unit, like ${example}.`
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (BARE_NUMBER_RE.test(text)) {
    const n = Number(text)
    if (!(n > 0)) return unreadable
    if (n > MAX_BARE_KBPS) {
      const suggestion = n >= 1_000_000 ? `${plainNumber(n / 1_000_000)}M` : `${plainNumber(n / 1000)}k`
      return {
        ok: false,
        problem: `${text} is too big to be kilobits per second. Write ${suggestion} instead.`
      }
    }
    return { ok: true, value: `${text}k` }
  }
  if (!isValidBitrate(text)) return unreadable
  const number = parseFloat(text)
  if (!(number > 0)) return unreadable
  const suffix = text.slice(-1)
  return { ok: true, value: text.slice(0, -1) + (suffix === 'm' || suffix === 'M' ? 'M' : 'k') }
}

/**
 * A stored bitrate as a person reads it: "8M" -> "8 Mbps", "192k" ->
 * "192 kbps". A bare number is what ffmpeg reads it as, bits per second (a
 * preset saved before T-92 can hold one). Anything unreadable comes back
 * untouched; inventing a unit would be worse than showing what is there.
 */
export function formatBitrate(value: string): string {
  if (!isValidBitrate(value)) return value
  const suffix = value.slice(-1)
  if (/[mM]/.test(suffix)) return `${plainNumber(parseFloat(value))} Mbps`
  if (/[kK]/.test(suffix)) return `${plainNumber(parseFloat(value))} kbps`
  const bits = Number(value)
  if (bits >= 1_000_000) return `${plainNumber(bits / 1_000_000)} Mbps`
  if (bits >= 1000) return `${plainNumber(bits / 1000)} kbps`
  return `${plainNumber(bits)} bps`
}
