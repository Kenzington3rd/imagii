import { describe, it, expect } from 'vitest'
import {
  MAX_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  KNOWN_ROUTES,
  hasStudioState,
  isSafeToAutosave,
  isValidTextOverlay,
  sanitizePlace,
  validateProject,
  validateProjectJsonString
} from './projectValidation'
import { DEFAULT_CHAIN_SPEC } from './audio'
import type { ImagiiProject } from './workspace'

const baseProject: ImagiiProject = {
  schemaVersion: MAX_SCHEMA_VERSION,
  savedAt: Date.now(),
  appVersion: '1.0.0'
}

/**
 * T-119 (12): a clip and a chain the way the app writes them. `validateProject` asks a studio for the
 * fields the app reads without a guard, so a fixture that stands for "a good clip" or "a good chain" is the
 * whole shape, with the optional ones left off exactly as an older build left them off.
 */
const goodClip = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1',
  name: 'Clip 1',
  startSec: 0,
  endSec: 5,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube'],
  ...extra
})
const goodChain = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...DEFAULT_CHAIN_SPEC,
  ...extra
})

const projectWithStudios: ImagiiProject = {
  ...baseProject,
  videoStudio: {
    sourcePath: 'C:/path/to/video.mp4',
    clips: [],
    selectedClipId: null,
    watermark: null
  }
}

describe('validateProject', () => {
  it('accepts a minimal valid project', () => {
    const result = validateProject(baseProject)
    expect(result.ok).toBe(true)
  })

  it('accepts a project with studios populated', () => {
    const result = validateProject(projectWithStudios)
    expect(result.ok).toBe(true)
  })

  it('rejects null', () => {
    expect(validateProject(null).ok).toBe(false)
  })

  it('rejects an array', () => {
    expect(validateProject([]).ok).toBe(false)
  })

  it('rejects mismatched schema version', () => {
    const result = validateProject({ ...baseProject, schemaVersion: 99 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schemaVersion/)
  })

  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _v, ...rest } = baseProject as unknown as Record<string, unknown>
    void _v
    const result = validateProject(rest)
    expect(result.ok).toBe(false)
  })

  it('rejects missing savedAt', () => {
    const { savedAt: _t, ...rest } = baseProject as unknown as Record<string, unknown>
    void _t
    const result = validateProject(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/savedAt/)
  })

  it('rejects negative savedAt', () => {
    const result = validateProject({ ...baseProject, savedAt: -1 })
    expect(result.ok).toBe(false)
  })

  it('rejects missing appVersion', () => {
    const { appVersion: _v, ...rest } = baseProject as unknown as Record<string, unknown>
    void _v
    const result = validateProject(rest)
    expect(result.ok).toBe(false)
  })

  it('rejects malformed videoStudio', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: { sourcePath: 'C:/audio.wav', clips: 'not an array' }
    })
    expect(result.ok).toBe(false)
  })

  it('rejects malformed audioStudio chain', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'C:/audio.wav', chain: 'not an object' }
    })
    expect(result.ok).toBe(false)
  })
})

describe('schema migration v1 → v2 → v3 → v4', () => {
  it('accepts a v1 project and migrates it up to MAX_SCHEMA_VERSION in place', () => {
    const v1 = {
      schemaVersion: 1,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: 'C:/some/file.mp4',
        clips: [],
        selectedClipId: null
      }
    }
    const result = validateProject(v1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(MAX_SCHEMA_VERSION)
      expect(result.project.videoStudio?.sourcePath).toBe('C:/some/file.mp4')
      // T-47: a pre-place snapshot restores exactly as it always did.
      expect(result.project.place).toBeUndefined()
    }
  })

  it('accepts a v2 project with srtPath populated', () => {
    const v2: ImagiiProject = {
      schemaVersion: 2,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: 'C:/x.mp4',
        clips: [],
        selectedClipId: null,
        srtPath: 'C:/x.srt'
      }
    }
    const result = validateProject(v2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.videoStudio?.srtPath).toBe('C:/x.srt')
  })

  it('rejects a project with non-string srtPath', () => {
    const bad = {
      schemaVersion: 2,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: 'C:/x.mp4',
        clips: [],
        selectedClipId: null,
        srtPath: 42
      }
    }
    const result = validateProject(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/srtPath/)
  })

  it('rejects schemaVersion 99 (out of supported range)', () => {
    const result = validateProject({
      schemaVersion: 99,
      savedAt: Date.now(),
      appVersion: '1.0.0'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/supported/)
  })
})

