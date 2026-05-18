import { describe, it, expect } from 'vitest'
import {
  MAX_SCHEMA_VERSION,
  isSafeToAutosave,
  isValidTextOverlay,
  validateProject,
  validateProjectJsonString
} from './projectValidation'
import type { ImagiiProject } from './workspace'

const baseProject: ImagiiProject = {
  schemaVersion: MAX_SCHEMA_VERSION,
  savedAt: Date.now(),
  appVersion: '1.0.0'
}

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

describe('schema migration v1 → v2', () => {
  it('accepts a v1 project and bumps schemaVersion to 2 in place', () => {
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
      expect(result.project.schemaVersion).toBe(2)
      expect(result.project.videoStudio?.sourcePath).toBe('C:/some/file.mp4')
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

  it('accepts a safe absolute secondaryTrack.filePath', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: {
        sourcePath: 'C:/safe.wav',
        chain: {
          secondaryTrack: {
            filePath: 'C:/Users/maken/Music/bed.mp3',
            fileName: 'bed.mp3',
            role: 'music',
            gainDb: -6,
            duckUnderPrimary: true
          }
        }
      }
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a chain with secondaryTrack null (back-compat)', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'C:/safe.wav', chain: { secondaryTrack: null } }
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a chain with secondaryTrack absent (back-compat)', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'C:/safe.wav', chain: {} }
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
        clips: [{ id: 'c1', textOverlays: [overlay] }],
        selectedClipId: null
      }
    }
  }

  it('accepts a project with a well-formed text overlay', () => {
    expect(validateProject(projectWithOverlay(goodOverlay)).ok).toBe(true)
  })

  it('accepts a clip with no textOverlays field (back-compat)', () => {
    const result = validateProject({
      ...baseProject,
      videoStudio: {
        sourcePath: 'C:/safe.mp4',
        clips: [{ id: 'c1' }],
        selectedClipId: null
      }
    })
    expect(result.ok).toBe(true)
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

  it('rejects an out-of-range sizePx', () => {
    expect(validateProject(projectWithOverlay({ ...goodOverlay, sizePx: 9999 })).ok).toBe(
      false
    )
    expect(validateProject(projectWithOverlay({ ...goodOverlay, sizePx: 2 })).ok).toBe(
      false
    )
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
