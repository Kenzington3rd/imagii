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