describe('schema 4 — the sound of a video is stored as the video (T-99)', () => {
  const chain = {
    denoise: 'off',
    hum60: false,
    rumbleHighpass: false,
    deEss: false,
    compressor: 'off',
    loudnorm: false,
    loudnormTargetLufs: -16,
    gainDb: 0,
    cutRegions: [],
    secondaryTrack: null
  }
  const withAudio = (audioStudio: Record<string, unknown>, schemaVersion = 4): unknown => ({
    schemaVersion,
    savedAt: Date.now(),
    appVersion: '1.0.0',
    audioStudio
  })

  it('schema 4 is still read (T-107 moved the schema new saves emit up to 5)', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(4)
    expect(MAX_SCHEMA_VERSION).toBeGreaterThanOrEqual(4)
  })

  it('accepts the marker, with the VIDEO as the source', () => {
    const result = validateProject(
      withAudio({ sourcePath: 'C:/Videos/stream.mp4', extractedFromVideo: true, chain })
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.audioStudio?.sourcePath).toBe('C:/Videos/stream.mp4')
      expect(result.project.audioStudio?.extractedFromVideo).toBe(true)
    }
  })

  it('accepts a v4 plain audio file with no marker', () => {
    expect(validateProject(withAudio({ sourcePath: 'C:/Audio/mic.wav', chain })).ok).toBe(true)
  })

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null]
  ])('refuses a marker that is %s', (_name, value) => {
    const result = validateProject(
      withAudio({ sourcePath: 'C:/Videos/stream.mp4', extractedFromVideo: value, chain })
    )
    expect(result).toEqual({ ok: false, reason: 'audioStudio.extractedFromVideo not a boolean' })
  })

  it('holds the video of an extraction to the same path gate as every other path', () => {
    const result = validateProject(
      withAudio({ sourcePath: '../../etc/passwd', extractedFromVideo: true, chain })
    )
    expect(result).toEqual({ ok: false, reason: 'audioStudio.sourcePath unsafe or malformed' })
  })

  it('a v3 project is accepted and migrated up with its audio left exactly as written', () => {
    // The shape every extraction was saved in until now: the (temp) WAV as the
    // source, the video beside it.
    const result = validateProject(
      withAudio(
        { sourcePath: 'C:/Temp/imagii-audio/aB3dE5fG7h.wav', fromVideoPath: 'C:/Videos/stream.mp4', chain },
        3
      )
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(MAX_SCHEMA_VERSION)
      expect(result.project.audioStudio).toEqual({
        sourcePath: 'C:/Temp/imagii-audio/aB3dE5fG7h.wav',
        fromVideoPath: 'C:/Videos/stream.mp4',
        chain
      })
      // Migrating must not invent the marker: that would re-extract a sound
      // whose scratch file may still be there.
      expect(result.project.audioStudio?.extractedFromVideo).toBeUndefined()
    }
  })

  it('refuses an unsafe fromVideoPath in a v3 file — it reaches ffmpeg on export', () => {
    const result = validateProject(
      withAudio({ sourcePath: 'C:/Audio/mic.wav', fromVideoPath: '..\\..\\secret.mp4', chain }, 3)
    )
    expect(result).toEqual({ ok: false, reason: 'audioStudio.fromVideoPath unsafe or malformed' })
  })

  it('accepts a null fromVideoPath (what a v3 plain audio file wrote)', () => {
    expect(
      validateProject(withAudio({ sourcePath: 'C:/Audio/mic.wav', fromVideoPath: null, chain }, 3)).ok
    ).toBe(true)
  })
})

/**
 * T-107 — schema 5: `videoStudio.convertedForImport` says `sourcePath` is the
 * ORIGINAL of a file the importer converted, so the working copy under the temp
 * folder never lands in a project. T-99's shape, one studio over.
 */
describe('schema 5: a converted import is stored as its original (T-107)', () => {
  const withVideo = (videoStudio: Record<string, unknown>, schemaVersion = 5): unknown => ({
    schemaVersion,
    savedAt: Date.now(),
    appVersion: '1.0.0',
    videoStudio
  })
  const studio = { clips: [], selectedClipId: null }

  it('this is the schema new saves emit, and every older one is still read', () => {
    expect(MAX_SCHEMA_VERSION).toBe(5)
    expect([...SUPPORTED_SCHEMA_VERSIONS]).toEqual([1, 2, 3, 4, 5])
  })

  it('accepts the marker, with the ORIGINAL as the source', () => {
    const result = validateProject(
      withVideo({ sourcePath: 'C:/Videos/stream.flv', convertedForImport: true, ...studio })
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.videoStudio?.sourcePath).toBe('C:/Videos/stream.flv')
      expect(result.project.videoStudio?.convertedForImport).toBe(true)
    }
  })

  it('accepts a v5 natively playable video with no marker', () => {
    expect(validateProject(withVideo({ sourcePath: 'C:/Videos/stream.mp4', ...studio })).ok).toBe(true)
  })

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null]
  ])('refuses a marker that is %s', (_name, value) => {
    const result = validateProject(
      withVideo({ sourcePath: 'C:/Videos/stream.flv', convertedForImport: value, ...studio })
    )
    expect(result).toEqual({ ok: false, reason: 'videoStudio.convertedForImport not a boolean' })
  })

  it('holds the original to the same path gate as every other path (it reaches ffmpeg on open)', () => {
    const result = validateProject(
      withVideo({ sourcePath: '../../etc/passwd', convertedForImport: true, ...studio })
    )
    expect(result).toEqual({ ok: false, reason: 'videoStudio.sourcePath unsafe or malformed' })
  })

  it('a v4 project is accepted and migrated up with its video left exactly as written', () => {
    // The shape every converted import was saved in until now: the (temp) working
    // copy as the source, nothing about the original.
    const result = validateProject(
      withVideo(
        { sourcePath: 'C:/Temp/imagii-import/stream-aB3dE5fG.mp4', ...studio, srtPath: null },
        4
      )
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(5)
      expect(result.project.videoStudio).toEqual({
        sourcePath: 'C:/Temp/imagii-import/stream-aB3dE5fG.mp4',
        ...studio,
        srtPath: null
      })
      // Migrating must not invent the marker: nothing in the file says what the
      // original was, and a working copy that is still there should just open.
      expect(result.project.videoStudio?.convertedForImport).toBeUndefined()
    }
  })

  it.each([1, 2, 3])('a v%i project is migrated all the way up to 5', (version) => {
    const result = validateProject({
      schemaVersion: version,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: { sourcePath: 'C:/Videos/stream.mp4', ...studio }
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.schemaVersion).toBe(5)
  })
})

