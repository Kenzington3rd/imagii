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
 * are the actions the person can take on the result.
 */
export function toastWithActions(message: string, actions: ReadonlyArray<ToastAction>): void {
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
    { duration: ACTION_TOAST_MS }
  )
}

/**
 * "Saved the GIF  Show in folder": a finished file and the way to it, plus any
 * `extra` action (Record's "Edit in Video Studio").
 */
export function toastSaved(message: string, outputPath: string, extra?: ToastAction): void {
  toastWithActions(message, [
    {
      label: SHOW_IN_FOLDER,
      onClick: () => {
        void window.api.video.revealInFolder(outputPath)
      }
    },
    ...(extra ? [extra] : [])
  ])
}
