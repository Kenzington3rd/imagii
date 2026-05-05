import { Link } from 'react-router-dom'

export function Video(): JSX.Element {
  return (
    <div className="h-full px-10 py-12">
      <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold mt-6 mb-2">Video Studio</h1>
      <p className="text-ink-muted">Coming soon — Sprint 1–2.</p>
    </div>
  )
}
