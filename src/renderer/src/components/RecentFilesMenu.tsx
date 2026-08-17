import { useEffect, useRef, useState } from 'react'

interface RecentFilesMenuProps {
  recent: string[]
  onPick: (path: string) => void
  onClear: () => void
}

function basename(p: string): string {
  const c = p.replace(/\\/g, '/')
  return c.substring(c.lastIndexOf('/') + 1)
}

/**
 * T-18: the popover used to close on mouse-leave only — no Escape, no
 * click-outside. Hover-only dismissal is unreachable by keyboard, awkward on
 * a touchpad, and flaky headless (Playwright has to synthesize a mouse path
 * over the menu and back off it).
 *
 * Pure so both dismissal paths are unit-testable without a DOM. `inside` is
 * measured against the whole wrapper — the toggle button included — so a
 * click on the toggle is NOT an outside-click; otherwise mousedown would
 * close the menu and the button's own click would immediately reopen it,
 * leaving the toggle unable to close what it opened.
 */
export type MenuDismissEvent =
  | { kind: 'key'; key: string }
  | { kind: 'pointer'; inside: boolean }

export function shouldDismissMenu(e: MenuDismissEvent): boolean {
  if (e.kind === 'key') return e.key === 'Escape'
  return !e.inside
}

export function RecentFilesMenu({
  recent,
  onPick,
  onClear
}: RecentFilesMenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (!shouldDismissMenu({ kind: 'key', key: e.key })) return
      e.preventDefault()
      setOpen(false)
    }
    function onPointerDown(e: MouseEvent): void {
      const wrapper = wrapperRef.current
      const inside = wrapper !== null && wrapper.contains(e.target as Node)
      if (shouldDismissMenu({ kind: 'pointer', inside })) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // mousedown, not click: closing on press matches every other popover the
    // OS shows, and it fires before the toggle button's own click handler.
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  if (recent.length === 0) return null

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        className="btn-ghost px-3 py-1.5 text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Recent ({recent.length})
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-bg-elevated border border-ink-dim/40 rounded-md shadow-2xl min-w-[280px] max-w-[420px]"
          onMouseLeave={() => setOpen(false)}
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {recent.map((path) => (
              <li key={path}>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover truncate"
                  title={path}
                  onClick={() => {
                    setOpen(false)
                    onPick(path)
                  }}
                >
                  <span className="font-mono">{basename(path)}</span>
                  <span className="text-ink-dim text-xs ml-2 truncate">
                    {path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-dim/30 px-2 py-1">
            <button
              onClick={() => {
                setOpen(false)
                onClear()
              }}
              className="text-xs text-ink-dim hover:text-danger px-1"
            >
              Clear list
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
