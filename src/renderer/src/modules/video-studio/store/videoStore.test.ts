import { describe, it, expect, beforeEach } from 'vitest'
import { playableDuration, useVideoStore } from './videoStore'
import type { VideoSource } from './videoStore'

const FAKE_SOURCE: VideoSource = {
  filePath: '/fake/path.mp4',
  fileName: 'path.mp4',
  url: 'imagii-file://fake/path.mp4',
  probe: {
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    bitrate: 5_000_000,
    sizeBytes: 10_000_000
  }
}

describe('addClipFromRange — reversed-range guard (Phase 2.12)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null
    })
  })

  it('adds a clip when range is well-formed', () => {
    useVideoStore.getState().addClipFromRange('valid', 5, 15)
    const clips = useVideoStore.getState().clips
    expect(clips).toHaveLength(1)
    expect(clips[0]?.startSec).toBe(5)
    expect(clips[0]?.endSec).toBe(15)
  })

  it('rejects reversed range (start >= end) silently', () => {
    useVideoStore.getState().addClipFromRange('reversed', 15, 5)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('rejects equal start and end', () => {
    useVideoStore.getState().addClipFromRange('zero-length', 5, 5)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('rejects non-finite values', () => {
    useVideoStore.getState().addClipFromRange('nan', NaN, 5)
    useVideoStore.getState().addClipFromRange('inf', 0, Infinity)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('clamps a range that extends past the source duration', () => {
    useVideoStore.getState().addClipFromRange('overrun', -5, 999)
    const clip = useVideoStore.getState().clips[0]
    expect(clip).toBeDefined()
    expect(clip?.startSec).toBe(0)
    expect(clip?.endSec).toBe(60) // FAKE_SOURCE.probe.duration
  })

  it('does nothing when no source is loaded', () => {
    useVideoStore.setState({ source: null, clips: [] })
    useVideoStore.getState().addClipFromRange('orphan', 5, 15)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })
})

// T-48 regression: the guards above reject in silence, and every caller
// used to toast "Clip added" regardless — a success message for a clip
// that was never added. The answer is now the return value, and it has to
// track the clips list exactly, in both directions.
describe('addClipFromRange — return value reports what actually happened (T-48)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null
    })
  })

  it('returns true only when a clip really joined the list', () => {
    expect(useVideoStore.getState().addClipFromRange('valid', 5, 15)).toBe(true)
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })

  it('returns false for every refusal, and adds nothing', () => {
    const add = (name: string, a: number, b: number): boolean =>
      useVideoStore.getState().addClipFromRange(name, a, b)
    expect(add('reversed', 15, 5)).toBe(false)
    expect(add('zero-length', 5, 5)).toBe(false)
    expect(add('nan', NaN, 5)).toBe(false)
    expect(add('inf', 0, Infinity)).toBe(false)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('returns false with no source loaded', () => {
    useVideoStore.setState({ source: null, clips: [] })
    expect(useVideoStore.getState().addClipFromRange('orphan', 5, 15)).toBe(false)
  })

  it('returns false for the collapsed range a past-the-end chat peak clamps to', () => {
    // ChatHighlightPanel clamps both ends to the duration, so a peak whose
    // bucket starts after the video ends arrives here as duration→duration.
    const { duration } = FAKE_SOURCE.probe
    expect(useVideoStore.getState().addClipFromRange('past the end', duration, duration)).toBe(
      false
    )
    expect(useVideoStore.getState().clips).toHaveLength(0)
    // …while a peak that merely runs OVER the end still lands, clamped.
    expect(useVideoStore.getState().addClipFromRange('overruns', duration - 5, duration)).toBe(
      true
    )
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })
})

describe('srtPath state — Phase 4 tech-debt', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null,
      srtPath: null
    })
  })

  it('starts null', () => {
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('setSrtPath updates state', () => {
    useVideoStore.getState().setSrtPath('/tmp/captions.srt')
    expect(useVideoStore.getState().srtPath).toBe('/tmp/captions.srt')
  })

  it('setSrtPath(null) clears', () => {
    useVideoStore.getState().setSrtPath('/tmp/captions.srt')
    useVideoStore.getState().setSrtPath(null)
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('clearSource resets srtPath to null', () => {
    useVideoStore.getState().setSrtPath('/tmp/captions.srt')
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().srtPath).toBeNull()
  })
})

/**
 * T-56 — the scrubbing surfaces' coordinate space.
 *
 * ffprobe reports the container's rounded duration and the decoder has the
 * real one; the E2E fixture probes 2.000 s and decodes 2.020136 s. Everything
 * built on the probe therefore stopped ~20 ms short of the end of the file,
 * which is where the Timeline's right edge sat — the last frames were
 * unreachable by click, by drag and by End, while the Player's own nudge
 * (fixed in T-52) already reached them.
 */
describe('playableDuration — the element outranks the probe (T-56)', () => {
  it('is the probe duration until an element has published one', () => {
    expect(playableDuration(FAKE_SOURCE, null)).toBe(60)
  })

  it('is the element duration once it has', () => {
    expect(playableDuration(FAKE_SOURCE, 60.5)).toBe(60.5)
    // Shorter, too: the element is the authority, not the larger number.
    expect(playableDuration(FAKE_SOURCE, 59.5)).toBe(59.5)
  })

  it('is 0 with no source at all, so a track cannot divide by a phantom', () => {
    expect(playableDuration(null, null)).toBe(0)
  })
})

describe('setMediaDuration — what the element is allowed to publish (T-56)', () => {
  beforeEach(() => {
    useVideoStore.setState({ source: FAKE_SOURCE, mediaDuration: null })
  })

  it('records a real duration', () => {
    useVideoStore.getState().setMediaDuration(2.020136)
    expect(useVideoStore.getState().mediaDuration).toBe(2.020136)
  })

  it('refuses NaN, Infinity and zero — the element reports all three', () => {
    // NaN before metadata, Infinity for a live stream, 0 for an empty load.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      useVideoStore.getState().setMediaDuration(2)
      useVideoStore.getState().setMediaDuration(bad)
      expect(useVideoStore.getState().mediaDuration).toBeNull()
    }
  })

  it('a new source clears it — the next file has not spoken yet', () => {
    useVideoStore.getState().setMediaDuration(2.02)
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().mediaDuration).toBeNull()
  })
})

