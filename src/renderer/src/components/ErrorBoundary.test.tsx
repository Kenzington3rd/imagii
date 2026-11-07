import { describe, it, expect, afterEach, vi } from 'vitest'
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

/**
 * T-179 (1) - the same promise, in the other state in which autosave writes nothing. Over the size limit autosave is paused (no write is attempted, and Save project
 * refuses the same project), so the screen says that and what to do, not "saves it every few seconds" and not "use Save project". Paused wins over failing.
 */
describe('ErrorBoundary - the crash screen while autosave is paused for size (T-179 (1))', () => {
  const PAUSED =
    'Your work is still open in its studios, but autosave is paused: the project is too large to keep. Reload to Home, then remove some of the large images on the canvas, or import smaller copies of them, and it will start again.'
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
  })

  it('the project is over the limit (autosave told it is paused): the paused sentence, and not the promise, and not Save project', () => {
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldTooLarge: true })
    const html = crashScreen()
    expect(html).toContain(PAUSED)
    expect(html).not.toMatch(/every few seconds/)
    expect(html, 'Save project refuses the same project').not.toMatch(/Save project/)
    expect(html).not.toMatch(/couldn't save it recently/)
  })

  it('both a failed write and the pause: the paused sentence wins (no write is attempted while paused)', () => {
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldTooLarge: true, toldWriteFailed: true })
    const html = crashScreen()
    expect(html).toContain(PAUSED)
    expect(html).not.toMatch(/Save project/)
  })

  it('control: the pause over (the flag cleared): the old sentence again', () => {
    const memory = { lastWriteTime: 0, lastHash: '', toldTooLarge: true }
    stop = startAutosave(memory)
    memory.toldTooLarge = false
    const html = crashScreen()
    expect(html).toMatch(/imagii saves it every few seconds/)
    expect(html).not.toMatch(/autosave is paused/)
  })

  it('control: a failed write alone (not paused) is still the T-178 sentence', () => {
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldWriteFailed: true })
    expect(crashScreen()).toContain("but autosave couldn't save it recently. Reload to Home, then use Save project to keep a copy.")
  })

  it('no autosave running: the paused flag of a memory nobody runs is not read', () => {
    const memory = { lastWriteTime: 0, lastHash: '', toldTooLarge: true }
    startAutosave(memory)()
    expect(crashScreen()).toMatch(/imagii saves it every few seconds/)
  })
})

/**
 * T-180 (1) - the toast surface lives in its own boundary, whose fallback is nothing (a toast that throws drops the toasts, not the app), and the crash screen's
 * autosave sentence is a component that follows autosave (a store read, so it re-renders when trouble begins after the throw).
 */
function crashed(props: { fallback?: React.ReactNode }): string {
  const boundary = new ErrorBoundary({ children: null, ...props })
  boundary.state = { error: new Error('boom'), componentStack: null }
  return renderToStaticMarkup(boundary.render() as React.ReactElement).replace(/&#x27;/g, "'")
}

describe('ErrorBoundary - the fallback prop (T-180 (1))', () => {
  it('fallback={null}: an error renders nothing at all', () => {
    expect(crashed({ fallback: null })).toBe('')
  })

  it('a given fallback is what an error renders, instead of the crash screen', () => {
    const html = crashed({ fallback: <p>toasts are off</p> })
    expect(html).toBe('<p>toasts are off</p>')
    expect(html).not.toMatch(/Something went wrong/)
  })

  it('control: no fallback prop is the crash screen, as it has always been', () => {
    const html = crashed({})
    expect(html).toMatch(/Something went wrong in this studio/)
    expect(html).toMatch(/role="alert"/)
    expect(html).toMatch(/Reload to Home/)
  })

  it('control: without an error, the children render whatever the fallback is', () => {
    const boundary = new ErrorBoundary({ children: <b>kids</b>, fallback: null })
    expect(renderToStaticMarkup(boundary.render() as React.ReactElement)).toBe('<b>kids</b>')
  })

  it('a null fallback still logs the error (componentDidCatch is the same in both cases)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const boundary = new ErrorBoundary({ children: null, fallback: null })
      boundary.setState = vi.fn()
      boundary.componentDidCatch(new Error('toast broke'), { componentStack: '\n at Toast' } as React.ErrorInfo)
      expect(error.mock.calls.map((c) => String(c[0]))).toContain('[ErrorBoundary] caught render error:')
    } finally {
      error.mockRestore()
    }
  })
})

describe('ErrorBoundary - the sentence is a live component (T-180 (1))', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
  })

  it('all three states come out of the component, in T-179 order: failing, paused, and failing + paused = paused', () => {
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldWriteFailed: true })
    expect(crashScreen()).toContain("autosave couldn't save it recently")
    stop()
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldTooLarge: true })
    expect(crashScreen()).toContain('autosave is paused: the project is too large to keep')
    stop()
    stop = startAutosave({ lastWriteTime: 0, lastHash: '', toldTooLarge: true, toldWriteFailed: true })
    const html = crashScreen()
    expect(html).toContain('autosave is paused')
    expect(html).not.toMatch(/couldn't save it recently/)
  })

  it('the sentence sits in the same paragraph as before (the class keeps the <p> and its styles)', () => {
    expect(crashScreen()).toMatch(/<p style="[^"]*font-size:14px[^"]*">Your work is still open in its studios/)
  })
})
