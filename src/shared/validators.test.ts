import { describe, it, expect } from 'vitest'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertPlainObject,
  assertArray,
  assertOptionalTimeRange
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

describe('assertOptionalTimeRange (captions:burnIn range, T-81)', () => {
  it('accepts an unranged request: both absent', () => {
    expect(() => assertOptionalTimeRange(undefined, undefined, 'req')).not.toThrow()
  })
  it('accepts a real range, including one starting at 0', () => {
    expect(() => assertOptionalTimeRange(0, 3, 'req')).not.toThrow()
    expect(() => assertOptionalTimeRange(2400.5, 2460.25, 'req')).not.toThrow()
  })
  it('refuses a half-given range, naming why', () => {
    expect(() => assertOptionalTimeRange(5, undefined, 'req')).toThrow(/given together/)
    expect(() => assertOptionalTimeRange(undefined, 5, 'req')).toThrow(/given together/)
  })
  it('refuses an empty or inverted range', () => {
    expect(() => assertOptionalTimeRange(5, 5, 'req')).toThrow(/greater than startSec/)
    expect(() => assertOptionalTimeRange(9, 2, 'req')).toThrow(/greater than startSec/)
  })
  it('refuses negative, non-finite and non-number values', () => {
    expect(() => assertOptionalTimeRange(-1, 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(NaN, 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(0, Infinity, 'req')).toThrow(/req\.endSec/)
    expect(() => assertOptionalTimeRange(0, NaN, 'req')).toThrow(/req\.endSec/)
    expect(() => assertOptionalTimeRange('2', 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(2, '5', 'req')).toThrow(/req\.endSec/)
    // null is not "absent": IPC sends undefined for a missing field.
    expect(() => assertOptionalTimeRange(null, null, 'req')).toThrow(/given together|startSec/)
    expect(() => assertOptionalTimeRange(null, 5, 'req')).toThrow(/req\.startSec/)
  })
  it('requires a validator name', () => {
    expect(() => assertOptionalTimeRange(0, 1, '')).toThrow(/name required/)
  })
})
