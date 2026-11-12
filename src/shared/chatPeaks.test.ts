import { describe, it, expect } from 'vitest'
import { MAX_CHAT_PAD_SEC, MAX_CHAT_PEAKS, MIN_SPIKE_MESSAGES, MIN_SPIKE_WINDOWS, NO_CHAT_SPIKES_MESSAGE, findChatPeaks } from './chatPeaks'
import type { ChatMessage } from './chatLog'

/**
 * T-135 (3) - the chat spike finder merged neighbouring buckets by comparing an UNPADDED key against a PADDED start, so with the defaults
 * (10 s buckets, 15 s of padding) two adjacent hype buckets read 25 < 20 = false and one 30 s explosion became three 40 s rows that overlapped by
 * 30 s, filling the 12-row cap with near-duplicates. A merged group's window also ignored its extra buckets. These cases are arithmetic: a quiet
 * bed of one message per bucket (median 1, so the threshold is the floor of 5) and spikes of 8 messages in the buckets named.
 */

const BUCKET = 10
const PAD = 15

/** `n` messages inside the bucket that starts at `keySec` (spread over its first n seconds, text `${tag} ${i}`). */
function burst(keySec: number, n: number, tag = 'POG'): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({ tSec: keySec + (i % BUCKET), text: `${tag} ${keySec}.${i}` }))
}
/** One message in every bucket from 0 to `untilSec`, but the ones in `skip`: the quiet bed that gives a median of 1. */
function bed(untilSec: number, skip: number[] = []): ChatMessage[] {
  const out: ChatMessage[] = []
  for (let k = 0; k < untilSec; k += BUCKET) if (!skip.includes(k)) out.push({ tSec: k + 1, text: `quiet ${k}` })
  return out
}

describe('findChatPeaks - neighbouring spike buckets are one spike (T-135 (3))', () => {
  it('three adjacent hype buckets are ONE row, with a window that covers all three plus the padding', () => {
    const msgs = [...bed(200, [100, 110, 120]), ...burst(100, 8), ...burst(110, 8), ...burst(120, 8)]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(1)
    const [peak] = peaks
    expect(peak?.count).toBe(24)
    // firstKey 100 less the 15 s pad; endKey 120 plus its bucket (10) and the pad.
    expect(peak?.startSec).toBe(85)
    expect(peak?.endSec).toBe(145)
  })

  it('a spike of one bucket keeps the window it always had: key - pad .. key + bucket + pad', () => {
    const peaks = findChatPeaks([...bed(200, [100]), ...burst(100, 8)], BUCKET, PAD)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]).toMatchObject({ startSec: 85, endSec: 125, count: 8 })
  })

  it('buckets with a quiet bucket between them are two spikes: only exactly adjacent buckets bridge', () => {
    const msgs = [...bed(200, [100, 120]), ...burst(100, 8), ...burst(120, 8)]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks.map((p) => [p.startSec, p.endSec])).toEqual([
      [85, 125],
      [105, 145]
    ])
  })

  it('a long run of hype buckets stays one spike however many buckets it has', () => {
    const run = [100, 110, 120, 130, 140, 150]
    const msgs = [...bed(300, run), ...run.flatMap((k) => burst(k, 7))]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]).toMatchObject({ startSec: 85, endSec: 175, count: 42 })
  })

  it('the padded start stops at 0, and the window\'s end is the LAST bucket\'s end + pad (it used to carry the clamped start into the arithmetic)', () => {
    const peaks = findChatPeaks([...bed(200, [0, 10]), ...burst(0, 8), ...burst(10, 8)], BUCKET, PAD)
    expect(peaks).toHaveLength(1)
    // start max(0, 0 - 15) = 0; end = 10 (last key) + 10 + 15 = 35 - not 0 + 10 + 30 + a second bucket.
    expect(peaks[0]).toMatchObject({ startSec: 0, endSec: 35 })
    const single = findChatPeaks([...bed(200, [0]), ...burst(0, 8)], BUCKET, PAD)
    expect(single[0]).toMatchObject({ startSec: 0, endSec: 25 })
  })

  it('a bucket width that is not a whole number still bridges its neighbours (adjacency is by bucket, not by float difference)', () => {
    const w = 4.3
    // Buckets 3 and 4 of a 4.3 s bucket: 12.899999999999999 and 17.2, which differ by 4.300000000000001.
    const at = (idx: number, n: number): ChatMessage[] => Array.from({ length: n }, (_, i) => ({ tSec: idx * w + 0.1 + i * 0.01, text: `x${idx}.${i}` }))
    const quiet: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({ tSec: (i + 6) * w + 0.1, text: `q${i}` }))
    const peaks = findChatPeaks([...quiet, ...at(3, 8), ...at(4, 8)], w, 0)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]?.count).toBe(16)
  })

  it('the 12-row cap keeps the twelve biggest spikes, in time order, and a three-bucket spike takes one of them', () => {
    const spikes = Array.from({ length: 14 }, (_, i) => 100 + i * 50) // fourteen isolated spikes
    const msgs = [...bed(900, spikes), ...spikes.flatMap((k, i) => burst(k, 6 + i))]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(MAX_CHAT_PEAKS)
    expect(peaks.map((p) => p.count)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(peaks.map((p) => p.startSec)).toEqual([...peaks.map((p) => p.startSec)].sort((a, b) => a - b))
  })
})

