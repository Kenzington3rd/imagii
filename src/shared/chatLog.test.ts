import { describe, it, expect } from 'vitest'
import { CHAT_LOG_FORMAT_MESSAGE, parseChatLog, parseTimestampToSec } from './chatLog'

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

  // T-121: the username class was ASCII `\w`, so a line from a chatter whose name is Korean, Japanese or
  // Cyrillic matched nothing and never reached the spike count.
  it('counts a line whose username is not ASCII: Korean, Japanese, Cyrillic, accented', () => {
    const log = [
      '[0:30] viewer1: ascii',
      '[0:31] 한국어: 안녕하세요',
      '[0:32] クリップ: すごい',
      '[0:33] Привет: ура',
      '[0:34] Épico: gg',
      '[0:35] <한국어> POG'
    ].join('\n')
    expect(parseChatLog(log)).toEqual([
      { tSec: 30, text: 'ascii' },
      { tSec: 31, text: '안녕하세요' },
      { tSec: 32, text: 'すごい' },
      { tSec: 33, text: 'ура' },
      { tSec: 34, text: 'gg' },
      { tSec: 35, text: 'POG' }
    ])
  })

  it('a name with a combining mark (a decomposed accent, a Thai name) is still one username', () => {
    const log = '[0:30] E\u0301pico: gg\n[0:31] สวัสดี: hello'
    expect(parseChatLog(log)).toEqual([
      { tSec: 30, text: 'gg' },
      { tSec: 31, text: 'hello' }
    ])
  })

  it('the ASCII lines keep parsing exactly as before (digits, dash, underscore, no colon)', () => {
    const log = '[0:30] user_1-b: x\n[0:31] user2 y\n[1:02:03.5] <u-3> z'
    expect(parseChatLog(log)).toEqual([
      { tSec: 30, text: 'x' },
      { tSec: 31, text: 'y' },
      { tSec: 3723.5, text: 'z' }
    ])
  })

  it('skips empty messages', () => {
    const log = '[0:30] viewer1:   \n[0:31] viewer2: real'
    const messages = parseChatLog(log)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('real')
  })
})

// ── T-168 (5): the Smart highlight finder says why a chat log it cannot read is ignored ───────────────────────────────────────────────────────────────────────────────────
// The finder scores audio-only when the pasted log parses to nothing (Chat bar 0), and said nothing. It now prints the sentence the Chat spike finder prints, from here, so the two cannot
// drift. The panel shows it when the log is non-blank and parseChatLog gives []: these are the shapes a streamer pastes from other tools, and the one that is supported.
describe('CHAT_LOG_FORMAT_MESSAGE and the shapes parseChatLog cannot read (T-168 (5))', () => {
  it('the sentence is the Chat spike finder\'s, word for word', () => {
    expect(CHAT_LOG_FORMAT_MESSAGE).toBe(
      'No timestamped messages found. Each line should start like [12:34] username: message'
    )
  })

  it('the example the sentence gives is itself a line parseChatLog reads', () => {
    const example = CHAT_LOG_FORMAT_MESSAGE.split('start like ')[1] ?? ''
    expect(parseChatLog(example)).toEqual([{ tSec: 12 * 60 + 34, text: 'message' }])
  })

  it('a date-and-time stamp in brackets is not a timestamp it reads', () => {
    expect(parseChatLog('[2024-05-01 12:34:56] user: msg')).toEqual([])
  })

  it('a bare time with no brackets is not a timestamp it reads', () => {
    expect(parseChatLog('12:34 user: msg')).toEqual([])
  })

  it('control: a supported line parses, so the sentence is shown for the unsupported shapes only', () => {
    expect(parseChatLog('[12:34] user: msg')).toEqual([{ tSec: 754, text: 'msg' }])
  })
})