describe('path-safety integration (bug round 4)', () => {
  // The threat model: a malicious .imagii.json carries a sourcePath or
  // srtPath that escapes the user's media directory via `..` traversal
  // or targets a Windows reserved device name. validator must reject.

  it('rejects videoStudio.sourcePath with .. traversal', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/Users/maken/../../../etc/passwd',
        clips: [],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/sourcePath/)
  })

  it('rejects videoStudio.srtPath with .. traversal', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [],
        selectedClipId: null,
        srtPath: '/var/log/../../etc/passwd'
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/srtPath/)
  })

  it('rejects relative path in audioStudio.sourcePath', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'audio.wav', chain: {} }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/sourcePath/)
  })

  it('rejects Windows reserved device names in path fields', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/Users/maken/con.mp4',
        clips: [],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(false)
  })

  it('accepts null/undefined srtPath (back-compat for v1 projects)', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [],
        selectedClipId: null,
        srtPath: null
      }
    })
    expect(result.ok).toBe(true)
  })

  // chain.secondaryTrack.filePath reaches `ffmpeg -i` during audio export.
  // A malicious project pointing it at an SSH key would mix an arbitrary
  // file into the output — validator must reject traversal / unsafe paths.
  it('rejects audioStudio.chain.secondaryTrack.filePath with .. traversal', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: {
        sourcePath: 'C:/safe.wav',
        chain: {
          secondaryTrack: {
            filePath: 'C:/Users/maken/../../../Users/maken/.ssh/id_rsa',
            fileName: 'id_rsa',
            role: 'music',
            gainDb: 0,
            duckUnderPrimary: false
          }
        }
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/secondaryTrack/)
  })

  it('rejects audioStudio.chain.secondaryTrack with a non-object value', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: {
        sourcePath: 'C:/safe.wav',
        chain: { secondaryTrack: 'not an object' }
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/secondaryTrack/)
  })

  // T-111: gainDb and the ducking numbers are printed into the filter graph on
  // export. A project file is a file a person can edit, so it is refused at open.
  describe('the second track\'s numbers (T-111)', () => {
    const withTrack = (fields: Record<string, unknown>): unknown => ({
      ...baseProject,
      audioStudio: {
        sourcePath: 'C:/safe.wav',
        chain: goodChain({
          secondaryTrack: {
            filePath: 'C:/Users/maken/Music/bed.mp3',
            fileName: 'bed.mp3',
            role: 'music',
            gainDb: -6,
            duckUnderPrimary: true,
            ...fields
          }
        })
      }
    })
    const duck = { thresholdDb: -26, ratio: 8, attackMs: 20, releaseMs: 400 }

    it.each([
      ['a filter-syntax string for the gain', { gainDb: '0dB,ametadata=mode=print:file=x' }, /chain\.secondaryTrack\.gainDb/],
      ['a gain past +12 dB', { gainDb: 40 }, /gainDb/],
      ['NaN for the gain', { gainDb: Number.NaN }, /gainDb/],
      ['a ratio that is a string', { duckParams: { ...duck, ratio: '8:x' } }, /duckParams\.ratio/],
      ['a release past 2000 ms', { duckParams: { ...duck, releaseMs: 90000 } }, /duckParams\.releaseMs/],
      ['an attack of 0', { duckParams: { ...duck, attackMs: 0 } }, /duckParams\.attackMs/]
    ])('rejects %s', (_label, fields, reason) => {
      const result = validateProject(withTrack(fields))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(reason)
    })

    it('accepts the slider ends and the defaults', () => {
      for (const fields of [
        { gainDb: -24 },
        { gainDb: 12 },
        { duckParams: duck },
        { duckParams: { thresholdDb: 0, ratio: 20, attackMs: 200, releaseMs: 2000 } },
        { duckParams: { thresholdDb: -60, ratio: 1, attackMs: 1, releaseMs: 50 } }
      ]) {
        expect(validateProject(withTrack(fields)).ok, JSON.stringify(fields)).toBe(true)
      }
    })

    it('does NOT refuse a project over its loudness target: main says what to change at export', () => {
      const result = validateProject({
        ...baseProject,
        audioStudio: { sourcePath: 'C:/safe.wav', chain: goodChain({ loudnormTargetLufs: -3 }) }
      })
      expect(result.ok).toBe(true)
    })
  })

  it('accepts a safe absolute secondaryTrack.filePath', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: {
        sourcePath: 'C:/safe.wav',
        chain: goodChain({
          secondaryTrack: {
            filePath: 'C:/Users/maken/Music/bed.mp3',
            fileName: 'bed.mp3',
            role: 'music',
            gainDb: -6,
            duckUnderPrimary: true
          }
        })
      }
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a chain with secondaryTrack null (back-compat)', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'C:/safe.wav', chain: goodChain({ secondaryTrack: null }) }
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a chain with secondaryTrack absent (back-compat)', () => {
    const { secondaryTrack: _gone, ...withoutTrack } = goodChain()
    void _gone
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'C:/safe.wav', chain: withoutTrack }
    })
    expect(result.ok).toBe(true)
  })
})

