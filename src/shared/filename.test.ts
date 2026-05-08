import { describe, it, expect } from 'vitest'
import { expandFilenameTemplate, sanitizeFilename } from './filename'

describe('sanitizeFilename', () => {
  it('passes through alphanumeric, dash, underscore unchanged', () => {
    expect(sanitizeFilename('clip-1')).toBe('clip-1')
    expect(sanitizeFilename('My_Clip-2')).toBe('My_Clip-2')
    expect(sanitizeFilename('abc123')).toBe('abc123')
  })

  it('replaces forbidden characters with underscore', () => {
    expect(sanitizeFilename('Big W!! 🎉')).toBe('Big_W')
    expect(sanitizeFilename('clip/with\\slashes')).toBe('clip_with_slashes')
    expect(sanitizeFilename('hello:world?')).toBe('hello_world')
  })

  it('collapses runs of forbidden chars and trims edges', () => {
    expect(sanitizeFilename('  spaces  ')).toBe('spaces')
    expect(sanitizeFilename('!!!boom!!!')).toBe('boom')
    expect(sanitizeFilename('a!!!b!!!c')).toBe('a_b_c')
  })

  it('returns "clip" fallback for inputs that sanitize to empty', () => {
    expect(sanitizeFilename('')).toBe('clip')
    expect(sanitizeFilename('!!!')).toBe('clip')
    expect(sanitizeFilename('🎉🎉🎉')).toBe('clip')
  })

  it('handles non-string input defensively', () => {
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(null)).toBe('clip')
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(undefined)).toBe('clip')
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(42)).toBe('clip')
  })
})

describe('expandFilenameTemplate', () => {
  it('expands tokens against context', () => {
    const out = expandFilenameTemplate('{source}_{clip}_{preset}', {
      source: 'vod123',
      clip: 'highlight',
      preset: 'tiktok',
      ext: 'mp4'
    })
    expect(out).toBe('vod123_highlight_tiktok.mp4')
  })

  it('falls back to default template on empty input', () => {
    const out = expandFilenameTemplate('', {
      source: 'vod',
      clip: 'c',
      preset: 'p',
      ext: 'mp4'
    })
    expect(out).toBe('vod_c_p.mp4')
  })

  it('strips invalid filesystem chars from substituted values', () => {
    const out = expandFilenameTemplate('{source}', {
      source: 'bad/name:here',
      ext: 'mp4'
    })
    expect(out).toMatch(/^bad_name_here\.mp4$/)
  })
})
