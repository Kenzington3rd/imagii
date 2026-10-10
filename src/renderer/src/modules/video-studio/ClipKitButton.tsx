import { useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type { Clip } from '@shared/clip'
import { sanitizeFilename } from '@shared/filename'
import { buildWatermark } from '@shared/watermark'
import { ALL_PLATFORM_IDS, type PlatformInfo } from './presets'
import {
  buildKitQueue,
  describeKitLimit,
  formatClipLength,
  kitEffectivePresets,
  platformsOverLimit
} from './clipKit'
import { useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { reportFailure } from '../../lib/reportFailure'

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
  // INIT-I (round 16): confirm before cancelling. Clip Kit always has at
  // least 5 platform exports + 3 thumbs queued, so we always confirm here.
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // T-85: the kit's one question. It used to raise the safe-zone modal on
  // every run — picking "all five platforms" IS the answer to that question,
  // and each platform's centered cut is made on purpose (T-83) — so what a
  // user is asked now is the thing the kit cannot know for them: that the
  // clip is past a platform's typical upload limit.
  const [pendingOver, setPendingOver] = useState<PlatformInfo[] | null>(null)

  if (!source) return null

  const clipDuration = Math.max(0.1, clip.endSec - clip.startSec)

  function startKit(): void {
    if (!source) return
    // The effective set, not the five names: a vertical source's YouTube slot
    // is exported as Reels geometry (INIT-B), so Reels is asked about once.
    const over = platformsOverLimit(
      clipDuration,
      kitEffectivePresets({
        filePath: source.filePath,
        width: source.probe.width,
        height: source.probe.height
      })
    )
    if (over.length > 0) {
      setPendingOver(over)
      return
    }
    void runKit()
  }

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
      // T-85: the watermark an earlier Export SAVED, read where the Export
      // panel reads it (`streamerHandle` + `watermarkPosition`). The kit
      // queued `watermark: null`, so the panel next door stamped a clip and
      // the kit made from the same clip did not.
      const watermark = buildWatermark(
        await window.api.settings.get<string>('streamerHandle'),
        await window.api.settings.get<string>('watermarkPosition')
      )
      const isVertical = source.probe.height > source.probe.width
      const queue = buildKitQueue({
        source: {
          filePath: source.filePath,
          width: source.probe.width,
          height: source.probe.height
        },
        clip,
        kitDir,
        safeName,
        watermark,
        newJobId: () => nanoid(10)
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

      toast.success('Saved your Clip Kit', { duration: 6000 })
      // INIT-E (round 15): persist the parent on success.
      void window.api.settings.set('clipKit.lastOutputDir', parentDir)
      // Reveal the folder so the user can grab it for posting. Match the
      // filename the queue actually emitted for vertical sources.
      const youtubeFilename = isVertical ? `${safeName}_youtube_short.mp4` : `${safeName}_youtube.mp4`
      const firstOutput = path.join(kitDir, youtubeFilename)
      void window.api.video.revealInFolder(firstOutput)
    } catch (err) {
      reportFailure(err, {
        failed: 'Clip Kit failed.',
        canceled: 'Clip Kit canceled. Files already finished are in your folder.'
      })
    } finally {
      setRunning(false)
      setPhase('')
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={startKit}
        disabled={running}
        title="Export this clip for all 5 platforms + 3 thumbnails into one folder"
        className="text-xs px-2 py-1 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Icon name="package" size={13} />
        {running ? phase || 'Working…' : `Clip Kit (${ALL_PLATFORM_IDS.length} + thumbs)`}
      </button>
      {running ? (
        // B8 fix (round 15) + INIT-I (round 16): the Clip Kit batch can run
        // several minutes; users who pick the wrong source need an abort,
        // and the multi-job confirm prevents a misclick from torching the
        // batch silently.
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="text-xs px-2 py-1 rounded border border-ink-dim/40 hover:bg-bg-hover"
        >
          Cancel
        </button>
      ) : null}
      <Modal
        open={pendingOver !== null}
        onClose={() => setPendingOver(null)}
        title="This clip is long for some platforms"
        className="max-w-md w-full p-5 ring-1 ring-ember/40"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-warn">
            <Icon name="warning" size={18} />
          </span>
          <h2 className="text-lg font-semibold">This clip is long for some platforms</h2>
        </div>
        <p className="text-sm text-ink-base mb-3">
          This clip is {formatClipLength(clipDuration)}. It is longer than the typical limit for:
        </p>
        <ul className="bg-bg-hover rounded p-2 text-xs flex flex-col gap-1.5 mb-4">
          {(pendingOver ?? []).map((info) => (
            <li key={info.id}>{describeKitLimit(info)}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setPendingOver(null)}>
            Cancel
          </button>
          <button
            className="btn-primary px-4 py-1.5 text-sm"
            onClick={() => {
              setPendingOver(null)
              void runKit()
            }}
          >
            Export anyway
          </button>
        </div>
      </Modal>
      <Modal
        open={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        title="Cancel Clip Kit"
        className="max-w-sm w-full p-5"
      >
        <h2 className="text-lg font-semibold mb-2">Cancel Clip Kit</h2>
        <p className="text-sm text-ink-base mb-4">
          Cancel the Clip Kit batch ({ALL_PLATFORM_IDS.length} exports + thumbnails)?
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="btn-ghost px-3 py-1.5 text-sm"
            onClick={() => setShowCancelConfirm(false)}
          >
            Keep running
          </button>
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            onClick={() => {
              setShowCancelConfirm(false)
              void window.api.video.cancelAll()
            }}
          >
            Cancel jobs
          </button>
        </div>
      </Modal>
    </span>
  )
}
