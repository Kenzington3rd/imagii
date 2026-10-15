import type {
  ChainSpec,
  CompressorPreset,
  DenoiseParams,
  DenoiseStrength,
  MainsHz
} from '../../shared/audio'
import { DEFAULT_DENOISE_PARAMS } from '../../shared/audio'

export function denoiseFilter(
  strength: DenoiseStrength,
  params?: DenoiseParams
): string | null {
  switch (strength) {
    case 'off':
      return null
    // INIT-A (round 15): the prior light/medium/aggressive presets emitted
    // afftdn=nf=… alone — leaving the noise-reduction amount at ffmpeg's
    // default of 12 dB regardless of strength. Spec the nr (reduction)
    // explicitly so the user-visible "aggressive" actually behaves
    // differently from "light".
    //
    // T-125 (3): the names are in the order of what they REMOVE. afftdn's `nf` is the noise floor it assumes and `nr` how far
    // it pulls down, and they point in opposite directions: a HIGHER assumed floor removes MORE (more of the signal is called
    // noise). The presets had nf falling as nr rose (-25/12, -30/18, -35/24), and on the pink and brown fan noise at -44 dBFS
    // that Aggressive is sold for, Aggressive removed 3.6-10.6 dB where Light removed 8.7-12 (measured through the real export on
    // both majors, Layer 5). Swapping the nf axis makes Light, Medium and Aggressive monotone in the noise removed (Layer 5, "the three
    // denoise strengths are ordered by the noise they remove") and, in the sweep's twelve fixtures, in the cost to soft content.
    // The exact numbers are the owner's to retune.
    case 'light':
      return 'afftdn=nf=-35:nr=12'
    case 'medium':
      return 'afftdn=nf=-30:nr=18'
    case 'aggressive':
      return 'afftdn=nf=-25:nr=24'
    case 'parametric': {
      const p = params ?? DEFAULT_DENOISE_PARAMS
      // Clamp the user-controllable values to afftdn's REAL accepted ranges
      // (verified against `ffmpeg -h filter=afftdn`): nf is -80..-20 (the
      // prior -10 ceiling let a third of the slider produce an out-of-range
      // value ffmpeg rejects), and nr's floor is 0.01, not 0. The prior
      // string also appended `ns=…` — afftdn has never had an `ns` option,
      // so every parametric export failed at graph-parse time. The
      // DenoiseParams.sensitivity field is retained for stored-preset
      // compatibility but no longer emitted.
      const nf = Math.max(-80, Math.min(-20, p.noiseFloorDb))
      const nr = Math.max(0.01, Math.min(50, p.reductionDb))
      return `afftdn=nf=${nf}:nr=${nr}`
    }
  }
}

function compressorFilter(preset: CompressorPreset): string | null {
  switch (preset) {
    case 'off':
      return null
    case 'voice':
      return 'acompressor=threshold=0.05:ratio=4:attack=20:release=250:makeup=2'
    case 'music':
      return 'acompressor=threshold=0.1:ratio=2:attack=20:release=500:makeup=1'
    case 'mixed':
      return 'acompressor=threshold=0.08:ratio=3:attack=20:release=300:makeup=1.5'
  }
}

/**
 * The ONE place a cut list becomes an ffmpeg expression: "keep a frame unless
 * its timestamp falls inside any region". Audio and video both cut on this
 * string (T-82), so the two streams can never be cut at different instants —
 * the audio-only version of this list is what let "Re-attach to video" drift
 * the sound ahead of an uncut picture.
 */
function keepExpression(cuts: ChainSpec['cutRegions']): string | null {
  const conditions = cuts
    .filter((c) => c.endSec > c.startSec)
    .map((c) => `between(t\\,${c.startSec.toFixed(3)}\\,${c.endSec.toFixed(3)})`)
  return conditions.length === 0 ? null : `not(${conditions.join('+')})`
}

