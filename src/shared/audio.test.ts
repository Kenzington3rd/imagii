import { describe, it, expect, vi } from 'vitest'
import {
  AUDIO_FORMAT_LABELS,
  AUDIO_SAVE_FORMATS,
  DEFAULT_DUCK_PARAMS,
  DUCK_LIMITS,
  EVERYTHING_CUT_MESSAGE,
  LOUDNESS_TARGET_LUFS,
  SECONDARY_GAIN_DB,
  SECOND_TRACK_NO_SOUND_MESSAGE,
  audioFileExtension,
  audioPassLabel,
  audioPassPlan,
  isLoudnessTarget,
  isNoAudioStreamError,
  NO_AUDIO_STREAM_MESSAGE,
  NO_USABLE_DURATION_MESSAGE,
  NoUsableDurationError,
  commitLoudnessTarget,
  secondaryTrackProblem,
  PEAK_BUCKETS,
  PLAYBACK_ERROR_MESSAGE,
  WAVEFORM_READ_FAILED,
  isWaveformPeaks,
  peaksMaxMagnitude,
  type AudioOutputFormat
} from './audio'
import * as audioModule from './audio'
import { userFacingError } from './userFacingError'
import { describeImportError } from './importDiagnostics'

const EXPORT_FORMATS: AudioOutputFormat[] = ['mp3', 'wav', 'flac', 'aac']

describe('audioFileExtension (T-90)', () => {
  it('saves AAC as .m4a — a bare .aac is a raw stream most players refuse', () => {
    expect(audioFileExtension('aac')).toBe('m4a')
  })

  it('leaves every other format under its own name', () => {
    for (const f of ['mp3', 'wav', 'flac', 'mp4'] as const) expect(audioFileExtension(f)).toBe(f)
  })

  it('has a save format for every export format, plus the re-attach mp4', () => {
    for (const f of EXPORT_FORMATS) expect(AUDIO_SAVE_FORMATS).toContain(f)
    expect(AUDIO_SAVE_FORMATS).toContain('mp4')
    expect(AUDIO_SAVE_FORMATS).toHaveLength(EXPORT_FORMATS.length + 1)
  })
})

describe('the Export panel\'s names', () => {
  it('labels every format, and AAC says what the file will be called', () => {
    for (const f of EXPORT_FORMATS) expect(AUDIO_FORMAT_LABELS[f].length).toBeGreaterThan(0)
    expect(AUDIO_FORMAT_LABELS.aac).toBe('AAC (.m4a)')
    expect(AUDIO_FORMAT_LABELS.mp3).toBe('MP3')
  })

  it('names each phase in plain words, never the pass id', () => {
    for (const plan of [
      audioPassPlan({ loudnorm: false, reattach: false }),
      audioPassPlan({ loudnorm: true, reattach: false }),
      audioPassPlan({ loudnorm: false, reattach: true }),
      audioPassPlan({ loudnorm: true, reattach: true })
    ]) {
      for (const pass of plan) {
        expect(audioPassLabel(pass, plan)).not.toMatch(/\b(measure|render|mux)\b/)
      }
    }
  })
})

describe('audioPassPlan — the passes an export will make, in order (T-100)', () => {
  it('a plain export is one pass', () => {
    expect(audioPassPlan({ loudnorm: false, reattach: false })).toEqual(['render'])
  })

  it('loudness measures first, then renders', () => {
    expect(audioPassPlan({ loudnorm: true, reattach: false })).toEqual(['measure', 'render'])
  })

  it('re-attaching renders, then puts the sound on the picture', () => {
    expect(audioPassPlan({ loudnorm: false, reattach: true })).toEqual(['render', 'mux'])
  })

  it('both is three passes', () => {
    expect(audioPassPlan({ loudnorm: true, reattach: true })).toEqual(['measure', 'render', 'mux'])
  })
})

