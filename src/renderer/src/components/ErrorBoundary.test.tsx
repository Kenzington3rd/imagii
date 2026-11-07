import { describe, it, expect, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ErrorBoundary } from './ErrorBoundary'
import { startAutosave } from '../hooks/useAutosave'

/**
 * T-178 (2) addendum - the crash screen's promise is true or it is not made. "imagii saves it every few seconds" is what the screen says while autosave works; once a
 * write has failed (and none has worked since) it says what is true and what to do. The boundary is rendered with its error state set, as React would after a throw.
 */
function crashScreen(): string {
  const boundary = new ErrorBoundary({ children: null })
  boundary.state = { error: new Error('boom'), componentStack: null }
  return renderToStaticMarkup(boundary.render() as React.ReactElement).replace(/&#x27;/g, "'")
}

describe('ErrorBoundary - the crash screen and autosave (T-178 (2))', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
  })

  it('autosave not failing: the sentence it has always said', () => {
    expect(crashScreen()).toContain('Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on.')
  })

  it('an autosave failure episode open: the true sentence, and not "every few seconds"', () => {
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldWriteFailed: true })
    const html = crashScreen()
    expect(html).toContain("Your work is still open in its studios, but autosave couldn't save it recently. Reload to Home, then use Save project to keep a copy.")
    expect(html).not.toMatch(/every few seconds/)
  })

  it('the episode over (a success cleared the flag): the old sentence again', () => {
    const memory = { lastWriteTime: 0, lastHash: '', toldWriteFailed: true }
    stop = startAutosave(memory)
    memory.toldWriteFailed = false
    expect(crashScreen()).toMatch(/imagii saves it every few seconds/)
  })
})