describe('clip textOverlay validation (bug round 14)', () => {
  // Threat model: a malicious .imagii.json carries a clip with a
  // textOverlay whose colorHex / sizePx is an FFmpeg filter-graph
  // injection payload. drawTextFilter interpolates those raw, so the
  // validator must reject the whole project before it ever loads.
  const goodOverlay = {
    id: 'o1',
    text: 'Hello',
    font: 'arial',
    sizePx: 48,
    colorHex: '#ffffff',
    x: 0.5,
    y: 0.5,
    startSec: 0,
    endSec: 2
  }

  function projectWithOverlay(overlay: unknown) {
    return {
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [goodClip({ textOverlays: [overlay] })],
        selectedClipId: null
      }
    }
  }

  it('accepts a project with a well-formed text overlay', () => {
    expect(validateProject(projectWithOverlay(goodOverlay)).ok).toBe(true)
  })

  // T-121: this was "accepts a clip with no textOverlays field (back-compat)", and the T-119 docblock said the
  // field is "read with a default". It is not: the video store (`clip.textOverlays.length`, `.map`, `.filter`,
  // the spread in add), the overlay editor and `buildVideoFilter` all read it bare, so a restored clip without
  // it opened a studio that threw in render. The field has been in the saved clip since the first commit, so no
  // older file lacks it; what lacks it is a hand-edited or damaged one.
  it('refuses a clip with no textOverlays field - the studio reads the array bare (T-121)', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [(({ textOverlays: _t, ...rest }) => rest)(goodClip())],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('videoStudio.clips[0].textOverlays not an array')
  })

  it('QA\'s clip - id, name, both times and selectedPresets, nothing else - is refused, not restored into a crash (T-121)', () => {
    const qa = { id: 'c1', name: 'Clip 1', startSec: 0, endSec: 5, selectedPresets: ['youtube'] }
    const result = validateProject({
      ...baseProject,
      videoStudio: { sourcePath: 'C:/safe.mp4', clips: [qa], selectedClipId: null }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('videoStudio.clips[0].textOverlays not an array')
  })

  it('rejects a colorHex carrying an FFmpeg injection payload', () => {
    const result = validateProject(
      projectWithOverlay({
        ...goodOverlay,
        colorHex: 'white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]'
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays/)
  })

  it('rejects a non-numeric sizePx', () => {
    const result = validateProject(
      projectWithOverlay({ ...goodOverlay, sizePx: '64; movie=secret' })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays/)
  })

  // T-115: this used to read "rejects an out-of-range sizePx" for 9999 and 2. The old overlay editor had
  // no upper clamp, so a project saved by it holds sizes the gate refuses, and the whole session was
  // unrecoverable (the same family as the color name "white"). `validateProject` now clamps a FINITE
  // size into the gate's range before the gate looks; the gate itself (`isValidTextOverlay`, below)
  // is unchanged and still refuses an out-of-range size - Export and Compile run it on what they are
  // sent; Save project and a restore migrate first. What still refuses here is a size that is not a
  // finite number.
  it('clamps an out-of-range finite sizePx into the gate\'s range instead of refusing the project', () => {
    for (const [typed, clamped] of [[9999, 512], [2, 8], [512.5, 512], [0, 8], [-40, 8]] as const) {
      const result = validateProject(projectWithOverlay({ ...goodOverlay, sizePx: typed }))
      expect(result.ok, String(typed)).toBe(true)
      if (!result.ok) continue
      const clip = result.project.videoStudio?.clips[0] as { textOverlays?: Array<{ sizePx: number }> }
      expect(clip.textOverlays?.[0]?.sizePx, String(typed)).toBe(clamped)
    }
  })

  it('leaves an in-range sizePx exactly as it was (no rounding, no re-clamp)', () => {
    for (const size of [8, 12.5, 48, 511.9, 512]) {
      const result = validateProject(projectWithOverlay({ ...goodOverlay, sizePx: size }))
      if (!result.ok) throw new Error(result.reason)
      const clip = result.project.videoStudio?.clips[0] as { textOverlays?: Array<{ sizePx: number }> }
      expect(clip.textOverlays?.[0]?.sizePx).toBe(size)
    }
  })

  it('still refuses a size that is not a finite number - it is clamped only when it is one', () => {
    for (const bad of [Number.POSITIVE_INFINITY, null, true, [], {}]) {
      const result = validateProject(projectWithOverlay({ ...goodOverlay, sizePx: bad }))
      expect(result.ok, JSON.stringify(bad)).toBe(false)
    }
  })

  it('rejects a non-array textOverlays field', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [{ id: 'c1', textOverlays: 'oops' }],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays/)
  })

  describe('isValidTextOverlay', () => {
    it('accepts a well-formed overlay', () => {
      expect(isValidTextOverlay(goodOverlay)).toBe(true)
    })

    it('accepts a bare 6-hex colorHex (no leading #)', () => {
      expect(isValidTextOverlay({ ...goodOverlay, colorHex: 'AABBCC' })).toBe(true)
    })

    it('rejects a non-object', () => {
      expect(isValidTextOverlay(null)).toBe(false)
      expect(isValidTextOverlay('x')).toBe(false)
      expect(isValidTextOverlay([])).toBe(false)
    })

    it('rejects a malformed colorHex', () => {
      expect(isValidTextOverlay({ ...goodOverlay, colorHex: 'red' })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, colorHex: '#fff' })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, colorHex: 123 })).toBe(false)
    })

    it('rejects a non-finite or out-of-range sizePx', () => {
      expect(isValidTextOverlay({ ...goodOverlay, sizePx: NaN })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, sizePx: 0 })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, sizePx: 1000 })).toBe(false)
    })

    it('rejects non-finite numeric position / timing fields', () => {
      expect(isValidTextOverlay({ ...goodOverlay, x: Infinity })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, startSec: 'a' })).toBe(false)
      expect(isValidTextOverlay({ ...goodOverlay, endSec: undefined })).toBe(false)
    })
  })
})

