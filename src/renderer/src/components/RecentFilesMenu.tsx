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
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  /**
   * T-140 (9): closing the menu with focus in it. The open list unmounts, and focus on an item (or on Clear list) goes with it - to the page, so the next Tab starts from the
   * top of the window and a keyboard person has lost their place. Asked BEFORE it closes (the unmount is what drops focus): focus that was in the menu goes to the toggle,
   * which stays. Focus anywhere else (a press outside on a control, a mouse that left the list) is where the person put it and is left alone.
   */
  function focusIsInside(): boolean {
    return wrapperRef.current?.contains(document.activeElement) ?? false
  }
  function closeToToggle(): void {
    const hadFocus = focusIsInside()
    setOpen(false)
    if (hadFocus) toggleRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (!shouldDismissMenu({ kind: 'key', key: e.key })) return
      e.preventDefault()
      closeToToggle()
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
        ref={toggleRef}
        className="btn-ghost px-3 py-1.5 text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Recent ({recent.length})
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-bg-elevated border border-ink-dim/40 rounded-md shadow-2xl min-w-[280px] max-w-[420px]"
          onMouseLeave={closeToToggle}
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {recent.map((path) => (
              <li key={path}>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover truncate"
                  title={path}
                  onClick={() => {
                    // T-140 (9): the toggle keeps the focus while the pick runs. A pick that opens a file replaces the importer with the studio (as Choose file… does), and
                    // focus has no control left to stay on then; one that is refused, or still converting, leaves the importer up, and the toggle keeps the focus.
                    closeToToggle()
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
                const hadFocus = focusIsInside()
                setOpen(false)
                // T-140 (9): with no entries left the whole menu unmounts, the toggle with it, so there is no toggle to hand the focus to. The control before the menu in its
                // row (the importers' "Choose file…") takes it: the place the person was working, and the next thing they would do.
                if (hadFocus) {
                  const before = wrapperRef.current?.previousElementSibling
                  if (before instanceof HTMLElement) before.focus()
                  else toggleRef.current?.focus()
                }
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
