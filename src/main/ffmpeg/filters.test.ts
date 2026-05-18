import { describe, it, expect } from 'vitest'
import { __testing__ } from './filters'

const { escapeDrawtext, safeOverlaySize, safeOverlayColor } = __testing__

/**
 * Regression tests for the drawtext escape helper. Round 6 caught that
 * newlines weren't being escaped, which broke the entire export for any
 * text overlay or watermark with embedded line breaks. Pin the escape
 * behavior in tests so a future "simplification" of the function can't
 * regress.
 */
describe('escapeDrawtext', () => {
  it('escapes the four classic offenders', () => {
    expect(escapeDrawtext("o'reilly")).toBe("o\\'reilly")
    expect(escapeDrawtext('12:30')).toBe('12\\:30')
    expect(escapeDrawtext('50%')).toBe('50\\%')
    expect(escapeDrawtext('path\\file')).toBe('path\\\\file')
  })

  it('escapes newlines to ffmpeg-compatible \\n sequence', () => {
    expect(escapeDrawtext('line1\nline2')).toBe('line1\\nline2')
    expect(escapeDrawtext('a\r\nb')).toBe('a\\nb')
    expect(escapeDrawtext('a\rb')).toBe('a\\nb')
  })

  it('handles all offenders together without double-escaping', () => {
    // Backslash must be escaped FIRST so we don't double-escape introduced \\
    const out = escapeDrawtext("it's 50%:\nfoo\\bar")
    expect(out).toBe("it\\'s 50\\%\\:\\nfoo\\\\bar")
  })

  it('returns empty string for empty input', () => {
    expect(escapeDrawtext('')).toBe('')
  })

  it('passes through safe alphanumeric text', () => {
    expect(escapeDrawtext('Hello World 123')).toBe('Hello World 123')
  })
})

/**
 * Regression for round 14: drawTextFilter interpolated `overlay.sizePx`
 * and `overlay.colorHex` raw. A malicious .imagii.json could set colorHex
 * to `white,movie=C\:/Users/victim/.ssh/id_rsa[k]...` and inject arbitrary
 * FFmpeg filter directives. These sink-side coercers are the last-line
 * defense — they must never let a non-numeric size or non-hex color reach
 * the filter string.
 */
describe('safeOverlaySize', () => {
  it('passes through a valid in-range size, rounded', () => {
    expect(safeOverlaySize(48)).toBe(48)
    expect(safeOverlaySize(64.4)).toBe(64)
  })

  it('clamps to the 8..512 range', () => {
    expect(safeOverlaySize(2)).toBe(8)
    expect(safeOverlaySize(9999)).toBe(512)
  })

  it('falls back to 48 for non-finite / non-numeric input', () => {
    expect(safeOverlaySize(NaN)).toBe(48)
    expect(safeOverlaySize(Infinity)).toBe(48)
    expect(safeOverlaySize('64; movie=secret' as unknown)).toBe(48)
    expect(safeOverlaySize(undefined as unknown)).toBe(48)
  })
})

describe('safeOverlayColor', () => {
  it('passes through a well-formed hex color', () => {
    expect(safeOverlayColor('#ffffff')).toBe('#ffffff')
    expect(safeOverlayColor('00FF00')).toBe('00FF00')
  })

  it('falls back to white for an injection payload', () => {
    expect(
      safeOverlayColor('white,movie=C\\:/Users/victim/.ssh/id_rsa[k];[k]')
    ).toBe('white')
    expect(safeOverlayColor('red')).toBe('white')
    expect(safeOverlayColor('#fff')).toBe('white')
    expect(safeOverlayColor(42 as unknown)).toBe('white')
  })
})
