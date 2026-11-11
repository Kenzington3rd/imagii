import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  NO_SOUND_MESSAGE,
  isPristineWholeVideoClip,
  playableDuration,
  playheadNow,
  videoDiscardMessage,
  videoHasNoSound,
  videoSessionHasLoss,
  videoKey,
  holdTranscriptFor,
  useVideoStore
} from './videoStore'
import type { VideoSource } from './videoStore'
import { DEFAULT_COLOR_GRADE, clipRecipe, type Clip } from '@shared/clip'
import { isValidTextOverlay } from '@shared/projectValidation'
import { newTextOverlay } from '@shared/textOverlay'
import { assertOptionalClipRecipe } from '@shared/validators'

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

// T-101: `addClipFromRange` had no caller outside these tests, so it was deleted
// and the range rules it shared with the scanners' add are pinned where the
// product reaches them. `appendRange` is the one implementation of "add a clip
// from a range"; `addScannedClip` is its only caller. With no whole-video clip
// in the list (every block below starts from `clips: []`) the scanner's add
// retires nothing, so it is the plain add these guards were written for.
describe('addScannedClip — reversed-range guard (Phase 2.12)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null
    })
  })

  it('adds a clip when range is well-formed', () => {
    useVideoStore.getState().addScannedClip('valid', 5, 15)
    const clips = useVideoStore.getState().clips
    expect(clips).toHaveLength(1)
    expect(clips[0]?.startSec).toBe(5)
    expect(clips[0]?.endSec).toBe(15)
  })

  it('rejects reversed range (start >= end) silently', () => {
    useVideoStore.getState().addScannedClip('reversed', 15, 5)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('rejects equal start and end', () => {
    useVideoStore.getState().addScannedClip('zero-length', 5, 5)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('rejects non-finite values', () => {
    useVideoStore.getState().addScannedClip('nan', NaN, 5)
    useVideoStore.getState().addScannedClip('inf', 0, Infinity)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('clamps a range that extends past the source duration', () => {
    useVideoStore.getState().addScannedClip('overrun', -5, 999)
    const clip = useVideoStore.getState().clips[0]
    expect(clip).toBeDefined()
    expect(clip?.startSec).toBe(0)
    expect(clip?.endSec).toBe(60) // FAKE_SOURCE.probe.duration
  })

  it('does nothing when no source is loaded', () => {
    useVideoStore.setState({ source: null, clips: [] })
    useVideoStore.getState().addScannedClip('orphan', 5, 15)
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })
})

// T-48 regression: the guards above reject in silence, and every caller
// used to toast "Clip added" regardless — a success message for a clip
// that was never added. The answer is now the return value, and it has to
// track the clips list exactly, in both directions.
describe('addScannedClip — return value reports what actually happened (T-48)', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null
    })
  })

  it("answers 'added' only when a clip really joined the list", () => {
    expect(useVideoStore.getState().addScannedClip('valid', 5, 15)).toBe('added')
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })

  it("answers 'refused' for every refusal, and adds nothing", () => {
    const add = (name: string, a: number, b: number): string =>
      useVideoStore.getState().addScannedClip(name, a, b)
    expect(add('reversed', 15, 5)).toBe('refused')
    expect(add('zero-length', 5, 5)).toBe('refused')
    expect(add('nan', NaN, 5)).toBe('refused')
    expect(add('inf', 0, Infinity)).toBe('refused')
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it("answers 'refused' with no source loaded", () => {
    useVideoStore.setState({ source: null, clips: [] })
    expect(useVideoStore.getState().addScannedClip('orphan', 5, 15)).toBe('refused')
  })

  it("answers 'refused' for the collapsed range a past-the-end chat peak clamps to", () => {
    // ChatHighlightPanel clamps both ends to the duration, so a peak whose
    // bucket starts after the video ends arrives here as duration→duration.
    const { duration } = FAKE_SOURCE.probe
    expect(useVideoStore.getState().addScannedClip('past the end', duration, duration)).toBe(
      'refused'
    )
    expect(useVideoStore.getState().clips).toHaveLength(0)
    // …while a peak that merely runs OVER the end still lands, clamped.
    expect(useVideoStore.getState().addScannedClip('overruns', duration - 5, duration)).toBe(
      'added'
    )
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })
})

// T-131 (3): a scanner row from another video (HighlightPanel and ChatHighlightPanel kept the previous video's results when the open
// video was replaced in place) asked for a range that starts past the END of this one. The clamp turned it into a clip that begins at the
// duration and ends 0.1 s after it, and the panel said "Clip added". The panels now clear their results with the video (the e2e through
// Reframe's Edit in Video Studio proves it); this is the store's own refusal, whoever the caller is.
describe('addScannedClip — a range that starts at or past the end of the video is refused (T-131 (3))', () => {
  const { duration } = FAKE_SOURCE.probe
  beforeEach(() => {
    useVideoStore.setState({ source: FAKE_SOURCE, clips: [], selectedClipId: null })
  })

  it.each([
    ['exactly at the end', duration, duration + 10],
    ['well past the end', 900, 960],
    ['a start with less than the shortest clip left', duration - 0.05, duration + 5]
  ])('%s: refused, and no clip joins the list', (_what, start, end) => {
    expect(useVideoStore.getState().addScannedClip('stale', start, end)).toBe('refused')
    expect(useVideoStore.getState().clips).toHaveLength(0)
  })

  it('no clip ever ends past the video: a start with exactly the shortest clip left is added, ending AT the duration', () => {
    expect(useVideoStore.getState().addScannedClip('last tenth', duration - 0.1, duration + 5)).toBe('added')
    const clip = useVideoStore.getState().clips[0]
    expect(clip?.startSec).toBeCloseTo(duration - 0.1, 9)
    expect(clip?.endSec).toBeLessThanOrEqual(duration)
  })

  it('a refusal retires nothing: the untouched whole-video clip is still there and the history has no new step', () => {
    useVideoStore.setState({ clips: [pristine()] })
    const before = useVideoStore.getState().history.past.length
    expect(useVideoStore.getState().addScannedClip('stale', duration + 1, duration + 20)).toBe('refused')
    expect(useVideoStore.getState().clips).toHaveLength(1)
    expect(useVideoStore.getState().history.past.length).toBe(before)
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
 * T-112 — a transcription that finishes after the video changed belongs to the
 * video it was started on.
 *
 * The panel's transcription takes minutes and the app is not locked: transcribe A,
 * close it, drop B, and A's result arrived to `setSrtPath` — B got A's captions
 * (and "Burn into video" offered to burn them into the wrong picture). The store
 * action takes the source the job started on and applies only if that is still
 * the open one.
 */
describe('setSrtPathFor — captions go to the video they were made from (T-112)', () => {
  const VIDEO_A: VideoSource = { ...FAKE_SOURCE, filePath: '/v/a.mp4', fileName: 'a.mp4' }
  const VIDEO_B: VideoSource = { ...FAKE_SOURCE, filePath: '/v/b.mp4', fileName: 'b.mp4' }

  beforeEach(() => {
    useVideoStore.setState({ source: VIDEO_A, clips: [], selectedClipId: null, srtPath: null })
  })

  it('applies when the video the job started on is still open, and says so', () => {
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(true)
    expect(useVideoStore.getState().srtPath).toBe('/tmp/a.srt')
  })

  it('null forgets the transcript of the open video, and only of the open video (T-128 (3))', () => {
    useVideoStore.setState({ srtPath: '/tmp/a.srt' })
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', null)).toBe(true)
    expect(useVideoStore.getState().srtPath).toBeNull()
    useVideoStore.setState({ source: VIDEO_B, srtPath: '/tmp/b.srt' })
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', null)).toBe(false)
    expect(useVideoStore.getState().srtPath).toBe('/tmp/b.srt')
  })

  it('transcribe A, open B, A finishes: B gets nothing, and the store says it did not apply', () => {
    useVideoStore.setState({ source: VIDEO_B, srtPath: null })
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(false)
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('does not overwrite B\'s own captions with A\'s', () => {
    useVideoStore.setState({ source: VIDEO_B, srtPath: '/tmp/b.srt' })
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(false)
    expect(useVideoStore.getState().srtPath).toBe('/tmp/b.srt')
  })

  it('nothing open (the video was closed meanwhile) is not the video it started on', () => {
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(false)
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('the same file opened again meanwhile IS the video it started on', () => {
    useVideoStore.setState({ source: { ...VIDEO_A }, srtPath: null })
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(true)
  })

  it('works through the real loadSource: A, then B loaded, A\'s late result is refused', async () => {
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: () => Promise.resolve(FAKE_SOURCE.probe),
          fileUrl: (p: string) => `imagii-file://${p}`
        }
      }
    })
    try {
      await useVideoStore.getState().loadSource('/v/a.mp4')
      await useVideoStore.getState().loadSource('/v/b.mp4')
      expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/tmp/a.srt')).toBe(false)
      expect(useVideoStore.getState().srtPath).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * T-112 — a video with no sound has nothing to clean, transcribe or scan.
 *
 * `probe.audioCodec` is null for a file with no audio stream (the PiP overlay
 * fixture is one; so is every screen-capture clip recorded with the mic off). The
 * three audio-dependent panels ask this and say `NO_SOUND_MESSAGE`.
 */
describe('videoHasNoSound — what the audio-dependent panels ask (T-112)', () => {
  const withCodec = (audioCodec: string | null): VideoSource => ({
    ...FAKE_SOURCE,
    probe: { ...FAKE_SOURCE.probe, audioCodec }
  })

  it('a file with no audio stream has no sound', () => {
    expect(videoHasNoSound(withCodec(null))).toBe(true)
  })

  it('a file with an audio stream has sound, whatever its codec', () => {
    for (const codec of ['aac', 'mp3', 'opus', 'pcm_s16le', 'flac']) {
      expect(videoHasNoSound(withCodec(codec)), codec).toBe(false)
    }
  })

  it('no video open is not "a video with no sound" — the panels are not on screen then', () => {
    expect(videoHasNoSound(null)).toBe(false)
  })

  it('says it in the app\'s voice, as a sentence', () => {
    expect(NO_SOUND_MESSAGE).toBe('This video has no sound.')
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
    useVideoStore.getState().addScannedClip('keep', 0, 10)
    useVideoStore.getState().addScannedClip('doomed', 20, 30)
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
    useVideoStore.getState().addScannedClip('trim-me', 5, 15)
    const id = useVideoStore.getState().clips[0]!.id

    useVideoStore.getState().setClipRange(id, 8, 12)
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(8)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(12)

    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips[0]?.startSec).toBe(5)
    expect(useVideoStore.getState().clips[0]?.endSec).toBe(15)
  })

  it('redo re-applies an undone change', () => {
    useVideoStore.getState().addScannedClip('redo-me', 5, 15)
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
    useVideoStore.getState().addScannedClip('cap', 0, 60)
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
    useVideoStore.getState().addScannedClip('drag-me', 0, 30)
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
    useVideoStore.getState().addScannedClip('multi', 0, 30)
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
    useVideoStore.getState().addScannedClip('two-drags', 0, 30)
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
    useVideoStore.getState().addScannedClip('one-drag', 0, 30)
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
    useVideoStore.getState().addScannedClip('grade', 0, 30)
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
    useVideoStore.getState().addScannedClip('idle', 0, 30)
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
    useVideoStore.getState().addScannedClip('branch', 5, 15)
    const id = useVideoStore.getState().clips[0]!.id

    useVideoStore.getState().setClipRange(id, 8, 12)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().canRedo()).toBe(true)

    useVideoStore.getState().renameClip(id, 'branched')
    expect(useVideoStore.getState().canRedo()).toBe(false)
  })

  it('clearSource drops history instead of snapshotting', () => {
    useVideoStore.getState().addScannedClip('gone', 5, 15)
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

  it('the manual path never retires it: "+ Add clip" (T-101 deleted its range-taking twin)', () => {
    useVideoStore.getState().addClip()
    expect(names()).toEqual(['Clip 1', 'Clip 2'])
    useVideoStore.getState().addClip()
    expect(names()).toEqual(['Clip 1', 'Clip 2', 'Clip 3'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-113 (1) — text overlays are normalized where they are stored.
//
// The editor's default color was the NAME "white" and its placeholder invited
// "white or #ffcc00", but every overlay gate (`isValidTextOverlay`: Export,
// Compile, Save project, a project's restore) takes `#RRGGBB` only, so the
// untouched "+ Add text" overlay failed all four. The gates stay hex-only (they
// guard the IPC boundary against filter injection); the store turns a name into
// its hex before it keeps the overlay.
// ───────────────────────────────────────────────────────────────────────────
describe('text overlays reach the gates as hex (T-113)', () => {
  function oneClip(): string {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [
        {
          id: 'c1',
          name: 'Clip 1',
          startSec: 10,
          endSec: 20,
          cropRect: null,
          textOverlays: [],
          selectedPresets: ['youtube']
        }
      ],
      selectedClipId: 'c1',
      history: { past: [], future: [] },
      historyKey: null
    })
    return 'c1'
  }
  const overlays = (): Clip['textOverlays'] => useVideoStore.getState().clips[0]?.textOverlays ?? []

  it('the overlay "+ Add text" stores untouched is accepted by every gate that reads it', () => {
    const id = oneClip()
    useVideoStore.getState().addTextOverlay(id, newTextOverlay(10, 20))
    const clip = useVideoStore.getState().clips[0] as Clip
    expect(overlays()).toHaveLength(1)
    expect(isValidTextOverlay(overlays()[0])).toBe(true)
    // Compile and Export both run the recipe through this gate (video:concat, video:exportBatch).
    expect(() => assertOptionalClipRecipe({ ...clipRecipe(clip) }, 'clip')).not.toThrow()
  })

  it('a name handed to addTextOverlay is stored as its hex', () => {
    const id = oneClip()
    useVideoStore.getState().addTextOverlay(id, { ...newTextOverlay(10, 20), colorHex: 'white' })
    expect(overlays()[0]?.colorHex).toBe('#ffffff')
  })

  it('a color typed into an existing overlay is stored as hex, whatever case the name came in', () => {
    const id = oneClip()
    const s = useVideoStore.getState()
    s.addTextOverlay(id, newTextOverlay(10, 20))
    const oid = overlays()[0]?.id as string
    s.updateTextOverlay(id, oid, { colorHex: 'Gold' })
    expect(overlays()[0]?.colorHex).toBe('#ffd700')
    s.updateTextOverlay(id, oid, { colorHex: 'FFCC00' })
    expect(overlays()[0]?.colorHex).toBe('#ffcc00')
  })

  it('a color imagii cannot read leaves the stored one alone', () => {
    const id = oneClip()
    const s = useVideoStore.getState()
    s.addTextOverlay(id, newTextOverlay(10, 20))
    const oid = overlays()[0]?.id as string
    s.updateTextOverlay(id, oid, { colorHex: 'notacolor', text: 'kept' })
    expect(overlays()[0]?.colorHex).toBe('#ffffff')
    // ...and the rest of the same patch still lands.
    expect(overlays()[0]?.text).toBe('kept')
  })

  it('a size is clamped to the 8..512 the gate takes', () => {
    const id = oneClip()
    const s = useVideoStore.getState()
    s.addTextOverlay(id, { ...newTextOverlay(10, 20), sizePx: 5000 })
    expect(overlays()[0]?.sizePx).toBe(512)
    const oid = overlays()[0]?.id as string
    s.updateTextOverlay(id, oid, { sizePx: 3 })
    expect(overlays()[0]?.sizePx).toBe(8)
    s.updateTextOverlay(id, oid, { sizePx: 450 })
    expect(overlays()[0]?.sizePx).toBe(450)
    s.updateTextOverlay(id, oid, { sizePx: NaN })
    expect(overlays()[0]?.sizePx).toBe(450)
  })

  it('every state the store can hold passes the gates (a project saves, a compile compiles)', () => {
    const id = oneClip()
    const s = useVideoStore.getState()
    s.addTextOverlay(id, newTextOverlay(10, 20))
    s.addTextOverlay(id, { ...newTextOverlay(10, 20), colorHex: 'red', sizePx: 4000 })
    const oid = overlays()[0]?.id as string
    s.updateTextOverlay(id, oid, { colorHex: 'nonsense', sizePx: -9 })
    for (const o of overlays()) expect(isValidTextOverlay(o), JSON.stringify(o)).toBe(true)
  })
})

/**
 * T-119 (3) - what the video the person is editing would lose. Close has asked since round 18; T-112's
 * "Clean audio" asks before it replaces Audio Studio's work; Record's "Edit in Video Studio" replaced a tuned
 * session with nothing said. One list, one lead-in per act. T-147 (3): and nothing to ask when nothing was done to
 * the video - a loaded video always has ONE clip, so "no clips" was a state the question never met.
 */
describe('videoDiscardMessage - the question Close and Replace both ask (T-119, T-147 (3))', () => {
  /** A session as the store holds it: a loaded video with the clips given, no history and nothing derived, unless `over` says so. */
  function session(clips: Clip[], over: Partial<Pick<Parameters<typeof videoDiscardMessage>[0], 'history' | 'derived'>> = {}): Parameters<typeof videoDiscardMessage>[0] {
    return {
      source: FAKE_SOURCE,
      clips,
      history: { past: [], future: [] },
      derived: { scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null },
      ...over
    }
  }
  /** `n` clips, each one a trimmed clip (so the session has something to lose whatever the count). */
  const edited = (n: number): Clip[] => Array.from({ length: n }, (_, i) => pristine({ id: `c${i}`, name: `Clip ${i + 1}`, startSec: 1 }))

  it('asks nothing when no clip is loaded, whichever act it is', () => {
    expect(videoDiscardMessage(session([]))).toBeNull()
    expect(videoDiscardMessage(session([]), 'close')).toBeNull()
    expect(videoDiscardMessage(session([]), 'replace')).toBeNull()
    expect(videoDiscardMessage(session([]), 'close', 'A job keeps going.')).toBeNull()
  })

  it('Close keeps its round-18 sentence, counting the clips', () => {
    expect(videoDiscardMessage(session(edited(1)))).toBe('Close this video? 1 clip and its edits will be discarded.')
    expect(videoDiscardMessage(session(edited(4)), 'close')).toBe('Close this video? 4 clips and their edits will be discarded.')
  })

  it("Replace names the act: nothing is being closed when a recording's button loads another video", () => {
    expect(videoDiscardMessage(session(edited(1)), 'replace')).toBe(
      "Replace the video you're editing? 1 clip and its edits will be discarded."
    )
    expect(videoDiscardMessage(session(edited(3)), 'replace')).toBe(
      "Replace the video you're editing? 3 clips and their edits will be discarded."
    )
  })

  // T-120 (12): the pronoun agrees with the count, like the noun. "1 clip and their edits" read wrong at one.
  it('the possessive follows the count: its at one, their at any other', () => {
    expect(videoDiscardMessage(session(edited(1)))).toMatch(/ 1 clip and its edits /)
    for (const n of [2, 3, 10, 100]) {
      expect(videoDiscardMessage(session(edited(n)))).toMatch(new RegExp(` ${n} clips and their edits `))
      expect(videoDiscardMessage(session(edited(n)), 'replace')).toMatch(new RegExp(` ${n} clips and their edits `))
    }
    expect(videoDiscardMessage(session(edited(1)))).not.toMatch(/1 clip and their/)
  })

  // T-147 (3): the untouched video. This is the state every loaded video starts in.
  it('a video nobody touched has nothing to lose: no question, for Close and for a replace', () => {
    expect(videoDiscardMessage(session([pristine()]))).toBeNull()
    expect(videoDiscardMessage(session([pristine()]), 'close')).toBeNull()
    expect(videoDiscardMessage(session([pristine()]), 'replace')).toBeNull()
  })

  it('a running job alone is asked as the lead-in and the one sentence, with no clip count', () => {
    const note = 'The export that is running keeps going; its Cancel stays on screen.'
    expect(videoDiscardMessage(session([pristine()]), 'close', note)).toBe(`Close this video? ${note}`)
    expect(videoDiscardMessage(session([pristine()]), 'replace', note)).toBe(`Replace the video you're editing? ${note}`)
    // ...and with something to lose too, the sentence follows the clips it already names.
    expect(videoDiscardMessage(session(edited(2)), 'close', note)).toBe(`Close this video? 2 clips and their edits will be discarded. ${note}`)
  })

  it('what the helper counts as a loss: every kind asks, an untouched session does not', () => {
    const none = session([pristine()])
    expect(videoSessionHasLoss(none)).toBe(false)
    // a second clip
    expect(videoSessionHasLoss(session([pristine(), pristine({ id: 'b', name: 'Clip 2' })]))).toBe(true)
    // the one clip, changed (a trim is enough)
    expect(videoSessionHasLoss(session([pristine({ endSec: DURATION - 1 })]))).toBe(true)
    // an undo history with a step in it, even when the clip is back to the default
    expect(videoSessionHasLoss(session([pristine()], { history: { past: [{ clips: [pristine()], selectedClipId: null }], future: [] } }))).toBe(true)
    // a scan, a pasted log, the spikes found in one
    const derived = none.derived
    expect(videoSessionHasLoss(session([pristine()], { derived: { ...derived, scanCandidates: [] } }))).toBe(true)
    expect(videoSessionHasLoss(session([pristine()], { derived: { ...derived, highlightChat: '[0:42] a: POG' } }))).toBe(true)
    expect(videoSessionHasLoss(session([pristine()], { derived: { ...derived, spikeChat: '[0:42] a: POG' } }))).toBe(true)
    expect(videoSessionHasLoss(session([pristine()], { derived: { ...derived, spikes: [] } }))).toBe(true)
    // a transcript is cached on disk and opens again at once: not a loss
    expect(videoSessionHasLoss(session([pristine()], { derived: { ...derived, transcript: [{ startSec: 0, endSec: 2, text: 'hello' }] } }))).toBe(false)
    // an undone step leaves an empty past: nothing to lose again
    expect(videoSessionHasLoss(session([pristine()], { history: { past: [], future: [{ clips: [pristine()], selectedClipId: null }] } }))).toBe(false)
    // no video open
    expect(videoSessionHasLoss({ ...none, source: null })).toBe(false)
  })

  it('the real store: a loaded video is untouched until something is done to it', async () => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } } })
    try {
      await useVideoStore.getState().loadSource('/v/a.mp4')
      expect(videoDiscardMessage(useVideoStore.getState())).toBeNull()
      const id = useVideoStore.getState().clips[0]!.id
      useVideoStore.getState().setClipRange(id, 2, 30)
      expect(videoDiscardMessage(useVideoStore.getState())).toBe('Close this video? 1 clip and its edits will be discarded.')
      useVideoStore.getState().clearSource()
      expect(videoDiscardMessage(useVideoStore.getState())).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      useVideoStore.getState().clearSource()
    }
  })
})

/**
 * T-120 (14, 4) - what the Player lends the Timeline.
 *
 * The store's `currentTime` is written on the element's `timeupdate`, about every 250 ms during playback, so
 * a marker set from it while the video plays lands up to a quarter second behind the frame on screen; the
 * Player's own I / O read the element. The Player registers a transport (its element's exact time and its
 * own play / pause) for as long as it is mounted, and the Timeline's keys ask it: `playheadNow` for the
 * markers, `togglePlay` for Space. Without a Player there is no element, and the store's number is the answer.
 */
describe('the Player transport: exact playhead and play / pause for the Timeline (T-120)', () => {
  beforeEach(() => {
    useVideoStore.setState({ source: FAKE_SOURCE, currentTime: 1, transport: null })
  })
  afterEach(() => {
    useVideoStore.setState({ transport: null })
  })

  it('starts with no transport, and registering and unregistering is a plain set and clear', () => {
    expect(useVideoStore.getState().transport).toBeNull()
    const transport = { readTime: () => 3, togglePlay: vi.fn() }
    useVideoStore.getState().registerTransport(transport)
    expect(useVideoStore.getState().transport).toBe(transport)
    useVideoStore.getState().registerTransport(null)
    expect(useVideoStore.getState().transport).toBeNull()
  })

  it('the playhead is the element\'s time while a Player is mounted, however stale the store\'s is', () => {
    useVideoStore.setState({ currentTime: 1 })
    expect(playheadNow(useVideoStore.getState()), 'no Player: the store').toBe(1)
    let elementTime = 3.25
    useVideoStore.getState().registerTransport({ readTime: () => elementTime, togglePlay: vi.fn() })
    expect(playheadNow(useVideoStore.getState())).toBe(3.25)
    elementTime = 3.5
    expect(playheadNow(useVideoStore.getState()), 'read at the moment of the key, not at registration').toBe(3.5)
    expect(useVideoStore.getState().currentTime, 'and the store is untouched').toBe(1)
  })

  it('a Player with no element yet answers null, and the store answers instead', () => {
    useVideoStore.getState().registerTransport({ readTime: () => null, togglePlay: vi.fn() })
    expect(playheadNow(useVideoStore.getState())).toBe(1)
    // 0 is a time, not "nothing": a playhead at the very start reads 0, not the store's number.
    useVideoStore.getState().registerTransport({ readTime: () => 0, togglePlay: vi.fn() })
    useVideoStore.setState({ currentTime: 9 })
    expect(playheadNow(useVideoStore.getState())).toBe(0)
  })

  it('the registered togglePlay is the one the Timeline calls', () => {
    const togglePlay = vi.fn()
    useVideoStore.getState().registerTransport({ readTime: () => 0, togglePlay })
    useVideoStore.getState().transport?.togglePlay()
    expect(togglePlay).toHaveBeenCalledTimes(1)
  })

  it('opening or closing a video leaves the Player\'s registration alone (the Player outlives the file)', async () => {
    vi.stubGlobal('window', {
      api: { video: { probe: async () => FAKE_SOURCE.probe, fileUrl: () => 'imagii-file://x' } }
    })
    try {
      const transport = { readTime: () => 2, togglePlay: vi.fn() }
      useVideoStore.getState().registerTransport(transport)
      await useVideoStore.getState().loadSource('/another/file.mp4')
      expect(useVideoStore.getState().transport).toBe(transport)
      useVideoStore.getState().clearSource()
      expect(useVideoStore.getState().transport).toBe(transport)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * T-135 (2) - a preview copy is a way to WATCH the open video, not a different video.
 *
 * Chromium decodes what it has a decoder for (H.264, VP9, AV1), and ProRes or 10-bit HEVC probes fine, loads, plays its sound and draws
 * no picture. The Player says so and offers a copy ffmpeg converts for the preview. The copy replaces only the address the element plays:
 * `source` (its object, its `filePath` that every export reads, its probe, its clips) is untouched, so a project saved now still points at
 * the original and an export is made from the original's pixels.
 */
describe('setPreviewCopyFor - the preview plays a copy, everything else keeps the original (T-135 (2))', () => {
  const VIDEO_A: VideoSource = { ...FAKE_SOURCE, filePath: '/v/a.mov', fileName: 'a.mov', url: 'imagii-file://v/a.mov' }
  const VIDEO_B: VideoSource = { ...FAKE_SOURCE, filePath: '/v/b.mp4', fileName: 'b.mp4', url: 'imagii-file://v/b.mp4' }

  beforeEach(() => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}` } } })
    useVideoStore.setState({ source: VIDEO_A, clips: [], selectedClipId: null, previewUrl: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with no preview copy: the element plays the source itself', () => {
    expect(useVideoStore.getState().previewUrl).toBeNull()
  })

  it('applies when the video the copy was made for is still open, says so, and leaves the source object and its path alone', () => {
    const before = useVideoStore.getState().source
    expect(useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4')).toBe(true)
    expect(useVideoStore.getState().previewUrl).toBe('imagii-file:///tmp/imagii-import/a-xyz.mp4')
    expect(useVideoStore.getState().source, 'the same object: a swap would read as "replaced" to a project open waiting on this studio').toBe(before)
    expect(useVideoStore.getState().source?.filePath, 'exports and the saved project still read the original').toBe('/v/a.mov')
  })

  it('make a copy of A, open B, the copy finishes: B plays B, and the store says it did not apply', () => {
    useVideoStore.setState({ source: VIDEO_B })
    expect(useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4')).toBe(false)
    expect(useVideoStore.getState().previewUrl).toBeNull()
  })

  it('a video that was closed meanwhile takes nothing', () => {
    useVideoStore.setState({ source: null })
    expect(useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4')).toBe(false)
    expect(useVideoStore.getState().previewUrl).toBeNull()
  })

  it('clearing the source forgets the copy, so the next video starts on its own address', () => {
    useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4')
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().previewUrl).toBeNull()
  })

  it('loading another source forgets it too', async () => {
    vi.stubGlobal('window', {
      api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } }
    })
    useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4')
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().previewUrl).toBeNull()
    expect(useVideoStore.getState().source?.filePath).toBe('/v/b.mp4')
  })
})

/**
 * T-135 (4) - what the panels derive from the open video lives with the video.
 *
 * Scan candidates, the pasted chat logs and their spikes, and the transcript preview were each panel's `useState`, so leaving the studio (or
 * pressing Clean audio, which navigates) threw the lot away: the person came back to a studio that had forgotten a scan that took minutes. They are
 * store state now, and the store's own `loadSource` / `clearSource` resets keep their lifetime exactly right: a different video starts empty, the
 * same video keeps its results across any number of visits.
 */
describe('derived results - kept with the open video, gone with it (T-135 (4))', () => {
  const VIDEO_A: VideoSource = { ...FAKE_SOURCE, filePath: '/v/a.mp4', fileName: 'a.mp4' }
  const CANDIDATES = [{ startSec: 10, endSec: 20, peakDb: -4, reason: 'loud' as const }]
  const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'hello' }]

  beforeEach(() => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } } })
    useVideoStore.setState({ source: VIDEO_A, clips: [], selectedClipId: null })
    useVideoStore.getState().setDerived({ scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts empty', () => {
    expect(useVideoStore.getState().derived).toEqual({ scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null })
  })

  it('setDerived patches the fields it is given and keeps the others', () => {
    useVideoStore.getState().setDerived({ scanCandidates: CANDIDATES })
    useVideoStore.getState().setDerived({ highlightChat: '[0:42] a: POG' })
    expect(useVideoStore.getState().derived.scanCandidates).toEqual(CANDIDATES)
    expect(useVideoStore.getState().derived.highlightChat).toBe('[0:42] a: POG')
  })

  it('a result is applied to the video it was made for, and only that one (a scan that finishes after the video was replaced is dropped)', () => {
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { transcript: SEGMENTS })).toBe(true)
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
    useVideoStore.setState({ source: { ...VIDEO_A, filePath: '/v/b.mp4', fileName: 'b.mp4' } })
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { scanCandidates: CANDIDATES })).toBe(false)
    expect(useVideoStore.getState().derived.scanCandidates).toBeNull()
    useVideoStore.setState({ source: null })
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { scanCandidates: CANDIDATES })).toBe(false)
  })

  it('loading another video starts its results empty - all five fields', async () => {
    useVideoStore.getState().setDerived({ scanCandidates: CANDIDATES, highlightChat: 'x', spikeChat: 'y', spikes: [], transcript: SEGMENTS })
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().derived).toEqual({ scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null })
  })

  it('closing the video clears them too', () => {
    useVideoStore.getState().setDerived({ scanCandidates: CANDIDATES, spikeChat: 'y', transcript: SEGMENTS })
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().derived.scanCandidates).toBeNull()
    expect(useVideoStore.getState().derived.spikeChat).toBe('')
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('what a panel leaves behind when it unmounts is still there when the next one mounts (nothing to reset on mount)', () => {
    useVideoStore.getState().setDerived({ scanCandidates: CANDIDATES })
    // "Leaving the studio" is no store event at all: the next reader sees the same results.
    expect(useVideoStore.getState().derived.scanCandidates).toEqual(CANDIDATES)
  })
})

/**
 * T-136 (2), (6) - what travels with the preview copy and what the Output preview is told.
 *
 * The playhead a preview copy resumes at was a ref of the Player instance that asked for the copy: when the copy finished after a trip to Home that
 * instance was gone, and the picture restarted at 0:00. It is the store's now (`previewResumeAt`, set in the same update as `previewUrl`, taken once by
 * whichever element reads it). And the Player's "I cannot draw this picture" is the store's too (`noPicture`), so the Output preview, which mirrors the
 * Player's element onto a canvas, can say why its canvas is black.
 */
describe('previewResumeAt - the playhead a preview copy resumes at (T-136 (2))', () => {
  const VIDEO_A: VideoSource = { ...FAKE_SOURCE, filePath: '/v/a.mov', fileName: 'a.mov', url: 'imagii-file://v/a.mov' }

  beforeEach(() => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } } })
    useVideoStore.setState({ source: VIDEO_A, clips: [], selectedClipId: null, previewUrl: null, previewResumeAt: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is set together with the copy and taken once: the first element to ask gets it, the next gets nothing', () => {
    expect(useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4', 41.5)).toBe(true)
    expect(useVideoStore.getState().previewResumeAt).toBe(41.5)
    expect(useVideoStore.getState().takePreviewResume()).toBe(41.5)
    expect(useVideoStore.getState().takePreviewResume(), 'taken: a later remount starts at 0, as any remount does').toBeNull()
    expect(useVideoStore.getState().previewUrl, 'the copy itself stays').toBe('imagii-file:///tmp/imagii-import/a-xyz.mp4')
  })

  it('a playhead at the start (or no playhead, or one that is not a time) is nothing to resume to', () => {
    for (const at of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4', at)
      expect(useVideoStore.getState().previewResumeAt, String(at)).toBeNull()
    }
  })

  it('a copy for a video that is no longer open stores no position either', () => {
    useVideoStore.setState({ source: null })
    expect(useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4', 12)).toBe(false)
    expect(useVideoStore.getState().previewResumeAt).toBeNull()
  })

  it('closing the video or loading another drops a position nobody took', async () => {
    useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4', 12)
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().previewResumeAt).toBeNull()
    useVideoStore.setState({ source: VIDEO_A })
    useVideoStore.getState().setPreviewCopyFor('/v/a.mov', '/tmp/imagii-import/a-xyz.mp4', 12)
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().previewResumeAt).toBeNull()
  })
})

describe('noPicture - the Player\'s verdict, shared with the Output preview (T-136 (6))', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } } })
    useVideoStore.setState({ source: FAKE_SOURCE, noPicture: false })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts false and is set and cleared by the Player', () => {
    expect(useVideoStore.getState().noPicture).toBe(false)
    useVideoStore.getState().setNoPicture(true)
    expect(useVideoStore.getState().noPicture).toBe(true)
    useVideoStore.getState().setNoPicture(false)
    expect(useVideoStore.getState().noPicture).toBe(false)
  })

  it('saying the same thing again changes nothing (no store event, so no re-render of what listens)', () => {
    useVideoStore.getState().setNoPicture(true)
    let events = 0
    const off = useVideoStore.subscribe(() => events++)
    useVideoStore.getState().setNoPicture(true)
    off()
    expect(events).toBe(0)
  })

  it('closing the video and loading another both clear it: a new file is judged on its own', async () => {
    useVideoStore.getState().setNoPicture(true)
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().noPicture).toBe(false)
    useVideoStore.getState().setNoPicture(true)
    await useVideoStore.getState().loadSource('/v/other.mp4')
    expect(useVideoStore.getState().noPicture).toBe(false)
  })
})

// ── T-137 (11): pruneCustomPresets tolerates a field that is not a list ─────────────────────────────────────────────────────────────────
//
// The validator now drops a non-list `customPresetIds` before a project reaches the store, but the prune is the other half of "the Export panel
// cannot throw": it runs on every visit to Export with whatever the clips hold (`c.customPresetIds.some(...)` threw on a number, an object, true).

describe('pruneCustomPresets - a clip whose customPresetIds is not a list (T-137 (11))', () => {
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null,
      history: { past: [], future: [] },
      historyKey: null
    })
  })
  const clipWith = (id: string, customPresetIds: unknown): Clip =>
    ({ id, name: id, startSec: 0, endSec: 5, cropRect: null, textOverlays: [], selectedPresets: ['youtube'], customPresetIds }) as unknown as Clip

  it.each([
    ['a number', 5],
    ['an object', { a: 1 }],
    ['true', true],
    ['a string', 'cp-a'],
    ['null', null]
  ])('%s: the prune does not throw, and the clip comes out with no custom presets queued', (_what, bad) => {
    useVideoStore.setState({ clips: [clipWith('bad', bad), clipWith('good', ['cp-a', 'cp-b'])] })
    expect(() => useVideoStore.getState().pruneCustomPresets(['cp-a'])).not.toThrow()
    const [badClip, goodClip] = useVideoStore.getState().clips
    expect(badClip?.customPresetIds ?? []).toEqual([])
    expect(Array.isArray(badClip?.customPresetIds) || badClip?.customPresetIds === undefined).toBe(true)
    expect(goodClip?.customPresetIds, 'the next clip is pruned as usual').toEqual(['cp-a'])
  })

  it('entries that are not strings are dropped with the ids whose preset is gone', () => {
    useVideoStore.setState({ clips: [clipWith('mixed', ['cp-a', 3, null, 'cp-gone'])] })
    useVideoStore.getState().pruneCustomPresets(['cp-a'])
    expect(useVideoStore.getState().clips[0]?.customPresetIds).toEqual(['cp-a'])
  })

  it('a list that needs nothing is still left alone, identity included (the control: the no-op path does not churn subscribers)', () => {
    useVideoStore.setState({ clips: [clipWith('fine', ['cp-a'])] })
    const before = useVideoStore.getState().clips
    useVideoStore.getState().pruneCustomPresets(['cp-a', 'cp-b'])
    expect(useVideoStore.getState().clips).toBe(before)
  })

  it('still not an undo step', () => {
    useVideoStore.setState({ clips: [clipWith('bad', 5)] })
    const depth = useVideoStore.getState().history.past.length
    useVideoStore.getState().pruneCustomPresets([])
    expect(useVideoStore.getState().history.past.length).toBe(depth)
  })
})

// T-150 (3): "+ Clip" on a scanner row took every press, so a double-click or a held Enter appended identical clips, each with a toast and an undo
// step. The panels now drop the second press of a double-click (`isRepeatPress`); the store refuses the same range itself, which also closes the
// held Enter (a keyboard click has no click count).
describe('addScannedClip — the same range twice is one clip (T-150 (3))', () => {
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

  it('a second add of the same range answers duplicate and adds nothing, no clip and no undo step', () => {
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe('added-dropped-whole-video')
    const afterFirst = useVideoStore.getState()
    expect(useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)).toBe('duplicate')
    const s = useVideoStore.getState()
    expect(s.clips).toHaveLength(1)
    expect(s.clips).toBe(afterFirst.clips)
    expect(s.history.past).toHaveLength(1)
    expect(s.selectedClipId).toBe(afterFirst.selectedClipId)
  })

  it('the range compared is the CLAMPED one: two reaches past the end are the same clip', () => {
    expect(useVideoStore.getState().addScannedClip('a', 50, 70)).toBe('added-dropped-whole-video')
    expect(useVideoStore.getState().addScannedClip('b', 50, 99)).toBe('duplicate')
    expect(useVideoStore.getState().clips).toHaveLength(1)
  })

  it('a different range is still added, and a clip the person made by hand with this range counts too (clips carry no origin)', () => {
    useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)
    expect(useVideoStore.getState().addScannedClip('Highlight 2', 5, 16)).toBe('added')
    expect(useVideoStore.getState().addScannedClip('Highlight 3', 6, 15)).toBe('added')
    expect(useVideoStore.getState().clips).toHaveLength(3)
    expect(useVideoStore.getState().addScannedClip('again', 5, 16)).toBe('duplicate')
    expect(useVideoStore.getState().clips).toHaveLength(3)
  })

  it('the untouched whole-video clip is not "a clip with that range": a candidate that spans the whole video still retires it and is added', () => {
    expect(useVideoStore.getState().addScannedClip('whole candidate', 0, 60)).toBe('added-dropped-whole-video')
    expect(useVideoStore.getState().clips.map((c) => c.name)).toEqual(['whole candidate'])
  })

  it('undo after a refused duplicate takes back the one real add, not a phantom step', () => {
    const before = useVideoStore.getState().clips
    useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)
    useVideoStore.getState().addScannedClip('Highlight 1', 5, 15)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().clips).toEqual(before)
  })
})

describe('the I and O keys never make a clip with no length (T-152 (4))', () => {
  const D = 60
  const setup = (probeDuration = D): string => {
    useVideoStore.setState({
      source: { ...FAKE_SOURCE, probe: { ...FAKE_SOURCE.probe, duration: probeDuration } },
      clips: [],
      selectedClipId: null,
      srtPath: null,
      history: { past: [], future: [] },
      historyKey: null
    })
    if (probeDuration >= 1) useVideoStore.getState().addScannedClip('c', 10, 20)
    else useVideoStore.setState({ clips: [pristine({ id: 'tiny', endSec: probeDuration })], selectedClipId: 'tiny' })
    return useVideoStore.getState().clips[0]!.id
  }
  const range = (id: string): [number, number] => {
    const c = useVideoStore.getState().clips.find((x) => x.id === id)!
    return [c.startSec, c.endSec]
  }

  it('O at 0:00 (setClipEnd 0) keeps 0.1 s: [0, 0.1], not [0, 0]', () => {
    const id = setup()
    useVideoStore.getState().setClipEnd(id, 0)
    expect(range(id)).toEqual([0, 0.1])
  })

  it('I at the very end (setClipStart D) keeps 0.1 s: [D - 0.1, D], not [D, D]', () => {
    const id = setup()
    useVideoStore.getState().setClipStart(id, D)
    const [s, e] = range(id)
    expect(s).toBeCloseTo(D - 0.1, 10)
    expect(e).toBe(D)
  })

  it('I past the end and O before the start are held to the same floor', () => {
    const id = setup()
    useVideoStore.getState().setClipStart(id, D + 5)
    expect(range(id)[1] - range(id)[0]).toBeGreaterThanOrEqual(0.1 - 1e-9)
    expect(range(id)[1]).toBe(D)
    useVideoStore.getState().setClipEnd(id, -3)
    expect(range(id)).toEqual([0, 0.1])
  })

  it('a mid-clip I or O is exactly what was pressed (the floor changes nothing there)', () => {
    const id = setup()
    useVideoStore.getState().setClipStart(id, 12.5)
    expect(range(id)).toEqual([12.5, 20])
    useVideoStore.getState().setClipEnd(id, 30)
    expect(range(id)).toEqual([12.5, 30])
    // an I past the clip's end moves the end out with it, as before
    useVideoStore.getState().setClipStart(id, 40)
    expect(range(id)[0]).toBe(40)
    expect(range(id)[1]).toBeCloseTo(40.1, 10)
  })

  it('a Timeline drag (setClipRange) is unchanged, including a range of exactly 0.1 s', () => {
    const id = setup()
    useVideoStore.getState().setClipRange(id, 8, 12)
    expect(range(id)).toEqual([8, 12])
    useVideoStore.getState().setClipRange(id, 8, 8.1)
    expect(range(id)).toEqual([8, 8.1])
    useVideoStore.getState().setClipRange(id, 30, 75)
    expect(range(id)).toEqual([30, D])
  })

  it('each key press is one undo step, and undo brings the old range back', () => {
    const id = setup()
    useVideoStore.getState().setClipEnd(id, 0)
    expect(useVideoStore.getState().history.past).toHaveLength(2) // the add, then the O
    useVideoStore.getState().undo()
    expect(range(id)).toEqual([10, 20])
  })

  it('a source shorter than 0.1 s keeps the old clamp (no room for a floor)', () => {
    const id = setup(0.05)
    useVideoStore.getState().setClipRange(id, 0, 0.05)
    useVideoStore.getState().setClipEnd(id, 0)
    expect(range(id)).toEqual([0, 0])
    useVideoStore.getState().setClipStart(id, 0.05)
    expect(range(id)).toEqual([0.05, 0.05])
  })
})

/**
 * T-161 (5) - Close names what is lost. Since T-147 (3) a session with only a scan, a pasted log, found spikes or undo steps is a loss, but the question
 * always read "N clip(s) and its/their edits": a person who ran Scan VOD and edited nothing was told their edits go and not that the scan goes. The list is
 * built as Audio Studio's Close builds its own: the clips and their edits only when the clips changed, then the scan, the log, the spikes, the undo history
 * (only when it is the one loss).
 */
describe('videoDiscardMessage - names what is lost, not always "edits" (T-161 (5))', () => {
  function session(clips: Clip[], over: Partial<Pick<Parameters<typeof videoDiscardMessage>[0], 'history' | 'derived'>> = {}): Parameters<typeof videoDiscardMessage>[0] {
    return {
      source: FAKE_SOURCE,
      clips,
      history: { past: [], future: [] },
      derived: { scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null },
      ...over
    }
  }
  const base = session([pristine()]).derived
  const withDerived = (patch: Partial<typeof base>, clips: Clip[] = [pristine()]) => session(clips, { derived: { ...base, ...patch } })
  const step = { clips: [pristine()], selectedClipId: null }

  it('a scan alone: the scan\'s results, and no mention of edits', () => {
    const msg = videoDiscardMessage(withDerived({ scanCandidates: [] }))
    expect(msg).toBe("Close this video? The scan's results will be discarded.")
    expect(msg).not.toMatch(/edits|clip/)
  })

  it('a pasted chat log alone, in either finder', () => {
    expect(videoDiscardMessage(withDerived({ highlightChat: '[0:42] a: POG' }))).toBe('Close this video? The pasted chat log will be discarded.')
    expect(videoDiscardMessage(withDerived({ spikeChat: '[0:42] a: POG' }))).toBe('Close this video? The pasted chat log will be discarded.')
    // both boxes filled is still one phrase
    expect(videoDiscardMessage(withDerived({ highlightChat: 'x', spikeChat: 'y' }))).toBe('Close this video? The pasted chat log will be discarded.')
  })

  it('the spikes found alone', () => {
    expect(videoDiscardMessage(withDerived({ spikes: [] }))).toBe('Close this video? The chat spikes found will be discarded.')
  })

  it('undo steps alone (edits made and undone back to the start): the undo history', () => {
    expect(videoDiscardMessage(session([pristine()], { history: { past: [step], future: [] } }))).toBe('Close this video? Your undo history will be discarded.')
  })

  it('the undo history is named only when nothing else is lost', () => {
    const msg = videoDiscardMessage({ ...withDerived({ scanCandidates: [] }), history: { past: [step], future: [] } })
    expect(msg).toBe("Close this video? The scan's results will be discarded.")
    expect(msg).not.toMatch(/undo/)
  })

  it('two losses read as "A and B", three as "A, B and C", for a replace too', () => {
    expect(videoDiscardMessage(withDerived({ scanCandidates: [], highlightChat: 'x' }))).toBe("Close this video? The scan's results and the pasted chat log will be discarded.")
    expect(videoDiscardMessage(withDerived({ scanCandidates: [], highlightChat: 'x', spikes: [] }), 'replace')).toBe(
      "Replace the video you're editing? The scan's results, the pasted chat log and the chat spikes found will be discarded."
    )
  })

  it('changed clips keep their sentence and lead the list', () => {
    expect(videoDiscardMessage(withDerived({}, [pristine({ startSec: 1 })]))).toBe('Close this video? 1 clip and its edits will be discarded.')
    expect(videoDiscardMessage(withDerived({ scanCandidates: [] }, [pristine({ startSec: 1 })]))).toBe(
      "Close this video? 1 clip and its edits and the scan's results will be discarded."
    )
    expect(videoDiscardMessage(withDerived({ spikes: [] }, edited2()))).toBe('Close this video? 2 clips and their edits and the chat spikes found will be discarded.')
  })
  function edited2(): Clip[] {
    return [pristine({ id: 'a', startSec: 1 }), pristine({ id: 'b', name: 'Clip 2' })]
  }

  it('the running-job sentence still follows the list; a job alone is still the lead-in and the sentence', () => {
    const note = 'The export that is running keeps going; its Cancel stays on screen.'
    expect(videoDiscardMessage(withDerived({ scanCandidates: [] }), 'close', note)).toBe(`Close this video? The scan's results will be discarded. ${note}`)
    expect(videoDiscardMessage(session([pristine()]), 'close', note)).toBe(`Close this video? ${note}`)
  })
})

// T-166 (3): a crop, color, range or overlay edit that changes nothing pushed an undo step that undoes nothing (removeClip's guard, T-149 (4), is the same
// class). Each setter returns before `snapshot` when the stored value already equals the new one: no `set` at all, so `history` is the SAME object afterwards
// and the coalescing key is untouched. Every "unchanged" case below was red before the guards; every control proves a real change still pushes ONE step.
describe('T-166 (3): an edit that changes nothing pushes no undo step', () => {
  let id = ''
  beforeEach(() => {
    useVideoStore.setState({
      source: FAKE_SOURCE,
      clips: [],
      selectedClipId: null,
      history: { past: [], future: [] },
      historyKey: null
    })
    useVideoStore.getState().addClip()
    id = useVideoStore.getState().clips[0]!.id
    // addClip is itself a step: the cases below look at what happens AFTER it.
    useVideoStore.setState({ history: { past: [], future: [] }, historyKey: null })
  })

  /** Runs `edit` and says whether it left `history` and `historyKey` exactly as they were. */
  function leavesHistoryAlone(edit: () => void): boolean {
    const before = useVideoStore.getState()
    const { history, historyKey, clips } = before
    edit()
    const after = useVideoStore.getState()
    return after.history === history && after.historyKey === historyKey && after.clips === clips
  }

  const clip = () => useVideoStore.getState().clips[0]!

  it('clearing a crop that is not there (the Crop box ticked then unticked, Reset with no crop) pushes nothing', () => {
    expect(clip().cropRect).toBeNull()
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipCrop(id, null))).toBe(true)
    expect(useVideoStore.getState().canUndo()).toBe(false)
  })

  it('the same crop rectangle again pushes nothing; a different one pushes exactly one step', () => {
    useVideoStore.getState().setClipCrop(id, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    useVideoStore.getState().endGesture()
    expect(useVideoStore.getState().history.past).toHaveLength(1)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipCrop(id, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }))).toBe(true)
    useVideoStore.getState().setClipCrop(id, { x: 0.1, y: 0.1, w: 0.5, h: 0.6 })
    expect(useVideoStore.getState().history.past).toHaveLength(2)
    expect(clip().cropRect).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.6 })
  })

  it('clearing a crop that exists is a real change: one step, and Undo brings the crop back', () => {
    useVideoStore.getState().setClipCrop(id, { x: 0, y: 0, w: 0.5, h: 0.5 })
    useVideoStore.getState().endGesture()
    useVideoStore.getState().setClipCrop(id, null)
    expect(useVideoStore.getState().history.past).toHaveLength(2)
    useVideoStore.getState().undo()
    expect(clip().cropRect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
  })

  it('the default grade on a clip with no grade (Reset color on an untouched clip), and the current grade again, push nothing', () => {
    expect(clip().colorGrade).toBeUndefined()
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipColorGrade(id, DEFAULT_COLOR_GRADE))).toBe(true)
    useVideoStore.getState().setClipColorGrade(id, { ...DEFAULT_COLOR_GRADE, brightness: 0.2 })
    useVideoStore.getState().endGesture()
    expect(useVideoStore.getState().history.past).toHaveLength(1)
    const current = clip().colorGrade!
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipColorGrade(id, { ...current }))).toBe(true)
    expect(useVideoStore.getState().history.past).toHaveLength(1)
  })

  it('a grade that differs in ONE field pushes exactly one step (control); Reset color on a graded clip is a real change', () => {
    useVideoStore.getState().setClipColorGrade(id, { ...DEFAULT_COLOR_GRADE, temperature: 0.3 })
    useVideoStore.getState().endGesture()
    expect(useVideoStore.getState().history.past).toHaveLength(1)
    useVideoStore.getState().setClipColorGrade(id, DEFAULT_COLOR_GRADE)
    expect(useVideoStore.getState().history.past).toHaveLength(2)
    expect(clip().colorGrade).toEqual(DEFAULT_COLOR_GRADE)
  })

  it('In at the clip\'s own start, Out at its own end, and the same range again push nothing', () => {
    expect(clip().startSec).toBe(0)
    expect(clip().endSec).toBe(60)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipStart(id, 0))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipEnd(id, 60))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipRange(id, 0, 60))).toBe(true)
    expect(useVideoStore.getState().canUndo()).toBe(false)
  })

  it('a trimmed clip: its own In and Out again push nothing, a different one pushes exactly one step', () => {
    useVideoStore.getState().setClipRange(id, 10, 50)
    useVideoStore.getState().endGesture()
    expect(useVideoStore.getState().history.past).toHaveLength(1)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipStart(id, 10))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipEnd(id, 50))).toBe(true)
    useVideoStore.getState().setClipStart(id, 12)
    expect(useVideoStore.getState().history.past).toHaveLength(2)
    expect(clip().startSec).toBe(12)
    useVideoStore.getState().undo()
    expect(clip().startSec).toBe(10)
    // Out alone is a real change too (the start is unchanged, so a guard that compared only the start would swallow it).
    useVideoStore.getState().endGesture()
    useVideoStore.getState().setClipEnd(id, 40)
    expect(useVideoStore.getState().history.past).toHaveLength(2)
    expect(clip().endSec).toBe(40)
  })

  it('an unknown clip id changes nothing, for each of the guarded setters', () => {
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipCrop('nope', { x: 0, y: 0, w: 0.5, h: 0.5 }))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipColorGrade('nope', { ...DEFAULT_COLOR_GRADE, brightness: 0.4 }))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipRange('nope', 5, 9))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipSpeed('nope', 2))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().updateTextOverlay('nope', 'x', { text: 'hi' }))).toBe(true)
  })

  it('speed: Reset to 1x on a clip at normal speed pushes nothing; a real speed pushes one step', () => {
    expect(clip().speedMultiplier).toBeUndefined()
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipSpeed(id, 1))).toBe(true)
    useVideoStore.getState().setClipSpeed(id, 2)
    expect(useVideoStore.getState().history.past).toHaveLength(1)
    useVideoStore.getState().endGesture()
    expect(leavesHistoryAlone(() => useVideoStore.getState().setClipSpeed(id, 2))).toBe(true)
    useVideoStore.getState().setClipSpeed(id, 1)
    expect(useVideoStore.getState().history.past).toHaveLength(2)
  })

  it('a text overlay edit that stores what is already stored pushes nothing; a real one pushes one step', () => {
    useVideoStore.getState().addTextOverlay(id, { text: 'Hello', font: 'Arial', sizePx: 48, colorHex: '#ffffff', x: 0.5, y: 0.5, startSec: 0, endSec: 5 })
    const overlay = clip().textOverlays[0]!
    useVideoStore.getState().endGesture()
    const depth = useVideoStore.getState().history.past.length
    expect(leavesHistoryAlone(() => useVideoStore.getState().updateTextOverlay(id, overlay.id, { colorHex: overlay.colorHex }))).toBe(true)
    expect(leavesHistoryAlone(() => useVideoStore.getState().updateTextOverlay(id, overlay.id, { text: 'Hello', sizePx: overlay.sizePx }))).toBe(true)
    expect(useVideoStore.getState().history.past).toHaveLength(depth)
    useVideoStore.getState().updateTextOverlay(id, overlay.id, { text: 'Hello!' })
    expect(useVideoStore.getState().history.past).toHaveLength(depth + 1)
    expect(clip().textOverlays[0]!.text).toBe('Hello!')
    // One field the same and one different is a change (a guard that asked "any field equal" would swallow it).
    useVideoStore.getState().endGesture()
    useVideoStore.getState().updateTextOverlay(id, overlay.id, { text: 'Hello!', sizePx: overlay.sizePx + 1 })
    expect(useVideoStore.getState().history.past).toHaveLength(depth + 2)
    expect(clip().textOverlays[0]!.sizePx).toBe(overlay.sizePx + 1)
  })

  // The guard compares the NORMALIZED patch (a color name becomes its hex, a size is clamped), because that is what would be stored: the editor commits
  // "white" over #ffffff and a size past the ceiling (OVERLAY_SIZE_MAX, 512, projectValidation.ts) over an overlay already at it.
  it('a color name that normalizes to the stored hex pushes nothing; another color pushes one step', () => {
    useVideoStore.getState().addTextOverlay(id, { text: 'Hi', font: 'Arial', sizePx: 512, colorHex: '#ffffff', x: 0.5, y: 0.5, startSec: 0, endSec: 5 })
    const oid = clip().textOverlays[0]!.id
    useVideoStore.getState().endGesture()
    const depth = useVideoStore.getState().history.past.length
    expect(leavesHistoryAlone(() => useVideoStore.getState().updateTextOverlay(id, oid, { colorHex: 'white' }))).toBe(true)
    useVideoStore.getState().updateTextOverlay(id, oid, { colorHex: 'red' })
    expect(useVideoStore.getState().history.past).toHaveLength(depth + 1)
    expect(clip().textOverlays[0]!.colorHex).not.toBe('#ffffff')
  })

  it('a size past the ceiling on an overlay already at it (the clamp stores the same number) pushes nothing', () => {
    useVideoStore.getState().addTextOverlay(id, { text: 'Hi', font: 'Arial', sizePx: 512, colorHex: '#ffffff', x: 0.5, y: 0.5, startSec: 0, endSec: 5 })
    const oid = clip().textOverlays[0]!.id
    useVideoStore.getState().endGesture()
    expect(leavesHistoryAlone(() => useVideoStore.getState().updateTextOverlay(id, oid, { sizePx: 512 + 50 }))).toBe(true)
    expect(clip().textOverlays[0]!.sizePx).toBe(512)
  })
})

