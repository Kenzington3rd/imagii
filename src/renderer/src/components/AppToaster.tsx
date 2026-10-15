import { Toaster } from 'react-hot-toast'
import { BG_BASE, BG_ELEVATED, DANGER_STRONG, INK_BASE, INK_DIM, OK_STRONG, withAlpha } from '../styles/tokens'

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
  // for as long as it was up: 2 s for a success toast, 4 s for a plain or an error one (react-hot-toast's
  // defaults; this component sets none), 8 s for an action toast, and
  // indefinitely while the pointer rested on it (the library pauses a hovered
  // toast's timer, so a pointer parked over the card kept it alive). The card is
  // click-through; the one thing in a toast that is meant to be pressed (the
  // "Show in folder" button in `lib/savedToast.tsx`) opts back in with
  // `pointer-events-auto`, which also keeps the toast up while it is pointed at.
  pointerEvents: 'none'
} as const

/**
 * T-125 (13): the round mark on a success and an error toast. react-hot-toast draws them in its own stock green and red, which are
 * neither the palette's `ok` nor its `danger`: a toast was the one place a third green and a third red showed.
 * `primary` is the disc, `secondary` the tick or cross drawn on it; BG_BASE on the disc is 10.08:1 (OK_STRONG) and 7.20:1
 * (DANGER_STRONG), the pairings `tokens.ts` documents for "bg-base text on the strong tone".
 */
export const TOAST_ICON_THEME = {
  success: { primary: OK_STRONG, secondary: BG_BASE },
  error: { primary: DANGER_STRONG, secondary: BG_BASE }
} as const

/**
 * The app-wide toast surface. Extracted because all five studios
 * inlined an identical `<Toaster>` with the same 8-line `toastOptions`
 * style block — see docs/STYLE_GUIDE.md "Shared affordances".
 *
 * react-hot-toast's `style` API takes raw CSS, not Tailwind classes, so
 * the style block is built from the `tokens.ts` constants (`BG_ELEVATED`,
 * `INK_BASE`, `INK_DIM`, `withAlpha`) — no raw color literals here.
 */
export function AppToaster(): JSX.Element {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        style: TOAST_STYLE,
        success: { iconTheme: TOAST_ICON_THEME.success },
        error: { iconTheme: TOAST_ICON_THEME.error }
      }}
    />
  )
}
