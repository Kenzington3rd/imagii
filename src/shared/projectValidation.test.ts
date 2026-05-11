import { describe, it, expect } from 'vitest'
import {
  MAX_SCHEMA_VERSION,
  isSafeToAutosave,
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