describe('audioPassLabel — a bar that restarts at 0 reads as the next step, not a stall (T-100)', () => {
  it('the two loudness passes are Step 1 of 2 and Step 2 of 2', () => {
    const plan = audioPassPlan({ loudnorm: true, reattach: false })
    expect(audioPassLabel('measure', plan)).toBe('Step 1 of 2 — measuring loudness')
    expect(audioPassLabel('render', plan)).toBe('Step 2 of 2 — rendering')
  })

  it('a re-attach counts its own steps', () => {
    const plan = audioPassPlan({ loudnorm: false, reattach: true })
    expect(audioPassLabel('render', plan)).toBe('Step 1 of 2 — rendering')
    expect(audioPassLabel('mux', plan)).toBe('Step 2 of 2 — attaching to video')
    const all = audioPassPlan({ loudnorm: true, reattach: true })
    expect(audioPassLabel('mux', all)).toBe('Step 3 of 3 — attaching to video')
  })

  it('a single pass has no steps to count and says what it is doing', () => {
    expect(audioPassLabel('render', audioPassPlan({ loudnorm: false, reattach: false }))).toBe(
      'Rendering…'
    )
  })

  it('a pass the plan does not contain still reads as a plain phase, never a step 0', () => {
    expect(audioPassLabel('mux', ['render'])).toBe('Attaching to video…')
  })
})

describe('isLoudnessTarget — loudnorm\'s own range, -70 to -5 (T-111)', () => {
  it('accepts the edges, the presets and what lies between', () => {
    for (const v of [-70, -23, -16, -14, -9, -5, -5.0, -69.9]) expect(isLoudnessTarget(v), String(v)).toBe(true)
  })

  it('refuses what loudnorm refuses, including the -3 the old 0 ceiling let through', () => {
    for (const v of [-3, -4.99, 0, 6, -70.01, -100]) expect(isLoudnessTarget(v), String(v)).toBe(false)
  })

  it('refuses a value that is not a finite number', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, '-16', null, undefined, {}, [-16]]) {
      expect(isLoudnessTarget(v), String(v)).toBe(false)
    }
  })

  it('every platform the Levels panel offers is inside it', () => {
    expect(LOUDNESS_TARGET_LUFS).toEqual({ min: -70, max: -5 })
    for (const target of [-16, -14, -23]) expect(isLoudnessTarget(target)).toBe(true)
  })
})

/**
 * T-112 — the loudness box stops a bad number AT THE INPUT.
 *
 * Round 61 made the gate refuse -3 in a sentence, after the Export click. The box itself
 * took any number. `min`/`max` on a number input only style it invalid — the browser
 * still hands the typed value over — so the box commits through this: a number inside
 * loudnorm's range is itself, one outside is the nearest edge (someone who typed -3 wants
 * "as loud as it goes", which is -5), and what is not a number changes nothing. It runs
 * when typing ENDS (blur or Enter), because the way to -23 passes through -2.
 */
