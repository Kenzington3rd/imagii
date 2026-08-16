import { expect, type Page } from '@playwright/test'

/**
 * T-55: the one contract every synthetic drag in this directory uses.
 *
 * ── The race these helpers exist to close ─────────────────────────────
 *
 * Playwright's `page.mouse` dispatches mouse events over CDP. It never moves
 * the machine's real pointer, so the browser's own pointer bookkeeping still
 * refers to wherever that pointer is actually parked — under a headless X
 * server, the middle of the virtual screen. When ANY other window maps over
 * that point mid-gesture — a second Playwright worker's Electron window, a
 * concurrent agent session's app, a system dialog — the display server sends a
 * crossing event and Chromium delivers a document-level `pointerout` with
 * `relatedTarget: null` while our button is still down.
 *
 * Gesture layers read that as "the pointer left the window" and stop:
 *
 *   - wavesurfer's `makeDraggable` (regions.esm.js) routes `pointerout` and
 *     `pointercancel` to the same handler as `pointerup`, so a null
 *     `relatedTarget` ends the drag, emits its "end", saves the region at
 *     whatever width it had reached, and REMOVES its `pointermove` listener.
 *   - Konva drops its cached pointer position, so `getPointerPosition()`
 *     returns null and `Canvas.tsx`'s move handler swallows the event.
 *
 * Every move dispatched after that point is discarded. This was reproduced
 * deterministically: mapping a second Electron window while the button was
 * down truncated a waveform drag in every attempt across two harnesses (3/3,
 * then 5/5), always at exactly the last move before the crossing event, with
 * the whole rest of the gesture logged as delivered to the document and
 * ignored by the app. The same drag in the shape below survived 5/5.
 *
 * ── What follows for a helper ─────────────────────────────────────────
 *
 * The window of exposure is `mouse.down()` -> the move that carries the
 * gesture's FULL extent. Once the app has the extent, a crossing event is
 * harmless: the gesture ends where it was already going to end. So:
 *
 *   1. Spend a couple of round trips inside that window, not sixteen.
 *      `steps: 8` buys nothing — a drag threshold is measured against the
 *      press point, not the previous step — and multiplies the exposure
 *      eightfold. See `SENDS_PER_POSITION` for where the count settles.
 *   2. Wait for the app to have REGISTERED the extent before releasing, with
 *      a polled condition on what the gesture draws (the selection region's
 *      width, the preview shape's size, the readout the drag moves). That is
 *      a deterministic wait, not a retry: the gesture is never re-sent, so a
 *      real regression still fails, and it fails saying which extent the app
 *      never reached instead of leaving a half-applied drag to be discovered
 *      three assertions later.
 *
 * Gestures that need intermediate positions to mean anything (a freehand
 * pencil stroke, a scrub asserted at three points) use `dragThrough`, which
 * applies the same rule to each position it visits.
 */

export interface DragPoint {
  x: number
  y: number
}

/** Poll `read` until it satisfies `settled`, then return. Never re-sends input. */
async function waitForExtent(
  label: string,
  read: () => Promise<number>,
  settled: (value: number) => boolean
): Promise<void> {
  let last = Number.NaN
  await expect
    .poll(
      async () => {
        last = await read()
        return settled(last)
      },
      { timeout: 10_000, message: `${label}: the drag never reached its extent (last read: ${last})` }
    )
    .toBe(true)
}

export interface DragOptions {
  /**
   * What the app draws while the button is down, and the extent it has to
   * reach before the button comes up. Omit only for a gesture with no
   * observable intermediate state (a sub-threshold drag that must commit
   * nothing has none by definition).
   */
  extent?: {
    label: string
    read: () => Promise<number>
    settled: (value: number) => boolean
  }
}

/**
 * How many times each destination is sent. The two failure modes pull in
 * opposite directions and this is where they balance:
 *
 *   - A crossing event TRUNCATES: everything after it is discarded, so the
 *     cost scales with how long the button stays down. `steps: 8` twice is
 *     ~16 round trips and half a second of exposure.
 *   - The same window mapping can instead make the browser DROP an event
 *     outright, and a gesture carried by exactly one move dies with it.
 *
 * Repeating the SAME destination costs nothing at any gesture layer here —
 * they work either from the pointer's absolute position or from a delta
 * measured against the last move they actually PROCESSED — so a repeat is a
 * no-op when the first one landed and carries the whole gesture when it did
 * not. Three sends of one destination is ~50 ms of exposure against ~500.
 */
const SENDS_PER_POSITION = 3

/**
 * Dispatch a destination `SENDS_PER_POSITION` times. Used for the approach to
 * the press point too, not just the drag: gesture layers read the press
 * position out of the pointer position they last PROCESSED, so a dropped
 * approach move makes the press land wherever the previous gesture ended —
 * which is how a 2 px drag that must commit nothing committed a rectangle
 * spanning half the canvas.
 */
async function sendMove(page: Page, to: DragPoint): Promise<void> {
  for (let i = 0; i < SENDS_PER_POSITION; i++) await page.mouse.move(to.x, to.y)
}

/**
 * Press and move in one go. `Promise.all` is not decoration: Playwright's
 * `Mouse` sends each CDP message from the call itself and the connection
 * preserves call order, so this puts `mousePressed` and `mouseMoved` on the
 * wire back to back instead of leaving a full round trip between them. (A
 * reordering would press at `to` instead of `from`, which every caller's own
 * assertions catch immediately — this cannot fail quietly.)
 */
async function pressAndMove(page: Page, to: DragPoint): Promise<void> {
  await Promise.all([page.mouse.down(), page.mouse.move(to.x, to.y)])
  for (let i = 1; i < SENDS_PER_POSITION; i++) await page.mouse.move(to.x, to.y)
}

/**
 * Press at `from`, drag to `to`, release once the app has the full extent.
 * See the header for why both halves matter.
 */
export async function dragTo(
  page: Page,
  from: DragPoint,
  to: DragPoint,
  options: DragOptions = {}
): Promise<void> {
  await sendMove(page, from)
  await pressAndMove(page, to)
  if (options.extent) {
    await waitForExtent(options.extent.label, options.extent.read, options.extent.settled)
  }
  await page.mouse.up()
}

/**
 * Press at `from`, then visit each point in `through`, releasing after the
 * last one. For gestures whose intermediate positions are the point of the
 * test (pencil strokes, a scrub asserted at several places); `onPoint` runs
 * after each position so the caller can make its assertion while the button is
 * still down. Each position is sent `SENDS_PER_POSITION` times for the reason
 * given there.
 */
export async function dragThrough(
  page: Page,
  from: DragPoint,
  through: DragPoint[],
  onPoint?: (point: DragPoint, index: number) => Promise<void>
): Promise<void> {
  await sendMove(page, from)
  for (const [index, point] of through.entries()) {
    if (index === 0) await pressAndMove(page, point)
    else await sendMove(page, point)
    if (onPoint) await onPoint(point, index)
  }
  await page.mouse.up()
}
