import { useState } from 'react'

interface RecentFilesMenuProps {
  recent: string[]
  onPick: (path: string) => void
  onClear: () => void
}

function basename(p: string): string {
  const c = p.replace(/\\/g, '/')
  return c.substring(c.lastIndexOf('/') + 1)
}

export function RecentFilesMenu({
  recent,
  onPick,
  onClear
}: RecentFilesMenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (recent.length === 0) return null

  return (
    <div className="relative">
      <button
        className="btn-ghost px-3 py-1.5 text-sm"
        onClick={() => setOpen((v) => !v)}
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
              className="text-xs text-ink-dim hover:text-rose-300 px-1"
            >
              Clear list
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
