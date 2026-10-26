import { describe, it, expect, vi } from 'vitest'
import { sendIfAlive } from './sendIfAlive'

/**
 * T-123 (1): the one way main reports progress to a window. A destroyed WebContents throws on
 * `send`, and the callers are a child's stdout listener and a runner's await, which nothing
 * catches: Electron answers with its blocking "JavaScript error in the main process" dialog.
 * `closeMidJob.test.ts` drives every real handler with a dead sender; this file is the helper's
 * own contract.
 */
function sender(destroyed: boolean, throws = false): {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
} {
  return {
    isDestroyed: () => destroyed,
    send: vi.fn(() => {
      if (throws) throw new Error('Object has been destroyed')
    })
  }
}

describe('sendIfAlive', () => {
  it('hands a live window the channel and the payload, once, and says so', () => {
    const s = sender(false)
    expect(sendIfAlive(s, 'video:progress', { percent: 5 })).toBe(true)
    expect(s.send).toHaveBeenCalledTimes(1)
    expect(s.send).toHaveBeenCalledWith('video:progress', { percent: 5 })
  })

  it('sends a channel with no payload as a bare channel', () => {
    const s = sender(false)
    expect(sendIfAlive(s, 'ping')).toBe(true)
    expect(s.send).toHaveBeenCalledWith('ping')
  })

  it('never asks a destroyed WebContents to send (the flag is the cheap answer)', () => {
    const s = sender(true, true)
    expect(sendIfAlive(s, 'video:progress', { percent: 5 })).toBe(false)
    expect(s.send).not.toHaveBeenCalled()
  })

  it('swallows the throw of a window that dies between the check and the send', () => {
    const s = sender(false, true)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(() => sendIfAlive(s, 'audio:progress', { percent: 1 })).not.toThrow()
      expect(sendIfAlive(s, 'audio:progress', { percent: 1 })).toBe(false)
      expect(s.send).toHaveBeenCalledTimes(2)
      // Dropped, but not silently: the console says which report went nowhere.
      expect(String(log.mock.calls[0]?.[0])).toContain('audio:progress')
    } finally {
      log.mockRestore()
    }
  })

  it('swallows an isDestroyed that itself throws (the window object is gone)', () => {
    const s = {
      isDestroyed: (): boolean => {
        throw new Error('Object has been destroyed')
      },
      send: vi.fn()
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(sendIfAlive(s, 'x', 1)).toBe(false)
      expect(s.send).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('says nothing was sent for no sender at all', () => {
    expect(sendIfAlive(null, 'x', 1)).toBe(false)
    expect(sendIfAlive(undefined, 'x', 1)).toBe(false)
  })
})
