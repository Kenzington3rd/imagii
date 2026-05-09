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
      videoStudio: { sourcePath: 'ok', clips: 'not an array' }
    })
    expect(result.ok).toBe(false)
  })

  it('rejects malformed audioStudio chain', () => {
    const result = validateProject({
      ...baseProject,
      audioStudio: { sourcePath: 'ok', chain: 'not an object' }
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