/**
 * T-172 (2): "the same video" is the original the person opened. A converted import's working copy is `<base>-<nanoid8>.mp4`, NEW on every open, so closing
 * stream.flv and opening it again changes `filePath` and nothing the person would call a different video. The three `set*For` guards take `videoKey(source)`.
 */
describe('videoKey - one identity for the same video (T-172 (2))', () => {
  const COPY_1 = '/tmp/imports/stream-aB3dE5fG.mp4'
  const COPY_2 = '/tmp/imports/stream-Zx9Kp2Lm.mp4'
  const ORIGINAL = '/media/stream.flv'
  const CANDIDATES = [{ startSec: 10, endSec: 20, peakDb: -4, reason: 'loud' as const }]
  const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'hello' }]

  beforeEach(() => {
    vi.stubGlobal('window', { api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => FAKE_SOURCE.probe } } })
    useVideoStore.getState().clearSource()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the file itself for a plain file, and the ORIGINAL for a converted import (never the working copy)', () => {
    expect(videoKey({ filePath: '/v/a.mp4' })).toBe('/v/a.mp4')
    expect(videoKey({ filePath: COPY_1, convertedFrom: ORIGINAL })).toBe(ORIGINAL)
    expect(videoKey({ filePath: COPY_1, convertedFrom: ORIGINAL })).toBe(videoKey({ filePath: COPY_2, convertedFrom: ORIGINAL }))
    expect(videoKey({ filePath: COPY_1, convertedFrom: ORIGINAL })).not.toBe(videoKey({ filePath: COPY_1, convertedFrom: '/media/other.flv' }))
  })

  it('a loaded converted import has the original as its key, and a second open of it has the same one', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    const first = useVideoStore.getState().source!
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    const second = useVideoStore.getState().source!
    expect(second.filePath, 'a new working copy').not.toBe(first.filePath)
    expect(videoKey(second)).toBe(videoKey(first))
    expect(videoKey(second)).toBe(ORIGINAL)
  })

  it('setDerivedFor lands a result on the same original re-opened (a new working copy), and refuses a different original', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    const startedKey = videoKey(useVideoStore.getState().source!)
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().setDerivedFor(startedKey, { scanCandidates: CANDIDATES })).toBe(true)
    expect(useVideoStore.getState().derived.scanCandidates).toEqual(CANDIDATES)
    // Control: a DIFFERENT original is another video, converted or not.
    await useVideoStore.getState().loadSource('/tmp/imports/other-Qq1Ww2Ee.mp4', '/media/other.flv')
    expect(useVideoStore.getState().setDerivedFor(startedKey, { transcript: SEGMENTS })).toBe(false)
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('setSrtPathFor lands on the same original re-opened, and refuses a different original (and a closed video)', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    const startedKey = videoKey(useVideoStore.getState().source!)
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().setSrtPathFor(startedKey, '/tmp/stream.srt')).toBe(true)
    expect(useVideoStore.getState().srtPath).toBe('/tmp/stream.srt')
    expect(useVideoStore.getState().setSrtPathFor(startedKey, null), 'null forgets it, under the same rule').toBe(true)
    expect(useVideoStore.getState().srtPath).toBeNull()
    await useVideoStore.getState().loadSource('/tmp/imports/other-Qq1Ww2Ee.mp4', '/media/other.flv')
    expect(useVideoStore.getState().setSrtPathFor(startedKey, '/tmp/stream.srt')).toBe(false)
    expect(useVideoStore.getState().srtPath).toBeNull()
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().setSrtPathFor(startedKey, '/tmp/stream.srt')).toBe(false)
  })

  it('setPreviewCopyFor lands on the same original re-opened, and refuses a different original', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    const startedKey = videoKey(useVideoStore.getState().source!)
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().setPreviewCopyFor(startedKey, '/tmp/imports/preview-Aa1Bb2Cc.mp4', 12)).toBe(true)
    expect(useVideoStore.getState().previewUrl).toBe('imagii-file:///tmp/imports/preview-Aa1Bb2Cc.mp4')
    await useVideoStore.getState().loadSource('/tmp/imports/other-Qq1Ww2Ee.mp4', '/media/other.flv')
    expect(useVideoStore.getState().setPreviewCopyFor(startedKey, '/tmp/imports/preview-Dd3Ee4Ff.mp4')).toBe(false)
    expect(useVideoStore.getState().previewUrl).toBeNull()
  })

  it('the guards take the ORIGINAL\'s path for a converted import (a literal key: red for the guard itself, apart from `videoKey`)', async () => {
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().setDerivedFor(ORIGINAL, { scanCandidates: CANDIDATES })).toBe(true)
    expect(useVideoStore.getState().setSrtPathFor(ORIGINAL, '/tmp/stream.srt')).toBe(true)
    expect(useVideoStore.getState().setPreviewCopyFor(ORIGINAL, '/tmp/imports/preview-Aa1Bb2Cc.mp4')).toBe(true)
    expect(useVideoStore.getState().derived.scanCandidates).toEqual(CANDIDATES)
    expect(useVideoStore.getState().srtPath).toBe('/tmp/stream.srt')
    expect(useVideoStore.getState().previewUrl).toBe('imagii-file:///tmp/imports/preview-Aa1Bb2Cc.mp4')
  })

  it('control: a DIFFERENT original is refused by all three guards, converted or not, and nothing is stored (the key is a literal: no `videoKey` involved)', async () => {
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    await useVideoStore.getState().loadSource('/tmp/imports/other-Qq1Ww2Ee.mp4', '/media/other.flv')
    expect(useVideoStore.getState().setDerivedFor(ORIGINAL, { scanCandidates: CANDIDATES })).toBe(false)
    expect(useVideoStore.getState().setSrtPathFor(ORIGINAL, '/tmp/stream.srt')).toBe(false)
    expect(useVideoStore.getState().setPreviewCopyFor(ORIGINAL, '/tmp/imports/preview-Aa1Bb2Cc.mp4')).toBe(false)
    expect(useVideoStore.getState().derived.scanCandidates).toBeNull()
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().previewUrl).toBeNull()
    await useVideoStore.getState().loadSource('/v/plain.mp4')
    expect(useVideoStore.getState().setDerivedFor(ORIGINAL, { scanCandidates: CANDIDATES }), 'a plain file is not a converted import\'s original').toBe(false)
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().setDerivedFor(ORIGINAL, { scanCandidates: CANDIDATES }), 'nothing open').toBe(false)
  })

  it('a plain file keeps the old rule: the same path is the video, another path is not, and a working copy\'s path is not a converted import\'s key', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { scanCandidates: CANDIDATES })).toBe(true)
    expect(useVideoStore.getState().setDerivedFor('/v/b.mp4', { transcript: SEGMENTS })).toBe(false)
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    expect(useVideoStore.getState().setDerivedFor(COPY_1, { transcript: SEGMENTS }), 'the working copy is not the identity').toBe(false)
    expect(useVideoStore.getState().setDerivedFor(ORIGINAL, { transcript: SEGMENTS })).toBe(true)
  })
})

