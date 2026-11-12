import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { RunningCancel } from './RunningCancel'
import { swallowRepeatClicks } from '../lib/repeatPress'

// T-194 (3): a press arms the window's repeat swallow, which needs a `window`; this suite renders to strings in node, so the arming is recorded instead.
vi.mock('../lib/repeatPress', () => ({ swallowRepeatClicks: vi.fn() }))

/**
 * T-136 (7) - the Cancel of a running job is one component. Eleven places hand-wrote it and two had drifted off the pattern (the audio export's was
 * not a `btn-ghost`, had no danger ink and no title; the Clip Kit's was a hand-rolled bordered box with no title). What the person sees and what a
 * pointer resting on it reads are pinned here, once.
 */
describe('RunningCancel', () => {
  it('is a ghost button with danger ink, the word Cancel, and the job it stops as its title', () => {
    const html = renderToStaticMarkup(<RunningCancel title="Cancel GIF export" onClick={() => undefined} />)
    expect(html).toMatch(/^<button type="button" class="btn-ghost px-2 py-1\.5 text-xs text-danger hover:text-danger-soft" title="Cancel GIF export">Cancel<\/button>$/)
  })

  it('says the same word at every site, whatever the job (a screen reader and a voice-control user say "Cancel")', () => {
    for (const title of ['Cancel scan', 'Cancel picture-in-picture composite', 'Cancel download']) {
      expect(renderToStaticMarkup(<RunningCancel title={title} onClick={() => undefined} />)).toMatch(/>Cancel<\/button>$/)
    }
  })

  it('hands the press to the caller', () => {
    const onClick = vi.fn()
    const button = RunningCancel({ title: 'Cancel reframe', onClick }) as ReactElement<{ onClick: () => void }>
    button.props.onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

/**
 * T-194 (3) - a running job's Cancel takes its own row away when the job ends, and what sat below moves up under the pointer: a double-click on the Export's
 * Cancel put the second press on the Watermark position select. A press arms the window's repeat swallow (T-168 (6)) and THEN hands the press on, so the
 * swallow is already in force when `onClick` runs (its state change is what moves the row).
 */
describe('RunningCancel swallows the repeat of its own press (T-194 (3))', () => {
  it('a press arms swallowRepeatClicks and then calls onClick, in that order, once each', () => {
    const calls: string[] = []
    vi.mocked(swallowRepeatClicks).mockImplementation(() => {
      calls.push('swallow')
    })
    const button = RunningCancel({ title: 'Cancel export', onClick: () => calls.push('onClick') }) as ReactElement<{ onClick: () => void }>
    button.props.onClick()
    expect(calls).toEqual(['swallow', 'onClick'])
    vi.mocked(swallowRepeatClicks).mockReset()
  })
})
