import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { assert, assertDefined, AssertionError } from './assert'

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
