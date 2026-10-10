import { describe, it, expect } from 'vitest'
import {
  audioPeakToScore,
  countHypeWords,
  DEFAULT_WEIGHTS,
  HYPE_KEYWORDS,
  scoreHighlights,
  scoreHookQuality,
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
    // T-92: with no chat, audio is the only signal in play, so a saturated
    // peak is a full 1 (the panel says "0-100"), not audio x 0.4 = 40.
    expect(result[0]?.combinedScore).toBeCloseTo(1, 6)
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

describe('scoreHighlights — the 0-100 the header promises (T-92)', () => {
  const loud: AudioCandidate = { startSec: 10, endSec: 20, peakDb: -8, reason: 'loud' }

  it('an audio-only moment scores by its audio alone, so the loudest reaches 1', () => {
    const [only] = scoreHighlights([loud], [])
    expect(only?.combinedScore).toBeCloseTo(1, 6)
  })

  it('an audio-only score is the audio signal itself at every loudness', () => {
    for (const peakDb of [-45, -40, -32, -25, -18, -10, -3]) {
      const [h] = scoreHighlights([{ ...loud, peakDb }], [])
      expect(h?.combinedScore, `peak ${peakDb}`).toBeCloseTo(h?.signals.audioScore ?? NaN, 6)
    }
  })

  it('the old audio-only score was capped at the audio weight (the bug)', () => {
    // Before T-92 combined = audio x 0.4 + 0 + 0, so no scan without a chat
    // log could show more than 40. Pin the new ceiling against the old one.
    const [h] = scoreHighlights([loud], [])
    const oldScore = (h?.signals.audioScore ?? 0) * DEFAULT_WEIGHTS.audio
    expect(oldScore).toBeCloseTo(0.4, 6)
    expect(h?.combinedScore).toBeGreaterThan(oldScore * 2)
  })

  it('with chat present the three weights still apply as before', () => {
    const chat: ChatMessage[] = []
    for (let t = 0; t < 90; t += 30) chat.push({ tSec: t, text: 'baseline' })
    for (let t = 10; t < 20; t += 0.5) chat.push({ tSec: t, text: 'POG' })
    const [h] = scoreHighlights([loud], chat)
    const s = h?.signals
    expect(s?.chatDensityScore).toBeGreaterThan(0)
    expect(h?.combinedScore).toBeCloseTo(
      ((s?.audioScore ?? 0) * 0.4 + (s?.chatDensityScore ?? 0) * 0.4 + (s?.hypeWordScore ?? 0) * 0.2) /
        (0.4 + 0.4 + 0.2),
      6
    )
  })

  it('a chat log that scores nothing still counts as chat: the weights do not collapse', () => {
    // Chat is "in play" when there are messages, not when they scored.
    const quiet: ChatMessage[] = [{ tSec: 500, text: 'unrelated' }]
    const [h] = scoreHighlights([loud], quiet)
    expect(h?.combinedScore).toBeCloseTo(0.4, 6)
  })

  it('never exceeds 1, even with weights that do not sum to 1', () => {
    const [h] = scoreHighlights([loud], [], { audio: 2, chatDensity: 3, hypeWord: 5 })
    expect(h?.combinedScore).toBeLessThanOrEqual(1)
    expect(h?.combinedScore).toBeCloseTo(1, 6)
  })

  it('rejects weights that cannot be normalized', () => {
    expect(() => scoreHighlights([loud], [], { audio: 0, chatDensity: 0, hypeWord: 0 })).toThrow()
  })
})

describe('scoreHighlights — reasons in plain words (T-92)', () => {
  it('the fallback reason is a phrase a streamer would say, never the internal id', () => {
    // Quiet enough that no signal clears its reason threshold.
    const quiet: AudioCandidate[] = [
      { startSec: 0, endSec: 10, peakDb: -38, reason: 'sustained-loud' },
      { startSec: 50, endSec: 60, peakDb: -38, reason: 'loud' }
    ]
    const reasons = scoreHighlights(quiet, []).flatMap((h) => h.reasons)
    expect(reasons).toContain('Long loud stretch')
    expect(reasons).toContain('Loud peak')
    for (const r of reasons) expect(r).not.toMatch(/sustained-loud|^loud$/)
  })

  it('every reason starts with a capital (sentence case)', () => {
    const chat: ChatMessage[] = []
    for (let t = 0; t < 600; t += 30) chat.push({ tSec: t, text: 'normal chat' })
    for (let t = 10; t < 20; t += 0.5) chat.push({ tSec: t, text: 'POGGERS no way' })
    const all = scoreHighlights([{ startSec: 10, endSec: 20, peakDb: -8, reason: 'loud' }], chat)
    const reasons = all.flatMap((h) => h.reasons)
    expect(reasons.length).toBeGreaterThan(1)
    for (const r of reasons) expect(r[0]).toBe(r[0]?.toUpperCase())
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
    expect(h?.reasons).toContain('Chat spike')
    expect(h?.reasons).toContain('Hype keywords')
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

describe('scoreHookQuality — Phase 4C', () => {
  it('returns "high" tier for loud openings', () => {
    expect(scoreHookQuality(-5).tier).toBe('high')
    expect(scoreHookQuality(-15).tier).toBe('high')
  })
  it('returns "medium" tier for moderate openings', () => {
    expect(scoreHookQuality(-16).tier).toBe('medium')
    expect(scoreHookQuality(-20).tier).toBe('medium')
    expect(scoreHookQuality(-25).tier).toBe('medium')
  })
  it('returns "low" tier for quiet openings', () => {
    expect(scoreHookQuality(-26).tier).toBe('low')
    expect(scoreHookQuality(-50).tier).toBe('low')
  })
  it('attaches a non-empty reason for each tier', () => {
    expect(scoreHookQuality(-5).reasons.length).toBeGreaterThan(0)
    expect(scoreHookQuality(-20).reasons.length).toBeGreaterThan(0)
    expect(scoreHookQuality(-50).reasons.length).toBeGreaterThan(0)
  })
  it('echoes the input audioEnergyDb in the result', () => {
    expect(scoreHookQuality(-12.345).audioEnergyDb).toBe(-12.345)
  })
})
