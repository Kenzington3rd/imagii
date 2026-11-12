import { describe, it, expect } from 'vitest'
import { MAX_PLAUSIBLE_FPS, probedFps } from './probe'

/**
 * T-120 - a container's clock is not a frame rate.
 *
 * A Matroska file stamps its packets in milliseconds. One that declares no rate of its own (every
 * MediaRecorder webm, and the copy of it Record saves with Convert off, because no ffmpeg option writes a
 * rate into a stream copy) reads `r_frame_rate` 1000/1, and Video Studio's Timeline stepped 1 ms on the `,`
 * and `.` keys. A probed rate above the export gates' own ceiling is "the file does not say", which is the 0
 * the Timeline and the Player already turn into 30. media.spec.ts holds the real-file half: a
 * MediaRecorder-shaped webm through the save remux and through `probeVideo`.
 */
describe('probedFps', () => {
  it('reads the average rate first, as it always did', () => {
    expect(probedFps('30/1', '60/1')).toBe(30)
    expect(probedFps('30000/1001', '30/1')).toBeCloseTo(29.97, 2)
  })

  it('falls back to the real rate when there is no average (0/0, absent, empty)', () => {
    expect(probedFps('0/0', '25/1')).toBe(25)
    expect(probedFps(undefined, '24/1')).toBe(24)
    expect(probedFps('', '24/1')).toBe(24)
  })

  it('a millisecond clock is unknown, not 1000 fps: the shape of a MediaRecorder file and of its remux', () => {
    expect(probedFps('0/0', '1000/1')).toBe(0)
    expect(probedFps('1000/1', '1000/1')).toBe(0)
    expect(probedFps(undefined, '1000/1')).toBe(0)
  })

  it('the ceiling is 240 and it is inclusive: 240 is a rate, 241 is not', () => {
    expect(MAX_PLAUSIBLE_FPS).toBe(240)
    expect(probedFps('240/1', undefined)).toBe(240)
    expect(probedFps('241/1', undefined)).toBe(0)
    // 120 and 144 fps captures are real and stay.
    expect(probedFps('120/1', undefined)).toBe(120)
    expect(probedFps('144/1', undefined)).toBe(144)
  })

  it('no rate at all is 0', () => {
    expect(probedFps(undefined, undefined)).toBe(0)
    expect(probedFps('0/0', '0/0')).toBe(0)
    expect(probedFps('nonsense', 'x/y')).toBe(0)
  })
})