describe('requestSeek — the Timeline scrub channel (T-52)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      currentTime: 0,
      mediaDuration: null,
      seekRequest: null,
      clips: [],
      selectedClipId: null
    })
  })

  it('starts with no pending request', () => {
    expect(useVideoStore.getState().seekRequest).toBeNull()
  })

  it('records the requested position and moves the drawn playhead with it', () => {
    useVideoStore.getState().requestSeek(12.5)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 12.5 })
    // The marker does not wait for the media element's timeupdate — on a long
    // file the seek takes a moment and the playhead has to stay under the
    // cursor.
    expect(useVideoStore.getState().currentTime).toBe(12.5)
  })

  it('hands the Player a FRESH object every call, so a repeat seek still lands', () => {
    useVideoStore.getState().requestSeek(3)
    const first = useVideoStore.getState().seekRequest
    useVideoStore.getState().requestSeek(3)
    const second = useVideoStore.getState().seekRequest
    expect(second).toEqual(first)
    // Identity is the signal the Player subscribes on: same value, new object.
    expect(second).not.toBe(first)
  })

  it('clamps into the source, so a drag past either end of the track is safe', () => {
    useVideoStore.getState().requestSeek(-4)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 0 })
    useVideoStore.getState().requestSeek(9999)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 60 })
  })

  // T-56: with an element duration published, the ceiling is the element's.
  it('clamps to what the element can PLAY, not to what ffprobe rounded', () => {
    useVideoStore.getState().setMediaDuration(60.5)
    useVideoStore.getState().requestSeek(9999)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 60.5 })
  })

  // The T-47 restore parks the playhead through this same channel, and a
  // position the user left in the last frames of the file is inside the
  // element's duration while being past the probe's. Clamping it to the probe
  // would quietly rewind a restored session.
  it('leaves a position past the probe duration alone when the element is longer', () => {
    useVideoStore.getState().setMediaDuration(60.5)
    useVideoStore.getState().requestSeek(60.4)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 60.4 })
    expect(useVideoStore.getState().currentTime).toBe(60.4)
  })

  it('ignores a non-finite request rather than handing NaN to the media element', () => {
    useVideoStore.getState().requestSeek(5)
    useVideoStore.getState().requestSeek(Number.NaN)
    useVideoStore.getState().requestSeek(Number.POSITIVE_INFINITY)
    // POSITIVE_INFINITY is not finite either — neither call moved anything.
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 5 })
    expect(useVideoStore.getState().currentTime).toBe(5)
  })

  it('collapses to 0 with no source loaded', () => {
    useVideoStore.setState({ source: null })
    useVideoStore.getState().requestSeek(10)
    expect(useVideoStore.getState().seekRequest).toEqual({ seconds: 0 })
  })

  it('a pending request never survives a source change', () => {
    useVideoStore.getState().requestSeek(30)
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().seekRequest).toBeNull()
    expect(useVideoStore.getState().currentTime).toBe(0)
  })
})

