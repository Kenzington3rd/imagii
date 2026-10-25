import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import path from 'path-browserify'
import type { Clip } from '@shared/clip'
import { CancelledError } from '@shared/cancel'
import { userFacingError } from '@shared/userFacingError'
import { sanitizeFilename } from '@shared/filename'
import { buildWatermark } from '@shared/watermark'
import { KIT_PLATFORM_IDS, outputDurationSec, type PlatformInfo } from './presets'
import {
  buildKitQueue,
  buildKitSrtRequest,
  describeKitLimit,
  formatClipLength,
  kitCanceledMessage,
  kitExportLabel,
  kitLimitTargets,
  kitRunCaption,
  kitSrtFilename,
  kitThumbFilename,
  kitThumbLabel,
  platformsOverLimit
} from './clipKit'
import { useVideoStore } from './store/videoStore'
import { useKitRun } from './store/runs'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { RunningCancel } from '../../components/RunningCancel'
import { persistSetting } from '../../lib/persistSetting'
import { reportFailure } from '../../lib/reportFailure'

interface ClipKitButtonProps {
  clip: Clip
}

/**
 * The running kit's Cancel and the question in front of it (INIT-I, round 16: Clip Kit always has at least 5 platform exports + 3 thumbs queued, so we
 * always confirm). It exists only while a kit runs (T-136 (1): drawn wherever the kit is - the clip list's button for WHICHEVER clip is selected, and
 * beside the importer once the video is closed), so the question goes with the run by construction (T-131 (9): "Cancel jobs" had nothing to cancel).
 */
function KitCancel(): JSX.Element {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  return (
    <>
      {/* B8 fix (round 15) + INIT-I (round 16): the Clip Kit batch can run several minutes; users who pick the wrong source need an abort, and the
          multi-job confirm prevents a misclick from torching the batch silently. */}
      <RunningCancel title="Cancel Clip Kit" onClick={() => setShowCancelConfirm(true)} />
      <Modal open={showCancelConfirm} onClose={() => setShowCancelConfirm(false)} title="Cancel Clip Kit" className="max-w-sm w-full p-5">
        <h2 className="text-lg font-semibold mb-2">Cancel Clip Kit</h2>
        <p className="text-sm text-ink-base mb-4">Cancel the Clip Kit batch ({KIT_PLATFORM_IDS.length} exports + thumbnails)?</p>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setShowCancelConfirm(false)}>
            Keep running
          </button>
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            onClick={() => {
              setShowCancelConfirm(false)
              useKitRun.getState().patch({ canceled: true })
              void window.api.video.cancelAll()
            }}
          >
            Cancel jobs
          </button>
        </div>
      </Modal>
    </>
  )
}

/**
 * A kit that is still running after the video it was started on was closed (T-136 (1)). The kit's files are written by main from the paths the run
 * captured, so Close does not stop it - and with the clip list gone, no kit button was left to cancel it (only quitting stopped it, minutes later). Drawn
 * beside the importer by `VideoStudio`; the card is there only while a kit runs AND no video is open (a video that is open has the clip list's own
 * kit button, which shows the same run).
 *
 * T-137 (3): the live region is the wrapper, and the wrapper is ALWAYS mounted (VideoStudio mounts this component whether a video is open or not).
 * A region that arrives together with its text is not reliably announced - the class T-136 (5) fixed for the Player's notice, GifPanel's wrapper (T-112,
 * T-114) is the pattern: the phase paragraph used to carry its own `aria-live`, and the whole card mounted at the moment the video was closed, so the
 * one moment a screen-reader user most needed telling ("the kit is still running") was the one it was not. Empty, it is still a flex item of the
 * studio's `gap-5` column, so `-mb-5` takes the second gap back and nothing is hidden (no display:none: either would drop it from the accessibility
 * tree). The paragraph below is plain text inside it and its changes are announced as the phase moves on. Not `role="status"`: that is atomic, and
 * would read the whole card again at every phase.
 */
