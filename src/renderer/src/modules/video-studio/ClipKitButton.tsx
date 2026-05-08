import { useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type { Clip, ExportJobSpec, PlatformId, WatermarkSpec } from '@shared/clip'
import { sanitizeFilename } from '@shared/filename'
import { ALL_PLATFORM_IDS } from './presets'
import { useVideoStore } from './store/videoStore'

interface ClipKitButtonProps {
  clip: Clip
}

/**
 * Phase 4D: one-click "Clip Kit" export. Bundles all 5 platform exports
 * + 3 thumbnail JPGs into a single named subfolder, ready to drag into a
 * posting tool. SRT bundling is deferred to a future round (would require
 * promoting srtPath out of CaptionsPanel local state into the persisted
 * project schema).
 *
 * Orchestration is renderer-side (multiple IPC calls), not a single
 * monolithic main-process call — this lets the UI report progress per
 * piece and lets the user cancel partway via the existing cancel paths.
 */
export function ClipKitButton({ clip }: ClipKitButtonProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string>('')

  if (!source) return null

  const clipDuration = Math.max(0.1, clip.endSec - clip.startSec)

  async function runKit(): Promise<void> {
    if (!source) return
    const parentDir = await window.api.video.pickOutputDir()
    if (!parentDir) return
    setRunning(true)
    try {
      setPhase('Creating folder…')
      const kitDir = await window.api.video.makeKitDir({
        parentDir,
        clipName: clip.name
      })

      // Tech-debt fix: per-file names get the same sanitizer as the
      // subfolder. Otherwise a clip named "Big W!! 🎉" produces filenames
      // ffmpeg can write but Windows Explorer renders awkwardly, and the
      // revealInFolder path has to match exactly.
      const safeName = sanitizeFilename(clip.name)

      // Build a 5-platform queue for this single clip.
      setPhase('Exporting 5 platform versions…')
      const queue: ExportJobSpec[] = ALL_PLATFORM_IDS.map((preset: PlatformId) => ({
        jobId: nanoid(10),
        sourcePath: source.filePath,
        outDir: kitDir,
        clip: { ...clip, selectedPresets: [preset] },
        preset,
        watermark: null as WatermarkSpec | null,
        outputFilename: `${safeName}_${preset}.mp4`
      }))
      await window.api.video.exportBatch(queue)

      // Three thumbnails at 25%, 50%, 75% of the clip duration. These run
      // sequentially — they're each ~200-500ms so the total is bounded
      // and the per-step progress message stays informative.
      setPhase('Extracting 3 thumbnail frames…')
      const thumbTimes = [0.25, 0.5, 0.75]
      const len = thumbTimes.length
      for (let i = 0; i < len; i++) {
        const t = thumbTimes[i] ?? 0.5
        const timeSec = clip.startSec + t * clipDuration
        const outPath = path.join(kitDir, `${safeName}_thumb_${i + 1}.jpg`)
        await window.api.video.extractFrame({
          sourcePath: source.filePath,
          timeSec,
          outputPath: outPath
        })
      }

      toast.success('Clip kit ready', { duration: 6000 })
      // Reveal the folder so the user can grab it for posting.
      const firstOutput = path.join(kitDir, `${safeName}_youtube.mp4`)
      void window.api.video.revealInFolder(firstOutput)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clip kit failed')
    } finally {
      setRunning(false)
      setPhase('')
    }
  }

  return (
    <button
      onClick={runKit}
      disabled={running}
      title="Export this clip for all 5 platforms + 3 thumbnails into one folder"
      className="text-xs px-2 py-1 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-50"
    >
      {running ? `📦 ${phase || 'Working…'}` : `📦 Clip Kit (${ALL_PLATFORM_IDS.length} + thumbs)`}
    </button>
  )
}