/**
 * T-124 (32): the frame `aselect` keeps or drops whole is 256 samples, whatever the decoder produced. `aselect` evaluates `t` once
 * per FRAME, so a cut lands on the DECODER's block grid, not on the "1024 samples (about 21 ms)" the comments said: FLAC decodes
 * in 4608-sample blocks (96 ms at 48 kHz), ALAC in 4096, and a WAV in 1024 on 6.1.1 but 4096 on the bundled 7.0.2. Executed
 * through the real export that was a per-cut error of -77 ms (ALAC) and -60 ms (FLAC). `asetnsamples=n=256:p=0` ahead of it makes
 * every frame 256 samples (5.3 ms at 48 kHz; `p=0`: the last short frame is not padded with silence), so a cut's start and end
 * each land within one such block and the span removed is (end - start) +/- 256 samples. `asetpts=N/SR/TB` after the select
 * numbers the survivors by their SAMPLE index, so the closing of the gap is unaffected by the frame size.
 *
 * T-125 (5): the 256 grid is the cut's own, and it must not leak. `asetnsamples` re-chunks the frames for EVERY stage after it, so
 * the compressor, the denoiser, the notches, the limiter and the encoder all ran on 256-sample frames: a chained cut export
 * measured 1.7 to 2.3 times slower than the same chain without it, on both majors (per-frame overhead in every filter). The
 * second `asetnsamples=n=4096:p=0` sits AFTER `asetpts=N/SR/TB`, once the cut has been made and the survivors renumbered, and
 * hands the rest of the chain 4096-sample frames again. The output is bit-identical with and without it (Layer 5 measures the
 * bytes of three chains), and `p=0` again leaves the last short frame unpadded. The cut's own pair stays 256 AHEAD of the select.
 */
const CUT_BLOCK_SAMPLES = 256
const DOWNSTREAM_BLOCK_SAMPLES = 4096

export function aselectForCuts(cuts: ChainSpec['cutRegions']): string | null {
  const keep = keepExpression(cuts)
  return keep
    ? `asetnsamples=n=${CUT_BLOCK_SAMPLES}:p=0,aselect='${keep}',asetpts=N/SR/TB,asetnsamples=n=${DOWNSTREAM_BLOCK_SAMPLES}:p=0`
    : null
}

/**
 * The cut list as disjoint spans in time order, clipped to the start of the file: regions that overlap or
 * touch (widening a cut by dragging a new one over it is a supported gesture) are one span, so every
 * second removed is counted once.
 */
function disjointCuts(cuts: ChainSpec['cutRegions']): Array<{ startSec: number; endSec: number }> {
  const spans = cuts
    .map((c) => ({ startSec: Math.max(0, c.startSec), endSec: c.endSec }))
    .filter((c) => c.endSec > c.startSec)
    .sort((a, b) => a.startSec - b.startSec)
  const merged: Array<{ startSec: number; endSec: number }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.startSec <= last.endSec) last.endSec = Math.max(last.endSec, span.endSec)
    else merged.push({ ...span })
  }
  return merged
}

/**
 * How long the export WRITES (T-125 (6)): the source's length less the merged length of the cuts, each clipped to the file. ffmpeg's
 * `out_time` is a position in the OUTPUT, so a progress bar that divides it by the SOURCE's length jumps (a 300 s source with 200 s
 * kept read 33.3% at the middle and then 100%). Spans are merged first so an overlap is counted once, and a cut past the end removes
 * only what is there. Never below 0.1 s, so a chain that cuts everything divides by something.
 */
export function keptDurationSec(durationSec: number, cuts: ChainSpec['cutRegions']): number {
  const removed = disjointCuts(cuts)
    .map((c) => Math.max(0, Math.min(c.endSec, durationSec) - Math.min(c.startSec, durationSec)))
    .reduce((a, b) => a + b, 0)
  return Math.max(0.1, durationSec - removed)
}

/**
 * The picture-side twin of `aselect`: drop the same spans, then close each gap by the TIME it took -
 * every survivor moves earlier by the length of the removed spans that came before it
 * (`max(0, min(T, end) - start)` per span, which is the whole length once T is past the span's end).
 * T-121: this was `setpts=N/FRAME_RATE/TB`, which numbers the survivors at the stream's nominal rate.
 * A Record WebM's container rate reads 1000/1 (its clock ticks in milliseconds), so that spaced the
 * survivors 1 ms apart: 2.4 s of kept picture collapsed to 0.07 s under 2.4 s of sound. A retime by
 * timestamp needs no frame rate, keeps the survivors' own spacing, and moves each one by exactly what the
 * sound lost: at each cut, picture and sound agree to within one 256-sample block of sound (5.3 ms at 48 kHz: `aselectForCuts`
 * re-chunks the sound to 256 samples, so `aselect` keeps or drops whole blocks of THAT size - before T-124 (32) it was the
 * decoder's block, up to 96 ms), and the errors add up over several cuts (T-110(i)). It does
 * not drift with a frame rate the container may not state.
 *
 * T-123 (12): `settb=AVTB` sits between `select` and `setpts`. `setpts` writes the retimed stamp in the time
 * base of the frames it was handed, and an AVI's video stream has 1/fps, so `setpts` ITSELF rounded 3.3083 s
 * onto the 24 fps grid (3.2917 s, the frame before the cut, which is already there) before the encoder was
 * involved - `-enc_time_base:v filter` cannot keep a stamp the filter had already rounded. A microsecond base
 * (AV_TIME_BASE) hands `setpts` room for the fraction; `select` keeps the source's base, so the keep
 * expression still reads `t` in seconds exactly as the sound's does.
 */
