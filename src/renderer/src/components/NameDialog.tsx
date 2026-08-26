import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

interface NameDialogProps {
  open: boolean
  /** Dialog title, and the visible heading inside it. */
  title: string
  /** The field's visible label — also its accessible name. */
  label: string
  /** Pre-filled and pre-selected, so typing replaces it (rename). */
  initialValue?: string
  /** The primary button's copy, e.g. "Rename" or "Create board". */
  confirmLabel: string
  onCancel: () => void
  onConfirm: (name: string) => void
}

/**
 * T-28: ask the user for one name.
 *
 * `window.prompt` is what both mood-board flows used, and Electron does not
 * implement it — the renderer threw "prompt() is and will not be supported.",
 * no dialog appeared, and Rename was dead in the shipped app while the button
 * looked perfectly fine. This is the in-app replacement, built out of the
 * pieces that were already here: `<Modal>` for the scrim, the focus trap and
 * Escape, and the same inline text field the create-board row next to it
 * uses.
 *
 * The behavior a name field owes the user is in one place rather than two:
 * Enter submits, a blank name cannot be confirmed, and cancelling — button,
 * Escape, or scrim — leaves the caller's state untouched.
 */
export function NameDialog({
  open,
  title,
  label,
  initialValue = '',
  confirmLabel,
  onCancel,
  onConfirm
}: NameDialogProps): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    // Modal's trap has already put focus in the field (it is the first
    // focusable); selecting the text is what makes a rename a rename rather
    // than an append. Child effects run before the parent's, so this lands
    // after the focus, not before it.
    inputRef.current?.select()
  }, [open, initialValue])

  const trimmed = value.trim()

  function confirm(): void {
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Modal open={open} onClose={onCancel} title={title} className="w-full max-w-sm p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-muted">{label}</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // T-34's mechanism, in a new place. Confirming closes this dialog,
            // and the focus trap hands focus back to the button that opened
            // it — so Chromium then applies THIS keypress's default action to
            // whatever is focused by then, clicking that opener and reopening
            // the dialog we just closed. A key we consume is a key the
            // browser must not also act on.
            e.preventDefault()
            confirm()
          }}
          className="bg-bg-base rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          aria-label={label}
        />
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
          disabled={!trimmed}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
