import { describe, it, expect } from 'vitest'
import {
  audioPeakToScore,
  countHypeWords,
  DEFAULT_WEIGHTS,
  HYPE_KEYWORDS,
  scoreHighlights,
  type AudioCandidate
} from './highlights'
import type { ChatMessage } from './chatLog'

describe('audioPeakToScore', () => {
  it('saturates at 1 for peaks above -10 LUFS', () => {
    expect(audioPeakToScore(0)).toBe(1)
    expect(audioPeakToScore(-5)).toBe(1)
    expect(audioPeakToScore(-10)).toBe(1)
  })
  it('returns 0 for peaks at or below -40 LUFS', () => {
    expect(audioPeakToScore(-40)).toBe(0)
    expect(audioPeakToScore(-60)).toBe(0)
  })
  it('linearly interpolates between -40 and -10', () => {
    expect(audioPeakToScore(-25)).toBeCloseTo(0.5, 2)
    expect(audioPeakToScore(-30)).toBeCloseTo(0.333, 2)
  })
})

describe('countHypeWords', () => {
  it('counts case-insensitive hype keywords across messages', () => {
    const messages: ChatMessage[] = [
      { tSec: 1, text: 'POG' },
      { tSec: 2, text: 'lmao that was insane' },
      { tSec: 3, text: 'just a normal message' }
    ]
    // 'POG' = 1 + 'lmao' = 1 + 'insane' = 1 = 3
    expect(countHypeWords(messages)).toBe(3)
  })

  it('counts multi-word phrases like "no way" and "clip it"', () => {
    const messages: ChatMessage[] = [
      { tSec: 1, text: 'no way that just happened' },
      { tSec: 2, text: 'CLIP IT now' }
    ]
    expect(countHypeWords(messages)).toBeGreaterThanOrEqual(2)
  })

  it('returns 0 on empty input', () => {
    expect(countHypeWords([])).toBe(0)
  })

  it('exposes the keyword list', () => {
    expect(HYPE_KEYWORDS.length).toBeGreaterThan(5)
    expect(HYPE_KEYWORDS).toContain('pog')
  })
})

describe('scoreHighlights — audio-only baseline', () => {
  const audioCandidates: AudioCandidate[] = [
    { startSec: 10, endSec: 20, peakDb: -8, reason: 'loud' },
    { startSec: 30, endSec: 40, peakDb: -25, reason: 'sustained-loud' }
  ]

  it('scores correctly when chat is empty (subset of old behavior)', () => {
    const result = scoreHighlights(audioCandidates, [])
    expect(result).toHaveLength(2)
    // Loud peak (-8 LUFS) should beat the quieter one (-25 LUFS)
    expect(result[0]?.startSec).toBe(10)
    expect(result[0]?.signals.audioScore).toBe(1)
    expect(result[0]?.signals.chatDensityScore).toBe(0)
    expect(result[0]?.signals.hypeWordScore).toBe(0)
    // Combined = audio * 0.4 + 0 + 0 = 0.4
    expect(result[0]?.combinedScore).toBeCloseTo(DEFAULT_WEIGHTS.audio, 6)
  })

  it('returns empty list when no audio candidates', () => {
    expect(scoreHighlights([], [])).toEqual([])
  })

  it('attaches at least one reason to each highlight', () => {
    const result = scoreHighlights(audioCandidates, [])
    for (const h of result) {
      expect(h.reasons.length).toBeGreaterThan(0)
    }
  })
})

describe('scoreHighlights — multi-signal', () => {
  it('boosts a candidate when chat is heavy + hype keywords are present', () => {
    const audio: AudioCandidate[] = [
      { startSec: 10, endSec: 20, peakDb: -25, reason: 'loud' }
    ]
    // Build a baseline of low-density chat + a heavy chat burst inside the window
    const baseline: ChatMessage[] = []
    for (let t = 0; t < 600; t += 30) {
      baseline.push({ tSec: t, text: 'normal chat' })
    }
    const burst: ChatMessage[] = [
      { tSec: 11, text: 'POG' },
      { tSec: 11.5, text: 'POGGERS' },
      { tSec: 12, text: 'NO WAY' },
      { tSec: 12.5, text: 'CLIP IT' },
      { tSec: 13, text: 'LMAO' },
      { tSec: 14, text: 'KEKW insane' },
      { tSec: 15, text: 'holy' },
      { tSec: 16, text: 'wtf' }
    ]
    const result = scoreHighlights(audio, [...baseline, ...burst])
    expect(result).toHaveLength(1)
    const h = result[0]
    expect(h?.signals.chatDensityScore).toBeGreaterThan(0.4)
    expect(h?.signals.hypeWordScore).toBeGreaterThan(0.5)
    expect(h?.combinedScore).toBeGreaterThan(0.3)
    expect(h?.reasons).toContain('chat spike')
    expect(h?.reasons).toContain('hype keywords')
  })

  it('keeps signals when chat is plenty but audio is weak', () => {
    const audio: AudioCandidate[] = [
      { startSec: 100, endSec: 110, peakDb: -45, reason: 'loud' }
    ]
    // Need baseline outside the window so chatDensityMedian sees ≥2 buckets
    const chat: ChatMessage[] = []
    for (let t = 0; t < 90; t += 30) chat.push({ tSec: t, text: 'baseline' })
    for (let t = 100; t < 110; t += 0.5) chat.push({ tSec: t, text: 'POG' })
    const result = scoreHighlights(audio, chat)
    expect(result).toHaveLength(1)
    expect(result[0]?.signals.audioScore).toBe(0)
    expect(result[0]?.signals.chatDensityScore).toBeGreaterThan(0)
    expect(result[0]?.signals.hypeWordScore).toBeGreaterThan(0)
  })

  it('sorts by combined score descending', () => {
    const audio: AudioCandidate[] = [
      { startSec: 0, endSec: 10, peakDb: -30, reason: 'loud' },
      { startSec: 100, endSec: 110, peakDb: -8, reason: 'loud' },
      { startSec: 200, endSec: 210, peakDb: -20, reason: 'loud' }
    ]
    const result = scoreHighlights(audio, [])
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i]
      const b = result[i + 1]
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      if (a && b) expect(a.combinedScore).toBeGreaterThanOrEqual(b.combinedScore)
    }
  })

  it('attaches up to 3 top chat messages from each highlight window', () => {
    const audio: AudioCandidate[] = [
      { startSec: 0, endSec: 10, peakDb: -10, reason: 'loud' }
    ]
    const chat: ChatMessage[] = [
      { tSec: 1, text: 'first' },
      { tSec: 2, text: 'second' },
      { tSec: 3, text: 'third' },
      { tSec: 4, text: 'fourth' }
    ]
    const result = scoreHighlights(audio, chat)
    expect(result[0]?.topChatMessages).toEqual(['first', 'second', 'third'])
  })
})
