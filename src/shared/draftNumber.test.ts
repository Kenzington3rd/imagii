import { describe, it, expect } from 'vitest'
import { clampTyped, isTypedInRange, typedNumber } from './draftNumber'

/**
 * T-123 (3), (4): the judgments behind `DraftField`'s number boxes. The measured bug is the sequence an
 * emptied PiP width box went through - "" read as no number, snapped to 360, and "600" typed after it was
 * 360600 - so the first block replays a typing session through what a controlled box would have stored.
 */
describe('typedNumber', () => {
  it('reads a number, a decimal and a negative', () => {
    expect(typedNumber('600')).toBe(600)
    expect(typedNumber('0.4')).toBe(0.4)
    expect(typedNumber('-3')).toBe(-3)
    expect(typedNumber(' 12 ')).toBe(12)
  })

  it('is null for an empty box, whitespace and text that is not a number', () => {
    for (const typed of ['', '   ', 'abc', '1e', '--1', 'NaN', 'Infinity', '-Infinity']) {
      expect(typedNumber(typed), JSON.stringify(typed)).toBeNull()
    }
  })

  it('reads a number the browser would accept in a number box mid-typing', () => {
    expect(typedNumber('1.')).toBe(1)
    expect(typedNumber('.5')).toBe(0.5)
  })
})

describe('isTypedInRange (the live check)', () => {
  it('is false for the prefixes of a number on its way into range, true once it is there', () => {
    // 120..960, whole numbers: typing 600 passes through 6 and 60.
    expect(['6', '60', '600'].map((t) => isTypedInRange(t, 120, 960))).toEqual([false, false, true])
    expect(['4', '45'].map((t) => isTypedInRange(t, 3, 60))).toEqual([true, true])
    expect(isTypedInRange('1', 3, 60)).toBe(false)
  })

  it('is inclusive at both edges', () => {
    expect(isTypedInRange('120', 120, 960)).toBe(true)
    expect(isTypedInRange('960', 120, 960)).toBe(true)
    expect(isTypedInRange('119', 120, 960)).toBe(false)
    expect(isTypedInRange('961', 120, 960)).toBe(false)
  })

  it('refuses a fraction when the value is whole, and takes it when it is not', () => {
    expect(isTypedInRange('2.5', 2, 200)).toBe(false)
    expect(isTypedInRange('2.5', 2, 200, false)).toBe(true)
  })

  it('has no upper edge unless it is given one', () => {
    expect(isTypedInRange('100000', 4)).toBe(true)
    expect(isTypedInRange('3', 4)).toBe(false)
  })

  it('is false for an empty box and for text', () => {
    expect(isTypedInRange('', 0, 10)).toBe(false)
    expect(isTypedInRange('abc', 0, 10)).toBe(false)
  })
})

describe('clampTyped (the commit)', () => {
  it('stores what was typed when it is inside the range', () => {
    expect(clampTyped('600', 120, 960)).toBe(600)
  })

  it('clamps to the nearest edge', () => {
    expect(clampTyped('6', 120, 960)).toBe(120)
    expect(clampTyped('5000', 120, 960)).toBe(960)
    expect(clampTyped('-5', 0, 60)).toBe(0)
    expect(clampTyped('7', 8, 512)).toBe(8)
    expect(clampTyped('7000000', 64, 16384)).toBe(16384)
  })

  it('rounds a whole-number box and leaves a decimal one alone', () => {
    expect(clampTyped('44.6', 2, 200)).toBe(45)
    expect(clampTyped('44.6', 2, 200, false)).toBe(44.6)
  })

  it('is null for an empty box or text: the caller keeps what it had', () => {
    expect(clampTyped('', 120, 960)).toBeNull()
    expect(clampTyped('abc', 120, 960)).toBeNull()
  })

  it('with only a minimum, nothing is capped above', () => {
    expect(clampTyped('2000', 4)).toBe(2000)
    expect(clampTyped('1', 4)).toBe(4)
  })

  it('replaying "600" into an emptied PiP width: the box is never judged until it is usable or left', () => {
    // The old controlled box: every keystroke went through `Number(typed) || 360`.
    const old = (typed: string): number => Number(typed) || 360
    let box = '360'
    // Emptied (select all, delete), then 6, 0, 0 typed. The browser's value is the text before + the key.
    box = ''
    expect(old(box)).toBe(360) // snapped to the default, and React writes "360" back into the box
    box = `${old(box)}6`
    box = `${old(box)}0`
    box = `${old(box)}0`
    expect(old(box)).toBe(360600) // the bug: 360, 6, 0, 0
    // The draft: the box holds exactly what was typed, and only a usable value (or leaving) is judged.
    let typed = ''
    const stored: Array<number | null> = []
    for (const key of ['6', '0', '0']) {
      typed += key
      if (isTypedInRange(typed, 120, 960)) stored.push(clampTyped(typed, 120, 960))
    }
    expect(typed).toBe('600')
    expect(stored).toEqual([600])
    expect(clampTyped(typed, 120, 960)).toBe(600)
  })
})
