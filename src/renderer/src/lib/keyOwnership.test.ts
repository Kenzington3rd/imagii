import { describe, it, expect } from 'vitest'
import { NON_TEXT_INPUT_TYPES, controlOwnsKey, focusOwnsKey, hasChordModifier, isTextEntryTarget } from './keyOwnership'

/**
 * T-123 (2): who owns a key when a control has focus. Every guard in the renderer asked "is it an INPUT?", and a
 * checkbox or a slider that had just been used kept the focus and swallowed Ctrl+Z, `?`, R and Delete.
 */
describe('isTextEntryTarget', () => {
  it.each(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'])(
    'an <input type=%s> is a text field',
    (type) => {
      expect(isTextEntryTarget('INPUT', type)).toBe(true)
    }
  )

  it('a missing or unrecognized type is text entry (the DOM reports "text" for a missing one)', () => {
    expect(isTextEntryTarget('INPUT', null)).toBe(true)
    expect(isTextEntryTarget('INPUT', undefined)).toBe(true)
    expect(isTextEntryTarget('INPUT')).toBe(true)
    expect(isTextEntryTarget('INPUT', 'a-type-from-the-future')).toBe(true)
  })

  it.each([...NON_TEXT_INPUT_TYPES])('an <input type=%s> is not a text field', (type) => {
    expect(isTextEntryTarget('INPUT', type)).toBe(false)
    expect(isTextEntryTarget('input', type.toUpperCase())).toBe(false)
  })

  it('a textarea is a text field whatever its (absent) type', () => {
    expect(isTextEntryTarget('TEXTAREA')).toBe(true)
    expect(isTextEntryTarget('textarea', 'range')).toBe(true)
  })

  it('a select, a button, a div and the body are not text fields', () => {
    for (const tag of ['SELECT', 'BUTTON', 'DIV', 'BODY', 'A', 'LABEL', '']) expect(isTextEntryTarget(tag, null)).toBe(false)
  })

  it('the list is the one the gesture window reads (the lift from videoStore lost nothing)', () => {
    expect([...NON_TEXT_INPUT_TYPES].sort()).toEqual(
      ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].sort()
    )
  })
})

describe('controlOwnsKey', () => {
  it('a focused range keeps ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home and End, and nothing else', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(controlOwnsKey('INPUT', 'range', key), key).toBe(true)
    }
    for (const key of [' ', ',', '.', 'i', 'I', 'o', 'O', 'r', 'z', '?', 'Delete', 'Backspace', 'Enter', 'Tab']) {
      expect(controlOwnsKey('INPUT', 'range', key), key).toBe(false)
    }
  })

  it('a focused checkbox or radio keeps Space, and nothing else', () => {
    for (const type of ['checkbox', 'radio']) {
      expect(controlOwnsKey('INPUT', type, ' ')).toBe(true)
      for (const key of ['ArrowLeft', 'ArrowRight', ',', '.', 'i', 'o', 'r', '?', 'Delete', 'Backspace', 'z']) {
        expect(controlOwnsKey('INPUT', type, key), `${type} ${key}`).toBe(false)
      }
    }
  })

  it('a focused button keeps Space (how a keyboard user presses it), and nothing else', () => {
    expect(controlOwnsKey('BUTTON', null, ' ')).toBe(true)
    for (const key of ['ArrowLeft', ',', '.', 'i', 'o', 'Delete']) expect(controlOwnsKey('BUTTON', null, key), key).toBe(false)
  })

  it('a colour, file or text input has no single key it owns here (a text field is isTextEntryTarget\'s, whole)', () => {
    for (const type of ['color', 'file', 'text', 'number']) expect(controlOwnsKey('INPUT', type, ' ')).toBe(false)
  })

  it('anything that is not an input or a button owns nothing', () => {
    for (const tag of ['SELECT', 'DIV', 'TEXTAREA', 'BODY']) expect(controlOwnsKey(tag, null, ' ')).toBe(false)
  })
})

describe('focusOwnsKey - the question the Player, the Timeline slider and the canvas tool keys ask', () => {
  it('a text field owns every key', () => {
    for (const key of [' ', 'ArrowLeft', ',', 'i', 'r', 'Delete', 'Backspace', 'z']) {
      expect(focusOwnsKey('INPUT', 'text', key), key).toBe(true)
      expect(focusOwnsKey('TEXTAREA', null, key), key).toBe(true)
      expect(focusOwnsKey('INPUT', 'number', key), key).toBe(true)
    }
  })

  it('a select owns every key (type-ahead, and the arrows change its value)', () => {
    for (const key of [' ', 'ArrowLeft', 'p', 'r', 'Delete']) expect(focusOwnsKey('SELECT', null, key), key).toBe(true)
  })

  it('a focused checkbox owns Space and nothing else: the Player\'s I, O, arrows and the tool keys still fire', () => {
    expect(focusOwnsKey('INPUT', 'checkbox', ' ')).toBe(true)
    for (const key of ['ArrowLeft', 'ArrowRight', ',', '.', 'i', 'o', 'r', 'v', 'Delete', 'Backspace']) {
      expect(focusOwnsKey('INPUT', 'checkbox', key), key).toBe(false)
    }
  })

  it('a focused range owns the arrows, Home and End; Space, the letters, Delete and Backspace still fire', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(focusOwnsKey('INPUT', 'range', key), key).toBe(true)
    for (const key of [' ', ',', '.', 'i', 'o', 'r', 'Delete', 'Backspace']) expect(focusOwnsKey('INPUT', 'range', key), key).toBe(false)
  })

  it('a focused button owns Space only; nothing focused owns nothing', () => {
    expect(focusOwnsKey('BUTTON', null, ' ')).toBe(true)
    expect(focusOwnsKey('BUTTON', null, 'i')).toBe(false)
    expect(focusOwnsKey('DIV', null, ' ')).toBe(false)
    expect(focusOwnsKey('BODY', null, 'ArrowLeft')).toBe(false)
  })
})

/**
 * T-124 (29): a bare-letter shortcut is for the bare letter. Ctrl+R (reload), Ctrl+O (open), Ctrl+L, Ctrl+P (print) and
 * Alt+Left (back) are chords the browser or the window owns; Stream Graphics switched tools on all four, and the
 * Timeline and the Player set an Out point on Ctrl+O and swallowed the chord with `preventDefault`.
 */
describe('hasChordModifier', () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false }

  it('a bare key is not a chord, and Shift alone is not one either (R and r are the same shortcut)', () => {
    const shifted = { ...none, shiftKey: true }
    expect(hasChordModifier(none)).toBe(false)
    expect(hasChordModifier(shifted)).toBe(false)
  })

  it.each([['ctrlKey'], ['metaKey'], ['altKey']] as const)('%s held makes it a chord', (modifier) => {
    expect(hasChordModifier({ ...none, [modifier]: true })).toBe(true)
  })

  it('every modifier at once is still one chord', () => {
    expect(hasChordModifier({ ctrlKey: true, metaKey: true, altKey: true })).toBe(true)
  })
})