describe('commitLoudnessTarget — what a typed target becomes (T-112)', () => {
  it('a number inside the range is itself, decimals and all', () => {
    expect(commitLoudnessTarget('-16', -14)).toBe(-16)
    expect(commitLoudnessTarget('-23.5', -14)).toBe(-23.5)
    expect(commitLoudnessTarget('-70', -14)).toBe(-70)
    expect(commitLoudnessTarget('-5', -14)).toBe(-5)
  })

  it('the -3 the old 0 ceiling let through is stopped at -5', () => {
    expect(commitLoudnessTarget('-3', -16)).toBe(-5)
    expect(commitLoudnessTarget('0', -16)).toBe(-5)
    expect(commitLoudnessTarget('12', -16)).toBe(-5)
  })

  it('below the floor is the floor', () => {
    expect(commitLoudnessTarget('-80', -16)).toBe(-70)
    expect(commitLoudnessTarget('-1000', -16)).toBe(-70)
  })

  it('what is not a number changes nothing: the current target stays', () => {
    for (const typed of ['', '  ', '-', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999']) {
      expect(commitLoudnessTarget(typed, -14), JSON.stringify(typed)).toBe(-14)
    }
  })

  it('every result is a target the gate accepts', () => {
    for (const typed of ['-3', '-16', '-80', '', 'x', '-5', '-70', '99']) {
      expect(isLoudnessTarget(commitLoudnessTarget(typed, -16)), JSON.stringify(typed)).toBe(true)
    }
  })
})

describe('secondaryTrackProblem — the numbers of a second track that reach the filter graph (T-111)', () => {
  const ok = { filePath: '/x.wav', gainDb: -6, duckUnderPrimary: true }

  it('accepts a track with no ducking numbers, with defaults, and with every limit', () => {
    expect(secondaryTrackProblem(ok)).toBeNull()
    expect(secondaryTrackProblem({ ...ok, duckParams: null })).toBeNull()
    expect(secondaryTrackProblem({ ...ok, duckParams: { ...DEFAULT_DUCK_PARAMS } })).toBeNull()
    for (const edge of ['min', 'max'] as const) {
      expect(
        secondaryTrackProblem({
          ...ok,
          gainDb: SECONDARY_GAIN_DB[edge],
          duckParams: {
            thresholdDb: DUCK_LIMITS.thresholdDb[edge],
            ratio: DUCK_LIMITS.ratio[edge],
            attackMs: DUCK_LIMITS.attackMs[edge],
            releaseMs: DUCK_LIMITS.releaseMs[edge]
          }
        }),
        edge
      ).toBeNull()
    }
  })

  it('holds the panel\'s own slider ends inside the limits, so a real project is never refused', () => {
    // SecondaryTrackPanel: gain -24..12; threshold -60..0, ratio 1..20, attack 1..200, release 50..2000.
    expect(secondaryTrackProblem({ ...ok, gainDb: -24 })).toBeNull()
    expect(secondaryTrackProblem({ ...ok, gainDb: 12 })).toBeNull()
    expect(DUCK_LIMITS).toEqual({
      thresholdDb: { min: -60, max: 0 },
      ratio: { min: 1, max: 20 },
      attackMs: { min: 1, max: 200 },
      releaseMs: { min: 50, max: 2000 }
    })
  })

  it('names the first field that is not a number in its range', () => {
    expect(secondaryTrackProblem({ ...ok, gainDb: '0dB,ametadata=mode=print:file=x' })).toMatch(/gainDb/)
    expect(secondaryTrackProblem({ ...ok, gainDb: 12.5 })).toMatch(/gainDb/)
    expect(secondaryTrackProblem({ ...ok, gainDb: undefined })).toMatch(/gainDb/)
    expect(secondaryTrackProblem({ ...ok, duckParams: { ...DEFAULT_DUCK_PARAMS, ratio: 21 } })).toMatch(/duckParams\.ratio/)
    expect(secondaryTrackProblem({ ...ok, duckParams: { ...DEFAULT_DUCK_PARAMS, attackMs: '20' } })).toMatch(/duckParams\.attackMs/)
    expect(secondaryTrackProblem({ ...ok, duckParams: { ...DEFAULT_DUCK_PARAMS, releaseMs: Number.NaN } })).toMatch(/duckParams\.releaseMs/)
    expect(secondaryTrackProblem({ ...ok, duckParams: { ...DEFAULT_DUCK_PARAMS, thresholdDb: 1 } })).toMatch(/duckParams\.thresholdDb/)
    expect(secondaryTrackProblem({ ...ok, duckParams: [1, 2, 3, 4] })).toMatch(/duckParams/)
    expect(secondaryTrackProblem({ ...ok, duckParams: 'strong' })).toMatch(/duckParams/)
  })
})

// T-129: the 2-hour ceiling T-123 (14) put on Audio Studio (because the waveform was decoded in the renderer) is RETIRED with the
// decode: the waveform is drawn from main's streamed peaks. These pins were the ceiling's; they now pin that it is gone.
describe('the waveform has no length ceiling any more (T-129, retiring T-123 (14) / T-124 (7))', () => {
  it('the ceiling and its kind-aware refusal are gone from the shared module', () => {
    expect(Object.keys(audioModule)).not.toContain('WAVEFORM_MAX_SEC')
    expect(Object.keys(audioModule)).not.toContain('waveformCeilingRefusal')
    // ...and the playback sentence replaced the old "couldn't draw" one (the drawing is main's now).
    expect(Object.keys(audioModule)).not.toContain('WAVEFORM_ERROR_MESSAGE')
  })
})

describe('isWaveformPeaks: what the waveform is drawn from, checked where it lands (T-129)', () => {
  const answer = (n: number, duration = 60): { peaks: [number[], number[]]; duration: number } => ({
    peaks: [Array.from({ length: n }, () => 0.5), Array.from({ length: n }, () => -0.5)],
    duration
  })

  it('takes two equally long arrays of 1 to PEAK_BUCKETS numbers in -1..1 over a positive length', () => {
    expect(PEAK_BUCKETS).toBe(4000)
    expect(isWaveformPeaks(answer(PEAK_BUCKETS))).toBe(true)
    expect(isWaveformPeaks(answer(1, 0.0001))).toBe(true)
    expect(isWaveformPeaks({ peaks: [[1, -1], [-1, 1]], duration: 9 * 3600 })).toBe(true)
  })

  it('refuses an answer bigger than the bound (the payload is size-bounded) or empty (wavesurfer throws on it)', () => {
    expect(isWaveformPeaks(answer(PEAK_BUCKETS + 1))).toBe(false)
    expect(isWaveformPeaks(answer(0))).toBe(false)
  })

  it('refuses a length that is not a positive number', () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(isWaveformPeaks(answer(10, duration)), String(duration)).toBe(false)
    expect(isWaveformPeaks({ peaks: answer(10).peaks, duration: '60' })).toBe(false)
    expect(isWaveformPeaks({ peaks: answer(10).peaks })).toBe(false)
  })

  it('refuses arrays of different lengths, the wrong number of arrays, and values that are not samples', () => {
    const [high, low] = answer(10).peaks
    expect(isWaveformPeaks({ peaks: [high, low.slice(1)], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [high], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [high, low, low], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [[...high.slice(1), 1.5], low], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [high, [...low.slice(1), -1.01]], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [[...high.slice(1), Number.NaN], low], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: [[...high.slice(1), '0.5'], low], duration: 1 })).toBe(false)
    expect(isWaveformPeaks({ peaks: 'peaks', duration: 1 })).toBe(false)
    expect(isWaveformPeaks(null)).toBe(false)
    expect(isWaveformPeaks(undefined)).toBe(false)
  })
})

