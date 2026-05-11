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
 * This boundary catches the error, shows what failed, and offers a
 * "Reload to Home" recovery action that resets routing back to the home
 * screen without losing in-process autosave state.
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
          color: '#e5e5ee',
          backgroundColor: '#0b0b0f',
          fontFamily: 'system-ui, sans-serif',
          overflowY: 'auto'
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
          imagii hit a render error
        </h1>
        <p style={{ fontSize: '14px', color: '#9595a5', marginBottom: '16px' }}>
          The studio you were in crashed. Your autosave is intact; reloading
          to the home screen should let you recover. If this keeps happening,
          copy the message below and report it.
        </p>
        <pre
          style={{
            fontSize: '12px',
            padding: '12px',
            backgroundColor: '#16161e',
            border: '1px solid #2a2a35',
            borderRadius: '6px',
            color: '#f87171',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: '16px'
          }}
        >
          {message}
        </pre>
        {this.state.componentStack ? (
          <details style={{ marginBottom: '16px' }}>
            <summary style={{ fontSize: '12px', color: '#9595a5', cursor: 'pointer' }}>
              Component stack
            </summary>
            <pre
              style={{
                fontSize: '11px',
                padding: '12px',
                backgroundColor: '#16161e',
                border: '1px solid #2a2a35',
                borderRadius: '6px',
                color: '#9595a5',
                whiteSpace: 'pre-wrap',
                marginTop: '8px'
              }}
            >
              {this.state.componentStack}
            </pre>
          </details>
        ) : null}
        <button
          onClick={(): void => {
            this.setState({ error: null, componentStack: null })
            window.location.hash = '#/home'
          }}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#a78bfa',
            color: '#0b0b0f',
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
