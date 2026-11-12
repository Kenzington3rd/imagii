import { describe, it, expect } from 'vitest'
import { createSwapFocus } from './swapFocus'

// T-192 (3): the rule behind the importer / editor swaps. The e2e specs (audio, video-core, image) press the real controls and read where focus lands; this is the rule they
// depend on, with its edges: a press without focus records nothing, the flag is spent by the content it was recorded for and only that content, and it moves focus only
// while focus is on <body> or nowhere.
describe('createSwapFocus - a press that held focus hands it to the new content (T-192 (3))', () => {
  const BODY = { tag: 'body' }
  const OTHER = { tag: 'button' }

  it('a press that held focus is taken once, by its own target, while focus is on <body>', () => {
    const f = createSwapFocus<'a' | 'b'>()
    f.record('a', true)
    expect(f.take('a', BODY, BODY)).toBe(true)
    expect(f.take('a', BODY, BODY), 'spent: a second mount of the same content moves nothing').toBe(false)
  })

  it('focus on nowhere (null) counts as the page', () => {
    const f = createSwapFocus<'a'>()
    f.record('a', true)
    expect(f.take('a', null, BODY)).toBe(true)
  })

  it('a press without focus on its control records nothing (a mouse-less click, a drop)', () => {
    const f = createSwapFocus<'a'>()
    f.record('a', false)
    expect(f.pending()).toBeNull()
    expect(f.take('a', BODY, BODY)).toBe(false)
  })

  it('a press without focus clears the same target\'s flag (the earlier press is no longer the one that swaps)', () => {
    const f = createSwapFocus<'a' | 'b'>()
    f.record('a', true)
    f.record('a', false)
    expect(f.take('a', BODY, BODY)).toBe(false)
    f.record('a', true)
    f.record('b', false)
    expect(f.pending(), 'another target\'s unfocused press leaves it alone').toBe('a')
  })

  it('focus the person has put on another control is left where it is, and the flag is spent', () => {
    const f = createSwapFocus<'a'>()
    f.record('a', true)
    expect(f.take('a', OTHER, BODY)).toBe(false)
    expect(f.take('a', BODY, BODY), 'spent by the first ask').toBe(false)
  })

  it('content for another target neither takes the flag nor spends it', () => {
    const f = createSwapFocus<'audio' | 'video'>()
    f.record('audio', true)
    expect(f.take('video', BODY, BODY)).toBe(false)
    expect(f.pending()).toBe('audio')
    expect(f.take('audio', BODY, BODY)).toBe(true)
  })

  it('a newer press replaces the held flag (one at a time)', () => {
    const f = createSwapFocus<'audio' | 'video'>()
    f.record('audio', true)
    f.record('video', true)
    expect(f.take('audio', BODY, BODY)).toBe(false)
    expect(f.take('video', BODY, BODY)).toBe(true)
  })

  it('a failed press drops its own flag; with no target it drops whatever is held; another target\'s drop leaves it', () => {
    const f = createSwapFocus<'audio' | 'video'>()
    f.record('audio', true)
    f.drop('video')
    expect(f.pending()).toBe('audio')
    f.drop('audio')
    expect(f.take('audio', BODY, BODY)).toBe(false)
    f.record('video', true)
    f.drop()
    expect(f.pending()).toBeNull()
  })
})
