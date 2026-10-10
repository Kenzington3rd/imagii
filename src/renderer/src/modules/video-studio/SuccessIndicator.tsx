import { evaluateSuccess, type JudgedClip, type PlatformInfo } from './presets'

interface SuccessIndicatorProps {
  platform: PlatformInfo
  /** The clip itself (T-97): its crop, its speed and its range are what the
   *  verdict is about, so the verdict reads them rather than being handed
   *  the source's size or the source's seconds. */
  clip: JudgedClip
  sourceWidth: number
  sourceHeight: number
}

const COLORS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-ok-strong',
  yellow: 'bg-ember',
  red: 'bg-danger-strong'
}

const TEXTS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-ok',
  yellow: 'text-warn',
  red: 'text-danger'
}

export function SuccessIndicator(props: SuccessIndicatorProps): JSX.Element {
  const { level, label, reasons } = evaluateSuccess(
    props.platform,
    props.clip,
    props.sourceWidth,
    props.sourceHeight
  )
  // T-83: the reasons are ON the card, under the label, for anything that is
  // not green. They used to live in a `title` — hover-only, so a red "Trim"
  // told the user something was wrong and made them hunt for what. A green
  // card's only reason is "Looks great", which the label already says.
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className={`inline-flex items-center gap-1.5 ${TEXTS[level]}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${COLORS[level]}`} aria-hidden="true" />
        {label}
      </span>
      {level === 'green' ? null : <span className="text-ink-muted">{reasons.join(' · ')}</span>}
    </div>
  )
}
