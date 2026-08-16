import { describe, it, expect } from 'vitest'
import { isValidBitrate } from './customPresets'

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
