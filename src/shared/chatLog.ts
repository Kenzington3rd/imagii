import { assert } from './assert'

/**
 * Phase 4B: shared chat-log parser. Used by both ChatHighlightPanel
 * (chat-density-only highlight panel) and the unified highlight scorer.
 *
 * Accepts the common Twitch chat log line format:
 *   [hh:mm:ss] username: message
 *   [mm:ss] username: message
 *   [mm:ss.fff] username: message
 *   [mm:ss,fff] <username> message
 */

export interface ChatMessage {
  tSec: number
  text: string
}

const CHAT_LINE_RE =
  /^\[(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]\s*(?:<[^>]+>|[\w-]+:?)\s*(.*)$/

/** Parse a "[hh:mm:ss[.fff]]" or "[mm:ss[.fff]]" timestamp to seconds. */
export function parseTimestampToSec(ts: string): number {
  assert(typeof ts === 'string', 'parseTimestampToSec expects a string')
  if (ts.length === 0) return 0
  let h = 0
  let m = 0
  let s = 0
  let frac = 0
  if (ts.includes(':')) {
    const main = ts.split(/[.,]/)[0] ?? ts
    const segs = main.split(':').map((p) => Number(p) || 0)
    if (segs.length === 3) {
      h = segs[0] ?? 0
      m = segs[1] ?? 0
      s = segs[2] ?? 0
    } else if (segs.length === 2) {
      m = segs[0] ?? 0
      s = segs[1] ?? 0
    }
    if (ts.includes('.') || ts.includes(',')) {
      const fracPart = ts.split(/[.,]/)[1]
      if (fracPart) frac = Number(`0.${fracPart}`)
    }
  } else {
    s = Number(ts) || 0
  }
  return h * 3600 + m * 60 + s + frac
}

/**
 * Parse a chat log into timestamped messages. Power-of-Ten rule 2:
 * the iteration is bounded by the number of input lines.
 */
export function parseChatLog(input: string): ChatMessage[] {
  assert(typeof input === 'string', 'parseChatLog expects a string')
  const lines = input.split(/\r?\n/)
  // Defensive cap so a pathological 100M-line paste can't run unbounded.
  assert(lines.length < 1_000_000, 'chat log too large to parse safely')
  const msgs: ChatMessage[] = []
  for (const line of lines) {
    const match = line.match(CHAT_LINE_RE)
    if (!match) continue
    const ts = match[1]
    if (!ts) continue
    const tSec = parseTimestampToSec(ts)
    const text = match[2]?.trim() ?? ''
    if (text.length === 0) continue
    msgs.push({ tSec, text })
  }
  return msgs
}
