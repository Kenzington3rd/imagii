import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Optional aria-label for AT when there is no visible title. */
  ariaLabel?: string
  /** Pass `false` to disable the Escape-to-close behavior (rare). */
  closeOnEscape?: boolean
  /** Pass `false` to disable the scrim-click-to-close behavior. */
  closeOnScrimClick?: boolean
  /** Extra class names for the inner content card. */
  className?: string
  children: ReactNode
}

/**
 * M12 fix (round 15): shared dialog helper used by TemplatesDialog,
 * CustomPresetManager, ThumbnailVariants, SafeZoneWarningModal, FixWizard,
 * HotkeyOverlay, and the image-studio ExportDialog. Centralizes:
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby (or aria-label when no visible title)
 *   - first-focusable-on-mount + Tab trapping
 *   - focus restore to the previously focused element on unmount
 *   - Escape-to-close
 *   - Scrim-click-to-close (and stopPropagation on the inner card)
 *
 * Body scroll lock is NOT added here — every previous modal positioned itself
 * over a fixed-height app shell so the renderer doesn't scroll in the first
 * place. If a future host adds long-scroll content we'll layer that on then.
 *
 * Power-of-Ten note: focus discovery uses a closed-form query rather than a
 * MutationObserver. The dialog content rarely changes focusability between
 * the first focus and Escape, and tests rely on the synchronous behavior.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  closeOnEscape = true,
  closeOnScrimClick = true,
  className = '',
  children
}: ModalProps): JSX.Element | null {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null
    const root = contentRef.current
    if (root) {
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) {
        first.focus()
      } else {
        // No focusable child — make the dialog itself focusable so screen
        // readers announce the title rather than the page behind it.
        root.tabIndex = -1
        root.focus()
      }
    }
    return () => {
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus()
        } catch {
          /* element may be gone */
        }
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && closeOnEscape) {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = contentRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      if (focusables.length === 0) {
        // Trap focus on the dialog itself — Tab does nothing useful but at
        // least it doesn't escape behind the modal.
        e.preventDefault()
        root.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEscape, onClose])

  if (!open) return null

  const titleId = title ? 'imagii-modal-title' : undefined
  const labelProps = titleId
    ? { 'aria-labelledby': titleId }
    : ariaLabel
      ? { 'aria-label': ariaLabel }
      : {}

  return (
    <div
      className="fixed inset-0 z-[800] bg-black/70 flex items-center justify-center p-6"
      onClick={() => {
        if (closeOnScrimClick) onClose()
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        {...labelProps}
        className={`bg-bg-elevated border border-ink-dim/40 rounded-xl shadow-2xl outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  )
}