/**
 * T-173 (4): a finished transcript comes back with its video. Close skips the question for a transcript ("it opens again at once") and nothing read it back:
 * the store keeps each video's `srtPath` + `derived.transcript` + probe duration by `videoKey` for the session, `loadSource` gives them to the same video, and
 * Clear transcripts (which deletes the files) empties it.
 */
describe('a transcript comes back with its video (T-173 (4))', () => {
  const COPY_1 = '/tmp/imports/stream-aB3dE5fG.mp4'
  const COPY_2 = '/tmp/imports/stream-Zx9Kp2Lm.mp4'
  const ORIGINAL = '/media/stream.flv'
  const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'hello' }]
  let probeDuration = 60

  beforeEach(() => {
    probeDuration = 60
    vi.stubGlobal('window', {
      api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => ({ ...FAKE_SOURCE.probe, duration: probeDuration }) } }
    })
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
  })
  afterEach(() => {
    useVideoStore.getState().forgetHeldTranscripts()
    vi.unstubAllGlobals()
  })

  /** What Transcribe does on finish: the path, then the segments, both for the video it started on. */
  function transcribed(key: string, srt = '/captions/stream-1700000000000.srt'): void {
    expect(useVideoStore.getState().setSrtPathFor(key, srt)).toBe(true)
    expect(useVideoStore.getState().setDerivedFor(key, { transcript: SEGMENTS })).toBe(true)
  }

  it('a plain file: Close, then the same file opened again has its srtPath and transcript back, and nothing else of the old session', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    useVideoStore.getState().setDerived({ highlightChat: 'pasted' })
    useVideoStore.getState().clearSource()
    expect(useVideoStore.getState().srtPath, 'Close empties the open state').toBeNull()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/stream-1700000000000.srt')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
    expect(useVideoStore.getState().derived.highlightChat, 'only the transcript is held; a pasted chat log is a loss Close asks about').toBe('')
    expect(useVideoStore.getState().derived.scanCandidates).toBeNull()
  })

  it('a converted import: the NEW working copy of the same original gets it back', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    transcribed(ORIGINAL)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().source?.filePath).toBe(COPY_2)
    expect(useVideoStore.getState().srtPath).toBe('/captions/stream-1700000000000.srt')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
  })

  it('replacing the open video with the same one (no Close) also gets it back', async () => {
    await useVideoStore.getState().loadSource(COPY_1, ORIGINAL)
    transcribed(ORIGINAL)
    await useVideoStore.getState().loadSource(COPY_2, ORIGINAL)
    expect(useVideoStore.getState().srtPath).toBe('/captions/stream-1700000000000.srt')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
  })

  it('a run that found no speech ([] and no path) comes back as [] and no path', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', null)).toBe(true)
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { transcript: [] })).toBe(true)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().derived.transcript).toEqual([])
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('a project open\'s setSrtPath is given back after a close and re-open', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    useVideoStore.getState().setSrtPath('/captions/from-project.srt')
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/from-project.srt')
    expect(useVideoStore.getState().derived.transcript, 'a path alone holds no segments').toBeNull()
  })

  it('control: a DIFFERENT video gets none', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
    await useVideoStore.getState().loadSource('/media/other.flv'.replace('other', 'x'), '/media/x.flv')
    expect(useVideoStore.getState().srtPath, 'another converted original').toBeNull()
  })

  it('control: the same key with a duration 2 s off gets none (the file was replaced), and 0.4 s off still does', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    useVideoStore.getState().clearSource()
    probeDuration = 62
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
    useVideoStore.getState().clearSource()
    probeDuration = 60.4
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath, 'the probe of the same file can wobble by a few frames').toBe('/captions/stream-1700000000000.srt')
  })

  it('a re-transcribe replaces what is held (the newest run is what comes back)', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4', '/captions/first.srt')
    transcribed('/v/a.mp4', '/captions/second.srt')
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/second.srt')
  })

  it('control: forgetHeldTranscripts() (Clear transcripts deleted the files) leaves nothing to come back, for any video', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/b.mp4')
    transcribed('/v/b.mp4', '/captions/b.srt')
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('control: forgetting the OPEN video\'s transcript (null path, null segments) removes what was held for it', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    useVideoStore.getState().setDerived({ transcript: null })
    useVideoStore.getState().setSrtPathFor('/v/a.mp4', null)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('a refused write (a job finishing for a video that is no longer open) holds nothing', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/captions/a.srt')).toBe(false)
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { transcript: SEGMENTS })).toBe(false)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('videoSessionHasLoss is unchanged: a held transcript is still not a loss', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    transcribed('/v/a.mp4')
    expect(videoSessionHasLoss(useVideoStore.getState())).toBe(false)
  })
})

