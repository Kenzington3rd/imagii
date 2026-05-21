import { DEFAULT_COLOR_GRADE, type ColorGrade } from '@shared/clip'
import { useVideoStore } from './store/videoStore'
import { PanelHeader } from '../../components/PanelHeader'

export function ColorGradePanel(): JSX.Element | null {
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const setClipColorGrade = useVideoStore((s) => s.setClipColorGrade)
  const setClipAutoZoom = useVideoStore((s) => s.setClipAutoZoom)
  const setClipHypeShake = useVideoStore((s) => s.setClipHypeShake)
  const clip = clips.find((c) => c.id === selectedClipId)
  if (!clip) return null
  const grade: ColorGrade = clip.colorGrade ?? DEFAULT_COLOR_GRADE

  function patch(p: Partial<ColorGrade>): void {
    if (!clip) return
    setClipColorGrade(clip.id, { ...grade, ...p })
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="palette">Color & motion</PanelHeader>
      <Slider
        label="Brightness"
        value={grade.brightness}
        min={-0.5}
        max={0.5}
        step={0.01}
        onChange={(v) => patch({ brightness: v })}
        formatValue={(v) => v.toFixed(2)}
      />
      <Slider
        label="Contrast"
        value={grade.contrast}
        min={0.5}
        max={1.5}
        step={0.01}
        onChange={(v) => patch({ contrast: v })}
        formatValue={(v) => v.toFixed(2)}
      />
      <Slider
        label="Saturation"
        value={grade.saturation}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => patch({ saturation: v })}
        formatValue={(v) => v.toFixed(2)}
      />
      <Slider
        label="Temperature"
        value={grade.temperature}
        min={-1}
        max={1}
        step={0.05}
        onChange={(v) => patch({ temperature: v })}
        formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`}
      />
      <button
        className="text-xs text-ink-dim hover:text-ink-base self-start"
        onClick={() => setClipColorGrade(clip.id, DEFAULT_COLOR_GRADE)}
      >
        Reset color
      </button>
      <div className="border-t border-ink-dim/30 pt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(clip.autoZoom)}
            onChange={(e) => setClipAutoZoom(clip.id, e.target.checked)}
          />
          <span>Auto-zoom (gentle pulse)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(clip.hypeShake)}
            onChange={(e) => setClipHypeShake(clip.id, e.target.checked)}
          />
          <span>Hype shake (subtle jitter)</span>
        </label>
        <p className="text-xs text-ink-dim">
          Both effects bake into the export — preview by exporting a short clip.
        </p>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  formatValue: (v: number) => string
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-ink-muted w-20">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        // M11 fix (round 15): the visible value span is a sibling — screen
        // readers wouldn't otherwise read it. aria-valuetext exposes the
        // formatted value; aria-label keeps the slider self-identifying when
        // the label wrap is stripped by some AT.
        aria-label={label}
        aria-valuetext={formatValue(value)}
      />
      <span className="font-mono w-12 text-right">{formatValue(value)}</span>
    </label>
  )
}
