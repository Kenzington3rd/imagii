import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  cancelBurnIn,
  cancelTranscribe,
  cancelWhisperModelInstall,
  getCaptionsStatus,
  installWhisperModel,
  runBurnIn,
  runTranscribe
} from '../sidecars/whisperManager'
import { captionsOutputDir } from '../sidecars/paths'
import { isOutsideFolder } from '../pathConfine'
import { clearTranscripts, countTranscripts } from '../transcripts'
import { shiftSrtToRange, type TranscribeRequest, type BurnInRequest } from '../../shared/captions'
import {
  assertFiniteNonNeg,
  assertNonEmptyString,
  assertOptionalTimeRange,
  assertPlainObject,
  assertRange
} from '../../shared/validators'
import { assertSafeAbsolutePath } from '../../shared/pathSafety'
import { sendIfAlive } from '../sendIfAlive'
import { writeFileAtomic } from '../fsAtomic'

/**
 * What a streamer is told when a caption color cannot be used (T-114). The two style colors
 * are printed into the burn's `force_style='...'` (`PrimaryColour=`, `OutlineColour=`), so
 * they must be exactly what `<input type="color">` writes. A finished sentence
 * `userFacingError` stands behind; the detail goes to the console. The runner checks again
 * (`hexToAssColor`), because the gate is not the only road to it.
 */
const BAD_CAPTION_COLOR =
  "A caption color has a setting imagii can't use — check the text and outline colors, then try again."
const CAPTION_COLOR = /^#[0-9a-fA-F]{6}$/

function assertUsableCaptionStyle(style: unknown): void {
  if (style === undefined || style === null) return
  const bad = (detail: string): never => {
    console.error(`[imagii] captions:burnIn refused a caption style: ${detail}`)
    throw new Error(BAD_CAPTION_COLOR)
  }
  if (typeof style !== 'object' || Array.isArray(style)) return bad('req.style is not an object')
  const colors = style as Record<string, unknown>
  for (const key of ['primaryColor', 'outlineColor'] as const) {
    const v = colors[key]
    if (typeof v !== 'string' || !CAPTION_COLOR.test(v)) bad(`req.style.${key} is not #RRGGBB`)
  }
}

/**
 * What "Save .srt" tells a person when the transcript it was pointed at cannot be saved (T-116).
 * Both are finished sentences, so `userFacingError` (tier 2) stands behind them and the panel shows
 * them as written; the cause is something the person can fix (transcribe the video again), not a
 * channel name or a path. The first is a project that remembers a transcript the app no longer has;
 * the second is a project file that names a transcript somewhere other than this computer's folder.
 */
const SRT_GONE = "That transcript isn't on this computer anymore \u2014 transcribe the video again."
const SRT_OUTSIDE =
  "That transcript isn't in imagii's captions folder on this computer \u2014 transcribe the video again."

