import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AgeGate } from './routes/AgeGate'
import { Home } from './routes/Home'
import { Video } from './routes/Video'
import { Audio } from './routes/Audio'
import { Image } from './routes/Image'
import { AiArt } from './routes/AiArt'

type AgeStatus = 'loading' | 'unverified' | 'verified'

export function App(): JSX.Element {
  const [ageStatus, setAgeStatus] = useState<AgeStatus>('loading')

  useEffect(() => {
    let cancelled = false
    window.api.settings.get<boolean>('ageVerified').then((verified) => {
      if (!cancelled) setAgeStatus(verified ? 'verified' : 'unverified')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (ageStatus === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-ink-muted text-sm">
        Loading…
      </div>
    )
  }

  if (ageStatus === 'unverified') {
    return <AgeGate onVerified={() => setAgeStatus('verified')} />
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
