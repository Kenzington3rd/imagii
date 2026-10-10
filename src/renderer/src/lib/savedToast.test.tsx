import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const success = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => success(...args) }
}))

import { ACTION_TOAST_MS, SHOW_IN_FOLDER, toastSaved, toastWithActions } from './savedToast'

/**
 * T-92: a toast that carries the only way to do something lasts long enough to
 * use it, and names the action in full. The renderer has no DOM under vitest,
 * so the toast's element tree is read directly: its text, its buttons, and
 * what a button's click does.
 */

interface Seen {
  texts: string[]
  buttons: Array<{ label: string; className: string; click: () => void }>
}

function read(node: ReactNode, seen: Seen = { texts: [], buttons: [] }): Seen {
  if (node === null || node === undefined || typeof node === 'boolean') return seen
  if (typeof node === 'string' || typeof node === 'number') {
    seen.texts.push(String(node))
    return seen
  }
  if (Array.isArray(node)) {
    for (const child of node) read(child as ReactNode, seen)
    return seen
  }
  const el = node as ReactElement<{
    children?: ReactNode
    onClick?: () => void
    className?: string
  }>
  if (el.type === 'button') {
    const label: string[] = []
    read(el.props.children, { texts: label, buttons: [] })
    seen.buttons.push({
      label: label.join(''),
      className: el.props.className ?? '',
      click: () => el.props.onClick?.()
    })
    return seen
  }
  return read(el.props.children, seen)
}

const reveal = vi.fn()

beforeEach(() => {
  success.mockClear()
  reveal.mockClear()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { video: { revealInFolder: reveal } }
  }
})

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('toastSaved', () => {
  it('lasts at least 8 seconds — the default 2 s took the button away', () => {
    toastSaved('Saved the GIF', 'C:/out/clip.gif')
    expect(success).toHaveBeenCalledTimes(1)
    const options = success.mock.calls[0]?.[1] as { duration?: number }
    expect(options.duration).toBe(ACTION_TOAST_MS)
    expect(ACTION_TOAST_MS).toBeGreaterThanOrEqual(8000)
  })

  it('says what was saved and offers "Show in folder", never a bare "Show"', () => {
    toastSaved('Saved the GIF', 'C:/out/clip.gif')
    const seen = read(success.mock.calls[0]?.[0] as ReactNode)
    expect(seen.texts.join('').trim()).toBe('Saved the GIF')
    expect(seen.buttons.map((b) => b.label)).toEqual([SHOW_IN_FOLDER])
    expect(SHOW_IN_FOLDER).toBe('Show in folder')
  })

  it('the button reveals exactly the file that was written', () => {
    toastSaved('Saved the GIF', 'C:/out/clip.gif')
    const [button] = read(success.mock.calls[0]?.[0] as ReactNode).buttons
    button?.click()
    expect(reveal).toHaveBeenCalledWith('C:/out/clip.gif')
  })

  it('carries a second action after the first (Record: Edit in Video Studio)', () => {
    const edit = vi.fn()
    toastSaved('Saved 12.3 MB', 'C:/rec.mp4', { label: 'Edit in Video Studio', onClick: edit })
    const seen = read(success.mock.calls[0]?.[0] as ReactNode)
    expect(seen.buttons.map((b) => b.label)).toEqual(['Show in folder', 'Edit in Video Studio'])
    seen.buttons[1]?.click()
    expect(edit).toHaveBeenCalledTimes(1)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('every button opts back in to the pointer, because the toast card is click-through', () => {
    // AppToaster styles the card `pointer-events: none` (AppToaster.test.tsx) so a
    // toast never blocks the control beneath it; pointer-events is inherited, so a
    // button that did not say `pointer-events-auto` would be unclickable.
    toastSaved('Saved 12.3 MB', 'C:/rec.mp4', { label: 'Edit in Video Studio', onClick: () => {} })
    const { buttons } = read(success.mock.calls[0]?.[0] as ReactNode)
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b.className, b.label).toMatch(/\bpointer-events-auto\b/)
  })

  it('a sentence with no trailing period, so the buttons follow it cleanly', () => {
    toastSaved('Saved the compilation', 'C:/x.mp4')
    const seen = read(success.mock.calls[0]?.[0] as ReactNode)
    expect(seen.texts.join('').trim()).not.toMatch(/\.$/)
  })
})

describe('toastWithActions', () => {
  it('uses the same long duration for any action toast', () => {
    toastWithActions('Done something', [{ label: 'Undo', onClick: () => {} }])
    expect((success.mock.calls[0]?.[1] as { duration: number }).duration).toBe(ACTION_TOAST_MS)
  })
})
