import { describe, it, expect } from 'vitest'
import { createRunStore } from './runStore'

// T-135 (1): a job's busy flag and handle lived in the panel's state, so leaving the studio unmounted them: the panel came back idle with its
// primary enabled, over a job main was still running, with no Cancel to press. A run lives in a module store instead, which outlives the screen.
// The behavior a panel relies on is in these cases; the E2E specs press the real buttons across a Home round trip.
describe('createRunStore - a run that outlives its screen (T-135 (1))', () => {
  it('starts idle', () => {
    const store = createRunStore<{ jobId: string }>()
    expect(store.getState().run).toBeNull()
  })

  it('begin claims the slot and says so; a second begin while one runs is refused and changes nothing', () => {
    const store = createRunStore<{ jobId: string }>()
    expect(store.getState().begin({ jobId: 'a' })).toBe(true)
    expect(store.getState().begin({ jobId: 'b' })).toBe(false)
    expect(store.getState().run).toEqual({ jobId: 'a' })
  })

  it('patch updates the run in place, and keeps the fields it was not given', () => {
    const store = createRunStore<{ jobId: string; percent: number | null }>()
    store.getState().begin({ jobId: 'a', percent: null })
    store.getState().patch({ percent: 40 })
    expect(store.getState().run).toEqual({ jobId: 'a', percent: 40 })
  })

  it('a patch that arrives after the run ended (a late progress event) revives nothing', () => {
    const store = createRunStore<{ jobId: string; percent: number | null }>()
    store.getState().begin({ jobId: 'a', percent: null })
    store.getState().end()
    store.getState().patch({ percent: 99 })
    expect(store.getState().run).toBeNull()
  })

  it('end gives the slot back, and ending an idle store is harmless', () => {
    const store = createRunStore<{ jobId: string }>()
    store.getState().end()
    store.getState().begin({ jobId: 'a' })
    store.getState().end()
    expect(store.getState().run).toBeNull()
    expect(store.getState().begin({ jobId: 'b' }), 'the next run can start').toBe(true)
  })

  it('every store is its own slot: one panel\'s run does not block another\'s', () => {
    const gif = createRunStore<{ jobId: string }>()
    const compile = createRunStore<{ jobId: string }>()
    gif.getState().begin({ jobId: 'g' })
    expect(compile.getState().run).toBeNull()
    expect(compile.getState().begin({ jobId: 'c' })).toBe(true)
  })

  it('a subscriber hears a run begin and end - what makes a remounted panel draw the running state', () => {
    const store = createRunStore<{ jobId: string }>()
    const seen: Array<string | null> = []
    const off = store.subscribe((s) => seen.push(s.run?.jobId ?? null))
    store.getState().begin({ jobId: 'a' })
    store.getState().end()
    off()
    expect(seen).toEqual(['a', null])
  })
})
