import { useId, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

/**
 * A box that keeps what is typed to itself until typing ends (T-113, lifted here by T-123 (4)).
 *
 * A controlled number or text input that judges every keystroke cannot be typed into. The store holds a value in
 * the one form its gate takes (a hex color, a size from 8 to 512, a width from 120 to 960), so a half-typed "blue" on
 * its way to "blueviolet", a "7" on its way to "72", and - the case that moved this out of the text overlay editor -
 * an EMPTIED box (select the old number, delete it) must not be pushed through that and handed back: `Number(typed)
 * || 360` snapped the empty box to 360 on the spot, so the digits typed next appended to it ("600" was 360600, and
 * the composite failed upstream with a bare "Picture-in-picture failed."). Nine boxes did it before they used this.
 *
 * `commit` runs when the box is left or Enter is pressed - or, with `live`, as soon as what is typed is already
 * usable (a number inside the range: the store follows while the person types) - and returns a sentence when it
 * cannot use the text, which the box shows (the text stays for the person to fix). A commit that stores nothing
 * (an empty box, text that is not a number) returns null and the box shows what the store has. `value` is the
 * store's, formatted the way the box shows it at rest ("12.00").
 *
 * T-125 (8): while the box has focus it shows what was TYPED, even after a live commit (see `onChange`); on leaving it shows the
 * stored number again.
 *
 * With `label` it draws the whole labeled row the text overlay editor uses; without it, just the box (and the
 * refusal sentence under it), for a site whose `<label>` wraps it its own way. T-126 (3): that site's row must be
 * `flex-wrap` for the sentence to take a full-width row of its own under the box (`basis-full`, drawn last, so a
 * trailing "s" stays with its box); a row that cannot wrap squeezes it beside the box, which was the defect (an 8-line
 * column 70 px wide in the overlay card). A wrapper around box + refusal is not used: the boxes' own classes
 * (`flex-1 min-w-0`) are flex-item classes of the caller's row, and a wrapper would take the place they act in.
 */
export interface DraftFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type' | 'aria-invalid' | 'aria-describedby'
  > {
  value: string
  type: 'text' | 'number'
  commit: (typed: string) => string | null
  live?: (typed: string) => boolean
  label?: string
}

export function DraftField(props: DraftFieldProps): JSX.Element {
  const { value, type, commit, live, label, className, ...inputProps } = props
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // T-125 (8): the text a live commit last stored, so leaving the box does not commit the same number a second time (a store that
  // pushes an undo step per update would record it twice).
  const liveCommitted = useRef<string | null>(null)
  // T-114: the sentence that says why the box was refused is the box's description, so focusing it
  // reads the reason rather than only "invalid".
  const alertId = useId()

  function finish(): void {
    if (draft === null) return
    if (liveCommitted.current === draft) {
      // The store already has exactly this: nothing to commit, only the box to give back to the stored number.
      liveCommitted.current = null
      setProblem(null)
      setDraft(null)
      return
    }
    const refused = commit(draft)
    setProblem(refused)
    if (refused === null) setDraft(null)
  }

  const box = (
    <input
      {...inputProps}
      type={type}
      value={draft ?? value}
      aria-invalid={problem !== null}
      aria-describedby={problem ? alertId : undefined}
      onChange={(e) => {
        const typed = e.target.value
        setProblem(null)
        // T-125 (8): the box keeps what is typed for as long as it has focus - a number that is already usable still goes to the
        // store (`live`), but it is NOT swapped for the stored number mid-word. Handing the box back to `value` on every usable
        // keystroke made React compare the stored text with the browser's ("0." reads as "" in a number input, so "0" -> "0." was a
        // mismatch) and write it over the caret: "0.05" lost its point and arrived as 1, "-0.5" lost its sign. The box shows the
        // stored number again when it is left (`finish`).
        setDraft(typed)
        if (live?.(typed)) {
          commit(typed)
          liveCommitted.current = typed
        } else {
          liveCommitted.current = null
        }
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish()
      }}
      className={className}
    />
  )
  // T-126 (3): `basis-full order-last` - see the component doc: a full-width row of its own, after everything else in a wrapping row.
  const refusal = problem ? (
    <p id={alertId} role="alert" className="text-xs text-danger basis-full order-last">
      {problem}
    </p>
  ) : null

  if (label === undefined) {
    return (
      <>
        {box}
        {refusal}
      </>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center gap-1.5">
        <span className="text-ink-muted w-14 shrink-0">{label}</span>
        {box}
      </label>
      {refusal}
    </div>
  )
}
