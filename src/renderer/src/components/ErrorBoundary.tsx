import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
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

  render(): ReactNode {
    if (!this.state.error) return this.props.children

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
        {/* T-84: this screen used to say "imagii hit a render error" and ask
            the user to "copy the message below and report it" — to a channel a
            local-first app does not have. It now says what happened, what is
            safe, and where it is; the technical text is one click away. */}
        <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
          Something went wrong in this studio
        </h1>
        <p style={{ fontSize: '14px', color: '#a59a97', marginBottom: '16px' }}>
          imagii saves your work every few seconds, so most of it should be waiting on the
          Home screen.
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
                whiteSpace: 'pre-wrap'
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
