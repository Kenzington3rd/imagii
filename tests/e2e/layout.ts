import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

/**
 * T-123 (24)-(27): the one assertion the suite had no way to make - "nothing in here is wider than the box it is in".
 *
 * Ten sweeps missed a Rotation row that was clipped behind a hidden horizontal scrollbar at EVERY window size, because
 * every E2E reaches a control with Playwright's `click()`, which scrolls the element into view first: a button that
 * cannot be seen is clicked anyway. A layout defect is not a behavior the click can see; the geometry is. So these read
 * it directly: `scrollWidth <= clientWidth` on the container (no overflow, hidden scrollbar or not), and every named
 * control's right edge inside the container's own.
 *
 * The window is the one a person gets, set on purpose: the app opens at 85% of the display (1632x918 on a 1080p
 * screen, `windowSizing.ts`), and Xvfb's display is not that, so a layout test says which size it is checking.
 */

/** The size a 1920x1080 display opens the app at. */
export const DEFAULT_WINDOW = { width: 1632, height: 918 } as const
/** `main/index.ts` minWidth / minHeight: the smallest the window can be dragged to. */
export const MIN_WINDOW = { width: 1024, height: 640 } as const

/**
 * Resize the REAL OS window (the way `image.spec.ts`'s own `setWindowSize` does) and wait until the page has laid out
 * at that width: the resize event, the media queries (`lg:` grids) and the clamp()ed columns all settle after it.
 */
export async function setWindowSize(
  app: ElectronApplication,
  window: Page,
  size: { width: number; height: number }
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('no BrowserWindow to resize')
    win.setMinimumSize(300, 300)
    win.setSize(s.width, s.height)
  }, size)
  await expect
    .poll(() => window.evaluate(() => [window.innerWidth, window.innerHeight]), { timeout: 10_000 })
    .toEqual([size.width, size.height])
  // One frame for the layout that follows the resize (a clamp()ed column, a wrapping row).
  await window.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export interface Overflow {
  scrollWidth: number
  clientWidth: number
  /** Descendants whose right edge is past the container's, widest first: what to look at when it fails. */
  offenders: string[]
}

/** What `container` holds past its own right edge. Read in the page, so it is the real layout. */
export function measureOverflow(container: Locator): Promise<Overflow> {
  return container.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const offenders: Array<{ over: number; what: string }> = []
    for (const child of Array.from(el.querySelectorAll('*'))) {
      const r = child.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const over = Math.round(r.right - (box.left + el.clientLeft + el.clientWidth))
      if (over > 1) {
        const text = ((child as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
        offenders.push({ over, what: `<${child.tagName.toLowerCase()}> "${text}" +${over}px` })
      }
    }
    offenders.sort((a, b) => b.over - a.over)
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      offenders: offenders.slice(0, 6).map((o) => o.what)
    }
  })
}

/**
 * `container` has no horizontal overflow: nothing in it is wider than it is, so no scrollbar (hidden or drawn) and no
 * control clipped or poking out past its edge. `what` names it in the failure ("the Properties column at 1632 px").
 */
export async function expectNoHorizontalOverflow(container: Locator, what: string): Promise<void> {
  await expect(container, `${what} is on screen`).toBeVisible()
  const m = await measureOverflow(container)
  expect(
    m.scrollWidth,
    `${what} scrolls sideways: its content is ${m.scrollWidth} px wide in a ${m.clientWidth} px box. Past its edge: ${m.offenders.join('; ') || '(nothing measured)'}`
  ).toBeLessThanOrEqual(m.clientWidth)
  expect(m.offenders, `${what}: nothing may sit past its right edge`).toEqual([])
}

/**
 * Every control in `controls` is drawn whole and inside `container`: its right edge is within the container's (so it
 * is not behind a scrollbar or off the card), and its own text is not cut off (`scrollWidth <= clientWidth`, the
 * "Aggress" of an "Aggressive" button in a column too narrow for it).
 */
export async function expectControlsWhole(
  container: Locator,
  controls: Locator,
  what: string
): Promise<void> {
  const n = await controls.count()
  expect(n, `${what}: found no controls to measure`).toBeGreaterThan(0)
  const box = await container.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { right: r.left + el.clientLeft + el.clientWidth }
  })
  for (let i = 0; i < n; i++) {
    const control = controls.nth(i)
    const m = await control.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return {
        label: ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30),
        right: r.right,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      }
    })
    expect(m.right, `${what}: "${m.label}" ends ${Math.round(m.right - box.right)} px past the box's right edge`).toBeLessThanOrEqual(box.right + 0.5)
    expect(m.scrollWidth, `${what}: "${m.label}" is cut off (${m.scrollWidth} px of text in ${m.clientWidth} px)`).toBeLessThanOrEqual(m.clientWidth)
  }
}

