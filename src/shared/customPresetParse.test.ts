import { describe, it, expect } from 'vitest'
import { parseCustomPreset } from './customPresetParse'

/**
 * Regression for bug round 14: `listCustomPresets` guarded `JSON.parse`
 * with try/catch, but then `presets.sort((a, b) => a.name.localeCompare(...))`
 * threw a `TypeError` if a preset file was valid JSON yet structurally
 * wrong (`{}`, `null`, `42`, a half-written file). `parseCustomPreset`
 * closes that class: it returns a fully-formed `CustomPreset` or `null`,
 * never a half-valid object — so the `.sort` only ever sees real presets.
 */
describe('parseCustomPreset', () => {
  const valid = JSON.stringify({
    id: 'preset123',
    name: 'My 4K preset',
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitrate: '40M',
    audioBitrate: '320k',
    basePlatformId: 'youtube'
  })

  it('parses a well-formed preset', () => {
    const p = parseCustomPreset(valid)
    expect(p).not.toBeNull()
    expect(p?.id).toBe('preset123')
    expect(p?.name).toBe('My 4K preset')
    expect(p?.width).toBe(3840)
    expect(p?.fps).toBe(60)
  })

  it('returns null on invalid JSON', () => {
    expect(parseCustomPreset('{not json')).toBeNull()
    expect(parseCustomPreset('')).toBeNull()
  })

  it('returns null for a non-object root (the .localeCompare crash case)', () => {
    expect(parseCustomPreset('42')).toBeNull()
    expect(parseCustomPreset('null')).toBeNull()
    expect(parseCustomPreset('"a string"')).toBeNull()
    expect(parseCustomPreset('[1,2,3]')).toBeNull()
    expect(parseCustomPreset('{}')).toBeNull()
  })

  it('returns null when name is missing or blank', () => {
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), name: undefined }))
    ).toBeNull()
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), name: '' }))
    ).toBeNull()
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), name: 42 }))
    ).toBeNull()
  })

  it('returns null when id is missing or blank', () => {
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), id: '' }))
    ).toBeNull()
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), id: undefined }))
    ).toBeNull()
  })

  it('returns null when a numeric field is missing or non-finite', () => {
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), width: 'big' }))
    ).toBeNull()
    expect(
      parseCustomPreset(JSON.stringify({ ...JSON.parse(valid), fps: undefined }))
    ).toBeNull()
  })
})