export function vselectForCuts(cuts: ChainSpec['cutRegions']): string | null {
  const keep = keepExpression(cuts)
  if (!keep) return null
  const removed = disjointCuts(cuts)
    .map((c) => `max(0\\,min(T\\,${c.endSec.toFixed(3)})-${c.startSec.toFixed(3)})`)
    .join('+')
  // A cut wholly before the file starts drops nothing and closes nothing: `0`, never an empty `()`.
  return `select='${keep}',settb=AVTB,setpts='PTS-(${removed || '0'})/TB'`
}

/**
 * T-90: the mains frequency the hum notch targets. Strict equality, not a
 * range check: the result is interpolated into a filter string, so ONLY the
 * two literals can reach ffmpeg — a project file that says `humHz: "60;x"`, or
 * a number out of range, or nothing at all (every project saved before 50 Hz
 * existed), is 60, which is what hum removal always did.
 */
export function humFrequency(requested: unknown): MainsHz {
  return requested === 50 ? 50 : 60
}

/**
 * `dualMono` is T-123 (11): EBU R128 counts a mono file as ONE channel, but every stereo playback of
 * it sends the channel to both speakers (dual mono), which is 3 LU hotter than that measurement says -
 * a mono mic normalized to "-16" played at -13. loudnorm's `dual_mono=true` measures and corrects the
 * file the way it will be played. It has to be on BOTH passes (pass 1's `measured_I` and pass 2's gain
 * must agree on what was measured), so it is appended to the stage in either form. Multi-channel input
 * is not affected by the option, and the caller only sets it for a mono source it exports on its own.
 */
function loudnormFilter(targetLufs: number, measured?: LoudnormMeasurement, dualMono = false): string {
  // INIT-A (round 15): keep -1.5 dBTP as the safe default — Spotify/YouTube
  // recommend -1.0 dBTP but a small inter-sample peak overhead protects
  // against codec rounding on the playback side. Users delivering ONLY to
  // streaming targets can override via a future custom-target slider.
  const base = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`
  const tail = dualMono ? ':dual_mono=true' : ''
  if (!measured) return `${base}:print_format=json${tail}`
  return (
    [
      base,
      `measured_I=${measured.input_i}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_TP=${measured.input_tp}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      `linear=true`,
      `print_format=summary`
    ].join(':') + tail
  )
}

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

/** What `buildChain` writes for a chain with no stage in it: ffmpeg's own pass-through (T-123 (10): it is left untouched). */
export const EMPTY_CHAIN = 'anull'

export interface ChainBuildResult {
  filterPass1: string | null
  filterPass2: string
  needsTwoPass: boolean
}

