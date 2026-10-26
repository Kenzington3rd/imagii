import { useMemo } from 'react'
import { OVERLAY_SIZE_MAX, OVERLAY_SIZE_MIN } from '@shared/projectValidation'
import {
  OVERLAY_COLOR_REFUSAL,
  OVERLAY_FONTS,
  OVERLAY_TIME_REFUSAL,
  newTextOverlay,
  overlayOutsideClipMessage,
  overlayTimePair
} from '@shared/textOverlay'
import { parseClock } from '@shared/clockTime'
import { resolveOverlayColor } from '@shared/overlayColors'
import { handleGestureEndPointerUp, useVideoStore } from './store/videoStore'
import { PanelHeader } from '../../components/PanelHeader'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'

/** True when `typed` is a whole number inside the size range the export gate takes. */
function isSizeInRange(typed: string): boolean {
  const n = Number(typed)
  return typed.trim() !== '' && Number.isInteger(n) && n >= OVERLAY_SIZE_MIN && n <= OVERLAY_SIZE_MAX
}

export function TextOverlayEditor(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const addTextOverlay = useVideoStore((s) => s.addTextOverlay)
  const updateTextOverlay = useVideoStore((s) => s.updateTextOverlay)
  const removeTextOverlay = useVideoStore((s) => s.removeTextOverlay)
  const endGesture = useVideoStore((s) => s.endGesture)

  const clip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  )

  if (!source || !clip) return null

  function addOverlay(): void {
    if (!clip) return
    addTextOverlay(clip.id, newTextOverlay(clip.startSec, clip.endSec))
  }

  return (
    // T-40: one overlay's every field shares a coalescing key, so typing a
    // caption and later retyping its color were one undo step. Leaving a
    // field (focusout) or releasing a control ends that edit; both bubble, so
    // one pair here covers every input in every overlay row.
    // T-80: a click INSIDE the caption or a number field being edited bubbles
    // that same pointerup — `handleGestureEndPointerUp` lets it through, so
    // moving the caret mid-caption no longer starts a new undo step. Leaving
    // the field still ends the edit.
    <div
      className="card p-4 flex flex-col gap-3"
      onPointerUp={handleGestureEndPointerUp}
      onBlur={endGesture}
    >
      <PanelHeader
        icon="text"
        actions={
          <button className="btn-ghost px-3 py-1 text-xs" onClick={addOverlay}>
            + Add text
          </button>
        }
      >
        Text overlays ({clip.textOverlays.length})
      </PanelHeader>

      {clip.textOverlays.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Add a text overlay to draw a caption on the exported video.
        </p>
      ) : (
        // T-124 (19): nothing previews an overlay (the player and the output preview draw the picture only), and BRANDING says a
        // control with no live preview says so. T-124 (18): and the Time boxes are seconds in the SOURCE, not in the clip.
        <p className="text-xs text-ink-dim">
          Text appears in the exported file, not in the player. Times are seconds in the source video, or a time like 2:47:13.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {clip.textOverlays.map((overlay) => (
          <li
            key={overlay.id}
            className="border border-ink-dim/30 rounded-md p-3 flex flex-col gap-2"
          >
            {/* T-124 (23): the remove cross sits beside the caption. It was the last item of the Time row, which was 41 px wider
                than the card, so the cross stood 12 px outside it. */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={overlay.text}
                onChange={(e) =>
                  updateTextOverlay(clip.id, overlay.id, { text: e.target.value })
                }
                className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
                placeholder="Caption"
              />
              {/* T-17: the remove button is a sibling of the label of the boxes, not inside one, so a click on it never also
                  targets a field. */}
              <button
                onClick={() => removeTextOverlay(clip.id, overlay.id)}
                className="shrink-0 text-ink-dim hover:text-danger px-2"
                title="Remove"
                aria-label="Remove overlay"
              >
                ✕
              </button>
            </div>
            {/* T-124 (23): one control per row. The card is 230 px of room, and a two-column grid gave each cell 105: the Font
                select (`flex-1` without `min-w-0`) ran under "Size", the "x / y" label (`w-12`, squeezed) was drawn on three
                lines, and the Time row was 41 px wider than its cell. The labels do not shrink, the select may. */}
            <div className="flex flex-col gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-14 shrink-0">Font</span>
                <select
                  value={overlay.font}
                  onChange={(e) =>
                    updateTextOverlay(clip.id, overlay.id, { font: e.target.value })
                  }
                  className="bg-bg-base rounded px-1 py-0.5 flex-1 min-w-0"
                >
                  {OVERLAY_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <DraftField
                label="Size (px)"
                type="number"
                min={OVERLAY_SIZE_MIN}
                max={OVERLAY_SIZE_MAX}
                value={String(overlay.sizePx)}
                // Usable as typed: a whole number inside the range goes straight in.
                live={isSizeInRange}
                // Typing ends: a number outside the range becomes the nearest edge
                // (the store clamps), and text that is not a number is dropped.
                commit={(typed) => {
                  const n = Number(typed)
                  if (typed.trim() !== '' && Number.isFinite(n)) {
                    updateTextOverlay(clip.id, overlay.id, { sizePx: n })
                  }
                  return null
                }}
                className="bg-bg-base rounded px-1 py-0.5 flex-1"
              />
              <DraftField
                label="Color"
                type="text"
                value={overlay.colorHex}
                placeholder="white or #ffcc00"
                // A name or a code, applied when typing ends: "blue" is a color on its
                // way to "blueviolet", so no keystroke is judged on its own.
                commit={(typed) => {
                  const hex = resolveOverlayColor(typed)
                  if (hex === null) return OVERLAY_COLOR_REFUSAL
                  updateTextOverlay(clip.id, overlay.id, { colorHex: hex })
                  return null
                }}
                className="bg-bg-base rounded px-1 py-0.5 flex-1 min-w-0 font-mono"
              />
              <label className="flex items-center gap-1.5">
                <span className="text-ink-muted w-14 shrink-0">x / y</span>
                {/* T-124 (15): the boxes keep what is typed until typing ends, like Size and the Time boxes. A number input reports ""
                    for a lone "." (and for "-"), which the old per-keystroke handler turned into 0, so ".5" became "05" and 1. A
                    fraction inside 0 to 1 goes straight to the overlay as it is typed; typing ends clamping to the edge. */}
                <DraftField
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={String(overlay.x)}
                  // T-114: one <label> wraps both boxes, so only the first was named by it.
                  // T-115: and "x" / "y" said what they are called, not what they are.
                  // T-125 (27): and the name BEGINS with the text the row shows ("x / y"), so a person who says "click x / y" and a voice
                  // control that matches the visible label both land on the box (WCAG 2.5.3 Label in Name).
                  aria-label="x / y, horizontal position (0 to 1)"
                  live={(typed) => isTypedInRange(typed, 0, 1, false)}
                  commit={(typed) => {
                    const n = clampTyped(typed, 0, 1, false)
                    if (n !== null) updateTextOverlay(clip.id, overlay.id, { x: n })
                    return null
                  }}
                  className="bg-bg-base rounded px-1 py-0.5 w-16"
                />
                <DraftField
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={String(overlay.y)}
                  aria-label="x / y, vertical position (0 to 1)"
                  live={(typed) => isTypedInRange(typed, 0, 1, false)}
                  commit={(typed) => {
                    const n = clampTyped(typed, 0, 1, false)
                    if (n !== null) updateTextOverlay(clip.id, overlay.id, { y: n })
                    return null
                  }}
                  className="bg-bg-base rounded px-1 py-0.5 w-16"
                />
              </label>
              {/* T-124 (18): the boxes are seconds in the SOURCE video (they start as the clip's own range), and the label says so
                  with the line under the card's header. T-123 (3): they keep what is typed until typing ends, like Size and Color.
                  They rewrote their own value to "N.00" on every keystroke (`value={n.toFixed(2)}` and `Number(typed) || 0`), so
                  typing "12" gave 1.00. A commit stores the number (never below 0) and keeps the end from sitting before the
                  start; an empty box or text that is not a number changes nothing. The row wraps: its end box drops under the
                  start in a card too narrow for both. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {/* T-126 (3): the label and the end unit WRAP (a refused time's sentence is a full-width row of its own under the box). */}
                <label className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-ink-muted shrink-0">Source time</span>
                  {/* T-125 (23): a text box that reads seconds ("90.5") or a stream's own timestamp ("1:30", "2:47:13"): a number
                      box cannot be typed a colon into, and the Timeline now reads h:mm:ss from an hour up. T-126 (5): and at rest
                      the box says the same ("overlayTimePair": seconds below an hour, the clock from one hour up, decided by the PAIR so the
                      two boxes never speak different forms - T-127 (7)), so "2:47:18" is not rewritten to "10038.00" the moment the box is left. A time it cannot read is
                      refused in a sentence and kept for the person to fix (it used to be impossible to type a letter). T-125 (27): the
                      name begins with the visible "Source time". */}
                  <DraftField
                    type="text"
                    inputMode="decimal"
                    value={overlayTimePair(overlay.startSec, overlay.endSec).start}
                    commit={(typed) => {
                      if (typed.trim() === '') return null
                      const n = parseClock(typed)
                      if (n === null) return OVERLAY_TIME_REFUSAL
                      updateTextOverlay(clip.id, overlay.id, {
                        startSec: n,
                        ...(overlay.endSec < n ? { endSec: n } : {})
                      })
                      return null
                    }}
                    className="bg-bg-base rounded px-1 py-0.5 w-20"
                    aria-label="Source time, start (seconds, or a time like 2:47:13)"
                  />
                </label>
                {/* T-125 (17): the arrow, the end box and "s" are ONE wrap unit. As three flex items the row broke between the arrow
                    and the box and left "→" stranded at the end of the first line. T-127 (7): the "s" is the seconds form's unit; from
                    one hour up, either box makes BOTH the clock, which has none. */}
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-ink-dim">→</span>
                  <DraftField
                    type="text"
                    inputMode="decimal"
                    value={overlayTimePair(overlay.startSec, overlay.endSec).end}
                    commit={(typed) => {
                      if (typed.trim() === '') return null
                      const n = parseClock(typed)
                      if (n === null) return OVERLAY_TIME_REFUSAL
                      updateTextOverlay(clip.id, overlay.id, {
                        endSec: Math.max(overlay.startSec, n)
                      })
                      return null
                    }}
                    className="bg-bg-base rounded px-1 py-0.5 w-20"
                    aria-label="Source time, end (seconds, or a time like 2:47:13)"
                  />
                  {overlayTimePair(overlay.startSec, overlay.endSec).clock ? null : <span className="text-ink-dim">s</span>}
                </span>
              </div>
            </div>
            {/* T-124 (18): said as soon as it is true. A window that never meets this clip draws nothing, and the export finishes
                cleanly without the text. The wrapper is always mounted so the warning is ANNOUNCED when it appears (the GIF
                panel's pattern), and its gap is taken back while it is empty. */}
            <div role="status" className={overlayOutsideClipMessage(overlay, clip) ? undefined : '-mt-2'}>
              {overlayOutsideClipMessage(overlay, clip) ? (
                <p className="text-xs text-warn">{overlayOutsideClipMessage(overlay, clip)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