export function registerCaptionsIpc(): void {
  ipcMain.handle('captions:status', () => getCaptionsStatus())

  ipcMain.handle('captions:transcribe', async (e, req: TranscribeRequest) => {
    // Validate the renderer-supplied request like every other IPC handler.
    // sourcePath reaches the Whisper sidecar / ffmpeg; require a safe
    // absolute path so a traversal path can't reach an arbitrary file.
    assertPlainObject(req, 'captions:transcribe req')
    assertNonEmptyString(req.jobId, 'req.jobId')
    assertSafeAbsolutePath(req.sourcePath, 'req.sourcePath')
    return runTranscribe(req, (p) => sendIfAlive(e.sender, 'captions:progress', p))
  })

  ipcMain.handle('captions:burnIn', async (e, req: BurnInRequest) => {
    assertPlainObject(req, 'captions:burnIn req')
    assertNonEmptyString(req.jobId, 'req.jobId')
    assertSafeAbsolutePath(req.videoPath, 'req.videoPath')
    assertSafeAbsolutePath(req.srtPath, 'req.srtPath')
    assertSafeAbsolutePath(req.outputPath, 'req.outputPath')
    // T-81: a range is either absent or a real one. Before this, a bad range
    // (inverted, NaN, a lone startSec) silently became a burn over the whole
    // video; now it is refused before any file is read or ffmpeg spawned.
    assertOptionalTimeRange(req.startSec, req.endSec, 'captions:burnIn req')
    // T-114: the style's colors are printed into the burn's filter string.
    assertUsableCaptionStyle(req.style)
    return runBurnIn(req, (p) => sendIfAlive(e.sender, 'captions:progress', p))
  })

  ipcMain.handle(
    'captions:saveSrt',
    async (_e, srtPath: string, defaultName: string) => {
      // INIT-C (round 15): mirror writeKitSrt — confine srtPath to the
      // captions output directory before any read. Without the confinement
      // a malicious renderer could exfiltrate arbitrary files via the
      // copy-then-show-in-folder path.
      assertNonEmptyString(srtPath, 'srtPath')
      assertNonEmptyString(defaultName, 'defaultName')
      const allowedRoot = path.resolve(captionsOutputDir())
      const resolvedSrc = path.resolve(srtPath)
      // T-117: "outside" is a real parent segment, not a name that starts with two dots - a
      // transcript is named from its video, and `..intro.srt` is a legal file in the folder.
      if (isOutsideFolder(allowedRoot, resolvedSrc)) {
        console.error(`[imagii] captions:saveSrt refused a source outside the captions directory: ${resolvedSrc}`)
        throw new Error(SRT_OUTSIDE)
      }
      // T-116: find a missing transcript BEFORE asking where to save its copy (writeKitSrt's check).
      // Checked after the folder gate, so the answer for a path outside the folder never says
      // whether a file is there.
      if (!existsSync(resolvedSrc)) {
        console.error(`[imagii] captions:saveSrt source not found: ${resolvedSrc}`)
        throw new Error(SRT_GONE)
      }
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save .srt subtitle file',
        defaultPath: defaultName,
        filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }]
      })
      if (result.canceled || !result.filePath) return null
      // T-139 (1): a copy is a read and an atomic write (a transcript is kilobytes), so the file the person chose is the old one until the copy is whole.
      // Bytes, not text: the copy is exactly the transcript (a byte order mark and CRLF line ends are not re-encoded).
      await writeFileAtomic(result.filePath, await readFile(resolvedSrc))
      return result.filePath
    }
  )

  // T-128 (3), T-110 (s): the transcripts every transcription keeps in <userData>/captions, counted and emptied. NO argument: the folder
  // is main's own, so no renderer can aim a clear anywhere else (transcripts.ts holds what counts as a transcript and what is never touched).
  ipcMain.handle('captions:countTranscripts', () => countTranscripts(captionsOutputDir()))
  ipcMain.handle('captions:clearTranscripts', () => clearTranscripts(captionsOutputDir()))

  ipcMain.handle('captions:pickBurnInOutput', async (_e, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Save captioned video',
      defaultPath: defaultName,
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('captions:openBinFolder', async () => {
    const status = getCaptionsStatus()
    shell.openPath(path.dirname(status.exePath))
  })

  ipcMain.handle('captions:openModelsFolder', async () => {
    const status = getCaptionsStatus()
    // T-119: nothing makes <userData>/models before the model installer does, so on a fresh profile this
    // used to hand the shell a folder that was not there and open nothing - on the very card that tells a
    // person to put the model in it. The bin folder has had ensureUserBinDir since T-102; this is the same
    // idempotent mkdir. A profile that will not take a folder is logged, not thrown across the bridge.
    try {
      await mkdir(status.modelsDir, { recursive: true })
    } catch (err) {
      console.error('[imagii] could not create the models folder', err)
    }
    // openPath answers with an error string, never a rejection; empty means it opened.
    const failed = await shell.openPath(status.modelsDir)
    if (failed) console.error('[imagii] could not open the models folder:', failed)
  })

  // Phase 4E: stream the Whisper model file into userData/models/.
  // Progress events go to the focused window via captions:modelProgress
  // so the UI can render an accurate progress bar.
  ipcMain.handle('captions:installModel', async (e) => {
    return installWhisperModel((p) => sendIfAlive(e.sender, 'captions:modelProgress', p))
  })

  // Tech-debt fix: cancel an in-flight model download.
  ipcMain.handle('captions:cancelInstall', () => cancelWhisperModelInstall())

  // Round 17 B6: per-job cancel for the CaptionsPanel "Cancel burn-in" button.
  // No jobId required — only one burn-in runs at a time (the renderer's
  // `running` flag guards re-entry); cancelBurnIn() with no arg kills the lot.
  ipcMain.handle('captions:cancelBurnIn', () => cancelBurnIn())

  // T-108: the same for transcription — one runs at a time (`transcribeInProgress`),
  // so no jobId is needed, and a Cancel with nothing running marks nothing.
  ipcMain.handle('captions:cancelTranscribe', () => cancelTranscribe())

  // The Clip Kit's captions, on the clip's clock (T-113; it was `captions:copySrtTo` when it
  // copied the file, and the name now says what it does). The kit bundles an SRT beside a
  // video that is ONE CLIP at ITS SPEED, and the transcript is of the whole recording: copying
  // it left every cue on the source clock (a clip cut from minute 40 got captions that began at
  // minute 40). So the caller says which clip — its range and speed — and main writes the cues
  // re-expressed on the clock of the file the kit made (`shiftSrtToRange`: shifted by
  // -startSec, cut to the range, divided by the speed). A clip nobody speaks in gets no file,
  // and the answer says so (`written: false`) instead of leaving an SRT with no cue in it.
  // Returns { ok, reason? } so the kit's UI can render a clear error if the source SRT is
  // missing.
  //
  // Bug fix (path-traversal): restrict srtPath to the captions output
  // directory. Even though the only current caller passes a path
  // produced by our own runTranscribe, defense-in-depth prevents a
  // future caller (or a compromised renderer) from passing
  // ../../somewhere-sensitive and exfiltrating arbitrary files via the
  // copy-then-read pattern.
  ipcMain.handle(
    'captions:writeKitSrt',
    async (
      _e,
      params: { srtPath: string; dest: string; startSec: number; endSec: number; speed: number }
    ): Promise<{ ok: true; written: boolean } | { ok: false; reason: string }> => {
      assertPlainObject(params, 'captions:writeKitSrt params')
      assertNonEmptyString(params.srtPath, 'srtPath')
      assertNonEmptyString(params.dest, 'dest')
      // Round 18: the write target gets the same no-traversal gate every
      // other IPC output-path field has — srtPath was confined but dest
      // could have been aimed anywhere the app can write.
      assertSafeAbsolutePath(params.dest, 'dest')
      // The clip: a real range (both ends, no half) and a speed the export accepts.
      assertFiniteNonNeg(params.startSec, 'startSec')
      assertFiniteNonNeg(params.endSec, 'endSec')
      assertOptionalTimeRange(params.startSec, params.endSec, 'captions:writeKitSrt')
      assertRange(params.speed, 0.1, 10, 'speed')
      const allowedRoot = path.resolve(captionsOutputDir())
      const resolvedSrc = path.resolve(params.srtPath)
      // T-117: a real parent segment (or another drive), not a name that starts with two dots.
      if (isOutsideFolder(allowedRoot, resolvedSrc)) {
        return { ok: false, reason: 'source SRT is outside the captions directory' }
      }
      if (!existsSync(resolvedSrc)) {
        return { ok: false, reason: 'source SRT not found' }
      }
      try {
        const shifted = shiftSrtToRange(
          await readFile(resolvedSrc, 'utf8'),
          params.startSec,
          params.endSec,
          params.speed
        )
        if (shifted === '') return { ok: true, written: false }
        await writeFileAtomic(params.dest, shifted)
        return { ok: true, written: true }
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'copy failed'
        }
      }
    }
  )
}
