import { describe, it, expect } from 'vitest'
import { basename } from './OutputDirLabel'

/**
 * `basename` backs the output-directory chip shown in five export panels.
 * Before the OutputDirLabel component, each panel inlined
 * `outDir.split(/[\\/]/).pop()` — which returns `undefined` for a path
 * with a trailing slash and `''` for an empty string. The shared helper
 * filters empty segments so a trailing separator doesn't blank the chip.
 * These tests pin that behavior across Windows and POSIX path shapes.
 */
describe('basename', () => {
  it('returns the last segment of a Windows path', () => {
    expect(basename('C:\\Users\\mike\\Videos\\Clips')).toBe('Clips')
  })

  it('returns the last segment of a POSIX path', () => {
    expect(basename('/home/mike/videos/clips')).toBe('clips')
  })

  it('ignores a trailing separator (the .pop() bug)', () => {
    expect(basename('C:\\Users\\mike\\Clips\\')).toBe('Clips')
    expect(basename('/home/mike/clips/')).toBe('clips')
  })

  it('handles mixed separators', () => {
    expect(basename('C:/Users\\mike/Downloads')).toBe('Downloads')
  })

  it('returns the input itself when there is no separator', () => {
    expect(basename('Clips')).toBe('Clips')
  })

  it('returns the input for an empty string rather than undefined', () => {
    expect(basename('')).toBe('')
  })

  it('handles a bare drive root', () => {
    // No real basename — falls back to the input rather than undefined.
    expect(basename('C:\\')).toBe('C:')
  })
})
