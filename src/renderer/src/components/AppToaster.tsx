import { Toaster } from 'react-hot-toast'
import { BG_ELEVATED, INK_BASE, INK_DIM, withAlpha } from '../styles/tokens'

/**
 * What every toast card is styled with. Exported so the unit test can read the
 * one line that matters without a DOM (see `pointerEvents`).
 */
export const TOAST_STYLE = {
  background: BG_ELEVATED,
  color: INK_BASE,
  // T-71: was a hand-copied `rgba(156, 143, 139, 0.25)` — INK_DIM at
  // 25%, spelled out, in a file that already imported two tokens.
  border: `1px solid ${withAlpha(INK_DIM, 0.25)}`,
  // T-92: a toast card must never catch the pointer. react-hot-toast draws every
  // card with `pointer-events: auto`, so a card sat over whatever lived beneath
  // it (the bottom-centre strip is the Export button's) and swallowed the click
  // for as long as it was up: 2 s for a plain toast, 8 s for an action toast, and
  // indefinitely while the pointer rested on it (the library pauses a hovered
  // toast's timer, so a pointer parked over the card kept it alive). The card is
  // click-through; the one thing in a toast that is meant to be pressed (the
  // "Show in folder" button in `lib/savedToast.tsx`) opts back in with
  // `pointer-events-auto`, which also keeps the toast up while it is pointed at.
  pointerEvents: 'none'
} as const

/**
 * The app-wide toast surface. Extracted because all five studios
 * inlined an identical `<Toaster>` with the same 8-line `toastOptions`
 * style block — see docs/STYLE_GUIDE.md "Shared affordances".
 *
 * The inline hex values are unavoidable: react-hot-toast's `style` API
 * takes raw CSS, not Tailwind classes. Keeping them in one component
 * means the toast styling has a single source of truth — they mirror
 * the `bg-elevated` / `ink-base` / `ink-dim` design tokens.
 */
export function AppToaster(): JSX.Element {
  return <Toaster position="bottom-center" toastOptions={{ style: TOAST_STYLE }} />
}