describe('findChatPeaks - what counts as a spike (unchanged by T-135 (3))', () => {
  it('fewer than three buckets of chat have no baseline: no spikes', () => {
    expect(findChatPeaks([...burst(0, 20), ...burst(10, 20)], BUCKET, PAD)).toEqual([])
    expect(findChatPeaks([], BUCKET, PAD)).toEqual([])
  })

  it('a bucket needs at least twice the median and at least 5 messages', () => {
    // Median 1 -> threshold max(2, 5) = 5: four messages is a busy bucket, not a spike; five is.
    expect(findChatPeaks([...bed(100, [50]), ...burst(50, 4)], BUCKET, PAD)).toEqual([])
    expect(findChatPeaks([...bed(100, [50]), ...burst(50, 5)], BUCKET, PAD)).toHaveLength(1)
    // Median 4 -> threshold 8.
    const busyBed: ChatMessage[] = Array.from({ length: 10 }, (_, b) => burst(b * 10, 4)).flat()
    expect(findChatPeaks([...busyBed, ...burst(200, 7)], BUCKET, PAD)).toEqual([])
    expect(findChatPeaks([...busyBed, ...burst(200, 8)], BUCKET, PAD)).toHaveLength(1)
  })

  it('previews the first three messages of the first bucket, then two of each bucket it absorbs', () => {
    const msgs = [...bed(200, [100, 110]), ...burst(100, 8, 'A'), ...burst(110, 8, 'B')]
    const [peak] = findChatPeaks(msgs, BUCKET, PAD)
    expect(peak?.topMessages).toEqual(['A 100.0', 'A 100.1', 'A 100.2', 'B 110.0', 'B 110.1'])
  })
})

/**
 * T-136 (9): a row ranked by its SUMMED count let a long, moderately busy run (a raid: twenty windows of 6 messages, 120 in all) outrank a short
 * explosion (15 messages in one window) and take its place when the 12-row cap forced a choice; the row showed only its start, so the clip a
 * "+ Clip" added could be minutes long without the row saying so. Rows now rank by their DENSEST window; `count` stays the total, for display.
 * And the extra seconds are clamped inside the function (0..60): -5 made a window of zero length, [105, 105].
 */
describe('findChatPeaks - rows rank by their densest window, and count stays the total (T-136 (9))', () => {
  it('a short explosion outranks a long, moderately busy run when the cap forces a choice', () => {
    const explosions = Array.from({ length: MAX_CHAT_PEAKS }, (_, i) => 1000 + i * 50) // twelve single-window spikes of 15
    const raid = Array.from({ length: 20 }, (_, i) => 100 + i * 10) // twenty adjacent windows of 6: 120 messages, one row
    const msgs = [...bed(1700, [...explosions, ...raid]), ...explosions.flatMap((k) => burst(k, 15)), ...raid.flatMap((k) => burst(k, 6))]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(MAX_CHAT_PEAKS)
    // By the old sum the raid (120) ranked first and pushed out the weakest explosion; by the densest window (6 against 15) it ranks last.
    expect(peaks.map((p) => p.count), 'the twelve explosions, and not the raid').toEqual(Array(MAX_CHAT_PEAKS).fill(15))
    expect(peaks.every((p) => p.startSec >= 985)).toBe(true)
  })

  it('count is still the TOTAL of the row: the raid, listed alone, says 120 messages', () => {
    const raid = Array.from({ length: 20 }, (_, i) => 100 + i * 10)
    const peaks = findChatPeaks([...bed(900, raid), ...raid.flatMap((k) => burst(k, 6))], BUCKET, PAD)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]).toMatchObject({ count: 120, startSec: 85, endSec: 315 })
  })

  it('rows with the same densest window rank by their total: a three-window run of 8s outranks a single window of 8', () => {
    const singles = Array.from({ length: MAX_CHAT_PEAKS }, (_, i) => 1000 + i * 50) // twelve windows of 8
    const run = [1700, 1710, 1720] // 8 + 8 + 8: the same densest window, a total of 24, and LATER than every single (time order alone would drop it)
    const msgs = [...bed(2000, [...singles, ...run]), ...singles.flatMap((k) => burst(k, 8)), ...run.flatMap((k) => burst(k, 8))]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(MAX_CHAT_PEAKS)
    expect(peaks.some((p) => p.count === 24), 'the run is kept').toBe(true)
    // Thirteen rows, twelve places: the weakest of the equal singles goes, and with equal totals that is the last in time order.
    expect(peaks.map((p) => p.startSec).includes(1000 + 11 * 50 - PAD), 'the last single is the one dropped').toBe(false)
    expect(peaks.map((p) => p.startSec)).toEqual([...peaks.map((p) => p.startSec)].sort((a, b) => a - b))
  })

  it('the rank is the densest window wherever it sits in the run: a 5 / 14 / 5 run outranks a single window of 10', () => {
    const singles = Array.from({ length: MAX_CHAT_PEAKS }, (_, i) => 1000 + i * 50) // twelve windows of 10
    const run: Array<[number, number]> = [[1700, 5], [1710, 14], [1720, 5]] // a total of 24, the densest window in the MIDDLE
    const msgs = [...bed(2000, [...singles, ...run.map(([k]) => k)]), ...singles.flatMap((k) => burst(k, 10)), ...run.flatMap(([k, n]) => burst(k, n))]
    const peaks = findChatPeaks(msgs, BUCKET, PAD)
    expect(peaks).toHaveLength(MAX_CHAT_PEAKS)
    expect(peaks.some((p) => p.count === 24), 'the run is kept: its densest window (14) beats 10').toBe(true)
    expect(peaks.map((p) => p.startSec).includes(1000 + 11 * 50 - PAD), 'and the last single is the one dropped').toBe(false)
  })

  it('the rows come back in time order whatever ranked them', () => {
    const msgs = [...bed(600, [100, 300, 500]), ...burst(100, 6), ...burst(300, 12), ...burst(500, 9)]
    expect(findChatPeaks(msgs, BUCKET, PAD).map((p) => p.count)).toEqual([6, 12, 9])
  })
})

