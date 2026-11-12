import type { ReactElement } from 'react'
import toast from 'react-hot-toast'

/**
 * T-92: a success toast that carries the ONLY way to do something next.
 *
 * react-hot-toast's success toast lasts 2 s. Four panels put a bare "Show"
 * button on one (GIF, picture-in-picture, reframe, compilation) and Record put
 * "Show" and "Edit in Video Studio" on another, so a person who looked away
 * for three seconds lost the button — and the only other route to the file was
 * to remember the folder they had picked. An action toast therefore lasts
 * `ACTION_TOAST_MS`, long enough to be read and used, and names its action in
 * full: "Show in folder", never "Show".
 *
 * One helper, so the duration and the words cannot drift apart by panel
 * (docs/BRANDING_GUIDE.md, "Toasts"). `tests/unit/copyConventions.test.ts`
 * fails on a toast that renders a bare "Show".
 */

/** Long enough to read the sentence and still reach the button. */
export const ACTION_TOAST_MS = 8000

/** The label every reveal-the-file button carries. */
export const SHOW_IN_FOLDER = 'Show in folder'

export interface ToastAction {
  label: string
  onClick: () => void
}

/**
 * A success toast with buttons after the sentence. `message` is the
 * completion sentence with no trailing period ("Saved the GIF"); the buttons
 * are the actions the person can take on the result. T-190 (4): an optional `icon` rides in the toast's options (the success toast's check is replaced), for
 * the one outcome that is not a plain success but still wrote a file and so still needs the buttons (a burn over a range nobody speaks in: a warning).
 */
export function toastWithActions(message: string, actions: ReadonlyArray<ToastAction>, icon?: ReactElement): void {
  toast.success(
    <span>
      {message}
      {actions.map((action) => (
        <span key={action.label}>
          {' '}
          {/* The toast card is click-through (AppToaster's TOAST_STYLE), so the
              button opts back in: it is the one part of the toast that takes a
              click. */}
          <button className="underline pointer-events-auto" onClick={action.onClick}>
            {action.label}
          </button>
        </span>
      ))}
    </span>,
    { duration: ACTION_TOAST_MS, ...(icon !== undefined && { icon }) }
  )
}

/**
 * "Saved the GIF  Show in folder": a finished file and the way to it, plus any
 * `extra` action (Record's "Edit in Video Studio").
 */
export function toastSaved(message: string, outputPath: string, extra?: ToastAction, icon?: ReactElement): void {
  toastWithActions(
    message,
    [
      {
        label: SHOW_IN_FOLDER,
        onClick: () => {
          void window.api.video.revealInFolder(outputPath)
        }
      },
      ...(extra ? [extra] : [])
    ],
    icon
  )
}

/** The product's one dismiss word (BRANDING_GUIDE, "Dismissing a dialog"). */
const CLOSE = 'Close'

/**
 * T-142 (1): the toast for a take imagii KEPT because the file could not be put where the person asked (Record's refused swap, T-141 (5)). The raw take
 * in the data folder is then the only copy of a finished recording, and the sentence that says so names a hidden folder nobody can type, so the toast
 * carries the way there and stays: a person who looked away for 8 s must still find it. `message` is the finished sentence from main, `takeId` the
 * take's session id (main builds the path from it; the renderer never names a path).
 *
 * "Show in folder" does NOT dismiss: the person may need it twice (the window it opened can be closed, or lost behind another). "Close" is the only
 * way off, and the toast is the red error kind, as every failure is.
 */
export function toastKeptTake(message: string, takeId: string): void {
  const id = `kept-take-${takeId}`
  toast.error(
    <span>
      {message}{' '}
      {/* Click-through card: see toastWithActions. */}
      <button
        className="underline pointer-events-auto"
        onClick={() => {
          void window.api.recording.revealTake(takeId)
        }}
      >
        {SHOW_IN_FOLDER}
      </button>{' '}
      <button className="underline pointer-events-auto" onClick={() => toast.dismiss(id)}>
        {CLOSE}
      </button>
    </span>,
    { duration: Infinity, id }
  )
}
