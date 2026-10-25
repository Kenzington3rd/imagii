import { describe, it, expect } from 'vitest'
import { SAVE_RUNNING_MESSAGE, micLostLine, saveCard } from './saveCard'

/**
 * T-88 — the post-Stop card tells the truth per state.
 *
 * Three states exist: converting to MP4 (cancellable, reports progress),
 * saving a WebM (a quick copy: no Discard offered, no progress to show), and a
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

/**
 * T-126 (2): the mic-loss record. The toast that announces it lasts 8 s; the line is what stays on the REC header, the saving
 * card and the saved toast. A take with no loss has no line at all.
 */
describe('micLostLine', () => {
  it('names the moment on the REC clock and what it cost', () => {
    expect(micLostLine(134_000)).toBe('Microphone stopped at 02:14 — no sound after that')
    expect(micLostLine(0)).toBe('Microphone stopped at 00:00 — no sound after that')
    expect(micLostLine(5_900)).toBe('Microphone stopped at 00:05 — no sound after that')
  })

  it('speaks in the same clock as the REC header, past an hour too', () => {
    expect(micLostLine(3_725_000)).toBe('Microphone stopped at 1:02:05 — no sound after that')
  })

  it('a take with no loss has no line', () => {
    expect(micLostLine(null)).toBeNull()
  })

  it('a negative elapsed (a clock that stepped back) reads as the start, never "-0:05"', () => {
    expect(micLostLine(-5_000)).toBe('Microphone stopped at 00:00 — no sound after that')
  })
})

/**
 * T-137 (2): the save is a run that outlives the screen, so Start meets it. The idle controls are not drawn over a save (a Record that comes back
 * mid-save draws the saving card), and this is the sentence for a Start that arrives anyway.
 */
describe('SAVE_RUNNING_MESSAGE', () => {
  it('is a finished sentence in the importers\' words, and says what to do', () => {
    expect(SAVE_RUNNING_MESSAGE).toBe('Still saving the last recording. Wait for it to finish.')
    expect(SAVE_RUNNING_MESSAGE).toMatch(/^Still [a-z]+ the last [a-z]+\. Wait for it to finish\.$/)
  })

  it('does not blame the person or promise a retry the app does not make', () => {
    expect(SAVE_RUNNING_MESSAGE).not.toMatch(/error|failed|try again|cannot|can't/i)
  })
})
