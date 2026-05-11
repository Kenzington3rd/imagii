import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Welcome } from './routes/Welcome'
import { Home } from './routes/Home'
import { Video } from './routes/Video'
import { Audio } from './routes/Audio'
import { Image } from './routes/Image'
import { References } from './routes/References'
import { ErrorBoundary } from './components/ErrorBoundary'

type Status = { phase: 'loading' } | { phase: 'welcome' } | { phase: 'ready' }

export function App(): JSX.Element {
  const [status, setStatus] = useState<Status>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.api.settings.get<boolean>('welcomeSeen').then((welcomeSeen) => {
      if (cancelled) return
      setStatus({ phase: welcomeSeen ? 'ready' : 'welcome' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (status.phase === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-ink-muted text-sm">
        Loading…
      </div>
    )
  }

  if (status.phase === 'welcome') {
    return (
      <Welcome
        onContinue={async () => {
          await window.api.settings.set('welcomeSeen', true)
          setStatus({ phase: 'ready' })
        }}
      />
    )
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/video" element={<Video />} />
        <Route path="/audio" element={<Audio />} />
        <Route path="/image" element={<Image />} />
        <Route path="/ai-art" element={<References />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