export function ClipKitRunning(): JSX.Element {
  const kitRun = useKitRun((s) => s.run)
  const videoOpen = useVideoStore((s) => s.source !== null)
  const shown = kitRun !== null && !videoOpen
  return (
    <div aria-live="polite" className={shown ? undefined : '-mb-5'}>
      {shown ? (
        <div className="card p-3 flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <Icon name="package" size={14} />
            <span className="min-w-0 flex-1 truncate" title={kitRunCaption(kitRun.clipName)}>
              {kitRunCaption(kitRun.clipName)}
            </span>
            <KitCancel />
          </div>
          <p className="text-xs text-ink-muted">
            {kitRun.phase || 'Working…'} The video is closed; the kit keeps writing its files until it finishes or you cancel it.
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Phase 4D: one-click "Clip Kit" export. Bundles all 5 platform exports
 * + 3 thumbnail JPGs into a single named subfolder, ready to drag into a
 * posting tool - plus the clip's captions as an .srt on the kit file's own
 * clock when the video has a transcript (T-113: `captions:writeKitSrt`).
 *
 * Orchestration is renderer-side (multiple IPC calls), not a single
 * monolithic main-process call — this lets the UI report progress per
 * piece and lets the user cancel partway via the existing cancel paths.
 */
export function ClipKitButton({ clip }: ClipKitButtonProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const srtPath = useVideoStore((s) => s.srtPath)
  // T-135 (1): the kit's run is a module store, not this button's state - and the list unmounts with the studio. T-136 (1): the clip list draws ONE
  // kit button, for the selected clip (not one per row), so the run is not "this clip's": WHILE a kit runs, the button shows it (the clip it was
  // started on is named above the label, from the run) with its Cancel, whichever clip is selected, and starts nothing (main runs one batch at a time;
  // a second press used to be refused with a sentence after a chooser had been answered). Tied to the clip's row, the Cancel was lost when another
  // clip was selected, and for good when the clip was removed or the video closed (`ClipKitRunning` is the closed video's).
  const kitRun = useKitRun((s) => s.run)
  // T-85: the kit's one question. It used to raise the safe-zone modal on
  // every run — picking "all five platforms" IS the answer to that question,
  // and each platform's centered cut is made on purpose (T-83) — so what a
  // user is asked now is the thing the kit cannot know for them: that the
  // clip is past a platform's typical upload limit.
  const [pendingOver, setPendingOver] = useState<PlatformInfo[] | null>(null)
  // T-98: Cancel is a latch for the whole kit. The kit is several calls the
  // renderer makes one after another (folder, batch, three thumbnails, the
  // SRT), and main can only cancel the call that is running — a Cancel that
  // lands between two of them found nothing to stop and the kit carried on to
  // "Saved your Clip Kit". So the click also sets this, and every step asks it
  // first. T-135 (1): it is the run's `canceled` field, in the store, so a Cancel pressed on a remounted button reaches the kit that is
  // still working; the next kit starts with it down, so it cannot outlive one.
  // T-126 (19): one start at a time, claimed the instant the function runs - the pattern `ExportPanel.startExport` has (T-125 (18)). The
  // `busy` state is set only after the awaits in the start (the settings read, the folder chooser), so a double-click ran a second start
  // in that gap: two choosers, two kits. A `finally` gives the claim back; a second press is dropped in silence (the first
  // one's chooser is on screen). Declared with the other hooks, ahead of any early return.
  const startingRef = useRef(false)

  if (!source) return null

  // Source seconds: where the three thumbnails are taken from.
  const clipDuration = Math.max(0.1, clip.endSec - clip.startSec)
  // Output seconds (T-97): how long the files the kit writes will run, which
  // is what a platform's limit is about and what the question below quotes.
  const outputSec = outputDurationSec(clip)

  function startKit(): void {
    if (!source) return
    // The slots the kit really writes, not the five names: a vertical clip's YouTube
    // slot is exported as Reels geometry (INIT-B) but is a YouTube Short with a Short's
    // own limit (T-113), so it is asked about as one.
    const over = platformsOverLimit(
      clip,
      kitLimitTargets(
        {
          filePath: source.filePath,
          width: source.probe.width,
          height: source.probe.height
        },
        clip
      )
    )
    if (over.length > 0) {
      setPendingOver(over)
      return
    }
    void runKit()
  }

  /** Throws the T-84 sentinel when the user has canceled this kit. */
  function stopIfCanceled(): void {
    if (useKitRun.getState().run?.canceled) throw new CancelledError()
  }

  async function runKit(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (!source) return
      // INIT-E (round 15) saved the parent on success; T-120 reads it: the chooser opens on the folder the last
      // kit went to (Export remembers its folder, and the kit asked from scratch every press). The saved value
      // came off disk, so a failed read is no reason to stop: the chooser just opens where it always did.
      const lastDir = await window.api.settings.get<string>('clipKit.lastOutputDir').catch(() => undefined)
      const parentDir = await window.api.video.pickOutputDir(
        typeof lastDir === 'string' && lastDir.length > 0 ? lastDir : undefined
      )
      if (!parentDir) return
      if (!useKitRun.getState().begin({ clipId: clip.id, clipName: clip.name, phase: '', canceled: false })) return
      // T-112: the folder is made before the first job, so a kit that is canceled or fails
      // before ANY file lands in it would leave an empty `<name>-kit-<date>` behind. `landed`
      // counts the files the kit has finished writing (a platform export, a thumbnail); the
      // catch below asks main to remove the folder only while it is still 0.
      let kitDir: string | null = null
      let landed = 0
      try {
        // Tech-debt fix: per-file names get the same sanitizer as the
        // subfolder. Otherwise a clip named with punctuation/symbols
        // produces filenames ffmpeg can write but Windows Explorer renders
        // awkwardly, and the revealInFolder path has to match exactly.
        // T-122: computed BEFORE the folder is made, and it is what main is asked to name the
        // folder for. The rename field accepts an empty name, main's `assertNonEmptyString`
        // refuses one, and the raw name used to reach it: the kit failed after the folder
        // pick with the bare "Clip Kit failed.". The sanitizer's 'clip' fallback satisfies
        // the gate (main sanitizes again, which is idempotent) and the folder and every file
        // come from the one name.
        const safeName = sanitizeFilename(clip.name)
        useKitRun.getState().patch({ phase: 'Creating folder…' })
        kitDir = await window.api.video.makeKitDir({
          parentDir,
          clipName: safeName
        })

        // Build a 5-platform queue for this single clip.
        // T-85: the watermark an earlier Export SAVED, read where the Export
        // panel reads it (`streamerHandle` + `watermarkPosition`). The kit
        // queued `watermark: null`, so the panel next door stamped a clip and
        // the kit made from the same clip did not.
        const watermark = buildWatermark(
          await window.api.settings.get<string>('streamerHandle'),
          await window.api.settings.get<string>('watermarkPosition')
        )
        stopIfCanceled()
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
        // T-112: the label counts. Each finished job moves it on (the same event the
        // Export panel's rows listen to); the job in progress is the one after the
        // finished ones.
        let finished = 0
        useKitRun.getState().patch({ phase: kitExportLabel(finished, queue.length) })
        const offJobComplete = window.api.video.onJobComplete(() => {
          finished += 1
          landed += 1
          useKitRun.getState().patch({ phase: kitExportLabel(finished, queue.length) })
        })
        try {
          await window.api.video.exportBatch(queue)
        } finally {
          offJobComplete()
        }
        stopIfCanceled()

        // Three thumbnails at 25%, 50%, 75% of the clip duration. These run
        // sequentially — they're each ~200-500ms so the total is bounded
        // and the per-step progress message stays informative.
        const thumbTimes = [0.25, 0.5, 0.75]
        const len = thumbTimes.length
        for (let i = 0; i < len; i++) {
          stopIfCanceled()
          useKitRun.getState().patch({ phase: kitThumbLabel(i, len) })
          const t = thumbTimes[i] ?? 0.5
          const timeSec = clip.startSec + t * clipDuration
          const outPath = path.join(kitDir, kitThumbFilename(safeName, i))
          await window.api.video.extractFrame({
            sourcePath: source.filePath,
            timeSec,
            outputPath: outPath,
            // T-130 (t): the thumbnails are the clip's picture, so the crop that is the clip's frame.
            cropRect: clip.cropRect
          })
          landed += 1
        }

        // Tech-debt fix: bundle the SRT when the project has a transcribed
        // one. Silent failure (file moved/deleted since transcription) so
        // the user still gets the rest of the kit.
        stopIfCanceled()
        let noCaptions = false
        if (srtPath) {
          useKitRun.getState().patch({ phase: 'Bundling captions…' })
          const srtDest = path.join(kitDir, kitSrtFilename(safeName))
          // T-113: the transcript is of the whole recording; the kit's video is this clip at its
          // speed, so main writes the cues on THAT file's clock (it used to copy them as they
          // were, on the source clock, beside a clip that starts at 0:00).
          const result = await window.api.captions.writeKitSrt(buildKitSrtRequest(srtPath, srtDest, clip))
          if (!result.ok) {
            // T-100: main's `reason` is a fragment for a log ("source SRT not
            // found"), not a sentence. The helper writes the raw one to the
            // console and gives the user the plain line (and a cause it knows).
            toast(userFacingError(result.reason, "Couldn't include captions in the kit.").message, {
              icon: <Icon name="warning" size={18} />,
              duration: 6000
            })
          } else {
            // Nobody speaks in this clip: no .srt was written, and the kit says so.
            noCaptions = !result.written
          }
        }

        toast.success(
          noCaptions ? 'Saved your Clip Kit (no captions fall inside this clip)' : 'Saved your Clip Kit',
          { duration: 6000 }
        )
        // INIT-E (round 15): persist the parent on success.
        void persistSetting('clipKit.lastOutputDir', parentDir)
        // Reveal the folder so the user can grab it for posting: select the first
        // file the queue wrote, whatever the YouTube slot turned out to be named
        // (T-112: it is a Short when the CROP is vertical, so the name is read off
        // the queue instead of being worked out a second time here).
        const firstOutput = path.join(kitDir, queue[0]?.outputFilename ?? `${safeName}_youtube.mp4`)
        void window.api.video.revealInFolder(firstOutput)
      } catch (err) {
        // T-112: nothing finished, so there is nothing to keep. Main removes the folder only if it
        // is empty (a non-recursive rmdir), so this can never take a file; a refusal there is a
        // console note, and the failure the user is told about is the kit's own.
        if (kitDir !== null && landed === 0) {
          void window.api.video.removeKitDir(kitDir).catch(() => undefined)
        }
        reportFailure(err, {
          failed: 'Clip Kit failed.',
          // T-113: with nothing finished the folder was just removed, and "files already finished
          // are in your folder" would send the person looking for a folder that is gone.
          canceled: kitCanceledMessage(landed)
        })
      } finally {
        useKitRun.getState().end()
      }
    } finally {
      startingRef.current = false
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-end gap-1">
      {kitRun !== null ? (
        <span className="max-w-full truncate text-xs text-ink-muted" title={kitRunCaption(kitRun.clipName)}>
          {kitRunCaption(kitRun.clipName)}
        </span>
      ) : null}
      <button
        onClick={startKit}
        disabled={kitRun !== null}
        // T-125 (24): the Video tour's Clip Kit step points here.
        data-tutorial="video-clipkit"
        // T-113: the label IS the progress readout ("Exporting platform version 2 of 5…"), so
        // it is announced as it changes (GifPanel's pattern; role="status" would clobber the
        // button role).
        aria-live="polite"
        title="Export this clip for all 5 platforms + 3 thumbnails into one folder"
        // T-112: ink on the wash, the accent border carries the identity. accent text on
        // an accent wash over the row's bg-hover measured 4.10:1 at rest and about 3.6:1
        // on hover (under the 4.5:1 AA floor); ink-base clears it with room.
        // T-137 (4): the running label is a sentence ("Exporting platform version 2 of 5…") and it stays on ONE line (`whitespace-nowrap`):
        // beside its Cancel it wrapped mid-sentence at the default and the minimum windows (measured 197 x 42 px), and the clip list
        // jumped about 36 px each time the phase changed length.
        className="text-xs px-2 py-1 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-ink-base whitespace-nowrap disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        <Icon name="package" size={13} />
        {kitRun !== null ? kitRun.phase || 'Working…' : `Clip Kit (${KIT_PLATFORM_IDS.length} + thumbs)`}
      </button>
      {/* T-137 (4): Cancel has a row of its own under the button (the column this span is), as GIF, Compile, Picture-in-picture and Export
          have since T-126 (20): the busy label is the longer and the idle one the shorter, so beside the button it took the strip the
          button's right edge held a moment ago, and it is what made the label wrap. */}
      {kitRun !== null ? <KitCancel /> : null}
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
          This clip is {formatClipLength(outputSec)}. It is longer than the typical limit for:
        </p>
        <ul className="bg-bg-hover rounded p-2 text-xs flex flex-col gap-1.5 mb-4">
          {(pendingOver ?? []).map((info) => (
            <li key={info.label}>{describeKitLimit(info)}</li>
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
    </span>
  )
}
