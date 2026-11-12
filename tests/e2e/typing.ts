import type { Locator } from '@playwright/test'

/**
 * T-123 (3), (4): type into a box the way a person who wants a different number does.
 *
 * `locator.fill('600')` REPLACES the box's value in one step, so it can never find a box that rewrites itself on
 * every keystroke: the specs that filled the PiP width, the text overlay's Time boxes and the others were green
 * for rounds while "600" typed key by key gave 360600 and "12" gave 1.00. A person selects the old number,
 * deletes it (the box is EMPTY now - the instant an `|| default` snapped it back) and types the new digits one at a
 * time. This does exactly that, so the digits go through every intermediate state a real keyboard produces.
 */
export async function retype(box: Locator, text: string): Promise<void> {
  await box.click()
  await box.press('Control+a')
  await box.press('Backspace')
  await box.pressSequentially(text)
}

/** Leave the box (Tab), which is when a draft is committed and, where a range applies, clamped. */
export async function leave(box: Locator): Promise<void> {
  await box.press('Tab')
}
