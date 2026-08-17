import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Modal, openModalCount } from './Modal'

export interface Shortcut {
  keys: string
  description: string
}

/**
 * The app's only shortcut documentation, so it is held to the code:
 * `tests/unit/hotkeyTable.test.ts` walks each route's real component tree and
 * fails if a row here claims a binding the route does not register. Round 23
 * drift the table carried: Audio Studio advertised a Space play/pause
 * binding that never existed (the waveform has a play BUTTON — Space
 * activates it only when it happens to be focused), and Video Studio gained
 * Ctrl+Z / Ctrl+Y in T-15 without the table saying so.
 */
export const SHORTCUTS_BY_ROUTE: Record<string, Shortcut[]> = {
  '/video': [
    { keys: 'Space', description: 'Play / pause (player focused)' },
    { keys: '← / →', description: 'Nudge 0.1s (player or timeline focused)' },
    { keys: 'Home / End', description: 'Jump to start / end (timeline focused)' },
    { keys: 'Click timeline', description: 'Scrub the playhead to that point' },
    { keys: ', / .', description: 'Frame step back / forward' },
    { keys: 'I / O', description: 'Set in / out point at playhead' },
    { keys: 'Ctrl+Z / Ctrl+Y', description: 'Undo / redo clip edits' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/audio': [
    { keys: 'Drag on waveform', description: 'Mark region to cut' },
    { keys: 'Click cut tag', description: 'Undo a cut' },
    { keys: 'Ctrl+Z / Ctrl+Y', description: 'Undo / redo cleanup chain' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/image': [
    { keys: 'V', description: 'Select tool' },
    { keys: 'R', description: 'Rectangle tool' },
    { keys: 'O', description: 'Ellipse tool' },
    { keys: 'L', description: 'Line tool' },
    { keys: 'P', description: 'Pencil tool' },
    { keys: 'Ctrl+V', description: 'Paste image from clipboard' },
    { keys: 'Ctrl+Z / Ctrl+Y', description: 'Undo / redo' },
    { keys: 'Delete / Backspace', description: 'Remove selected layer' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/record': [
    { keys: 'Click thumbnail', description: 'Pick screen / window' },
    { keys: 'Esc', description: 'Stop recording (when running)' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/references': [
    { keys: 'Enter (search bar)', description: 'Run search' },
    { keys: 'Save button', description: 'Save reference to mood board' },
    { keys: 'Ctrl+Z / Ctrl+Y', description: 'Undo / redo mood-board edits' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/home': [
    { keys: '?', description: 'Toggle this overlay' },
    { keys: 'Click any card', description: 'Open studio' },
    { keys: 'Save project', description: 'Save full app state to .imagii.json' },
    { keys: 'Open project', description: 'Restore from a saved project file' }
  ]
}

/**
 * Pure toggle predicate: `?` with no Ctrl/Meta, never while the user is
 * typing (a `?` belongs in the textarea, not in a modal that steals focus),
 * and never while a dialog that isn't this overlay owns the window.
 *
 * T-72: that last clause cannot be a bare `isModalOpen()`. This overlay
 * renders its OWN Modal, so the moment it is up it is itself one of the open
 * modals and a blanket guard would trap it open — `?` could no longer close
 * the thing `?` opened, and the panel's own "Press ? again to close." would
 * be a lie. So the handler passes the COUNT and its own state, and the
 * overlay subtracts its own claim: while it is open, exactly one of the open
 * modals is ours. Anything stacked above it wins, which is also what a user
 * expects — the Variants dialog they opened on purpose stays the topmost
 * thing on screen.
 */
export function isOverlayToggleKey(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  tagName: string
  /** `Modal.openModalCount()` at event time — this overlay's own included. */
  openModals: number
  /** Whether this overlay is currently the one rendering a Modal. */
  overlayOpen: boolean
}): boolean {
  if (e.key !== '?') return false
  if (e.ctrlKey || e.metaKey) return false
  if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') return false
  return e.openModals <= (e.overlayOpen ? 1 : 0)
}

/** The route's rows, falling back to Home's for an unlisted path. */
export function shortcutsForRoute(pathname: string): Shortcut[] {
  return SHORTCUTS_BY_ROUTE[pathname] ?? SHORTCUTS_BY_ROUTE['/home'] ?? []
}

export function HotkeyOverlay(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    // INIT-G (round 16): keep the `?` toggle handler. Modal owns Escape,
    // scrim click, and focus restore now, so we no longer need our own
    // Escape branch here.
    // T-72: `open` is a dependency because the predicate needs it — the
    // listener re-registers on each toggle rather than reading state through
    // a ref, which is both fewer moving parts and impossible to leave stale.
    function onKey(e: KeyboardEvent): void {
      if (
        !isOverlayToggleKey({
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          tagName: (e.target as HTMLElement | null)?.tagName ?? '',
          openModals: openModalCount(),
          overlayOpen: open
        })
      ) {
        return
      }
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const shortcuts = shortcutsForRoute(location.pathname)

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      className="max-w-md w-full p-6 ring-1 ring-accent/40"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
        <button
          onClick={() => setOpen(false)}
          className="text-ink-dim hover:text-ink-base text-sm"
          title="Close shortcuts"
          aria-label="Close shortcuts"
        >
          Esc
        </button>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {shortcuts.map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <kbd className="bg-bg-hover px-2 py-0.5 rounded text-xs font-mono min-w-[80px] text-center">
              {s.keys}
            </kbd>
            <span className="text-ink-base">{s.description}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-dim mt-4">Press ? again to close.</p>
    </Modal>
  )
}
