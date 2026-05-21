import { describe, it, expect } from 'vitest'
import { CANVAS_TEMPLATES } from './templates'

// Round 16 B8/B9 regression: the Twitch / YouTube banner templates were
// using non-canonical dimensions. Lock the corrected values in so a future
// refactor can't quietly revert them.
describe('round-16 banner templates', () => {
  it('Twitch video-player banner is 1200x480', () => {
    const tw = CANVAS_TEMPLATES.find((t) => t.id === 'tw-banner-videoplayer')
    expect(tw, 'tw-banner-videoplayer must exist').toBeDefined()
    expect(tw?.doc.width).toBe(1200)
    expect(tw?.doc.height).toBe(480)
  })

  it('YouTube channel banner has both safe-area frames sized to the documented values', () => {
    const yt = CANVAS_TEMPLATES.find((t) => t.id === 'yt-banner-channel')
    expect(yt, 'yt-banner-channel must exist').toBeDefined()
    if (!yt) return
    expect(yt.doc.width).toBe(2560)
    expect(yt.doc.height).toBe(1440)

    // All-device safe area: 1546x423, centered at (507, 508).
    const allDevice = yt.doc.layers.find((l) => l.name === 'All-device safe area')
    expect(allDevice).toBeDefined()
    expect(allDevice?.type).toBe('rect')
    if (allDevice && allDevice.type === 'rect') {
      expect(allDevice.x).toBe(507)
      expect(allDevice.y).toBe(508)
      expect(allDevice.width).toBe(1546)
      expect(allDevice.height).toBe(423)
    }

    // TV-safe: 1235x338, centered at (662, 551).
    const tvSafe = yt.doc.layers.find((l) => l.name === 'TV-safe area')
    expect(tvSafe).toBeDefined()
    expect(tvSafe?.type).toBe('rect')
    if (tvSafe && tvSafe.type === 'rect') {
      expect(tvSafe.x).toBe(662)
      expect(tvSafe.y).toBe(551)
      expect(tvSafe.width).toBe(1235)
      expect(tvSafe.height).toBe(338)
    }
  })

  it('the prior 1920x480 Twitch banner id is no longer used', () => {
    // Round 15 shipped this id with the wrong dimensions; round 16 renamed
    // it. A stray reference in a future template addition should be
    // caught by this test.
    const stale = CANVAS_TEMPLATES.find((t) => t.id === 'tw-banner-channel')
    expect(stale).toBeUndefined()
  })
})
