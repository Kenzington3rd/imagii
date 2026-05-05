import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AgeGate } from './routes/AgeGate'
import { Welcome } from './routes/Welcome'
import { Home } from './routes/Home'
import { Video } from './routes/Video'
import { Audio } from './routes/Audio'
import { Image } from './routes/Image'
import { AiArt } from './routes/AiArt'

type Status =
  | { phase: 'loading' }
  | { phase: 'ageGate' }
  | { phase: 'welcome' }
  | { phase: 'ready' }

export function App(): JSX.Element {
  const [status, setStatus] = useState<Status>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.settings.get<boolean>('ageVerified'),
      window.api.settings.get<boolean>('welcomeSeen')
    ]).then(([ageOk, welcomeSeen]) => {
      if (cancelled) return
      if (!ageOk) setStatus({ phase: 'ageGate' })
      else if (!welcomeSeen) setStatus({ phase: 'welcome' })
      else setStatus({ phase: 'ready' })
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

  if (status.phase === 'ageGate') {
    return (
      <AgeGate
        onVerified={async () => {
          const seen = await window.api.settings.get<boolean>('welcomeSeen')
          setStatus({ phase: seen ? 'ready' : 'welcome' })
        }}
      />
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
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<Home />} />
      <Route path="/video" element={<Video />} />
      <Route path="/audio" element={<Audio />} />
      <Route path="/image" element={<Image />} />
      <Route path="/ai-art" element={<AiArt />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  )
}
