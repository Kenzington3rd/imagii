import { useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type { Clip, ExportJobSpec, PlatformId, WatermarkSpec } from '@shared/clip'
import { sanitizeFilename } from '@shared/filename'
import { ALL_PLATFORM_IDS } from './presets'
import { useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'

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
  const srtPath = useVideoStore((s) => s.srtPath)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string>('')

  if (!source) return null

  const clipDuration = Math.max(0.1, clip.endSec - clip.startSec)

  async function runKit(): Promise<void> {
    if (!source) return
    // INIT-E (round 15): seed the picker default with the previous Clip Kit
    // parent. The picker doesn't accept a default in our IPC today, but
    // saving the value on success means future iterations / a friendlier
    // "Use last folder" button can pull from settings.
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
      // subfolder. Otherwise a clip named with punctuation/symbols
      // produces filenames ffmpeg can write but Windows Explorer renders
      // awkwardly, and the revealInFolder path has to match exactly.
      const safeName = sanitizeFilename(clip.name)

      // Build a 5-platform queue for this single clip.
      setPhase('Exporting 5 platform versions…')
      // INIT-B (round 15): when the source is vertical (height > width), the
      // YouTube target should be a 1080×1920 Short instead of the default
      // 1920×1080 landscape — landscape on vertical material wastes 75% of
      // the frame. There's no separate "youtube-short" preset yet, so reuse
      // the reels preset's 9:16 geometry and just relabel the output file.
      const isVertical = source.probe.height > source.probe.width
      const queue: ExportJobSpec[] = ALL_PLATFORM_IDS.map((preset: PlatformId) => {
        const effectivePreset: PlatformId =
          preset === 'youtube' && isVertical ? 'reels' : preset
        const filenameSuffix =
          preset === 'youtube' && isVertical ? 'youtube_short' : preset
        return {
          jobId: nanoid(10),
          sourcePath: source.filePath,
          outDir: kitDir,
          clip: { ...clip, selectedPresets: [effectivePreset] },
          preset: effectivePreset,
          watermark: null as WatermarkSpec | null,
          outputFilename: `${safeName}_${filenameSuffix}.mp4`
        }
      })
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

      // Tech-debt fix: bundle the SRT when the project has a transcribed
      // one. Silent failure (file moved/deleted since transcription) so
      // the user still gets the rest of the kit.
      if (srtPath) {
        setPhase('Bundling captions…')
        const srtDest = path.join(kitDir, `${safeName}.srt`)
        const result = await window.api.captions.copySrtTo({
          srcPath: srtPath,
          destPath: srtDest
        })
        if (!result.ok) {
          toast(`SRT not bundled (${result.reason})`, {
            icon: <Icon name="warning" size={18} />,
            duration: 6000
          })
        }
      }

      toast.success('Clip kit ready', { duration: 6000 })
      // INIT-E (round 15): persist the parent on success.
      void window.api.settings.set('clipKit.lastOutputDir', parentDir)
      // Reveal the folder so the user can grab it for posting. Match the
      // filename the queue actually emitted for vertical sources.
      const youtubeFilename = isVertical ? `${safeName}_youtube_short.mp4` : `${safeName}_youtube.mp4`
      const firstOutput = path.join(kitDir, youtubeFilename)
      void window.api.video.revealInFolder(firstOutput)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clip kit failed')
    } finally {
      setRunning(false)
      setPhase('')
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={runKit}
        disabled={running}
        title="Export this clip for all 5 platforms + 3 thumbnails into one folder"
        className="text-xs px-2 py-1 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Icon name="package" size={13} />
        {running ? phase || 'Working…' : `Clip Kit (${ALL_PLATFORM_IDS.length} + thumbs)`}
      </button>
      {running ? (
        // B8 fix (round 15): the Clip Kit batch can run several minutes; a
        // user who picks the wrong source had no way to abort.
        <button
          onClick={() => {
            void window.api.video.cancelAll()
          }}
          className="text-xs px-2 py-1 rounded border border-ink-dim/40 hover:bg-bg-hover"
        >
          Cancel
        </button>
      ) : null}
    </span>
  )
}
