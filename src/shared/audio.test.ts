import { describe, it, expect, vi } from 'vitest'
import {
  AUDIO_FORMAT_LABELS,
  AUDIO_SAVE_FORMATS,
  DEFAULT_DUCK_PARAMS,
  DUCK_LIMITS,
  LOUDNESS_TARGET_LUFS,
  SECONDARY_GAIN_DB,
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
  WAVEFORM_ERROR_MESSAGE,
  WAVEFORM_MAX_SEC,
  waveformCeilingRefusal,
  type AudioOutputFormat
} from './audio'
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

describe('waveformCeilingRefusal (T-123 (14), T-124 (7))', () => {
  it('the ceiling is two hours', () => {
    expect(WAVEFORM_MAX_SEC).toBe(7200)
  })

  it.each(['video', 'audio'] as const)('lets a file of exactly the ceiling, and any shorter one, through (%s)', (kind) => {
    expect(waveformCeilingRefusal(WAVEFORM_MAX_SEC, kind)).toBeNull()
    expect(waveformCeilingRefusal(3600, kind)).toBeNull()
    expect(waveformCeilingRefusal(0.5, kind)).toBeNull()
  })

  it.each(['video', 'audio'] as const)('refuses a file one second over the ceiling, and a 6 hour VOD (%s)', (kind) => {
    expect(waveformCeilingRefusal(WAVEFORM_MAX_SEC + 1, kind)).not.toBeNull()
    expect(waveformCeilingRefusal(6 * 3600, kind)).not.toBeNull()
  })

  it.each(['video', 'audio'] as const)('answers null for a length the probe could not give (the load has other checks for those) (%s)', (kind) => {
    expect(waveformCeilingRefusal(NaN, kind)).toBeNull()
    expect(waveformCeilingRefusal(Infinity, kind)).toBeNull()
    expect(waveformCeilingRefusal(-1, kind)).toBeNull()
  })

  it('names the ceiling and the reason for both kinds of source', () => {
    for (const kind of ['video', 'audio'] as const) {
      const sentence = waveformCeilingRefusal(3 * 3600, kind) ?? ''
      expect(sentence, kind).toMatch(/longer than 2 hours/)
      expect(sentence, kind).toMatch(/out of memory/)
    }
  })

  // T-124 (7): the sentence sent an AUDIO-ONLY file to Video Studio, which rejects it right back ("This file has no picture,
  // only sound. Open it in Audio Studio instead."): a remedy that loops. The Video Studio remedy is for a video source only.
  it('a video source is told to export the part it wants from Video Studio', () => {
    expect(waveformCeilingRefusal(3 * 3600, 'video')).toMatch(/Export the part you want from Video Studio first, then open that shorter file\./)
  })

  it('an audio-only source is NOT sent to Video Studio, and is told what to do instead: split it in another app', () => {
    const sentence = waveformCeilingRefusal(3 * 3600, 'audio') ?? ''
    expect(sentence).not.toMatch(/Video Studio/)
    expect(sentence).toMatch(/Split it into shorter files in another app first, then open one of them\./)
    // The Video Studio importer's refusal of a sound-only file is the loop the old sentence sent the person into.
    const loop = describeImportError(new Error('No video stream found in file'), '/x/long.wav', 'video')
    expect(loop).toMatch(/Open it in Audio Studio instead/)
  })

  it('is a finished sentence that every route to the load shows as written, for both kinds', () => {
    for (const kind of ['video', 'audio'] as const) {
      const sentence = waveformCeilingRefusal(3 * 3600, kind) ?? ''
      expect(sentence.length, kind).toBeLessThanOrEqual(240)
      expect(sentence).not.toContain('\n')
      expect(sentence).toMatch(/[.!?]$/)
      // The importer's catch (describeImportError) and Clean audio's (reportFailure -> userFacingError) both stand it alone.
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      expect(userFacingError(new Error(sentence), 'Fallback.').message).toBe(sentence)
      expect(describeImportError(new Error(sentence), '/x/long.wav', 'audio')).toBe(sentence)
      // ...and across the IPC envelope too (a restored project's probe runs in main, the load's own error does not).
      expect(describeImportError(new Error(`Error invoking remote method 'x': Error: ${sentence}`), '/x/long.wav', 'audio')).toBe(sentence)
      quiet.mockRestore()
    }
  })
})

describe('WAVEFORM_ERROR_MESSAGE (T-123 (14))', () => {
  it('is a finished sentence that says what failed and what to try', () => {
    expect(WAVEFORM_ERROR_MESSAGE).toMatch(/^Couldn't draw this file's waveform\./)
    expect(WAVEFORM_ERROR_MESSAGE).toMatch(/Re-export it as WAV or MP3 and try again\.$/)
    expect(WAVEFORM_ERROR_MESSAGE.length).toBeLessThanOrEqual(240)
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
