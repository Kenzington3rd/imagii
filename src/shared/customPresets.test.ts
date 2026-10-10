import { describe, it, expect } from 'vitest'
import { formatBitrate, isValidBitrate, normalizeBitrate } from './customPresets'

/**
 * T-50: custom presets became real export targets, so their bitrate strings
 * now land in the encoder's `-b:v` / `-b:a` argv. `isValidBitrate` is the one
 * gate both ends use — the manager before it writes a preset to disk, and
 * `validateExportJob` before it hands one to ffmpeg.
 */
describe('isValidBitrate', () => {
  it('accepts the forms the app itself writes', () => {
    for (const ok of ['8M', '6M', '5M', '192k', '128k', '256k']) {
      expect(isValidBitrate(ok), ok).toBe(true)
    }
  })

  it('accepts a bare bit count and a decimal rate', () => {
    expect(isValidBitrate('5000000')).toBe(true)
    expect(isValidBitrate('2.5M')).toBe(true)
    expect(isValidBitrate('1.25m')).toBe(true)
    expect(isValidBitrate('320K')).toBe(true)
  })

  it('rejects prose a user might type into the field', () => {
    for (const bad of ['8 Mbps', 'high', '8 M', 'M8', '', ' 8M', '8M ', '8Mb']) {
      expect(isValidBitrate(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('rejects anything that is not a string', () => {
    for (const bad of [undefined, null, 8, {}, [], NaN]) {
      expect(isValidBitrate(bad)).toBe(false)
    }
  })

  it('rejects a value crafted to smuggle a second ffmpeg argument', () => {
    expect(isValidBitrate('8M -vf movie=x.mp4')).toBe(false)
    expect(isValidBitrate('8M;rm -rf /')).toBe(false)
    expect(isValidBitrate('-b:v')).toBe(false)
  })

  it('bounds the digit run so a megabyte-long "number" cannot reach argv', () => {
    expect(isValidBitrate('1'.repeat(9))).toBe(true)
    expect(isValidBitrate('1'.repeat(10))).toBe(false)
  })
})

/**
 * T-92: the field accepted a bare "192", and ffmpeg reads a bare number as
 * BITS per second — so a user who typed what they meant (192 kbps) saved a
 * preset that encoded audio at 192 bits/s, and "8000" video at 8 kbps. The
 * label said "V bitrate" and never said which unit. The form now normalizes
 * on save: a bare number is kilobits per second (the unit every streaming tool
 * and the placeholder teach), a number too big to be kilobits is refused with
 * the spelling that WOULD work, and ffmpeg's lowercase "m" (milli!) is read the
 * way a person means it (mega).
 */
describe('normalizeBitrate', () => {
  it('suffixes a bare number as kilobits per second', () => {
    expect(normalizeBitrate('192', 'audio')).toEqual({ ok: true, value: '192k' })
    expect(normalizeBitrate('8000', 'video')).toEqual({ ok: true, value: '8000k' })
    expect(normalizeBitrate('2.5', 'audio')).toEqual({ ok: true, value: '2.5k' })
  })

  it('leaves an already-suffixed rate alone', () => {
    for (const ok of ['8M', '6M', '192k', '128k', '2.5M']) {
      expect(normalizeBitrate(ok, 'video'), ok).toEqual({ ok: true, value: ok })
    }
  })

  it('forgives the spaces a paste brings along', () => {
    expect(normalizeBitrate(' 8M ', 'video')).toEqual({ ok: true, value: '8M' })
    expect(normalizeBitrate(' 192 ', 'audio')).toEqual({ ok: true, value: '192k' })
  })

  it('reads a lowercase m as mega, not ffmpeg\'s milli, and K as k', () => {
    expect(normalizeBitrate('8m', 'video')).toEqual({ ok: true, value: '8M' })
    expect(normalizeBitrate('1.25m', 'video')).toEqual({ ok: true, value: '1.25M' })
    expect(normalizeBitrate('320K', 'audio')).toEqual({ ok: true, value: '320k' })
  })

  it('refuses a bare number too big to be kilobits, and says what to write', () => {
    const r = normalizeBitrate('5000000', 'video')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.problem).toContain('5000000')
      expect(r.problem).toContain('5M')
      expect(r.problem).toMatch(/\.$/)
    }
    const audio = normalizeBitrate('128000', 'audio')
    expect(audio.ok).toBe(false)
    if (!audio.ok) expect(audio.problem).toContain('128k')
  })

  it('accepts the biggest bare number that is still kilobits', () => {
    expect(normalizeBitrate('100000', 'video')).toEqual({ ok: true, value: '100000k' })
    expect(normalizeBitrate('100001', 'video').ok).toBe(false)
  })

  it('refuses prose and zero with a message that names the field and an example', () => {
    for (const bad of ['', '   ', 'high', '8 Mbps', 'M8', '0', '0k', '-5']) {
      const r = normalizeBitrate(bad, 'video')
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) {
        expect(r.problem, bad).toMatch(/^Video bitrate/)
        expect(r.problem, bad).toContain('8M')
      }
    }
    const a = normalizeBitrate('loud', 'audio')
    expect(a.ok).toBe(false)
    if (!a.ok) {
      expect(a.problem).toMatch(/^Audio bitrate/)
      expect(a.problem).toContain('192k')
    }
  })

  it('everything it accepts passes the gate main applies before ffmpeg runs', () => {
    for (const raw of ['192', '8000', '8m', ' 8M ', '2.5', '1.25m', '320K', '99999']) {
      const r = normalizeBitrate(raw, 'video')
      expect(r.ok, raw).toBe(true)
      if (r.ok) expect(isValidBitrate(r.value), `${raw} -> ${r.value}`).toBe(true)
    }
  })

  it('cannot be used to smuggle a second ffmpeg argument', () => {
    for (const bad of ['8M -vf movie=x.mp4', '8M;rm -rf /', '-b:v']) {
      expect(normalizeBitrate(bad, 'video').ok, bad).toBe(false)
    }
  })
})

describe('formatBitrate', () => {
  it('spells a suffixed rate with its unit', () => {
    expect(formatBitrate('8M')).toBe('8 Mbps')
    expect(formatBitrate('2.5M')).toBe('2.5 Mbps')
    expect(formatBitrate('192k')).toBe('192 kbps')
    expect(formatBitrate('320K')).toBe('320 kbps')
    expect(formatBitrate('1.25m')).toBe('1.25 Mbps')
  })

  it('reads a legacy bare number the way ffmpeg does: as bits per second', () => {
    expect(formatBitrate('5000000')).toBe('5 Mbps')
    expect(formatBitrate('128000')).toBe('128 kbps')
    expect(formatBitrate('128500')).toBe('128.5 kbps')
    expect(formatBitrate('900')).toBe('900 bps')
  })

  it('hands back anything it cannot read, rather than inventing a unit', () => {
    expect(formatBitrate('lots')).toBe('lots')
  })
})
