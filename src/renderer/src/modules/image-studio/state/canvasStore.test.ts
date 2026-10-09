import { describe, it, expect, beforeEach } from 'vitest'
import { asHint, type CanvasDocument, type TextLayer } from '@shared/canvas'
import { applyLayerPatch, makeReferenceLayer, makeTextLayer, useCanvasStore } from './canvasStore'

/**
 * T-91 — a hint layer is guidance that never exports, and the one thing that
 * must NOT happen is a user's own words being treated as guidance. "@yourhandle"
 * is a placeholder until somebody types their handle over it; after that an
 * export that dropped it would ship a graphic missing the one thing they filled
 * in. So retyping a hint text layer clears the flag.
 */

const hintText = (): TextLayer => asHint({ ...makeTextLayer(10, 10, '@yourhandle'), name: 'Handle' })

describe('applyLayerPatch', () => {
  it('merges a patch the way the store always did', () => {
    const next = applyLayerPatch(hintText(), { x: 99 })
    expect(next).toMatchObject({ x: 99, text: '@yourhandle' })
  })

  it('moving, resizing or restyling a hint keeps it a hint — only its words matter', () => {
    const t = hintText()
    for (const patch of [{ x: 5 }, { y: 6 }, { fontSize: 99 }, { fill: '#fff' }, { rotation: 10 }, { opacity: 0.5 }]) {
      expect(applyLayerPatch(t, patch).hint, JSON.stringify(patch)).toBe(true)
    }
  })

  it('typing different words over a hint text clears the flag, so the export keeps what the user wrote', () => {
    const next = applyLayerPatch(hintText(), { text: '@makenah' } as Partial<TextLayer>)
    expect(next.hint).toBe(false)
    expect((next as TextLayer).text).toBe('@makenah')
  })

  it('"editing" a hint to the same words is not an edit', () => {
    expect(applyLayerPatch(hintText(), { text: '@yourhandle' } as Partial<TextLayer>).hint).toBe(true)
  })

  it('a layer that was never a hint is untouched by the rule', () => {
    const plain = makeTextLayer(0, 0, 'Title')
    const next = applyLayerPatch(plain, { text: 'New title' } as Partial<TextLayer>)
    expect('hint' in next).toBe(false)
  })
})

describe('makeReferenceLayer', () => {
  it('is a 40%-opacity picture named for the board item, flagged as a hint', () => {
    const l = makeReferenceLayer('data:image/png;base64,AAAA', 300, 200, 'x'.repeat(80))
    expect(l).toMatchObject({ type: 'image', opacity: 0.4, hint: true, width: 300, height: 200 })
    expect(l.name).toHaveLength(40)
  })
})

describe('through the store', () => {
  beforeEach(() => {
    const doc: CanvasDocument = { width: 400, height: 300, background: '#000000', layers: [] }
    useCanvasStore.getState().resetDocument(doc)
  })

  it('addLayer then retyping clears the hint, and undo brings the placeholder (and its flag) back', () => {
    const s = useCanvasStore.getState()
    const t = hintText()
    s.addLayer(t)
    s.updateLayer(t.id, { text: '@makenah' } as Partial<TextLayer>)
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(false)
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(true)
  })

  it('a duplicate of a hint is still a hint until its words change', () => {
    const s = useCanvasStore.getState()
    const t = hintText()
    s.addLayer(t)
    s.duplicateLayer(t.id)
    const [, copy] = useCanvasStore.getState().doc.layers
    expect(copy?.hint).toBe(true)
    useCanvasStore.getState().updateLayer(copy?.id ?? '', { text: 'mine' } as Partial<TextLayer>)
    expect(useCanvasStore.getState().doc.layers[1]?.hint).toBe(false)
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(true)
  })

  it('a layer carries its hint flag through JSON — a saved project keeps it', () => {
    const t = hintText()
    const round = JSON.parse(JSON.stringify(t)) as TextLayer
    expect(round.hint).toBe(true)
  })
})
