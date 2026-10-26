import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  VIDEO_OUTPUT_DIR_KEY,
  pickOutputDir,
  readRemembered,
  rememberOutputDir,
  resolveOutputDir,
  seedOutputDir,
  useOutputDirStore
} from './useVideoOutputDir'

/**
 * T-125 (10) - the GIF, Compile, Reframe and picture-in-picture buttons are ONE folder.
 *
 * Each panel held the folder in its own state, read once when it mounted, so a pick in one left the other three showing nothing
 * (the guide says they follow each other). The value is a module store now; these drive the plain functions the hook binds, over a
 * stubbed preload bridge (the stores are plain zustand, so no DOM is needed). What a button shows is `useOutputDirStore`'s `dir`, the
 * same value the four hooks subscribe to - so "every panel follows" is "the store changed".
 */
const SETTINGS = new Map<string, unknown>()
const chooserCalls: Array<string | undefined> = []
let chooserAnswer: string | null = null
let settingsRead: () => Promise<unknown>

beforeEach(() => {
  SETTINGS.clear()
  chooserCalls.length = 0
  chooserAnswer = null
  settingsRead = async () => undefined
  useOutputDirStore.setState({ dir: null })
  vi.stubGlobal('window', {
    api: {
      settings: {
        get: (key: string) => (key === VIDEO_OUTPUT_DIR_KEY ? settingsRead() : Promise.resolve(SETTINGS.get(key))),
        set: (key: string, value: unknown) => {
          SETTINGS.set(key, value)
          return Promise.resolve()
        }
      },
      video: {
        pickOutputDir: (start?: string) => {
          chooserCalls.push(start)
          return Promise.resolve(chooserAnswer)
        }
      }
    }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  useOutputDirStore.setState({ dir: null })
})

const shown = (): string | null => useOutputDirStore.getState().dir

describe('the four panels share one folder within the visit (T-125 (10))', () => {
  it('a pick in one panel is every panel\'s folder at once', async () => {
    chooserAnswer = '/home/streamer/Clips'
    const seen: Array<string | null> = []
    const unsubscribe = useOutputDirStore.subscribe((s) => seen.push(s.dir)) // what each of the four hooks does
    await pickOutputDir()
    expect(shown()).toBe('/home/streamer/Clips')
    expect(seen, 'every subscriber heard it').toEqual(['/home/streamer/Clips'])
    unsubscribe()
  })

  it('the chooser opens ON the current folder, and a canceled chooser changes nothing', async () => {
    chooserAnswer = '/home/streamer/Clips'
    await pickOutputDir()
    chooserAnswer = null
    await pickOutputDir()
    expect(chooserCalls).toEqual([undefined, '/home/streamer/Clips'])
    expect(shown()).toBe('/home/streamer/Clips')
  })

  it('a file written in a folder is remembered for the next visit AND shown by every panel now', () => {
    rememberOutputDir('/home/streamer/Exports')
    expect(SETTINGS.get(VIDEO_OUTPUT_DIR_KEY)).toBe('/home/streamer/Exports')
    expect(shown()).toBe('/home/streamer/Exports')
  })

  it('the chooser\'s answer when an action found no folder is kept for the other panels too', async () => {
    chooserAnswer = '/home/streamer/Fresh'
    await expect(resolveOutputDir()).resolves.toBe('/home/streamer/Fresh')
    expect(shown()).toBe('/home/streamer/Fresh')
  })
})

describe('the remembered folder seeds the buttons (T-124 (21), T-125 (10))', () => {
  it('main answers a folder that is there: every panel shows it', async () => {
    settingsRead = async () => '/home/streamer/Clips'
    await seedOutputDir()
    expect(shown()).toBe('/home/streamer/Clips')
  })

  it('main answers nothing for a folder that was deleted: no panel shows it, and the action opens the chooser', async () => {
    settingsRead = async () => undefined // what `settings:get` says for a folder that is gone
    await seedOutputDir()
    expect(shown()).toBeNull()
    chooserAnswer = '/home/streamer/Fresh'
    await expect(resolveOutputDir()).resolves.toBe('/home/streamer/Fresh')
    expect(chooserCalls, 'the chooser was asked, not skipped').toEqual([undefined])
  })

  it('a pick made before the read lands outranks it', async () => {
    settingsRead = async () => '/home/streamer/Old'
    chooserAnswer = '/home/streamer/Picked'
    const seeding = seedOutputDir()
    await pickOutputDir()
    await seeding
    expect(shown()).toBe('/home/streamer/Picked')
  })

  it('a remembered folder is used by the action with nothing chosen, and the chooser is not opened', async () => {
    settingsRead = async () => '/home/streamer/Clips'
    await expect(resolveOutputDir()).resolves.toBe('/home/streamer/Clips')
    expect(chooserCalls).toEqual([])
    expect(shown()).toBe('/home/streamer/Clips')
  })

  it.each([
    ['a relative path', 'exports\\..\\elsewhere'],
    ['a path that climbs out', '/home/streamer/../../etc'],
    ['a number', 42],
    ['nothing', undefined]
  ])('%s that came off disk is not a folder: ignored, as before', async (_label, stored) => {
    settingsRead = async () => stored
    await expect(readRemembered()).resolves.toBeNull()
    await seedOutputDir()
    expect(shown()).toBeNull()
  })

  it('a settings read that fails is no reason to stop: the chooser opens', async () => {
    settingsRead = () => Promise.reject(new Error('settings unavailable'))
    chooserAnswer = '/home/streamer/Fresh'
    await expect(resolveOutputDir()).resolves.toBe('/home/streamer/Fresh')
  })

  it('a canceled chooser with nothing remembered resolves nothing, and stores nothing', async () => {
    await expect(resolveOutputDir()).resolves.toBeNull()
    expect(shown()).toBeNull()
    expect(SETTINGS.has(VIDEO_OUTPUT_DIR_KEY)).toBe(false)
  })
})
