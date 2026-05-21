import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Welcome } from './routes/Welcome'
import { Home } from './routes/Home'
import { Video } from './routes/Video'
import { Audio } from './routes/Audio'
import { Image } from './routes/Image'
import { Record } from './routes/Record'
import { References } from './routes/References'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Icon } from './components/Icon'
import { useAutosave } from './hooks/useAutosave'

type Status = { phase: 'loading' } | { phase: 'welcome' } | { phase: 'ready' }

export function App(): JSX.Element {
  const [status, setStatus] = useState<Status>({ phase: 'loading' })
  // B1 fix: actually wire the autosave hook. Round-3 introduced the hook but
  // no component called it, so AutosaveRestore had nothing to read on launch.
  // Gating on `ready` keeps the welcome screen out of the autosave stream.
  // The empty-project skip is handled main-side via isSafeToAutosave.
  useAutosave({ enabled: status.phase === 'ready' })

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
    // M7 fix: bare "Loading…" looked like the app hung. Pair the text with a
    // small spinning sparkle so the user knows something is happening.
    return (
      <div className="h-full flex items-center justify-center gap-2 text-ink-muted text-sm">
        <span className="inline-block" style={{ animation: 'imagii-spin 1.2s linear infinite' }}>
          <Icon name="sparkle" size={16} />
        </span>
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
        <Route path="/record" element={<Record />} />
        <Route path="/references" element={<References />} />
        {/* Back-compat: the References studio was originally routed at
            /ai-art before the module was repurposed. Redirect so any old
            deep link still resolves. */}
        <Route path="/ai-art" element={<Navigate to="/references" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