describe('a legacy project holding a NAMED overlay color is migrated, not refused (T-114)', () => {
  // The overlay editor's default WAS the name "white" until T-113. An autosave (or a saved
  // project) written by that build holds `"colorHex": "white"` - and the gate takes `#RRGGBB`
  // and nothing else, so the person's whole session was unrecoverable ("failed validation").
  // `validateProject` maps a CSS name through the literal table BEFORE the gate looks, so the
  // gate itself stays hex-only (the drawtext-injection pin above is untouched).
  const legacyAutosave = (colorHex: string): string =>
    '{\n' +
    '  "schemaVersion": 5,\n' +
    '  "savedAt": 1760000000000,\n' +
    '  "appVersion": "1.5.0",\n' +
    '  "videoStudio": {\n' +
    '    "sourcePath": "C:/Users/mike/Videos/stream.mp4",\n' +
    '    "clips": [\n' +
    '      {\n' +
    '        "id": "c1", "name": "Clip 1", "startSec": 12, "endSec": 40,\n' +
    '        "cropRect": null, "selectedPresets": ["tiktok"], "speedMultiplier": 1,\n' +
    '        "textOverlays": [\n' +
    '          {\n' +
    '            "id": "o1", "text": "Your text here", "font": "Arial", "sizePx": 48,\n' +
    `            "colorHex": ${JSON.stringify(colorHex)}, "x": 0.1, "y": 0.85, "startSec": 12, "endSec": 40\n` +
    '          }\n' +
    '        ]\n' +
    '      }\n' +
    '    ],\n' +
    '    "selectedClipId": "c1",\n' +
    '    "watermark": null\n' +
    '  }\n' +
    '}\n'

  const colorOf = (result: ReturnType<typeof validateProjectJsonString>): unknown => {
    if (!result.ok) return `refused: ${result.reason}`
    const clip = result.project.videoStudio?.clips[0] as { textOverlays?: Array<{ colorHex: string }> }
    return clip.textOverlays?.[0]?.colorHex
  }

  it('the pre-fix default ("white") restores, and comes back as its hex', () => {
    const result = validateProjectJsonString(legacyAutosave('white'))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(colorOf(result)).toBe('#ffffff')
  })

  it('every other field of the overlay is exactly as it was written', () => {
    const result = validateProjectJsonString(legacyAutosave('white'))
    if (!result.ok) throw new Error(result.reason)
    const clip = result.project.videoStudio?.clips[0] as { textOverlays?: unknown[] }
    expect(clip.textOverlays?.[0]).toEqual({
      id: 'o1', text: 'Your text here', font: 'Arial', sizePx: 48,
      colorHex: '#ffffff', x: 0.1, y: 0.85, startSec: 12, endSec: 40
    })
  })

  it.each([
    ['Gold', '#ffd700'],
    ['  RED ', '#ff0000'],
    ['rebeccapurple', '#663399'],
    ['grey', '#808080']
  ])('a name typed as %j migrates to %s', (typed, hex) => {
    expect(colorOf(validateProjectJsonString(legacyAutosave(typed)))).toBe(hex)
  })

  it('a hex color is left byte for byte as it was (no re-casing, no "#" added)', () => {
    expect(colorOf(validateProjectJsonString(legacyAutosave('#FFCC00')))).toBe('#FFCC00')
    expect(colorOf(validateProjectJsonString(legacyAutosave('AABBCC')))).toBe('AABBCC')
  })

  it.each([
    ['a filter-graph injection behind a real name', 'white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]'],
    ['the ametadata-style string', '0dB,ametadata=mode=print:file=x'],
    ['a quote that would close the option', "white':fontsize=99'"],
    ['a name that is not in the table', 'notacolor'],
    ['a prototype key, not a color', 'constructor'],
    ['an empty string', '']
  ])('still refuses %s', (_label, bad) => {
    const result = validateProjectJsonString(legacyAutosave(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays\[0\] malformed/)
  })

  it('a color that is not a string is still refused, not coerced', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [{ id: 'c1', textOverlays: [{ id: 'o', text: 't', font: 'Arial', sizePx: 48, colorHex: 255, x: 0, y: 0, startSec: 0, endSec: 1 }] }],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(false)
  })

  it('isValidTextOverlay itself is still hex-only: the name is migrated before it, never accepted by it', () => {
    expect(
      isValidTextOverlay({ id: 'o', text: 't', font: 'Arial', sizePx: 48, colorHex: 'white', x: 0, y: 0, startSec: 0, endSec: 1 })
    ).toBe(false)
  })
})

