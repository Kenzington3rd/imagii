import { Link } from 'react-router-dom'

export function AiArt(): JSX.Element {
  return (
    <div className="h-full px-10 py-12">
      <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold mt-6 mb-2">AI Art</h1>
      <p className="text-ink-muted">Coming soon — Sprint 7–9.</p>
    </div>
  )
}
