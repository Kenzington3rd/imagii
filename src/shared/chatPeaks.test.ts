import { describe, it, expect } from 'vitest'
import { MAX_CHAT_PEAKS, findChatPeaks } from './chatPeaks'
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