describe('a legacy project holding an out-of-range overlay SIZE is migrated, not refused (T-115)', () => {
  // The old editor clamped nothing above 8: a person who typed 800 saved 800, and the gate takes
  // 8-512. Same family as the named color: written by a build we shipped, refused by the gate we
  // ship now, so the whole session was unrecoverable ("failed validation"). This is the verbatim
  // JSON such a build wrote, with the size token swapped in as raw text.
  const legacyAutosave = (sizeToken: string, colorHex = '#ffffff'): string =>
    '{\n' +
    '  "schemaVersion": 5,\n' +
    '  "savedAt": 1760000000000,\n' +
    '  "appVersion": "1.5.0",\n' +
    '  "videoStudio": {\n' +
    '    "sourcePath": "C:/Users/mike/Videos/stream.mp4",\n' +
    '    "clips": [\n' +
    '      {\n' +
    '        "id": "c1", "name": "Clip 1", "startSec": 12, "endSec": 40,\n' +
    '        "cropRect": null, "selectedPresets": ["tiktok"], "speedMultiplier": 1,\n' +
    '        "textOverlays": [\n' +
    '          {\n' +
    `            "id": "o1", "text": "Your text here", "font": "Arial", "sizePx": ${sizeToken},\n` +
    `            "colorHex": ${JSON.stringify(colorHex)}, "x": 0.1, "y": 0.85, "startSec": 12, "endSec": 40\n` +
    '          }\n' +
    '        ]\n' +
    '      }\n' +
    '    ],\n' +
    '    "selectedClipId": "c1",\n' +
    '    "watermark": null\n' +
    '  }\n' +
    '}\n'

  const overlayOf = (result: ReturnType<typeof validateProjectJsonString>): unknown => {
    if (!result.ok) return `refused: ${result.reason}`
    const clip = result.project.videoStudio?.clips[0] as { textOverlays?: unknown[] }
    return clip.textOverlays?.[0]
  }

  it('a size of 800 restores, at the largest the gate takes (512)', () => {
    const result = validateProjectJsonString(legacyAutosave('800'))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(overlayOf(result)).toEqual({
      id: 'o1', text: 'Your text here', font: 'Arial', sizePx: 512,
      colorHex: '#ffffff', x: 0.1, y: 0.85, startSec: 12, endSec: 40
    })
  })

  it.each([
    ['1', 8],
    ['7.9', 8],
    ['513', 512],
    ['1e6', 512],
    ['-3', 8]
  ])('a size written as %s restores as %d', (token, clamped) => {
    const result = validateProjectJsonString(legacyAutosave(token))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect((overlayOf(result) as { sizePx: number }).sizePx).toBe(clamped)
  })

  it('a project with BOTH legacy problems (the name "white" and a size of 800) restores with both fixed', () => {
    const result = validateProjectJsonString(legacyAutosave('800', 'white'))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(overlayOf(result)).toMatchObject({ sizePx: 512, colorHex: '#ffffff' })
  })

  it.each([
    ['a size written as a string', '"64"'],
    ['a size that is a filter-graph payload', JSON.stringify('64; movie=C\\:/Users/victim/.ssh/id_rsa[k]')],
    ['a size too large to be a number (JSON reads it as Infinity)', '1e999'],
    ['a size of null', 'null'],
    ['a size that is an object', '{"v":64}']
  ])('still refuses %s - the gate decides, the migration only clamps numbers', (_label, token) => {
    const result = validateProjectJsonString(legacyAutosave(token))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays\[0\] malformed/)
  })

  it('the injection pins still stand beside a clamped size: a bad color is refused whatever the size', () => {
    const result = validateProjectJsonString(legacyAutosave('800', 'white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/textOverlays\[0\] malformed/)
  })

  it('isValidTextOverlay itself still refuses an out-of-range size: the clamp lives in the restore, not the gate', () => {
    expect(
      isValidTextOverlay({ id: 'o', text: 't', font: 'Arial', sizePx: 800, colorHex: '#ffffff', x: 0, y: 0, startSec: 0, endSec: 1 })
    ).toBe(false)
  })
})

describe('validateProjectJsonString', () => {
  it('accepts a valid JSON string', () => {
    const result = validateProjectJsonString(JSON.stringify(baseProject))
    expect(result.ok).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateProjectJsonString('').ok).toBe(false)
  })

  it('rejects truncated JSON', () => {
    const truncated = JSON.stringify(baseProject).slice(0, 20)
    const result = validateProjectJsonString(truncated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/JSON/)
  })

  it('rejects non-JSON garbage', () => {
    const result = validateProjectJsonString('this is not json')
    expect(result.ok).toBe(false)
  })

  it('rejects oversize input', () => {
    const big = 'x'.repeat(60 * 1024 * 1024)
    const result = validateProjectJsonString(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/too large/)
  })
})

// T-124 (5): "the session holds no work" has ONE definition, the one the autosave gate already used: a project that
// carries a video, a sound or a canvas with a layer. The autosave banner is gated on the same function, so what is
// too empty to SAVE is exactly what is too empty to be worth OFFERING back over.
describe('hasStudioState', () => {
  it('is false for a project with no studio, whatever else it carries', () => {
    expect(hasStudioState(baseProject)).toBe(false)
    expect(hasStudioState({ ...baseProject, place: { route: '/video' } })).toBe(false)
  })

  it('is true for each studio alone', () => {
    expect(hasStudioState({ ...baseProject, videoStudio: { sourcePath: '/v.mp4', clips: [], selectedClipId: null, watermark: null } })).toBe(true)
    expect(hasStudioState({ ...baseProject, audioStudio: { sourcePath: '/a.wav', chain: DEFAULT_CHAIN_SPEC } })).toBe(true)
    expect(hasStudioState({ ...baseProject, imageCanvas: { doc: { width: 10, height: 10, background: '#ffffff', layers: [] } } })).toBe(true)
  })

  it('agrees with the autosave gate on every shape: what it calls empty, the gate refuses with "no studio state"', () => {
    for (const project of [baseProject, { ...baseProject, place: { route: '/image' } }, projectWithStudios]) {
      expect(isSafeToAutosave(project).ok, JSON.stringify(Object.keys(project))).toBe(hasStudioState(project))
    }
  })
})

describe('isSafeToAutosave', () => {
  it('accepts a project with studios', () => {
    expect(isSafeToAutosave(projectWithStudios).ok).toBe(true)
  })

  it('refuses an empty project (no studios)', () => {
    const result = isSafeToAutosave(baseProject)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no studio state/)
  })
})

/**
 * T-47 — the place record. Unlike every other field, a malformed place is
 * NOT fatal: the user's work is the load-bearing half of a snapshot and
 * must survive a bad route string. Each field degrades on its own, so the
 * table below is the contract the restore path is written against.
 */