describe('WAVEFORM_READ_FAILED: the refusal that remains, for a file main cannot read (T-129)', () => {
  it('is a finished sentence that says what failed and what to try', () => {
    expect(WAVEFORM_READ_FAILED).toMatch(/^imagii couldn't read the sound in this file to draw its waveform\./)
    expect(WAVEFORM_READ_FAILED).toMatch(/Re-export it as a standard PCM WAV or MP3 and try again\.$/)
    expect(WAVEFORM_READ_FAILED.length).toBeLessThanOrEqual(240)
    expect(WAVEFORM_READ_FAILED).not.toContain('\n')
  })

  // T-133 (10): T-132 (10) took "Re-export it as WAV or MP3" out of the playback sentence because the file that fails there already IS a WAV,
  // and left the same advice here - where the documented trigger (an ADPCM-style WAV whose format no decoder reads) is a WAV too.
  it('does not send a WAV back to WAV: it names the kind that reads, as the playback sentence does (T-133 (10))', () => {
    expect(WAVEFORM_READ_FAILED).not.toMatch(/as WAV or MP3/)
    expect(WAVEFORM_READ_FAILED).toMatch(/standard PCM WAV or MP3/)
  })

  it('reaches the person as written, across the IPC envelope, through both the importer\'s words and the generic ones', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const wrapped = new Error(`Error invoking remote method 'audio:peaks': Error: ${WAVEFORM_READ_FAILED}`)
      expect(userFacingError(wrapped, "Couldn't draw the waveform.").message).toBe(WAVEFORM_READ_FAILED)
      // The importer's own classifier must not mistake it for one of its known shapes ("codec", "decoder", "can't find").
      expect(describeImportError(wrapped, '/x/odd.wav', 'audio')).toBe(WAVEFORM_READ_FAILED)
    } finally {
      quiet.mockRestore()
    }
  })
})

