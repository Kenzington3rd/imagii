import { useEffect, useState } from 'react'
import { scoreHookQuality, type HookScore } from '@shared/highlights'
import { Icon } from '../../components/Icon'

/**
 * Phase 4C: badge that displays the "first 3 seconds" hook quality for a
 * given clip range. Lazy-loads via window.api.video.analyzeClipHook when
 * the props change; cached at the call-site by stable (sourcePath,
 * startSec, durationSec) tuple via React's effect dep array.
 *
 * Shows three states:
 *   - Loading (spinner-y dot)
 *   - Loaded with tier (green/yellow/red badge with tooltip explanation)
 *   - Failed (silent — analysis is advisory, not gating)
 */

interface HookIndicatorProps {
  sourcePath: string
  startSec: number
  durationSec?: number
}

const TIER_COLOR: Record<HookScore['tier'], string> = {
  high: 'bg-ok-strong/20 text-ok border-ok-strong/40',
  medium: 'bg-ember/20 text-warn border-ember/40',
  low: 'bg-danger-strong/20 text-danger border-danger-strong/40'
}

const TIER_LABEL: Record<HookScore['tier'], string> = {
  high: 'Strong hook',
  medium: 'OK hook',
  low: 'Weak hook'
}

export function HookIndicator(props: HookIndicatorProps): JSX.Element | null {
  const { sourcePath, startSec, durationSec = 3 } = props
  const [score, setScore] = useState<HookScore | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setScore(null)
    setLoading(true)
    void window.api.video
      .analyzeClipHook({ sourcePath, startSec, durationSec })
      .then((result) => {
        if (cancelled) return
        setScore(scoreHookQuality(result.audioEnergyDb))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // Hook analysis is advisory; failure should not block anything
        setScore(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourcePath, startSec, durationSec])

  if (loading) {
    return (
      <span
        className="text-xs text-ink-dim font-mono inline-flex items-center gap-1.5"
        title="Analyzing first 3 seconds…"
      >
        <Icon name="spinner" size={12} className="animate-spin" /> hook…
      </span>
    )
  }
  if (!score) return null
  return (
    <span
      className={`text-xs font-mono px-1.5 py-0.5 rounded border ${TIER_COLOR[score.tier]}`}
      title={`${score.reasons.join('; ')} — peak ${score.audioEnergyDb.toFixed(1)} LUFS in first ${durationSec}s`}
    >
      {TIER_LABEL[score.tier]}
    </span>
  )
}
