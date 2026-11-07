import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { assert, assertAlways, assertDefined, AssertionError } from './assert'

describe('assert', () => {
  it('returns silently when condition is truthy', () => {
    expect(() => assert(true, 'should not throw')).not.toThrow()
    expect(() => assert(1, 'truthy number')).not.toThrow()
    expect(() => assert('non-empty', 'truthy string')).not.toThrow()
    expect(() => assert([], 'empty array is truthy')).not.toThrow()
  })

  it('throws AssertionError on falsy in dev', () => {
    expect(() => assert(false, 'falsy bool')).toThrow(AssertionError)
    expect(() => assert(0, 'zero')).toThrow(/zero/)
    expect(() => assert(null, 'null')).toThrow(/null/)
    expect(() => assert(undefined, 'undef')).toThrow(/undef/)
  })

  it('rejects empty messages so callers stay descriptive', () => {
    expect(() => assert(true, '')).toThrow(/non-empty message/)
  })
})

describe('assert in production', () => {
  const prevEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('warns instead of throwing when NODE_ENV=production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => assert(false, 'prod should warn')).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prod should warn'))
    warn.mockRestore()
  })
})

describe('assertDefined', () => {
  it('returns the value when defined', () => {
    expect(assertDefined(42, 'n')).toBe(42)
    expect(assertDefined('hello', 's')).toBe('hello')
    expect(assertDefined({ a: 1 }, 'obj')).toEqual({ a: 1 })
  })

  it('throws on null and undefined in dev', () => {
    expect(() => assertDefined<number>(null, 'value')).toThrow(/null/)
    expect(() => assertDefined<number>(undefined, 'value')).toThrow(/undefined/)
  })

  it('rejects empty names', () => {
    expect(() => assertDefined(1, '')).toThrow(/without a name/)
  })
})

// Regression: prior to this fix, assertDefined in production warned and
// returned `value as T` — i.e. it returned null/undefined cast as the
// expected type, then downstream code crashed with a much less helpful
// `TypeError: Cannot read properties of null`. Throwing in both envs is
// strictly more useful: the named AssertionError tells you which value
// was missing and where. Keep this test if anyone is tempted to "soften"
// the prod path again.
describe('assertDefined in production', () => {
  const prevEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('still throws AssertionError on null in prod (does not return null as T)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => assertDefined<number>(null, 'must-be-defined')).toThrow(AssertionError)
    expect(() => assertDefined<number>(null, 'must-be-defined')).toThrow(/null/)
    // It still warns on the console, but it MUST also throw.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must-be-defined'))
    warn.mockRestore()
  })

  it('still throws on undefined in prod', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => assertDefined<number>(undefined, 'also-required')).toThrow(/undefined/)
    warn.mockRestore()
  })

  it('returns the value unchanged in prod when defined', () => {
    expect(assertDefined(0, 'zero is defined')).toBe(0)
    expect(assertDefined('', 'empty string is defined')).toBe('')
    expect(assertDefined(false, 'false is defined')).toBe(false)
  })
})

// T-113: `assertAlways` is the validators' primitive. `assert()` is a soft invariant (it
// warns and continues in production, by design); a validator refuses input at a trust
// boundary, and a refusal that depends on an environment variable is not one.
describe('assertAlways', () => {
  const prevEnv = process.env.NODE_ENV
  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('returns silently when the condition holds', () => {
    expect(() => assertAlways(true, 'fine')).not.toThrow()
    expect(() => assertAlways('x', 'truthy')).not.toThrow()
  })

  it('throws AssertionError on a falsy condition in dev', () => {
    expect(() => assertAlways(false, 'refused')).toThrow(AssertionError)
    expect(() => assertAlways(0, 'zero')).toThrow(/zero/)
  })

  it('throws in production too — where assert() only warns', () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => assert(false, 'soft')).not.toThrow()
      expect(() => assertAlways(false, 'hard')).toThrow(/hard/)
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects empty messages so a refusal always says what it refused', () => {
    expect(() => assertAlways(true, '')).toThrow(/non-empty message/)
  })
})
