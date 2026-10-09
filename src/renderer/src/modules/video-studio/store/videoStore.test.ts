import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  endsGestureOnPointerUp,
  isPristineWholeVideoClip,
  playableDuration,
  useVideoStore
} from './videoStore'
import type { VideoSource } from './videoStore'
import type { Clip } from '@shared/clip'

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

  /**
   * T-40 — the coalescing key can only say "same kind of edit as last time".
   * Telling one gesture from the next one just like it is what `endGesture`
   * is for; the surfaces call it on mouseup / Rnd stop / slider release.
   */
  it('two consecutive trim drags are two undo steps, not one', () => {
    useVideoStore.getState().addClipFromRange('two-drags', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id
    const before = useVideoStore.getState().history.past.length

    // Drag 1: mousemoves, then the button comes up.
    for (let t = 1; t <= 5; t++) useVideoStore.getState().setClipRange(id, t, 30)
    useVideoStore.getState().endGesture()
    // Drag 2: same handle, same coalescing key, a separate gesture.
    for (let t = 6; t <= 10; t++) useVideoStore.getState().setClipRange(id, t, 30)
    useVideoStore.getState().endGesture()

    expect(useVideoStore.getState().history.past.length).toBe(before + 2)
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(10)

    // The first undo takes back only the second drag…
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(5)
    // …and the second takes back the first.
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(0)
  })

  it('still collapses the whole of one gesture while it is open', () => {
    useVideoStore.getState().addClipFromRange('one-drag', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id
    const before = useVideoStore.getState().history.past.length

    for (let t = 1; t <= 10; t++) useVideoStore.getState().setClipRange(id, t, 30)
    useVideoStore.getState().endGesture()

    expect(useVideoStore.getState().history.past.length).toBe(before + 1)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(0)
  })

  it('closes the window for a slider and for the Reset that follows it', () => {
    // The colour sliders and "Reset color" all carry `grade:<id>`: without a
    // gesture end, four slider drags plus the reset were ONE step, and undo
    // jumped past every one of them.
    useVideoStore.getState().addClipFromRange('grade', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id
    const graded = { brightness: 0.25, contrast: 1.2, saturation: 1.5, temperature: -0.5 }

    useVideoStore.getState().setClipColorGrade(id, graded)
    useVideoStore.getState().endGesture()
    useVideoStore
      .getState()
      .setClipColorGrade(id, { brightness: 0, contrast: 1, saturation: 1, temperature: 0 })
    useVideoStore.getState().endGesture()

    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.colorGrade).toEqual(graded)
  })

  it('is a no-op with no gesture open, so it cannot swallow a step', () => {
    useVideoStore.getState().addClipFromRange('idle', 0, 30)
    const id = useVideoStore.getState().clips[0]!.id
    const state = useVideoStore.getState()

    state.endGesture()
    state.endGesture()
    expect(useVideoStore.getState().historyKey).toBeNull()
    const depth = useVideoStore.getState().history.past.length

    // And the next coalescible edit still records exactly one step.
    useVideoStore.getState().setClipRange(id, 4, 30)
    useVideoStore.getState().setClipRange(id, 5, 30)
    expect(useVideoStore.getState().history.past.length).toBe(depth + 1)
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

/**
 * T-80 — which pointerups end a gesture and which are part of one.
 *
 * The panels close their coalescing window on any pointerup that bubbles to
 * them (T-40), which is right for a slider release and wrong for the click a
 * user makes to move the caret inside the field they are typing in. The
 * decision is this predicate; `handleGestureEndPointerUp` supplies it the
 * tag, the input type and whether the element has focus, and nothing else.
 */
describe('endsGestureOnPointerUp — a caret click is not a gesture end (T-80)', () => {
  const FOCUSED = true

  it('lets a release inside the focused text field through', () => {
    expect(endsGestureOnPointerUp('INPUT', 'text', FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('TEXTAREA', null, FOCUSED)).toBe(false)
  })

  it('treats every text-like input type the same', () => {
    for (const type of ['text', 'number', 'search', 'url', 'email', 'password']) {
      expect(endsGestureOnPointerUp('INPUT', type, FOCUSED), type).toBe(false)
    }
  })

  it('treats a missing or unrecognized type as text entry', () => {
    // The DOM reports 'text' for both, but the predicate is handed whatever
    // the caller read: neither answer may end an edit in progress.
    expect(endsGestureOnPointerUp('INPUT', null, FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('INPUT', 'not-a-real-type', FOCUSED)).toBe(false)
  })

  it('still ends the gesture when a slider or a box is released — T-40 stands', () => {
    for (const type of ['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset']) {
      expect(endsGestureOnPointerUp('INPUT', type, FOCUSED), type).toBe(true)
    }
  })

  it('ends the gesture on anything that is not a field', () => {
    for (const tag of ['DIV', 'BUTTON', 'SELECT', 'SPAN', 'LABEL', 'svg']) {
      expect(endsGestureOnPointerUp(tag, null, FOCUSED), tag).toBe(true)
    }
  })

  it('ends the gesture over a text field that is NOT focused', () => {
    // A drag that began on a slider and happens to finish over a caption box
    // is still the slider's gesture ending. Only the focused field is
    // mid-edit.
    expect(endsGestureOnPointerUp('INPUT', 'text', false)).toBe(true)
    expect(endsGestureOnPointerUp('TEXTAREA', null, false)).toBe(true)
  })

  it('reads the tag and type case-insensitively, as the DOM spells them', () => {
    expect(endsGestureOnPointerUp('input', 'TEXT', FOCUSED)).toBe(false)
    expect(endsGestureOnPointerUp('input', 'Range', FOCUSED)).toBe(true)
    expect(endsGestureOnPointerUp('textarea', null, FOCUSED)).toBe(false)
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

// ── T-94 — the untouched whole-video clip steps aside for the scanners ────────
//
// loadSource gives the editor a "Clip 1" spanning the whole file. Scan a
// three-hour VOD, add five highlights, press Export, and that clip rode along
// in every export and compilation: the full VOD re-encoded beside the five
// excerpts the user actually wanted. Only the highlight scanners retire it —
// their intent to work with excerpts is unambiguous — and only while it is
// still exactly what loadSource made.

const DURATION = FAKE_SOURCE.probe.duration

/** The clip loadSource makes, as a value (the real creator is exercised below). */
function pristine(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'whole',
    name: 'Clip 1',
    startSec: 0,
    endSec: DURATION,
    cropRect: null,
    textOverlays: [],
    selectedPresets: ['youtube'],
    ...overrides
  }
}

describe('isPristineWholeVideoClip — exactly what loadSource makes (T-94)', () => {
  it('is true for the default clip', () => {
    expect(isPristineWholeVideoClip(pristine(), DURATION)).toBe(true)
  })

  // Every field a user could have touched, each one alone. If any of these
  // stayed true the scanner would delete work.
  const TOUCHED: ReadonlyArray<readonly [string, Partial<Clip>]> = [
    ['renamed', { name: 'Intro' }],
    ['renamed to the next default', { name: 'Clip 2' }],
    ['trimmed at the start', { startSec: 0.5 }],
    ['trimmed at the end', { endSec: DURATION - 1 }],
    ['extended past the probe', { endSec: DURATION + 1 }],
    ['cropped', { cropRect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
    [
      'carrying a text overlay',
      {
        textOverlays: [
          {
            id: 'o1',
            text: 'hi',
            font: 'Arial',
            sizePx: 48,
            colorHex: '#ffffff',
            x: 0.1,
            y: 0.1,
            startSec: 0,
            endSec: 5
          }
        ]
      }
    ],
    ['brightness changed', { colorGrade: { brightness: 0.1, contrast: 1, saturation: 1, temperature: 0 } }],
    ['contrast changed', { colorGrade: { brightness: 0, contrast: 1.2, saturation: 1, temperature: 0 } }],
    ['saturation changed', { colorGrade: { brightness: 0, contrast: 1, saturation: 0.5, temperature: 0 } }],
    ['temperature changed', { colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature: -0.3 } }],
    ['sped up', { speedMultiplier: 2 }],
    ['slowed down', { speedMultiplier: 0.5 }],
    ['auto-zoom on', { autoZoom: true }],
    ['hype-shake on', { hypeShake: true }],
    ['YouTube unticked', { selectedPresets: [] }],
    ['a platform added', { selectedPresets: ['youtube', 'reels'] }],
    ['a different platform', { selectedPresets: ['reels'] }],
    ['a custom preset queued', { customPresetIds: ['cp-a'] }]
  ]

  it.each(TOUCHED)('is false once it is %s', (_label, change) => {
    expect(isPristineWholeVideoClip(pristine(change), DURATION)).toBe(false)
  })

  it('a field set BACK to its default is the default (the export would not change)', () => {
    expect(
      isPristineWholeVideoClip(
        pristine({
          speedMultiplier: 1,
          autoZoom: false,
          hypeShake: false,
          customPresetIds: [],
          colorGrade: { brightness: 0, contrast: 1, saturation: 1, temperature: 0 }
        }),
        DURATION
      )
    ).toBe(true)
  })

  it('judges the end against the duration it is given, and refuses a duration that is no duration', () => {
    expect(isPristineWholeVideoClip(pristine(), DURATION + 10)).toBe(false)
    expect(isPristineWholeVideoClip(pristine({ endSec: 0 }), 0)).toBe(false)
    expect(isPristineWholeVideoClip(pristine(), NaN)).toBe(false)
    expect(isPristineWholeVideoClip(pristine(), Infinity)).toBe(false)
  })

  describe('the real creator', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('the clip loadSource creates IS pristine (the predicate and the creator cannot drift)', async () => {
      vi.stubGlobal('window', {
        api: {
          video: {
            probe: async () => FAKE_SOURCE.probe,
            fileUrl: (p: string) => `imagii-file://${p}`
          }
        }
      })
      await useVideoStore.getState().loadSource('/fake/path.mp4')
      const clips = useVideoStore.getState().clips
      expect(clips).toHaveLength(1)
      expect(isPristineWholeVideoClip(clips[0]!, DURATION)).toBe(true)
    })

    it('the clip addClip creates after the first is NOT pristine (it is named Clip N)', () => {
      useVideoStore.setState({
        source: FAKE_SOURCE,
        clips: [pristine()],
        selectedClipId: 'whole',
        history: { past: [], future: [] },
        historyKey: null
      })
      useVideoStore.getState().addClip()
      const second = useVideoStore.getState().clips[1]!
      expect(second.name).toBe('Clip 2')
      expect(isPristineWholeVideoClip(second, DURATION)).toBe(false)
    })
  })
})

describe('addScannedClip — the scanner\'s add retires the untouched whole-video clip (T-94)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [pristine()],
      selectedClipId: 'whole',
      srtPath: null,
      history: { past: [], future: [] },
      historyKey: null
    })
  })

  const names = (): string[] => useVideoStore.getState().clips.map((c) => c.name)

  it('the first highlight replaces the whole-video clip, and says so', () => {
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe(
      'added-dropped-whole-video'
    )
    expect(names()).toEqual(['Highlight 1'])
    const added = useVideoStore.getState().clips[0]!
    expect([added.startSec, added.endSec]).toEqual([5, 15])
    expect(useVideoStore.getState().selectedClipId).toBe(added.id)
  })

  it('ONE undo restores the whole-video clip, the selection, and removes the highlight', () => {
    const before = useVideoStore.getState().clips
    useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)
    expect(useVideoStore.getState().history.past).toHaveLength(1)

    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips).toEqual(before)
    expect(useVideoStore.getState().selectedClipId).toBe('whole')
    expect(useVideoStore.getState().canUndo()).toBe(false)

    // ...and redo re-applies both halves together.
    useVideoStore.getState().redo()
    expect(names()).toEqual(['Highlight 1'])
  })

  it('later highlights just add: there is nothing left to retire', () => {
    useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)
    expect(useVideoStore.getState().addScannedClip('Highlight 2', 20, 30)).toBe('added')
    expect(names()).toEqual(['Highlight 1', 'Highlight 2'])
    // Two scanner adds, two undo steps.
    expect(useVideoStore.getState().history.past).toHaveLength(2)
  })

  it('leaves the clip alone once the user has touched it', () => {
    const id = 'whole'
    useVideoStore.getState().setClipRange(id, 10, 50)
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe('added')
    expect(names()).toEqual(['Clip 1', 'Highlight 1'])
  })

  it('leaves a renamed whole-video clip alone', () => {
    useVideoStore.getState().renameClip('whole', 'Full VOD')
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe('added')
    expect(names()).toEqual(['Full VOD', 'Highlight 1'])
  })

  it('keeps any other clip the user made, and retires only the pristine one', () => {
    useVideoStore.setState({
      clips: [pristine(), pristine({ id: 'mine', name: 'My cut', startSec: 3, endSec: 9 })]
    })
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 20, 30)).toBe(
      'added-dropped-whole-video'
    )
    expect(names()).toEqual(['My cut', 'Highlight 1'])
  })

  it('a refused range changes nothing: no clip added, none retired, no undo step', () => {
    const before = useVideoStore.getState().clips
    for (const [a, b] of [
      [15, 5],
      [5, 5],
      [NaN, 5],
      [0, Infinity]
    ] as const) {
      expect(useVideoStore.getState().addScannedClip('bad', a, b)).toBe('refused')
    }
    expect(useVideoStore.getState().clips).toBe(before)
    expect(useVideoStore.getState().history.past).toHaveLength(0)
    useVideoStore.setState({ source: null })
    expect(useVideoStore.getState().addScannedClip('orphan', 5, 15)).toBe('refused')
  })

  it('an open coalescing run does not swallow the step', () => {
    // Speed dragged away and back leaves the clip pristine with a speed:
    // history key still open — the scanner add must still be its own step.
    useVideoStore.getState().setClipSpeed('whole', 2)
    useVideoStore.getState().setClipSpeed('whole', 1)
    expect(useVideoStore.getState().historyKey).toBe('speed:whole')
    const depth = useVideoStore.getState().history.past.length
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe(
      'added-dropped-whole-video'
    )
    expect(useVideoStore.getState().history.past.length).toBe(depth + 1)
    useVideoStore.getState().undo()
    expect(names()).toEqual(['Clip 1'])
    expect(useVideoStore.getState().clips[0]?.speedMultiplier).toBe(1)
  })

  it('the manual paths never retire it: "+ Add clip" and addClipFromRange', () => {
    useVideoStore.getState().addClip()
    expect(names()).toEqual(['Clip 1', 'Clip 2'])
    expect(useVideoStore.getState().addClipFromRange('Hand-made', 5, 15)).toBe(true)
    expect(names()).toEqual(['Clip 1', 'Clip 2', 'Hand-made'])
  })
})
