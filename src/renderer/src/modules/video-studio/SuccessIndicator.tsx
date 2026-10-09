import { evaluateSuccess, type PlatformInfo } from './presets'

interface SuccessIndicatorProps {
  platform: PlatformInfo
  clipDuration: number
  sourceWidth: number
  sourceHeight: number
  cropAspect: number | null
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
    props.clipDuration,
    props.sourceWidth,
    props.sourceHeight,
    props.cropAspect
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
