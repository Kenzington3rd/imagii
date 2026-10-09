import { describe, it, expect } from 'vitest'
import { HINT_NODE_NAME, asHint, hintTag, type CanvasLayer } from './canvas'

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