describe('the two export refusals that need no encoder (T-135 (11), (12))', () => {
  it('say which file / what happened, in a sentence main can throw as written', () => {
    expect(SECOND_TRACK_NO_SOUND_MESSAGE).toBe('The second track has no sound in it. Remove it or pick another file.')
    expect(EVERYTHING_CUT_MESSAGE).toBe('Everything is cut out. Click a mark to put a part back.')
  })

  it.each([
    ['SECOND_TRACK_NO_SOUND_MESSAGE', SECOND_TRACK_NO_SOUND_MESSAGE],
    ['EVERYTHING_CUT_MESSAGE', EVERYTHING_CUT_MESSAGE]
  ])('%s is a finished sentence that userFacingError lets stand (no channel name, no path, nothing a known-cause pattern rewrites)', (_name, sentence) => {
    expect(sentence.endsWith('.')).toBe(true)
    expect(sentence.length).toBeLessThanOrEqual(240)
    expect(sentence).not.toContain('\n')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // Through Electron's envelope, as a renderer receives it.
      const wrapped = new Error(`Error invoking remote method 'audio:export': Error: ${sentence}`)
      expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: sentence })
      expect(userFacingError(new Error(sentence), 'Export failed.').message).toBe(sentence)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('the second-track sentence is not the no-sound verdict the importer words (that one is about the primary file)', () => {
    expect(SECOND_TRACK_NO_SOUND_MESSAGE).not.toBe(NO_AUDIO_STREAM_MESSAGE)
    expect(isNoAudioStreamError(new Error(SECOND_TRACK_NO_SOUND_MESSAGE))).toBe(false)
  })
})

