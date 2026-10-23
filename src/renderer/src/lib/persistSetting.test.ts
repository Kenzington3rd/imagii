import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * T-128 (4), T-110 (x) - `persistSetting` is how a screen remembers a preference without letting the remembering break what the person
 * pressed. Over a stubbed preload bridge and a recorded toast surface (the stores and helpers are plain, so no DOM is needed).
 */
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) })
}))

const { persistSetting } = await import('./persistSetting')
const { ERROR_TOAST_MS } = await import('@shared/userFacingError')

let setImpl: (key: string, value: unknown) => Promise<void>
const calls: Array<[string, unknown]> = []

beforeEach(() => {
  calls.length = 0
  toastError.mockReset()
  setImpl = async () => undefined
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.stubGlobal('window', {
    api: {
      settings: {
        set: (key: string, value: unknown) => {
          calls.push([key, value])
          return setImpl(key, value)
        }
      }
    }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('persistSetting', () => {
  it('writes the key and the value it was given, and says nothing when the write works', async () => {
    await persistSetting('welcomeSeen', true)
    await persistSetting('export.lastOutputDir', 'C:/clips')
    expect(calls).toEqual([
      ['welcomeSeen', true],
      ['export.lastOutputDir', 'C:/clips']
    ])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a value of undefined is passed through (it deletes the key in main)', async () => {
    await persistSetting('streamerHandle', undefined)
    expect(calls).toEqual([['streamerHandle', undefined]])
  })

  it('a write that rejects does NOT reject: the person gets one plain sentence and the caller carries on', async () => {
    setImpl = () => Promise.reject(new Error("Error invoking remote method 'settings:set': Error: config write refused"))
    await expect(persistSetting('welcomeSeen', true)).resolves.toBeUndefined()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith("Couldn't save your settings.", { duration: ERROR_TOAST_MS })
  })

  it('a known cause is said too, through the same helper every failure uses', async () => {
    setImpl = () => Promise.reject(new Error("Error invoking remote method 'settings:set': Error: ENOSPC: no space left on device, write"))
    await persistSetting('record.convertToMp4', false)
    expect(toastError).toHaveBeenCalledWith("Couldn't save your settings. Your disk is full. Free up some space and try again.", { duration: ERROR_TOAST_MS })
  })

  it('a bridge that throws before it returns a promise is the same: no rejection, one sentence', async () => {
    setImpl = () => {
      throw new Error('bridge not ready')
    }
    await expect(persistSetting('welcomeSeen', true)).resolves.toBeUndefined()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('the raw error goes to the console, never to the toast', async () => {
    setImpl = () => Promise.reject(new Error('config write refused'))
    await persistSetting('welcomeSeen', true)
    expect(String(toastError.mock.calls[0]?.[0])).not.toMatch(/refused|settings:set|invoking/i)
    expect(console.error).toHaveBeenCalled()
  })
})