/**
 * The width a native `<select>` spends on its drop-down arrow, beyond its own right padding (Chromium draws it inside the padding box, at
 * the right). Measured on the shipped Chromium by rendering selects of every width and comparing their pixels with a wide one's: the text
 * is drawn up to 25 px short of the select's right edge, which is 8 px of padding and 17 px of arrow, and a select 1 px too narrow for that
 * cuts the end of its text off. The constant is 19, 2 px more than measured, so a font that renders a hair wider is still a failure.
 */
export const SELECT_ARROW_PX = 19

/**
 * T-124 (24): a `<select>` is whole when the SELECTED option's text fits the box it is drawn in. `expectControlsWhole` is vacuous for
 * a select: it clips its text inside itself, so its `scrollWidth` equals its `clientWidth` whatever is cut off. Round 73's `min-w-0`
 * on the Power-line select traded the select poking past the card for a select that showed "60 Hz — US," of "60 Hz — US, Canada",
 * and the case that looked at it was green. This measures the text instead: the selected option's width in the select's own font
 * (a canvas `measureText`) against its content box (client width less padding) and the arrow.
 *
 * Also asserts the select ends inside `container` (the `expectControlsWhole` half), because that is the other way a select fails.
 */
export async function expectSelectsWhole(container: Locator, selects: Locator, what: string): Promise<void> {
  const n = await selects.count()
  expect(n, `${what}: found no selects to measure`).toBeGreaterThan(0)
  const box = await container.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { right: r.left + el.clientLeft + el.clientWidth }
  })
  for (let i = 0; i < n; i++) {
    const m = await selects.nth(i).evaluate((el, arrow) => {
      const select = el as HTMLSelectElement
      const cs = getComputedStyle(select)
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) throw new Error('no 2d context to measure text with')
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const selected = select.options[select.selectedIndex]
      const text = selected ? selected.text : ''
      const available = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - arrow
      return {
        text,
        textWidth: ctx.measureText(text).width,
        available,
        clientWidth: select.clientWidth,
        right: select.getBoundingClientRect().right
      }
    }, SELECT_ARROW_PX)
    expect(m.right, `${what}: the select ends ${Math.round(m.right - box.right)} px past the box's right edge`).toBeLessThanOrEqual(box.right + 0.5)
    expect(
      m.textWidth,
      `${what}: "${m.text}" is cut off (${Math.round(m.textWidth)} px of text for ${Math.round(m.available)} px of room in a ${m.clientWidth} px select)`
    ).toBeLessThanOrEqual(m.available)
  }
}

/**
 * T-124 (23): none of `elements` is drawn over another. The Text overlays card's Font select ran under "Size" and the layers' name
 * painted over "Move layer up": every one of them was inside its box and none was cut off, so `expectNoHorizontalOverflow` and
 * `expectControlsWhole` both passed. Pairs where one contains the other (a label and its input) are not overlaps.
 */
export async function expectNoOverlap(elements: Locator, what: string): Promise<void> {
  const rects = await elements.evaluateAll((els) =>
    els.map((el, index) => {
      const r = el.getBoundingClientRect()
      const text = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24)
      return { index, left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: `<${el.tagName.toLowerCase()}> "${text}"` }
    })
  )
  const contains = await elements.evaluateAll((els) => els.map((a) => els.map((b) => a !== b && a.contains(b))))
  const clashes: string[] = []
  for (const a of rects) {
    for (const b of rects) {
      if (a.index >= b.index) continue
      if (contains[a.index]?.[b.index] || contains[b.index]?.[a.index]) continue
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 1 && h > 1) clashes.push(`${a.text} and ${b.text} overlap by ${Math.round(w)} x ${Math.round(h)} px`)
    }
  }
  expect(clashes, `${what}: nothing may be drawn over anything else`).toEqual([])
}

/**
 * Every one of `elements` is a single line of text: its text height (the box less its own padding and border) is no more than one and a
 * half line heights. A label squeezed by a
 * row that has no room for it wraps by the word ("x / y" drawn on three lines), and nothing is clipped or outside its box.
 */
