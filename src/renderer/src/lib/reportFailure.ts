import toast from 'react-hot-toast'
import { CANCEL_TOAST_MS, ERROR_TOAST_MS, userFacingError } from '@shared/userFacingError'

/**
 * T-84 — what every `catch` around a `window.api.*` call does with the error.
 *
 * `failed` is the feature's context sentence ("GIF export failed.") — the
 * words used when nothing more specific is known, and the lead-in when it is.
 * `canceled` is the feature's own neutral line ("GIF canceled."); only the
 * feature knows what "canceled" means for it (a batch can say what already
 * finished). A job the user stopped raises a plain `toast(...)` — no red
 * cross, no `toast.error` — and a failure raises `toast.error` for long
 * enough to be read (`ERROR_TOAST_MS`).
 *
 * `id` (T-132 (13)) is react-hot-toast's toast id: a failure that can repeat inside one gesture
 * (Export remembers up to four preferences, each its own write) gives every repeat the same id, and
 * the library replaces the live toast instead of stacking an identical one under it (verified in 2.6.0:
 * a toast with no id of its own always makes a new card).
 *
 * Returns what was decided and the sentence shown, so a caller that also
 * paints state (ExportPanel's queue rows) uses the SAME verdict and words
 * rather than classifying the error a second time.
 */
export function reportFailure(
  err: unknown,
  copy: { failed: string; canceled?: string; id?: string }
): { cancelled: boolean; message: string } {
  const { cancelled, message } = userFacingError(err, copy.failed)
  if (cancelled) {
    const text = copy.canceled ?? message
    toast(text, { duration: CANCEL_TOAST_MS })
    return { cancelled, message: text }
  }
  toast.error(message, { duration: ERROR_TOAST_MS, ...(copy.id ? { id: copy.id } : {}) })
  return { cancelled, message }
}