describe('PLAYBACK_ERROR_MESSAGE (T-123 (14), reworded by T-129 and T-132 (10))', () => {
  it('names what fails now - playing the file, not drawing it - what still works, and what to try', () => {
    expect(PLAYBACK_ERROR_MESSAGE).toMatch(/^imagii can't play this file here/)
    // T-132 (10): the waveform IS drawn (main reads the file), so the sentence says what is still usable instead of leaving the person to
    // wonder whether the file is lost; it is said without the word "waveform" as the FAILURE.
    expect(PLAYBACK_ERROR_MESSAGE).toMatch(/waveform, cuts and export still work/)
    expect(PLAYBACK_ERROR_MESSAGE.length).toBeLessThanOrEqual(240)
  })

  it('does not send a WAV back to WAV: the advice for the file that fails here (an ADPCM WAV) is a STANDARD PCM WAV', () => {
    // "Re-export it as WAV or MP3" was circular for the one file this fires on in practice - it already is a WAV.
    expect(PLAYBACK_ERROR_MESSAGE).not.toMatch(/as WAV or MP3/)
    expect(PLAYBACK_ERROR_MESSAGE).toMatch(/standard PCM WAV or MP3/)
    expect(PLAYBACK_ERROR_MESSAGE).not.toContain('\n')
  })
})

describe('peaksMaxMagnitude - the loudest sample of a waveform, in either half (T-132 (5))', () => {
  // wavesurfer's `normalize` scales the whole waveform by 1 / the largest magnitude it finds - in channel 0 (the highs) only. A take whose
  // lows are louder than its highs (a mic with a DC offset, an asymmetric voice) drew its bottom half past the canvas edge.
  it('is the larger of the loudest high and the deepest low', () => {
    expect(peaksMaxMagnitude([[0.2, 0.1, 0.05], [-0.8, -0.1, 0]])).toBe(0.8)
    expect(peaksMaxMagnitude([[0.9, 0.1], [-0.3, -0.2]])).toBe(0.9)
    expect(peaksMaxMagnitude([[0.5], [-0.5]])).toBe(0.5)
  })

  it('reads the whole of both arrays, not the first element or only the highs', () => {
    const high = Array.from({ length: PEAK_BUCKETS }, () => 0.1)
    const low = Array.from({ length: PEAK_BUCKETS }, () => -0.1)
    low[PEAK_BUCKETS - 1] = -0.95
    expect(peaksMaxMagnitude([high, low])).toBe(0.95)
    high[1234] = 0.97
    expect(peaksMaxMagnitude([high, low])).toBe(0.97)
  })

  it('is 0 for silence and for nothing at all (wavesurfer then falls back to its own scale)', () => {
    expect(peaksMaxMagnitude([[0, 0, 0], [0, 0, 0]])).toBe(0)
    expect(peaksMaxMagnitude([[], []])).toBe(0)
  })
})

describe('isNoAudioStreamError - the one probe outcome that is a verdict about the file (T-125 (4))', () => {
  it('is the probe\'s own message, which the importer\'s diagnostics match by text', () => {
    expect(NO_AUDIO_STREAM_MESSAGE).toBe('No audio stream found in file')
    expect(isNoAudioStreamError(new Error('No audio stream found in file'))).toBe(true)
    expect(describeImportError(new Error(NO_AUDIO_STREAM_MESSAGE), null, 'audio')).toBe(
      "This file has no sound, so there's nothing to clean. Pick a file with audio."
    )
  })

  it('is false for every other way a probe fails, so the extraction is still tried', () => {
    for (const message of [
      'ffprobe returned no usable duration for the audio stream',
      'ffprobe exit 1: Invalid data found when processing input',
      'Unexpected token < in JSON at position 0',
      'No audio stream found in file, and more' // not the verdict: a longer message is some other failure
    ]) {
      expect(isNoAudioStreamError(new Error(message)), message).toBe(false)
    }
    expect(isNoAudioStreamError('No audio stream found in file'), 'a string is not an Error').toBe(false)
    expect(isNoAudioStreamError(undefined)).toBe(false)
  })

  it('answers through the IPC envelope too, so the renderer can ask it of a probe main threw (T-135 (11))', () => {
    expect(isNoAudioStreamError(new Error("Error invoking remote method 'audio:probe': Error: No audio stream found in file"))).toBe(true)
    expect(isNoAudioStreamError(new Error("Error invoking remote method 'audio:probe': Error: ffprobe exit 1: Invalid data found when processing input"))).toBe(false)
    expect(isNoAudioStreamError(new Error("Error invoking remote method 'audio:probe': Error: ffprobe returned no usable duration for the audio stream"))).toBe(false)
    expect(isNoAudioStreamError(new Error("Error invoking remote method 'audio:probe': Error: No audio stream found in file, and more"))).toBe(false)
  })
})

describe('NoUsableDurationError - a probe that read the streams and found no length (T-127 (10))', () => {
  it('is still the plain "no usable duration" refusal to everything that only reads its message, and not the no-sound verdict', () => {
    const err = new NoUsableDurationError(false)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('ffprobe returned no usable duration for the audio stream')
    expect(err.message).toBe(NO_USABLE_DURATION_MESSAGE)
    expect(isNoAudioStreamError(err), 'extraction is still tried for it').toBe(false)
    // The importer's diagnostics match the text ("no usable duration"): a typed one reads as the same failure it always was.
    expect(describeImportError(err, null, 'audio')).toBe(describeImportError(new Error(NO_USABLE_DURATION_MESSAGE), null, 'audio'))
  })

  it.each([true, false])('holds the streams\' answer (%s) it was made with, and nothing else decides it', (hasVideo) => {
    const err = new NoUsableDurationError(hasVideo)
    expect(err.hasVideo).toBe(hasVideo)
    expect(err.name).toBe('NoUsableDurationError')
    expect(new Error(NO_USABLE_DURATION_MESSAGE) instanceof NoUsableDurationError, 'a plain Error with the same text carries no answer').toBe(false)
  })
})
