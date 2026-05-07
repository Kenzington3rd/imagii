import { describe, it, expect } from 'vitest'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertPlainObject,
  assertArray
} from './validators'

describe('assertNonEmptyString', () => {
  it('accepts non-empty strings', () => {
    expect(() => assertNonEmptyString('hi', 'name')).not.toThrow()
  })
  it('rejects empty, null, undefined, non-strings', () => {
    expect(() => assertNonEmptyString('', 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(null, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(undefined, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(42, 'name')).toThrow(/non-empty string/)
  })
})

describe('assertFiniteNonNeg', () => {
  it('accepts 0 and positive finite numbers', () => {
    expect(() => assertFiniteNonNeg(0, 'x')).not.toThrow()
    expect(() => assertFiniteNonNeg(1.5, 'x')).not.toThrow()
  })
  it('rejects negative, NaN, Infinity, non-numbers', () => {
    expect(() => assertFiniteNonNeg(-1, 'x')).toThrow()
    expect(() => assertFiniteNonNeg(NaN, 'x')).toThrow()
    expect(() => assertFiniteNonNeg(Infinity, 'x')).toThrow()
    expect(() => assertFiniteNonNeg('5', 'x')).toThrow()
  })
})

describe('assertRange', () => {
  it('accepts values inside [lo, hi] inclusive', () => {
    expect(() => assertRange(0, 0, 10, 'x')).not.toThrow()
    expect(() => assertRange(10, 0, 10, 'x')).not.toThrow()
    expect(() => assertRange(5, 0, 10, 'x')).not.toThrow()
  })
  it('rejects values outside the range', () => {
    expect(() => assertRange(-1, 0, 10, 'x')).toThrow(/in \[0, 10\]/)
    expect(() => assertRange(11, 0, 10, 'x')).toThrow(/in \[0, 10\]/)
  })
})

describe('assertEnum', () => {
  const allowed = ['a', 'b', 'c'] as const
  it('accepts members', () => {
    expect(() => assertEnum('a', allowed, 'kind')).not.toThrow()
    expect(() => assertEnum('c', allowed, 'kind')).not.toThrow()
  })
  it('rejects non-members', () => {
    expect(() => assertEnum('z', allowed, 'kind')).toThrow(/one of a, b, c/)
    expect(() => assertEnum(undefined, allowed, 'kind')).toThrow()
  })
})

describe('assertPlainObject', () => {
  it('accepts plain objects', () => {
    expect(() => assertPlainObject({}, 'o')).not.toThrow()
    expect(() => assertPlainObject({ a: 1 }, 'o')).not.toThrow()
  })
  it('rejects arrays, null, primitives', () => {
    expect(() => assertPlainObject([], 'o')).toThrow(/plain object/)
    expect(() => assertPlainObject(null, 'o')).toThrow(/plain object/)
    expect(() => assertPlainObject('x', 'o')).toThrow(/plain object/)
  })
})

describe('assertArray', () => {
  it('accepts arrays under the cap', () => {
    expect(() => assertArray([], 'a')).not.toThrow()
    expect(() => assertArray([1, 2, 3], 'a', 5)).not.toThrow()
  })
  it('rejects non-arrays and over-cap arrays', () => {
    expect(() => assertArray({}, 'a')).toThrow(/must be an array/)
    expect(() => assertArray([1, 2, 3, 4, 5, 6], 'a', 5)).toThrow(/exceeds max length/)
  })
})