describe('findChatPeaks - the extra seconds are 0 to 60 (T-136 (9))', () => {
  const one = [...bed(300, [100]), ...burst(100, 8)]

  it('the limit is 60', () => {
    expect(MAX_CHAT_PAD_SEC).toBe(60)
  })

  it('a negative pad is no pad: the window is the bucket itself, never zero or reversed (it was [105, 105] for -5)', () => {
    expect(findChatPeaks(one, BUCKET, -5)[0]).toMatchObject({ startSec: 100, endSec: 110 })
    expect(findChatPeaks(one, BUCKET, -1e9)[0]).toMatchObject({ startSec: 100, endSec: 110 })
  })

  it('a pad past 60 is 60', () => {
    expect(findChatPeaks(one, BUCKET, 600)[0]).toMatchObject({ startSec: 40, endSec: 170 })
    expect(findChatPeaks(one, BUCKET, Infinity)[0]).toMatchObject({ startSec: 40, endSec: 170 })
  })

  it('a pad that is not a number is no pad', () => {
    expect(findChatPeaks(one, BUCKET, NaN)[0]).toMatchObject({ startSec: 100, endSec: 110 })
  })

  it('the ends of the range are kept as they are, and a fraction of a second is a fraction', () => {
    expect(findChatPeaks(one, BUCKET, 0)[0]).toMatchObject({ startSec: 100, endSec: 110 })
    expect(findChatPeaks(one, BUCKET, 60)[0]).toMatchObject({ startSec: 40, endSec: 170 })
    expect(findChatPeaks(one, BUCKET, 2.5)[0]).toMatchObject({ startSec: 97.5, endSec: 112.5 })
  })
})

describe('NO_CHAT_SPIKES_MESSAGE - the rule the panel prints when a log has no spike (T-136 (9))', () => {
  it('names the numbers the function uses, so the sentence cannot drift from the rule', () => {
    expect(MIN_SPIKE_MESSAGES).toBe(5)
    expect(MIN_SPIKE_WINDOWS).toBe(3)
    expect(NO_CHAT_SPIKES_MESSAGE).toContain(`at least ${MIN_SPIKE_MESSAGES} messages`)
    expect(NO_CHAT_SPIKES_MESSAGE).toContain('twice as many as a usual window')
    expect(NO_CHAT_SPIKES_MESSAGE).toContain(`at least ${MIN_SPIKE_WINDOWS} different windows`)
    expect(NO_CHAT_SPIKES_MESSAGE.startsWith('No chat spikes found.')).toBe(true)
    expect(NO_CHAT_SPIKES_MESSAGE.endsWith('.')).toBe(true)
  })

  it('every clause is true of the function: the edges of the rule', () => {
    // Four messages in the busiest window: no spike. Five: a spike. (the "at least 5 messages" clause)
    expect(findChatPeaks([...bed(100, [50]), ...burst(50, MIN_SPIKE_MESSAGES - 1)], BUCKET, PAD)).toEqual([])
    expect(findChatPeaks([...bed(100, [50]), ...burst(50, MIN_SPIKE_MESSAGES)], BUCKET, PAD)).toHaveLength(1)
    // Messages in only two different windows: no baseline, no spike however loud. Three: there is one.
    expect(findChatPeaks([...burst(0, 20), ...burst(10, 20)], BUCKET, PAD)).toEqual([])
    expect(findChatPeaks([...burst(0, 1), ...burst(10, 1), ...burst(20, 20)], BUCKET, PAD)).toHaveLength(1)
  })
})