export function buildChain(
  spec: ChainSpec,
  measurement?: LoudnormMeasurement,
  /** T-123 (11): the source is one channel and this chain's loudnorm is the last thing that touches it. */
  dualMono = false
): ChainBuildResult {
  const baseFilters: string[] = []

  const cuts = aselectForCuts(spec.cutRegions)
  if (cuts) baseFilters.push(cuts)

  if (spec.rumbleHighpass) baseFilters.push('highpass=f=80')

  if (spec.hum60) {
    // B2 fix (round 15): the previous highpass+lowpass pair did NOT touch the
    // mains-hum fundamental at all — the label was a lie and the
    // lowpass dulled voice. Mains hum is a narrow tone, so a bandreject
    // (notch) at the fundamental AND first harmonic is the correct filter.
    // width_type=h:w=2 = 2 Hz wide, which kills hum without audibly
    // hollowing nearby vocal content.
    // T-90: the fundamental is the user's grid, 60 Hz (US/Canada) or 50 Hz
    // (most of the rest of the world). A 2 Hz notch at the wrong one removes
    // nothing, which is why this is a choice and not a constant.
    const hz = humFrequency(spec.humHz)
    baseFilters.push(`bandreject=f=${hz}:width_type=h:w=2`)
    baseFilters.push(`bandreject=f=${hz * 2}:width_type=h:w=2`)
  }

  const dn = denoiseFilter(spec.denoise, spec.denoiseParams)
  if (dn) baseFilters.push(dn)

  if (spec.deEss) {
    // Round 18: use ffmpeg's dedicated dynamic de-esser instead of a
    // permanent -6 dB EQ notch at 6.5 kHz. The static cut dulled voice
    // during non-sibilant passages while letting loud esses through —
    // the same "related-sounding filter isn't the right filter" failure
    // the round-15 hum60 fix called out. deesser's i/m/f are normalized
    // 0..1: intensity 0.15 with max 0.5 tames esses without lisping.
    baseFilters.push('deesser=i=0.15:m=0.5:f=0.5')
  }

  const comp = compressorFilter(spec.compressor)
  if (comp) baseFilters.push(comp)

  if (spec.gainDb !== 0) {
    baseFilters.push(`volume=${spec.gainDb}dB`)
  }

  const filterPass2Parts = [...baseFilters]
  if (spec.loudnorm) {
    filterPass2Parts.push(loudnormFilter(spec.loudnormTargetLufs, measurement, dualMono))
  }

  let filterPass1: string | null = null
  if (spec.loudnorm) {
    filterPass1 = [...baseFilters, loudnormFilter(spec.loudnormTargetLufs, undefined, dualMono)].join(',')
  }

  return {
    filterPass1,
    filterPass2: filterPass2Parts.length > 0 ? filterPass2Parts.join(',') : EMPTY_CHAIN,
    needsTwoPass: spec.loudnorm
  }
}

/**
 * True iff the trailing filter in `filterChain` is a `loudnorm=…` segment.
 * Used by the secondary-track match-loudness path to skip a redundant
 * second loudnorm append when buildChain has already emitted one (which
 * happens whenever ChainSpec.loudnorm is enabled).
 *
 * The filter graph uses comma-separated stages — split on the last
 * comma-or-start and check the final stage's name.
 */
export function chainEndsWithLoudnorm(filterChain: string): boolean {
  if (filterChain.length === 0) return false
  const lastComma = filterChain.lastIndexOf(',')
  const lastStage = lastComma === -1 ? filterChain : filterChain.slice(lastComma + 1)
  return lastStage.startsWith('loudnorm=')
}

/** A plain decimal as loudnorm prints one ("-23.50", "0.00"); `-inf`, `inf`, `nan` are not. */
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/

/**
 * The pass-1 measurement from loudnorm's JSON block, or `null` when there is nothing pass 2
 * can use: no block, a block missing a field, or - T-114 - a field that is not a finite
 * number. A SILENT input prints `input_i: "-inf"`, `input_tp: "-inf"` and `target_offset:
 * "inf"`; handed back as `measured_I=-inf`, ffmpeg refuses the option ("out of range
 * [-99 - 0]") and the whole export fails. `null` is not an error here: `exportAudio` renders
 * pass 2 with the single-pass dynamic loudnorm when it has no measurement.
 */
export function parseLoudnormJson(stderrOutput: string): LoudnormMeasurement | null {
  const start = stderrOutput.lastIndexOf('{')
  const end = stderrOutput.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(stderrOutput.slice(start, end + 1)) as Record<string, unknown>
    const field = (key: string): string | null => {
      const v = obj[key]
      return typeof v === 'string' && PLAIN_DECIMAL.test(v) && Number.isFinite(Number(v)) ? v : null
    }
    const i = field('input_i')
    const tp = field('input_tp')
    const lra = field('input_lra')
    const thresh = field('input_thresh')
    const offset = field('target_offset')
    if (i === null || tp === null || lra === null || thresh === null || offset === null) return null
    return { input_i: i, input_tp: tp, input_lra: lra, input_thresh: thresh, target_offset: offset }
  } catch {
    return null
  }
}