/**
 * T-174 (5): a transcription that finishes after its video was closed (or another opened) is held under the video it was made for, so opening that video again gives it
 * back. `holdTranscriptFor` writes the same entry `loadSource` reads; the duration is the one the run STARTED on.
 */
describe('holdTranscriptFor - a late transcript waits for its video (T-174 (5))', () => {
  const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'late words' }]
  const ORIGINAL = '/media/stream.flv'
  let probeDuration = 60

  beforeEach(() => {
    probeDuration = 60
    vi.stubGlobal('window', {
      api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => ({ ...FAKE_SOURCE.probe, duration: probeDuration }) } }
    })
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
  })
  afterEach(() => {
    useVideoStore.getState().forgetHeldTranscripts()
    vi.unstubAllGlobals()
  })

  it('the video opened later gets the path and the segments; the video open meanwhile does not', async () => {
    await useVideoStore.getState().loadSource('/v/b.mp4')
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', '/captions/a.srt'), 'the refusal this is for').toBe(false)
    holdTranscriptFor('/v/a.mp4', { srtPath: '/captions/a.srt', transcript: SEGMENTS, duration: 60 })
    expect(useVideoStore.getState().srtPath, 'the open video is not given a late result').toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/a.srt')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
  })

  it('a converted import: the NEW working copy of the same original gets it', async () => {
    holdTranscriptFor(ORIGINAL, { srtPath: '/captions/s.srt', transcript: SEGMENTS, duration: 60 })
    await useVideoStore.getState().loadSource('/tmp/imports/stream-Zx9Kp2Lm.mp4', ORIGINAL)
    expect(useVideoStore.getState().srtPath).toBe('/captions/s.srt')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS)
  })

  it('a run that found no speech is held as "ran, found nothing": [] and no path', async () => {
    holdTranscriptFor('/v/a.mp4', { srtPath: null, transcript: [], duration: 60 })
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().derived.transcript).toEqual([])
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('control: the file opened again 2 s longer (it was replaced while the run was out) gets none; 0.4 s off still does', async () => {
    holdTranscriptFor('/v/a.mp4', { srtPath: '/captions/a.srt', transcript: SEGMENTS, duration: 60 })
    probeDuration = 62
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
    probeDuration = 60.4
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/a.srt')
  })

  it('control: a DIFFERENT video gets none', async () => {
    holdTranscriptFor('/v/a.mp4', { srtPath: '/captions/a.srt', transcript: SEGMENTS, duration: 60 })
    await useVideoStore.getState().loadSource('/v/c.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('the newest run replaces what was held, and an entry with neither path nor segments is no entry', async () => {
    holdTranscriptFor('/v/a.mp4', { srtPath: '/captions/first.srt', transcript: SEGMENTS, duration: 60 })
    holdTranscriptFor('/v/a.mp4', { srtPath: '/captions/second.srt', transcript: SEGMENTS, duration: 60 })
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe('/captions/second.srt')
    useVideoStore.getState().clearSource()
    holdTranscriptFor('/v/a.mp4', { srtPath: null, transcript: null, duration: 60 })
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })
})

