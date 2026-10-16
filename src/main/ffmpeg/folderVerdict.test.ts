import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * T-126 (10) - the check of a remembered folder shares its stat and gives up waiting.
 *
 * `settings:get` stats a folder key on every read; five panels mount together and four read the same key. On a path that does not
 * answer (an unreachable UNC share, a NAS that is asleep) every stat parks one of libuv's four threads, and nothing else that needs
 * the pool - a 3 ms settings read, an `imagii-file:` fetch of the video - gets one until the OS gives up. The stat of one path is
 * therefore made once while it is in flight, and no caller waits more than the deadline for it.
 *
 * `node:fs/promises` is replaced so a stat can be held open, counted and released at will; the real filesystem cases live in
 * outputPath.test.ts (`isExistingFolder`) and settingsFolders.test.ts.
 */
const statCalls: string[] = []
const pending = new Map<string, Array<{ resolve: (v: { isDirectory: () => boolean }) => void; reject: (e: Error) => void }>>()
let hungPaths = new Set<string>()
let folders = new Set<string>()

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    stat: (p: string) => {
      statCalls.push(p)
      if (hungPaths.has(p)) {
        return new Promise((resolve, reject) => {
          const list = pending.get(p) ?? []
          list.push({ resolve, reject })
          pending.set(p, list)
        })
      }
      if (folders.has(p)) return Promise.resolve({ isDirectory: () => true })
      if (p.endsWith('.txt')) return Promise.resolve({ isDirectory: () => false })
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    }
  }
})

const { folderVerdict, isExistingFolder, FOLDER_CHECK_DEADLINE_MS } = await import('./outputPath')

beforeEach(() => {
  statCalls.length = 0
  pending.clear()
  hungPaths = new Set()
  folders = new Set(['/videos/Clips'])
})
afterEach(async () => {
  vi.useRealTimers()
  // A hung stat is in flight until it settles (that is the point): let every one of this test's go, so the next test starts clean.
  for (const waiters of pending.values()) for (const w of waiters) w.resolve({ isDirectory: () => false })
  await new Promise((resolve) => setImmediate(resolve))
})

describe('folderVerdict', () => {
  it('says what a stat found: a folder, a file or a missing path is a definite answer', async () => {
    expect(await folderVerdict('/videos/Clips')).toBe('folder')
    expect(await folderVerdict('/videos/notes.txt')).toBe('not-a-folder')
    expect(await folderVerdict('/videos/gone')).toBe('not-a-folder')
  })

  it('a value that is not a path at all is not a folder, without a stat', async () => {
    for (const v of [undefined, null, 42, '', {}]) expect(await folderVerdict(v)).toBe('not-a-folder')
    expect(statCalls).toEqual([])
  })

  it('concurrent reads of one path are ONE stat with many awaiters', async () => {
    const answers = await Promise.all(Array.from({ length: 6 }, () => folderVerdict('/videos/Clips')))
    expect(answers).toEqual(['folder', 'folder', 'folder', 'folder', 'folder', 'folder'])
    expect(statCalls, 'six readers, one stat').toEqual(['/videos/Clips'])
  })

  it('different paths are different stats, and a path read after the first settled is a new stat (nothing is cached)', async () => {
    await Promise.all([folderVerdict('/videos/Clips'), folderVerdict('/videos/gone')])
    expect(statCalls.sort()).toEqual(['/videos/Clips', '/videos/gone'])
    await folderVerdict('/videos/Clips')
    expect(statCalls.filter((p) => p === '/videos/Clips'), 'a folder deleted since the last read is seen').toHaveLength(2)
  })

  it('a stat that never answers is "unknown" at the deadline, and later readers join it instead of parking another thread', async () => {
    vi.useFakeTimers()
    hungPaths.add('//nas/share/Exports')
    const first = folderVerdict('//nas/share/Exports')
    const second = folderVerdict('//nas/share/Exports')
    let settled = false
    void Promise.all([first, second]).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS - 1)
    expect(settled, 'still waiting just inside the deadline').toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await first).toBe('unknown')
    expect(await second).toBe('unknown')
    // The stat is still in flight (it cannot be cancelled); a third reader joins it.
    const third = folderVerdict('//nas/share/Exports')
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await third).toBe('unknown')
    expect(statCalls, 'three readers over the hang, one stat').toEqual(['//nas/share/Exports'])
  })

  it('when the hung stat finally answers, the path is free to be asked again', async () => {
    vi.useFakeTimers()
    hungPaths.add('//nas/share/Exports')
    const v = folderVerdict('//nas/share/Exports')
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await v).toBe('unknown')
    for (const waiter of pending.get('//nas/share/Exports') ?? []) waiter.resolve({ isDirectory: () => true })
    await vi.advanceTimersByTimeAsync(0)
    hungPaths.clear()
    folders.add('//nas/share/Exports')
    expect(await folderVerdict('//nas/share/Exports')).toBe('folder')
    expect(statCalls, 'a second stat once the first had settled').toHaveLength(2)
  })

  it('a stat that answers inside the deadline is not "unknown"', async () => {
    vi.useFakeTimers()
    hungPaths.add('//nas/share/Slow')
    const v = folderVerdict('//nas/share/Slow')
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS / 2)
    for (const waiter of pending.get('//nas/share/Slow') ?? []) waiter.resolve({ isDirectory: () => true })
    await vi.advanceTimersByTimeAsync(0)
    expect(await v).toBe('folder')
  })

  it('isExistingFolder is true only for a verified folder: a hung or missing one is not one', async () => {
    expect(await isExistingFolder('/videos/Clips')).toBe(true)
    expect(await isExistingFolder('/videos/gone')).toBe(false)
    vi.useFakeTimers()
    hungPaths.add('//nas/share/Hung')
    const hung = isExistingFolder('//nas/share/Hung')
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEADLINE_MS + 1)
    expect(await hung, 'the chooser does not open on a path nobody could confirm').toBe(false)
  })
})
