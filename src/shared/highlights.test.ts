import { describe, it, expect } from 'vitest'
import {
  audioPeakToScore,
  countHypeWords,
  DEFAULT_WEIGHTS,
  HOOK_MAX_SOURCE_SEC,
  HOOK_MIN_SEC,
  HOOK_OUTPUT_SEC,
  HYPE_KEYWORDS,
  hookAsk,
  hookWindow,
  HOOK_DEBOUNCE_MS,
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

/**
 * T-112 — "First 3 s" is three seconds of what the viewer SEES.
 *
 * The badge analyzed 3 source seconds from the clip's start whatever its speed. At
 * 2x the viewer's first 3 seconds are 6 source seconds, and a hook that is loud in
 * seconds 3-6 of the range was scored as if it did not exist (and the other way
 * round at 0.5x, where the first 3 output seconds are only 1.5 source seconds).
 * Output time is source time over the speed, so the window to analyze is the
 * output length TIMES the speed.
 */
describe('hookWindow — three output seconds, in source seconds (T-112)', () => {
  const clip = (speedMultiplier?: number, length = 60) => ({ startSec: 10, endSec: 10 + length, speedMultiplier })

  it('is 3 seconds at 1x, and 3 seconds when no speed is set', () => {
    expect(HOOK_OUTPUT_SEC).toBe(3)
    expect(hookWindow(clip(1))).toEqual({ sourceSec: 3, outputSec: 3 })
    expect(hookWindow(clip())).toEqual({ sourceSec: 3, outputSec: 3 })
  })

  it('a faster clip shows more of the source in its first 3 seconds, a slower one less', () => {
    expect(hookWindow(clip(2))?.sourceSec).toBe(6)
    expect(hookWindow(clip(4))?.sourceSec).toBe(12)
    expect(hookWindow(clip(0.5))?.sourceSec).toBe(1.5)
    expect(hookWindow(clip(0.25))?.sourceSec).toBe(0.75)
    for (const speed of [0.25, 0.5, 1, 1.5, 2, 4]) {
      expect(hookWindow(clip(speed))?.outputSec, `${speed}x`).toBeCloseTo(3, 10)
    }
  })

  it('reads a speed that means nothing as 1x, the way the encoder does', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hookWindow(clip(bad))?.sourceSec, String(bad)).toBe(3)
    }
  })

  it('never reaches past the end of the clip — the loudness of a different part of the video is not its hook', () => {
    // 4 s of source at 4x is a 1 s clip: the whole range, and a first "3 seconds" of 1.
    expect(hookWindow(clip(4, 4))).toEqual({ sourceSec: 4, outputSec: 1 })
    expect(hookWindow(clip(1, 2))).toEqual({ sourceSec: 2, outputSec: 2 })
  })

  it('stays inside what main will analyze, and a clip too short to have a hook has none (T-113)', () => {
    // T-113: the window used to floor at 0.1 s while the gate in `video:analyzeClipHook` takes
    // 0.5-30 s, so a 0.3 s clip showed a "Hook…" spinner that died silently on the refusal.
    // A clip whose first seconds are under half a second has no hook to rate: no window at all.
    expect(hookWindow({ startSec: 5, endSec: 5, speedMultiplier: 1 })).toBeNull()
    expect(hookWindow({ startSec: 9, endSec: 5, speedMultiplier: 1 })).toBeNull()
    expect(hookWindow(clip(1, 0.3))).toBeNull()
    expect(hookWindow(clip(1, 0.49))).toBeNull()
    expect(hookWindow(clip(1, 0.5))).toEqual({ sourceSec: 0.5, outputSec: 0.5 })
    expect(hookWindow(clip(4, 3600))?.sourceSec).toBeLessThanOrEqual(30)
  })

  it('judges the OUTPUT length: 1.5 s of source at 4x plays for under half a second, so no hook', () => {
    expect(hookWindow(clip(4, 1.9))).toBeNull() // 0.475 s out
    expect(hookWindow(clip(4, 2))).toEqual({ sourceSec: 2, outputSec: 0.5 })
  })

  it('a slow clip is judged on its source window too: 0.45 s of source at 0.5x plays for 0.9 s, but main will not analyze 0.45 s', () => {
    expect(hookWindow(clip(0.5, 0.45))).toBeNull()
    expect(hookWindow(clip(0.5, 0.5))).toEqual({ sourceSec: 0.5, outputSec: 1 })
  })

  it('every window it hands back is one the gate takes — the badge cannot be refused', () => {
    // The gate: HOOK_MIN_SEC <= window <= HOOK_MAX_SOURCE_SEC source seconds. Walk lengths and
    // every speed the slider offers; a window is either absent or inside it.
    for (const speed of [0.25, 0.5, 1, 1.5, 2, 3, 4]) {
      for (const length of [0, 0.05, 0.2, 0.49, 0.5, 0.75, 1, 2, 3, 5, 30, 600, 7200]) {
        const w = hookWindow({ startSec: 10, endSec: 10 + length, speedMultiplier: speed })
        if (w === null) continue
        expect(w.sourceSec, `${length} s at ${speed}x`).toBeGreaterThanOrEqual(HOOK_MIN_SEC)
        expect(w.sourceSec, `${length} s at ${speed}x`).toBeLessThanOrEqual(HOOK_MAX_SOURCE_SEC)
        expect(w.outputSec, `${length} s at ${speed}x`).toBeGreaterThanOrEqual(HOOK_MIN_SEC)
      }
    }
  })
})

