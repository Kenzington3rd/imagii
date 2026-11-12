import { Component, useSyncExternalStore, type ReactNode, type ErrorInfo } from 'react'
import { autosaveTrouble, subscribeAutosaveTrouble } from '../hooks/useAutosave'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * What an error renders instead of the crash screen (T-180 (1)); `null` renders nothing. Left out, the error renders the crash screen. App's toast surface is the one
   * user: a toast that throws while rendering drops the toasts, not the app (an unmounted App stops autosave).
   */
  fallback?: ReactNode
  /**
   * T-181 (1): when this changes while the crash screen is up, the screen is let go and the children render again. App passes the router's location object (a new one per
   * navigation, a push to the same path included; the same one otherwise), so a navigation that happens from the crash screen (a toast's "Edit in Video Studio", Clean audio's
   * "Open Audio Studio") leaves it. Left out, the error stays until "Reload to Home".
   */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

/**
 * The crash screen's autosave sentence (T-178 (2), T-179 (1), T-180 (1)): the promise is only true while autosave is writing; while it is paused for size, or after a write has
 * failed (and none has worked since), it says what is true. A component, not a call in render: trouble can begin AFTER the throw (the debounced write of the edit just before
 * it, refused), and a boundary in its fallback state has nothing else to re-render it. The third argument is the server snapshot (the unit test renders with react-dom/server).
 */
function AutosaveCrashLine(): JSX.Element {
  const trouble = useSyncExternalStore(subscribeAutosaveTrouble, autosaveTrouble, autosaveTrouble)
  return (
    <>
      {trouble === 'paused'
        ? 'Your work is still open in its studios, but autosave is paused: the project is too large to keep. Reload to Home, then remove some of the large images on the canvas, or import smaller copies of them, and it will start again.'
        : trouble === 'failing'
          ? "Your work is still open in its studios, but autosave couldn't save it recently. Reload to Home, then use Save project to keep a copy."
          : 'Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on.'}
    </>
  )
}

/**
 * Bug-fix (audit round 5): without an error boundary, any uncaught render
 * error in a studio component crashes the entire app to a white screen
 * with no recovery path. The user has to force-quit imagii.
 *
 * This boundary catches the error, says plainly that the work is safe, and
 * offers a "Reload to Home" recovery action that resets routing back to the
 * home screen without losing in-process autosave state. The thrown message
 * and React's component stack sit behind a collapsed "Details" disclosure
 * (T-84) — and in the console, via componentDidCatch.
 *
 * Class component is the only way to do this in React — there's no hook
 * equivalent. Keep the implementation small + dependency-free; the
 * fallback UI is rendered without Tailwind classes that depend on
 * shared layout context, in case the error came from layout itself.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the dev console so the user can copy/paste for debugging.
    // Power-of-Ten rule 5: surface invariant failures visibly.
    console.error('[ErrorBoundary] caught render error:', error)
    console.error('[ErrorBoundary] component stack:', info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    // T-181 (1). All three, each for a reason: an error held now (nothing to clear otherwise); an error held BEFORE this update (one caught in the very update that changed
    // the key - a navigation onto a route that throws - is not reset, so it is caught once and the screen shows, with no retry that would throw again); the key changed.
    if (this.state.error !== null && prevState.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null })
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    const error = this.state.error
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div
        role="alert"
        style={{
          height: '100%',
          padding: '32px',
          color: '#ece4e2',
          backgroundColor: '#120c0c',
          fontFamily: 'system-ui, sans-serif',
          overflowY: 'auto'
        }}
      >
        {/* T-190 (5): the two <pre>s below are inline `userSelect: 'text'` (this screen avoids Tailwind, see above): the global `body { user-select: none }` would
            otherwise leave the one message a person would paste into a search or a report uncopyable. */}
        {/* T-84: this screen used to say "imagii hit a render error" and ask
            the user to "copy the message below and report it" — to a channel a
            local-first app does not have. It now says what happened, what is
            safe, and where it is; the technical text is one click away. T-125 (21): "where it is" was the Home screen, "waiting on"
            it, which was never true: Reload to Home changes the hash and nothing else, so no store is rebuilt, the restore banner
            (which is for a launch, and for a render process that died) is rightly not shown, and the work is still open in
            the studio it was in. */}
        <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
          Something went wrong in this studio
        </h1>
        <p style={{ fontSize: '14px', color: '#a59a97', marginBottom: '16px' }}>
          <AutosaveCrashLine />
        </p>
        <details style={{ marginBottom: '16px' }}>
          <summary style={{ fontSize: '12px', color: '#a59a97', cursor: 'pointer' }}>
            Details
          </summary>
          <pre
            style={{
              fontSize: '12px',
              padding: '12px',
              backgroundColor: '#1c1313',
              border: '1px solid #352a2a',
              borderRadius: '6px',
              color: '#f87171',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
              marginTop: '8px',
              marginBottom: '8px'
            }}
          >
            {message}
          </pre>
          {this.state.componentStack ? (
            <pre
              style={{
                fontSize: '11px',
                padding: '12px',
                backgroundColor: '#1c1313',
                border: '1px solid #352a2a',
                borderRadius: '6px',
                color: '#a59a97',
                whiteSpace: 'pre-wrap',
                userSelect: 'text'
              }}
            >
              {this.state.componentStack}
            </pre>
          ) : null}
        </details>
        <button
          onClick={(): void => {
            this.setState({ error: null, componentStack: null })
            window.location.hash = '#/home'
          }}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#ff3131',
            color: '#120c0c',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Reload to Home
        </button>
      </div>
    )
  }
}
