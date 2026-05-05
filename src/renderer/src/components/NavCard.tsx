import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface NavCardProps {
  to: string
  title: string
  description: string
  icon: ReactNode
  accent?: string
}

export function NavCard({ to, title, description, icon, accent }: NavCardProps): JSX.Element {
  return (
    <Link
      to={to}
      className="card p-6 flex flex-col gap-3 transition-all hover:bg-bg-hover hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <div
        className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
        style={{ background: accent ?? 'rgba(167, 139, 250, 0.15)' }}
      >
        {icon}
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-1">{title}</h2>
        <p className="text-sm text-ink-muted leading-relaxed">{description}</p>
      </div>
    </Link>
  )
}