/**
 * T-115 — the badge asks for the EXACT start and window, once they stop changing.
 *
 * The history, because each step is why the next exists. T-113: the speed slider moves in 0.05
 * steps, a window is 3 x the speed, and the effect was keyed on that number, so every tick killed the
 * running ffmpeg and started another (75 times across the slider's range). T-114: a drag of the start
 * handle changed `startSec` on every mousemove, the same bug from the other handle. Both were fixed
 * by keying the effect on whole seconds (`hookWindowKey`), which stopped the respawning and made the
 * badge describe a start up to half a second away, indefinitely - the final badge after a drag could
 * be a whole second stale. A trailing debounce on the exact numbers (`HOOK_DEBOUNCE_MS`, applied in
 * `HookIndicator`) bounds the asks the same way and leaves nothing stale: the badge always describes
 * the window the clip has once the person stops moving. What is testable without a DOM is the pair of
 * facts the effect rests on - what it asks for (`hookAsk`), and how long it waits; the timing itself
 * is driven in the E2E ("dragging the start handle asks once, after it settles, with the exact
 * start").
 */
describe('hookAsk and HOOK_DEBOUNCE_MS — the exact window, once the drag settles (T-115)', () => {
  it('asks for the EXACT start and window - never a rounded one', () => {
    expect(hookAsk(12.37, 3.45)).toEqual({ startSec: 12.37, durationSec: 3.45 })
    expect(hookAsk(0.4, 3)).toEqual({ startSec: 0.4, durationSec: 3 })
    expect(hookAsk(0, 0.5)).toEqual({ startSec: 0, durationSec: 0.5 })
    // The old key rounded 12.49 and 12.51 to different seconds and 12.4 and 12.0 to the same one;
    // the ask keeps all of them apart.
    expect(hookAsk(12.4, 3)?.startSec).not.toBe(hookAsk(12, 3)?.startSec)
  })

  it('every start of a drag and every tick of the speed slider is a distinct, exact ask (the debounce bounds them, not the numbers)', () => {
    const starts = Array.from({ length: 61 }, (_, i) => Math.round(i * 0.05 * 100) / 100)
    expect(new Set(starts.map((start) => hookAsk(start, 3)?.startSec)).size).toBe(61)
    const ticks = Array.from({ length: 76 }, (_, i) => Math.round((0.25 + i * 0.05) * 100) / 100)
    const windows = ticks.map((speed) => (hookWindow({ startSec: 0, endSec: 600, speedMultiplier: speed }) as { sourceSec: number }).sourceSec)
    expect(new Set(windows.map((w) => hookAsk(0, w)?.durationSec)).size).toBe(76)
  })

  it.each([
    ['NaN', Number.NaN],
    ['negative', -2],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY]
  ])('a start that is %s asks for nothing - main would refuse it', (_label, start) => {
    expect(hookAsk(start, 3)).toBeNull()
  })

  it('a window main would refuse asks for nothing: under HOOK_MIN_SEC, over HOOK_MAX_SOURCE_SEC, or not a number', () => {
    expect(hookAsk(0, HOOK_MIN_SEC - 0.01)).toBeNull()
    expect(hookAsk(0, 0)).toBeNull()
    expect(hookAsk(0, -1)).toBeNull()
    expect(hookAsk(0, HOOK_MAX_SOURCE_SEC + 0.01)).toBeNull()
    expect(hookAsk(0, Number.NaN)).toBeNull()
    expect(hookAsk(0, Number.POSITIVE_INFINITY)).toBeNull()
    // The bounds are the gate's, inclusive.
    expect(hookAsk(0, HOOK_MIN_SEC)).not.toBeNull()
    expect(hookAsk(0, HOOK_MAX_SOURCE_SEC)).not.toBeNull()
  })

  it('every window hookWindow hands back, at any usable start, is one the badge may ask for', () => {
    for (const speed of [0.25, 1, 1.05, 2, 4]) {
      for (const length of [0.5, 1, 3, 30, 600]) {
        for (const start of [0, 0.4, 12.37, 3599.9]) {
          const w = hookWindow({ startSec: start, endSec: start + length, speedMultiplier: speed })
          if (w === null) continue
          expect(hookAsk(start, w.sourceSec), `${length} s at ${speed}x from ${start}`).not.toBeNull()
        }
      }
    }
  })

  it('waits a quarter second: past a drag\'s mousemoves (about 16 ms apart), well inside the time a person waits for a badge', () => {
    expect(HOOK_DEBOUNCE_MS).toBe(250)
    // The two bounds the number lives between - a drag pauses for longer than a frame before it
    // is over, and a badge that took over half a second to appear would read as broken.
    expect(HOOK_DEBOUNCE_MS).toBeGreaterThan(100)
    expect(HOOK_DEBOUNCE_MS).toBeLessThan(500)
  })
})
