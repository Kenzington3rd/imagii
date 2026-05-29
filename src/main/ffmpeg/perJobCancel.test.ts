import { describe, it, expect } from 'vitest'
import { cancelReframeJob } from './reframe'
import { cancelGifJob } from './gif'
import { cancelConcatJob } from './concat'
import { cancelActiveHighlightScan } from './highlights'

// Round 17 B1-B5 regression: each long-running ffmpeg sidecar now exports a
// per-job (or single-slot) cancel function so the renderer's panel-level
// Cancel button has something to call. None of these should throw when
// asked to cancel a non-existent job — that mirrors what happens when the
// user spams Cancel after the job has already finished.
describe('round-17 per-job cancel helpers', () => {
  describe('cancelReframeJob', () => {
    it('returns false for an unknown jobId without throwing', () => {
      expect(cancelReframeJob('does-not-exist')).toBe(false)
    })
    it('is idempotent for the same unknown id', () => {
      expect(cancelReframeJob('still-nothing')).toBe(false)
      expect(cancelReframeJob('still-nothing')).toBe(false)
    })
  })

  describe('cancelGifJob', () => {
    it('returns false for an unknown jobId without throwing', () => {
      expect(cancelGifJob('does-not-exist')).toBe(false)
    })
  })

  describe('cancelConcatJob (also serves PiP via the shared activeJobs map)', () => {
    it('returns false when nothing matches', () => {
      expect(cancelConcatJob('does-not-exist')).toBe(false)
    })
    it('walks the map without throwing even with sub-key style ids', () => {
      // The function matches both exact and `${jobId}:` prefixed children.
      // With an empty map both branches no-op cleanly.
      expect(cancelConcatJob('orphan')).toBe(false)
    })
  })

  describe('cancelActiveHighlightScan', () => {
    it('returns false when no scan is in flight', () => {
      expect(cancelActiveHighlightScan()).toBe(false)
    })
    it('is idempotent', () => {
      expect(cancelActiveHighlightScan()).toBe(false)
      expect(cancelActiveHighlightScan()).toBe(false)
    })
  })
})
