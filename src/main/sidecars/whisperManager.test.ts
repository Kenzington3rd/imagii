import { describe, it, expect, afterEach } from 'vitest'
import {
  tsToSeconds,
  installWhisperModel,
  runTranscribe,
  __testing__,
  __whisperInstallTesting__,
  __whisperTranscribeTesting__
} from './whisperManager'
import { CAPTION_STYLE_PRESETS, DEFAULT_CAPTION_STYLE } from '../../shared/captions'

const { hexToAssColor, alignmentForPosition, buildForceStyle } = __testing__

describe('tsToSeconds — variable-length fractional seconds (Phase 2.13)', () => {
  it('handles standard 3-digit fractions', () => {
    expect(tsToSeconds('00:00:01,500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.500')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:00,000')).toBeCloseTo(0, 6)
  })

  it('handles 1-digit fractions (Whisper edge case that was broken)', () => {
    // Old code did Number('5') / 1000 = 0.005 — silently 100x too small.
    // New code: parseFloat('0.5') = 0.5.
    expect(tsToSeconds('00:00:01,5')).toBeCloseTo(1.5, 6)
    expect(tsToSeconds('00:00:01.5')).toBeCloseTo(1.5, 6)
  })

  it('handles 2-digit fractions', () => {
    expect(tsToSeconds('00:00:01,50')).toBeCloseTo(1.5, 6)
  })

  it('handles 4+ digit fractions', () => {
    expect(tsToSeconds('00:00:01,1234')).toBeCloseTo(1.1234, 6)
    expect(tsToSeconds('00:00:01,500000')).toBeCloseTo(1.5, 6)
  })

  it('combines hours, minutes, seconds, and fractional', () => {
    expect(tsToSeconds('01:02:03,500')).toBeCloseTo(3723.5, 6)
    expect(tsToSeconds('10:00:00,000')).toBeCloseTo(36000, 6)
  })

  it('returns 0 on unparseable input', () => {
    expect(tsToSeconds('')).toBe(0)
    expect(tsToSeconds('not a timestamp')).toBe(0)
    expect(tsToSeconds('1:2:3')).toBe(0) // missing fractional separator
  })
})

describe('hexToAssColor — Phase 3.1 caption styling', () => {
  it('translates RGB hex to ASS BGR with leading alpha 00', () => {
    expect(hexToAssColor('#ffffff')).toBe('&H00ffffff&')
    expect(hexToAssColor('#000000')).toBe('&H00000000&')
    expect(hexToAssColor('#ff0000')).toBe('&H000000ff&') // red → BGR
    expect(hexToAssColor('#0000ff')).toBe('&H00ff0000&') // blue → BGR
  })

  it('accepts hex without leading #', () => {
    expect(hexToAssColor('123456')).toBe('&H00563412&')
  })

  it('rejects invalid input', () => {
    expect(() => hexToAssColor('not-a-color')).toThrow()
    expect(() => hexToAssColor('#abc')).toThrow() // 3-digit shorthand
    expect(() => hexToAssColor('#1234567')).toThrow()
  })
})

describe('alignmentForPosition', () => {
  it('maps to libass numpad alignments', () => {
    expect(alignmentForPosition('bottom')).toBe(2)
    expect(alignmentForPosition('middle')).toBe(5)
    expect(alignmentForPosition('top')).toBe(8)
  })
})

describe('buildForceStyle', () => {
  it('emits a complete ASS force_style with the given style', () => {
    const out = buildForceStyle(DEFAULT_CAPTION_STYLE, 3.5)
    expect(out).toContain('FontSize=32')
    expect(out).toContain('Alignment=2')
    expect(out).toContain('PrimaryColour=&H00ffffff&')
    expect(out).toContain('OutlineColour=&H00000000&')
    expect(out).toContain('MarginV=40')
  })

  it('uses MarginV=0 for middle position', () => {
    const out = buildForceStyle(
      { ...DEFAULT_CAPTION_STYLE, position: 'middle' },
      3.5
    )
    expect(out).toContain('Alignment=5')
    expect(out).toContain('MarginV=0')
  })

  it('falls back to legacy fontSizePct * 10 when style.fontSize is 0', () => {
    const out = buildForceStyle({ ...DEFAULT_CAPTION_STYLE, fontSize: 0 }, 4.5)
    expect(out).toContain('FontSize=45')
  })

  it('clamps fontSize to [16, 96]', () => {
    expect(buildForceStyle({ ...DEFAULT_CAPTION_STYLE, fontSize: 4 }, 0)).toContain(
      'FontSize=16'
    )
    expect(buildForceStyle({ ...DEFAULT_CAPTION_STYLE, fontSize: 200 }, 0)).toContain(
      'FontSize=96'
    )
  })
})

describe('installWhisperModel — concurrency guard (regression 2026-05-09)', () => {
  afterEach(() => {
    __whisperInstallTesting__.setInstallInProgressForTest(false)
  })

  it('rejects a concurrent install when one is already in progress', async () => {
    // Simulate "install already running" by setting the flag directly.
    // The full install path requires Electron's net module (not available
    // in vitest) — testing the gate logic in isolation is the right level.
    __whisperInstallTesting__.setInstallInProgressForTest(true)
    const result = await installWhisperModel(() => undefined)
    expect(result).toEqual({
      ok: false,
      reason: 'install already in progress'
    })
  })

  it('reports the in-progress flag accurately', () => {
    __whisperInstallTesting__.setInstallInProgressForTest(false)
    expect(__whisperInstallTesting__.isInstallInProgress()).toBe(false)
    __whisperInstallTesting__.setInstallInProgressForTest(true)
    expect(__whisperInstallTesting__.isInstallInProgress()).toBe(true)
  })
})

describe('runTranscribe — concurrency guard (audit round 6)', () => {
  afterEach(() => {
    __whisperTranscribeTesting__.setTranscribeInProgressForTest(false)
  })

  it('rejects a concurrent transcribe when one is already in progress', async () => {
    __whisperTranscribeTesting__.setTranscribeInProgressForTest(true)
    await expect(
      runTranscribe(
        { jobId: 'test', sourcePath: 'C:/test.mp4', language: 'en' },
        () => undefined
      )
    ).rejects.toThrow(/already in progress/)
  })

  it('reports the in-progress flag accurately', () => {
    __whisperTranscribeTesting__.setTranscribeInProgressForTest(false)
    expect(__whisperTranscribeTesting__.isTranscribeInProgress()).toBe(false)
    __whisperTranscribeTesting__.setTranscribeInProgressForTest(true)
    expect(__whisperTranscribeTesting__.isTranscribeInProgress()).toBe(true)
  })
})

describe('CAPTION_STYLE_PRESETS — Phase 4A.2', () => {
  it('exports four presets in the documented order', () => {
    expect(CAPTION_STYLE_PRESETS).toHaveLength(4)
    expect(CAPTION_STYLE_PRESETS.map((p) => p.id)).toEqual([
      'tiktok-bold',
      'reels-minimal',
      'subtle-subtitle',
      'big-outline-accessibility'
    ])
  })

  it('every preset has a complete CaptionStyle that buildForceStyle accepts', () => {
    for (const preset of CAPTION_STYLE_PRESETS) {
      const out = buildForceStyle(preset.style, 0)
      expect(out).toMatch(/FontSize=\d+/)
      expect(out).toMatch(/Alignment=[258]/)
      expect(out).toMatch(/PrimaryColour=&H00[0-9a-f]{6}&/)
      expect(out).toMatch(/OutlineColour=&H00[0-9a-f]{6}&/)
    }
  })

  it('every preset has a non-empty label and hint', () => {
    for (const preset of CAPTION_STYLE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.hint.length).toBeGreaterThan(0)
    }
  })
})
