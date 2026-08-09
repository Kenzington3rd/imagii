import { describe, it, expect, beforeEach } from 'vitest'
import { useVideoStore } from './videoStore'
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