/**
 * T-184 (3): a project open calls `setSrtPath(part.srtPath)` AFTER `loadSource` gave back the video's held transcript. It merged only the path, so a video transcribed
 * (P2), closed, and opened through a project saved with an older `.srt` (P1) held `srtPath` P1 over P2's segments: the Captions panel previewed one run's text while Save
 * .srt, Burn into video and the Clip Kit used another's file. A DIFFERENT path clears the preview and the held segments; the same path keeps them.
 */
describe('setSrtPath with a different path drops the other transcript\'s preview (T-184 (3))', () => {
  const P1 = '/captions/stream-1700000000000.srt'
  const P2 = '/captions/stream-1700000999999.srt'
  const SEGMENTS_P2 = [{ startSec: 0, endSec: 2, text: 'from P2' }]

  beforeEach(() => {
    vi.stubGlobal('window', {
      api: { video: { fileUrl: (p: string) => `imagii-file://${p}`, probe: async () => ({ ...FAKE_SOURCE.probe, duration: 60 }) } }
    })
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
  })
  afterEach(() => {
    useVideoStore.getState().forgetHeldTranscripts()
    vi.unstubAllGlobals()
  })

  /** The reader's sequence up to the project open: transcribe P2, Close, open the video again (it gets P2 back). */
  async function transcribedThenReopened(): Promise<void> {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().setSrtPathFor('/v/a.mp4', P2)).toBe(true)
    expect(useVideoStore.getState().setDerivedFor('/v/a.mp4', { transcript: SEGMENTS_P2 })).toBe(true)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath, 'the premise: P2 came back with its segments').toBe(P2)
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS_P2)
  }

  it('the reader\'s sequence: the project\'s P1 has no preview (P2\'s text is not shown over it), and the held entry is { P1, null }', async () => {
    await transcribedThenReopened()
    useVideoStore.getState().setSrtPath(P1)
    expect(useVideoStore.getState().srtPath).toBe(P1)
    expect(useVideoStore.getState().derived.transcript, 'no preview of the other run').toBeNull()
    // The held entry: Close and open again gives back P1 with no segments, not P2's.
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().srtPath).toBe(P1)
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('only the transcript goes: the rest of `derived` is as it was', async () => {
    await transcribedThenReopened()
    useVideoStore.getState().setDerived({ highlightChat: 'pasted' })
    useVideoStore.getState().setSrtPath(P1)
    expect(useVideoStore.getState().derived.highlightChat).toBe('pasted')
  })

  it('control: the same path keeps its preview (a project of the transcript that was just made opens with it), here and after a Close', async () => {
    await transcribedThenReopened()
    useVideoStore.getState().setSrtPath(P2)
    expect(useVideoStore.getState().srtPath).toBe(P2)
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS_P2)
    useVideoStore.getState().clearSource()
    await useVideoStore.getState().loadSource('/v/a.mp4')
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS_P2)
  })

  it('a path onto a video that holds no transcript is just the path (the T-174 first-run state)', async () => {
    await useVideoStore.getState().loadSource('/v/a.mp4')
    useVideoStore.getState().setSrtPath(P1)
    expect(useVideoStore.getState().srtPath).toBe(P1)
    expect(useVideoStore.getState().derived.transcript).toBeNull()
  })

  it('clearing the path is as it was: null forgets the path and leaves the segments the panel shows', async () => {
    await transcribedThenReopened()
    useVideoStore.getState().setSrtPath(null)
    expect(useVideoStore.getState().srtPath).toBeNull()
    expect(useVideoStore.getState().derived.transcript).toEqual(SEGMENTS_P2)
  })
})
