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

// T-193 (1): a record carries its press. A press refused or failed while ANOTHER press's import is still on its way must not clear that press's record (the sweep's finding:
// a Recent entry or a drop refused during Audio's extraction dropped Choose file…'s record, and Play never took the focus when the extraction landed).
describe('createSwapFocus - a record carries its press (T-193 (1))', () => {
  const BODY = { tag: 'body' }

  it('a press that held focus returns a token; a press that held none returns null and records nothing', () => {
    const f = createSwapFocus<'a'>()
    const token = f.record('a', true)
    expect(token).not.toBeNull()
    expect(f.pending()).toBe('a')
    const g = createSwapFocus<'a'>()
    expect(g.record('a', false)).toBeNull()
    expect(g.pending()).toBeNull()
    expect(g.take('a', BODY, BODY)).toBe(false)
  })

  it('every focused press gets its own token', () => {
    const f = createSwapFocus<'a'>()
    const first = f.record('a', true)
    const second = f.record('a', true)
    expect(second).not.toEqual(first)
  })

  it('a token\'s drop drops the record that press made', () => {
    const f = createSwapFocus<'a'>()
    const token = f.record('a', true)
    f.drop('a', token)
    expect(f.pending()).toBeNull()
    expect(f.take('a', BODY, BODY)).toBe(false)
  })

  it('a token\'s drop leaves another press\'s record alone (the older press ends without a swap; the newer one is still on its way)', () => {
    const f = createSwapFocus<'a'>()
    const older = f.record('a', true)
    f.record('a', true)
    f.drop('a', older)
    expect(f.pending(), 'the newer press\'s record survived the older press ending').toBe('a')
    expect(f.take('a', BODY, BODY)).toBe(true)
    // The other way round: the newer press ending drops its own record.
    const g = createSwapFocus<'a'>()
    g.record('a', true)
    const last = g.record('a', true)
    g.drop('a', last)
    expect(g.pending()).toBeNull()
  })

  it('a press that held no focus (a null token) drops nothing: the record held belongs to another press', () => {
    const f = createSwapFocus<'a'>()
    f.record('a', true)
    const unfocused = f.record('a', false)
    expect(unfocused).toBeNull()
    // ...and its own record was cleared by that press (a newer press of the target that proceeds without focus must not have its swap move focus), so hold a fresh one.
    f.record('a', true)
    f.drop('a', unfocused)
    expect(f.pending(), 'a null token dropped a record').toBe('a')
  })

  it('a spent token drops nothing (the swap already happened)', () => {
    const f = createSwapFocus<'a'>()
    const token = f.record('a', true)
    expect(f.take('a', BODY, BODY)).toBe(true)
    const later = f.record('a', true)
    f.drop('a', token)
    expect(f.pending(), 'the spent press\'s token cleared a later press\'s record').toBe('a')
    expect(later).not.toEqual(token)
  })

  it('a token is the press\'s claim on its own target: another target\'s record is not dropped by it', () => {
    const f = createSwapFocus<'audio' | 'video'>()
    const audio = f.record('audio', true)
    f.drop('video', audio)
    expect(f.pending()).toBe('audio')
  })

  it('the target-wide drop still drops any press\'s record (the studios\' unmount cleanups, the waveform\'s playback error); another target\'s leaves it', () => {
    const f = createSwapFocus<'audio' | 'video'>()
    f.record('audio', true)
    f.drop('video')
    expect(f.pending()).toBe('audio')
    f.drop('audio')
    expect(f.pending()).toBeNull()
    f.record('video', true)
    f.drop()
    expect(f.pending()).toBeNull()
  })

  it('a press without focus still clears the same target\'s held record (it proceeds, so its swap must not move focus)', () => {
    const f = createSwapFocus<'a'>()
    f.record('a', true)
    expect(f.record('a', false)).toBeNull()
    expect(f.pending()).toBeNull()
  })
})
