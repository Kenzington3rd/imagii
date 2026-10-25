import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { VideoSource } from './store/videoStore'
import { OutputPreview } from './OutputPreview'

// A server render reads zustand's SERVER snapshot - the store's initial state, whatever the test set - so the store is replaced by a plain object the
// cases write to. OutputPreview only reads fields (`source`, `clips`, `selectedClipId`, `noPicture`, `previewUrl`) and a selector is all it passes.
const held = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./store/videoStore', () => ({
  useVideoStore: <T,>(selector: (s: Record<string, unknown>) => T): T => selector(held.state)
}))

/**
 * T-136 (6) - what the Output preview's caption says, for each state of the Player's verdict (`noPicture`) and of the preview copy (`previewUrl`).
 * The note replaces "Live snapshot..." only while the picture cannot be drawn AND no copy exists. The case that is easy to lose is the middle one: the
 * copy is in the store (the Player is swapping its element's source) and the element has not reported yet, so `noPicture` is still true for a moment -
 * the caption must already be the true one. The Playwright case reaches the same moment from the page (a DOM observer, "T-136 (6)").
 */
const SOURCE: VideoSource = {
  filePath: '/fake/prores.mov',
  fileName: 'prores.mov',
  url: 'imagii-file://fake/prores.mov',
  probe: { duration: 60, width: 1920, height: 1080, fps: 30, videoCodec: 'prores', audioCodec: 'aac', bitrate: 5_000_000, sizeBytes: 10_000_000 }
}
// The words each caption starts with (the markup escapes the apostrophes inside them; the full sentence is pinned in mediaFormats.test.ts).
const NOTE = 'No snapshot to show: imagii can'
const LIVE = 'Live snapshot at the playhead position'
const COPY = 'imagii-file://fake/preview-copy.mp4'

function caption(): { note: boolean; live: boolean } {
  const html = renderToStaticMarkup(<OutputPreview videoElement={null} />)
  return { note: html.includes(NOTE), live: html.includes(LIVE) }
}

describe('OutputPreview - the caption under the canvas (T-136 (6))', () => {
  beforeEach(() => {
    held.state = { source: SOURCE, clips: [], selectedClipId: null, noPicture: false, previewUrl: null }
  })

  it('a picture that draws keeps the live-snapshot caption', () => {
    expect(caption()).toEqual({ note: false, live: true })
  })

  it('a picture the Player cannot draw says so instead of promising a live snapshot', () => {
    held.state.noPicture = true
    expect(caption()).toEqual({ note: true, live: false })
  })

  it('once a preview copy exists the caption is the live one again, before the element has reported (noPicture is still true for that moment)', () => {
    held.state.noPicture = true
    held.state.previewUrl = COPY
    expect(caption()).toEqual({ note: false, live: true })
  })

  it('a copy that draws (noPicture false) keeps the live caption', () => {
    held.state.previewUrl = COPY
    expect(caption()).toEqual({ note: false, live: true })
  })

  it('draws nothing at all with no video open', () => {
    held.state.source = null
    held.state.noPicture = true
    expect(renderToStaticMarkup(<OutputPreview videoElement={null} />)).toBe('')
  })
})
