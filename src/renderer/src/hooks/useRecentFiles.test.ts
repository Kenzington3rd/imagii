import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The hook is exercised without a DOM: React's hooks are replaced by pass-throughs so `remove` is the plain function the component would hold.
vi.mock('react', () => ({
  useState: (v: unknown) => [v, () => undefined],
  useEffect: () => undefined,
  useCallback: (fn: unknown) => fn
}))
const persisted: Array<[string, unknown]> = []
vi.mock('../lib/persistSetting', () => ({
  persistSetting: async (k: string, v: unknown) => {
    persisted.push([k, v])
  }
}))

import { useRecentFiles } from './useRecentFiles'

let read: () => Promise<unknown>
beforeEach(() => {
  persisted.length = 0
  read = async () => ['/a.mp4', '/b.mp4']
  vi.stubGlobal('window', { api: { settings: { get: () => read() } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('useRecentFiles.remove (T-150, T-151 fold)', () => {
  it('drops the path and says so', async () => {
    expect(await useRecentFiles('video').remove('/a.mp4')).toBe(true)
    expect(persisted).toEqual([['recentFiles.video', ['/b.mp4']]])
  })

  it('a path that is not in the list is false and writes nothing', async () => {
    expect(await useRecentFiles('video').remove('/zzz.mp4')).toBe(false)
    expect(persisted).toEqual([])
  })

  it('a refused settings read is false, not a throw: the importer\'s error toast still shows', async () => {
    read = async () => {
      throw new Error('settings unavailable')
    }
    await expect(useRecentFiles('video').remove('/a.mp4')).resolves.toBe(false)
    expect(persisted).toEqual([])
  })
})
