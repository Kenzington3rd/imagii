import type { Page } from '@playwright/test'

/**
 * T-70: the one toast recorder every spec in this directory uses.
 *
 * ── Why a recorder at all ─────────────────────────────────────────────
 *
 * Toasts auto-dismiss (4 s by default, 8-10 s for the long error copy), so
 * polling for one with a locator races the timer: a test that asserts an
 * export finished can easily arrive after the toast that said so. A
 * MutationObserver installed BEFORE the action never misses one, and the log
 * it fills is a plain array the assertions can read whenever they get there.
 *
 * ── Why the selector is this narrow ───────────────────────────────────
 *
 * Six copies of this helper recorded the text of EVERY element mounted under
 * `document.body`. That is not a toast log: React mounts a route's whole
 * subtree as one node, so a navigation logged an entire studio's panel copy
 * as a single entry, and any assertion phrased as `toContain` /
 * `not.toContain` / `toEqual([])` was answering a question about the page
 * rather than about the toasts. The T-41 pin's `toEqual([])` broke on the
 * FIXED build for exactly that reason.
 *
 * react-hot-toast gives us two halves of a precise address and both are
 * load-bearing:
 *   - `[role="status"]` is the `ariaProps` it puts on every toast message
 *     element (`role="status"`, `aria-live="polite"`), whatever the type.
 *   - `[data-rht-toaster]` is the attribute on the `<Toaster>` container.
 *     The app renders its own `role="status"` live regions too — the video
 *     ExportPanel's per-job percent readout is one — so the ancestor is what
 *     keeps a progress number from being logged as a toast.
 *
 * Identity, not text, is what de-duplicates: an element is recorded once, so
 * a re-render cannot double-log it, while two toasts carrying the SAME
 * sentence still produce two entries. Specs count those (a second refused
 * save must toast again, not silently reuse the first), and a text-keyed
 * dedupe would quietly turn that assertion green forever.
 */
const TOAST_SELECTOR = '[data-rht-toaster] [role="status"]'

export async function installToastLog(window: Page): Promise<void> {
  await window.evaluate((selector) => {
    const log: string[] = []
    ;(window as unknown as { __toastLog: string[] }).__toastLog = log
    const seen = new WeakSet<Element>()
    const record = (el: Element): void => {
      if (seen.has(el)) return
      seen.add(el)
      const text = (el.textContent ?? '').trim()
      if (text) log.push(text)
    }
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return
          const el = node as Element
          if (el.matches(selector)) record(el)
          el.querySelectorAll(selector).forEach(record)
        })
      }
    }).observe(document.body, { childList: true, subtree: true })
  }, TOAST_SELECTOR)
}

/** Every toast text recorded since `installToastLog`, in order. */
export function readToastLog(window: Page): Promise<string[]> {
  return window.evaluate(() => (window as unknown as { __toastLog?: string[] }).__toastLog ?? [])
}
