import { describe, it, expect } from 'vitest'
import { parseChatLog, parseTimestampToSec } from './chatLog'

describe('parseTimestampToSec', () => {
  it('parses [hh:mm:ss] form', () => {
    expect(parseTimestampToSec('00:01:30')).toBe(90)
    expect(parseTimestampToSec('01:00:00')).toBe(3600)
  })
  it('parses [mm:ss] form', () => {
    expect(parseTimestampToSec('05:30')).toBe(330)
    expect(parseTimestampToSec('00:42')).toBe(42)
  })
  it('parses fractional seconds (dot or comma)', () => {
    expect(parseTimestampToSec('00:01.500')).toBeCloseTo(1.5, 6)
    expect(parseTimestampToSec('00:01,500')).toBeCloseTo(1.5, 6)
    expect(parseTimestampToSec('00:01.5')).toBeCloseTo(1.5, 6)
  })
  it('returns 0 on empty or unparseable input', () => {
    expect(parseTimestampToSec('')).toBe(0)
    expect(parseTimestampToSec('not a timestamp')).toBe(0)
  })
})

describe('parseChatLog', () => {
  it('parses [mm:ss] username: message format', () => {
    const log = '[0:30] viewer1: hello\n[0:31] viewer2: world'
    const messages = parseChatLog(log)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ tSec: 30, text: 'hello' })
    expect(messages[1]).toEqual({ tSec: 31, text: 'world' })
  })

  it('parses <username> bracket format', () => {
    const log = '[1:15] <user> POG'
    const messages = parseChatLog(log)
    expect(messages).toEqual([{ tSec: 75, text: 'POG' }])
  })

  it('skips malformed lines silently', () => {
    const log = [
      '[0:30] viewer1: keep this',
      '<no timestamp here>',
      'just a line of text',
      '[0:31] viewer2: keep this too'
    ].join('\n')
    const messages = parseChatLog(log)
    expect(messages).toHaveLength(2)
  })

  it('skips empty messages', () => {
    const log = '[0:30] viewer1:   \n[0:31] viewer2: real'
    const messages = parseChatLog(log)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('real')
  })
})
