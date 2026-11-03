import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CaptionsProgress } from '@shared/captions'

/**
 * T-145 - the three progress channels have ONE subscriber that outlives the panels. The hook is an effect and nothing here renders a component, so React's
 * `useEffect` is run at once and its cleanup kept: what is under test is what the effect subscribes to and what each event writes.
 */
const effects = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') effects.cleanups.push(cleanup)
  }
}))

import { useCaptionsProgress, useReframeRun, useScanRun } from './runs'
import { useVideoProgressFeeds } from './useVideoProgressFeeds'

interface Feeds {
  reframe: Array<(p: { jobId: string; phase: string; percent?: number }) => void>
  scan: Array<(p: { jobId: string; phase: string; percent: number }) => void>
  captions: Array<(p: CaptionsProgress) => void>
}
function install(): Feeds {
  const feeds: Feeds = { reframe: [], scan: [], captions: [] }
  const sub = <F,>(list: F[]) => (cb: F) => {
    list.push(cb)
    return () => void list.splice(list.indexOf(cb), 1)
  }
  vi.stubGlobal('window', {
    api: {
      video: { onReframeProgress: sub(feeds.reframe), onHighlightProgress: sub(feeds.scan) },
      captions: { onProgress: sub(feeds.captions) }
    }
  })
  return feeds
}

beforeEach(() => {
  effects.cleanups.length = 0
  useReframeRun.getState().end()
  useScanRun.getState().end()
  useCaptionsProgress.setState({ progress: null })
})

describe('useVideoProgressFeeds (T-145)', () => {
  it('subscribes each channel exactly once', () => {
    const feeds = install()
    useVideoProgressFeeds()
    expect([feeds.reframe.length, feeds.scan.length, feeds.captions.length]).toEqual([1, 1, 1])
  })

  it('a reframe event patches the held run\'s percent and phase; an event with no measurement says null', () => {
    const feeds = install()
    useVideoProgressFeeds()
    useReframeRun.getState().begin({ jobId: 'r1', name: 'Clip 1', percent: null, phase: 'starting' })
    feeds.reframe[0]?.({ jobId: 'r1', phase: 'rendering', percent: 42 })
    expect(useReframeRun.getState().run).toMatchObject({ name: 'Clip 1', percent: 42, phase: 'rendering' })
    feeds.reframe[0]?.({ jobId: 'r1', phase: 'analyzing' })
    expect(useReframeRun.getState().run).toMatchObject({ percent: null, phase: 'analyzing' })
  })

  it('a scan event patches the held scan\'s percent, and revives nothing once it ended', () => {
    const feeds = install()
    useVideoProgressFeeds()
    useScanRun.getState().begin({ name: 'vod.mp4', percent: 0 })
    feeds.scan[0]?.({ jobId: 's', phase: 'scanning', percent: 37 })
    expect(useScanRun.getState().run).toEqual({ name: 'vod.mp4', percent: 37 })
    useScanRun.getState().end()
    feeds.scan[0]?.({ jobId: 's', phase: 'done', percent: 100 })
    expect(useScanRun.getState().run).toBeNull()
  })

  it('a captions event is stored whether or not a captions run is held (T-89)', () => {
    const feeds = install()
    useVideoProgressFeeds()
    const p: CaptionsProgress = { jobId: 'b1', phase: 'burning-in', percent: 40 }
    feeds.captions[0]?.(p)
    expect(useCaptionsProgress.getState().progress).toEqual(p)
  })

  it('the cleanup removes all three listeners', () => {
    const feeds = install()
    useVideoProgressFeeds()
    for (const cleanup of effects.cleanups) cleanup()
    expect([feeds.reframe.length, feeds.scan.length, feeds.captions.length]).toEqual([0, 0, 0])
  })
})
