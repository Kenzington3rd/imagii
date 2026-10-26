import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { RunningCancel } from './RunningCancel'

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
