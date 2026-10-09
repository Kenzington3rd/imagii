import { describe, it, expect } from 'vitest'
import { saveCard } from './saveCard'

/**
 * T-88 — the post-Stop card tells the truth per state.
 *
 * Three states exist: converting to MP4 (cancellable, reports progress),
 * saving a WebM (a plain copy: not cancellable, no progress to show), and a
 * discard in flight (the kill has been asked for and the convert has not
 * rejected yet). The old card was one sentence — "converting and writing to
 * disk…" — for all of them.
 */

describe('saveCard', () => {
  it('Convert to MP4 on: says it is converting, shows progress, and Discard works', () => {
    const card = saveCard(true, false)
    expect(card.status).toBe('Finishing up — converting to MP4…')
    expect(card.showProgress).toBe(true)
    expect(card.canDiscard).toBe(true)
    expect(card.note).toBeNull()
  })

  it('Convert to MP4 off: says "saving", never "converting", and has nothing to stop', () => {
    const card = saveCard(false, false)
    expect(card.status).toBe('Finishing up — saving to disk…')
    expect(card.status).not.toMatch(/convert/i)
    expect(card.showProgress).toBe(false)
    expect(card.canDiscard).toBe(false)
    // Off without a reason is a dead-looking button; the note is the reason.
    expect(card.note).toMatch(/nothing to stop/)
  })

  it('a discard in flight: says so, drops the bar, and cannot be clicked twice', () => {
    const card = saveCard(true, true)
    expect(card.status).toBe('Discarding the recording…')
    expect(card.showProgress).toBe(false)
    expect(card.canDiscard).toBe(false)
  })

  it('the old catch-all sentence is gone from every state', () => {
    for (const convert of [true, false]) {
      for (const discarding of [true, false]) {
        expect(saveCard(convert, discarding).status).not.toMatch(/converting and writing/)
      }
    }
  })

  it('Discard is offered in exactly one state', () => {
    const offered = [
      [true, false],
      [true, true],
      [false, false],
      [false, true]
    ].filter(([convert, discarding]) => saveCard(Boolean(convert), Boolean(discarding)).canDiscard)
    expect(offered).toEqual([[true, false]])
  })

  it('the status line never claims "converting" unless Convert to MP4 is on', () => {
    for (const discarding of [true, false]) {
      expect(saveCard(false, discarding).status).not.toMatch(/convert/i)
    }
  })
})
