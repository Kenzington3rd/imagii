import { useEffect, useState } from 'react'

interface AgeGateProps {
  onVerified: () => void
}

type DeclineState = { phase: 'idle' } | { phase: 'declining'; secondsLeft: number }

export function AgeGate({ onVerified }: AgeGateProps): JSX.Element {
  const [decline, setDecline] = useState<DeclineState>({ phase: 'idle' })

  useEffect(() => {
    if (decline.phase !== 'declining') return
    if (decline.secondsLeft <= 0) {
      window.api.app.quit()
      return
    }
    const t = setTimeout(() => {
      setDecline({ phase: 'declining', secondsLeft: decline.secondsLeft - 1 })
    }, 1000)
    return () => clearTimeout(t)
  }, [decline])

  async function confirm(): Promise<void> {
    await window.api.settings.set('ageVerified', true)
    await window.api.settings.set('ageVerifiedAt', Date.now())
    onVerified()
  }

  function declineGate(): void {
    setDecline({ phase: 'declining', secondsLeft: 3 })
  }

  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="card max-w-md w-full p-8 shadow-2xl">
        <h1 className="text-3xl font-semibold mb-2">Welcome to imagii</h1>
        <p className="text-ink-muted text-sm mb-6">
          Some features in imagii — including AI art generation and reference image search — are
          intended for adult users.
        </p>
        <p className="text-ink-base mb-8">Please confirm you are 18 years of age or older.</p>

        {decline.phase === 'idle' ? (
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={confirm}>
              I am 18 or older
            </button>
            <button className="btn-ghost flex-1" onClick={declineGate}>
              I am under 18
            </button>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-ink-base mb-2">imagii is intended for adult users only.</p>
            <p className="text-ink-muted text-sm">
              Closing in {decline.secondsLeft} second{decline.secondsLeft === 1 ? '' : 's'}…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
