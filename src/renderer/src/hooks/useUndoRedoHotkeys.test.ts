import { describe, it, expect } from 'vitest'
import { undoRedoIntent } from './useUndoRedoHotkeys'

/**
 * T-15 regression. Video Studio shipped with full undo history in its store
 * and no way to reach it — no header buttons, no Ctrl+Z. The binding now
 * comes from one shared hook used by all three studios, so this pins the
 * decision every one of them makes.
 */
const base = {
  key: 'z',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  tagName: 'DIV',
  modalOpen: false
}

describe('undoRedoIntent', () => {
  it('reads Ctrl+Z as undo', () => {
    expect(undoRedoIntent({ ...base, ctrlKey: true })).toBe('undo')
  })

  it('reads Cmd+Z as undo (macOS keyboards on a Windows-first app)', () => {
    expect(undoRedoIntent({ ...base, metaKey: true })).toBe('undo')
  })

  it('reads Ctrl+Y as redo', () => {
    expect(undoRedoIntent({ ...base, key: 'y', ctrlKey: true })).toBe('redo')
  })

  it('reads Ctrl+Shift+Z as redo', () => {
    expect(undoRedoIntent({ ...base, ctrlKey: true, shiftKey: true })).toBe('redo')
  })

  it('accepts the capitalized key Shift produces', () => {
    // Chromium reports `key: 'Z'` when Shift is held.
    expect(undoRedoIntent({ ...base, key: 'Z', ctrlKey: true, shiftKey: true })).toBe('redo')
  })

  it('ignores the same keys without a modifier', () => {
    expect(undoRedoIntent(base)).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'y' })).toBeNull()
  })

  it('ignores unrelated keys', () => {
    for (const key of ['a', 'Escape', 'Enter', ' ', 'ArrowLeft']) {
      expect(undoRedoIntent({ ...base, key, ctrlKey: true })).toBeNull()
    }
  })

  it.each(['INPUT', 'TEXTAREA'])(
    'never fires while typing in %s — the field owns its own undo stack',
    (tagName) => {
      expect(undoRedoIntent({ ...base, ctrlKey: true, tagName })).toBeNull()
      expect(undoRedoIntent({ ...base, key: 'y', ctrlKey: true, tagName })).toBeNull()
      expect(undoRedoIntent({ ...base, ctrlKey: true, shiftKey: true, tagName })).toBeNull()
    }
  )

  // T-68 regression: the studio's document belongs to the studio, and while
  // a dialog is up the window belongs to the dialog. Undoing behind the
  // Variants scrim rewrote the document the dialog was showing.
  it('never fires while a Modal is open, whichever binding is used', () => {
    expect(undoRedoIntent({ ...base, ctrlKey: true, modalOpen: true })).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'y', ctrlKey: true, modalOpen: true })).toBeNull()
    expect(
      undoRedoIntent({ ...base, ctrlKey: true, shiftKey: true, modalOpen: true })
    ).toBeNull()
    // …and closing it hands the bindings straight back.
    expect(undoRedoIntent({ ...base, ctrlKey: true, modalOpen: false })).toBe('undo')
  })

  it('still fires from a SELECT or a button (not text entry)', () => {
    expect(undoRedoIntent({ ...base, ctrlKey: true, tagName: 'SELECT' })).toBe('undo')
    expect(undoRedoIntent({ ...base, ctrlKey: true, tagName: 'BUTTON' })).toBe('undo')
  })
})
