import { assert } from './assert'
import type { ChatMessage } from './chatLog'

/**
 * Phase 4B: unified highlight scoring. Combines:
 *   - audio peaks (provided by main process via FFmpeg ebur128)
 *   - chat density (relative to median bucket size)
 *   - hype-keyword detection (Twitch-flavored emote/exclamation list)
 *
 * Each signal contributes a 0..1 normalized score; combinedScore is a
 * weighted average. Per-signal scores stay attached to each highlight so
 * the UI can show *why* a moment was flagged — the AI clippers do this and
 * users find it persuasive.
 *
 * Signals deferred to a future round (would each need a separate FFmpeg
 * pass): speech-energy peaks (astats), scene-change frequency (scdet).
 */

export interface AudioCandidate {
  startSec: number
  endSec: number
  peakDb: number
  reason: 'loud' | 'sustained-loud'
}

export interface HighlightSignals {
  audioScore: number
  chatDensityScore: number
  hypeWordScore: number
}

export interface ScoredHighlight {
  startSec: number
  endSec: number
  signals: HighlightSignals
  combinedScore: number
  reasons: string[]
  topChatMessages: string[]
  /** Raw audio peak in LUFS, when this candidate was sourced from audio. */
  peakDb?: number
}

export interface ScoringWeights {
  audio: number
  chatDensity: number
  hypeWord: number
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  audio: 0.4,
  chatDensity: 0.4,
  hypeWord: 0.2
}

/**
 * Twitch-flavored hype keyword list. Case-insensitive; whole-word matches
 * (with word-boundary tolerance for emote-style "POGGERS"). The list is
 * deliberately small — over-broad matches dilute the signal.
 */
export const HYPE_KEYWORDS: readonly string[] = [
  'pog',
  'poggers',
  'pogchamp',
  'kekw',
  'lul',
  'lulw',
  'lmao',
  'lol',
  'omg',
  'wtf',
  'holy',
  'insane',
  'noway',
  'no way',
  'clip',
  'clipped',
  'clip it',
  'clip that',
  'actual'
]

const HYPE_RE = new RegExp(
  '\\b(' + HYPE_KEYWORDS.map((k) => k.replace(/\s+/g, '\\s+')).join('|') + ')\\b',
  'gi'
)

/** Count hype-keyword occurrences across a list of messages. */
export function countHypeWords(messages: readonly ChatMessage[]): number {
  assert(Array.isArray(messages), 'countHypeWords expects an array')
  // Bound iteration to message count captured at loop start (PoT rule 2).
  let count = 0
  const len = messages.length
  for (let i = 0; i < len; i++) {
    const text = messages[i]?.text ?? ''
    const matches = text.match(HYPE_RE)
    count += matches ? matches.length : 0
  }
  return count
}

/** Median of a numeric array. Returns 0 if empty. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted[mid] ?? 0
}

/**
 * Map dB peak (typically -23..0 LUFS for human speech extremes) onto 0..1.
 * Peaks above -10 LUFS are saturated at 1; -40 LUFS or quieter is 0.
 */
export function audioPeakToScore(peakDb: number): number {
  assert(Number.isFinite(peakDb), 'peakDb must be finite')
  if (peakDb >= -10) return 1
  if (peakDb <= -40) return 0
  return (peakDb + 40) / 30
}

/**
 * Filter messages to those whose timestamp falls inside [start, end].
 * Bounded by messages.length.
 */
function messagesInWindow(
  messages: readonly ChatMessage[],
  startSec: number,
  endSec: number
): ChatMessage[] {
  const out: ChatMessage[] = []
  const len = messages.length
  for (let i = 0; i < len; i++) {
    const m = messages[i]
    if (!m) continue
    if (m.tSec >= startSec && m.tSec <= endSec) out.push(m)
  }
  return out
}

/**
 * For each audio candidate, compute combined signals using chat data when
 * available. If chat is empty, chat-driven signals are 0 and combined
 * score collapses to the audio score (still useful — preserves the old
 * audio-only behavior as a strict subset).
 *
 * The bound on the outer loop is candidates.length, captured at start.
 */
export function scoreHighlights(
  audioCandidates: readonly AudioCandidate[],
  chatMessages: readonly ChatMessage[],
  weights: ScoringWeights = DEFAULT_WEIGHTS
): ScoredHighlight[] {
  assert(Array.isArray(audioCandidates), 'audioCandidates must be an array')
  assert(Array.isArray(chatMessages), 'chatMessages must be an array')
  // Establish a chat-density baseline (msgs per 10s bucket) over the
  // entire chat span so per-window density can be normalized.
  const baseline = chatDensityMedian(chatMessages, 10)
  const out: ScoredHighlight[] = []
  const len = audioCandidates.length
  for (let i = 0; i < len; i++) {
    const c = audioCandidates[i]
    if (!c) continue
    const window = messagesInWindow(chatMessages, c.startSec, c.endSec)
    const durationSec = Math.max(0.1, c.endSec - c.startSec)
    const msgsPerBucket = (window.length / durationSec) * 10
    const chatDensityScore =
      baseline > 0 ? Math.min(1, msgsPerBucket / (baseline * 4)) : 0
    const hypeCount = countHypeWords(window)
    const hypeWordScore = Math.min(1, hypeCount / 5)
    const audioScore = audioPeakToScore(c.peakDb)
    const combined =
      audioScore * weights.audio +
      chatDensityScore * weights.chatDensity +
      hypeWordScore * weights.hypeWord
    const reasons: string[] = []
    if (audioScore >= 0.6) reasons.push('loud audio peak')
    if (chatDensityScore >= 0.5) reasons.push('chat spike')
    if (hypeWordScore >= 0.4) reasons.push('hype keywords')
    if (reasons.length === 0) reasons.push(c.reason)
    out.push({
      startSec: c.startSec,
      endSec: c.endSec,
      signals: {
        audioScore,
        chatDensityScore,
        hypeWordScore
      },
      combinedScore: combined,
      reasons,
      topChatMessages: window.slice(0, 3).map((m) => m.text),
      peakDb: c.peakDb
    })
  }
  return out.sort((a, b) => b.combinedScore - a.combinedScore)
}

/**
 * Median number of messages per bucket of size `bucketSec`. Internal helper.
 * Returns 0 when chat is empty or when all messages collapse into a single
 * bucket (in which case "median" isn't meaningful).
 */
function chatDensityMedian(messages: readonly ChatMessage[], bucketSec: number): number {
  assert(bucketSec > 0, 'bucketSec must be positive')
  if (messages.length === 0) return 0
  const buckets = new Map<number, number>()
  const len = messages.length
  for (let i = 0; i < len; i++) {
    const m = messages[i]
    if (!m) continue
    const k = Math.floor(m.tSec / bucketSec) * bucketSec
    buckets.set(k, (buckets.get(k) ?? 0) + 1)
  }
  if (buckets.size < 2) return 0
  return median([...buckets.values()])
}