describe('sanitizePlace — per-field degradation', () => {
  const fullPlace = {
    route: '/video',
    videoClipId: 'clip-abc',
    canvasLayerId: 'layer-xyz',
    referencesTab: 'assets',
    videoTimeSec: 12.5
  }

  it('keeps a well-formed record intact', () => {
    expect(sanitizePlace(fullPlace)).toEqual(fullPlace)
  })

  it('accepts every route the app can actually restore to', () => {
    for (const route of KNOWN_ROUTES) {
      expect(sanitizePlace({ route })).toEqual({ route })
    }
  })

  it.each([
    ['an unknown route', { route: '/evil' }, 'route'],
    ['a non-string route', { route: 42 }, 'route'],
    ['a non-string clip id', { videoClipId: { id: 1 } }, 'videoClipId'],
    ['an empty clip id', { videoClipId: '' }, 'videoClipId'],
    ['an absurdly long layer id', { canvasLayerId: 'x'.repeat(65) }, 'canvasLayerId'],
    ['an unknown references tab', { referencesTab: 'billing' }, 'referencesTab'],
    ['a negative playhead', { videoTimeSec: -4 }, 'videoTimeSec'],
    ['a NaN playhead', { videoTimeSec: Number.NaN }, 'videoTimeSec'],
    ['a playhead past the day cap', { videoTimeSec: 90_000 }, 'videoTimeSec']
  ])('drops %s and keeps the rest of the record', (_label, bad, field) => {
    const sanitized = sanitizePlace({ ...fullPlace, ...bad })
    expect(sanitized?.[field as keyof typeof fullPlace]).toBeUndefined()
    // Every sibling survives — one bad field is not a lost session.
    for (const key of Object.keys(fullPlace)) {
      if (key === field) continue
      expect(sanitized?.[key as keyof typeof fullPlace]).toEqual(
        fullPlace[key as keyof typeof fullPlace]
      )
    }
  })

  it.each([
    ['a string', 'nope'],
    ['an array', [1, 2, 3]],
    ['null', null],
    ['a number', 7],
    ['an object with nothing usable', { route: '/evil', videoTimeSec: 'soon' }]
  ])('returns undefined for %s, which reads as "no place"', (_label, input) => {
    expect(sanitizePlace(input)).toBeUndefined()
  })

  it('accepts a playhead of exactly zero — the start of the file is a place', () => {
    expect(sanitizePlace({ videoTimeSec: 0 })).toEqual({ videoTimeSec: 0 })
  })
})

