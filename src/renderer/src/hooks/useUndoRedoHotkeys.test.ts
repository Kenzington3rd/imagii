import { describe, it, expect } from 'vitest'
import { undoRedoIntent } from './useUndoRedoHotkeys'

/**
 * T-15 regression. Video Studio shipped with full undo history in its store
 * and no way to reach it — no header buttons, no Ctrl+Z. The binding now
 * comes from one shared hook used by all three studios, so this pins the
 * decision every one of them makes.
 */
const base: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  tagName: string
  inputType?: string | null
  modalOpen: boolean
} = {
  key: 'z',
  code: 'KeyZ',
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
    const unrelated: [string, string][] = [['a', 'KeyA'], ['Escape', 'Escape'], ['Enter', 'Enter'], [' ', 'Space'], ['ArrowLeft', 'ArrowLeft']]
    for (const [key, code] of unrelated) {
      expect(undoRedoIntent({ ...base, key, code, ctrlKey: true })).toBeNull()
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

  // T-123 (2): the guard asked "is it an INPUT?", and after a checkbox was ticked or a slider dragged the browser
  // leaves that control focused, so Ctrl+Z went dead for as long as it stayed there (tick Hum removal, press
  // Ctrl+Z: nothing). A checkbox and a slider have no undo of their own; only a text field does.
  it.each(['checkbox', 'range', 'radio', 'color', 'file', 'button'])(
    'fires from a focused <input type=%s>: it has no undo stack of its own (T-123 (2))',
    (inputType) => {
      expect(undoRedoIntent({ ...base, ctrlKey: true, tagName: 'INPUT', inputType })).toBe('undo')
      expect(undoRedoIntent({ ...base, key: 'y', ctrlKey: true, tagName: 'INPUT', inputType })).toBe('redo')
      expect(undoRedoIntent({ ...base, ctrlKey: true, shiftKey: true, tagName: 'INPUT', inputType })).toBe('redo')
    }
  )

  it.each(['text', 'number', 'search', 'email', 'password', 'date', null, undefined])(
    'still never fires from a text input (type %s): it owns its own undo stack',
    (inputType) => {
      expect(undoRedoIntent({ ...base, ctrlKey: true, tagName: 'INPUT', inputType })).toBeNull()
      expect(undoRedoIntent({ ...base, key: 'y', ctrlKey: true, tagName: 'INPUT', inputType })).toBeNull()
    }
  )

  it('a checkbox does not lift the other guards: a Modal still wins, and a bare Z is still nothing', () => {
    expect(undoRedoIntent({ ...base, ctrlKey: true, tagName: 'INPUT', inputType: 'checkbox', modalOpen: true })).toBeNull()
    expect(undoRedoIntent({ ...base, tagName: 'INPUT', inputType: 'checkbox' })).toBeNull()
  })

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

/**
 * T-185 (1): Ctrl+Z read `e.key` alone, and on a Russian, Greek or any non-Latin layout `key` is that layout's letter
 * ("я" for the Z key), so undo and redo were dead there. `shortcutKey` reads the letter a Latin layout prints, and the
 * key's position (`code`) only for a key that prints no Latin letter.
 */
describe('undoRedoIntent on a non-Latin layout (T-185 (1))', () => {
  it('Ctrl+"я" (the Z key on a Russian layout) undoes; Ctrl+"н" (the Y key) redoes; Ctrl+Shift+"я" redoes', () => {
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ', ctrlKey: true })).toBe('undo')
    expect(undoRedoIntent({ ...base, key: 'н', code: 'KeyY', ctrlKey: true })).toBe('redo')
    expect(undoRedoIntent({ ...base, key: 'Я', code: 'KeyZ', ctrlKey: true, shiftKey: true })).toBe('redo')
  })

  it('Cmd (Meta) on a Greek layout: "ζ" on the Z key undoes', () => {
    expect(undoRedoIntent({ ...base, key: 'ζ', code: 'KeyZ', metaKey: true })).toBe('undo')
  })

  it('AZERTY discriminates: its Z key (code KeyW) is still undo, and its W key (code KeyZ) is NOT', () => {
    expect(undoRedoIntent({ ...base, key: 'z', code: 'KeyW', ctrlKey: true })).toBe('undo')
    expect(undoRedoIntent({ ...base, key: 'w', code: 'KeyZ', ctrlKey: true })).toBeNull()
  })

  it('a non-Latin letter on another key is nothing, and a bare non-Latin Z is nothing', () => {
    expect(undoRedoIntent({ ...base, key: 'ч', code: 'KeyX', ctrlKey: true })).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ' })).toBeNull()
  })

  it('the guards stand for the non-Latin key too: a text field and an open dialog still win, a checkbox does not', () => {
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ', ctrlKey: true, tagName: 'INPUT', inputType: 'text' })).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ', ctrlKey: true, tagName: 'TEXTAREA' })).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ', ctrlKey: true, modalOpen: true })).toBeNull()
    expect(undoRedoIntent({ ...base, key: 'я', code: 'KeyZ', ctrlKey: true, tagName: 'INPUT', inputType: 'checkbox' })).toBe('undo')
  })
})
