import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProgressTrack } from './ProgressTrack'

/**
 * T-136 (7) - the progress bar of a job is one component (six panels drew it by hand). A bar is a MEASUREMENT or it is absent (STYLE_GUIDE, T-89):
 * a number draws a fill and an `aria-valuenow`; `null` draws the sliding segment and NO `aria-valuenow`, never an invented number. A stopped row
 * keeps its bar and loses the color that said "something broke" if the person's own Cancel stopped it (T-100).
 */
describe('ProgressTrack', () => {
  const html = (props: Parameters<typeof ProgressTrack>[0]): string => renderToStaticMarkup(<ProgressTrack {...props} />)

  it('is a progressbar named for its job, with bounds and the rounded value', () => {
    const out = html({ label: 'Downloading the caption model', percent: 41.6 })
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-label="Downloading the caption model"')
    expect(out).toContain('aria-valuemin="0"')
    expect(out).toContain('aria-valuemax="100"')
    expect(out).toContain('aria-valuenow="42"')
    expect(out).toContain('style="width:42%"')
    expect(out).not.toContain('progress-indeterminate')
  })

  it('a phase main cannot measure (null) slides and carries no value', () => {
    const out = html({ label: 'Transcribing…', percent: null })
    expect(out).toContain('progress-indeterminate')
    expect(out).not.toContain('aria-valuenow')
    expect(out).not.toContain('width:')
  })

  it('a measured 0 is a value (an empty bar), not an absent one', () => {
    const out = html({ label: 'Scanning', percent: 0 })
    expect(out).toContain('aria-valuenow="0"')
    expect(out).toContain('style="width:0%"')
    expect(out).not.toContain('progress-indeterminate')
  })

  it('keeps a value inside 0-100', () => {
    expect(html({ label: 'x', percent: 140 })).toContain('aria-valuenow="100"')
    expect(html({ label: 'x', percent: -3 })).toContain('aria-valuenow="0"')
  })

  it('colors the fill by what became of the job: accent while it runs, muted when canceled, red only for a fault', () => {
    expect(html({ label: 'x', percent: 50 })).toContain('class="h-full bg-accent"')
    expect(html({ label: 'x', percent: 50, tone: 'active' })).toContain('class="h-full bg-accent"')
    expect(html({ label: 'x', percent: 50, tone: 'canceled' })).toContain('class="h-full bg-ink-muted"')
    expect(html({ label: 'x', percent: 50, tone: 'failed' })).toContain('class="h-full bg-danger-strong"')
  })

  it('is flex-1 in a row unless the table gives it a width', () => {
    expect(html({ label: 'x', percent: 1 })).toContain('class="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden"')
    expect(html({ label: 'x', percent: 1, className: 'w-40' })).toContain('class="w-40 h-1.5 bg-bg-hover rounded-full overflow-hidden"')
  })
})
