import { useEffect, useRef, useState } from 'react'
import type { Tool } from './state/canvasStore'
import { useCanvasStore } from './state/canvasStore'
import { Icon, type IconName } from '../../components/Icon'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'

interface ToolDef {
  id: Tool
  label: string
  icon: IconName
  shortcut?: string
  /** Phase 4A.3: tools used in <5% of streamer thumbnail/overlay work
   *  hide behind an "Advanced" disclosure to simplify the toolbar.
   *  Keyboard shortcuts in ImageStudio.tsx still work either way. */
  advanced?: boolean
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: 'cursor', shortcut: 'V' },
  { id: 'rect', label: 'Rectangle', icon: 'square', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', shortcut: 'O' },
  { id: 'line', label: 'Line', icon: 'line', shortcut: 'L', advanced: true },
  { id: 'pencil', label: 'Pencil', icon: 'pencil', shortcut: 'P', advanced: true }
]

/** The grid size the box takes (px): the 2 to 200 its attributes say, enforced when typing ends. */
const GRID_SIZE_MIN = 2
const GRID_SIZE_MAX = 200

export function Toolbar(): JSX.Element {
  const tool = useCanvasStore((s) => s.tool)
  const setTool = useCanvasStore((s) => s.setTool)
  const showGrid = useCanvasStore((s) => s.showGrid)
  const setShowGrid = useCanvasStore((s) => s.setShowGrid)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const setSnapToGrid = useCanvasStore((s) => s.setSnapToGrid)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const setGridSize = useCanvasStore((s) => s.setGridSize)
  // Show advanced if the user has opened it OR if an advanced tool is
  // currently active (otherwise selecting Line via shortcut hides the
  // active-tool indicator).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const activeIsAdvanced = TOOLS.some((t) => t.id === tool && t.advanced === true)
  const showAdvanced = advancedOpen || activeIsAdvanced

  // T-189 (1): revealing the tools removes the "+ More" button, and a removed element takes focus to <body> (STYLE_GUIDE's swap rule, T-119):
  // the next Tab started at the top of the window instead of at the Line and Pencil tools the person asked for. That holds for the button
  // pressed (Enter, Space, a click) and for L / P pressed while it has focus (`activeIsAdvanced` flips `showAdvanced` the same way). The
  // reveal's render still sees the old DOM, so "did the button hold focus" is read there; the effect then puts focus on the first revealed
  // tool (Line). A reveal while focus is elsewhere (L pressed with the canvas or the Grid box focused) moves nothing. Declared above any
  // early return (there is none), keyed on the swap.
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const lineRef = useRef<HTMLButtonElement | null>(null)
  const moreHadFocus = useRef(false)
  if (showAdvanced && moreRef.current !== null) moreHadFocus.current = document.activeElement === moreRef.current
  useEffect(() => {
    if (showAdvanced && moreHadFocus.current) lineRef.current?.focus()
    moreHadFocus.current = false
  }, [showAdvanced])

  return (
    <div className="card p-2 flex items-center gap-2 flex-wrap" data-tutorial="image-toolbar">
      <div className="flex items-center gap-1">
        {TOOLS.filter((t) => t.advanced !== true || showAdvanced).map((t) => (
          <button
            key={t.id}
            ref={t.id === 'line' ? lineRef : undefined}
            className={`px-3 py-1.5 text-sm rounded ${
              tool === t.id ? 'bg-accent text-bg-base' : 'hover:bg-bg-hover'
            }`}
            onClick={() => setTool(t.id)}
            aria-pressed={tool === t.id}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name={t.icon} size={14} />
              {t.label}
            </span>
          </button>
        ))}
        {!showAdvanced ? (
          <button
            ref={moreRef}
            className="px-2 py-1.5 text-xs text-ink-muted hover:text-ink-base hover:bg-bg-hover rounded"
            onClick={() => setAdvancedOpen(true)}
            title="Show line and pencil tools"
          >
            + More
          </button>
        ) : null}
      </div>
      <div className="w-px h-6 bg-ink-dim/30 mx-2" />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => setShowGrid(e.target.checked)}
        />
        Grid
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={(e) => setSnapToGrid(e.target.checked)}
        />
        Snap
      </label>
      {/* T-183 (4): the box says what it is - "Grid size (px)", the Properties panel's "Size (px)" pattern (BRANDING: a bare number is not a value). The label IS the
          accessible name (the M11 aria-label "Grid size in pixels" is gone: an aria-label outranks a wrapping label, and its words did not contain the visible "(px)", WCAG 2.5.3). */}
      <label className="flex items-center gap-1.5 text-sm">
        <span>Grid size (px)</span>
        {/* T-123 (4): kept until typing ends; `Number(typed) || 2` appended "40" to an emptied box as 240. */}
        <DraftField
          type="number"
          min={GRID_SIZE_MIN}
          max={GRID_SIZE_MAX}
          value={String(gridSize)}
          live={(typed) => isTypedInRange(typed, GRID_SIZE_MIN, GRID_SIZE_MAX)}
          commit={(typed) => {
            const n = clampTyped(typed, GRID_SIZE_MIN, GRID_SIZE_MAX)
            if (n !== null) setGridSize(n)
            return null
          }}
          className="bg-bg-base rounded px-2 py-1 w-16 text-sm"
          title="Grid size (px)"
        />
      </label>
    </div>
  )
}
