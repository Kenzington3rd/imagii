import { describe, it, expect } from 'vitest'
import {
  HINT_NODE_NAME,
  HINT_TEXT_DIM,
  LAYER_ROTATION_RANGE,
  asHint,
  displayOpacity,
  hintTag,
  layerOffsetRange,
  type CanvasLayer
} from './canvas'

const base = {
  id: 'a',
  name: 'x',
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1
}
const rect: CanvasLayer = { ...base, type: 'rect', width: 1, height: 1, fill: '#fff', stroke: '#000', strokeWidth: 0, cornerRadius: 0 }
const text: CanvasLayer = { ...base, type: 'text', text: 'hi', fontSize: 10, fontFamily: 'Inter', fill: '#fff' }
const image: CanvasLayer = { ...base, type: 'image', src: 'data:', width: 1, height: 1 }

describe('asHint', () => {
  it('flags a copy and leaves the original alone', () => {
    const flagged = asHint(rect)
    expect(flagged.hint).toBe(true)
    expect(rect.hint).toBeUndefined()
    expect(flagged).toMatchObject({ ...rect, hint: true })
  })
})

describe('hintTag', () => {
  it('is null for a layer that exports — including one explicitly un-flagged', () => {
    expect(hintTag(rect)).toBeNull()
    expect(hintTag({ ...rect, hint: false })).toBeNull()
  })

  it('says which kind of thing will not export', () => {
    expect(hintTag(asHint(rect))).toBe("hint — won't export")
    expect(hintTag(asHint(text))).toBe("hint — won't export")
    expect(hintTag(asHint(image))).toBe("reference — won't export")
  })
})

describe('HINT_NODE_NAME', () => {
  it('is a single Konva name token (hasName matches whole tokens)', () => {
    expect(HINT_NODE_NAME).toMatch(/^[a-z]+$/)
  })
})

/**
 * T-112 — a hint's words are dimmed ON THE CANVAS, and only there.
 *
 * "@yourhandle" and "YOUR TITLE HERE" draw at full strength on the canvas and are left
 * out of the export (T-91, T-103), so the picture the person edits showed words the file
 * would not have — the layer's tag in the Layers panel said so, the canvas did not. The
 * dim is the canvas's own: `displayOpacity` is what the stage draws, the layer's stored
 * `opacity` is never touched (so a retyped layer, which stops being a hint, is at full
 * strength with nothing to undo), and `captureDocument` switches the hint nodes OFF for
 * an export, so the dim cannot reach a file.
 */
describe('displayOpacity — what the canvas draws a layer at (T-112)', () => {
  it('a hint text layer is drawn at 40% of its own opacity', () => {
    expect(HINT_TEXT_DIM).toBe(0.4)
    expect(displayOpacity(asHint(text))).toBe(0.4)
    expect(displayOpacity(asHint({ ...text, opacity: 0.5 }))).toBeCloseTo(0.2, 10)
  })

  it('a text layer that is not a hint — including one whose flag a retype cleared — is at full strength', () => {
    expect(displayOpacity(text)).toBe(1)
    expect(displayOpacity({ ...text, hint: false })).toBe(1)
    expect(displayOpacity({ ...text, hint: false, opacity: 0.7 })).toBe(0.7)
  })

  it('only hint TEXT is dimmed: a guide shape and a mood-board reference draw as they always did', () => {
    expect(displayOpacity(asHint(rect))).toBe(1)
    // A reference picture is already authored at 40% (makeReferenceLayer); dimming it again would be 16%.
    expect(displayOpacity(asHint({ ...image, opacity: 0.4 }))).toBe(0.4)
  })

  it('does not change the layer it is given', () => {
    const hint = asHint(text)
    displayOpacity(hint)
    expect(hint.opacity).toBe(1)
  })
})

// T-124 (15): the Properties panel's x, y and Rotation boxes are held to a sanity range when typing ends. A layer may sit partly or
// wholly off the page (dragging allows it, and bleeding off an edge is ordinary), so the bound is one page beyond each edge, not the page.
describe('layerOffsetRange / LAYER_ROTATION_RANGE (T-124 (15))', () => {
  it('lets a layer sit one page past either edge, and no further', () => {
    expect(layerOffsetRange(1200)).toEqual({ min: -1200, max: 2400 })
    expect(layerOffsetRange(800)).toEqual({ min: -800, max: 1600 })
  })

  it('keeps zero, and the page itself, well inside', () => {
    const r = layerOffsetRange(1920)
    expect(r.min).toBeLessThan(0)
    expect(r.max).toBeGreaterThan(1920)
  })

  it('is a real range for the smallest page imagii makes (an emote), so a box is never refused outright', () => {
    const r = layerOffsetRange(112)
    expect(r.min).toBe(-112)
    expect(r.max).toBe(224)
    expect(r.max).toBeGreaterThan(r.min)
  })

  it('allows a full turn either way', () => {
    expect(LAYER_ROTATION_RANGE).toEqual({ min: -360, max: 360 })
  })
})