describe('clip history — undo/redo (UX round 18)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null,
      srtPath: null,
      history: { past: [], future: [] },
      historyKey: null
    })
  })

  it('undo restores a removed clip (and the prior selection)', () => {
    useVideoStore.getState().addClipFromRange('keep', 0, 10)
    useVideoStore.getState().addClipFromRange('doomed', 20, 30)
    const doomed = useVideoStore.getState().clips[1]
    expect(doomed).toBeDefined()

    useVideoStore.getState().removeClip(doomed!.id)
    expect(useVideoStore.getState().clips).toHaveLength(1)

    useVideoStore.getState().undo()
    const clips = useVideoStore.getState().clips
    expect(clips).toHaveLength(2)
    expect(clips[1]?.id).toBe(doomed!.id)
    expect(clips[1]?.name).toBe('doomed')
    expect(clips[1]?.startSec).toBe(20)
    expect(clips[1]?.endSec).toBe(30)
    // The removed clip was selected when it was removed — undo brings
    // the selection back with it.
    expect(useVideoStore.getState().selectedClipId).toBe(doomed!.id)
  })

  it('undo restores a previous trim range', () => {
    useVideoStore.getState().addClipFromRange('trim-me', 5, 15)
    const id = useVideoStore.getState().clips[0]!.id

    useVideoStore.getState().setClipRange(id, 8, 12)
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(8)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(12)

    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(5)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(15)
  })

  it('redo re-applies an undone change', () => {
    useVideoStore.getState().addClipFromRange('redo-me', 5, 15)
    const id = useVideoStore.getState().clips[0]!.id

    useVideoStore.getState().setClipRange(id, 8, 12)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().canRedo()).toBe(true)

    useVideoStore.getState().redo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(8)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(12)
    expect(useVideoStore.getState().canRedo()).toBe(false)
  })

  it('caps history depth at 50 entries', () => {
    useVideoStore.getState().addClipFromRange('cap', 0, 60)
    const id = useVideoStore.getState().clips[0]!.id
    // 60 discrete mutations (toggling membership flips every call) — the
    // stack must retain only the newest 50 snapshots.
    for (let i = 0; i < 60; i++) {
      useVideoStore.getState().togglePreset(id, 'tiktok')
    }
    expect(useVideoStore.getState().history.past).toHaveLength(50)

    for (let i = 0; i < 50; i++) {
      useVideoStore.getState().undo()
    }
    expect(useVideoStore.getState().canUndo()).toBe(false)
    // Undoing past the cap is a silent no-op.
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })

  it('a trim drag (many setClipRange calls) coalesces into one undo step', () => {
    useVideoStore.getState().addClipFromRange('drag-me', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id
    const before = useVideoStore.getState().history.past.length

    // Simulate a drag: setClipRange fires on every mousemove.
    for (let t = 1; t <= 10; t++) {
      useVideoStore.getState().setClipRange(id, t, 30)
    }
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(10)
    expect(useVideoStore.getState().history.past.length).toBe(before + 1)

    // One undo jumps all the way back to the pre-drag range.
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(0)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(30)
  })

  it('coalescing breaks across different actions, so each gesture is its own step', () => {
    useVideoStore.getState().addClipFromRange('multi', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id

    for (let t = 1; t <= 5; t++) useVideoStore.getState().setClipRange(id, t, 30)
    for (const s of [1.5, 2, 2.5]) useVideoStore.getState().setClipSpeed(id, s)

    // add + drag + speed gesture = 3 steps.
    expect(useVideoStore.getState().history.past).toHaveLength(3)

    useVideoStore.getState().undo() // undoes the whole speed gesture
    expect(useVideoStore.getState().clips[0]?.speedMultiplier).toBeUndefined()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(5)

    useVideoStore.getState().undo() // undoes the whole drag
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(0)
  })

  it('a new edit after undo clears the redo stack', () => {
    useVideoStore.getState().addClipFromRange('branch', 5, 15)
    const id = useVideoStore.getState().clips[0]!.id

    useVideoStore.getState().setClipRange(id, 8, 12)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().canRedo()).toBe(true)

    useVideoStore.getState().renameClip(id, 'branched')
    expect(useVideoStore.getState().canRedo()).toBe(false)
  })

  it('clearSource drops history instead of snapshotting', () => {
    useVideoStore.getState().addClipFromRange('gone', 5, 15)
    expect(useVideoStore.getState().canUndo()).toBe(true)

    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().canUndo()).toBe(false)
    expect(useVideoStore.getState().canRedo()).toBe(false)
    expect(useVideoStore.getState().history.past).toHaveLength(0)
  })
})

