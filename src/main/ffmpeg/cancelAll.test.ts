import { describe, it, expect } from 'vitest'
import { cancelAllReframeJobs } from './reframe'
import { cancelAllGifJobs } from './gif'
import { cancelAllHighlightJobs } from './highlights'
import { cancelAllFrameJobs } from './frame'

// Round 16 B1/B2/B3/B4 regression: each module that spawns ffmpeg now
// exports a no-arg cancelAll* that the before-quit hook calls. Calling
// these with no in-flight children must be a quiet no-op (the kill loop
// just sees an empty map / null slot). This test locks that invariant in
// so a future refactor can't silently break the before-quit cleanup.
describe('round-16 cancel-all hooks are callable with no live children', () => {
  it('cancelAllReframeJobs is a no-op when nothing is in flight', () => {
    expect(() => cancelAllReframeJobs()).not.toThrow()
  })

  it('cancelAllGifJobs is a no-op when nothing is in flight', () => {
    expect(() => cancelAllGifJobs()).not.toThrow()
  })

  it('cancelAllHighlightJobs is a no-op when nothing is in flight', () => {
    expect(() => cancelAllHighlightJobs()).not.toThrow()
  })

  it('cancelAllFrameJobs is a no-op when nothing is in flight', () => {
    expect(() => cancelAllFrameJobs()).not.toThrow()
  })

  it('each cancelAll is idempotent (multiple calls don\'t throw)', () => {
    // Mirrors before-quit semantics: the hook can fire under stress and
    // multiple paths may call cancelAll back-to-back.
    expect(() => {
      cancelAllReframeJobs()
      cancelAllReframeJobs()
      cancelAllGifJobs()
      cancelAllGifJobs()
      cancelAllHighlightJobs()
      cancelAllHighlightJobs()
      cancelAllFrameJobs()
      cancelAllFrameJobs()
    }).not.toThrow()
  })
})
