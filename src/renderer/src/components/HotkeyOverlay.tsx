import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

const SHORTCUTS_BY_ROUTE: Record<string, Array<{ keys: string; description: string }>> = {
  '/video': [
    { keys: 'Space', description: 'Play / pause' },
    { keys: '← / →', description: 'Nudge 0.1s' },
    { keys: ', / .', description: 'Frame step back / forward' },
    { keys: 'I / O', description: 'Set in / out point at playhead' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/audio': [
    { keys: 'Space', description: 'Play / pause' },
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
    { keys: 'Delete', description: 'Remove selected layer' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/record': [
    { keys: 'Click thumbnail', description: 'Pick screen / window' },
    { keys: 'Esc', description: 'Stop recording (when running)' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/ai-art': [
    { keys: 'Enter (search bar)', description: 'Run search' },
    { keys: '★ button', description: 'Save reference to mood board' },
    { keys: '?', description: 'Toggle this overlay' }
  ],
  '/home': [
    { keys: '?', description: 'Toggle this overlay' },
    { keys: 'Click any card', description: 'Open studio' },
    { keys: '💾 Save project', description: 'Save full app state to .imagii.json' },
    { keys: '📂 Open project', description: 'Restore from a saved project file' }
  ]
}

export function HotkeyOverlay(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const path = location.pathname
  const shortcuts = SHORTCUTS_BY_ROUTE[path] ?? SHORTCUTS_BY_ROUTE['/home']

  return (
    <div
      className="fixed inset-0 z-[900] bg-black/70 flex items-center justify-center p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-bg-elevated border border-accent/40 rounded-xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-ink-dim hover:text-ink-base text-sm"
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
      </div>
    </div>
  )
}
