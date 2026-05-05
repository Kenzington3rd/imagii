import { evaluateSuccess, type PlatformInfo } from './presets'

interface SuccessIndicatorProps {
  platform: PlatformInfo
  clipDuration: number
  sourceWidth: number
  sourceHeight: number
  cropAspect: number | null
}

const COLORS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-400'
}

const TEXTS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-emerald-300',
  yellow: 'text-amber-300',
  red: 'text-rose-300'
}

export function SuccessIndicator(props: SuccessIndicatorProps): JSX.Element {
  const { level, reasons } = evaluateSuccess(
    props.platform,
    props.clipDuration,
    props.sourceWidth,
    props.sourceHeight,
    props.cropAspect
  )
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${TEXTS[level]}`}
      title={reasons.join(' · ')}
    >
      <span className={`w-2 h-2 rounded-full ${COLORS[level]}`} />
      {level === 'green' ? 'Great' : level === 'yellow' ? 'OK' : 'Trim'}
    </span>
  )
}
