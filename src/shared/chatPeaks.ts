import type { ChatMessage } from './chatLog'

/**
 * The chat spike finder's arithmetic (T-135 (3)), lifted out of the panel so it can be driven without a DOM.
 *
 * A pasted chat log is cut into fixed buckets; a bucket with at least twice the median count (and at least 5 messages) is a spike, and
 * spike buckets that sit EXACTLY next to each other are one spike: one explosion of chat 30 s long is one row, not three rows that overlap by
 * 30 s and fill the 12-row cap with near-duplicates. The merge is decided on the buckets' own positions (the unpadded keys): the panel used to
 * compare the next bucket's key with the previous row's PADDED start, so with the defaults (10 s buckets, 15 s of padding) adjacent buckets read
 * 25 < 20 = false and nothing ever merged. The window of a row runs from the first bucket less the padding to the last bucket's end plus the
 * padding, so a merged row covers all of its buckets.
 *
 * T-136 (9): a row is ranked by its DENSEST bucket, not by its summed count. Ranked by the sum, a long, moderately busy run (a raid: twenty buckets of
 * 6 messages, 120 in all) outranked a short explosion (15 messages in one bucket) and took its place when the 12-row cap forced a choice; the densest
 * bucket is what a spike IS (the threshold is about a bucket too). Rows that tie on it rank by their total, then keep time order. `count` stays the
 * total, for the row's "N messages". The extra seconds are clamped here to 0..60 (`MAX_CHAT_PAD_SEC`, the box's own limit): a negative number made a
 * window of zero length or less.
 */

export interface ChatPeak {
  /** Where the clip starts: the first spike bucket less the padding, never before 0. */
  startSec: number
  /** Where it ends: the last spike bucket's end plus the padding. Not clamped to the video here - the caller knows the video. */
  endSec: number
  /** Messages in the spike bucket(s): the row's total, not the rank. */
  count: number
  /** A few of the messages, for the row's preview. */
  topMessages: string[]
}

/** The most rows the panel lists: the biggest spikes, in time order. */
export const MAX_CHAT_PEAKS = 12

/** A bucket is a spike at no fewer than this many messages, whatever the median says. */
export const MIN_SPIKE_MESSAGES = 5

/** A log needs messages in at least this many different buckets: with fewer there is no usual bucket to compare a busy one with. */
export const MIN_SPIKE_WINDOWS = 3

/** The most extra seconds around a clip (the box's `max`), clamped in `findChatPeaks` as the box clamps what is typed. */
export const MAX_CHAT_PAD_SEC = 60

/**
 * What the panel says when a log was analyzed and holds no spike: the rule, in the same numbers `findChatPeaks` uses. (A line that appears under
 * the button and stays, where the 4 s "No chat spikes detected" toast leaves a panel that looks as if it had not been run.)
 */
export const NO_CHAT_SPIKES_MESSAGE =
  `No chat spikes found. A spike is a window with at least ${MIN_SPIKE_MESSAGES} messages and twice as many as a usual window, ` +
  `and the log needs messages in at least ${MIN_SPIKE_WINDOWS} different windows to compare.`

interface Group {
  firstIdx: number
  lastIdx: number
  count: number
  /** The most messages in any one bucket of the group: what ranks it. */
  peakCount: number
  topMessages: string[]
}

export function findChatPeaks(msgs: ChatMessage[], bucketSec: number, padInput: number): ChatPeak[] {
  if (msgs.length === 0) return []
  const padSec = Number.isNaN(padInput) ? 0 : Math.min(MAX_CHAT_PAD_SEC, Math.max(0, padInput))
  // Buckets are numbered, not keyed by their start time: two neighbours are `index + 1`, which a float difference between two keys of a
  // fractional bucket width ("4.3 s": 12.899999999999999 and 17.2 differ by 4.300000000000001) cannot say reliably.
  const buckets = new Map<number, ChatMessage[]>()
  for (const m of msgs) {
    const idx = Math.floor(m.tSec / bucketSec)
    const arr = buckets.get(idx) ?? []
    arr.push(m)
    buckets.set(idx, arr)
  }
  const counts = [...buckets.values()].map((arr) => arr.length)
  if (counts.length < MIN_SPIKE_WINDOWS) return []
  counts.sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] ?? 0
  const threshold = Math.max(median * 2, MIN_SPIKE_MESSAGES)

  const spikes = [...buckets.entries()].filter(([, arr]) => arr.length >= threshold).sort((a, b) => a[0] - b[0])

  const groups: Group[] = []
  for (const [idx, arr] of spikes) {
    const last = groups[groups.length - 1]
    if (last && idx - last.lastIdx <= 1) {
      last.lastIdx = idx
      last.count += arr.length
      last.peakCount = Math.max(last.peakCount, arr.length)
      last.topMessages.push(...arr.slice(0, 2).map((m) => m.text))
    } else {
      groups.push({ firstIdx: idx, lastIdx: idx, count: arr.length, peakCount: arr.length, topMessages: arr.slice(0, 3).map((m) => m.text) })
    }
  }

  // `Array.prototype.sort` is stable: rows that tie on both keys stay in time order, so the cap drops the later of two equals.
  return groups
    .sort((a, b) => b.peakCount - a.peakCount || b.count - a.count)
    .slice(0, MAX_CHAT_PEAKS)
    .map((g) => ({
      startSec: Math.max(0, g.firstIdx * bucketSec - padSec),
      endSec: g.lastIdx * bucketSec + bucketSec + padSec,
      count: g.count,
      topMessages: g.topMessages
    }))
    .sort((a, b) => a.startSec - b.startSec)
}