export async function expectOneLine(elements: Locator, what: string): Promise<void> {
  const n = await elements.count()
  expect(n, `${what}: found nothing to measure`).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    const m = await elements.nth(i).evaluate((el) => {
      const cs = getComputedStyle(el)
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25
      // T-126 (13): the TEXT's height - a button's vertical padding and border are not lines (a one-line `btn-primary` is a line and 12 px
      // of padding, which read as "two lines" to a check that took the box). An unpadded span is measured exactly as before.
      const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      return { text: ((el as HTMLElement).innerText || '').trim().slice(0, 24), height: el.getBoundingClientRect().height - chrome, lineHeight }
    })
    expect(m.height, `${what}: "${m.text}" wraps onto ${Math.round(m.height / m.lineHeight)} lines`).toBeLessThanOrEqual(m.lineHeight * 1.5)
  }
}

/**
 * T-125 (17): every one of `elements` sits on the SAME line: their vertical centres are within 3 px of each other. A flex row that wraps
 * by item can strand a glyph at the end of one line and start its box on the next (the Source time row left "→" at the end of the first
 * line and "[end] s" under it): nothing is clipped, nothing overlaps, every label is one line, so none of the other checks can see it.
 */
export async function expectSameRow(elements: Array<{ name: string; locator: Locator }>, what: string): Promise<void> {
  const centres: Array<{ name: string; y: number }> = []
  for (const { name, locator } of elements) {
    await expect(locator, `${what}: ${name} is on screen`).toBeVisible()
    centres.push({ name, y: await locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }) })
  }
  const first = centres[0]
  expect(first, `${what}: nothing to compare`).toBeDefined()
  for (const c of centres) {
    expect(
      Math.abs(c.y - (first as { y: number }).y),
      `${what}: ${c.name} is on a different line from ${(first as { name: string }).name} (${Math.round(c.y - (first as { y: number }).y)} px lower)`
    ).toBeLessThanOrEqual(3)
  }
}

/**
 * T-125 (11): `chip` has a name too long for it and says so the way a name is shortened: its text is cut (`scrollWidth` past `clientWidth`),
 * drawn with an ellipsis, and the full text is the tooltip (`title`). Pairs with `expectControlsWhole` on the buttons beside it, which is
 * the half that failed: the chip used to grow to the width of the name and push the primary button out of its card.
 */
export async function expectEllipsized(chip: Locator, fullText: string, what: string): Promise<void> {
  const m = await chip.evaluate(
    (el) => {
      const cs = getComputedStyle(el)
      return { overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, title: el.closest('[title]')?.getAttribute('title') ?? '' }
    },
    undefined,
    // A chip that is not there is the finding, and 30 s of waiting per card would only delay saying so.
    { timeout: 3_000 }
  )
  expect(m.textOverflow, `${what}: the name ends in an ellipsis`).toBe('ellipsis')
  expect(m.overflow, `${what}: and is clipped, not drawn past its box`).toBe('hidden')
  expect(m.whiteSpace, `${what}: on one line`).toBe('nowrap')
  expect(m.scrollWidth, `${what}: this name is longer than the room (the case is meaningless if it fits)`).toBeGreaterThan(m.clientWidth)
  expect(m.title, `${what}: the full path is the tooltip`).toBe(fullText)
}

/**
 * T-140 (5): `element` is wholly inside the window a person is looking at, as it stands: no click and no `scrollIntoView` first. Its box is inside the viewport on all four
 * sides, and the point at its centre belongs to it (or something in it) - a control clipped by a container that `overflow-hidden`s it can have a box in the window and still
 * not be there. Stream Graphics' Export bar sat at y = 640-694 of a 640 px window and its Layers card was off the right edge after a shrink, while every case that used them
 * passed: `click()` scrolls the element into view before it presses, which is exactly what a person's mouse wheel could not do (the root was `overflow-hidden`).
 */
export async function expectInViewport(element: Locator, what: string): Promise<void> {
  await expect(element, `${what} is on the page`).toBeVisible()
  const m = await element.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      onTop: hit !== null && (el === hit || el.contains(hit))
    }
  })
  expect(m.left, `${what} starts ${Math.round(-m.left)} px left of the window`).toBeGreaterThanOrEqual(-0.5)
  expect(m.top, `${what} starts ${Math.round(-m.top)} px above the window`).toBeGreaterThanOrEqual(-0.5)
  expect(m.right, `${what} ends ${Math.round(m.right - m.width)} px right of the window (${Math.round(m.right)} of ${m.width})`).toBeLessThanOrEqual(m.width + 0.5)
  expect(m.bottom, `${what} ends ${Math.round(m.bottom - m.height)} px below the window (${Math.round(m.bottom)} of ${m.height})`).toBeLessThanOrEqual(m.height + 0.5)
  expect(m.onTop, `${what} has something else (or nothing) at its centre: it is clipped or covered`).toBe(true)
}
