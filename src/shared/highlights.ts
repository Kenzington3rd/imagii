import { assert } from './assert'
import type { ChatMessage } from './chatLog'
import { clipSpeed, type Clip } from './clip'

/**
 * Phase 4B: unified highlight scoring. Combines:
 *   - audio peaks (provided by main process via FFmpeg ebur128)
 *   - chat density (relative to median bucket size)
 *   - hype-keyword detection (Twitch-flavored emote/exclamation list)
 *
 * Each signal contributes a 0..1 normalized score; combinedScore is a
 * weighted average OF THE SIGNALS IN PLAY (T-92): with no chat log pasted
 * the chat weights have nothing to weigh, so the audio signal alone is the
 * whole average and a saturated peak scores 100, as the panel's "0-100"
 * promises. (It used to divide nothing: audio x 0.4 + 0 + 0 capped every
 * scan without chat at 40.) Per-signal scores stay attached to each
 * highlight so the UI can show *why* a moment was flagged — the AI clippers
 * do this and users find it persuasive.
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
 * What a streamer reads when no signal cleared its own threshold and the only
 * thing left to say is the scanner's own classification. The ids
 * ('sustained-loud') are the scanner's vocabulary, not the user's.
 */
const FALLBACK_REASON: Record<AudioCandidate['reason'], string> = {
  loud: 'Loud peak',
  'sustained-loud': 'Long loud stretch'
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
 * available. If chat is empty, chat-driven signals are 0 and the combined
 * score IS the audio score: the average is taken over the weights actually in
 * play, so the 0..1 scale (the panel's 0-100) is reachable without a chat log
 * (T-92). With chat present all three weights apply, as before.
 *
 * "Chat present" means there are messages, not that they scored — a log that
 * never mentions this moment is evidence the moment was quiet in chat, and
 * should weigh against it.
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
  const chatInPlay = chatMessages.length > 0
  const weightInPlay = chatInPlay
    ? weights.audio + weights.chatDensity + weights.hypeWord
    : weights.audio
  assert(weightInPlay > 0, 'the weights in play must add up to more than zero')
  const out: ScoredHighlight[] = []
  const len = audioCandidates.length
  for (let i = 0; i < len; i++) {
    // Typed on purpose: `assert(Array.isArray(...))` above narrows a readonly
    // array to `any[]`, which would make `c.reason` an `any` and let the
    // reason lookup below compile without proving the key is one of the two.
    const c: AudioCandidate | undefined = audioCandidates[i]
    if (!c) continue
    const window = messagesInWindow(chatMessages, c.startSec, c.endSec)
    const durationSec = Math.max(0.1, c.endSec - c.startSec)
    const msgsPerBucket = (window.length / durationSec) * 10
    const chatDensityScore =
      baseline > 0 ? Math.min(1, msgsPerBucket / (baseline * 4)) : 0
    const hypeCount = countHypeWords(window)
    const hypeWordScore = Math.min(1, hypeCount / 5)
    const audioScore = audioPeakToScore(c.peakDb)
    const weighted = chatInPlay
      ? audioScore * weights.audio +
        chatDensityScore * weights.chatDensity +
        hypeWordScore * weights.hypeWord
      : audioScore * weights.audio
    const combined = weighted / weightInPlay
    const reasons: string[] = []
    if (audioScore >= 0.6) reasons.push('Loud audio peak')
    if (chatDensityScore >= 0.5) reasons.push('Chat spike')
    if (hypeWordScore >= 0.4) reasons.push('Hype keywords')
    if (reasons.length === 0) reasons.push(FALLBACK_REASON[c.reason])
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
 * Phase 4C: hook quality. Score the opening N seconds of a clip on simple
 * heuristics and return a tier the UI can paint. Pure function; the FFmpeg
 * pass that produces audioEnergyDb lives in the main process.
 *
 * Thresholds were chosen against typical streaming audio:
 *   - >= -15 LUFS: peak-loud opening, strong attention hook
 *   - -25..-15 LUFS: average opening, viewer might bounce
 *   - <= -25 LUFS: quiet opening, vertical-short death sentence
 *
 * The audioEnergyDb arg is the *peak momentary loudness* in the opening
 * window (max M: value from ebur128). Speech-energy / motion / face
 * detection signals are intentionally deferred — they each need their own
 * FFmpeg pass and the audio signal alone is the dominant predictor of a
 * good vertical-clip hook.
 */

export type HookTier = 'high' | 'medium' | 'low'

export interface HookScore {
  tier: HookTier
  reasons: string[]
  audioEnergyDb: number
}

/** How much of a clip's OUTPUT the hook badge is about: the first three seconds a viewer sees. */
export const HOOK_OUTPUT_SEC = 3

/**
 * The shortest and longest stretch of the SOURCE the hook analysis will listen to, in
 * seconds — the gate in `video:analyzeClipHook` (main) takes exactly this range, and
 * the badge asks only for windows inside it (T-113). The minimum is also the shortest
 * OUTPUT a hook is rated for: under half a second there is nothing to hear.
 */
export const HOOK_MIN_SEC = 0.5
export const HOOK_MAX_SOURCE_SEC = 30

/**
 * The part of the source the hook badge listens to (T-112). A viewer's first
 * `HOOK_OUTPUT_SEC` are `HOOK_OUTPUT_SEC * speed` seconds of the source (output
 * time is source time over the speed — `clipSpeed`, the one reading of it), cut
 * short at the clip's own end so it never scores the loudness of a part of the
 * video the clip does not contain. `outputSec` is what that window comes to as
 * the viewer sees it (3, unless the clip is shorter).
 *
 * `null` when the clip has no hook to rate (T-113): its window, in source seconds or
 * as the viewer sees it, is under `HOOK_MIN_SEC`. The window used to floor at 0.1 s,
 * and main refuses anything under 0.5 s — so a clip of 0.3 s showed a "Hook…" badge
 * that died silently on the refusal. No window means no row, and nothing is asked.
 */
export function hookWindow(
  clip: Pick<Clip, 'startSec' | 'endSec' | 'speedMultiplier'>
): { sourceSec: number; outputSec: number } | null {
  const speed = clipSpeed(clip)
  const length = Math.max(0, clip.endSec - clip.startSec)
  const sourceSec = Math.min(HOOK_OUTPUT_SEC * speed, length, HOOK_MAX_SOURCE_SEC)
  const outputSec = sourceSec / speed
  return sourceSec >= HOOK_MIN_SEC && outputSec >= HOOK_MIN_SEC ? { sourceSec, outputSec } : null
}

/**
 * How long the hook badge waits, after the clip's start or window last changed, before it asks
 * (T-115). A drag of the start handle changes `startSec` on every mousemove and the speed slider
 * changes the window on every 0.05 tick, and each ask kills the running ffmpeg in main and starts
 * another, so the badge asks once the numbers have been still for this long - on the EXACT start
 * and window, so what it shows after the drag is what the trimmed clip is. (T-113 and T-114 keyed
 * the effect on whole seconds instead, which stopped the respawning and left the badge describing
 * a start up to half a second off until the next whole second: the upgrade this replaces.) A
 * quarter second is past the gap between a drag's mousemoves (~16 ms) and short enough that the
 * badge settles before the person has finished looking at the timeline. It is the wait for a
 * CHANGE: a badge's first ask (a clip selected, a studio re-entered) goes out at once.
 */
export const HOOK_DEBOUNCE_MS = 250

/**
 * What the hook badge asks main for: the exact start and window, or `null` when either is not
 * something main takes (T-115) - a start that is NaN, infinite or negative, a window under
 * `HOOK_MIN_SEC` or over `HOOK_MAX_SOURCE_SEC`. `video:analyzeClipHook` refuses those, and a
 * refusal the badge swallows is a spinner for nothing; no ask means no badge. The numbers are
 * passed through untouched: the badge is about the window the clip actually has.
 */
export function hookAsk(
  startSec: number,
  sourceSec: number
): { startSec: number; durationSec: number } | null {
  if (!Number.isFinite(startSec) || startSec < 0) return null
  if (!Number.isFinite(sourceSec) || sourceSec < HOOK_MIN_SEC || sourceSec > HOOK_MAX_SOURCE_SEC) {
    return null
  }
  return { startSec, durationSec: sourceSec }
}

export function scoreHookQuality(audioEnergyDb: number): HookScore {
  assert(Number.isFinite(audioEnergyDb), 'audioEnergyDb must be finite')
  if (audioEnergyDb >= -15) {
    return {
      tier: 'high',
      reasons: ['Loud, attention-grabbing opening'],
      audioEnergyDb
    }
  }
  if (audioEnergyDb >= -25) {
    return {
      tier: 'medium',
      reasons: ['Moderate energy in opening — fine for talking-head, weak for hype clips'],
      audioEnergyDb
    }
  }
  return {
    tier: 'low',
    reasons: ['Quiet opening — viewers tend to bounce on vertical short-form'],
    audioEnergyDb
  }
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
