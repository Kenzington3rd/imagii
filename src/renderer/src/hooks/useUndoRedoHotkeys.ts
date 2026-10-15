import { useEffect } from 'react'
import { isModalOpen } from '../components/Modal'
import { inputTypeOf, isTextEntryTarget } from '../lib/keyOwnership'

/** The subset of a KeyboardEvent the undo/redo decision needs. */
export interface UndoRedoKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** `event.target`'s tagName — typing must never trigger studio undo. */
  tagName: string
  /** The target's `type` when it is an `<input>`: a checkbox or a slider is not a field anyone types in (T-123 (2)). */
  inputType?: string | null
  /** Is a `<Modal>` open? A dialog is a claim over the window (T-68). */
  modalOpen: boolean
}

/**
 * T-15: Audio Studio (round 15) and Stream Graphics each carried their own copy
 * of this branch, and Video Studio — the studio with the most undoable
 * actions — carried none, so Ctrl+Z did nothing there. Third copy is where
 * the STYLE_GUIDE says to extract, and a pure decision function is the only
 * part of a window keydown listener a node-env unit test can drive.
 */
export function undoRedoIntent(e: UndoRedoKey): 'undo' | 'redo' | null {
  // The guards first: a text field owns its own undo stack, and Ctrl+Z while
  // renaming a clip must not roll back the timeline. T-68 adds the other
  // owner of a keystroke — an open dialog. Undoing behind a scrim rewrites
  // the document the dialog is showing, with the change hidden until it
  // closes; the same hole let Delete remove a layer behind the Variants
  // dialog. Both are the window-level handler answering for a window it no
  // longer owns.
  // T-123 (2): a text field - not "any INPUT". A checkbox that was just ticked or a slider that was just dragged stays
  // focused, and it has no undo of its own: Ctrl+Z over it is the studio's.
  if (isTextEntryTarget(e.tagName, e.inputType)) return null
  if (e.modalOpen) return null
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return null
  const key = e.key.toLowerCase()
  if (key === 'z' && !e.shiftKey) return 'undo'
  if (key === 'y' || (key === 'z' && e.shiftKey)) return 'redo'
  return null
}

/**
 * Window-level Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z for a studio's own history.
 * Used by Video Studio, Audio Studio, and Stream Graphics.
 */
export function useUndoRedoHotkeys(undo: () => void, redo: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const intent = undoRedoIntent({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        tagName: (e.target as HTMLElement | null)?.tagName ?? '',
        inputType: inputTypeOf(e.target),
        modalOpen: isModalOpen()
      })
      if (!intent) return
      e.preventDefault()
      if (intent === 'undo') undo()
      else redo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}
