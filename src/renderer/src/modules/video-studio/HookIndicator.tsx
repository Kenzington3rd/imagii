import { useEffect, useRef, useState } from 'react'
import { HOOK_DEBOUNCE_MS, hookAsk, scoreHookQuality, type HookScore } from '@shared/highlights'
import { countOf } from '@shared/plural'
import { Icon } from '../../components/Icon'

/**
 * Phase 4C: badge that displays the "first 3 seconds" hook quality for a
 * given clip range. Lazy-loads via window.api.video.analyzeClipHook when
 * the start or window changes - on the EXACT numbers, once they have been
 * still for `HOOK_DEBOUNCE_MS` (T-115). A drag of the start handle or the
 * speed slider changes them continuously; each change cancels the pending
 * ask, so the badge asks once, after the drag, and describes the clip as it
 * is trimmed. A badge's FIRST look at its clip is immediate: nothing is
 * moving yet, and selecting a clip should not wait a quarter second more
 * for its badge than it did before the debounce.
 *
 * Shows three states:
 *   - Loading (spinner-y dot)
 *   - Loaded with tier (green/yellow/red badge with tooltip explanation)
 *   - Failed (silent — analysis is advisory, not gating)
 */

interface HookIndicatorProps {
  sourcePath: string
  startSec: number
  /** SOURCE seconds to listen to (T-112: `hookWindow(clip).sourceSec` — three seconds of
   *  the clip's OUTPUT, so 3 x its speed). */
  durationSec?: number
  /** What that window is as the viewer sees it, for the words ("the first 3 seconds").
   *  Defaults to `durationSec`, which is right at 1x. */
  outputSec?: number
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
  const outputSec = props.outputSec ?? durationSec
  const seen = countOf(Math.round(outputSec * 10) / 10, 'second')
  const [score, setScore] = useState<HookScore | null>(null)
  const [loading, setLoading] = useState(false)
  // Has this badge asked yet? Its first ask goes out at once; only a CHANGE waits for stillness.
  const asked = useRef(false)
  useEffect(() => {
    // A start or window main would refuse asks for nothing, and shows nothing.
    const ask = hookAsk(startSec, durationSec)
    if (ask === null) {
      setScore(null)
      setLoading(false)
      return
    }
    let cancelled = false
    // T-114: the previous score stays up while the next is worked out. Clearing it flashed the badge
    // out for a spinner on every re-analysis; only a badge with nothing to show yet spins. (A
    // different clip or video is a different badge - ClipList keys it - so a stale score never
    // belongs to another clip.)
    setLoading(true)
    // T-115: the ask waits for the numbers to stop moving. The effect runs on every change of the
    // exact start and window (T-113/T-114 keyed it on whole seconds to avoid a respawn per
    // mousemove, which left the badge up to half a second off for good); the cleanup cancels the
    // timer, so a drag asks once, when it is over, and the answer is for the window the clip has.
    // The badge's first ask (a new clip selected, a studio re-entered) has nothing moving to wait out.
    const wait = asked.current ? HOOK_DEBOUNCE_MS : 0
    asked.current = true
    const timer = setTimeout(() => {
      void window.api.video
        .analyzeClipHook({ sourcePath, ...ask })
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
    }, wait)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sourcePath, startSec, durationSec])

  if (loading && score === null) {
    return (
      <span
        className="text-xs text-ink-dim font-mono inline-flex items-center gap-1.5"
        title={`Analyzing the first ${seen}…`}
      >
        <Icon name="spinner" size={12} className="animate-spin" /> Hook…
      </span>
    )
  }
  if (!score) return null
  return (
    <span
      className={`text-xs font-mono px-1.5 py-0.5 rounded border ${TIER_COLOR[score.tier]}`}
      title={`${score.reasons.join('; ')}. Based on how loud the first ${seen} are, not what's on screen`}
    >
      {TIER_LABEL[score.tier]}
    </span>
  )
}