describe('validateProject and the place record', () => {
  it('carries a valid place through', () => {
    const result = validateProject({
      ...projectWithStudios,
      place: { route: '/image', canvasLayerId: 'layer-1' }
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.place).toEqual({ route: '/image', canvasLayerId: 'layer-1' })
  })

  it('ACCEPTS a project whose place is garbage, and drops the place', () => {
    // The negative half of T-47: a corrupt place degrades to a data-only
    // restore. Refusing the file would throw away the user's work over a
    // field that only says which screen they were looking at.
    const result = validateProject({ ...projectWithStudios, place: 'wherever' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.place).toBeUndefined()
      expect(result.project.videoStudio?.sourcePath).toBe('C:/path/to/video.mp4')
    }
  })

  it('still refuses a project whose STUDIO state is garbage — data is not optional', () => {
    const result = validateProject({
      ...projectWithStudios,
      videoStudio: { sourcePath: '../../etc/passwd', clips: [], selectedClipId: null },
      place: { route: '/video' }
    })
    expect(result.ok).toBe(false)
  })
})

/**
 * T-119 (12) - a studio the validator accepts is a studio the app can open.
 *
 * `validateProject` descended into a clip's text overlays and nothing else: `clips: [{}]`, `chain: {}` and
 * `doc: {}` all passed, and the app then threw in render (`for (const p of clip.selectedPresets)`,
 * `chain.gainDb.toFixed(1)`) or went on running with an autosave capture that dies the first time it reads
 * `doc.layers.length` (the capture reads the STORE, which a restore had just filled from the empty doc). The
 * three shapes below are the red fixtures. The rule is the fields the app reads without a guard; every
 * optional field an older build left off stays optional, and a refusal names the field in the reason style the
 * rest of the validator uses.
 */
describe('structurally empty studios are refused, named by field (T-119)', () => {
  const withClips = (clips: unknown[]): unknown => ({
    ...baseProject,
    videoStudio: { sourcePath: 'C:/safe.mp4', clips, selectedClipId: null }
  })
  const withChain = (chain: unknown): unknown => ({
    ...baseProject,
    audioStudio: { sourcePath: 'C:/safe.wav', chain }
  })
  const withDoc = (doc: unknown): unknown => ({ ...baseProject, imageCanvas: { doc } })
  const reasonOf = (input: unknown): string => {
    const result = validateProject(input)
    if (result.ok) throw new Error('the project was accepted')
    return result.reason
  }

  describe('the video studio: clips', () => {
    it('refuses the empty clip', () => {
      expect(reasonOf(withClips([{}]))).toBe('videoStudio.clips[0].id missing')
    })

    it.each([
      ['id', undefined, 'videoStudio.clips[0].id missing'],
      ['id', '', 'videoStudio.clips[0].id missing'],
      ['id', 7, 'videoStudio.clips[0].id missing'],
      ['name', undefined, 'videoStudio.clips[0].name not a string'],
      ['name', 12, 'videoStudio.clips[0].name not a string'],
      ['startSec', undefined, 'videoStudio.clips[0].startSec not a number'],
      ['startSec', '0', 'videoStudio.clips[0].startSec not a number'],
      ['startSec', null, 'videoStudio.clips[0].startSec not a number'],
      ['endSec', undefined, 'videoStudio.clips[0].endSec not a number'],
      ['endSec', '5', 'videoStudio.clips[0].endSec not a number'],
      ['selectedPresets', undefined, 'videoStudio.clips[0].selectedPresets not an array'],
      ['selectedPresets', 'youtube', 'videoStudio.clips[0].selectedPresets not an array'],
      ['selectedPresets', null, 'videoStudio.clips[0].selectedPresets not an array'],
      ['selectedPresets', [1], 'videoStudio.clips[0].selectedPresets[0] not a string'],
      ['textOverlays', undefined, 'videoStudio.clips[0].textOverlays not an array'],
      ['textOverlays', null, 'videoStudio.clips[0].textOverlays not an array'],
      ['textOverlays', {}, 'videoStudio.clips[0].textOverlays not an array']
    ])('refuses a clip whose %s is %j', (field, value, reason) => {
      const clip = goodClip()
      if (value === undefined) delete clip[field]
      else clip[field] = value
      expect(reasonOf(withClips([clip]))).toBe(reason)
    })

    it('names the clip that is wrong, not the first one', () => {
      expect(reasonOf(withClips([goodClip(), goodClip({ id: 'c2' }), goodClip({ id: 'c3', selectedPresets: undefined })]))).toBe(
        'videoStudio.clips[2].selectedPresets not an array'
      )
    })

    it('still accepts a whole clip, with and without every optional field an older build left off', () => {
      expect(validateProject(withClips([goodClip()])).ok).toBe(true)
      // T-121: `textOverlays` is not one of them - the studio reads it bare (see "refuses a clip with no textOverlays").
      const bare = { id: 'c1', name: 'Clip 1', startSec: 1, endSec: 2, textOverlays: [], selectedPresets: [] }
      expect(validateProject(withClips([bare])).ok, 'no cropRect: v1 clips').toBe(true)
      expect(
        validateProject(
          withClips([goodClip({ speedMultiplier: 2, colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature: 0 }, autoZoom: true, hypeShake: false, customPresetIds: ['p1'] })])
        ).ok
      ).toBe(true)
      expect(validateProject(withClips([])).ok, 'a studio with no clips is empty, not broken').toBe(true)
    })

    it('a text-overlay refusal still names the overlay (the injection pins do not move)', () => {
      const result = validateProject(withClips([goodClip({ textOverlays: [{ text: 'x', colorHex: 'white,movie=x', sizePx: 40, x: 0, y: 0, startSec: 0, endSec: 1 }] })]))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/textOverlays\[0\] malformed/)
    })
  })

  describe('the audio studio: chain', () => {
    it('refuses the empty chain', () => {
      expect(reasonOf(withChain({}))).toBe('audioStudio.chain.gainDb not a number')
    })

    it.each([
      ['gainDb', undefined, 'audioStudio.chain.gainDb not a number'],
      ['gainDb', '0', 'audioStudio.chain.gainDb not a number'],
      ['gainDb', null, 'audioStudio.chain.gainDb not a number'],
      ['loudnormTargetLufs', undefined, 'audioStudio.chain.loudnormTargetLufs not a number'],
      ['loudnormTargetLufs', '-16', 'audioStudio.chain.loudnormTargetLufs not a number'],
      ['cutRegions', undefined, 'audioStudio.chain.cutRegions not an array'],
      ['cutRegions', {}, 'audioStudio.chain.cutRegions not an array'],
      ['cutRegions', [null], 'audioStudio.chain.cutRegions[0] malformed'],
      ['cutRegions', [{ startSec: 1 }], 'audioStudio.chain.cutRegions[0] malformed'],
      ['cutRegions', [{ startSec: 1, endSec: 2 }, { startSec: '3', endSec: 4 }], 'audioStudio.chain.cutRegions[1] malformed']
    ])('refuses a chain whose %s is %j', (field, value, reason) => {
      const chain = goodChain()
      if (value === undefined) delete chain[field]
      else chain[field] = value
      expect(reasonOf(withChain(chain))).toBe(reason)
    })

    it('still accepts the defaults, a chain with cuts, and a chain missing only what an older build never wrote', () => {
      expect(validateProject(withChain(goodChain())).ok).toBe(true)
      expect(validateProject(withChain(goodChain({ cutRegions: [{ startSec: 1, endSec: 2 }], gainDb: -3.5, loudnormTargetLufs: -14 }))).ok).toBe(true)
      // humHz (T-90), denoiseParams and secondaryTrack are optional: absent means the old behavior.
      const { secondaryTrack: _s, humHz: _h, denoiseParams: _d, ...old } = goodChain() as Record<string, unknown>
      void _s
      void _h
      void _d
      expect(validateProject(withChain(old)).ok).toBe(true)
    })

    it('does not move the second-track refusal: an unsafe filePath is still named first', () => {
      expect(reasonOf(withChain({ secondaryTrack: { filePath: '../x.mp3', fileName: 'x', role: 'music', gainDb: 0, duckUnderPrimary: false } }))).toMatch(
        /secondaryTrack\.filePath/
      )
    })
  })

  describe('the image canvas: doc', () => {
    it('refuses the empty document', () => {
      expect(reasonOf(withDoc({}))).toBe('imageCanvas.doc.layers not an array')
    })

    it.each([
      ['missing', undefined],
      ['null', null],
      ['an object', {}],
      ['a string', 'layers']
    ])('refuses a document whose layers are %s', (_label, layers) => {
      const doc: Record<string, unknown> = { width: 1280, height: 720, background: '#000000' }
      if (layers !== undefined) doc.layers = layers
      expect(reasonOf(withDoc(doc))).toBe('imageCanvas.doc.layers not an array')
    })

    it('accepts a document with layers, and one with none (an empty canvas is a canvas)', () => {
      expect(validateProject(withDoc({ width: 1280, height: 720, background: '#000000', layers: [] })).ok).toBe(true)
      expect(validateProject(withDoc({ width: 10, height: 10, background: '#fff', layers: [{ id: 'l1', type: 'rect' }] })).ok).toBe(true)
    })
  })

  it('the three empty shapes through the file reader the autosave and Open project use', () => {
    for (const [studio, shape, reason] of [
      ['videoStudio', { sourcePath: null, clips: [{}], selectedClipId: null }, /clips\[0\]/],
      ['audioStudio', { sourcePath: null, chain: {} }, /chain\.gainDb/],
      ['imageCanvas', { doc: {} }, /doc\.layers/]
    ] as const) {
      const result = validateProjectJsonString(JSON.stringify({ ...baseProject, [studio]: shape }))
      expect(result.ok, studio).toBe(false)
      if (!result.ok) expect(result.reason, studio).toMatch(reason)
    }
  })
})