describe('custom presets as export targets (T-50)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null,
      history: { past: [], future: [] },
      historyKey: null
    })
    useVideoStore.getState().addClip()
  })

  const clipId = (): string => useVideoStore.getState().clips[0]?.id as string
  const queued = (): string[] => useVideoStore.getState().clips[0]?.customPresetIds ?? []

  it('a fresh clip queues no custom presets', () => {
    expect(useVideoStore.getState().clips[0]?.customPresetIds).toBeUndefined()
    expect(queued()).toEqual([])
  })

  it('toggleCustomPreset queues and unqueues, and is order-preserving', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-b')
    expect(queued()).toEqual(['cp-a', 'cp-b'])
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    expect(queued()).toEqual(['cp-b'])
  })

  it('leaves the platform presets alone', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    expect(useVideoStore.getState().clips[0]?.selectedPresets).toEqual(['youtube'])
  })

  it('touches only the clip it was given', () => {
    const first = clipId()
    useVideoStore.getState().addClip()
    const second = useVideoStore.getState().clips[1]?.id as string
    useVideoStore.getState().toggleCustomPreset(first, 'cp-a')
    expect(useVideoStore.getState().clips[0]?.customPresetIds).toEqual(['cp-a'])
    expect(useVideoStore.getState().clips[1]?.customPresetIds ?? []).toEqual([])
    useVideoStore.getState().toggleCustomPreset(second, 'cp-b')
    expect(useVideoStore.getState().clips[0]?.customPresetIds).toEqual(['cp-a'])
    expect(useVideoStore.getState().clips[1]?.customPresetIds).toEqual(['cp-b'])
  })

  it('is undoable like any other clip edit', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    expect(queued()).toEqual(['cp-a'])
    useVideoStore.getState().undo()
    expect(queued()).toEqual([])
  })

  it('pruneCustomPresets drops ids whose preset is gone, on every clip at once', () => {
    const first = clipId()
    useVideoStore.getState().addClip()
    const second = useVideoStore.getState().clips[1]?.id as string
    useVideoStore.getState().toggleCustomPreset(first, 'cp-a')
    useVideoStore.getState().toggleCustomPreset(first, 'cp-b')
    useVideoStore.getState().toggleCustomPreset(second, 'cp-b')

    useVideoStore.getState().pruneCustomPresets(['cp-a'])
    expect(useVideoStore.getState().clips[0]?.customPresetIds).toEqual(['cp-a'])
    expect(useVideoStore.getState().clips[1]?.customPresetIds).toEqual([])
  })

  it('an empty saved list unqueues everything rather than throwing', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    useVideoStore.getState().pruneCustomPresets([])
    expect(queued()).toEqual([])
  })

  it('a clip that never queued anything survives a prune untouched', () => {
    const before = useVideoStore.getState().clips
    useVideoStore.getState().pruneCustomPresets(['cp-a'])
    // Same object identity: the no-op path must not churn subscribers, which
    // is what makes the panel's refresh-on-mount free.
    expect(useVideoStore.getState().clips).toBe(before)
  })

  it('a prune with nothing to drop is a no-op, identity included', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    const before = useVideoStore.getState().clips
    useVideoStore.getState().pruneCustomPresets(['cp-a', 'cp-b'])
    expect(useVideoStore.getState().clips).toBe(before)
  })

  it('pruning is NOT undoable — undo must never re-queue a deleted preset', () => {
    useVideoStore.getState().toggleCustomPreset(clipId(), 'cp-a')
    const depth = useVideoStore.getState().history.past.length
    useVideoStore.getState().pruneCustomPresets([])
    expect(queued()).toEqual([])
    expect(useVideoStore.getState().history.past.length).toBe(depth)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.customPresetIds ?? []).toEqual([])
  })
})
