import { describe, it, expect, vi, afterEach } from 'vitest'
import { persistWindowBounds, type BoundsSource } from './windowBounds'

/**
 * T-124 (4): the window-geometry write is the one synchronous config write in main that nothing guarded. A held
 * `config.json` (executed with `chattr +i`: EPERM) raised Electron's blocking error dialog from the debounce timer
 * and aborted the close handler ahead of the quit snapshot.
 */

function fakeWindow(over: Partial<BoundsSource> = {}): BoundsSource {
  return {
    isDestroyed: () => false,
    getNormalBounds: () => ({ x: 10, y: 20, width: 1200, height: 800 }),
    isMaximized: () => false,
    ...over
  }
}

afterEach(() => vi.restoreAllMocks())

describe('persistWindowBounds', () => {
  it('writes the normal bounds (not the maximized ones) and whether the window is maximized', () => {
    const write = vi.fn()
    persistWindowBounds(fakeWindow({ isMaximized: () => true }), write)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith({ x: 10, y: 20, width: 1200, height: 800, maximized: true })
  })

  it('does nothing for a window that is gone', () => {
    const write = vi.fn()
    persistWindowBounds(fakeWindow({ isDestroyed: () => true }), write)
    expect(write).not.toHaveBeenCalled()
  })

  it('a write the file system refuses (EPERM on a held config.json) is a warning, not a throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const write = vi.fn(() => {
      throw Object.assign(new Error("EPERM: operation not permitted, rename 'config.json.tmp' -> 'config.json'"), { code: 'EPERM' })
    })
    expect(() => persistWindowBounds(fakeWindow(), write)).not.toThrow()
    expect(write).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.join(' '))).toMatch(/window (size|bounds|geometry).*EPERM/is)
  })

  it('a window that dies between the check and the question is a warning too (BrowserWindow throws "Object has been destroyed")', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const write = vi.fn()
    const win = fakeWindow({
      getNormalBounds: () => {
        throw new TypeError('Object has been destroyed')
      }
    })
    expect(() => persistWindowBounds(win, write)).not.toThrow()
    expect(write).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('the next write after a failed one still goes through (nothing is latched)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let held = true
    const stored: unknown[] = []
    const write = (b: unknown): void => {
      if (held) throw new Error('EPERM')
      stored.push(b)
    }
    persistWindowBounds(fakeWindow(), write)
    held = false
    persistWindowBounds(fakeWindow(), write)
    expect(stored).toHaveLength(1)
  })
})
